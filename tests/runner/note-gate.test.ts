/**
 * The learning note (O3/O4). Acceptance is the artifact, closure is the lesson: a judged step that
 * reached its terminal outcome owes an engine-gated reflection, its OBJECTIVE half is derived from
 * the events that already own those facts, and the obligation is bounded — after the attempts are
 * spent the engine records a stub and the flow proceeds, so an unwilling agent cannot deadlock it.
 *
 * A fake scorer drives every case: nothing here reaches the network.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { advance, inspect } from "../../src/runner/engine/index.ts";
import { maxNoteAttempts, noteGate, noteObjective, pendingNote } from "../../src/runner/note-gate.ts";
import { openStore } from "../../src/store/db.ts";
import { isAppError, type AppError } from "../../src/types/errors.ts";
import { LEARNING_RUBRIC, clock, dispose, eventsOf, judgedFlow, learningOptions, noteBody, recordNoteFor, sequenceScorer, startJudged, submitJudged, workspace, type JudgedRun, type Workspace } from "../testkit.ts";

function failureOf(body: () => unknown): AppError {
  try {
    body();
  } catch (error) {
    assert.ok(isAppError(error), "the refusal must be a typed AppError");
    return error;
  }
  throw new Error("expected a typed refusal, the call succeeded");
}

async function rejectionOf(body: () => unknown): Promise<AppError> {
  try {
    await body();
  } catch (error) {
    assert.ok(isAppError(error), "the refusal must be a typed AppError");
    return error;
  }
  throw new Error("expected a typed refusal, the call succeeded");
}

/** A judged step accepted at 0.9 with one attempt: the state every note case starts from. */
async function accepted(tick: () => string, ws: Workspace, requestId: string): Promise<JudgedRun> {
  const run = startJudged(ws, requestId, tick());
  await submitJudged(ws, run, tick(), 1, sequenceScorer([0.9]));
  return run;
}

function notesOf(ws: Workspace, instance: string): Array<Record<string, unknown>> {
  return eventsOf(ws, instance).filter((event) => event.type === "learning.note").map((event) => event.payload as Record<string, unknown>);
}

test("an adequate note closes the instance and the objective half is derived, never stored", async () => {
  const ws = workspace();
  try {
    judgedFlow(ws);
    const tick = clock().next;
    const run = await accepted(tick, ws, "note-1");
    const store = openStore(join(ws.store, "praxis.sqlite"));
    try {
      const view = inspect({ ...learningOptions(ws, tick()), instance: run.instance, actor: "a" });
      assert.equal(view.instance.status, "running", "accepted, but the reflection is still owed");
      const pending = pendingNote(store, view.instance, view.flow);
      assert.equal(pending?.step, "make");
      assert.equal(pending?.task, "tasks/make");
      const objective = noteObjective(store, run.instance, "make");
      assert.equal(objective?.outcome, "pass");
      assert.equal(objective?.bestScore, 0.9);
      assert.equal(objective?.weakest, "solves");
      assert.equal(objective?.attempts, 1);
      assert.deepEqual(objective?.dimensions, LEARNING_RUBRIC.map((dimension) => ({ id: dimension.id, score: 0.9 })));
    } finally {
      store.close();
    }

    const outcome = recordNoteFor(ws, run.instance, tick());
    assert.equal(outcome.stub, false);
    assert.equal(outcome.step, "make");
    assert.equal(outcome.instance.status, "completed", "closure completes the instance");

    const notes = notesOf(ws, run.instance);
    assert.equal(notes.length, 1);
    const note = notes[0];
    assert.equal(note.task, "tasks/make");
    assert.equal(note.taskVersion, 1);
    assert.equal(note.step, "make");
    assert.equal(note.noteVersion, 1);
    assert.equal(note.stub, false);
    assert.equal(note.objective, undefined, "the objective half is derived, never duplicated into the note");
    assert.equal((note.provenance as { agent: string }).agent, "a", "provenance is engine-stamped from the binding");
    assert.deepEqual(note.subjective, noteBody());
    assert.equal(eventsOf(ws, run.instance).filter((event) => event.type === "instance.completed").length, 1);
  } finally {
    dispose(ws);
  }
});

