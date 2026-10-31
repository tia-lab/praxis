/**
 * Slice 5, the explained rerank (R29-R32): three `noul`s per candidate replace one opaque `score`,
 * combined by FROZEN constants, so the ordering says WHICH property won. The Jaccard collapse and the
 * payload bound are unchanged.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { JevRequest, JevResponse } from "pi-jev";
import {
  DISTINCT_CRITERIA,
  WEIGHT_DISTINCT,
  WEIGHT_READABLE,
  WEIGHT_USEFUL,
  jevRanker,
  weightedTotal,
} from "../../src/quality/ranker-jev.ts";
import { JEV_POOL, applyBounds } from "../../src/quality/index.ts";

/** A ranked candidate stand-in: only what the stage-2 ranker reads. */
function candidate(index: number, whatBetter: string, score2 = 0.9) {
  return {
    instance: "i" + index,
    task: "tasks/make",
    taskVersion: 1,
    step: "make",
    version: 1,
    digest: "sha256:" + String(index).padStart(64, "a"),
    outcome: "pass" as const,
    score: score2,
    mean: score2,
    flagged: [],
    rationales: new Map<string, string>(),
    writtenBy: "a",
    at: "2026-10-30T00:00:0" + String(index % 10) + ".000Z",
    lesson: { whatWrong: "w" + index, whatRight: "r" + index, whatBetter, tags: [{ dimension: "solves", lesson: whatBetter }] },
    signals: { barThen: 0.6, levels: 0, corroborationBy: new Map<string, number>() },
    score2,
    relevance: { need: 0.5, outcome: 0.5, corroboration: 0, recency: 0.5, margin: 0.5 },
    reason: "need=0.50",
  };
}

/** A fake judge: `value(candidateIndex, criterion)` per noul, in ONE call. */
function judge(value: (index: number, criterion: string) => number) {
  const calls: JevRequest[] = [];
  const evaluateFn = async (request: JevRequest): Promise<JevResponse> => {
    calls.push(request);
    const answers: Record<string, { type: "noul"; noul: number }> = {};
    for (const id of Object.keys(request.questions)) {
      const cut = id.lastIndexOf(".");
      answers[id] = { type: "noul", noul: value(Number(id.slice(1, cut)), id.slice(cut + 1)) };
    }
    return { model: "fake/jev", answers } as JevResponse;
  };
  return { evaluateFn, calls };
}

const rank = (ranked: readonly ReturnType<typeof candidate>[], evaluateFn: typeof fetch | unknown, max = 5) =>
  jevRanker({ evaluateFn: evaluateFn as never }).rankDistinct({
    need: { text: "stuck on structure", tags: ["solves"] },
    ranked: ranked as never,
    max,
  });

test("R29: three nouls per pooled candidate, ids c<index>.<criterion>", async () => {
  assert.equal(DISTINCT_CRITERIA.length, 3);
  const fake = judge(() => 0.5);
  const pool = Array.from({ length: JEV_POOL }, (_, index) => candidate(index, "lesson " + index));
  await rank(pool, fake.evaluateFn);
  assert.equal(fake.calls.length, 1, "one call, never one per candidate");
  const ids = Object.keys(fake.calls[0]!.questions);
  assert.equal(ids.length, JEV_POOL * 3, "three questions per pooled candidate");
  assert.ok(ids.length <= 60, "at most 60 questions at the 20-candidate pool: " + ids.length);
  for (const criterion of DISTINCT_CRITERIA) {
    assert.ok(ids.includes("c0." + criterion.id), "candidate 0 asks " + criterion.id);
  }
  // A missing answer makes the stage unavailable rather than partly ordered (R30's failure behaviour).
  const partial = async (request: JevRequest): Promise<JevResponse> => {
    const answers: Record<string, unknown> = {};
    const ids2 = Object.keys(request.questions);
    ids2.slice(1).forEach((id) => {
      answers[id] = { type: "noul", noul: 0.5 };
    });
    return { model: "fake", answers } as JevResponse;
  };
  await assert.rejects(() => rank([candidate(0, "only one")], partial));
});

