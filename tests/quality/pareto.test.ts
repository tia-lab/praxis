/**
 * No Pareto cap (quantile-bars S2): the measured bar cannot creep above the level work reaches,
 * because it IS a quantile of that work - so the cap has nothing left to do. A bar above 0.8 is
 * enforced like any other, and the authored `paretoThreshold` is deprecated (ignored).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { withStore } from "../../src/runner/engine/support.ts";
import { perDimensionDecision, quantileBars } from "../../src/quality/index.ts";
import type { Quality } from "../../src/types/quality.ts";
import { dispose, learningOptions, raiseBar, workspace } from "../testkit.ts";

const TASK = "tasks/make";
const AT = "2026-10-31T00:00:00.000Z";
const RUBRIC: Quality = {
  dimensions: [{ id: "grounded", statement: "every claim is tied to a source" }],
  threshold: 0.9,
  policy: "required",
} as Quality;

const decide = (bars: { perDimension: ReadonlyMap<string, number> }, score: number) =>
  perDimensionDecision([{ id: "grounded", score }], bars);

test("a bar above 0.8 is enforced: there is no cap", () => {
  const ws = workspace();
  try {
    const options = learningOptions(ws, AT);
    withStore(options, (store) => raiseBar(store, TASK, "grounded", 0.86));
    const bars = withStore(options, (store) => quantileBars(store, TASK, RUBRIC));
    assert.equal(bars.perDimension.get("grounded"), 0.86, "the measured level stands");
    assert.equal(decide(bars, 0.84).pass, false, "0.84 does not clear 0.86");
    assert.equal(decide(bars, 0.86).pass, true, "0.86 does");
  } finally {
    dispose(ws);
  }
});

test("an authored threshold is ignored: only the measured bar decides", () => {
  const ws = workspace();
  try {
    const options = learningOptions(ws, AT);
    // This rubric declares threshold 0.9. With no raise the bar in force is the floor, 0.5.
    const bars = withStore(options, (store) => quantileBars(store, TASK, RUBRIC));
    assert.equal(bars.perDimension.get("grounded"), 0.5, "the authored threshold sets nothing");
    assert.equal(decide(bars, 0.6).pass, true, "so work above the floor passes");
  } finally {
    dispose(ws);
  }
});

test("two tasks with different authored thresholds produce the same bars", () => {
  const ws = workspace();
  try {
    const options = learningOptions(ws, AT);
    const strict = { ...RUBRIC, threshold: 0.95 } as Quality;
    const loose = { ...RUBRIC, threshold: 0.1 } as Quality;
    const a = withStore(options, (store) => quantileBars(store, TASK, strict));
    const b = withStore(options, (store) => quantileBars(store, TASK, loose));
    assert.deepEqual([...a.perDimension], [...b.perDimension], "the authored value has no effect");
  } finally {
    dispose(ws);
  }
});
