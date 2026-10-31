/**
 * Recall (O1/F3/F7, task-level). A fake scorer drives every seed, so nothing reaches the network.
 * Proves: the weak-set is derived from recent history, weakness-coverage dominates the ranking, an
 * independently corroborated lesson outranks an otherwise equal one, MMR drops duplicate lessons,
 * a passing exemplar is always included, the token budget bounds the payload, a cold store yields
 * an empty set, lessons survive a bar raise (decayed), and the selected set is recorded for audit.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { RECALL_MAX, RECALL_TOKEN_BUDGET, WARMUP_MIN, briefRecall, escalatedLesson, recallFor, weakSetFor } from "../../src/quality/index.ts";
import { effectiveBar } from "../../src/quality/index.ts";
import { openStore } from "../../src/store/db.ts";
import { join } from "node:path";
import type { LearningTag } from "../../src/types/learning.ts";
import type { Quality } from "../../src/types/schema.ts";
import { isAppError } from "../../src/types/errors.ts";
import {
  JUDGED_SCHEMA,
  LEARNING_RUBRIC,
  clock,
  dimensionScorer,
  writeFlow,
  dispose,
  eventsOf,
  judgedFlow,
  learningOptions,
  noteBody,
  recordNoteFor,
  sequenceScorer,
  startJudged,
  submitJudged,
  workspace,
  type Workspace,
} from "../testkit.ts";

const TASK = "tasks/make";
const QUALITY: Quality = { dimensions: LEARNING_RUBRIC, threshold: 0.6, policy: "required" };


/* ---------------------------------------------------------------------------------------------
 * The weak-set is STEERING, so it is recency-weighted: the newest verdict dominates and a dimension
 * whose early scores were low but which has since recovered stops being flagged. The first case is
 * the exact regression four live runs produced; the second proves the fix does not over-correct.
 * ------------------------------------------------------------------------------------------- */

/** A named rubric, so the weak-set can be read directly instead of through generic dimension ids. */
const STEERING_RUBRIC = [
  { id: "grounded", statement: "claims are grounded in sources" },
  { id: "covers-question", statement: "the answer covers the question" },
  { id: "honest-uncertainty", statement: "limits are stated" },
];

/** One judged step over STEERING_RUBRIC at the given floor. */
function steeringFlow(ws: Workspace, threshold: number): void {
  writeFlow(ws, "learn", [
    {
      id: "make",
      capabilities: ["artifact.write", "emit", "evaluate"],
      schema: JUDGED_SCHEMA,
      quality: { dimensions: STEERING_RUBRIC, threshold, policy: "required" },
    },
  ]);
}

/** One verdict per instance, per-dimension, appended oldest first, which is the order recall reads. */
async function seedVerdicts(ws: Workspace, tick: () => string, frames: ReadonlyArray<Record<string, number>>): Promise<void> {
  for (let index = 0; index < frames.length; index += 1) {
    const run = startJudged(ws, "verdict-" + index, tick());
    try {
      await submitJudged(ws, run, tick(), 1, dimensionScorer([frames[index]]));
    } catch (error) {
      assert.ok(isAppError(error), "a below-floor verdict is a typed refusal");
    }
  }
}

/** The weak-set a start would steer by, read straight from the store. */
function weakOf(ws: Workspace, threshold: number): string[] {
  const store = openStore(join(ws.store, "praxis.sqlite"));
  try {
    return weakSetFor(store, TASK, 1, { dimensions: STEERING_RUBRIC, threshold, policy: "required" });
  } finally {
    store.close();
  }
}

const plainMean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

test("a recovered dimension stops being flagged: the weak-set is recency-weighted", async () => {
  const ws = workspace();
  try {
    steeringFlow(ws, 0.75);
    const tick = clock().next;
    await seedVerdicts(ws, tick, [
      { grounded: 0.63, "covers-question": 0.81, "honest-uncertainty": 0.92 },
      { grounded: 0.73, "covers-question": 0.73, "honest-uncertainty": 0.94 },
      { grounded: 0.84, "covers-question": 0.71, "honest-uncertainty": 0.90 },
    ]);
    // The observed regression, stated as arithmetic: the plain mean flags grounded (0.733) even
    // though covers-question (0.750) is the one still declining and grounded is now the strong one.
    assert.ok(
      plainMean([0.63, 0.73, 0.84]) < plainMean([0.81, 0.73, 0.71]),
      "a plain mean flags the dimension that has recovered",
    );
    assert.deepEqual(
      weakOf(ws, 0.75),
      ["covers-question"],
      "the recency-weighted weak-set flags the dimension that is actually weak now",
    );
  } finally {
    dispose(ws);
  }
});

