/**
 * The verdict rationale (verdict-rationale D1-D13, re-pinned for the compose slice): the criteria now
 * DECIDE, so the same answers that produce a dimension's score produce its why, in ONE call.
 *
 * Everything here is deterministic: every call goes through an injected `evaluateFn` (the same seam
 * the alignment gate uses), and the store cases use a temp workspace. No network.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { JevRequest, JevResponse } from "pi-jev";
import { QualitySchema, QualityVerdictSchema, type Quality } from "../../src/types/schema.ts";
import { evaluateArtifact } from "../../src/quality/index.ts";
import { jevScorer, RATIONALE_MAX, rationaleFrom } from "../../src/quality/jev-scorer.ts";
import { applyBounds } from "../../src/quality/ranker.ts";

const RUBRIC = [
  { id: "parsimony", statement: "every included item earns its place", floor: 0.6, probes: [
      { id: "redundant", type: "noul" as const, instructions: "No included item repeats another." },
      { id: "deletable", type: "score" as const, instructions: "How much could be removed?",
        criteria: ["large parts could go", "some material could go", "nothing could go"] },
      { id: "main-issue", type: "choice" as const, instructions: "Does it keep to one issue?",
        criteria: { "one-issue": "one issue throughout", drifted: "drifts into adjacent issues", padded: "pads with unused material" },
        clean: "one-issue" },
    ] },
  { id: "grounded", statement: "every claim is tied to a source", floor: 0.6 },
];
const QUALITY: Quality = { dimensions: RUBRIC, threshold: 0.6, policy: "required" };

/** A fake pi-jev: records each request and answers by the question it was asked. */
function fakeJev(answer: (id: string, request: JevRequest) => unknown) {
  const calls: JevRequest[] = [];
  const evaluateFn = async (request: JevRequest): Promise<JevResponse> => {
    calls.push(request);
    const answers: Record<string, unknown> = {};
    for (const id of Object.keys(request.questions)) answers[id] = answer(id, request);
    return { model: "fake/jev", answers, usage: { input_tokens: 5, output_tokens: 3 } } as JevResponse;
  };
  return { evaluateFn, calls };
}

/** Clean answers for every criterion: the top level, the clean option, a high probability. */
const clean = (id: string, request: JevRequest): unknown => {
  const question = request.questions[id];
  if (question.type === "choice") return { type: "choice", choice: "one-issue" };
  if (question.type === "score") return { type: "score", score: 2 };
  return { type: "noul", noul: 0.9 };
};

test("R1: the probe battery parses, and its caps and shapes are enforced at parse", () => {
  const base = { threshold: 0.6, policy: "required" as const };
  const one = (probes: unknown[]) => ({ ...base, dimensions: [{ id: "d", statement: "s", probes }] });
  assert.equal(QualitySchema.safeParse(one([{ id: "p", type: "noul", instructions: "x" }])).success, true);
  assert.equal(
    QualitySchema.safeParse(one([{ id: "p", type: "choice", instructions: "x", criteria: { a: "A", b: "B" }, clean: "b" }])).success,
    true,
    "a well-formed choice probe parses",
  );
  // Caps.
  const seven = Array.from({ length: 7 }, (_, index) => ({ id: "p" + index, type: "noul", instructions: "x" }));
  assert.equal(QualitySchema.safeParse(one(seven)).success, false, "7 probes on one dimension is refused");
  assert.equal(QualitySchema.safeParse(one([{ id: "p", type: "noul", instructions: "x" }, { id: "p", type: "noul", instructions: "y" }])).success, false, "duplicate probe ids are refused");
  // Shapes.
  assert.equal(QualitySchema.safeParse(one([{ id: "p", type: "choice", instructions: "x", criteria: { a: "A", b: "B" } }])).success, false, "a choice probe without a clean option is refused");
  assert.equal(QualitySchema.safeParse(one([{ id: "p", type: "choice", instructions: "x", criteria: { a: "A", b: "B" }, clean: "z" }])).success, false, "a clean option outside the criteria is refused");
  assert.equal(QualitySchema.safeParse(one([{ id: "p", type: "score", instructions: "x", criteria: ["only one level"] }])).success, false, "a score probe with one level is refused");
  assert.equal(QualitySchema.safeParse(one([{ id: "p", type: "noul", instructions: "x", criteria: { a: "A" } }])).success, false, "a noul probe with criteria is refused");
  // Total cap across the rubric.
  const eight = Array.from({ length: 8 }, (_, index) => ({
    id: "d" + index,
    statement: "s",
    probes: Array.from({ length: 6 }, (_, probe) => ({ id: "p" + probe, type: "noul", instructions: "x" })),
  }));
  assert.equal(QualitySchema.safeParse({ ...base, dimensions: eight }).success, true, "48 probes is the ceiling and parses");
  const over = { ...base, dimensions: [...eight, { id: "d9", statement: "s", probes: [{ id: "p", type: "noul", instructions: "x" }] }] };
  assert.equal(QualitySchema.safeParse(over).success, false, "49 probes is refused");
});

