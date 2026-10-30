/**
 * Slice 1 of the per-dimension bars: the NO-MEDIOCRITY GATE. Warmup, independent per-scope
 * ratcheting, and the compound acceptance — every dimension within its 5-point tolerance band AND
 * the MEAN at the HARD global bar. A fake scorer drives every case: no network.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { DIMENSION_TOLERANCE, WARMUP_MIN, effectiveBarsFor } from "../../src/quality/index.ts";
import { isAppError, type AppError } from "../../src/types/errors.ts";
import type { Quality } from "../../src/types/schema.ts";
import {
  JUDGED_SCHEMA,
  clock,
  dimensionScorer,
  dispose,
  eventsOf,
  learningOptions,
  startJudged,
  submitJudged,
  workspace,
  writeFlow,
  type JudgedRun,
  type Workspace,
} from "../testkit.ts";

const TASK = "tasks/make";

/** One dimension that can ratchet high, and two that deliberately hold the MEAN down. */
const RUBRIC = [
  { id: "solves", statement: "it solves the stated goal", floor: 0.6 },
  { id: "evidence", statement: "every claim carries evidence", floor: 0.6 },
  { id: "trace", statement: "the reasoning traces back to its sources", floor: 0.6 },
];
const QUALITY: Quality = { dimensions: RUBRIC, threshold: 0.6, policy: "required" };

/** A flow whose single judged step declares explicit per-dimension floors. */
function compoundFlow(ws: Workspace): void {
  writeFlow(ws, "learn", [
    {
      id: "make",
      capabilities: ["artifact.write", "emit", "evaluate"],
      schema: JUDGED_SCHEMA,
      quality: { dimensions: RUBRIC, threshold: 0.6, policy: "required" },
    },
  ]);
}

/** One instance, one attempt, scored per dimension. Returns the typed refusal if there was one. */
async function submit(ws: Workspace, tick: () => string, requestId: string, frame: Record<string, number>): Promise<AppError | undefined> {
  const run: JudgedRun = startJudged(ws, requestId, tick());
  try {
    await submitJudged(ws, run, tick(), 1, dimensionScorer([frame]));
    return undefined;
  } catch (error) {
    assert.ok(isAppError(error), "a refusal is a typed AppError");
    return error;
  }
}

const raisedScopes = (ws: Workspace, runs: readonly JudgedRun[]): Array<Record<string, unknown>> =>
  runs.flatMap((run) => eventsOf(ws, run.instance).filter((event) => event.type === "bar.raised").map((event) => event.payload as Record<string, unknown>));

test("warmup: fewer than ten observations never raise any scope", async () => {
  const ws = workspace();
  try {
    compoundFlow(ws);
    const tick = clock().next;
    const runs: JudgedRun[] = [];
    for (let index = 1; index < WARMUP_MIN; index += 1) {
      runs.push(startJudged(ws, "warm-" + index, tick()));
      await submitJudged(ws, runs[runs.length - 1], tick(), 1, dimensionScorer([{ solves: 0.95, evidence: 0.95, trace: 0.95 }]));
    }
    assert.equal(raisedScopes(ws, runs).length, 0, "nine stable, high observations raise nothing");
    const bars = effectiveBarsFor(learningOptions(ws, tick()), TASK, QUALITY);
    assert.equal(bars.global, 0.6, "the global bar still sits at its seed");
    assert.equal(bars.perDimension.get("solves"), 0.6, "and so does every dimension");

    // The tenth observation is the one that may finally act.
    const tenth = startJudged(ws, "warm-10", tick());
    runs.push(tenth);
    await submitJudged(ws, tenth, tick(), 1, dimensionScorer([{ solves: 0.95, evidence: 0.95, trace: 0.95 }]));
    assert.equal(raisedScopes(ws, runs).length, 4, "at the warmup boundary every scope may raise");
  } finally {
    dispose(ws);
  }
});

test("a per-dimension bar ratchets on its own, without lifting the global MEAN bar", async () => {
  const ws = workspace();
  try {
    compoundFlow(ws);
    const tick = clock().next;
    const runs: JudgedRun[] = [];
    // One strong dimension, two that sit exactly on their floor: the MEAN headroom is only ~0.117,
    // under the 0.12 gate, while solves has ~0.35.
    for (let index = 1; index <= WARMUP_MIN; index += 1) {
      const run = startJudged(ws, "split-" + index, tick());
      runs.push(run);
      await submitJudged(ws, run, tick(), 1, dimensionScorer([{ solves: 0.95, evidence: 0.6, trace: 0.6 }]));
    }
    const raised = raisedScopes(ws, runs);
    assert.deepEqual(raised.map((payload) => payload.scope), ["solves"], "only the strong dimension moves");
    assert.equal(raised[0].from, 0.6);
    assert.equal(raised[0].to, 0.65);

    const bars = effectiveBarsFor(learningOptions(ws, tick()), TASK, QUALITY);
    assert.equal(bars.perDimension.get("solves"), 0.65, "solves earned its own bar");
    assert.equal(bars.perDimension.get("evidence"), 0.6, "evidence is untouched");
    assert.equal(bars.global, 0.6, "the MEAN bar did not move");
  } finally {
    dispose(ws);
  }
});

