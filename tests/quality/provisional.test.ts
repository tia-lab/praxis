/**
 * Slice 6, the provisional verdict (R33-R36): when the criterion that DECIDED a verdict was itself
 * torn, the verdict says so - with the signal that made it torn - and decides exactly as it would
 * have. The thresholds are code constants, not task fields.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { JevRequest, JevResponse } from "pi-jev";
import { evaluateArtifact } from "../../src/quality/evaluate.ts";
import { jevScorer } from "../../src/quality/jev-scorer.ts";
import { TORN_NOUL_BAND, TORN_SPREAD } from "../../src/runner/engine/types.ts";
import { QualitySchema, type Quality } from "../../src/types/quality.ts";

const QUALITY: Quality = {
  threshold: 0.4,
  policy: "required",
  dimensions: [
    {
      id: "composed",
      statement: "the artifact is whole",
      floor: 0.4,
      probes: [
        { id: "n1", type: "noul", instructions: "is it whole?" },
        { id: "c1", type: "choice", instructions: "which shape?", criteria: { clean: "the right shape", other: "the wrong shape" }, clean: "clean" },
      ],
    },
  ],
};

/** A fake judge, answering per criterion id with the answer the case needs. */
function judgeWith(answers: Record<string, unknown>) {
  const evaluateFn = async (request: JevRequest): Promise<JevResponse> => {
    const out: Record<string, unknown> = {};
    for (const [id, question] of Object.entries(request.questions)) {
      const criterion = id.includes(".") ? id.slice(id.indexOf(".") + 1) : id;
      out[id] = answers[criterion] ?? (question.type === "choice"
        ? { type: "choice", choice: "clean" }
        : { type: "noul", noul: 0.95 });
    }
    return { model: "fake/jev", answers: out } as JevResponse;
  };
  return jevScorer({ evaluateFn });
}

const verdictFor = (answers: Record<string, unknown>) => evaluateArtifact(judgeWith(answers), QUALITY, { goal: "g", artifact: {} });

test("R33: provisional when a deciding criterion was torn", async () => {
  // The noul at 0.50 is torn AND is the binding criterion (0.50 < the clean choice's 1).
  const torn = await verdictFor({ n1: { type: "noul", noul: 0.5 } });
  assert.equal(torn.dimensions[0]!.bound, "n1");
  assert.equal(torn.provisional, true);
  assert.deepEqual(torn.provisionalOn, [{ dimension: "composed", criterion: "n1", signal: "noul-band" }]);

  // A clean deciding criterion reports nothing at all.
  const decided = await verdictFor({ n1: { type: "noul", noul: 0.9 } });
  assert.equal(decided.provisional, undefined);
  assert.equal(decided.provisionalOn, undefined);

  // A torn criterion that did NOT decide is not a provisional verdict: c1 is torn but n1 is lower.
  const irrelevant = await verdictFor({
    n1: { type: "noul", noul: 0.4 },
    c1: { type: "choice", choice: "clean", probabilities: { clean: 0.52, other: 0.48 } },
  });
  assert.deepEqual(irrelevant.torn, ["composed.c1"], "c1 is torn");
  assert.equal(irrelevant.provisional, undefined, "but it did not decide the dimension");
});

test("R34: the reason names its signal, and a noul is never a distribution", async () => {
  // A NON-clean choice binds the dimension (0 < the noul's 0.9), and its distribution is split.
  const mass = await verdictFor({
    n1: { type: "noul", noul: 0.9 },
    c1: { type: "choice", choice: "other", probabilities: { clean: 0.5, other: 0.5 } },
  });
  assert.equal(mass.dimensions[0]!.bound, "c1");
  assert.deepEqual(mass.provisionalOn, [{ dimension: "composed", criterion: "c1", signal: "mass" }]);
  assert.equal(mass.dimensions[0]!.score, 0, "a non-clean choice is still categorically unsatisfied");

  const band = await verdictFor({ n1: { type: "noul", noul: 0.52 } });
  assert.deepEqual(band.provisionalOn, [{ dimension: "composed", criterion: "n1", signal: "noul-band" }]);
  // The noul's own record carries NO mass that could be mistaken for one.
  assert.deepEqual(Object.keys(band.dimensions[0]!.diagnosis![0]!).sort(), ["answer", "probe"]);

  // Confidence alone never invents a torn state: without a distribution there is nothing to be torn.
  const confidence = await verdictFor({
    n1: { type: "noul", noul: 0.9 },
    c1: { type: "choice", choice: "clean", confidence: 0.5 },
  });
  assert.equal(confidence.provisional, undefined);
  assert.equal(confidence.torn, undefined);
});

test("R35: provisional never changes a decision, a mean, a flagged set or a bar", async () => {
  // The SAME answers, once with a distribution (torn) and once without (not torn): the decision is
  // identical, only the reported state differs.
  const tornAnswers = { n1: { type: "noul", noul: 0.9 }, c1: { type: "choice", choice: "other", probabilities: { clean: 0.5, other: 0.5 } } };
  const plainAnswers = { n1: { type: "noul", noul: 0.9 }, c1: { type: "choice", choice: "other" } };
  const provisional = await verdictFor(tornAnswers);
  const plain = await verdictFor(plainAnswers);
  assert.equal(provisional.provisional, true);
  assert.equal(plain.provisional, undefined);
  const shape = (verdict: typeof provisional) => ({
    decision: verdict.decision,
    score: verdict.score,
    mean: verdict.mean,
    flagged: verdict.flagged,
    dimensions: verdict.dimensions.map((dimension) => ({ id: dimension.id, score: dimension.score, key: dimension.key, bound: dimension.bound })),
  });
  assert.deepEqual(shape(provisional), shape(plain), "identical accept/refuse, score, mean, flagged and bars");
  assert.equal(provisional.decision, "below", "the refusal is the same refusal");
});

test("R36: the thresholds are code constants, not task fields", () => {
  assert.equal(TORN_SPREAD, 0.35);
  assert.deepEqual([...TORN_NOUL_BAND], [0.45, 0.55]);
  const base = { threshold: 0.6, policy: "required" as const };
  const dimension = { id: "d", statement: "s" };
  for (const knob of [{ tornSpread: 0.1 }, { noulBand: [0.4, 0.6] }, { provisional: true }, { provisionalThreshold: 0.7 }]) {
    assert.equal(
      QualitySchema.safeParse({ ...base, dimensions: [dimension], ...knob }).success,
      false,
      "no task field may set the torn thresholds: " + JSON.stringify(knob),
    );
  }
});
