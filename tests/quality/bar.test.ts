/**
 * The adaptive bar (O2, task-level), under the EMA ratchet (ema-ratchet, spec D1-D6). A fake scorer
 * drives every case, so nothing reaches the network; each pass is a real instance of a real judged
 * flow, so the series is computed from the same events production writes. Proves: every scope - the
 * global MEAN and each dimension - moves toward the nine-period EMA of ITS OWN genuine-pass values by
 * at most +0.05, never to its best pass; a gap under 0.01 records nothing; the cooldown spaces raises
 * a full window apart; the ceiling and the authored min_floor hold; a high-effort window does not
 * raise; and a zero-pass window under a raised bar emits `bar.contested` instead of lowering the bar.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { BAR_EMA_ALPHA, BAR_EMA_PERIODS, BAR_FORMULA_ID, BAR_MIN_STEP, BAR_WINDOW, WARMUP_MIN, effectiveBarFor, emaOf } from "../../src/quality/index.ts";
import { advance } from "../../src/runner/engine/index.ts";
import { isAppError } from "../../src/types/errors.ts";
import type { Quality } from "../../src/types/schema.ts";
import {
  JUDGED_SCHEMA,
  LEARNING_RUBRIC,
  clock,
  dimensionScorer,
  dispose,
  eventsOf,
  judgedFlow,
  learningOptions,
  sequenceScorer,
  startJudged,
  submitJudged,
  workspace,
  type JudgedRun,
  type Workspace,
} from "../testkit.ts";

const TASK = "tasks/make";
const QUALITY: Quality = { dimensions: LEARNING_RUBRIC, threshold: 0.6, policy: "required" };

/**
 * Run one judged instance to its terminal outcome with the given per-attempt scores and return it.
 * The first below-floor attempts are expected to refuse; the last one must land where the case says.
 */
async function runInstance(
  ws: Workspace,
  tick: () => string,
  requestId: string,
  scores: readonly number[],
): Promise<JudgedRun> {
  const run = startJudged(ws, requestId, tick());
  const scorer = sequenceScorer(scores);
  for (let attempt = 1; attempt <= scores.length; attempt += 1) {
    try {
      await submitJudged(ws, run, tick(), attempt, scorer);
    } catch (error) {
      assert.ok(isAppError(error), "a below-floor attempt is a typed refusal");
    }
  }
  return run;
}

/** Every bar.raised event of a workspace, read from the log of each instance it could sit on. */
function raisesFrom(ws: Workspace, runs: readonly JudgedRun[]): Array<Record<string, unknown>> {
  return runs.flatMap((run) => eventsOf(ws, run.instance).filter((event) => event.type === "bar.raised").map((event) => event.payload as Record<string, unknown>));
}

/** Every raise of ONE scope (the ratchet is per scope now: global + each dimension). */
function raisesOfScope(ws: Workspace, runs: readonly JudgedRun[], scope: string): Array<Record<string, unknown>> {
  return raisesFrom(ws, runs).filter((payload) => (payload.scope ?? "global") === scope);
}

function contestedFrom(ws: Workspace, runs: readonly JudgedRun[]): Array<Record<string, unknown>> {
  return runs.flatMap((run) => eventsOf(ws, run.instance).filter((event) => event.type === "bar.contested").map((event) => event.payload as Record<string, unknown>));
}

const barNow = (ws: Workspace, quality: Quality = QUALITY): number =>
  effectiveBarFor(learningOptions(ws, "2026-10-29T23:00:00.000Z"), TASK, quality);

test("the EMA helper: alpha = 2/(N+1), seeded with the first value", () => {
  // The frozen constants and the recurrence agree by construction, not by coincidence.
  assert.equal(BAR_EMA_PERIODS, 9);
  assert.equal(BAR_EMA_ALPHA, 2 / (BAR_EMA_PERIODS + 1));
  assert.equal(BAR_EMA_ALPHA, 0.2);
  assert.equal(BAR_MIN_STEP, 0.01);
  assert.equal(emaOf([]), undefined, "no passes, no EMA");
  assert.equal(emaOf([0.42]), 0.42, "one pass is its own average");
  // A flat series keeps its level (to within float noise: the recurrence multiplies every step).
  assert.ok(Math.abs((emaOf([0.8, 0.8, 0.8]) ?? 0) - 0.8) < 1e-12, "a flat series keeps its level");
  assert.equal(emaOf([0, 1]), 0.2, "the newest value carries alpha");
  assert.equal(emaOf([0, 1, 1]), 0.2 * 1 + 0.8 * 0.2);
  // The same recurrence, computed independently from a different period count.
  assert.equal(emaOf([0, 1], 4), 0.4, "alpha follows the period count");
});

