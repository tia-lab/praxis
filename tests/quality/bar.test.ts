/**
 * The quantile ratchet (quantile-bars spec 3.6): a measured, twice-confirmed level per dimension.
 *
 * The FIRST raise is decided on evidence the estimate never saw - a 20-observation estimate and two
 * 4-observation confirmation halves (3.6.1, the K3 guard). Once a bar above the floor exists, the
 * STEADY rule takes the LOWER of two 20-observation halves (3.6.2). Selection is by STATE, not by n;
 * no path lowers a bar; a full window at the bar with no pass is contested, never lowered.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { EVENT } from "../../src/runner/engine/types.ts";
import { withStore } from "../../src/runner/engine/support.ts";
import { ABSOLUTE_MIN, flooredBar, quantileBars, raisesOf, recomputeBar, scanEvents } from "../../src/quality/index.ts";
import type { Quality } from "../../src/types/quality.ts";
import { dispose, learningOptions, population, raiseBar, stableSample, workspace, type Workspace } from "../testkit.ts";

const TASK = "tasks/make";
const AT = "2026-10-31T00:00:00.000Z";
const QUALITY: Quality = {
  dimensions: [{ id: "solves", statement: "it solves the stated goal" }],
  threshold: 0.6,
  policy: "required",
} as Quality;

/** Seed the population (and the steady-state sample), then run one ratchet pass. */
function ratchet(ws: Workspace, values: readonly number[], at: string = AT) {
  const options = learningOptions(ws, at);
  withStore(options, (store) => {
    population(store, TASK, "solves", values, at);
    stableSample(store, TASK, QUALITY, at);
  });
  const decisions = withStore(options, (store) => recomputeBar(store, TASK, 1, QUALITY, at));
  const raises = withStore(options, (store) => raisesOf(store, TASK));
  const contested = withStore(options, (store) => scanEvents(store, [EVENT.barContested]));
  const bars = withStore(options, (store) => quantileBars(store, TASK, QUALITY));
  return { decisions, raises, contested, bars };
}

const flat = (value: number, count = 20): number[] => Array.from({ length: count }, () => value);

test("the first raise needs evidence the estimate never saw: 20 easy + 8 weak writes nothing", () => {
  const ws = workspace();
  try {
    // The estimate says 0.9; the eight observations that follow are weak, so both halves fail support.
    const { decisions, raises } = ratchet(ws, [...flat(0.9), ...flat(0.4, 8)]);
    assert.deepEqual(raises, [], "an easy batch alone cannot lock a first bar (K3)");
    assert.equal(decisions[0]!.kind, "held");
  } finally {
    dispose(ws);
  }
});

test("the first raise lands when both confirmation halves support the candidate", () => {
  const ws = workspace();
  try {
    // 3 of 4 at or above the candidate in each half: one below is tolerated at p25.
    const { raises } = ratchet(ws, [...flat(0.9), 0.9, 0.9, 0.9, 0.4, 0.9, 0.9, 0.9, 0.4]);
    assert.equal(raises.length, 1, "one confirmed first raise");
    const raise = raises[0]!;
    assert.equal(raise.from, ABSOLUTE_MIN, "the first raise starts at the floor (no seed event)");
    assert.equal(raise.to, 0.9, "it adopts the estimate's floored quantile");
    assert.equal(raise.percentile, 25, "the rank is recorded");
    assert.equal(raise.n, 28, "over the 20 + 4 + 4 window");
  } finally {
    dispose(ws);
  }
});

test("two below the candidate in a half writes nothing", () => {
  const ws = workspace();
  try {
    const { raises } = ratchet(ws, [...flat(0.9), 0.9, 0.9, 0.4, 0.4, 0.9, 0.9, 0.9, 0.9]);
    assert.deepEqual(raises, [], "one weak half is enough to refuse the first raise");
  } finally {
    dispose(ws);
  }
});

test("the steady rule takes the LOWER half, so a lucky newest batch cannot carry the bar", () => {
  const ws = workspace();
  try {
    const at = AT;
    const options = learningOptions(ws, at);
    withStore(options, (store) => raiseBar(store, TASK, "solves", 0.55, undefined, at));
    // A bar above the floor exists, so the steady rule applies even though n crosses 40.
    const { raises } = ratchet(ws, [...flat(0.6), ...flat(0.95)], at);
    const last = raises[raises.length - 1]!;
    assert.equal(last.to, 0.6, "the older half's quantile wins, not the newest");
    assert.ok(last.to! >= 0.55 + 0.02, "and it clears the step");
  } finally {
    dispose(ws);
  }
});

test("a candidate below the step writes nothing", () => {
  const ws = workspace();
  try {
    const at = AT;
    const options = learningOptions(ws, at);
    withStore(options, (store) => raiseBar(store, TASK, "solves", 0.79, undefined, at));
    const { raises } = ratchet(ws, [...flat(0.8), ...flat(0.8)], at);
    assert.equal(raises.length, 1, "only the seeded raise exists: 0.80 < 0.79 + 0.02");
  } finally {
    dispose(ws);
  }
});

test("a full window at the bar with no pass is contested, never lowered", () => {
  const ws = workspace();
  try {
    const at = AT;
    const options = learningOptions(ws, at);
    withStore(options, (store) => raiseBar(store, TASK, "solves", 0.7, undefined, at));
    const { contested, bars, raises } = ratchet(ws, flat(0.55, 40), at);
    assert.equal(contested.length, 1, "the loud signal fires once");
    assert.equal((contested[0]!.payload as { bar: number }).bar, 0.7, "at the bar that was not met");
    assert.equal(bars.perDimension.get("solves"), 0.7, "and the bar does not move: never-lower");
    assert.equal(raises.length, 1, "no raise was written");
  } finally {
    dispose(ws);
  }
});

test("no path lowers a bar, however weak the work becomes", () => {
  const ws = workspace();
  try {
    const at = AT;
    const options = learningOptions(ws, at);
    withStore(options, (store) => raiseBar(store, TASK, "solves", 0.8, undefined, at));
    const { bars } = ratchet(ws, flat(0.42, 40), at);
    assert.equal(bars.perDimension.get("solves"), 0.8, "the measured bar stands");
    for (const value of bars.perDimension.values()) assert.ok(value >= ABSOLUTE_MIN, "and never below the floor");
  } finally {
    dispose(ws);
  }
});

test("the fold is monotone: a decreasing legacy sequence cannot lower a bar", () => {
  const raises = [
    { to: 0.7, at: "2026-10-01T00:00:00.000Z" },
    { to: 0.6, at: "2026-10-02T00:00:00.000Z" },
  ];
  assert.equal(flooredBar(raises, ABSOLUTE_MIN), 0.7, "the maximum wins");
  assert.equal(flooredBar([], 0.4), ABSOLUTE_MIN, "and the floor holds when nothing was measured");
});
