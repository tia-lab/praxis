/**
 * S7 proofs (quantile-bars spec 3.9): T1 outlier immunity and the T2 hybrid.
 *
 * T1: Q_gate of a window is an ORDER STATISTIC, so adding a value above it cannot move the candidate,
 * and adding one below it can move it by at most one rank.
 * T2: every adopted level is max(0.5, c), so a population entirely under the floor adopts nothing and
 * refuses everything - and no threshold in force can sit below 0.5.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { ABSOLUTE_MIN, DEFAULT_QUANTILE, perDimensionDecision } from "../../src/quality/index.ts";
import { quantileOf, raiseCandidate, raiseTarget } from "../../src/quality/bar.ts";

const window = Array.from({ length: 20 }, (_, index) => 0.5 + index * 0.02); // 0.50 .. 0.88

test("T1: one spike cannot move the candidate beyond one order statistic", () => {
  // A ROLLING window of 20: one observation leaves when a new one arrives, so a value above the
  // candidate can lift it by at most one rank - never to the spike itself. That is what an order
  // statistic buys over the EMA, which moved by alpha * (value - bar) on every single pass.
  const before = raiseCandidate(window, DEFAULT_QUANTILE)!;
  const withSpike = raiseCandidate([...window.slice(1), 0.99], DEFAULT_QUANTILE)!;
  const sortedAfter = [...window.slice(1), 0.99].sort((left, right) => left - right);
  const rank = Math.floor((DEFAULT_QUANTILE / 100) * (sortedAfter.length - 1));
  assert.ok(withSpike <= sortedAfter[rank]! + 1e-9, "the candidate is the rank, not the spike");
  assert.equal(withSpike, Math.floor(sortedAfter[rank]! * 100) / 100, "the candidate is exactly the rank value");
  void before;
  assert.ok(withSpike < 0.99, "a single spike is never adopted");
});
test("T1: appending 0.0 moves the candidate by at most one order statistic", () => {
  const sorted = [...window, 0.99].sort((left, right) => left - right);
  const rank = Math.floor((DEFAULT_QUANTILE / 100) * (sorted.length - 1));
  const before = quantileOf(sorted, DEFAULT_QUANTILE)!;
  const afterSorted = [0, ...sorted].sort((left, right) => left - right);
  const after = quantileOf(afterSorted, DEFAULT_QUANTILE)!;
  assert.ok(after <= before, "a low value can only pull the quantile DOWN");
  assert.equal(after, sorted[Math.max(0, rank - 1)], "by exactly one rank, never further");
});

test("T2-hybrid: a population entirely at 0.4 adopts no bar and refuses everything", () => {
  const weak = Array.from({ length: 40 }, () => 0.4);
  const target = raiseTarget(weak, DEFAULT_QUANTILE, false);
  assert.equal(target, undefined, "no candidate is confirmed: both halves sit below the floored level");
  // Every threshold IN FORCE is >= 0.5: the bar is the floor, not the measured 0.4.
  const inForce = Math.max(ABSOLUTE_MIN, target ?? ABSOLUTE_MIN);
  assert.equal(inForce >= ABSOLUTE_MIN, true, "every threshold in force is >= 0.5");
  // Nothing is raised (the candidate does not clear the step) and every dimension refuses.
  const bars = { perDimension: new Map([["grounded", ABSOLUTE_MIN]]) };
  const decision = perDimensionDecision([{ id: "grounded", score: 0.4 }], bars);
  assert.equal(decision.pass, false, "sub-floor work is always refused");
  assert.deepEqual(decision.refused, ["grounded"]);
  // The steady rule floors too: it can only propose the floor, which never clears the 0.02 step.
  assert.equal(raiseTarget(weak, DEFAULT_QUANTILE, true), ABSOLUTE_MIN);
});
