/**
 * The jev distinct-exemplar ranker and its persisted, lazily read-through cache (D1-D11, R1-R10).
 *
 * A fake `evaluateFn` stands in for pi-jev (the same seam the alignment gate injects), so every
 * case is deterministic and no test reaches the network.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { JevRequest, JevResponse } from "pi-jev";
import {
  DUPLICATE_JACCARD,
  JEV_CLIP,
  JEV_POOL,
  jevRanker,
  recallExperience,
  recallRanked,
  setDistinctRankerForTest,
  setRankedPersistForTest,
  setSingleFlightWaitForTest,
} from "../../src/quality/index.ts";
import { RecallRankedSchema } from "../../src/types/learning.ts";
import { setScreenForTest } from "../../src/quality/screen.ts";

/**
 * These cases are about the jev RANKING, so the instruction screen clears every case: the screen's
 * own behaviour is proved in `recall-screen.test.ts` (S4, R25-R27). Without a judge the recall
 * withholds every lesson's text, which would mask the ordering under test.
 */
setScreenForTest((async (request: JevRequest): Promise<JevResponse> => ({
  model: "fake/screen",
  answers: Object.fromEntries(Object.keys(request.questions).map((id) => [id, { type: "noul" as const, noul: 0.05 }])),
})) as never);
import {
  clock,
  dimensionScorer,
  dispose,
  eventsOf,
  judgedFlow,
  learningOptions,
  noteBody,
  recordNoteFor,
  startJudged,
  submitJudged,
  workspace,
  type Workspace,
} from "../testkit.ts";

/** A fake pi-jev: records every request and answers each question with the score it is given. */
function fakeJev(score: (index: number, request: JevRequest) => number = () => 0.5) {
  const calls: JevRequest[] = [];
  const evaluateFn = async (request: JevRequest): Promise<JevResponse> => {
    calls.push(request);
    const answers: Record<string, { type: "score"; score: number }> = {};
    Object.keys(request.questions).forEach((id, index) => {
      answers[id] = { type: "score", score: score(index, request) };
    });
    return { model: "fake/jev", answers, usage: { input_tokens: 11, output_tokens: 7 } };
  };
  return { evaluateFn, calls };
}

/** Seed one solved case (accepted + verdict + note) with the lesson text the case needs. */
async function seedCase(ws: Workspace, tick: () => string, requestId: string, lesson?: Record<string, unknown>): Promise<string> {
  const run = startJudged(ws, requestId, tick());
  await submitJudged(ws, run, tick(), 1, dimensionScorer([{ solves: 0.95, evidence: 0.95, trace: 0.95 }]));
  recordNoteFor(ws, run.instance, tick(), noteBody(lesson));
  return run.instance;
}

/** The recalled payload for one instance, with the cross-process wait disabled so no case sleeps. */
function recall(ws: Workspace, instance: string, input: { need: string; tags?: string[]; max?: number }) {
  return recallRanked({ ...learningOptions(ws, "2026-10-30T03:00:00.000Z"), instance, actor: "a" }, input);
}

function setup(): () => void {
  setSingleFlightWaitForTest(0);
  return () => {
    setSingleFlightWaitForTest(undefined);
    setDistinctRankerForTest(undefined);
    setRankedPersistForTest(undefined);
  };
}

const rankedEvents = (ws: Workspace, runs: readonly string[]) =>
  runs.flatMap((instance) => eventsOf(ws, instance).filter((event) => event.type === "recall.ranked"));

const jaccardOf = (left: string, right: string): number => {
  const tokens = (text: string) => new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word !== ""));
  const a = tokens(left);
  const b = tokens(right);
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
};

test("R1/R2: one evaluate call over at most JEV_POOL candidates, all score questions, clipped", async () => {
  const ws = workspace();
  const restore = setup();
  try {
    judgedFlow(ws);
    const tick = clock().next;
    const seeded: string[] = [];
    for (let index = 1; index <= JEV_POOL + 2; index += 1) {
      seeded.push(await seedCase(ws, tick, "pool-" + index));
    }
    const jev = fakeJev();
    setDistinctRankerForTest(jevRanker({ evaluateFn: jev.evaluateFn }));

    const payload = await recall(ws, seeded[0], { need: "stuck on structure", max: 3 });
    assert.equal(jev.calls.length, 1, "exactly one jev call");
    const request = jev.calls[0];
    const ids = Object.keys(request.questions);
    assert.equal(ids.length, JEV_POOL, "the pool is capped at 20 candidates");
    for (const id of ids) assert.equal(request.questions[id].type, "score", "every question is a score");
    const state = request.state as { cases: { whatBetter: string; whatWrong: string; whatRight: string; tags: { lesson: string }[] }[] };
    assert.equal(state.cases.length, JEV_POOL);
    for (const item of state.cases) {
      for (const field of [item.whatBetter, item.whatWrong, item.whatRight, ...item.tags.map((tag) => tag.lesson)]) {
        assert.ok(field.length <= JEV_CLIP, "no field exceeds the clip: " + field.length);
      }
    }
    assert.ok(payload.count <= 3, "bounded by max");
  } finally {
    restore();
    dispose(ws);
  }
});

