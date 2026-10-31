/**
 * S7 compatibility (DEPRECATE-NOT-DELETE): a verdict and a task pin written BEFORE the quantile bars
 * must still parse. Nothing is migrated; the legacy fields are read and ignored.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { QualityVerdictSchema, TaskConfigSchema, parseWith } from "../../src/types/schema.ts";
import { BarRaisedSchema } from "../../src/types/learning.ts";

/** A verdict recorded before the cutover: mean, flagged, a tolerance-band pass, no Q50 fields. */
const LEGACY_VERDICT = {
  decision: "pass",
  score: 0.62,
  dimensions: [
    { id: "solves", score: 0.62, key: "abc123" },
    { id: "evidence", score: 0.7, key: "def456", rationale: "evidence: nothing missing" },
  ],
  mean: 0.66,
  flagged: ["evidence"],
  rationale: "jev noul: solves=0.62, evidence=0.70",
  rubricDigest: "sha256:" + "a".repeat(64),
  scorer: "jev-latest",
  source: "jev",
};

/** A task pin from before the data slice: the deprecated bar fields are still declared. */
const LEGACY_TASK = {
  id: "research",
  version: 7,
  state: "published",
  goal: "establish what is true from sources and the code before anything is designed",
  capabilities: ["artifact.write", "emit", "evaluate"],
  produces: { schema: "praxis.artifact.research/v1" },
  gate: "section-requirements",
  requires: [{ section: "findings" }],
  quality: {
    threshold: 0.6,
    paretoThreshold: 0.8,
    policy: "required",
    dimensions: [{ id: "grounded", statement: "every claim is tied to a source", floor: 0.6 }],
  },
};

test("a legacy verdict payload still parses", () => {
  const parsed = QualityVerdictSchema.safeParse(LEGACY_VERDICT);
  assert.equal(parsed.success, true, JSON.stringify(parsed.success ? "" : parsed.error.issues).slice(0, 300));
  assert.equal(parsed.data.mean, 0.66, "mean is kept as a field, just no longer written");
  assert.deepEqual(parsed.data.flagged, ["evidence"]);
});

test("a legacy task pin still parses, deprecated fields and all", () => {
  const parsed = parseWith(TaskConfigSchema, LEGACY_TASK, "CONFIG_INVALID", "legacy task");
  assert.equal(parsed.quality?.threshold, 0.6, "the deprecated threshold is read, and ignored by the bar");
  assert.equal(parsed.quality?.dimensions[0]?.floor, 0.6);
});

test("a legacy raise (window, ema, no percentile) still parses and folds", () => {
  const legacy = {
    task: "tasks/make",
    taskVersion: 1,
    scope: "global",
    from: 0.6,
    to: 0.65,
    window: { passes: [0.9, 0.9, 0.9, 0.9, 0.9], lowerQuartile: 0.9, margin: 0.3, stdev: 0, meanAttempts: 1 },
    ema: { periods: 9, alpha: 0.2, value: 0.9, samples: 10 },
    formulaId: "praxis.bar.ema/v3",
    at: "2026-10-30T00:00:00.000Z",
  };
  assert.equal(BarRaisedSchema.safeParse(legacy).success, true);
});