test("a dimension that is genuinely lowest in the recent verdicts stays flagged", async () => {
  const ws = workspace();
  try {
    steeringFlow(ws, 0.9);
    const tick = clock().next;
    await seedVerdicts(ws, tick, [
      { grounded: 0.85, "covers-question": 0.8, "honest-uncertainty": 0.92 },
      { grounded: 0.75, "covers-question": 0.82, "honest-uncertainty": 0.93 },
      { grounded: 0.55, "covers-question": 0.84, "honest-uncertainty": 0.92 },
    ]);
    const weakSet = weakOf(ws, 0.9);
    assert.equal(weakSet[0], "grounded", "a declining dimension is not rehabilitated by the weighting");
    assert.ok(weakSet.includes("covers-question"), "the second-weakest is still surfaced");
    assert.equal(weakSet.includes("honest-uncertainty"), false, "the dimension that holds up stays out");
  } finally {
    dispose(ws);
  }
});

/** One seeded lesson: an instance run to an outcome, then the note it owed. */
interface Seed {
  requestId: string;
  tags: LearningTag[];
  /** Per-call scores; two entries where the first must fail (a continued-failure seed). */
  scores?: number[];
  /** Per-dimension frames, when the case needs a specific weak dimension. */
  frames?: Array<Record<string, number>>;
  actor?: string;
  text?: string;
}

async function seed(ws: Workspace, tick: () => string, input: Seed): Promise<string> {
  const actor = input.actor ?? "a";
  const run = startJudged(ws, input.requestId, tick(), actor);
  const scorer = input.frames === undefined ? sequenceScorer(input.scores ?? [0.9]) : dimensionScorer(input.frames);
  const attempts = input.frames?.length ?? input.scores?.length ?? 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await submitJudged(ws, run, tick(), attempt, scorer, actor);
    } catch (error) {
      assert.ok(isAppError(error), "a seeded failure is a typed refusal");
    }
  }
  const text = input.text ?? "the first attempt did not clear the floor";
  recordNoteFor(
    ws,
    run.instance,
    tick(),
    noteBody({ whatWrong: text, whatRight: "the artifact was well formed", whatBetter: text + "; aim at the floor first", tags: input.tags }),
    actor,
  );
  return run.instance;
}

/** The ranking itself, read straight from the store: no instance to attribute the set to. */
/**
 * The recall set for the fixture store. `cleared` marks the set as having passed an instruction
 * screen, so the budget case can exercise the TEXT budget: without a screen every case is withheld
 * (S4, R27), which is the default and the safe state.
 */
const rank = (ws: Workspace, quality: Quality = QUALITY, cleared = false) => {
  const store = openStore(join(ws.store, "praxis.sqlite"));
  try {
    if (!cleared) return recallFor(store, TASK, 1, quality);
    // Every candidate cleared by the screen, so the TEXT budget is what binds (S4, R27).
    const ids = recallFor(store, TASK, 1, quality).notes.map((note) => note.id);
    const screens = new Map(ids.map((id) => [id, { passed: true }] as const));
    return recallFor(store, TASK, 1, quality, screens);
  } finally {
    store.close();
  }
};

test("a cold store recalls nothing and invents nothing", async () => {
  const ws = workspace();
  try {
    judgedFlow(ws);
    assert.deepEqual(rank(ws), { bar: 0.6, weakSet: [], notes: [] });
  } finally {
    dispose(ws);
  }
});

test("the weak-set comes from recent history and weakness-coverage dominates the ranking", async () => {
  const ws = workspace();
  try {
    judgedFlow(ws);
    const tick = clock().next;
    // One refused attempt at 0.2 then a pass at 0.7: every dimension's mean sits below the bar.
    const weak = [{ solves: 0.2, evidence: 0.2, trace: 0.2 }, { solves: 0.7, evidence: 0.7, trace: 0.7 }];
    const store = openStore(join(ws.store, "praxis.sqlite"));
    try {
      const first = await seed(ws, tick, { requestId: "weak-1", frames: weak, tags: [{ dimension: "solves", lesson: "answer the goal first" }] });
      assert.ok(first.length > 0);
      const weakSet = weakSetFor(store, TASK, 1, QUALITY);
      assert.deepEqual(weakSet, ["evidence", "solves", "trace"], "the bottom dimensions, lowest mean first");
    } finally {
      store.close();
    }
    // A lesson that covers two weak dimensions outranks one that covers only the mandatory weakest.
    await seed(ws, tick, { requestId: "weak-2", scores: [0.9], tags: [{ dimension: "solves", lesson: "answer the goal first" }] });
    await seed(ws, tick, {
      requestId: "weak-3",
      scores: [0.9],
      tags: [
        { dimension: "solves", lesson: "answer the goal first" },
        { dimension: "evidence", lesson: "cite a file:line for every claim" },
      ],
    });
    const set = rank(ws);
    assert.equal(set.notes[0].tags.length, 2, "coverage of two weak dimensions wins");
    assert.ok(set.notes[0].tags.some((tag) => tag.dimension === "evidence"));
  } finally {
    dispose(ws);
  }
});