test("R1/R5: a cold store makes no jev call and caches nothing", async () => {
  const ws = workspace();
  const restore = setup();
  try {
    judgedFlow(ws);
    const tick = clock().next;
    const run = startJudged(ws, "cold", tick());
    const jev = fakeJev();
    setDistinctRankerForTest(jevRanker({ evaluateFn: jev.evaluateFn }));

    const payload = await recall(ws, run.instance, { need: "nothing solved yet" });
    assert.equal(payload.count, 0);
    assert.equal(jev.calls.length, 0, "no cases, no jev call");
    assert.equal(rankedEvents(ws, [run.instance]).length, 0, "and nothing to cache");
  } finally {
    restore();
    dispose(ws);
  }
});

test("R3: near-duplicate lessons collapse, so the exemplars are substantively distinct", async () => {
  const ws = workspace();
  const restore = setup();
  try {
    judgedFlow(ws);
    const tick = clock().next;
    const echoes = "always cite a file and line for every claim";
    const instances: string[] = [];
    for (let index = 1; index <= 3; index += 1) {
      instances.push(await seedCase(ws, tick, "echo-" + index, { whatBetter: echoes, tags: [{ dimension: "solves", lesson: echoes }] }));
    }
    instances.push(await seedCase(ws, tick, "distinct-a", { whatBetter: "name the failure mode before proposing the fix", tags: [{ dimension: "solves", lesson: "name the failure first" }] }));
    instances.push(await seedCase(ws, tick, "distinct-b", { whatBetter: "show the counterexample that would break the claim", tags: [{ dimension: "solves", lesson: "show the counterexample" }] }));

    const jev = fakeJev(() => 0.5);
    setDistinctRankerForTest(jevRanker({ evaluateFn: jev.evaluateFn }));
    const payload = await recall(ws, instances[0], { need: "sources and structure", max: 3 });

    assert.equal(payload.count, 3, "three exemplars");
    const texts = payload.cases.map((item) => item.lesson.whatBetter);
    for (let left = 0; left < texts.length; left += 1) {
      for (let right = left + 1; right < texts.length; right += 1) {
        assert.ok(
          jaccardOf(texts[left], texts[right]) < DUPLICATE_JACCARD,
          "no two exemplars are the same guidance: " + texts[left] + " / " + texts[right],
        );
      }
    }
    assert.ok(texts.includes("name the failure mode before proposing the fix"), "the distinct ones are kept");
    assert.ok(texts.includes("show the counterexample that would break the claim"));
    assert.equal(texts.filter((text) => text === echoes).length, 1, "at most one of the identical set");
  } finally {
    restore();
    dispose(ws);
  }
});

