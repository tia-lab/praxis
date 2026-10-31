/**
 * Regression: the descriptor mirror must carry every key the scorer writes into a diagnosis entry.
 *
 * The live failure: the scorer records a section-targeting criterion's `sections` in its diagnosis
 * (src/quality/jev-scorer.ts), the descriptor's mirror (src/types/pi.ts) did not declare it, and its
 * `strictObject` therefore REJECTED the whole step descriptor - so `brief.quality.judgment` was
 * unreadable for any rubric whose criteria target sections, exactly when a note was owed.
 *
 * This test drives the REAL path end to end: the real `jevScorer` (only its `evaluateFn` is faked) writes
 * the diagnosis, the engine records the verdict, and the tool builds the descriptor for the note-owed
 * step - which is where the mirror is applied.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { JevRequest, JevResponse } from "pi-jev";
import { executePraxisTool, setAlignJudgeForTest, setScorerForTest } from "../../src/pi/tool.ts";
import type { PiToolResult } from "../../src/pi/host.ts";
import { jevScorer } from "../../src/quality/index.ts";
import { dispose, eventsOf, writeFlow, workspace, type Workspace } from "../testkit.ts";
import { fakeAlignJudge, fakeContext } from "./fixtures.ts";

const SESSION = "session-descriptor-diagnosis";
const SCHEMA = "praxis.artifact.make/v1";

/** A judge that answers every criterion cleanly; its QUESTIONS still carry the authored text. */
function answerEverything() {
  const evaluateFn = async (request: JevRequest): Promise<JevResponse> => {
    const answers: Record<string, unknown> = {};
    for (const [id, question] of Object.entries(request.questions)) {
      if (question.type === "noul") answers[id] = { type: "noul", noul: 0.9 };
      else if (question.type === "score") answers[id] = { type: "score", score: question.criteria.length - 1 };
      else answers[id] = { type: "choice", choice: Object.keys(question.criteria as Record<string, string>)[0] };
    }
    return { model: "fake/jev", answers } as JevResponse;
  };
  return { evaluateFn };
}

/** A task whose ONE criterion targets two sections: the shape research.json's probes have. */
function project(ws: Workspace): void {
  writeFlow(ws, "learn", [
    {
      id: "make",
      capabilities: ["artifact.write", "emit", "evaluate"],
      schema: SCHEMA,
      goal: "make the artifact",
      requires: [{ section: "findings", required: ["text"] }, { section: "sources", minItems: 1 }],
      quality: {
        threshold: 0.6,
        policy: "required",
        dimensions: [
          {
            id: "grounded",
            statement: "every claim is tied to a source",
            probes: [
              {
                id: "cited",
                type: "noul",
                instructions: "Is every claim in the findings tied to a named source?",
                sections: ["findings", "sources"],
              },
            ],
          },
        ],
      },
    },
  ]);
}

const call = (ws: Workspace, args: unknown): Promise<PiToolResult> =>
  executePraxisTool(args, fakeContext({ cwd: ws.root, sessionId: SESSION }));
const bag = (result: PiToolResult): any => result.details;

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
    setScorerForTest(undefined);
    setAlignJudgeForTest(undefined);
    dispose(ws);
  };
}

test("a verdict whose diagnosis carries sections still builds a valid step descriptor", async () => {
  const ws = workspace();
  project(ws);
  const restore = useWorkspace(ws);
  try {
    setAlignJudgeForTest(fakeAlignJudge("aligned"));
    setScorerForTest(jevScorer({ evaluateFn: answerEverything().evaluateFn }));

    const started = bag(await call(ws, { op: "start", flow: "flows/learn", order: "make the artifact", requestId: "diag" }));
    assert.equal(started.code, undefined, JSON.stringify(started).slice(0, 300));
    const run = { instance: started.result.instanceId as string, nonce: started.nonce as string };

    const accepted = bag(
      await call(ws, {
        op: "submit",
        instance: run.instance,
        artifact: { schema: SCHEMA, nonce: run.nonce, findings: { text: "a claim" }, sources: [{ source: "s", location: "1" }] },
      }),
    );

    // THE REGRESSION: before the mirror fix this was `RESULT_INVALID: step descriptor is invalid`
    // with path brief.quality.judgment.dimensions.0.diagnosis.0 and message 'Unrecognized keys: "sections"'.
    assert.equal(accepted.code, undefined, "the descriptor must build: " + JSON.stringify(accepted).slice(0, 400));

    // The scored verdict really did record the target the scorer writes.
    const verdict = eventsOf(ws, run.instance).find((event) => event.type === "quality.verdict")?.payload as
      | { dimensions: { id: string; diagnosis?: { probe: string; sections?: string[] }[] }[] }
      | undefined;
    assert.deepEqual(verdict?.dimensions[0]?.diagnosis?.[0]?.sections, ["findings", "sources"], "the scorer wrote sections");

    // ...and the mirror carries it through to the agent.
    const judgment = accepted.step.brief.quality.judgment;
    assert.ok(judgment, "the note-owed step carries the recorded judgment");
    assert.deepEqual(
      judgment.dimensions[0].diagnosis[0].sections,
      ["findings", "sources"],
      "the descriptor mirrors the criterion's target",
    );
  } finally {
    restore();
  }
});
