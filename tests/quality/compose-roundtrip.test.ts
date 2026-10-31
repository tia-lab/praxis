/**
 * Slice 1, round trip (R14): bound, statementScore and divergence are additive-optional on the verdict
 * and survive the read path — the recorded event, `qualityHistory`, and the brief's judgment all carry
 * the same values, so nothing is recomputed and nothing is lost.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { executePraxisTool, setAlignJudgeForTest, setScorerForTest } from "../../src/pi/tool.ts";
import type { PiToolResult } from "../../src/pi/host.ts";
import type { Scorer } from "../../src/quality/index.ts";
import { QualityVerdictSchema, parseWith } from "../../src/types/schema.ts";
import { JUDGED_SCHEMA, dispose, eventsOf, judgedFlow, workspace } from "../testkit.ts";
import { fakeAlignJudge, fakeContext } from "../pi/fixtures.ts";

const SESSION = "session-compose-roundtrip";

/** One composed dimension, judged by a fake that reports a definite bound and witness. */
function composedScorer(): Scorer {
  return {
    async score({ rubric }) {
      return {
        dimensions: rubric.map((dimension) => ({
          id: dimension.id,
          score: 0.9,
          bound: "c1",
          statementScore: 0.55,
          divergence: true,
          diagnosis: [{ probe: "c1", answer: 0.9 }],
          rationale: dimension.id + ": the draft is short",
        })),
        rationale: "fake composed",
        scorer: "fake/v1",
      };
    },
  };
}

const call = (cwd: string, args: unknown): Promise<PiToolResult> =>
  executePraxisTool(args, fakeContext({ cwd, sessionId: SESSION }));
const bag = (result: PiToolResult): any => result.details;

test("R14: bound and statementScore survive the record, the re-read and the brief", async () => {
  const ws = workspace();
  try {
    judgedFlow(ws, {
      dimensions: [
        { id: "solves", statement: "it solves the goal", floor: 0.6, probes: [{ id: "c1", type: "noul", instructions: "does it?" }] },
      ],
    });
    const priorConfig = process.env.PRAXIS_CONFIG;
    const priorStore = process.env.PRAXIS_STORE_DIR;
    process.env.PRAXIS_CONFIG = ws.config;
    process.env.PRAXIS_STORE_DIR = ws.store;
    try {
      setScorerForTest(composedScorer());
      const started = bag(await call(ws.root, { op: "start", flow: "flows/learn", order: "carry out the task this flow runs", requestId: "rt" }));
      assert.equal(started.code, undefined, JSON.stringify(started).slice(0, 300));
      const run = { instance: started.result.instanceId as string, nonce: started.nonce as string };
      const accepted = bag(await call(ws.root, { op: "submit", instance: run.instance, artifact: { schema: JUDGED_SCHEMA, nonce: run.nonce, attempt: 1 } }));
      assert.equal(accepted.code, undefined, "the submit was accepted: " + JSON.stringify(accepted).slice(0, 300));

      // The recorded event carries all three fields. The event also carries the attempt's
      // bookkeeping (step, version, artifactDigest, task), so the verdict is projected exactly as
      // `qualityHistory` reads it back.
      const payload = eventsOf(ws, run.instance).filter((event) => event.type === "quality.verdict").pop()!.payload as any;
      const verdict = parseWith(
        QualityVerdictSchema,
        {
          decision: payload.decision,
          score: payload.score,
          dimensions: payload.dimensions,
          rationale: payload.rationale,
          rubricDigest: payload.rubricDigest,
          scorer: payload.scorer,
          source: payload.source,
        },
        "STORE_INVALID",
        "recorded verdict",
      );
      assert.equal(verdict.dimensions[0]!.bound, "c1");
      assert.equal(verdict.dimensions[0]!.statementScore, 0.55);
      assert.equal(verdict.dimensions[0]!.divergence, true);

      // ...and the brief's judgment, read back through qualityHistory, carries the same values.
      const judgment = accepted.step.brief.quality.judgment;
      assert.ok(judgment, "the note-owed step carries the recorded judgment");
      assert.equal(judgment.dimensions[0].bound, "c1", "bound survives the round trip");
      assert.equal(judgment.dimensions[0].statementScore, 0.55, "the witness survives the round trip");
      assert.equal(judgment.dimensions[0].divergence, true);
    } finally {
      setScorerForTest(undefined);
      if (priorConfig === undefined) delete process.env.PRAXIS_CONFIG;
      else process.env.PRAXIS_CONFIG = priorConfig;
      if (priorStore === undefined) delete process.env.PRAXIS_STORE_DIR;
      else process.env.PRAXIS_STORE_DIR = priorStore;
    }
  } finally {
    setAlignJudgeForTest(fakeAlignJudge("aligned"));
    dispose(ws);
  }
});
