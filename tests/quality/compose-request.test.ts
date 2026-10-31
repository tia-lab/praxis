/**
 * Slice 1, one call (R10): the composed request replaces the scoring call AND the explain-only battery.
 * A submission is exactly ONE pi-jev request, carrying every criterion and every witness.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { JevRequest, JevResponse } from "pi-jev";
import { evaluateArtifact } from "../../src/quality/evaluate.ts";
import { jevScorer } from "../../src/quality/jev-scorer.ts";
import type { Quality } from "../../src/types/quality.ts";

const QUALITY: Quality = {
  threshold: 0.6,
  policy: "required",
  dimensions: [
    {
      id: "alpha",
      statement: "alpha holds",
      probes: [
        { id: "a1", type: "noul", instructions: "a1?" },
        { id: "a2", type: "choice", instructions: "a2?", criteria: { yes: "yes", no: "no" }, clean: "yes" },
      ],
    },
    {
      id: "beta",
      statement: "beta holds",
      probes: [
        { id: "b1", type: "score", instructions: "b1?", criteria: ["low", "high"] },
      ],
    },
    { id: "plain", statement: "plain holds" },
  ],
};

test("R10: one request per submission carries every criterion and every witness", async () => {
  const seen: JevRequest[] = [];
  const evaluateFn = async (request: JevRequest): Promise<JevResponse> => {
    seen.push(request);
    const answers: Record<string, unknown> = {};
    for (const [id, question] of Object.entries(request.questions)) {
      if (question.type === "noul") answers[id] = { type: "noul", noul: 0.95 };
      else if (question.type === "score") answers[id] = { type: "score", score: 1 };
      else answers[id] = { type: "choice", choice: "yes" };
    }
    return { model: "fake/jev", answers } as JevResponse;
  };

  const verdict = await evaluateArtifact(jevScorer({ evaluateFn }), QUALITY, { goal: "g", artifact: { a: 1 } });
  assert.equal(seen.length, 1, "one call replaces the scoring call and the battery");
  const [request] = seen;
  assert.deepEqual(
    Object.keys(request!.questions).sort(),
    ["alpha.__statement", "alpha.a1", "alpha.a2", "beta.__statement", "beta.b1", "plain"],
    "every criterion, one witness per composed dimension, and the plain dimension by its id",
  );
  assert.equal(request!.questions["alpha.a2"]!.type, "choice", "a criterion keeps its authored type");
  assert.equal(request!.questions["beta.b1"]!.type, "score");
  assert.equal(request!.questions.plain!.type, "noul", "a dimension without criteria is asked as before");
  assert.deepEqual(Object.keys(request!.state as object).sort(), ["artifact", "goal", "subjectDigest"]);
  assert.deepEqual(verdict.dimensions.map((dimension) => dimension.id), ["alpha", "beta", "plain"]);
});