test("a trivial note is refused with typed gaps", async () => {
  const ws = workspace();
  try {
    // A generous budget, so all three defects are refused rather than stubbed at the bound.
    judgedFlow(ws, { maxAttempts: 5 });
    const tick = clock().next;
    const run = await accepted(tick, ws, "note-2");

    // whatBetter restating whatWrong is not a lesson.
    const trivial = failureOf(() =>
      recordNoteFor(ws, run.instance, tick(), noteBody({ whatBetter: "the first attempt did not clear the floor" })),
    );
    assert.equal(trivial.code, "ARTIFACT_INVALID");
    const missing = (trivial.detail as { missing: string[] }).missing;
    assert.ok(missing.some((gap) => gap.startsWith("whatBetter:")), "the gap names the field: " + missing.join(" | "));

    // A tag on a dimension the rubric does not have is refused.
    const unknown = failureOf(() =>
      recordNoteFor(ws, run.instance, tick(), noteBody({ tags: [{ dimension: "invented", lesson: "x" }] })),
    );
    assert.ok((unknown.detail as { missing: string[] }).missing.some((gap) => gap.includes("not a rubric dimension")));

    // Naming the wrong dimension is not a reflection on the weakness.
    const offTarget = failureOf(() =>
      recordNoteFor(ws, run.instance, tick(), noteBody({ tags: [{ dimension: "evidence", lesson: "cite sources" }] })),
    );
    assert.ok((offTarget.detail as { missing: string[] }).missing.some((gap) => gap.includes("weakest dimension")));

    assert.equal(notesOf(ws, run.instance).length, 0, "no note was written by a refused attempt");
  } finally {
    dispose(ws);
  }
});

test("the note gate itself is a deterministic adequacy check", () => {
  const ok = noteGate(
    { whatWrong: "thin grounding", whatRight: "the schema held", whatBetter: "cite a file:line per claim", tags: [{ dimension: "evidence", lesson: "cite" }] },
    LEARNING_RUBRIC,
    "evidence",
  );
  assert.deepEqual(ok, []);
  const wrongTarget = noteGate(
    { whatWrong: "thin grounding", whatRight: "the schema held", whatBetter: "cite a file:line per claim", tags: [{ dimension: "solves", lesson: "cite" }] },
    LEARNING_RUBRIC,
    "evidence",
  );
  assert.equal(wrongTarget.length, 1);
  assert.match(wrongTarget[0], /weakest dimension/);
});

test("a flagged dimension needs its own tag even when it is not the weakest", () => {
  // The compound gate lets a dimension pass inside its Q50 and records it as flagged; the
  // reflection has to address it, because silence about an under-bar dimension is the mediocrity the
  // gate exists to catch.
  const wantsFlagged = noteGate(
    { whatWrong: "one claim was thin", whatRight: "the schema held", whatBetter: "cite a line", tags: [{ dimension: "solves", lesson: "cite" }] },
    LEARNING_RUBRIC,
    "solves",
    ["evidence"],
  );
  assert.equal(wantsFlagged.length, 1);
  assert.match(wantsFlagged[0], /evidence/);
  assert.match(wantsFlagged[0], /Q50/);
  const addressed = noteGate(
    {
      whatWrong: "one claim was thin",
      whatRight: "the schema held",
      whatBetter: "cite a line",
      tags: [
        { dimension: "solves", lesson: "cite" },
        { dimension: "evidence", lesson: "quote the source" },
      ],
    },
    LEARNING_RUBRIC,
    "solves",
    ["evidence"],
  );
  assert.deepEqual(addressed, [], "tagging the flagged dimension closes the gap");
});

