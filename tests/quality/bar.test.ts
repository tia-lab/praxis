/**
 * The adaptive bar (O2, task-level). A fake scorer drives every case, so nothing reaches the
 * network; each pass is a real instance of a real judged flow, so the window is computed from the
 * same events production writes. Proves: a stable high window raises by +0.01..+0.05, a noisy or
 * high-effort window does not, the cooldown spaces raises a full window apart, the ceiling and the
 * authored min_floor hold, and a zero-pass window under a raised bar emits `bar.contested` instead
 * of silently lowering the bar.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { BAR_FORMULA_ID, BAR_WINDOW, effectiveBarFor } from "../../src/quality/index.ts";
import { advance } from "../../src/runner/engine/index.ts";
import { isAppError } from "../../src/types/errors.ts";
import type { Quality } from "../../src/types/schema.ts";
import {
  JUDGED_SCHEMA,
  LEARNING_RUBRIC,
  clock,
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

function contestedFrom(ws: Workspace, runs: readonly JudgedRun[]): Array<Record<string, unknown>> {
  return runs.flatMap((run) => eventsOf(ws, run.instance).filter((event) => event.type === "bar.contested").map((event) => event.payload as Record<string, unknown>));
}

const barNow = (ws: Workspace, quality: Quality = QUALITY): number =>
  effectiveBarFor(learningOptions(ws, "2026-10-29T23:00:00.000Z"), TASK, 1, quality);

test("a stable high window raises the bar by a small, earned step", async () => {
  const ws = workspace();
  try {
    judgedFlow(ws);
    const tick = clock().next;
    const runs: JudgedRun[] = [];
    for (let index = 1; index <= BAR_WINDOW; index += 1) {
      runs.push(await runInstance(ws, tick, "stable-" + index, [0.95]));
    }
    const raises = raisesFrom(ws, runs);
    assert.equal(raises.length, 1, "one raise for one qualifying window");
    const raise = raises[0];
    assert.equal(raise.from, 0.6);
    assert.equal(raise.to, 0.65, "a large headroom caps the step at +0.05");
    assert.equal(raise.formulaId, BAR_FORMULA_ID);
    assert.equal(raise.task, TASK);
    assert.equal(raise.taskVersion, 1);
    const window = raise.window as { passes: number[]; lowerQuartile: number; margin: number; stdev: number; meanAttempts: number };
    assert.deepEqual(window.passes, [0.95, 0.95, 0.95, 0.95, 0.95]);
    assert.equal(window.lowerQuartile, 0.95);
    assert.equal(window.margin, 0.35);
    assert.equal(window.stdev, 0);
    assert.equal(window.meanAttempts, 1);
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

test("a modest headroom nudges the bar by the smallest earned step", async () => {
  const ws = workspace();
  try {
    judgedFlow(ws);
    const tick = clock().next;
    const runs: JudgedRun[] = [];
    for (let index = 1; index <= BAR_WINDOW; index += 1) {
      runs.push(await runInstance(ws, tick, "modest-" + index, [0.74]));
    }
    const raises = raisesFrom(ws, runs);
    assert.equal(raises.length, 1);
    assert.equal(raises[0].from, 0.6);
    assert.equal(raises[0].to, 0.61, "step = 0.5 * (margin - 0.12) = 0.01");
    assert.equal(barNow(ws), 0.61);
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
    for (let index = 1; index <= BAR_WINDOW; index += 1) {
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

test("a noisy window does not raise the bar", async () => {
  const ws = workspace();
  try {
    judgedFlow(ws);
    const tick = clock().next;
    const runs: JudgedRun[] = [];
    const scores = [0.95, 0.62, 0.99, 0.65, 0.97];
    for (let index = 0; index < scores.length; index += 1) {
      runs.push(await runInstance(ws, tick, "noisy-" + index, [scores[index]]));
    }
    assert.equal(raisesFrom(ws, runs).length, 0, "one lucky high score cannot lift the bar");
    assert.equal(barNow(ws), 0.6);
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
    for (let index = 1; index <= BAR_WINDOW * 2; index += 1) {
      runs.push(await runInstance(ws, tick, "cooldown-" + index, [0.95]));
    }
    const raises = raisesFrom(ws, runs);
    assert.equal(raises.length, 2, "two windows, two raises");
    assert.deepEqual(
      raises.map((raise) => [raise.from, raise.to]),
      [
        [0.6, 0.65],
        [0.65, 0.7],
      ],
    );
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
    for (let index = 1; index <= BAR_WINDOW; index += 1) {
      runs.push(await runInstance(ws, tick, "raise-" + index, [0.95]));
    }
    assert.equal(barNow(ws), 0.65);

    // Three terminal continued failures under the new bar: six attempts, no pass at all.
    for (let index = 0; index < 3; index += 1) {
      runs.push(await runInstance(ws, tick, "fail-" + index, [0.3, 0.2]));
    }
    const contested = contestedFrom(ws, runs);
    assert.equal(contested.length, 1, "one loud signal for the zero-pass window");
    assert.equal(contested[0].bar, 0.65);
    assert.equal(contested[0].task, TASK);
    assert.match(String(contested[0].reason), /yielded no pass/);
    assert.equal(raisesFrom(ws, runs).length, 1, "a contest never raises or lowers the bar");
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
