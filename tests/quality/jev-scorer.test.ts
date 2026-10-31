/**
 * The pi-jev-backed Scorer (quality wiring): one `noul` question per rubric dimension becomes
 * one score per dimension, and a pi-jev throw propagates instead of becoming a fabricated score.
 *
 * NO NETWORK: every case injects a fake `evaluateFn`, so the real TypeSafe call stays opt-in for a
 * real agent run and never happens in this suite.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { JevRequest, JevResponse } from "pi-jev";

import { jevScorer } from "../../src/quality/jev-scorer.ts";
import { evaluateArtifact } from "../../src/quality/evaluate.ts";
import type { Quality } from "../../src/types/schema.ts";

const GOAL = "judge the artifact against the rubric";
const SUBJECT = "sha256:" + "a".repeat(64);
const ARTIFACT = { claim: "a bounded result" };
const RUBRIC: { id: string; statement: string }[] = [
  { id: "solves", statement: "it solves the stated goal" },
  { id: "evidence", statement: "every claim carries evidence" },
];

/** pi-jev 0.2.3 types `instructions` as EntryType (possibly null): read it as text for an assertion. */
const textOf = (instruction: unknown): string =>
  typeof instruction === "string" ? instruction : (JSON.stringify(instruction) ?? "");

interface Fake {
  evaluateFn: (request: JevRequest) => Promise<JevResponse>;
  seen: JevRequest[];
}

/** A fake pi-jev call that records every request and answers it with `response`. */
function fake(response: (request: JevRequest) => JevResponse): Fake {
  const seen: JevRequest[] = [];
  return {
    seen,
    evaluateFn: async (request: JevRequest): Promise<JevResponse> => {
      seen.push(request);
      return response(request);
    },
  };
}

/** One noul answer per question id in the request, from a fixed id -> score table. */
const nouls =
  (scores: Record<string, number>) =>
  (request: JevRequest): JevResponse => ({
    model: "jev-test",
    answers: Object.fromEntries(
      Object.keys(request.questions).map((id) => [id, { type: "noul" as const, noul: scores[id] }]),
    ),
  });

const input = { goal: GOAL, rubric: RUBRIC, artifact: ARTIFACT, subjectDigest: SUBJECT };

test("one noul question per rubric dimension, keyed by dimension id", async () => {
  const { evaluateFn, seen } = fake(nouls({ solves: 0.9, evidence: 0.7 }));
  await jevScorer({ evaluateFn }).score(input);
  assert.equal(seen.length, 1, "one request per artifact");
  const [request] = seen;
  assert.deepEqual(Object.keys(request.questions).sort(), ["evidence", "solves"]);
  for (const dimension of RUBRIC) {
    const question = request.questions[dimension.id];
    assert.equal(question.type, "noul");
    assert.ok(textOf(question.instructions).includes(dimension.statement), "the statement reaches the question");
  }
});

test("state carries the goal, the artifact and the subject digest", async () => {
  const { evaluateFn, seen } = fake(nouls({ solves: 0.5, evidence: 0.5 }));
  await jevScorer({ evaluateFn }).score(input);
  assert.deepEqual(seen[0].state, { goal: GOAL, artifact: ARTIFACT, subjectDigest: SUBJECT });
});

test("noul answers map to dimensions and the scorer names the model", async () => {
  const { evaluateFn } = fake(nouls({ solves: 0.9, evidence: 0.7 }));
  const scored = await jevScorer({ evaluateFn }).score(input);
  assert.deepEqual(scored.dimensions, [
    { id: "solves", score: 0.9 },
    { id: "evidence", score: 0.7 },
  ]);
  assert.equal(scored.scorer, "jev-test");
  for (const dimension of RUBRIC) {
    assert.ok(scored.rationale.includes(dimension.id), "the rationale names " + dimension.id);
  }
});

test("a model override reaches pi-jev", async () => {
  const { evaluateFn, seen } = fake(nouls({ solves: 0.5, evidence: 0.5 }));
  await jevScorer({ evaluateFn, model: "jev-1.14.0" }).score(input);
  assert.equal(seen[0].model, "jev-1.14.0");
});

test("a pi-jev throw propagates out of score", async () => {
  const evaluateFn = async (_request: JevRequest): Promise<JevResponse> => {
    throw new Error("TypeSafe HTTP 401");
  };
  await assert.rejects(() => jevScorer({ evaluateFn }).score(input), /TypeSafe HTTP 401/);
});

test("through evaluateArtifact a pi-jev throw is a fail-closed error verdict", async () => {
  const evaluateFn = async (_request: JevRequest): Promise<JevResponse> => {
    throw new Error("TypeSafe returned an invalid typed response");
  };
  const quality: Quality = { dimensions: RUBRIC, threshold: 0.6, policy: "required" };
  const verdict = await evaluateArtifact(jevScorer({ evaluateFn }), quality, { goal: GOAL, artifact: ARTIFACT });
  assert.equal(verdict.decision, "unavailable");
  assert.equal(verdict.source, "error");
  assert.equal(verdict.score, 0);
  assert.match(verdict.rationale, /invalid typed response/);
});