test("an advancing submit is blocked until the note is recorded", async () => {
  const ws = workspace();
  try {
    judgedFlow(ws);
    const tick = clock().next;
    const run = await accepted(tick, ws, "note-3");
    const blocked = await rejectionOf(() =>
      advance({ ...learningOptions(ws, tick()), instance: run.instance, actor: "a", artifact: { schema: "praxis.artifact.make/v1", nonce: run.nonce, attempt: 2 } }),
    );
    assert.equal(blocked.code, "INSTANCE_STATE_INVALID");
    const detail = blocked.detail as { step: string; attempts: number; maxAttempts: number };
    assert.equal(detail.step, "make");
    assert.equal(detail.attempts, 1);
    assert.equal(detail.maxAttempts, maxNoteAttempts(undefined));
    assert.equal(notesOf(ws, run.instance).length, 0);

    recordNoteFor(ws, run.instance, tick());
    const closed = inspect({ ...learningOptions(ws, tick()), instance: run.instance, actor: "a" });
    assert.equal(closed.instance.status, "completed");
  } finally {
    dispose(ws);
  }
});

test("the stub fallback fires at the bound and the flow proceeds", async () => {
  const ws = workspace();
  try {
    judgedFlow(ws);
    const tick = clock().next;
    const run = await accepted(tick, ws, "note-4");
    const budget = maxNoteAttempts(undefined);
    const bad = { whatBetter: "the first attempt did not clear the floor" };
    for (let attempt = 1; attempt < budget; attempt += 1) {
      const refused = failureOf(() => recordNoteFor(ws, run.instance, tick(), noteBody(bad)));
      assert.equal(refused.code, "ARTIFACT_INVALID");
      assert.equal((refused.detail as { attempts: number }).attempts, attempt);
    }
    const stub = recordNoteFor(ws, run.instance, tick(), noteBody(bad));
    assert.equal(stub.stub, true, "the bound is spent, so the engine records the omission");
    assert.ok((stub.missing ?? []).length > 0, "the stub carries what was still missing");
    assert.equal(stub.instance.status, "completed");

    const notes = notesOf(ws, run.instance);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].stub, true);
    assert.equal(notes[0].subjective, null, "a stub carries no lesson");
    assert.equal((notes[0].provenance as { agent: string }).agent, "a", "the omission is recorded against its author");
  } finally {
    dispose(ws);
  }
});

test("repeated submits do not deadlock: the engine stubs and proceeds", async () => {
  const ws = workspace();
  try {
    judgedFlow(ws);
    const tick = clock().next;
    const run = await accepted(tick, ws, "note-5");
    const budget = maxNoteAttempts(undefined);
    for (let attempt = 1; attempt <= budget; attempt += 1) {
      const blocked = await rejectionOf(() =>
        advance({ ...learningOptions(ws, tick()), instance: run.instance, actor: "a", artifact: { schema: "praxis.artifact.make/v1", nonce: run.nonce, attempt: attempt + 1 } }),
      );
      assert.equal(blocked.code, "INSTANCE_STATE_INVALID");
    }
    // The budget is spent: the next submit writes the stub itself and the flow is not stuck.
    const settled = await advance({ ...learningOptions(ws, tick()), instance: run.instance, actor: "a", artifact: { schema: "praxis.artifact.make/v1", nonce: run.nonce, attempt: 9 } });
    assert.equal(settled.instance.status, "completed");
    assert.equal(notesOf(ws, run.instance)[0].stub, true);
  } finally {
    dispose(ws);
  }
});

test("an escalated terminal outcome still leaves a note, written by the engine", async () => {
  const ws = workspace();
  try {
    judgedFlow(ws, { onFailure: "escalate" });
    const tick = clock().next;
    const run = startJudged(ws, "note-6", tick());
    const scorer = sequenceScorer([0.2, 0.2]);
    await rejectionOf(() => submitJudged(ws, run, tick(), 1, scorer));
    const halted = await rejectionOf(() => submitJudged(ws, run, tick(), 2, scorer));
    assert.equal(halted.code, "QUALITY_BLOCKED");

    const notes = notesOf(ws, run.instance);
    assert.equal(notes.length, 1, "F2 holds on a failed terminal outcome too");
    assert.equal(notes[0].stub, true);
    assert.equal(notes[0].task, "tasks/make");
    const store = openStore(join(ws.store, "praxis.sqlite"));
    try {
      const objective = noteObjective(store, run.instance, "make");
      assert.equal(objective?.outcome, "escalated");
      assert.equal(objective?.attempts, 2);
    } finally {
      store.close();
    }
  } finally {
    dispose(ws);
  }
});
