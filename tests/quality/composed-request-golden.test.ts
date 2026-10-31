/**
 * T3 — the backward-compatibility guarantee (R19).
 *
 * The fixture was captured from the PRE-T3 scorer with research v5 (no order, no targeting), so this
 * test compares the shipped adapter's request against what it sent before the slice: byte for byte.
 * If the composed scorer ever starts sending something extra to an unanchored, untargeted task, this
 * fails.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { JevRequest, JevResponse } from "pi-jev";
import { jevScorer } from "../../src/quality/jev-scorer.ts";

const FIXTURE = new URL("./fixtures/scoring-request.v5.json", import.meta.url).pathname;

const task = JSON.parse(readFileSync(new URL("../../.pi/praxis/tasks/discovery/research.json", import.meta.url).pathname, "utf8")) as {
  goal: string;
  quality: { dimensions: unknown[] };
};

/** The same artifact the fixture was captured with. */
const ARTIFACT = {
  contract: "the finding answers the question that was asked",
  question: "does a refusal after the attempt budget still record the verdict?",
  sources: [{ source: "src/runner/engine/advance.ts", location: "52-60", establishes: "a refusal is recorded then raised" }],
  findings: "the verdict is recorded before the refusal is raised",
  affected: "src/runner/engine/quality-loop.ts",
  uncertainty: "none observed",
};
const SUBJECT_DIGEST = "sha256:" + "a".repeat(64);

test("R19: v5 without order or sections sends the byte-identical request", async () => {
  const seen: JevRequest[] = [];
  const evaluateFn = async (request: JevRequest): Promise<JevResponse> => {
    seen.push(request);
    const answers: Record<string, unknown> = {};
    for (const [id, question] of Object.entries(request.questions)) {
      if (question.type === "noul") answers[id] = { type: "noul", noul: 0.9 };
      else if (question.type === "score") answers[id] = { type: "score", score: question.criteria.length - 1 };
      else answers[id] = { type: "choice", choice: Object.keys(question.criteria as Record<string, string>)[0] };
    }
    return { model: "fake/jev", answers } as JevResponse;
  };

  await jevScorer({ evaluateFn }).score({
    goal: task.goal,
    rubric: task.quality.dimensions as never,
    artifact: ARTIFACT,
    subjectDigest: SUBJECT_DIGEST,
  });

  assert.equal(seen.length, 1, "one request, as today");
  const sent = JSON.stringify(seen[0], null, 2) + "\n";
  const golden = readFileSync(FIXTURE, "utf8");
  assert.equal(sent, golden, "the request is byte-identical to the pre-T3 capture");
});
