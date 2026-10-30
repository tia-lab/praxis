/**
 * The bounded experience query, R1–R10.
 *
 * A solved case is an accepted artifact, its judgment and a note that carries a lesson. The query
 * ranks those with the brief's OWN scorer (the caller's need standing in for the weak-set), bounds
 * the answer, and reads — never writes.
 *
 * NO NETWORK: the scorer and the ranker are injected fakes, and the judge is the aligned fake.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { executePraxisTool, setAlignJudgeForTest, setScorerForTest } from "../../src/pi/tool.ts";
import type { PiToolResult } from "../../src/pi/host.ts";
import {
  collectCases,
  deterministicRanker,
  recallExperience,
  recallFor,
  scoreCandidate,
  setRankerForTest,
  weakSetFor,
  type RankedCase,
  type RankerPort,
} from "../../src/quality/index.ts";
import type { Quality } from "../../src/types/schema.ts";

const QUALITY: Quality = { dimensions: LEARNING_RUBRIC, threshold: 0.6, policy: "required" };
import { openStore } from "../../src/store/db.ts";

import { query, type Workspace } from "../testkit.ts";
import {
  JUDGED_SCHEMA,
  LEARNING_RUBRIC,
  clock,
  dispose,
  learningOptions,
  noteBody,
  recordNoteFor,
  startJudged,
  submitJudged,
  workspace,
  writeFlow,
  type Workspace as TestWorkspace,
} from "../testkit.ts";
import { fakeAlignJudge, fakeContext, tempStore } from "../pi/fixtures.ts";

const SESSION = "session-query";

async function call(cwd: string, args: unknown): Promise<PiToolResult> {
  return executePraxisTool(args, fakeContext({ cwd, sessionId: SESSION }));
}
const bag = (result: PiToolResult): any => result.details;

/** A judged single-step flow in a store the query can read. */
function judgedFlow(ws: TestWorkspace, extra: Record<string, unknown> = {}): void {
  writeFlow(ws, "learn", [
    {
      id: "make",
      capabilities: ["artifact.write", "emit", "evaluate"],
      schema: JUDGED_SCHEMA,
      quality: { dimensions: LEARNING_RUBRIC, threshold: 0.6, policy: "required", ...extra },
    },
  ]);
}

const highScorer = () => ({ score: async (input: { rubric: readonly { id: string }[] }) => ({ dimensions: input.rubric.map((d) => ({ id: d.id, score: 0.95 })), rationale: "fake", scorer: "fake/v1" }) });

/** Seed one judged instance; optionally close it with a real note. */
async function seedJudged(ws: TestWorkspace, tick: () => string, requestId: string, note: boolean): Promise<string> {
  judgedFlow(ws);
  const run = startJudged(ws, requestId, tick());
  setScorerForTest(highScorer() as never);
  await submitJudged(ws, run, tick(), 1, highScorer() as never);
  setScorerForTest(undefined);
  if (note) recordNoteFor(ws, run.instance, tick());
  return run.instance;
}

test("R1: the argument block is enforced at the parse", async () => {
  const ws = tempStore();
  try {
    setAlignJudgeForTest(fakeAlignJudge("aligned"));
    const started = bag(await call(ws.cwd, { op: "start", flow: "flows/architect", requestId: "q-1", order: "write the draft" }));
    const instance = started.result.instanceId;
    const cases: Array<{ args: Record<string, unknown>; field: string }> = [
      { args: { op: "recall", instance }, field: "need" },
      { args: { op: "recall", instance, need: "" }, field: "need" },
      { args: { op: "recall", instance, need: "x".repeat(501) }, field: "need" },
      { args: { op: "recall", instance, need: "stuck", max: 0 }, field: "max" },
      { args: { op: "recall", instance, need: "stuck", max: 11 }, field: "max" },
    ];
    for (const bad of cases) {
      const refused = await call(ws.cwd, bad.args);
      assert.equal(refused.isError, true, JSON.stringify(bad.args).slice(0, 60));
      assert.equal(bag(refused).code, "CONFIG_INVALID");
      const issues = bag(refused).detail as Array<{ path: string }>;
      assert.ok(issues.some((issue) => issue.path === bad.field), "the refusal names " + bad.field + ": " + JSON.stringify(issues));
    }
  } finally {
    setScorerForTest(undefined);
    setAlignJudgeForTest(undefined);
    ws.dispose();
  }
});

