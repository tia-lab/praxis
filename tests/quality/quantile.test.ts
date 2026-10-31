/**
 * S1 — the quantile machinery, additive (quantile-bars spec 3.1-3.7).
 *
 * Nothing here is wired to a decision yet: the functions are the population read, the quantile, the
 * floored candidate and the monotone fold. The old gate keeps running untouched, which is why every
 * pre-existing assertion still holds.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { appendEvent } from "../../src/store/events.ts";
import { insertInstance } from "../../src/store/instance.ts";
import { withStore } from "../../src/runner/engine/support.ts";
import { ABSOLUTE_MIN, DEFAULT_QUANTILE, HALF_WINDOW, QUANTILE_FORMULA_ID, QUANTILE_WINDOW, RAISE_STEP, CALIBRATION_MIN } from "../../src/runner/engine/types.ts";
import { EVENT } from "../../src/runner/engine/types.ts";
import { barAt, dimensionKey, flooredBar, quantileBars } from "../../src/quality/scope.ts";
import { carriedPopulation, quantileOf, raiseCandidate } from "../../src/quality/bar.ts";
import type { Quality } from "../../src/types/quality.ts";
import { clock, dispose, learningOptions, workspace, type Workspace } from "../testkit.ts";

/** Instance ids must parse: the store validates them (i + 32 hex). */
const IA = "i" + "a".repeat(32);
const IB = "i" + "b".repeat(32);
const IC = "i" + "c".repeat(32);
const ID = "i" + "d".repeat(32);
const I1 = "i" + "1".repeat(32);
/** The event table has a foreign key to `instance`, so a seeded log needs its instances. */
function seedInstance(store: Parameters<Parameters<typeof withStore>[1]>[0], id: string, at: string): void {
  insertInstance(store, { id, flow: "flows/research", actor: "a", status: "running", currentStep: "draft", nonce: id.slice(1), now: at });
}
const TASK = "tasks/research";
const QUALITY: Quality = {
  dimensions: [
    { id: "grounded", statement: "every claim is tied to a source" },
    { id: "parsimony", statement: "every included item earns its place" },
  ],
  threshold: 0.6,
  policy: "required",
} as Quality;

const storeOf = <T>(ws: Workspace, at: string, body: (store: Parameters<Parameters<typeof withStore>[1]>[0]) => T): T =>
  withStore(learningOptions(ws, at), body);

/** One verdict event for an instance, as the engine records it. */
function verdict(store: Parameters<Parameters<typeof withStore>[1]>[0], instance: string, at: string, version: number, scores: Record<string, number>, source = "jev"): void {
  appendEvent(store, instance, {
    type: EVENT.qualityVerdict,
    payload: {
      step: "draft",
      version,
      artifactDigest: "sha256:" + String(version).padStart(64, "a"),
      task: TASK,
      taskVersion: 7,
      decision: "pass",
      score: Math.min(...Object.values(scores)),
      dimensions: Object.entries(scores).map(([id, score]) => ({ id, score, key: dimensionKey({ id, statement: "s" }) })),
      rationale: "fake",
      rubricDigest: "sha256:" + "b".repeat(64),
      scorer: "fake/v1",
      source,
    },
    at,
  });
}

function accepted(store: Parameters<Parameters<typeof withStore>[1]>[0], instance: string, at: string, version: number, failed = false): void {
  appendEvent(store, instance, {
    type: EVENT.artifactAccepted,
    payload: {
      step: "draft",
      version,
      path: "x",
      digest: "sha256:" + String(version).padStart(64, "a"),
      schema: "praxis.artifact.research/v1",
      task: TASK,
      taskVersion: 7,
      ...(failed ? { failed: { decision: "below", score: 0.2, rubricDigest: "sha256:" + "b".repeat(64) } } : {}),
    },
    at,
  });
}

test("quantileOf is the lower definition and clamps at both ends", () => {
  const sorted = [0.1, 0.2, 0.3, 0.4, 0.5];
  assert.equal(quantileOf([], 25), undefined, "an empty population has no quantile");
  assert.equal(quantileOf(sorted, 25), 0.2, "rank floor(0.25 * 4) = 1");
  assert.equal(quantileOf(sorted, 50), 0.3, "rank floor(0.50 * 4) = 2");
  assert.equal(quantileOf(sorted, 1), 0.1, "the low end clamps to the minimum");
  assert.equal(quantileOf(sorted, 99), 0.4, "the lower definition stops below the top for p < 100");
  assert.equal(quantileOf([0.7], 25), 0.7, "one observation is its own quantile");
});