test("a stable high window raises the bar by a small, earned step", async () => {
  const ws = workspace();
  try {
    judgedFlow(ws);
    const tick = clock().next;
    const runs: JudgedRun[] = [];
    // WARMUP_MIN observations of the scope must accumulate before any scope may raise at all.
    for (let index = 1; index <= WARMUP_MIN; index += 1) {
      runs.push(await runInstance(ws, tick, "stable-" + index, [0.95]));
    }
    // One raise per scope: the global MEAN and each of the three dimensions ratchet independently.
    const sections = ["global", "solves", "evidence", "trace"];
    for (const scope of sections) {
      assert.equal(raisesOfScope(ws, runs, scope).length, 1, "one raise for one qualifying window in " + scope);
    }
    assert.equal(raisesFrom(ws, runs).length, sections.length, "no other scope moved");
    const raise = raisesOfScope(ws, runs, "global")[0];
    assert.equal(raise.from, 0.6);
    assert.equal(raise.to, 0.65, "a large headroom caps the step at +0.05");
    assert.equal(raise.formulaId, BAR_FORMULA_ID);
    assert.equal(raise.task, TASK);
    assert.equal(raise.taskVersion, 1);
    const window = raise.window as { passes: number[]; lowerQuartile: number; margin: number; stdev: number; meanAttempts: number };
    assert.deepEqual(window.passes, [0.95, 0.95, 0.95, 0.95, 0.95], "the window is the cooldown, recorded as disclosure");
    assert.equal(window.lowerQuartile, 0.95);
    assert.equal(window.margin, 0.35, "margin records the EMA gap that decided the raise");
    assert.equal(window.stdev, 0);
    assert.equal(window.meanAttempts, 1);
    const ema = raise.ema as { periods: number; alpha: number; value: number; samples: number };
    assert.equal(ema.periods, BAR_EMA_PERIODS);
    assert.equal(ema.alpha, BAR_EMA_ALPHA);
    assert.equal(ema.value, 0.95, "ten identical passes average to that level");
    assert.equal(ema.samples, WARMUP_MIN, "the EMA runs over the whole series, not over the window");
    // One rule, one formula id: no scope keeps the retired formula.
    for (const scope of sections) {
      const scoped = raisesOfScope(ws, runs, scope)[0];
      assert.equal(scoped.formulaId, BAR_FORMULA_ID, "the same formula id in " + scope);
      assert.ok(scoped.ema !== undefined, "every raise records its EMA: " + scope);
    }
    assert.equal(barNow(ws), 0.65, "the effective floor is the raised one");

    // The raised bar is what the judge now scores against: 0.62 used to pass at 0.60.
    const next = startJudged(ws, "after-raise", tick());
    await assert.rejects(
      submitJudged(ws, next, tick(), 1, sequenceScorer([0.62])),
      (error: unknown) => isAppError(error) && error.code === "QUALITY_BELOW_THRESHOLD",
    );
  } finally {
    dispose(ws);
  }
});

test("a level above the bar moves it by the capped step, not by the old quartile fraction", async () => {
  const ws = workspace();
  try {
    judgedFlow(ws);
    const tick = clock().next;
    const runs: JudgedRun[] = [];
    for (let index = 1; index <= WARMUP_MIN; index += 1) {
      runs.push(await runInstance(ws, tick, "modest-" + index, [0.74]));
    }
    // Under the retired formula this was +0.01 (0.5 * (0.14 - 0.12)); the EMA level is 0.74, a gap of
    // 0.14, so the step is the cap. The bar approaches the earned level instead of creeping at it.
    for (const scope of ["global", "solves", "evidence", "trace"]) {
      const raises = raisesOfScope(ws, runs, scope);
      assert.equal(raises.length, 1, "each scope nudges itself in " + scope);
      assert.equal(raises[0].from, 0.6);
      assert.equal(raises[0].to, 0.65, "step = min(0.05, ema - current)");
      assert.equal((raises[0].ema as { value: number }).value, 0.74);
    }
    assert.equal(barNow(ws), 0.65);
  } finally {
    dispose(ws);
  }
});

