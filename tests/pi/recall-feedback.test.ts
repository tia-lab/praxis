/**
 * The below-bar refusal carries the recalled examples for the dimensions that failed
 * (quality-recall-feedback). Three properties: a warm store returns up to three ranked passing cases
 * whose lesson tags intersect the refused dimensions and carry provenance; a cold store omits the
 * field entirely rather than emitting an empty object; and no other refusal grows the field.
 *
 * NO NETWORK: the scorer is injected, the store is a temp workspace, and the judge is the aligned fake.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { setScorerForTest } from "../../src/pi/tool.ts";
import { executePraxisTool, setAlignJudgeForTest } from "../../src/pi/tool.ts";
import type { PiSessionContext, PiToolResult } from "../../src/pi/host.ts";
import {
  JUDGED_SCHEMA,
  clock,
  dimensionScorer,
  dispose,
  judgedFlow,
  recordNoteFor,
  startJudged,
  submitJudged,
  workspace,
  type Workspace,
} from "../testkit.ts";
import { fakeAlignJudge } from "./fixtures.ts";

const SESSION = "session-feedback";

/** Point the tool at this workspace: the flow by PRAXIS_CONFIG, the store by PRAXIS_STORE_DIR. */
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

/** One complete solved case in the store: an accepted artifact, its verdict and a note with a lesson. */
async function seedCase(ws: Workspace, tick: () => string, requestId: string): Promise<void> {
  judgedFlow(ws);
  const run = startJudged(ws, requestId, tick());
  setScorerForTest(dimensionScorer([{ solves: 0.95, evidence: 0.95, trace: 0.95 }]) as never);
  try {
    await submitJudged(ws, run, tick(), 1, dimensionScorer([{ solves: 0.95, evidence: 0.95, trace: 0.95 }]) as never);
  } finally {
    setScorerForTest(undefined);
  }
  recordNoteFor(ws, run.instance, tick());
}

/** Start one judged instance through the TOOL and return its id and nonce. */
async function startThroughTool(ws: Workspace, requestId: string): Promise<{ instance: string; nonce: string }> {
  const started = bag(await call(ws, { op: "start", flow: "flows/learn", order: "carry out the task this flow runs", requestId }));
  assert.equal(started.code, undefined, "the start succeeded: " + JSON.stringify(started).slice(0, 200));
  return { instance: started.result.instanceId as string, nonce: started.nonce as string };
}

test("a below-bar refusal carries up to three recalled cases for the refused dimensions", async () => {
  const ws = workspace();
  judgedFlow(ws);
  const restore = useWorkspace(ws);
  try {
    setAlignJudgeForTest(fakeAlignJudge("aligned"));
    const tick = clock().next;
    await seedCase(ws, tick, "solved-1");
    await seedCase(ws, tick, "solved-2");
    await seedCase(ws, tick, "solved-3");
    await seedCase(ws, tick, "solved-4");

    const run = await startThroughTool(ws, "refusing");
    // One dimension far below its bar, the other two excellent: refused is exactly ["solves"].
    setScorerForTest(dimensionScorer([{ solves: 0.3, evidence: 0.95, trace: 0.95 }]) as never);
    const refused = await call(ws, { op: "submit", instance: run.instance, artifact: { schema: JUDGED_SCHEMA, nonce: run.nonce, attempt: 1 } });
    setScorerForTest(undefined);

    assert.equal(refused.isError, true, "the artifact is refused");
    const details = bag(refused);
    assert.equal(details.code, "QUALITY_BELOW_THRESHOLD");
    assert.deepEqual(details.detail.refused, ["solves"], "the refusal names the failed dimension");

    const recall = details.detail.recall;
    assert.ok(recall, "the refusal carries the recalled examples");
    assert.deepEqual(Object.keys(recall).sort(), ["cases", "count", "need", "truncated"], "the op=recall payload shape");
    assert.ok(recall.count >= 1 && recall.count <= 3, "bounded at three: " + recall.count);
    assert.equal(recall.cases.length, recall.count);
    assert.match(recall.need, /solves/, "the need text names the refused dimension");
    for (const solvedCase of recall.cases) {
      assert.equal(solvedCase.outcome, "pass", "only passing work is recalled");
      assert.ok(
        solvedCase.lesson.tags.some((tag: { dimension: string }) => tag.dimension === "solves"),
        "each case carries a lesson for the refused dimension",
      );
      assert.equal(typeof solvedCase.provenance.instance, "string");
      assert.equal(typeof solvedCase.provenance.task, "string");
      assert.equal(typeof solvedCase.provenance.step, "string");
      assert.match(String(solvedCase.provenance.digest), /^sha256:[0-9a-f]{64}$/);
      assert.equal(typeof solvedCase.provenance.writtenBy, "string");
      assert.equal(typeof solvedCase.provenance.at, "string");
    }
  } finally {
    setScorerForTest(undefined);
    setAlignJudgeForTest(undefined);
    restore();
    dispose(ws);
  }
});

test("a cold store omits the field entirely and leaves the rest of the detail unchanged", async () => {
  const ws = workspace();
  judgedFlow(ws);
  const restore = useWorkspace(ws);
  try {
    setAlignJudgeForTest(fakeAlignJudge("aligned"));
    const tick = clock().next;
    const run = await startThroughTool(ws, "cold");
    setScorerForTest(dimensionScorer([{ solves: 0.3, evidence: 0.95, trace: 0.95 }]) as never);
    const refused = await call(ws, { op: "submit", instance: run.instance, artifact: { schema: JUDGED_SCHEMA, nonce: run.nonce, attempt: 1 } });
    setScorerForTest(undefined);

    const details = bag(refused);
    assert.equal(details.code, "QUALITY_BELOW_THRESHOLD");
    assert.equal("recall" in details.detail, false, "no cases, no field: not an empty object");
    // The feedback the agent already got is untouched.
    assert.deepEqual(details.detail.refused, ["solves"]);
    assert.equal(typeof details.detail.quality.weakest.id, "string");
    assert.equal(details.detail.quality.weakest.id, "solves");
    void tick;
  } finally {
    setScorerForTest(undefined);
    setAlignJudgeForTest(undefined);
    restore();
    dispose(ws);
  }
});

test("an ARTIFACT_INVALID refusal carries no recall, even on a warm store", async () => {
  const ws = workspace();
  judgedFlow(ws);
  const restore = useWorkspace(ws);
  try {
    setAlignJudgeForTest(fakeAlignJudge("aligned"));
    const tick = clock().next;
    await seedCase(ws, tick, "solved-invalid");
    const run = await startThroughTool(ws, "invalid");

    // Missing nonce: a section refusal, not a quality judgment, so nothing is recalled.
    const refused = await call(ws, { op: "submit", instance: run.instance, artifact: { schema: JUDGED_SCHEMA, attempt: 1 } });
    const details = bag(refused);
    assert.equal(details.code, "ARTIFACT_INVALID");
    assert.equal("recall" in (details.detail ?? {}), false, "a section refusal is unchanged");
  } finally {
    setAlignJudgeForTest(undefined);
    restore();
    dispose(ws);
  }
});