test("raiseCandidate quantizes down, floors at ABSOLUTE_MIN and cannot lower", () => {
  assert.equal(ABSOLUTE_MIN, 0.5);
  assert.equal(CALIBRATION_MIN, 20);
  assert.equal(QUANTILE_WINDOW, 40);
  assert.equal(HALF_WINDOW, 20);
  assert.equal(RAISE_STEP, 0.02);
  assert.equal(DEFAULT_QUANTILE, 25);
  assert.equal(QUANTILE_FORMULA_ID, "praxis.bar.quantile/v1");
  // A weak population is floored: the bar can never be set where good work cannot reach it.
  assert.equal(raiseCandidate([0.4, 0.4, 0.4, 0.4], 25), ABSOLUTE_MIN);
  // A strong one is its own quantile, quantized DOWN to two decimals.
  assert.equal(raiseCandidate([0.87, 0.88, 0.89, 0.9], 25), 0.87);
  assert.equal(raiseCandidate([0.666, 0.7, 0.71, 0.72], 25), 0.66, "down, never up");
  assert.equal(raiseCandidate([], 25), undefined, "nothing observed, nothing measured");
  // The percentile SELECTS a rank: a stricter rank of the same population is not a lower bar.
  const population = [0.5, 0.6, 0.7, 0.8, 0.9, 0.95];
  assert.ok(raiseCandidate(population, 50)! > raiseCandidate(population, 25)!);
});

test("the carried population is one observation per instance, from the carried version", () => {
  const ws = workspace();
  const tick = clock().next;
  try {
    storeOf(ws, tick(), (store) => {
      // Instance A: accepted v1 (0.7), then a retry v2 that was refused - the retry is NOT an observation.
      seedInstance(store, IA, tick());
      verdict(store, IA, tick(), 1, { grounded: 0.7, parsimony: 0.6 });
      accepted(store, IA, tick(), 1);
      verdict(store, IA, tick(), 2, { grounded: 0.9, parsimony: 0.95 });
      // Instance B: v1 refused, v2 accepted - the carried version is v2.
      seedInstance(store, IB, tick());
      verdict(store, IB, tick(), 1, { grounded: 0.3, parsimony: 0.3 });
      verdict(store, IB, tick(), 2, { grounded: 0.8, parsimony: 0.75 });
      accepted(store, IB, tick(), 2);
      // Instance C: a carried FAILURE (onFailure=continue) - the best-scoring version counts.
      seedInstance(store, IC, tick());
      verdict(store, IC, tick(), 1, { grounded: 0.2, parsimony: 0.55 });
      verdict(store, IC, tick(), 2, { grounded: 0.45, parsimony: 0.4 });
      accepted(store, IC, tick(), 2, true);
      // Instance D: an unavailable verdict carries no score at all.
      seedInstance(store, ID, tick());
      verdict(store, ID, tick(), 1, { grounded: 0.99, parsimony: 0.99 }, "unavailable");
      accepted(store, ID, tick(), 1);
    });
    const grounded = storeOf(ws, tick(), (store) => carriedPopulation(store, TASK, "grounded"));
    assert.deepEqual([...grounded].sort(), [0.45, 0.7, 0.8], "A: the carried v1; B: v2; C: the best version; D excluded");
    const parsimony = storeOf(ws, tick(), (store) => carriedPopulation(store, TASK, "parsimony"));
    assert.deepEqual([...parsimony].sort(), [0.4, 0.6, 0.75]);
  } finally {
    dispose(ws);
  }
});

test("the fold takes the maximum and flooredBar keeps every bar at or above the floor", () => {
  const raises = [
    { to: 0.6, at: "2026-10-01T00:00:00.000Z" },
    { to: 0.55, at: "2026-10-02T00:00:00.000Z" },
  ];
  assert.equal(barAt(raises, 0.5), 0.6, "a legacy decreasing sequence cannot lower the bar");
  assert.equal(barAt([], 0.42), 0.42, "the plain fold keeps its seed (the legacy path is untouched)");
  assert.equal(flooredBar([], 0.42), ABSOLUTE_MIN, "the gate fold is floored");
  assert.equal(flooredBar([{ to: 0.2, at: "2026-10-01T00:00:00.000Z" }], 0.5), ABSOLUTE_MIN, "even a sub-floor raise");
  assert.equal(flooredBar([{ to: 0.72, at: "2026-10-01T00:00:00.000Z" }], 0.5), 0.72);
});

test("quantileBars reads one floored bar per dimension identity", () => {
  const ws = workspace();
  const tick = clock().next;
  try {
    const groundedKey = dimensionKey(QUALITY.dimensions[0]!);
    storeOf(ws, tick(), (store) => {
      seedInstance(store, I1, tick());
      appendEvent(store, I1, {
        type: EVENT.barRaised,
        payload: {
          task: TASK,
          taskVersion: 7,
          scope: "grounded",
          key: groundedKey,
          from: ABSOLUTE_MIN,
          to: 0.68,
          percentile: 25,
          n: 24,
          formulaId: QUANTILE_FORMULA_ID,
          at: tick(),
        },
        at: tick(),
      });
    });
    const bars = storeOf(ws, tick(), (store) => quantileBars(store, TASK, QUALITY));
    assert.equal(bars.perDimension.get("grounded"), 0.68, "the measured raise is the bar");
    assert.equal(bars.perDimension.get("parsimony"), ABSOLUTE_MIN, "an unmeasured dimension sits at the floor");
    for (const value of bars.perDimension.values()) assert.ok(value >= ABSOLUTE_MIN, "no bar below the floor");
    assert.equal(bars.keys.get("grounded"), groundedKey, "the identity key travels with the bar");
  } finally {
    dispose(ws);
  }
});