test("a pass computed under the old floor cannot sneak past the raised bar", async () => {
  const ws = workspace();
  try {
    judgedFlow(ws);
    const tick = clock().next;
    const runs: JudgedRun[] = [];
    for (let index = 1; index <= WARMUP_MIN; index += 1) {
      runs.push(await runInstance(ws, tick, "stale-" + index, [0.95]));
    }
    assert.equal(barNow(ws), 0.65);
    // A verdict that decided "pass" against the authored 0.60, handed to the engine by hand.
    const stale = {
      decision: "pass" as const,
      score: 0.62,
      dimensions: LEARNING_RUBRIC.map((dimension) => ({ id: dimension.id, score: 0.62 })),
      rationale: "judged before the raise",
      rubricDigest: "sha256:" + "1".repeat(64),
      scorer: "fake/v1",
      source: "jev" as const,
    };
    const run = startJudged(ws, "stale-verdict", tick());
    let refused: string | undefined;
    try {
      advance({ ...learningOptions(ws, tick()), instance: run.instance, actor: "a", artifact: { schema: JUDGED_SCHEMA, nonce: run.nonce, attempt: 1 }, qualityVerdict: stale });
    } catch (error) {
      assert.ok(isAppError(error), "the refusal is typed");
      refused = error.code;
    }
    assert.equal(refused, "QUALITY_BELOW_THRESHOLD", "0.62 does not pass a 0.65 floor");
  } finally {
    dispose(ws);
  }
});

test("a volatile series raises only toward its smoothed level, never to its best pass", async () => {
  const ws = workspace();
  try {
    judgedFlow(ws);
    const tick = clock().next;
    const runs: JudgedRun[] = [];
    const scores = [0.95, 0.62, 0.99, 0.65, 0.97, 0.95, 0.62, 0.99, 0.65, 0.97];
    for (let index = 0; index < scores.length; index += 1) {
      runs.push(await runInstance(ws, tick, "noisy-" + index, [scores[index]]));
    }
    const raise = raisesOfScope(ws, runs, "global")[0];
    assert.ok(raise, "a warmed, qualifying series raises once");
    // The EMA of that series is 0.8535: far above the bar, far below the 0.99 best pass.
    assert.equal((raise.ema as { value: number }).value, 0.8535, "the smoothed level, not the best pass");
    assert.equal(raise.to, 0.65, "the step cap keeps a volatile window from jumping to the EMA");
    assert.equal(raisesFrom(ws, runs).length, 4, "the global scope and its three dimensions, once each");
    assert.equal(barNow(ws), 0.65);
  } finally {
    dispose(ws);
  }
});

test("a gap under 0.01 records nothing; a gap of exactly 0.01 raises", async () => {
  const quiet = workspace();
  const borderline = workspace();
  try {
    judgedFlow(quiet);
    judgedFlow(borderline);
    const quietRuns: JudgedRun[] = [];
    const borderlineRuns: JudgedRun[] = [];
    let tick = clock().next;
    for (let index = 1; index <= WARMUP_MIN; index += 1) {
      quietRuns.push(await runInstance(quiet, tick, "quiet-" + index, [0.605]));
    }
    tick = clock().next;
    for (let index = 1; index <= WARMUP_MIN; index += 1) {
      borderlineRuns.push(await runInstance(borderline, tick, "edge-" + index, [0.61]));
    }
    // ema - current = 0.005: too close to be worth recording, so the bar does not move at all.
    assert.equal(raisesFrom(quiet, quietRuns).length, 0, "under BAR_MIN_STEP nothing is recorded");
    assert.equal(barNow(quiet), 0.6);
    // ema - current = 0.01 exactly: the smallest raise worth recording.
    assert.equal(raisesFrom(borderline, borderlineRuns).length, 4);
    assert.equal(raisesOfScope(borderline, borderlineRuns, "global")[0].to, 0.61);
    assert.equal(barNow(borderline), 0.61);
  } finally {
    dispose(quiet);
    dispose(borderline);
  }
});

test("each dimension bar tracks that dimension's OWN scores, not the mean", async () => {
  const ws = workspace();
  try {
    judgedFlow(ws);
    const tick = clock().next;
    const runs: JudgedRun[] = [];
    // One level per dimension, repeated until warmup: solves 0.66, evidence 0.62, trace 0.62,
    // so the global MEAN is 0.6333 while each dimension has its own level.
    const frame = { solves: 0.66, evidence: 0.62, trace: 0.62 };
    for (let index = 1; index <= WARMUP_MIN; index += 1) {
      const run = startJudged(ws, "split-" + index, tick());
      await submitJudged(ws, run, tick(), 1, dimensionScorer([frame]));
      runs.push(run);
    }
    const to = (scope: string): unknown => raisesOfScope(ws, runs, scope)[0].to;
    const ema = (scope: string): unknown => (raisesOfScope(ws, runs, scope)[0].ema as { value: number }).value;
    assert.equal(to("solves"), 0.65, "0.66 is 0.06 over the seed, capped at 0.05");
    assert.equal(to("evidence"), 0.62, "0.62 is 0.02 over the seed");
    assert.equal(to("trace"), 0.62);
    assert.equal(to("global"), 0.6333, "the mean level, not any single dimension");
    assert.equal(ema("solves"), 0.66);
    assert.equal(ema("evidence"), 0.62);
    assert.equal(ema("global"), 0.6333);
    assert.equal(raisesFrom(ws, runs).length, 4, "one raise per scope, no more");
  } finally {
    dispose(ws);
  }
});