test("R2/R6: only real solved cases come back, with provenance from the record", async () => {
  const ws = workspace();
  try {
    const tick = clock().next;
    const good = await seedJudged(ws, tick, "case-good", true);
    await seedJudged(ws, tick, "case-no-note", false); // accepted, never closed: no lesson
    const store = openStore(join(ws.store, "praxis.sqlite"));
    try {
      const cases = collectCases(store);
      assert.equal(cases.length, 1, "the note-less acceptance is not a case");
      assert.equal(cases[0].instance, good);
      assert.equal(cases[0].task, "tasks/make");
      assert.equal(cases[0].step, "make");
      assert.equal(cases[0].version, 1);
      assert.match(cases[0].digest, /^sha256:[0-9a-f]{64}$/);
      assert.equal(cases[0].writtenBy, "a", "the note's provenance agent");
      assert.equal(cases[0].score, 0.95);
      assert.equal(cases[0].lesson.whatBetter, noteBody().whatBetter);
      assert.deepEqual(cases[0].lesson.tags.map((tag) => tag.dimension), ["solves"]);
    } finally {
      store.close();
    }
  } finally {
    setScorerForTest(undefined);
    dispose(ws);
  }
});

test("R2: a stubbed note and a continued-FAILED acceptance are not cases", async () => {
  const stubWs = workspace();
  try {
    const tick = clock().next;
    judgedFlow(stubWs);
    const run = startJudged(stubWs, "case-stub", tick());
    setScorerForTest(highScorer() as never);
    await submitJudged(stubWs, run, tick(), 1, highScorer() as never);
    setScorerForTest(undefined);
    const trivial = { ...noteBody(), whatBetter: noteBody().whatWrong };
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        recordNoteFor(stubWs, run.instance, tick(), trivial);
      } catch {
        /* refused while the budget lasts */
      }
    }
    const store = openStore(join(stubWs.store, "praxis.sqlite"));
    try {
      assert.equal(collectCases(store).length, 0, "a stub carries no lesson, so it is not a case");
    } finally {
      store.close();
    }
  } finally {
    setScorerForTest(undefined);
    dispose(stubWs);
  }

  const failedWs = workspace();
  try {
    const tick = clock().next;
    judgedFlow(failedWs, { onFailure: "continue", maxAttempts: 1 });
    const run = startJudged(failedWs, "case-continued", tick());
    const low = () => ({ score: async (input: { rubric: readonly { id: string }[] }) => ({ dimensions: input.rubric.map((d) => ({ id: d.id, score: 0.2 })), rationale: "fake", scorer: "fake/v1" }) });
    setScorerForTest(low() as never);
    await submitJudged(failedWs, run, tick(), 1, low() as never);
    setScorerForTest(undefined);
    recordNoteFor(failedWs, run.instance, tick());
    const store = openStore(join(failedWs.store, "praxis.sqlite"));
    try {
      assert.equal(collectCases(store).length, 0, "a carried FAILED artifact is not a solution");
    } finally {
      store.close();
    }
  } finally {
    setScorerForTest(undefined);
    dispose(failedWs);
  }
});

