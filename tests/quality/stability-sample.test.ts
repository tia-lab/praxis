/**
 * Slice 3, rubric stability (R20, R21): before a scope's first raise under an identity, one frozen
 * artifact is re-judged SAMPLE_REPEATS times, and the per-criterion agreement decides whether the
 * identity may ratchet at all. Sampling happens at the awaiting boundary, once per composition.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { SAMPLE_REPEATS, advanceEvaluated, agreeOn, sampleIfDue, type Scorer } from "../../src/quality/index.ts";
import { withStore } from "../../src/runner/engine/support.ts";
import { LEARNING_RUBRIC, clock, dispose, eventsOf, judgedFlow, learningOptions, population, sequenceScorer, startJudged, workspace, type JudgedRun, type Workspace } from "../testkit.ts";

const TASK = "tasks/make";
const QUALITY = { dimensions: LEARNING_RUBRIC, threshold: 0.6, policy: "required" as const };
const SCHEMA = "praxis.artifact.make/v1";

/** One judged pass in its own instance, WITHOUT the testkit's seeding: this file runs the sampler. */
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

const sampled = (ws: Workspace, runs: readonly JudgedRun[]) =>
  runs.flatMap((run) => eventsOf(ws, run.instance).filter((event) => event.type === "rubric.sampled"));

test("R20: samples once per task, key and version, at the boundary", async () => {
  assert.equal(SAMPLE_REPEATS, 3, "the repeat count is a code constant");
  const ws = workspace();
  try {
    judgedFlow(ws);
    const tick = clock().next;
    // One REAL pass, so the sampler has a frozen accepted artifact to re-judge.
    const run = await passInstance(ws, tick, "sample-anchor", sequenceScorer([0.95]));
    // Seed the 28 carried observations a FIRST raise needs (spec 3.6.1), so a raise is due and the
    // identity is still unsampled - which is exactly when the boundary must sample.
    const dimension = LEARNING_RUBRIC[0]!.id;
    withStore(learningOptions(ws, tick()), (store) =>
      population(store, TASK, dimension, Array.from({ length: 28 }, () => 0.95), tick()),
    );
    assert.equal(sampled(ws, [run]).length, 0, "the engine path never samples by itself (R24)");

    const options = learningOptions(ws, tick());
    const scorer = sequenceScorer([0.95]);
    const args = { options, instance: run.instance, step: "make", task: TASK, taskVersion: 1, quality: QUALITY, scorer, goal: "do make" };

    assert.equal(await sampleIfDue({ ...args, at: tick() }), true, "a due raise on an unsampled identity samples");
    assert.equal(scorer.calls, SAMPLE_REPEATS, "the frozen artifact is judged SAMPLE_REPEATS times");
    const events = sampled(ws, [run]);
    assert.equal(events.length, 1, "exactly one sample is recorded");
    const payload = events[0]!.payload as Record<string, unknown>;
    assert.equal(payload.task, TASK);
    assert.equal(payload.taskVersion, 1);
    assert.equal(payload.repeats, SAMPLE_REPEATS);
    assert.equal(typeof payload.composition, "string");
    assert.match(String(payload.artifactDigest), /^sha256:/);
    assert.equal(payload.stable, true, "identical repeat answers agree");

    // A second attempt at the same identity judges nothing: the sample is already on the record.
    assert.equal(await sampleIfDue({ ...args, at: tick() }), false, "no second sample for the same (task, key, version)");
    assert.equal(scorer.calls, SAMPLE_REPEATS, "and no further judge calls");
  } finally {
    dispose(ws);
  }
});
test("R21: agreement is per criterion, and repeat-N is the only noul signal", () => {
  const noul = { dimension: "d", criterion: "n1", type: "noul" as const };
  const choice = { dimension: "d", criterion: "c1", type: "choice" as const };
  // noul/score: the RANGE across repeats, because a noul has no distribution to spread (D13).
  assert.equal(agreeOn(noul, [0.9, 0.9, 0.9]).stable, true);
  assert.equal(agreeOn(noul, [0.9, 0.9, 0.9]).range, 0);
  const wobbly = agreeOn(noul, [0.9, 0.4, 0.7]);
  assert.equal(wobbly.stable, false, "a wide range is instability");
  assert.ok(Math.abs((wobbly.range ?? 0) - 0.5) < 1e-9);
  // choice: the frequency of the modal key.
  assert.equal(agreeOn(choice, ["clean", "clean", "clean"]).agreement, 1);
  assert.equal(agreeOn(choice, ["clean", "clean", "other"]).stable, true, "2 of 3 agrees");
  assert.equal(agreeOn(choice, ["clean", "other", "third"]).stable, false, "1 of 3 does not");
  // Fewer answers than repeats: the sample is unusable, so it can only hold a raise.
  const short = agreeOn(noul, [0.9, 0.9]);
  assert.equal(short.stable, false);
  assert.equal(short.answers.length, 2, "the evidence is kept, the verdict is unstable");
});