test("R2/R3/R12: ONE composed call carries every criterion and every witness", async () => {
  const jev = fakeJev(clean);
  const verdict = await evaluateArtifact(jevScorer({ evaluateFn: jev.evaluateFn }), QUALITY, { goal: "g", artifact: { a: 1 } });

  assert.equal(jev.calls.length, 1, "exactly one request per submission (D7, R10)");
  const [request] = jev.calls;
  assert.deepEqual(
    Object.keys(request.questions).sort(),
    ["grounded", "parsimony.__statement", "parsimony.deletable", "parsimony.main-issue", "parsimony.redundant"],
    "every criterion plus one witness, and the criteria-less dimension by its own id",
  );
  // The witness asks exactly what the retired scoring call asked, so the statement is still judged.
  assert.equal(
    (request.questions["parsimony.__statement"] as { instructions: string }).instructions,
    "Judge the artifact strictly against this standard; answer the probability it is fully satisfied: every included item earns its place",
    "the witness instruction is unchanged",
  );
  assert.equal(request.questions.redundant === undefined, true, "criteria never collide with a dimension id");
  assert.deepEqual(Object.keys(request.state as object).sort(), ["artifact", "goal", "subjectDigest"], "today's state shape");

  assert.deepEqual(verdict.dimensions.map((d) => d.id), ["parsimony", "grounded"]);
  assert.equal(verdict.dimensions[0].diagnosis?.length, 3, "the structured answers are recorded");
  assert.equal(verdict.dimensions[0].bound, "redundant", "all clean: the first criterion in declared order binds");
  assert.equal(verdict.dimensions[0].statementScore, 0.9, "the witness is recorded beside the composition");
  assert.equal(verdict.dimensions[1].diagnosis, undefined, "a dimension without criteria records none");
  assert.equal(verdict.dimensions[1].bound, undefined, "and has no binding criterion");
});

test("R4/R7: an unreadable criterion answer is a fail-closed error, never a fabricated score", async () => {
  const broken = fakeJev((id, request) => {
    const question = request.questions[id];
    // A mistyped answer for a score criterion: the client would accept the type the question asked,
    // so this is the judge answering the wrong kind — an error, never a silently smaller minimum.
    if (question.type === "score") return { type: "noul", noul: 0.5 };
    return clean(id, request);
  });
  const failed = await evaluateArtifact(jevScorer({ evaluateFn: broken.evaluateFn }), QUALITY, { goal: "g", artifact: {} });
  assert.equal(failed.decision, "unavailable", "the fail-closed path, not a pass");
  assert.equal(failed.source, "error");
  assert.deepEqual(failed.dimensions, [], "no fabricated dimension survives");
  assert.match(failed.rationale, /mistyped|not a noul/, "the reason names the unreadable answer");

  // The same failure leaves a criteria-less rubric untouched: it has one witness-free noul, as before.
  const plain: Quality = { dimensions: [RUBRIC[1]!], threshold: 0.6, policy: "required" };
  const ok = await evaluateArtifact(jevScorer({ evaluateFn: fakeJev(clean).evaluateFn }), plain, { goal: "g", artifact: {} });
  assert.equal(ok.decision, "pass");
  assert.deepEqual(ok.dimensions.map((d) => [d.id, d.score]), [["grounded", 0.9]]);
});

test("R5: rendering is bounded, deterministic and never invents a clause", () => {
  const dimension = RUBRIC[0];
  const dirty = [
    { probe: "redundant", answer: 0.2 },
    { probe: "deletable", answer: 1 },
    { probe: "main-issue", answer: "padded" },
  ];
  const line = rationaleFrom(dimension, dirty, "main-issue");
  assert.ok(line, "a dirty composition renders a line");
  assert.equal(line, rationaleFrom(dimension, dirty, "main-issue"), "the same answers render the same string");
  assert.ok(line!.startsWith("parsimony: "));
  assert.ok(line!.startsWith("parsimony: pads with unused material"), "the binding criterion comes first: " + line);
  assert.ok(line!.includes("some material could go") && line!.includes("not satisfied: No included item repeats another."), line!);
  assert.ok(line!.length <= RATIONALE_MAX);

  const cleanAnswers = [
    { probe: "redundant", answer: 0.9 },
    { probe: "deletable", answer: 2 },
    { probe: "main-issue", answer: "one-issue" },
  ];
  assert.equal(rationaleFrom(dimension, cleanAnswers, "redundant"), undefined, "clean: nothing to say here");
  assert.equal(rationaleFrom({ id: "grounded" }, cleanAnswers), undefined, "no criteria: never a clause");
  assert.equal(
    rationaleFrom(dimension, [{ probe: "redundant", answer: 0.1 }, { probe: "main-issue", answer: "nonsense" }], "redundant"),
    "parsimony: not satisfied: No included item repeats another.",
    "an unknown answer is omitted, never invented",
  );
  // Three clauses at most.
  const many = rationaleFrom(
    { id: "d", probes: Array.from({ length: 6 }, (_, index) => ({ id: "p" + index, type: "noul" as const, instructions: "q" + index })) },
    Array.from({ length: 6 }, (_, index) => ({ probe: "p" + index, answer: 0.1 })),
    "p0",
  );
  assert.equal(many!.split("; ").length, 3, "never more than three clauses");
  assert.ok(many!.length <= RATIONALE_MAX);
});

