/**
 * The hold (R22-R24, re-pinned for the quantile ratchet): a bar may not ratchet on an identity
 * nobody has sampled. The raise is HELD and recorded - never the step - and a caller that never
 * samples never raises. The population is SEEDED here: a first raise needs 28 carried observations.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { withStore } from "../../src/runner/engine/support.ts";
import { EVENT } from "../../src/runner/engine/types.ts";
import { raisesOf, recomputeBar, scanEvents } from "../../src/quality/index.ts";
import { BarRaisedSchema } from "../../src/types/learning.ts";
import { parseWith } from "../../src/types/schema.ts";
import { LEARNING_RUBRIC, dispose, learningOptions, population, stableSample, workspace } from "../testkit.ts";

const TASK = "tasks/make";
const AT = "2026-10-31T00:00:00.000Z";
const QUALITY = { dimensions: LEARNING_RUBRIC, threshold: 0.6, policy: "required" as const };
const DIMENSION = LEARNING_RUBRIC[0]!.id;

/** 28 observations an easy batch would raise on, and the ratchet pass over them. */
function pass(ws: ReturnType<typeof workspace>, sampled: boolean) {
  const options = learningOptions(ws, AT);
  withStore(options, (store) => {
    population(store, TASK, DIMENSION, Array.from({ length: 28 }, () => 0.95), AT);
    if (sampled) stableSample(store, TASK, QUALITY, AT);
  });
  const decisions = withStore(options, (store) => recomputeBar(store, TASK, 1, QUALITY, AT));
  const raises = withStore(options, (store) => raisesOf(store, TASK));
  const held = withStore(options, (store) => scanEvents(store, [EVENT.barHeld]));
  return { decisions, raises, held };
}

test("R22: a due raise without a sample is held, and the step still accepts", () => {
  const ws = workspace();
  try {
    const { decisions, raises, held } = pass(ws, false);
    assert.deepEqual(raises, [], "no raise on an unsampled identity");
    assert.equal(held.length, 1, "the hold is recorded, not silent");
    assert.equal((held[0]!.payload as { reason: string }).reason, "no rubric sample");
    assert.equal(decisions[0]!.kind, "held");
  } finally {
    dispose(ws);
  }
});

test("R23: a raise records its stability, and an old raise still folds", () => {
  const ws = workspace();
  try {
    const { raises } = pass(ws, true);
    assert.equal(raises.length, 1, "with a stable sample the raise lands");
    const raise = raises[0]!;
    assert.ok(raise.stability, "the raise carries its evidence");
    assert.equal(raise.stability!.stable, true);
    assert.equal(raise.percentile, 25, "and the rank it was computed at");
    assert.equal(raise.n, 28);
    // A raise recorded before this slice (no stability, no percentile) still parses and folds.
    const legacy = {
      task: TASK,
      taskVersion: 1,
      scope: "global",
      from: 0.6,
      to: 0.65,
      window: { passes: [0.9, 0.9, 0.9, 0.9, 0.9], lowerQuartile: 0.9, margin: 0.3, stdev: 0, meanAttempts: 1 },
      formulaId: "praxis.bar.ema/v3",
      at: AT,
    };
    assert.equal(parseWith(BarRaisedSchema, legacy, "STORE_INVALID", "legacy raise").to, 0.65);
  } finally {
    dispose(ws);
  }
});

test("R24: the ratchet judges nothing itself, and a non-sampling caller never raises", () => {
  const ws = workspace();
  try {
    const { raises, held } = pass(ws, false);
    assert.deepEqual(raises, [], "no sampler, no raise: delayed, never lowered");
    assert.equal(held.length, 1, "and the hold is the record of why");
    const options = learningOptions(ws, AT);
    const sampled = withStore(options, (store) => scanEvents(store, [EVENT.rubricSampled]));
    assert.equal(sampled.length, 0, "the ratchet never samples on its own");
  } finally {
    dispose(ws);
  }
});
