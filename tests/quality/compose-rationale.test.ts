/**
 * Slice 1, the why (R9): the rationale is rendered by code from the answers that produced the score —
 * binding criterion first, bounded, deterministic — and the kept divergence wording appears only when
 * every criterion is clean and the dimension still missed its bar.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { JevRequest, JevResponse } from "pi-jev";
import { evaluateArtifact } from "../../src/quality/evaluate.ts";
import { RATIONALE_DIVERGENCE, RATIONALE_MAX, jevScorer } from "../../src/quality/jev-scorer.ts";


const DIMENSION = {
  id: "composed",
  statement: "the artifact is whole",
  floor: 0.6,
  probes: [
    { id: "n1", type: "noul" as const, instructions: "is it whole?" },
    { id: "s1", type: "score" as const, instructions: "how whole?", criteria: ["not at all", "half", "whole"] },
    {
      id: "c1",
      type: "choice" as const,
      instructions: "which shape?",
      criteria: { clean: "the right shape", other: "the wrong shape" },
      clean: "clean",
    },
  ],
};

/** A fake pi-jev: clean answers everywhere except the overridden criteria. */
function judgeFor(overrides: Record<string, unknown>) {
  const evaluateFn = async (request: JevRequest): Promise<JevResponse> => {
    const answers: Record<string, unknown> = {};
    for (const [id, question] of Object.entries(request.questions)) {
      const criterion = id.includes(".") ? id.slice(id.indexOf(".") + 1) : id;
      const override = overrides[criterion];
      if (override !== undefined) {
        answers[id] = override;
        continue;
      }
      if (question.type === "noul") answers[id] = { type: "noul", noul: 0.9 };
      else if (question.type === "score") answers[id] = { type: "score", score: 2 };
      else answers[id] = { type: "choice", choice: "clean" };
    }
    return { model: "fake/jev", answers } as JevResponse;
  };
  return { evaluateFn };
}

const verdictFor = (overrides: Record<string, unknown>, floor = 0.6) =>
  evaluateArtifact(
    jevScorer({ evaluateFn: judgeFor(overrides).evaluateFn }),
    { threshold: 0.6, policy: "required", dimensions: [{ ...DIMENSION, floor }] },
    { goal: "g", artifact: {} },
    undefined,
    // S2: the bar in force is a MEASURED per-dimension level; this file passes it explicitly.
    { perDimension: new Map([["composed", floor]]) },
  );

test("R9: the why is rendered from the deciding answers, binding first and bounded", async () => {
  // s1 at level 0 and c1 non-clean tie at 0; declared order makes s1 the binding criterion.
  const dirty = { s1: { type: "score", score: 0 }, c1: { type: "choice", choice: "other" }, n1: { type: "noul", noul: 0.2 } };
  const line = (await verdictFor(dirty)).dimensions[0]!.rationale!;
  assert.ok(line, "a dirty composition renders a line");
  assert.ok(line.startsWith("composed: not at all"), "the binding criterion comes first: " + line);
  assert.ok(line.includes("the wrong shape"), "a non-clean choice names its option");
  assert.ok(line.includes("not satisfied: is it whole?"), "a non-clean noul names its own ask");
  assert.ok(line.length <= RATIONALE_MAX);
  assert.ok(line.split("; ").length <= 3, "at most three clauses");
  // Deterministic: the same answers render the same string, every time.
  assert.equal((await verdictFor(dirty)).dimensions[0]!.rationale, line);
});

test("R9: clean criteria over a missed bar render the kept divergence wording", async () => {
  // Every criterion is clean (noul .6 >= .5, top level, clean option) yet the floor of 0.9 is missed.
  const weak = await verdictFor({ n1: { type: "noul", noul: 0.6 } }, 0.9);
  assert.equal(weak.dimensions[0]!.score, 0.6);
  assert.equal(weak.decision, "below");
  assert.equal(weak.dimensions[0]!.rationale, "composed: " + RATIONALE_DIVERGENCE, "the kept divergence clause, not an invented one");
  // The same answers against a floor they clear say nothing at all: no clause, no divergence line.
  const strong = await verdictFor({ n1: { type: "noul", noul: 0.6 } }, 0.6);
  assert.equal(strong.decision, "pass");
  assert.equal(strong.dimensions[0]!.rationale, undefined);
});
