/**
 * The PURE AND (quantile-bars spec 3.8, S2): a verdict passes iff EVERY dimension clears its own
 * bar, floored at 0.5. No mean, no tolerance band, no Pareto cap - and the ratchet itself needs a
 * measured population, so a fresh scope never raises.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { withStore } from "../../src/runner/engine/support.ts";
import { ABSOLUTE_MIN, FIRST_RAISE_MIN, perDimensionDecision, quantileBars, recomputeBar, raisesOf } from "../../src/quality/index.ts";
import type { Quality } from "../../src/types/quality.ts";
import { dispose, learningOptions, population, raiseBar, stableSample, workspace } from "../testkit.ts";

const TASK = "tasks/make";
const AT = "2026-10-31T00:00:00.000Z";
const RUBRIC: Quality = {
  dimensions: [
    { id: "grounded", statement: "every claim is tied to a source" },
    { id: "parsimony", statement: "every included item earns its place" },
  ],
  threshold: 0.6,
  policy: "required",
} as Quality;

const verdictOf = (...scores: [string, number][]) => scores.map(([id, score]) => ({ id, score }));

test("a scope cannot raise before its population can support a measured level", () => {
  const ws = workspace();
  try {
    const options = learningOptions(ws, AT);
    withStore(options, (store) => {
      population(store, TASK, "grounded", Array.from({ length: FIRST_RAISE_MIN - 1 }, () => 0.95), AT);
      stableSample(store, TASK, RUBRIC, AT);
    });
    const decisions = withStore(options, (store) => recomputeBar(store, TASK, 1, RUBRIC, AT));
    const raises = withStore(options, (store) => raisesOf(store, TASK));
    assert.deepEqual(raises, [], "27 observations are not enough for a first raise");
    assert.equal(decisions[0]!.kind, "warming");
  } finally {
    dispose(ws);
  }
});

test("a dimension below its own bar refuses, even when every other dimension is high", () => {
  const ws = workspace();
  try {
    const options = learningOptions(ws, AT);
    withStore(options, (store) => raiseBar(store, TASK, "grounded", 0.7));
    const bars = withStore(options, (store) => quantileBars(store, TASK, RUBRIC));
    // The mean of these two is 0.8 - above any mean bar - and the verdict still refuses.
    const decision = perDimensionDecision(verdictOf(["grounded", 0.65], ["parsimony", 0.95]), bars);
    assert.equal(decision.pass, false, "one dimension below its bar is enough");
    assert.deepEqual(decision.refused, ["grounded"]);
  } finally {
    dispose(ws);
  }
});

test("a uniformly at-floor artifact refuses: there is no mean to carry it", () => {
  const ws = workspace();
  try {
    const options = learningOptions(ws, AT);
    withStore(options, (store) => raiseBar(store, TASK, "grounded", 0.6));
    const bars = withStore(options, (store) => quantileBars(store, TASK, RUBRIC));
    const decision = perDimensionDecision(verdictOf(["grounded", ABSOLUTE_MIN], ["parsimony", ABSOLUTE_MIN]), bars);
    assert.equal(decision.pass, false);
    assert.deepEqual(decision.refused, ["grounded"], "parsimony sits exactly at the floor and passes");
  } finally {
    dispose(ws);
  }
});

test("the floor is absolute: nothing below 0.5 passes, and nothing above the bar refuses", () => {
  const bars = { perDimension: new Map<string, number>() };
  assert.equal(perDimensionDecision(verdictOf(["grounded", 0.49]), bars).pass, false, "below the floor");
  assert.equal(perDimensionDecision(verdictOf(["grounded", ABSOLUTE_MIN]), bars).pass, true, "at the floor");
  assert.equal(perDimensionDecision(verdictOf(["grounded", 0.51]), { perDimension: new Map([["grounded", 0.5]]) }).pass, true);
  assert.equal(perDimensionDecision(verdictOf(["grounded", 0.51]), { perDimension: new Map([["grounded", 0.52]]) }).pass, false);
});

test("the gate reads the MEASURED bar per dimension, so two dimensions differ", () => {
  const ws = workspace();
  try {
    const options = learningOptions(ws, AT);
    withStore(options, (store) => raiseBar(store, TASK, "grounded", 0.8));
    const bars = withStore(options, (store) => quantileBars(store, TASK, RUBRIC));
    const decision = perDimensionDecision(verdictOf(["grounded", 0.75], ["parsimony", 0.55]), bars);
    assert.deepEqual(decision.refused, ["grounded"], "the raised dimension refuses; the floored one passes");
  } finally {
    dispose(ws);
  }
});
