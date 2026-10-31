/**
 * The verdict rationale on its three surfaces, driven through the real tool (verdict-rationale D12).
 *
 * The scorer is injected (`setScorerForTest`) so both the score and the battery are deterministic and
 * nothing reaches the network.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { actorFor, executePraxisTool, setAlignJudgeForTest, setScorerForTest } from "../../src/pi/tool.ts";
import type { PiSessionContext, PiToolResult } from "../../src/pi/host.ts";
import type { Scorer } from "../../src/quality/index.ts";
import { JUDGED_SCHEMA, clock, dispose, eventsOf, judgedFlow, recordNoteFor, workspace, type Workspace } from "../testkit.ts";
import { fakeAlignJudge } from "./fixtures.ts";

const SESSION = "session-rationale";

/** A rubric whose first dimension declares a battery, and whose second declares none. */
const RUBRIC = [
  {
    id: "solves",
    statement: "it solves the stated goal",
    floor: 0.6,
    probes: [
      { id: "main-issue", type: "choice", instructions: "Does it keep to one issue?",
        criteria: { "one-issue": "one issue throughout", drifted: "drifts into adjacent issues" }, clean: "one-issue" },
      { id: "redundant", type: "noul", instructions: "No included item repeats another." },
    ],
  },
  { id: "evidence", statement: "every claim carries evidence", floor: 0.6 },
];

/** A scorer with a score and a battery: the battery answers `drifted` and `0.1` (both dirty). */
function scorerWithBattery(scores: { solves: number; evidence: number }): Scorer {
  return {
    async score({ rubric }) {
      return {
        dimensions: rubric.map((dimension) => ({
          id: dimension.id,
          score: dimension.id === "solves" ? scores.solves : scores.evidence,
        })),
        rationale: "fake noul",
        scorer: "fake/v1",
      };
    },
    async explain({ rubric }) {
      return {
        scorer: "fake/v1",
        dimensions: rubric
          .filter((dimension) => dimension.probes !== undefined)
          .map((dimension) => ({
            id: dimension.id,
            diagnosis: [
              { probe: "main-issue", answer: "drifted" },
              { probe: "redundant", answer: 0.1 },
            ],
            rationale: dimension.id + ": drifts into adjacent issues; not satisfied: No included item repeats another.",
          })),
      };
    },
  };
}

function useWorkspace(ws: Workspace): () => void {
  const priorConfig = process.env.PRAXIS_CONFIG;
  const priorStore = process.env.PRAXIS_STORE_DIR;
  process.env.PRAXIS_CONFIG = ws.config;
  process.env.PRAXIS_STORE_DIR = ws.store;
  return () => {
    if (priorConfig === undefined) delete process.env.PRAXIS_CONFIG;
    else process.env.PRAXIS_CONFIG = priorConfig;
    if (priorStore === undefined) delete process.env.PRAXIS_STORE_DIR;
    else process.env.PRAXIS_STORE_DIR = priorStore;
  };
}

const contextFor = (ws: Workspace): PiSessionContext => ({ cwd: ws.root, sessionManager: { getSessionId: () => SESSION } });
const call = (ws: Workspace, args: unknown): Promise<PiToolResult> => executePraxisTool(args, contextFor(ws));
const bag = (result: PiToolResult): any => result.details;

async function start(ws: Workspace, requestId: string): Promise<{ instance: string; nonce: string }> {
  const started = bag(await call(ws, { op: "start", flow: "flows/learn", order: "carry out the task this flow runs", requestId }));
  assert.equal(started.code, undefined, "the start succeeded: " + JSON.stringify(started).slice(0, 200));
  return { instance: started.result.instanceId as string, nonce: started.nonce as string };
}

test("R8: the refusal handback carries each dimension's rationale beside the recalled exemplars", async () => {
  const ws = workspace();
  judgedFlow(ws, { dimensions: RUBRIC });
  const restore = useWorkspace(ws);
  try {
    setAlignJudgeForTest(fakeAlignJudge("aligned"));
    setScorerForTest(scorerWithBattery({ solves: 0.3, evidence: 0.95 }));
    const run = await start(ws, "refused");
    const refused = await call(ws, { op: "submit", instance: run.instance, artifact: { schema: JUDGED_SCHEMA, nonce: run.nonce, attempt: 1 } });

    const details = bag(refused);
    assert.equal(refused.isError, true);
    assert.equal(details.code, "QUALITY_BELOW_THRESHOLD");
    const dimensions = details.detail.quality.dimensions as { id: string; rationale?: string; diagnosis?: unknown[] }[];
    const solves = dimensions.find((dimension) => dimension.id === "solves");
    const evidence = dimensions.find((dimension) => dimension.id === "evidence");
    assert.ok(solves?.rationale, "the judged dimension carries its rendered why");
    assert.equal(solves!.rationale, "solves: drifts into adjacent issues; not satisfied: No included item repeats another.");
    assert.equal(solves!.diagnosis?.length, 2, "and its structured answers");
    assert.equal(evidence!.rationale, undefined, "a dimension without probes carries none");
    // The failure itself is unchanged: the same bar, the same refused set.
    assert.deepEqual(details.detail.compound.refused, ["solves"]);
  } finally {
    setScorerForTest(undefined);
    setAlignJudgeForTest(undefined);
    restore();
    dispose(ws);
  }
});