test("a high-effort window does not raise the bar", async () => {
  const ws = workspace();
  try {
    judgedFlow(ws, { maxAttempts: 5 });
    const tick = clock().next;
    const runs: JudgedRun[] = [];
    for (let index = 0; index < BAR_WINDOW; index += 1) {
      runs.push(await runInstance(ws, tick, "effort-" + index, [0.2, 0.3, 0.95]));
    }
    assert.equal(raisesFrom(ws, runs).length, 0, "three attempts per pass means the bar is not too low");
    assert.equal(barNow(ws), 0.6);
  } finally {
    dispose(ws);
  }
});

test("the cooldown spaces raises a full window apart", async () => {
  const ws = workspace();
  try {
    judgedFlow(ws);
    const tick = clock().next;
    const runs: JudgedRun[] = [];
    // Warm up, earn the first raise, then a FULL window of fresh passes before the second: the
    // cooldown is measured on top of the warmup, not instead of it.
    for (let index = 1; index <= WARMUP_MIN + BAR_WINDOW; index += 1) {
      runs.push(await runInstance(ws, tick, "cooldown-" + index, [0.95]));
    }
    assert.equal(raisesFrom(ws, runs).length, 8, "two raises each for the global scope and three dimensions");
    for (const scope of ["global", "solves", "evidence", "trace"]) {
      assert.deepEqual(
        raisesOfScope(ws, runs, scope).map((raise) => [raise.from, raise.to]),
        [
          [0.6, 0.65],
          [0.65, 0.7],
        ],
        "the cooldown holds in " + scope,
      );
    }
    assert.equal(barNow(ws), 0.7);
  } finally {
    dispose(ws);
  }
});

test("a full window under the raised bar with no pass is contested, never lowered", async () => {
  const ws = workspace();
  try {
    judgedFlow(ws);
    const tick = clock().next;
    const runs: JudgedRun[] = [];
    for (let index = 1; index <= WARMUP_MIN; index += 1) {
      runs.push(await runInstance(ws, tick, "raise-" + index, [0.95]));
    }
    assert.equal(barNow(ws), 0.65);

    // Three terminal continued failures under the new bar: six attempts, no pass at all.
    for (let index = 0; index < 3; index += 1) {
      runs.push(await runInstance(ws, tick, "fail-" + index, [0.3, 0.2]));
    }
    const contested = contestedFrom(ws, runs);
    assert.equal(contested.length, 4, "one loud signal per scope for the zero-pass window");
    const globalContest = contested.find((payload) => payload.scope === "global");
    assert.ok(globalContest, "the global MEAN bar is contested");
    assert.equal(globalContest.bar, 0.65);
    assert.equal(globalContest.task, TASK);
    assert.match(String(globalContest.reason), /yielded no pass/);
    assert.equal(raisesFrom(ws, runs).length, 4, "a contest never raises or lowers a bar");
    assert.equal(barNow(ws), 0.65, "the floor stays where the ratchet put it");
  } finally {
    dispose(ws);
  }
});

test("the ceiling holds: a task authored at the ceiling never rises past it", async () => {
  const ws = workspace();
  try {
    judgedFlow(ws, { threshold: 0.9 });
    const tick = clock().next;
    const runs: JudgedRun[] = [];
    for (let index = 0; index < BAR_WINDOW; index += 1) {
      runs.push(await runInstance(ws, tick, "ceiling-" + index, [1.0]));
    }
    assert.equal(raisesFrom(ws, runs).length, 0, "0.9 plus a step would exceed the noise ceiling");
    assert.equal(barNow(ws, { ...QUALITY, threshold: 0.9 }), 0.9);
  } finally {
    dispose(ws);
  }
});

test("the authored min_floor is never undercut, even with no history at all", async () => {
  const ws = workspace();
  try {
    judgedFlow(ws, { threshold: 0.75 });
    // No raise yet, so the fold returns the authored floor exactly: it can only move upward.
    assert.equal(barNow(ws, { ...QUALITY, threshold: 0.75 }), 0.75);
    // And a window that is not yet full cannot move it: one pass is not five.
    const tick = clock().next;
    await runInstance(ws, tick, "floor-1", [0.99]);
    assert.equal(barNow(ws, { ...QUALITY, threshold: 0.75 }), 0.75);
  } finally {
    dispose(ws);
  }
});
