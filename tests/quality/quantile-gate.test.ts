/**
 * S4 — `quantileGate` (A2, spec 3.3): the one authorable strictness knob. It selects a RANK of the
 * same population - never a value - so it can move the bar between percentiles but cannot ask for a
 * level the work does not reach. `threshold`/`floor`/`paretoThreshold` stay parseable and set nothing.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { withStore } from "../../src/runner/engine/support.ts";
import { QualitySchema, parseWith, type TaskConfig } from "../../src/types/schema.ts";
import { isAppError } from "../../src/types/errors.ts";
import { ABSOLUTE_MIN, DEFAULT_QUANTILE, quantileBars, raisesOf, recomputeBar } from "../../src/quality/index.ts";
import type { Quality } from "../../src/types/quality.ts";
import { dispose, learningOptions, population, stableSample, workspace } from "../testkit.ts";

const TASK = "tasks/make";
const AT = "2026-10-31T00:00:00.000Z";

/** An estimate window whose Q25 (0.60) and Q40 (0.70) differ, plus 8 confirming observations. */
const POPULATION = [
  0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6,
  0.7, 0.7, 0.7, 0.7, 0.7,
  0.8, 0.8, 0.8,
  0.9, 0.9, 0.9, 0.9,
  0.95,
  0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95,
];

const rubricOf = (quantileGate?: number, threshold = 0.6): Quality =>
  ({
    dimensions: [{ id: "solves", statement: "it solves the stated goal", ...(quantileGate === undefined ? {} : { quantileGate }) }],
    threshold,
    policy: "required",
  }) as Quality;

/** Run the ratchet for one rubric over the same seeded population. */
function barWith(quantileGate?: number, threshold = 0.6): number {
  const ws = workspace();
  try {
    const options = learningOptions(ws, AT);
    const quality = rubricOf(quantileGate, threshold);
    withStore(options, (store) => {
      population(store, TASK, "solves", POPULATION, AT);
      stableSample(store, TASK, quality, AT);
    });
    withStore(options, (store) => recomputeBar(store, TASK, 1, quality, AT));
    const bars = withStore(options, (store) => quantileBars(store, TASK, quality));
    const raises = withStore(options, (store) => raisesOf(store, TASK));
    for (const raise of raises) assert.equal(raise.percentile, quantileGate ?? DEFAULT_QUANTILE, "the rank is recorded on the raise");
    return bars.perDimension.get("solves") ?? ABSOLUTE_MIN;
  } finally {
    dispose(ws);
  }
}

test("Q40 and Q25 of the same population give different bars", () => {
  assert.equal(DEFAULT_QUANTILE, 25);
  const q25 = barWith(undefined);
  const q40 = barWith(40);
  assert.equal(q25, 0.6, "Q25 takes the lower rank");
  assert.equal(q40, 0.7, "Q40 is stricter on the same work");
  assert.ok(q40 > q25, "the knob selects a rank, and a higher rank is stricter");
});

test("an authored threshold changes nothing", () => {
  const plain = barWith(undefined, 0.6);
  const strict = barWith(undefined, 0.9);
  assert.equal(plain, strict, "the measured bar is the same whatever the document declares");
});

test("an out-of-range quantileGate is CONFIG_INVALID", () => {
  const base = { threshold: 0.6, policy: "required" as const, dimensions: [{ id: "d", statement: "s", quantileGate: 0 }] };
  assert.equal(QualitySchema.safeParse(base).success, false, "0 is refused");
  assert.equal(QualitySchema.safeParse({ ...base, dimensions: [{ id: "d", statement: "s", quantileGate: 100 }] }).success, false, "100 is refused");
  assert.equal(QualitySchema.safeParse({ ...base, dimensions: [{ id: "d", statement: "s", quantileGate: 99 }] }).success, true, "99 is the bound");
  assert.throws(
    () => parseWith(QualitySchema, base, "CONFIG_INVALID", "rubric"),
    (error: unknown) => isAppError(error) && error.code === "CONFIG_INVALID",
  );
  void ({} as TaskConfig);
});