test("R9: before the note, the brief shows the recorded judgment of the accepted step", async () => {
  const ws = workspace();
  judgedFlow(ws, { dimensions: RUBRIC });
  const restore = useWorkspace(ws);
  try {
    setAlignJudgeForTest(fakeAlignJudge("aligned"));
    setScorerForTest(scorerWithBattery({ solves: 0.95, evidence: 0.95 }));
    const run = await start(ws, "accepted");
    const accepted = bag(await call(ws, { op: "submit", instance: run.instance, artifact: { schema: JUDGED_SCHEMA, nonce: run.nonce, attempt: 1 } }));
    assert.equal(accepted.code, undefined, "the submit was accepted");
    assert.equal(accepted.step.brief.quality !== undefined, true, "the brief still carries the standard");
    const judgment = accepted.step.brief.quality.judgment;
    assert.ok(judgment, "the note-owed step carries the recorded judgment");
    assert.equal(judgment.score, 0.95);
    const solves = judgment.dimensions.find((dimension: { id: string }) => dimension.id === "solves");
    assert.ok(solves.rationale, "with the per-dimension why the note must be grounded in");
    assert.equal(solves.diagnosis.length, 2);

    // The verdict is also on the record, so it is the SAME judgment, not a recomputation.
    const recorded = eventsOf(ws, run.instance).filter((event) => event.type === "quality.verdict").pop()?.payload as
      | { dimensions: { id: string; rationale?: string }[] }
      | undefined;
    assert.equal(recorded?.dimensions.find((dimension) => dimension.id === "solves")?.rationale, solves.rationale);
  } finally {
    setScorerForTest(undefined);
    setAlignJudgeForTest(undefined);
    restore();
    dispose(ws);
  }
});

test("R10: recall shows the exemplar's rationale for the queried dimension only", async () => {
  const ws = workspace();
  judgedFlow(ws, { dimensions: RUBRIC });
  const restore = useWorkspace(ws);
  try {
    setAlignJudgeForTest(fakeAlignJudge("aligned"));
    const tick = clock().next;
    // One solved case: accepted, judged with the battery, then closed with a note on `solves`.
    setScorerForTest(scorerWithBattery({ solves: 0.95, evidence: 0.95 }));
    const run = await start(ws, "solved");
    await call(ws, { op: "submit", instance: run.instance, artifact: { schema: JUDGED_SCHEMA, nonce: run.nonce, attempt: 1 } });
    // The note is recorded as the SAME actor the tool session created the instance with.
    recordNoteFor(
      ws,
      run.instance,
      tick(),
      {
        whatWrong: "the earlier draft drifted",
        whatRight: "the answer was grounded",
        whatBetter: "keep to one issue",
        tags: [{ dimension: "solves", lesson: "keep to one issue throughout" }],
      },
      actorFor(contextFor(ws)),
    );

    const recalled = bag(await call(ws, { op: "recall", instance: run.instance, need: "stuck on scope", tags: ["solves"] }));
    assert.ok(recalled.count >= 1, "the solved case is recalled: " + JSON.stringify(recalled).slice(0, 200));
    const first = recalled.cases[0];
    assert.equal(
      first.rationale,
      "solves: drifts into adjacent issues; not satisfied: No included item repeats another.",
      "the queried dimension's line",
    );
    // A query about a dimension with no probes shows nothing rather than another dimension's why.
    const other = bag(await call(ws, { op: "recall", instance: run.instance, need: "stuck on evidence", tags: ["evidence"] }));
    assert.equal(other.cases[0].rationale, undefined, "no fallback to a different dimension's rationale");
  } finally {
    setScorerForTest(undefined);
    setAlignJudgeForTest(undefined);
    restore();
    dispose(ws);
  }
});