test("R4/R5/R9: a fresh entry serves with zero jev calls; a new tag or a new case misses once", async () => {
  const ws = workspace();
  const restore = setup();
  try {
    judgedFlow(ws);
    const tick = clock().next;
    const first = await seedCase(ws, tick, "cache-1");
    const second = await seedCase(ws, tick, "cache-2");
    const jev = fakeJev();
    setDistinctRankerForTest(jevRanker({ evaluateFn: jev.evaluateFn }));

    const a = await recall(ws, first, { need: "stuck", tags: ["solves", "evidence"], max: 3 });
    assert.equal(jev.calls.length, 1, "a cold key computes once");
    const b = await recall(ws, second, { need: "stuck elsewhere", tags: ["evidence", "solves"], max: 3 });
    assert.equal(jev.calls.length, 1, "the same cover in another order is the same key: no new call");
    assert.deepEqual(b.cases.map((item) => item.provenance.instance), a.cases.map((item) => item.provenance.instance), "and it serves the cached order");

    await recall(ws, first, { need: "stuck", tags: ["solves", "evidence", "trace"], max: 3 });
    assert.equal(jev.calls.length, 2, "a different cover is a different key");

    await seedCase(ws, tick, "cache-3");
    await recall(ws, first, { need: "stuck", tags: ["solves", "evidence"], max: 3 });
    assert.equal(jev.calls.length, 3, "a new solved case moves the watermark and misses once");

    const entries = rankedEvents(ws, [first, second]).map((event) => event.payload);
    assert.equal(entries.length, 3, "one entry per computation, none for the cache hits");
    for (const payload of entries) {
      const parsed = RecallRankedSchema.safeParse(payload);
      assert.ok(parsed.success, "every entry parses: " + JSON.stringify(payload).slice(0, 200));
      assert.equal(parsed.data.rankedBy, "jev");
      assert.equal(parsed.data.model, "fake/jev");
      assert.deepEqual(parsed.data.usage, { input: 11, output: 7 });
      assert.ok(parsed.data.pool <= JEV_POOL);
    }
    assert.deepEqual(
      entries.map((payload) => (payload as { watermark: number }).watermark),
      [2, 2, 3],
      "the watermark is the solved-case count at computation time",
    );
  } finally {
    restore();
    dispose(ws);
  }
});

test("R5/R9: the second recall at the same watermark is identical and costs nothing", async () => {
  const ws = workspace();
  const restore = setup();
  try {
    judgedFlow(ws);
    const tick = clock().next;
    const instance = await seedCase(ws, tick, "same-1");
    await seedCase(ws, tick, "same-2");
    const jev = fakeJev();
    setDistinctRankerForTest(jevRanker({ evaluateFn: jev.evaluateFn }));

    const first = await recall(ws, instance, { need: "stuck", max: 3 });
    const second = await recall(ws, instance, { need: "stuck", max: 3 });
    assert.equal(jev.calls.length, 1);
    assert.deepEqual(second, first);
  } finally {
    restore();
    dispose(ws);
  }
});

test("R6: a failed cache write still returns the jev-ranked answer", async () => {
  const ws = workspace();
  const restore = setup();
  try {
    judgedFlow(ws);
    const tick = clock().next;
    const instance = await seedCase(ws, tick, "persist-1");
    const jev = fakeJev();
    setDistinctRankerForTest(jevRanker({ evaluateFn: jev.evaluateFn }));
    setRankedPersistForTest(() => {
      throw new Error("the cache write failed");
    });

    const payload = await recall(ws, instance, { need: "stuck", max: 3 });
    assert.equal(jev.calls.length, 1);
    assert.equal(payload.count, 1, "the answer exists regardless of the write");
    assert.equal(rankedEvents(ws, [instance]).length, 0, "nothing was persisted");
  } finally {
    restore();
    dispose(ws);
  }
});

test("R7: concurrent misses in one process share a single jev call", async () => {
  const ws = workspace();
  const restore = setup();
  try {
    judgedFlow(ws);
    const tick = clock().next;
    const instance = await seedCase(ws, tick, "flight-1");
    await seedCase(ws, tick, "flight-2");
    const jev = fakeJev();
    setDistinctRankerForTest(
      jevRanker({
        evaluateFn: async (request: JevRequest) => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return jev.evaluateFn(request);
        },
      }),
    );

    const [one, two] = await Promise.all([
      recall(ws, instance, { need: "stuck", max: 3 }),
      recall(ws, instance, { need: "stuck", max: 3 }),
    ]);
    assert.equal(jev.calls.length, 1, "one call for both");
    assert.deepEqual(one, two);
  } finally {
    restore();
    dispose(ws);
  }
});

test("R10: jev down serves the deterministic answer and caches nothing", async () => {
  const ws = workspace();
  const restore = setup();
  try {
    judgedFlow(ws);
    const tick = clock().next;
    const instance = await seedCase(ws, tick, "down-1");
    await seedCase(ws, tick, "down-2");
    setDistinctRankerForTest(
      jevRanker({
        evaluateFn: async () => {
          throw new Error("jev is down");
        },
      }),
    );

    const fell = await recall(ws, instance, { need: "stuck", max: 3 });
    const deterministic = recallExperience({ ...learningOptions(ws, "2026-10-30T03:00:00.000Z"), instance, actor: "a" }, { need: "stuck", max: 3 });
    assert.deepEqual(fell, deterministic, "the deterministic ranker answered");
    assert.equal(rankedEvents(ws, [instance]).length, 0, "nothing cached from a failure");
  } finally {
    restore();
    dispose(ws);
  }
});