test("R3: the query and the brief rank with the SAME scorer", async () => {
  const ws = workspace();
  try {
    const tick = clock().next;
    await seedJudged(ws, tick, "case-shared", true);
    const store = openStore(join(ws.store, "praxis.sqlite"));
    try {
      const cases = collectCases(store);
      assert.equal(cases.length, 1);
      const direct = scoreCandidate({
        cover: LEARNING_RUBRIC.map((dimension) => dimension.id),
        tags: cases[0].lesson.tags,
        outcome: cases[0].outcome,
        hasBetter: cases[0].lesson.whatBetter.trim() !== "",
        score: cases[0].score,
        barThen: cases[0].signals.barThen,
        levels: cases[0].signals.levels,
        author: cases[0].writtenBy,
        corroborationAgents: () => 0,
      });
      // The BRIEF must be scored by the same function, or the extraction changed behaviour.
      const brief = recallFor(store, "tasks/make", 1, QUALITY);
      const weakSet = weakSetFor(store, "tasks/make", 1, QUALITY);
      const briefDirect = scoreCandidate({
        cover: weakSet,
        tags: brief.notes[0].tags,
        outcome: brief.notes[0].outcome,
        hasBetter: brief.notes[0].whatBetter.trim() !== "",
        score: brief.notes[0].score,
        barThen: 0.6,
        levels: 0,
        author: "a",
        corroborationAgents: () => 0,
      });
      assert.equal(brief.notes[0].relevance, briefDirect.relevance, "the brief's note relevance comes from the shared scorer");

      const ranked = deterministicRanker().rank({ need: { text: "stuck", tags: LEARNING_RUBRIC.map((d) => d.id) }, candidates: cases });
      assert.equal(ranked[0].score2, direct.relevance, "the query's score IS the shared scorer's output");
      assert.deepEqual(
        { ...ranked[0].relevance },
        { need: direct.breakdown.coverage, outcome: direct.breakdown.outcome, corroboration: direct.breakdown.corroboration, recency: direct.breakdown.recency, margin: direct.breakdown.margin },
      );
    } finally {
      store.close();
    }
  } finally {
    setScorerForTest(undefined);
    dispose(ws);
  }
});

test("R4: an injected ranker's order is reflected exactly", async () => {
  const ws = workspace();
  try {
    const tick = clock().next;
    await seedJudged(ws, tick, "case-a", true);
    await seedJudged(ws, tick, "case-b", true);
    const mine = startJudged(ws, "case-query", tick());
    const options = { ...learningOptions(ws, "2026-10-30T00:00:00.000Z"), instance: mine.instance, actor: "a" };
    const deterministic = recallExperience(options, { need: "stuck", tags: ["solves"], max: 5 });
    assert.equal(deterministic.count, 2, "two solved cases are rankable");

    // A fake port that simply reverses the candidates: if the query honoured it, the order flips.
    const fake: RankerPort = {
      rank({ candidates }) {
        return [...candidates].reverse().map((candidate) => ({
          ...candidate,
          score2: 0.5,
          relevance: { need: 0, outcome: 0, corroboration: 0, recency: 0, margin: 0 },
          reason: "fake",
        })) as RankedCase[];
      },
    };
    setRankerForTest(fake);
    const reversed = recallExperience(options, { need: "stuck", tags: ["solves"], max: 5 });
    assert.deepEqual(
      reversed.cases.map((one) => one.provenance.instance),
      deterministic.cases.map((one) => one.provenance.instance).reverse(),
      "the port's order is the answer's order",
    );
  } finally {
    setRankerForTest(undefined);
    dispose(ws);
  }
});