test("R30: the order is the weighted sum of frozen constants", async () => {
  assert.ok(Math.abs(WEIGHT_DISTINCT + WEIGHT_USEFUL + WEIGHT_READABLE - 1) < 1e-9, "the weights sum to 1");
  assert.equal(weightedTotal({ distinct: 0.9, useful: 0.3, readable: 0.8 }), 0.5 * 0.9 + 0.3 * 0.3 + 0.2 * 0.8);
  const pool = [candidate(0, "alpha lesson", 0.9), candidate(1, "beta lesson", 0.5), candidate(2, "gamma lesson", 0.7)];
  // Candidate 1 is strongest on distinctness, candidate 2 on usefulness.
  const fake = judge((index, criterion) => {
    if (index === 1) return criterion === "distinct" ? 0.9 : 0.1;
    if (index === 2) return criterion === "useful" ? 0.9 : 0.2;
    return 0.3;
  });
  const outcome = await rank(pool, fake.evaluateFn, 3);
  assert.equal(outcome.chosen.length, 3);
  const totals = outcome.chosen.map((pick) => pick.total ?? 0);
  assert.deepEqual([...totals].sort((a, b) => b - a), totals, "descending by the weighted sum");
  // Reordering the INPUT changes no ordering value: the weights are not positional.
  const reversed = await rank([...pool].reverse(), judge((index, criterion) => {
    const original = pool.length - 1 - index;
    if (original === 1) return criterion === "distinct" ? 0.9 : 0.1;
    if (original === 2) return criterion === "useful" ? 0.9 : 0.2;
    return 0.3;
  }).evaluateFn, 3);
  assert.deepEqual(
    [...reversed.chosen.map((pick) => pick.total ?? 0)].sort((a, b) => b - a),
    [...totals].sort((a, b) => b - a),
    "the same candidates score the same whatever order they arrive in",
  );
  // Ties break by the deterministic score, then by id, never by the model.
  const tied = await rank([candidate(0, "first lesson", 0.95), candidate(1, "second lesson", 0.6)], judge(() => 0.5).evaluateFn, 2);
  assert.deepEqual(tied.chosen.map((pick) => pick.case.instance), ["i0", "i1"], "the higher deterministic score first");
});

test("R31: each chosen case reports its trio and the total", async () => {
  const fake = judge((_index, criterion) => (criterion === "distinct" ? 0.9 : criterion === "useful" ? 0.3 : 0.8));
  const outcome = await rank([candidate(0, "one lesson")], fake.evaluateFn, 3);
  const picked = outcome.chosen[0]!;
  assert.deepEqual(picked.nouls, { distinct: 0.9, useful: 0.3, readable: 0.8 });
  assert.equal(picked.total, 0.5 * 0.9 + 0.3 * 0.3 + 0.2 * 0.8);
  // A noul has no distribution, so no mass is claimed anywhere in the disclosure.
  assert.equal(Object.keys(picked).includes("probabilities"), false);
  const [served] = applyBounds([picked.case as never], 3, 1200, undefined, new Map([[
    picked.case.instance + "/" + picked.case.step + "/" + String(picked.case.version),
    { nouls: picked.nouls, total: picked.total },
  ]]));
  assert.deepEqual(served!.nouls, picked.nouls, "the payload carries the trio");
  assert.equal(served!.total, picked.total);
});

test("R32: the Jaccard collapse and the payload budget still hold", async () => {
  const near = "name the failure mode before proposing the fix";
  const pool = [candidate(0, near, 0.99), candidate(1, near + " now", 0.98), candidate(2, "show the counterexample that would break the claim")];
  const fake = judge((index) => (index === 0 ? 0.95 : index === 1 ? 0.9 : 0.85));
  const outcome = await rank(pool, fake.evaluateFn, 3);
  assert.equal(outcome.chosen.length, 2, "the near-duplicate collapses into one exemplar");
  assert.deepEqual(outcome.chosen.map((pick) => pick.case.instance), ["i0", "i2"]);
  // The bound still cuts: three long cases against a small budget keep fewer.
  const long = Array.from({ length: 3 }, (_, index) => candidate(index, "detailed lesson ".repeat(40) + index));
  const served = applyBounds(long as never, 5, 60);
  assert.ok(served.length <= 1, "the token budget still bounds the payload: " + served.length);
});