test("an independently corroborated lesson outranks an otherwise equal one", async () => {
  const ws = workspace();
  try {
    judgedFlow(ws);
    const tick = clock().next;
    const weak = [{ solves: 0.2, evidence: 0.2, trace: 0.2 }, { solves: 0.7, evidence: 0.7, trace: 0.7 }];
    // Two agents record the same evidence lesson; the trace lesson is recorded by one agent alone.
    await seed(ws, tick, {
      requestId: "cor-1",
      frames: weak,
      actor: "a1",
      tags: [
        { dimension: "solves", lesson: "answer the goal first" },
        { dimension: "evidence", lesson: "cite a file:line for every claim" },
      ],
    });
    await seed(ws, tick, {
      requestId: "cor-2",
      scores: [0.9],
      actor: "a2",
      // A different lesson on the SAME dimension: corroboration counts independent agents per
      // dimension, and an identical lesson would instead be dropped as a duplicate (MMR).
      tags: [
        { dimension: "solves", lesson: "state the answer in the first sentence" },
        { dimension: "evidence", lesson: "quote the source line behind each assertion" },
      ],
    });
    await seed(ws, tick, {
      requestId: "cor-3",
      scores: [0.9],
      actor: "a3",
      tags: [
        { dimension: "solves", lesson: "answer the goal first" },
        { dimension: "trace", lesson: "walk the source chain explicitly" },
      ],
    });
    const set = rank(ws);
    assert.equal(set.notes.length, 3, "all three fit the bound");
    const traceLast = set.notes[set.notes.length - 1];
    assert.ok(
      traceLast.tags.some((tag) => tag.dimension === "trace"),
      "the uncorroborated lesson ranks last among equal coverage: " + set.notes.map((note) => note.tags.map((tag) => tag.dimension).join("+")).join(" > "),
    );
  } finally {
    dispose(ws);
  }
});

test("MMR drops a duplicate lesson instead of repeating it", async () => {
  const ws = workspace();
  try {
    judgedFlow(ws);
    const tick = clock().next;
    const tags = [{ dimension: "solves", lesson: "answer the goal first" }];
    await seed(ws, tick, { requestId: "mmr-1", scores: [0.9], tags });
    await seed(ws, tick, { requestId: "mmr-2", scores: [0.9], tags, actor: "b" });
    const set = rank(ws);
    assert.equal(set.notes.length, 1, "the same dimension and lesson is one lesson");
    assert.deepEqual(set.notes[0].tags, tags);
  } finally {
    dispose(ws);
  }
});

test("one passing exemplar is always included, even when it ranks last", async () => {
  const ws = workspace();
  try {
    judgedFlow(ws);
    const tick = clock().next;
    // Five continued-failure lessons covering two weak dimensions outrank one narrow passing lesson:
    // the first attempt fails low and the second stalls, so the policy carries it forward.
    for (let index = 1; index <= RECALL_MAX; index += 1) {
      await seed(ws, tick, {
        requestId: "ex-fail-" + index,
        frames: [{ solves: index / 100, evidence: index / 100, trace: index / 100 }, { solves: index / 200, evidence: index / 200, trace: index / 200 }],
        tags: [
          { dimension: "solves", lesson: "answer the goal first " + index },
          { dimension: "evidence", lesson: "cite a file:line " + index },
        ],
      });
    }
    await seed(ws, tick, { requestId: "ex-pass", scores: [0.9], tags: [{ dimension: "solves", lesson: "answer the goal first, passing" }] });
    const set = rank(ws);
    assert.ok(set.notes.some((note) => note.outcome === "pass"), "a passing exemplar is always present");
    assert.ok(set.notes.length <= RECALL_MAX);
  } finally {
    dispose(ws);
  }
});