test("R5: the answer is bounded and says when it was cut", async () => {
  const ws = workspace();
  try {
    const tick = clock().next;
    const long = "detailed lesson ".repeat(40); // ~640 chars: under the 1000 field bound, clipped to 400 in the payload
    const longTag = "one claim one cited location ".repeat(16); // ~496 chars: under the 500 tag bound
    for (let index = 1; index <= 10; index += 1) {
      judgedFlow(ws);
      const run = startJudged(ws, "case-long-" + index, tick());
      setScorerForTest(highScorer() as never);
      await submitJudged(ws, run, tick(), 1, highScorer() as never);
      setScorerForTest(undefined);
      recordNoteFor(ws, run.instance, tick(), noteBody({ whatWrong: long, whatRight: long, whatBetter: long + index, tags: [{ dimension: "solves", lesson: longTag }] }));
    }
    const store = openStore(join(ws.store, "praxis.sqlite"));
    try {
      const cases = collectCases(store);
      assert.equal(cases.length, 10, "ten solved cases are in the store");
      const port = deterministicRanker();
      const ranked = port.rank({ need: { text: "stuck", tags: ["solves"] }, candidates: cases });
      const bounded = (await import("../../src/quality/index.ts")).applyBounds(ranked, 10);
      const chars = bounded.reduce((sum, one) => sum + one.lesson.whatWrong.length + one.lesson.whatRight.length + one.lesson.whatBetter.length + one.lesson.tags.reduce((inner, tag) => inner + tag.lesson.length, 0), 0);
      assert.ok(bounded.length < 10, "the token budget stops the list before the count bound: " + bounded.length);
      assert.ok(Math.ceil(chars / 4) <= 1200, "the payload stays inside the budget: " + Math.ceil(chars / 4));
    } finally {
      store.close();
    }
  } finally {
    setScorerForTest(undefined);
    dispose(ws);
  }
});

test("R7/R8: the query reads ONE store and writes nothing", async () => {
  const first = workspace();
  const second = workspace();
  try {
    const tick = clock().next;
    await seedJudged(first, tick, "case-first", true);
    judgedFlow(second);
    const mine = startJudged(second, "case-second", tick());

    const digestOfFile = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");
    const dbPath = join(second.store, "praxis.sqlite");
    const before = { counts: countsOf(second), file: digestOfFile(dbPath) };

    const answer = recallExperience({ ...learningOptions(second, "2026-10-30T00:00:00.000Z"), instance: mine.instance, actor: "a" }, { need: "stuck with grounded claims" });
    assert.equal(answer.cases.length, 0, "the other project's solved case is invisible");
    assert.equal(JSON.stringify(answer).includes(casesOf(first)[0].digest), false, "and its digest never leaks into this answer");

    assert.deepEqual(countsOf(second), before.counts, "no row was written");
    assert.equal(digestOfFile(dbPath), before.file, "and the store file is byte-identical");
  } finally {
    dispose(first);
    dispose(second);
  }
});

function countsOf(ws: TestWorkspace): Record<string, number> {
  const out: Record<string, number> = {};
  for (const table of ["instance", "event", "artifact", "definition", "publication"]) {
    out[table] = Number(query({ store: ws.store } as Workspace, `select count(*) as n from ${table}`)[0]?.n ?? -1);
  }
  return out;
}

function casesOf(ws: TestWorkspace) {
  const store = openStore(join(ws.store, "praxis.sqlite"));
  try {
    return collectCases(store);
  } finally {
    store.close();
  }
}

test("R9/R10: the envelope is its own shape, the six-key result is untouched, and the skill teaches it", async () => {
  const ws = tempStore();
  try {
    setAlignJudgeForTest(fakeAlignJudge("aligned"));
    const started = bag(await call(ws.cwd, { op: "start", flow: "flows/architect", requestId: "q-shape", order: "write the draft" }));
    const answer = bag(await call(ws.cwd, { op: "recall", instance: started.result.instanceId, need: "stuck on structure" }));
    assert.deepEqual(Object.keys(answer).sort(), ["cases", "count", "need", "truncated"]);
    assert.equal(answer.need, "stuck on structure");
    assert.equal(answer.count, 0);
    assert.deepEqual(answer.cases, []);
    assert.deepEqual(Object.keys(started.result).sort(), ["artifacts", "flow", "instanceId", "nextAction", "status", "summary"]);

    const skill = readFileSync(new URL("../../.pi/skills/praxis/SKILL.md", import.meta.url), "utf8");
    assert.match(skill, /\| `recall` \|/, "the op is in the skill's table");
    assert.match(skill, /this project's\*\* store|this project's\*\*/, "and the paragraph says it reads this project's store");
  } finally {
    setAlignJudgeForTest(undefined);
    ws.dispose();
  }
});
