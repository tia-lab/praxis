/**
 * The verdict rationale (verdict-rationale D1-D13, R1-R13): the per-dimension jev battery.
 *
 * Everything here is deterministic: the scoring and battery calls go through an injected `evaluateFn`
 * (the same seam the alignment gate uses), and the store cases use a temp workspace. No network.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { JevRequest, JevResponse } from "pi-jev";
import { QualitySchema, QualityVerdictSchema, type Quality } from "../../src/types/schema.ts";
import { evaluateArtifact, type Scorer } from "../../src/quality/index.ts";
import { jevScorer, RATIONALE_DIVERGENCE, RATIONALE_MAX, rationaleFor } from "../../src/quality/jev-scorer.ts";
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

/** A fake pi-jev: records each request and answers by question type. */
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

/** The scoring answers: a plain noul per dimension id. */
const scoreAnswer = (scores: Record<string, number>) => (id: string) => ({ type: "noul", noul: scores[id] ?? 0.9 });

/** The battery answers: driven per probe key. */
const probeAnswers = (answers: Record<string, unknown>) => (id: string) => answers[id] ?? { type: "noul", noul: 0.9 };

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
  const nine = [
    ...eight, 9,
  ];
  const over = { ...base, dimensions: [...eight, { id: "d9", statement: "s", probes: [{ id: "p", type: "noul", instructions: "x" }] }] };
  assert.equal(QualitySchema.safeParse(over).success, false, "49 probes is refused");
  void nine;
});

test("R2/R3/R12: one scoring call (byte-identical) then ONE battery call, no scores in its state", async () => {
  const jev = fakeJev((id, request) => {
    if (request.questions[id].type === "noul") return scoreAnswer({ parsimony: 0.9, grounded: 0.9 })(id);
    return probeAnswers({
      "parsimony.redundant": { type: "noul", noul: 0.9 },
      "parsimony.deletable": { type: "score", score: 2 },
      "parsimony.main-issue": { type: "choice", choice: "one-issue" },
    })(id);
  });
  const scorer = jevScorer({ evaluateFn: jev.evaluateFn });
  const verdict = await evaluateArtifact(scorer, QUALITY, { goal: "g", artifact: { a: 1 } });

  assert.equal(jev.calls.length, 2, "one scoring call and one battery call");
  const [score, battery] = jev.calls;
  // R2: the scoring request is exactly today's: the dimension ids, noul questions, the state, no probes.
  assert.deepEqual(Object.keys(score.questions).sort(), ["grounded", "parsimony"]);
  for (const id of Object.keys(score.questions)) assert.equal(score.questions[id].type, "noul");
  // Today's state shape, unchanged: goal, artifact, subjectDigest (present even when undefined).
  assert.deepEqual(Object.keys(score.state as object).sort(), ["artifact", "goal", "subjectDigest"]);
  assert.equal(
    (score.questions.parsimony as { instructions: string }).instructions,
    "Judge the artifact strictly against this standard; answer the probability it is fully satisfied: every included item earns its place",
    "the scoring instruction is unchanged",
  );
  // R3: one battery request, <dim>.<probe> ids, and NO score in its state.
  assert.deepEqual(Object.keys(battery.questions).sort(), ["parsimony.deletable", "parsimony.main-issue", "parsimony.redundant"]);
  assert.equal(JSON.stringify(battery.state).includes("0.9"), false, "the battery does not see the scoring numbers");
  assert.deepEqual(verdict.dimensions.map((d) => d.id), ["parsimony", "grounded"]);
  assert.equal(verdict.dimensions[0].diagnosis?.length, 3, "the structured answers are recorded");
  assert.equal(verdict.dimensions[1].diagnosis, undefined, "a dimension without probes has none");
});

test("R4/R7: a bad battery answer changes nothing; a throwing battery changes nothing", async () => {
  const good = fakeJev((id, request) =>
    request.questions[id].type === "noul" ? { type: "noul", noul: 0.9 } : { type: "noul", noul: 0.1 },
  );
  const broken = fakeJev((id, request) =>
    request.questions[id].type === "noul" ? { type: "noul", noul: 0.9 } : { type: "score", score: 0 },
  );
  // A battery-only outage: the scoring questions (dimension ids) still answer, the probes (dotted ids) fail.
  const down = fakeJev((id) => {
    if (id.includes(".")) throw new Error("jev is down");
    return { type: "noul", noul: 0.9 };
  });
  const plain: Scorer = { score: jevScorer({ evaluateFn: good.evaluateFn }).score };
  const strip = (verdict: { dimensions: { id: string; score: number; key?: string }[]; [key: string]: unknown }) => JSON.stringify(verdict);

  const without = await evaluateArtifact(plain, QUALITY, { goal: "g", artifact: {} });
  const withBroken = await evaluateArtifact(jevScorer({ evaluateFn: broken.evaluateFn }), QUALITY, { goal: "g", artifact: {} });
  const withDown = await evaluateArtifact(jevScorer({ evaluateFn: down.evaluateFn }), QUALITY, { goal: "g", artifact: {} });

  assert.deepEqual(withBroken, without, "an unreadable battery leaves the verdict byte-identical");
  assert.deepEqual(withDown, without, "a throwing battery leaves the verdict byte-identical");
  assert.deepEqual(
    { decision: withBroken.decision, score: withBroken.score, mean: withBroken.mean, flagged: withBroken.flagged },
    { decision: without.decision, score: without.score, mean: without.mean, flagged: without.flagged },
  );
  assert.equal(strip(withBroken).includes("diagnosis"), false);
});

