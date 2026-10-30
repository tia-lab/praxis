/**
 * THE LEARNING CHAIN (Slice 2). One connected path, proven in one test rather than three isolated
 * assertions: a dimension scores inside its 5-point tolerance band -> the verdict RECORDS it in
 * flagged[] -> the note gate REFUSES to close the step until the reflection carries a lesson for
 * that exact dimension -> a later instance's recall SURFACES that dimension as weak and hands the
 * lesson forward.
 *
 * The fixture puts the flagged dimension and the weakest dimension on DIFFERENT ids, so the refusal
 * proves the flagged rule itself and not the (already covered) weakest rule:
 *   grounded      floor 0.85  <- scores 0.80, inside [0.80, 0.85): FLAGGED
 *   covers-question floor 0.40 <- scores 0.50, its own bar is low, so it is merely the WEAKEST
 *   honest-uncertainty floor 0.40
 *
 * A fake scorer drives every submit: no network.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { briefRecall, recallFor, weakSetFor } from "../../src/quality/index.ts";
import { recordNote } from "../../src/runner/note-gate.ts";
import { openStore } from "../../src/store/db.ts";
import { isAppError, type AppError } from "../../src/types/errors.ts";
import type { Quality } from "../../src/types/schema.ts";
import {
  JUDGED_SCHEMA,
  clock,
  dimensionScorer,
  dispose,
  eventsOf,
  learningOptions,
  noteBody,
  startJudged,
  submitJudged,
  workspace,
  writeFlow,
  type JudgedRun,
  type Workspace,
} from "../testkit.ts";

const TASK = "tasks/make";

const RUBRIC = [
  { id: "grounded", statement: "claims are grounded in sources", floor: 0.85 },
  { id: "covers-question", statement: "the answer covers the question", floor: 0.4 },
  { id: "honest-uncertainty", statement: "limits are stated", floor: 0.4 },
];
const QUALITY: Quality = { dimensions: RUBRIC, threshold: 0.4, policy: "required" };

function chainFlow(ws: Workspace): void {
  writeFlow(ws, "learn", [
    {
      id: "make",
      capabilities: ["artifact.write", "emit", "evaluate"],
      schema: JUDGED_SCHEMA,
      quality: { dimensions: RUBRIC, threshold: 0.4, policy: "required" },
    },
  ]);
}

/** One submit, scored per dimension; the typed refusal comes back instead of throwing. */
async function submit(
  ws: Workspace,
  tick: () => string,
  requestId: string,
  frame: Record<string, number>,
): Promise<{ run: JudgedRun; refusal: AppError | undefined }> {
  const run = startJudged(ws, requestId, tick());
  try {
    await submitJudged(ws, run, tick(), 1, dimensionScorer([frame]));
    return { run, refusal: undefined };
  } catch (error) {
    assert.ok(isAppError(error), "a refusal is a typed AppError");
    return { run, refusal: error };
  }
}

function noteWith(ws: Workspace, instance: string, at: string, tags: Array<{ dimension: string; lesson: string }>) {
  return recordNote({
    options: { ...learningOptions(ws, at), instance },
    actor: "a",
    subjective: noteBody({
      whatWrong: "grounded slipped under its own bar while the rest held",
      whatRight: "the artifact carried its nonce and schema",
      whatBetter: "cite a source line for every grounded claim",
      tags,
    }),
    at,
  });
}