/** Seed the state the compound cases need: solves' own bar ratcheted to 0.65, global still 0.60. */
async function seedSplit(ws: Workspace, tick: () => string): Promise<void> {
  compoundFlow(ws);
  for (let index = 1; index <= WARMUP_MIN; index += 1) {
    const run = startJudged(ws, "seed-" + index, tick());
    await submitJudged(ws, run, tick(), 1, dimensionScorer([{ solves: 0.95, evidence: 0.6, trace: 0.6 }]));
  }
}

test("compound: a dimension below its own ratcheted bar refuses even when the mean is high", async () => {
  const ws = workspace();
  try {
    const tick = clock().next;
    await seedSplit(ws, tick);
    // solves is 0.06 under its 0.65 bar: past the 5-point band, so it is a HARD refuse, even though
    // the other two dimensions are excellent and the mean (0.83) clears the global bar easily.
    const refused = await submit(ws, tick, "below-band", { solves: 0.59, evidence: 0.95, trace: 0.95 });
    assert.ok(refused, "the artifact is refused");
    assert.equal(refused.code, "QUALITY_BELOW_THRESHOLD");
    const compound = (refused.detail as { compound: { mean: number; refused: string[]; flagged: string[] } }).compound;
    assert.deepEqual(compound.refused, ["solves"], "the diagnostic names the dimension past its own band");
    assert.ok(compound.mean > 0.8, "and reports the mean that was nevertheless high: " + compound.mean);
  } finally {
    dispose(ws);
  }
});

test("compound: a dimension inside the 5-point band passes but is FLAGGED", async () => {
  const ws = workspace();
  try {
    const tick = clock().next;
    await seedSplit(ws, tick);
    // solves is 0.03 under its bar: inside the band, so the GATE passes it — and records the flag.
    const run = startJudged(ws, "in-band", tick());
    const advanced = await submitJudged(ws, run, tick(), 1, dimensionScorer([{ solves: 0.62, evidence: 0.95, trace: 0.95 }]));
    assert.equal(advanced.result.status, "running", "the artifact was accepted");

    const verdict = eventsOf(ws, run.instance).find((event) => event.type === "quality.verdict")?.payload as
      | { decision: string; score: number; mean: number; flagged: string[] }
      | undefined;
    assert.ok(verdict, "the verdict is recorded");
    assert.equal(verdict.decision, "pass");
    assert.equal(verdict.score, 0.62, "MIN stays the headline score");
    assert.equal(verdict.mean, 0.84, "the MEAN is recorded alongside it");
    assert.deepEqual(verdict.flagged, ["solves"], "the band pass is flagged, and only it");
    assert.equal(verdict.score <= verdict.mean, true);
  } finally {
    dispose(ws);
  }
});

test("compound: a uniformly-at-floor artifact refuses on the HARD mean gate", async () => {
  const ws = workspace();
  try {
    compoundFlow(ws); // no history: every bar sits at 0.60
    const tick = clock().next;
    // Every dimension sits exactly 0.05 under its bar: each one is inside the tolerance band, so no
    // dimension refuses — and the artifact still fails, because the MEAN has no tolerance at all.
    const refused = await submit(ws, tick, "uniform", { solves: 0.55, evidence: 0.55, trace: 0.55 });
    assert.ok(refused, "the artifact is refused");
    assert.equal(refused.code, "QUALITY_BELOW_THRESHOLD");
    const compound = (refused.detail as { compound: { mean: number; refused: string[]; flagged: string[] } }).compound;
    assert.deepEqual(compound.refused, [], "no dimension failed its own band");
    assert.deepEqual(compound.flagged, ["solves", "evidence", "trace"], "every dimension passed only by the band");
    assert.equal(compound.mean, 0.55, "the mean is reported");
    assert.ok(compound.mean < 0.6, "and it is under the HARD global bar, so the gate refuses on the mean alone");
    assert.equal(DIMENSION_TOLERANCE, 0.05);
  } finally {
    dispose(ws);
  }
});
