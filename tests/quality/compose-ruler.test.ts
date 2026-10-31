/**
 * Slice 1, the ruler (R11): the composition formula is part of the ruler digest, so a verdict recorded
 * under a different arithmetic is never reused — and the score cache keys on exactly that digest.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { digestOf } from "../../src/runner/canonical.ts";
import { COMPOSE_FORMULA_ID, evaluateArtifact, rulerDigest } from "../../src/quality/evaluate.ts";
import { barsFromQuality } from "../../src/quality/bar.ts";
import { jevScorer } from "../../src/quality/jev-scorer.ts";
import type { Quality } from "../../src/types/quality.ts";
import { isAppError } from "../../src/types/errors.ts";
import { clock, dispose, eventsOf, judgedFlow, sequenceScorer, startJudged, submitJudged, workspace } from "../testkit.ts";

const QUALITY: Quality = {
  threshold: 0.6,
  policy: "required",
  dimensions: [
    { id: "solves", statement: "it solves the goal", probes: [{ id: "c1", type: "noul", instructions: "does it?" }] },
    { id: "evidence", statement: "every claim carries evidence" },
  ],
};

test("R11: a formula change is a different ruler, so a recorded verdict is never reused", async () => {
  const bars = barsFromQuality(QUALITY);
  // The formula id is a digest INPUT, not a comment: two formulas, two rulers.
  assert.notEqual(rulerDigest(QUALITY, bars, "praxis.compose/min/v0"), rulerDigest(QUALITY, bars));
  assert.equal(rulerDigest(QUALITY, bars), rulerDigest(QUALITY, bars, COMPOSE_FORMULA_ID), "the default is the shipped formula");

  // The digest a verdict records is the CURRENT ruler, so a verdict recorded before the formula
  // existed (the pre-slice-1 digest of ruler+floors alone) can never match it.
  const legacy = digestOf({ ruler: QUALITY, floors: [...bars.perDimension] });
  const verdict = await evaluateArtifact(
    jevScorer({ evaluateFn: async () => ({ model: "fake", answers: { c1: { type: "noul", noul: 0.9 }, "solves.__statement": { type: "noul", noul: 0.9 }, evidence: { type: "noul", noul: 0.9 } } }) as never }),
    QUALITY,
    { goal: "g", artifact: {} },
    bars,
  );
  assert.equal(verdict.rubricDigest, rulerDigest(QUALITY, bars), "the recorded ruler carries the formula");
  assert.notEqual(verdict.rubricDigest, legacy, "a pre-formula verdict is a different ruler");

  // And the score cache keys on that digest: the same bytes are judged once, not twice.
  const ws = workspace();
  try {
    judgedFlow(ws);
    const tick = clock().next;
    const run = startJudged(ws, "cache", tick());
    // The second frame would score 0.9, so a bypassed cache cannot hide here.
    const scorer = sequenceScorer([0.3, 0.9]);
    await assert.rejects(
      submitJudged(ws, run, tick(), 1, scorer),
      (error: unknown) => isAppError(error) && error.code === "QUALITY_BELOW_THRESHOLD",
    );
    // The SAME bytes again: the recorded verdict is reused, not re-judged.
    await submitJudged(ws, run, tick(), 1, scorer);
    assert.equal(scorer.calls, 1, "the cache is keyed on the ruler digest: one judge call for identical bytes");
    const recorded = eventsOf(ws, run.instance)
      .filter((event) => event.type === "quality.verdict")
      .map((event) => event.payload as { score: number; rubricDigest: string });
    assert.equal(recorded.length, 2, "both attempts are recorded: the cache is not an erased attempt");
    assert.equal(recorded[1]!.score, 0.3, "the reused verdict, not the next frame's 0.9");
    assert.equal(recorded[1]!.rubricDigest, recorded[0]!.rubricDigest);
  } finally {
    dispose(ws);
  }
});