test("flag -> record -> steer: a band pass is recorded, enforced by the note gate, and handed forward", async () => {
  const ws = workspace();
  try {
    chainFlow(ws);
    const tick = clock().next;
    const g = 0.95;

    // --- history: one strong pass, then two that already sit inside grounded's band -------------
    await submit(ws, tick, "chain-0", { grounded: g, "covers-question": g, "honest-uncertainty": g });
    await submit(ws, tick, "chain-1", { grounded: 0.81, "covers-question": 0.5, "honest-uncertainty": 0.5 });
    await submit(ws, tick, "chain-2", { grounded: 0.81, "covers-question": 0.5, "honest-uncertainty": 0.5 });

    // --- 1. FLAG: grounded lands inside [0.85 - 0.05, 0.85) and the verdict records it ---------
    const chain = await submit(ws, tick, "chain-3", { grounded: 0.8, "covers-question": 0.5, "honest-uncertainty": 0.5 });
    assert.equal(chain.refusal, undefined, "the band pass is ACCEPTED: " + JSON.stringify(chain.refusal?.detail));
    const verdict = eventsOf(ws, chain.run.instance).find((event) => event.type === "quality.verdict")?.payload as
      | { decision: string; score: number; mean: number; flagged: string[] }
      | undefined;
    assert.ok(verdict, "the verdict is recorded");
    assert.equal(verdict.decision, "pass");
    assert.deepEqual(verdict.flagged, ["grounded"], "the dimension inside the band is recorded as flagged");
    assert.equal(verdict.score, 0.5, "MIN is still the headline score, and it is NOT the flagged dimension");

    // --- 2. RECORD: the note gate refuses to close on a reflection that ignores the flag --------
    const offTarget = (() => {
      try {
        noteWith(ws, chain.run.instance, tick(), [
          { dimension: "covers-question", lesson: "answer the question before the detail" },
        ]);
        return undefined;
      } catch (error) {
        assert.ok(isAppError(error), "the refusal is typed");
        return error;
      }
    })();
    assert.ok(offTarget, "a note that names only the weakest dimension is REFUSED");
    assert.equal(offTarget.code, "ARTIFACT_INVALID");
    const gaps = (offTarget.detail as { missing: string[] }).missing;
    assert.ok(
      gaps.some((gap) => gap.includes("grounded") && gap.includes("tolerance band")),
      "the refusal names the flagged dimension as the reason: " + gaps.join(" | "),
    );
    assert.equal(
      eventsOf(ws, chain.run.instance).filter((event) => event.type === "learning.note").length,
      0,
      "nothing was recorded, so the step has not closed",
    );

    const lesson = { dimension: "grounded", lesson: "cite a file:line for every grounded claim" };
    const closed = noteWith(ws, chain.run.instance, tick(), [
      { dimension: "covers-question", lesson: "answer the question before the detail" },
      lesson,
    ]);
    assert.equal(closed.stub, false, "the note is adequate once it addresses the flagged dimension");
    assert.equal(closed.instance.status, "completed", "and only then does the step close");

    // --- 3. STEER: the next instance is told, in its brief, that grounded is the weak spot ------
    const store = openStore(join(ws.store, "praxis.sqlite"));
    try {
      const weakSet = weakSetFor(store, TASK, 1, QUALITY);
      assert.deepEqual(weakSet, ["grounded"], "recall surfaces the flagged dimension as the weak one now");
      const recall = recallFor(store, TASK, 1, QUALITY);
      assert.equal(recall.notes.length, 1, "the lesson recorded for it is the material handed forward");
      assert.ok(
        recall.notes[0].tags.some((tag) => tag.dimension === "grounded" && tag.lesson === lesson.lesson),
        "and it is exactly the lesson that closed the step",
      );
      assert.equal(recall.weakSet.includes("grounded"), true);
    } finally {
      store.close();
    }

    // The lesson really reaches the next agent's BRIEF: `briefRecall` is the function the tool's
    // learning view calls on start, so this is the payload the next instance receives.
    const next = startJudged(ws, "chain-next", tick());
    const brief = briefRecall(learningOptions(ws, tick()), {
      instance: next.instance,
      step: "make",
      task: TASK,
      taskVersion: 1,
      quality: QUALITY,
    });
    assert.deepEqual(brief.weakSet, ["grounded"], "the next brief names the flagged dimension as the weak spot");
    assert.equal(brief.notes.length, 1);
    assert.ok(brief.notes[0].tags.some((tag) => tag.dimension === "grounded"), "and hands its lesson forward");
    assert.equal(brief.bar, 0.4, "the global MEAN bar is disclosed alongside the lessons");
    assert.equal(
      eventsOf(ws, next.instance).filter((event) => event.type === "recall.selected").length,
      1,
      "the selected set is recorded for the next instance, so the steering is auditable",
    );
  } finally {
    dispose(ws);
  }
});
