/**
 * Slice 1, composition (R6-R8): the criteria a task declares DECIDE its dimension score, in the same
 * request as the statement witness, by code-owned arithmetic — nested MIN, no weights, no model.
 *
 * NO NETWORK: every case injects a fake `evaluateFn`; the store is never touched.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { JevRequest, JevResponse } from "pi-jev";
import { evaluateArtifact } from "../../src/quality/evaluate.ts";
import { jevScorer } from "../../src/quality/jev-scorer.ts";
import type { Quality } from "../../src/types/quality.ts";

/** One composed dimension (noul + score + choice) and one judged by its statement alone. */
const QUALITY: Quality = {
  threshold: 0.6,
  policy: "required",
  dimensions: [
    {
      id: "composed",
      statement: "the artifact is whole",
      floor: 0.6,
      probes: [
        { id: "n1", type: "noul", instructions: "is it whole?" },
        { id: "s1", type: "score", instructions: "how whole?", criteria: ["not at all", "half", "whole"] },
        {
          id: "c1",
          type: "choice",
          instructions: "which shape?",
          criteria: { clean: "the right shape", other: "the wrong shape" },
          clean: "clean",
        },
      ],
    },
    { id: "plain", statement: "every claim carries evidence", floor: 0.6 },
  ],
};

/**
 * A fake pi-jev that answers every question CLEANLY unless the criterion is overridden: a noul at
 * 0.9, a score at its top level, the clean choice option, and the witness at 0.9.
 */
function judgeFor(overrides: Record<string, unknown> = {}) {
  const seen: JevRequest[] = [];
  const evaluateFn = async (request: JevRequest): Promise<JevResponse> => {
    seen.push(request);
    const answers: Record<string, unknown> = {};
    for (const [id, question] of Object.entries(request.questions)) {
      const criterion = id.includes(".") ? id.slice(id.indexOf(".") + 1) : id;
      const override = overrides[id] ?? overrides[criterion];
      if (override !== undefined) {
        answers[id] = override;
        continue;
      }
      if (question.type === "noul") answers[id] = { type: "noul", noul: 0.9 };
      else if (question.type === "score") answers[id] = { type: "score", score: question.criteria.length - 1 };
      else answers[id] = { type: "choice", choice: "clean" };
    }
    return { model: "fake/jev", answers } as JevResponse;
  };
  return { evaluateFn, seen };
}

const scorerFor = (overrides: Record<string, unknown> = {}) => jevScorer({ evaluateFn: judgeFor(overrides).evaluateFn });
const verdictFor = (overrides: Record<string, unknown> = {}) =>
  evaluateArtifact(scorerFor(overrides), QUALITY, { goal: "g", artifact: {} });

test("R6: a dimension is scored as the minimum of its criteria", async () => {
  // Clean everywhere: the noul's 0.9 is the minimum, so the dimension scores 0.9 — not the mean.
  const verdict = await verdictFor();
  const composed = verdict.dimensions.find((dimension) => dimension.id === "composed")!;
  assert.equal(composed.score, 0.9, "top level and clean choice do not raise the noul's 0.9");
  assert.equal(verdict.score, 0.9, "the headline stays the MINIMUM of the dimensions");

  // The score criterion's position is scaled by its levels; one low criterion sets the dimension.
  assert.equal((await verdictFor({ s1: { type: "score", score: 0 } })).dimensions[0]!.score, 0, "position 0 of 3");
  assert.equal((await verdictFor({ s1: { type: "score", score: 1 } })).dimensions[0]!.score, 0.5, "position 1 of 3");

  // A non-clean choice is categorical: 0, never a fraction.
  assert.equal((await verdictFor({ c1: { type: "choice", choice: "other" } })).dimensions[0]!.score, 0);

  // A dimension with no criteria scores exactly as it did before this slice: its statement noul.
  const plain = verdict.dimensions.find((dimension) => dimension.id === "plain")!;
  assert.deepEqual(Object.keys(plain).sort(), ["id", "key", "score"], "no composed fields on a statement-only dimension");
  assert.equal(plain.score, 0.9);
});

test("R7: the witness is recorded and never changes a decision", async () => {
  const base = await verdictFor();
  assert.equal(base.dimensions[0]!.statementScore, 0.9, "the witness is recorded beside the composition");
  assert.equal(base.dimensions[0]!.divergence, undefined, "witness == composed: no divergence");

  const low = await verdictFor({ "composed.__statement": { type: "noul", noul: 0.5 } });
  assert.equal(low.dimensions[0]!.divergence, true, "a witness far below the composed score diverges");
  assert.equal(low.dimensions[0]!.score, base.dimensions[0]!.score, "the witness never enters the score");
  assert.deepEqual(
    [low.decision, low.mean, low.flagged],
    [base.decision, base.mean, base.flagged],
    "changing only the witness changes no decision, mean or flagged set",
  );

  // The boundary is exactly DIVERGENCE_MIN: composed 0.6 against a witness of 0.8 diverges...
  const atBoundary = await verdictFor({ n1: { type: "noul", noul: 0.6 }, "composed.__statement": { type: "noul", noul: 0.8 } });
  assert.equal(atBoundary.dimensions[0]!.score, 0.6);
  assert.equal(atBoundary.dimensions[0]!.divergence, true, "0.20 apart is divergence");
  // ...and 0.19 apart does not.
  const under = await verdictFor({ n1: { type: "noul", noul: 0.61 }, "composed.__statement": { type: "noul", noul: 0.8 } });
  assert.equal(under.dimensions[0]!.divergence, undefined, "0.19 apart is not divergence");
});

test("R8: bound names the criterion that produced the minimum", async () => {
  // The two clean criteria are at 1.0; the non-clean choice is 0, so it binds alone.
  const bound = await verdictFor({ c1: { type: "choice", choice: "other" } });
  assert.equal(bound.dimensions[0]!.bound, "c1");
  assert.match(bound.dimensions[0]!.rationale ?? "", /the wrong shape/, "and the rationale names the option");

  // A tie is broken by declared order, not by type or by answer.
  assert.equal((await verdictFor()).dimensions[0]!.bound, "n1");
  const tie = await verdictFor({ n1: { type: "noul", noul: 1 }, s1: { type: "score", score: 0 }, c1: { type: "choice", choice: "other" } });
  assert.equal(tie.dimensions[0]!.bound, "s1", "the first minimum in declared order binds");

  // A dimension with no criteria has no binding criterion to name.
  const plain = (await verdictFor()).dimensions.find((dimension) => dimension.id === "plain")!;
  assert.equal(plain.bound, undefined);
});
