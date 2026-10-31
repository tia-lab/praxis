/**
 * Slice 2, the torn set (R17) and its authoring boundary (R19): a criterion is reported torn when
 * the judge itself sat near the boundary, and nothing about that can refuse a step or be configured
 * from a task document.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { JevRequest, JevResponse } from "pi-jev";
import { evaluateArtifact } from "../../src/quality/evaluate.ts";
import { jevScorer } from "../../src/quality/jev-scorer.ts";
import { QualitySchema, type Quality } from "../../src/types/quality.ts";
import { TORN_CLEAN_BAND, TORN_NOUL_BAND, TORN_SPREAD } from "../../src/runner/engine/types.ts";

const QUALITY: Quality = {
  threshold: 0.6,
  policy: "required",
  dimensions: [
    {
      id: "composed",
      statement: "the artifact is whole",
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

/** A fake pi-jev: named answers win, and every other criterion answers cleanly for its own type. */
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

const verdictFor = (answers: Record<string, unknown>) => evaluateArtifact(judgeWith(answers), QUALITY, { goal: "g", artifact: {} });

test("R17: torn when the clean mass is near the boundary or the spread is wide", async () => {
  // The constants are the declared ones, not magic numbers at the call site.
  assert.equal(TORN_SPREAD, 0.35);
  assert.deepEqual([...TORN_NOUL_BAND], [0.45, 0.55]);
  assert.deepEqual([...TORN_CLEAN_BAND], [0.4, 0.6]);

  // P(clean) 0.52: torn. P(clean) 0.95: not torn.
  const split = await verdictFor({ c1: { type: "choice", choice: "clean", probabilities: { clean: 0.52, other: 0.48 } } });
  assert.deepEqual(split.torn, ["composed.c1"]);
  const decided = await verdictFor({ c1: { type: "choice", choice: "clean", probabilities: { clean: 0.95, other: 0.05 } } });
  assert.equal(decided.torn, undefined, "a decided answer is not torn");

  // A wide score distribution: spread 0.55 > TORN_SPREAD, so torn whatever the answer.
  const wide = await verdictFor({ s1: { type: "score", score: 2, probabilities: [0.45, 0.3, 0.25] } });
  assert.deepEqual(wide.torn, ["composed.s1"]);
  const tight = await verdictFor({ s1: { type: "score", score: 2, probabilities: [0.02, 0.08, 0.9] } });
  assert.equal(tight.torn, undefined);

  // Several torn criteria are all listed, and the per-dimension view names the criterion ids.
  const both = await verdictFor({
    n1: { type: "noul", noul: 0.5 },
    c1: { type: "choice", choice: "clean", probabilities: { clean: 0.55, other: 0.45 } },
  });
  assert.deepEqual(both.torn, ["composed.n1", "composed.c1"]);
  assert.deepEqual(both.dimensions[0]!.torn, ["n1", "c1"]);
});

test("R19: no schema knob can grade a choice criterion", () => {
  const base = { threshold: 0.6, policy: "required" as const };
  const probes = [{ id: "c1", type: "choice", instructions: "which?", criteria: { a: "A", b: "B" }, clean: "a" }];
  assert.equal(QualitySchema.safeParse({ ...base, dimensions: [{ id: "d", statement: "s", probes }] }).success, true);
  // A grading field on the criterion, or a threshold on the dimension, is refused: the authoring
  // rule is documentary, and no task document can grade a choice or move a torn threshold.
  for (const extra of [{ grade: 0.5 }, { weight: 0.5 }, { tornSpread: 0.1 }]) {
    const dirty = [{ ...probes[0], ...extra }];
    assert.equal(QualitySchema.safeParse({ ...base, dimensions: [{ id: "d", statement: "s", probes: dirty }] }).success, false, JSON.stringify(extra));
  }
  assert.equal(
    QualitySchema.safeParse({ ...base, dimensions: [{ id: "d", statement: "s", tornSpread: 0.1 }] }).success,
    false,
    "a dimension cannot carry the torn threshold either",
  );
  assert.equal(
    QualitySchema.safeParse({ ...base, dimensions: [{ id: "d", statement: "s" }], noulBand: [0.4, 0.6] }).success,
    false,
    "and the rubric cannot carry the noul band",
  );
});
