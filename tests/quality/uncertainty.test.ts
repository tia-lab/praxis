/**
 * Slice 2, the judge's uncertainty (R15, R16, R18): the distribution pi-jev reports is recorded per
 * criterion where it exists, absents itself where it does not, and NEVER changes the score.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { JevRequest, JevResponse } from "pi-jev";
import { evaluateArtifact } from "../../src/quality/evaluate.ts";
import { jevScorer } from "../../src/quality/jev-scorer.ts";
import type { Quality } from "../../src/types/quality.ts";

const QUALITY: Quality = {
  // A low floor AND a low mean bar: this file is about what is RECORDED, not about refusing, so a
  // torn judgment must be able to sit inside a passing verdict.
  threshold: 0.4,
  policy: "required",
  dimensions: [
    {
      id: "composed",
      statement: "the artifact is whole",
      // A floor well under the seeded threshold, so a torn judgment at 0.5 still passes here: the
      // torn flag must never be the thing that refuses (D10, R16).
      floor: 0.4,
      probes: [
        { id: "n1", type: "noul", instructions: "is it whole?" },
        { id: "s1", type: "score", instructions: "how whole?", criteria: ["none", "half", "whole"] },
        {
          id: "c1",
          type: "choice",
          instructions: "which shape?",
          criteria: { clean: "the right shape", other: "the wrong shape" },
          clean: "clean",
        },
      ],
    },
  ],
};

/**
 * A fake pi-jev: the caller names each answer, so a test can send mass or withhold it. An unnamed
 * criterion gets a clean, type-correct answer for the question that was actually asked.
 */
function judgeWith(answers: Record<string, unknown>) {
  const evaluateFn = async (request: JevRequest): Promise<JevResponse> => {
    const out: Record<string, unknown> = {};
    for (const [id, question] of Object.entries(request.questions)) {
      const criterion = id.includes(".") ? id.slice(id.indexOf(".") + 1) : id;
      out[id] = answers[criterion] ?? (question.type === "choice"
        ? { type: "choice", choice: "clean" }
        : question.type === "score"
          ? { type: "score", score: 2 }
          : { type: "noul", noul: 0.9 });
    }
    return { model: "fake/jev", answers: out } as JevResponse;
  };
  return jevScorer({ evaluateFn });
}

const verdictFor = (answers: Record<string, unknown>) =>
  evaluateArtifact(judgeWith(answers), QUALITY, { goal: "g", artifact: {} });

const criterion = (verdict: Awaited<ReturnType<typeof verdictFor>>, id: string) =>
  verdict.dimensions[0]!.diagnosis!.find((entry) => entry.probe === id)!;

test("R15: pClean, pTop and spread are recorded from the distribution, and never zero-filled", async () => {
  const clean = { type: "choice", choice: "clean", confidence: 0.8, probabilities: { clean: 0.7, other: 0.3 } };
  const scored = { type: "score", score: 2, probabilities: [0.1, 0.2, 0.7] };
  const withMass = await verdictFor({ c1: clean, s1: scored });
  const choice = criterion(withMass, "c1");
  assert.equal(choice.pClean, 0.7, "P(clean option)");
  assert.equal(choice.pTop, 0.7, "the most likely option");
  assert.ok(Math.abs((choice.spread ?? 0) - 0.3) < 1e-9, "spread = 1 - max(p)");
  assert.equal(choice.confidence, 0.8, "the answer's own confidence is recorded when present");
  const score = criterion(withMass, "s1");
  assert.equal(score.pTop, 0.7, "P(top level)");
  assert.ok(Math.abs((score.spread ?? 0) - 0.3) < 1e-9);

  // No distribution (an older client, or a stage before slice 0): the fields are ABSENT.
  const bare = await verdictFor({ c1: { type: "choice", choice: "clean" }, s1: { type: "score", score: 2 } });
  const bareChoice = criterion(bare, "c1");
  assert.deepEqual(Object.keys(bareChoice).sort(), ["answer", "probe"], "absent mass is absent, never 0");
  assert.deepEqual(Object.keys(criterion(bare, "s1")).sort(), ["answer", "probe"]);
});

test("R16: a noul records no mass and no confidence, and its band is its only signal", async () => {
  // Even a client regression that shipped mass on a noul is never used.
  const leaky = await verdictFor({ n1: { type: "noul", noul: 0.9, confidence: 0.8, probabilities: { true: 1 } } });
  assert.deepEqual(criterion(leaky, "n1"), { probe: "n1", answer: 0.9 }, "no mass, no confidence, ever (D9)");
  assert.equal(leaky.torn, undefined, "0.9 is not inside the band");

  // 0.50 is a torn judgment, and the cost of it is disclosure, not a refusal.
  const middle = await verdictFor({ n1: { type: "noul", noul: 0.5 } });
  assert.deepEqual(middle.dimensions[0]!.torn, ["n1"]);
  assert.deepEqual(middle.torn, ["composed.n1"]);
  assert.equal(middle.decision, "pass", "a torn criterion never refuses");
});

test("R18: mass never changes the score", async () => {
  const withMass = await verdictFor(
    {
      c1: { type: "choice", choice: "other", confidence: 0.9, probabilities: { clean: 0.2, other: 0.8 } },
      s1: { type: "score", score: 1, probabilities: [0.2, 0.6, 0.2] },
      n1: { type: "noul", noul: 0.7 },
    },
  );
  const without = await verdictFor({
    c1: { type: "choice", choice: "other" },
    s1: { type: "score", score: 1 },
    n1: { type: "noul", noul: 0.7 },
  });
  const shape = (verdict: typeof withMass) => ({
    decision: verdict.decision,
    score: verdict.score,
    mean: verdict.mean,
    flagged: verdict.flagged,
    dimensions: verdict.dimensions.map((dimension) => ({ id: dimension.id, score: dimension.score })),
  });
  assert.deepEqual(shape(withMass), shape(without), "identical scores, mean, decision and flagged set");
  // And the disclosure really did happen, so this is not a vacuous comparison.
  assert.notEqual(criterion(withMass, "c1").spread, undefined);
});