test("the payload respects the token budget", async () => {
  const ws = workspace();
  try {
    judgedFlow(ws);
    const tick = clock().next;
    const long = "x".repeat(900);
    for (let index = 1; index <= RECALL_MAX; index += 1) {
      await seed(ws, tick, {
        requestId: "budget-" + index,
        scores: [0.9],
        tags: [{ dimension: "solves", lesson: "lesson " + index }],
        text: long,
      });
    }
    const set = rank(ws, QUALITY, true);
    const cost = set.notes.reduce(
      (sum, note) => sum + note.whatWrong.length + note.whatRight.length + note.whatBetter.length + note.tags.reduce((inner, tag) => inner + tag.lesson.length, 0),
      0,
    );
    assert.ok(set.notes.length < RECALL_MAX, "the budget stops the set before the N cap: " + set.notes.length);
    assert.ok(Math.ceil(cost / 4) <= RECALL_TOKEN_BUDGET, "roughly within the token budget: " + Math.ceil(cost / 4));
  } finally {
    dispose(ws);
  }
});

test("lessons survive a bar raise, decayed but present, with the weak-set spanning versions", async () => {
  const ws = workspace();
  try {
    judgedFlow(ws);
    const tick = clock().next;
    await seed(ws, tick, { requestId: "raise-old", scores: [0.95], text: "old-bar lesson", tags: [{ dimension: "solves", lesson: "old-bar lesson" }] });
    for (let index = 1; index <= WARMUP_MIN; index += 1) {
      const run = startJudged(ws, "raise-pass-" + index, tick());
      await submitJudged(ws, run, tick(), 1, sequenceScorer([0.95]));
    }
    await seed(ws, tick, { requestId: "raise-new", scores: [0.95], text: "raised-bar lesson", tags: [{ dimension: "solves", lesson: "raised-bar lesson" }] });
    const store = openStore(join(ws.store, "praxis.sqlite"));
    try {
      const bar = effectiveBar(store, TASK, QUALITY);
      assert.equal(bar, 0.65, "the five stable passes raised the bar");
      const weakSet = weakSetFor(store, TASK, 1, QUALITY);
      assert.ok(weakSet.length > 0, "the weak-set is computed across both bar levels");
    } finally {
      store.close();
    }
    const set = rank(ws);
    assert.equal(set.bar, 0.65);
    assert.equal(set.notes.length, 2, "the old-bar lesson is decayed, not discarded");
    // S4/R27: this set carries no screen, so text is withheld - the ORDER is read from the tags,
    // which R26 keeps on a withheld case.
    assert.equal(set.notes[0].whatBetter, "");
    assert.match(set.notes[0].tags[0]!.lesson, /raised-bar lesson/, "the current-bar lesson ranks first");
    assert.match(set.notes[1]!.tags[0]!.lesson, /old-bar lesson/);
  } finally {
    dispose(ws);
  }
});

test("the selected set is recorded once per instance and step", async () => {
  const ws = workspace();
  try {
    judgedFlow(ws);
    const tick = clock().next;
    await seed(ws, tick, { requestId: "audit-1", scores: [0.9], tags: [{ dimension: "solves", lesson: "answer the goal first" }] });
    const store = openStore(join(ws.store, "praxis.sqlite"));
    try {
      const set = recallFor(store, TASK, 1, QUALITY);
      assert.equal(set.notes.length, 1);
    } finally {
      store.close();
    }
    await seed(ws, tick, { requestId: "audit-2", scores: [0.9], tags: [{ dimension: "solves", lesson: "second lesson" }] });
    const instance = startJudged(ws, "audit-reader", tick()).instance;
    const at = "2026-10-29T23:00:00.000Z";
    const options = learningOptions(ws, at);
    const first = briefRecall(options, { instance, step: "make", task: TASK, taskVersion: 1, quality: QUALITY });
    const second = briefRecall(options, { instance, step: "make", task: TASK, taskVersion: 1, quality: QUALITY });
    assert.deepEqual(first, second, "the same store state yields the same set");
    const recorded = eventsOf(ws, instance).filter((event) => event.type === "recall.selected");
    assert.equal(recorded.length, 1, "recorded on first use, not on every read");
    const payload = recorded[0].payload as { recall: { notes: { relevance: number }[] } };
    assert.ok(payload.recall.notes.every((note) => typeof note.relevance === "number"), "each note's relevance is recorded");

    const lesson = escalatedLesson(first, "solves");
    assert.ok(lesson, "a targeted lesson is available for the weakest dimension");
    assert.equal(lesson?.dimension, "solves");
    assert.ok(lesson?.lesson.includes("solves") || (lesson?.lesson.length ?? 0) > 0);
  } finally {
    dispose(ws);
  }
});