test("R6: the verdict carries diagnosis/rationale, and an OLD verdict still parses", async () => {
  const jev = fakeJev((id, request) => {
    const question = request.questions[id];
    // One dirty criterion of each kind, so a line is rendered from the answers that set the score.
    if (question.type === "score") return { type: "score", score: 0 };
    if (question.type === "choice") return { type: "choice", choice: "padded" };
    return { type: "noul", noul: 0.1 };
  });
  const verdict = await evaluateArtifact(jevScorer({ evaluateFn: jev.evaluateFn }), QUALITY, { goal: "g", artifact: {} });
  assert.ok(verdict.dimensions[0].rationale, "the rendered line is on the verdict");
  assert.ok(verdict.dimensions[0].diagnosis && verdict.dimensions[0].diagnosis.length === 3);
  assert.equal(verdict.dimensions[0].score, 0, "the non-clean choice is the composed minimum");
  assert.equal(QualityVerdictSchema.safeParse(verdict).success, true);
  // An old payload (no composed fields) still parses: recorded verdicts are never backfilled.
  const old = {
    decision: "pass",
    score: 0.9,
    dimensions: [{ id: "grounded", score: 0.9 }],
    rationale: "model noul: grounded=0.90",
    rubricDigest: verdict.rubricDigest,
    scorer: "fake/jev",
    source: "jev",
  };
  assert.equal(QualityVerdictSchema.safeParse(old).success, true, "a pre-compose verdict parses unchanged");
  // Criteria ARE part of the ruler, so a rubric with them digests differently from the same rubric
  // without — while the verdict's evidence never enters the digest at all.
  const withoutCriteria = await evaluateArtifact(
    jevScorer({ evaluateFn: fakeJev(clean).evaluateFn }),
    { ...QUALITY, dimensions: RUBRIC.map(({ id, statement, floor }) => ({ id, statement, floor })) },
    { goal: "g", artifact: {} },
  );
  assert.notEqual(verdict.rubricDigest, withoutCriteria.rubricDigest, "criteria change the ruler digest");
  assert.equal(verdict.rubricDigest, QualityVerdictSchema.parse(verdict).rubricDigest);
});

test("R12: the budget counts the exemplar's rationale, so the bound still holds", () => {
  const candidate = {
    instance: "i1", step: "make", version: 1, task: "tasks/make", taskVersion: 1, digest: "sha256:" + "a".repeat(64),
    outcome: "pass" as const, score: 0.9, mean: 0.9, flagged: [], writtenBy: "a", at: "2026-10-30T00:00:00.000Z",
    lesson: { whatWrong: "w", whatRight: "r", whatBetter: "b", tags: [] },
    rationales: new Map(),
    signals: { barThen: 0.6, levels: 0, corroborationBy: new Map() },
    score2: 0.9, relevance: { need: 0.5, outcome: 0.5, corroboration: 0, recency: 0.5, margin: 0.5 }, reason: "need=0.50",
  };
  const long = "x".repeat(RATIONALE_MAX);
  const withLine = { ...candidate, rationale: long };
  // Cleared screens, so the budget is spent on TEXT: an unscreened case is withheld (S4, R27).
  const cleared = (case1: typeof candidate) => new Map([[case1.instance + "/" + case1.step + "/" + String(case1.version), { passed: true }]]);
  assert.equal(applyBounds([candidate], 3, 1200, cleared(candidate)).length, 1, "fits without a rationale");
  // 240 chars ≈ 68 tokens: with a second case the budget must now stop earlier than it would alone.
  const second = { ...candidate, instance: "i2", rationale: long };
  const both = new Map([
    [withLine.instance + "/" + withLine.step + "/" + String(withLine.version), { passed: true }],
    [second.instance + "/" + second.step + "/" + String(second.version), { passed: true }],
  ]);
  const kept = applyBounds([withLine, second], 3, 120, both);
  assert.ok(kept.length <= 1, "the rationale is paid for in the budget: " + kept.length);
  assert.equal(kept[0]?.rationale, long, "and it is carried onto the payload case");
});
