/**
 * Slice 3, the hold (R22-R24): a bar may not ratchet on a rubric identity nobody has sampled. The
 * raise is HELD and recorded - never the step - and a caller that never samples never raises.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { advanceEvaluated, compositionKey, recordRubricSample, type Scorer } from "../../src/quality/index.ts";
import { BarRaisedSchema } from "../../src/types/learning.ts";
import { parseWith } from "../../src/types/schema.ts";
import {
  LEARNING_RUBRIC,
  clock,
  dispose,
  eventsOf,
  judgedFlow,
  learningOptions,
  sequenceScorer,
  startJudged,
  workspace,
  type JudgedRun,
  type Workspace,
} from "../testkit.ts";

const TASK = "tasks/make";
const SCHEMA = "praxis.artifact.make/v1";
const QUALITY = { dimensions: LEARNING_RUBRIC, threshold: 0.6, policy: "required" as const };

/** One judged pass in its own instance: ten instances are the ten observations a raise needs. */
async function passInstance(ws: Workspace, tick: () => string, requestId: string, scorer: Scorer): Promise<JudgedRun> {
  const run = startJudged(ws, requestId, tick());
  await advanceEvaluated({
    ...learningOptions(ws, tick()),
    instance: run.instance,
    actor: "a",
    artifact: { schema: SCHEMA, nonce: run.nonce, attempt: 1 },
    scorer,
  });
  return run;
}

const ofType = (ws: Workspace, runs: readonly JudgedRun[], type: string) =>
  runs
    .flatMap((run) => eventsOf(ws, run.instance))
    .filter((event) => event.type === type)
    .map((event) => event.payload as Record<string, unknown>);

test("R22: a due raise without a sample is held, and the step still accepts", async () => {
  const ws = workspace();
  try {
    judgedFlow(ws);
    const tick = clock().next;
    const runs: JudgedRun[] = [];
    for (let index = 1; index <= 10; index += 1) runs.push(await passInstance(ws, tick, "hold-" + index, sequenceScorer([0.95])));

    assert.deepEqual(ofType(ws, runs, "bar.raised"), [], "no raise on an unsampled identity");
    const held = ofType(ws, runs, "bar.held");
    assert.ok(held.length >= 1, "the hold is recorded, not silent");
    assert.equal(held[0]!.task, TASK);
    assert.equal(held[0]!.reason, "no rubric sample");
    assert.equal(typeof held[0]!.from, "number");
    assert.equal(typeof held[0]!.to, "number");
    // The step itself was untouched: every pass was accepted, nothing failed over the hold.
    assert.equal(ofType(ws, runs, "artifact.accepted").length, 10, "ten accepted artifacts");
    assert.equal(ofType(ws, runs, "instance.failed").length, 0);
  } finally {
    dispose(ws);
  }
});

test("R23: a raise records its stability, and an old raise still folds", async () => {
  const ws = workspace();
  try {
    judgedFlow(ws);
    const tick = clock().next;
    const first = await passInstance(ws, tick, "stable-first", sequenceScorer([0.95]));
    // A stable sample for this composition, recorded the way the sampler records it.
    recordRubricSample({
      options: learningOptions(ws, tick()),
      instance: first.instance,
      sample: {
        task: TASK,
        taskVersion: 1,
        scope: "global",
        key: compositionKey(QUALITY as never),
        composition: compositionKey(QUALITY as never),
        artifactDigest: "sha256:" + "1".repeat(64),
        repeats: 3,
        criteria: [{ dimension: "solves", criterion: "n1", type: "noul", stable: true, range: 0, answers: [0.9, 0.9, 0.9] }],
        stable: true,
      },
      at: tick(),
    });
    const runs = [first];
    for (let index = 2; index <= 10; index += 1) runs.push(await passInstance(ws, tick, "stable-" + index, sequenceScorer([0.95])));

    const raises = ofType(ws, runs, "bar.raised");
    assert.ok(raises.length >= 1, "with a stable sample the raise lands");
    const stability = raises[0]!.stability as Record<string, unknown> | undefined;
    assert.ok(stability, "the raise carries its evidence");
    assert.equal(stability!.repeats, 3);
    assert.equal(stability!.stable, true);
    assert.equal((stability!.criteria as unknown[]).length, 1);

    // A raise recorded before this slice (no stability) still parses and folds.
    const legacy = {
      task: TASK,
      taskVersion: 1,
      scope: "global",
      key: compositionKey(QUALITY as never),
      from: 0.6,
      to: 0.65,
      window: { passes: [0.9, 0.9, 0.9, 0.9, 0.9], lowerQuartile: 0.9, margin: 0.3, stdev: 0, meanAttempts: 1 },
      formulaId: "praxis.bar.ema/v3",
      at: tick(),
    };
    assert.equal(parseWith(BarRaisedSchema, legacy, "STORE_INVALID", "legacy raise").to, 0.65);
  } finally {
    dispose(ws);
  }
});

test("R24: the ratchet judges nothing itself, and a non-sampling caller never raises", async () => {
  const ws = workspace();
  try {
    judgedFlow(ws);
    const tick = clock().next;
    const scorer = sequenceScorer([0.95]);
    const runs: JudgedRun[] = [];
    for (let index = 1; index <= 10; index += 1) runs.push(await passInstance(ws, tick, "cli-" + index, scorer));
    // One judge call per pass: the ratchet that ran inside the transaction called none.
    assert.equal(scorer.calls, 10, "ten passes, ten judge calls, zero from the ratchet");
    assert.equal(ofType(ws, runs, "rubric.sampled").length, 0, "a non-sampling caller records no sample");
    assert.equal(ofType(ws, runs, "bar.raised").length, 0, "and therefore raises nothing: delayed, never lowered");
    // The hold is written by the ratchet itself, in the same call that judged the pass.
    const events = runs[runs.length - 1]!;
    const tail = eventsOf(ws, events.instance).map((event) => event.type);
    assert.ok(tail.indexOf("bar.held") > tail.indexOf("quality.verdict"), "the hold follows the verdict it did not change");
  } finally {
    dispose(ws);
  }
});