test("R5: rendering is bounded, deterministic and never invents a clause", () => {
  const dimension = RUBRIC[0];
  const dirty = [
    { probe: "redundant", answer: 0.2 },
    { probe: "deletable", answer: 1 },
    { probe: "main-issue", answer: "padded" },
  ];
  const line = rationaleFor(dimension, dirty, true);
  assert.ok(line, "a dirty battery renders a line");
  assert.equal(line, rationaleFor(dimension, dirty, true), "the same answers render the same string");
  assert.ok(line!.startsWith("parsimony: "));
  assert.ok(line!.includes("some material could go") && line!.includes("pads with unused material"), line!);
  assert.ok(line!.length <= RATIONALE_MAX);

  const clean = [
    { probe: "redundant", answer: 0.9 },
    { probe: "deletable", answer: 2 },
    { probe: "main-issue", answer: "one-issue" },
  ];
  assert.equal(rationaleFor(dimension, clean, false), undefined, "clean and above the bar: nothing to say");
  assert.equal(
    rationaleFor(dimension, clean, true),
    "parsimony: " + RATIONALE_DIVERGENCE,
    "clean but below the bar: the divergence clause (D11)",
  );
  assert.equal(rationaleFor({ id: "grounded" }, clean, true), undefined, "no probes: never the divergence clause");
  assert.equal(
    rationaleFor(dimension, [{ probe: "redundant", answer: 0.1 }, { probe: "main-issue", answer: "nonsense" }], true),
    "parsimony: not satisfied: No included item repeats another.",
    "an unknown answer is omitted, never invented",
  );
  // Three clauses at most.
  const many = rationaleFor(
    { id: "d", probes: Array.from({ length: 6 }, (_, index) => ({ id: "p" + index, type: "noul" as const, instructions: "q" + index })) },
    Array.from({ length: 6 }, (_, index) => ({ probe: "p" + index, answer: 0.1 })),
    false,
  );
  assert.equal(many!.split("; ").length, 3, "never more than three clauses");
});

test("R6: the verdict carries diagnosis/rationale, and an OLD verdict still parses", async () => {
  const jev = fakeJev((id, request) => {
    const question = request.questions[id];
    if (question.type !== "score" && question.type !== "choice" && !id.includes(".")) return { type: "noul", noul: 0.9 };
    // The battery: one dirty probe of each kind, so a line is rendered.
    if (question.type === "score") return { type: "score", score: 0 };
    if (question.type === "choice") return { type: "choice", choice: "padded" };
    return { type: "noul", noul: 0.1 };
  });
  const verdict = await evaluateArtifact(jevScorer({ evaluateFn: jev.evaluateFn }), QUALITY, { goal: "g", artifact: {} });
  assert.ok(verdict.dimensions[0].rationale, "the rendered line is on the verdict");
  assert.ok(verdict.dimensions[0].diagnosis && verdict.dimensions[0].diagnosis.length === 3);
  assert.equal(QualityVerdictSchema.safeParse(verdict).success, true);
  // An old payload (no new fields) still parses, and the ruler digest ignores the evidence entirely.
  const old = {
    decision: "pass",
    score: 0.9,
    dimensions: [{ id: "grounded", score: 0.9 }],
    rationale: "model noul: grounded=0.90",
    rubricDigest: verdict.rubricDigest,
    scorer: "fake/jev",
    source: "jev",
  };
  assert.equal(QualityVerdictSchema.safeParse(old).success, true, "a pre-unit verdict parses unchanged");
  // Probes ARE part of the ruler (D9), so a rubric with them digests differently from the same rubric
  // without — while the verdict's evidence never enters the digest at all.
  const withoutProbes = await evaluateArtifact(
    jevScorer({ evaluateFn: fakeJev((id, request) => (request.questions[id].type === "noul" ? { type: "noul", noul: 0.9 } : { type: "noul", noul: 0.9 })).evaluateFn }),
    { ...QUALITY, dimensions: RUBRIC.map(({ id, statement, floor }) => ({ id, statement, floor })) },
    { goal: "g", artifact: {} },
  );
  assert.notEqual(verdict.rubricDigest, withoutProbes.rubricDigest, "probes change the ruler digest");
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
  assert.equal(applyBounds([candidate], 3).length, 1, "fits without a rationale");
  // 240 chars ≈ 68 tokens: with a second case the budget must now stop earlier than it would alone.
  const second = { ...candidate, instance: "i2", rationale: long };
  const kept = applyBounds([withLine, second], 3, 120);
  assert.ok(kept.length <= 1, "the rationale is paid for in the budget: " + kept.length);
  assert.equal(kept[0]?.rationale, long, "and it is carried onto the payload case");
});
