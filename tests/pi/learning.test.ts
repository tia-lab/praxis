/**
 * Execution learning at the tool surface (F1/F7/O1/O3): the standard reaches the agent through the
 * brief — rubric, aggregation rule, judging stance, the floor IN FORCE and the ranked recall set —
 * and the same store state yields the same brief byte for byte. A refusal re-primes the agent with
 * the single lesson aimed at the dimension that cost the most, and a step that reached its terminal
 * outcome offers `note` instead of `submit`.
 *
 * NO NETWORK: every case installs a fake scorer through `setScorerForTest`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { executePraxisTool, setScorerForTest } from "../../src/pi/tool.ts";
import type { PiToolResult } from "../../src/pi/host.ts";
import type { Scorer } from "../../src/quality/index.ts";
import { artifacts, fakeContext, qualityTasks, tempStore } from "./fixtures.ts";
import { eventsOf, type Workspace } from "../testkit.ts";

/** The fixture store, in the shape the testkit's raw event reader expects. */
const storeOf = (ws: { storeDir: string }): Workspace => ({ store: ws.storeDir } as Workspace);

const SESSION = "session-alpha";

/** A fake scorer returning one score per rubric dimension; never touches the network. */
function fakeScorer(score: number): Scorer {
  return {
    async score(input) {
      return {
        dimensions: input.rubric.map((dimension) => ({ id: dimension.id, score })),
        rationale: "fake scorer",
        scorer: "fake/v1",
      };
    },
  };
}

async function call(cwd: string, args: unknown): Promise<PiToolResult> {
  return executePraxisTool(args, fakeContext({ cwd, sessionId: SESSION }));
}

const bag = (result: PiToolResult): any => result.details;

const NOTE = {
  whatWrong: "the draft left the goal implicit",
  whatRight: "the artifact carried its nonce and schema",
  whatBetter: "state the answer to the goal in the first sentence",
  tags: [{ dimension: "solves", lesson: "open with the answer, then support it" }],
};

/** Run one instance of the judged fixture to completion, recording its note. */
async function seedNote(cwd: string, requestId: string, note: unknown = NOTE): Promise<void> {
  const started = bag(await call(cwd, { op: "start", flow: "flows/architect", requestId }));
  const submitted = await call(cwd, { op: "submit", instance: started.result.instanceId, artifact: artifacts.validA(started.nonce) });
  assert.notEqual(submitted.isError, true, "the seeded submit passes: " + JSON.stringify(bag(submitted)));
  const noted = await call(cwd, { op: "note", instance: started.result.instanceId, subjective: note });
  assert.notEqual(noted.isError, true, "the seeded note passes: " + JSON.stringify(bag(noted)));
}

test("the brief discloses the standard and the recall, and the same store yields the same brief", async () => {
  const ws = tempStore({ tasks: qualityTasks });
  try {
    setScorerForTest(fakeScorer(0.9));
    await seedNote(ws.cwd, "learn-seed");
    const started = bag(await call(ws.cwd, { op: "start", flow: "flows/architect", requestId: "learn-brief" }));
    const quality = started.step.brief.quality;
    assert.deepEqual(quality.dimensions.map((dimension: { id: string }) => dimension.id), ["solves", "evidence"]);
    assert.equal(quality.threshold, 0.6, "the floor in force is the effective bar");
    assert.equal(quality.aggregation, "min");
    assert.match(quality.judging, /MINIMUM/, "the agent is told how the judgments combine");
    assert.equal(quality.recall.bar, 0.6);
    assert.equal(quality.recall.notes.length, 1, "the recorded lesson is injected");
    assert.equal(quality.recall.notes[0].whatBetter, NOTE.whatBetter);
    assert.equal(typeof quality.recall.notes[0].relevance, "number");

    // Determinism (F8): the same durable state rebuilds the same brief byte for byte.
    const again = bag(await call(ws.cwd, { op: "start", flow: "flows/architect", requestId: "learn-brief" }));
    assert.equal(JSON.stringify(again.step), JSON.stringify(started.step));
    const recorded = eventsOf(storeOf(ws), started.result.instanceId).filter((event) => event.type === "recall.selected");
    assert.equal(recorded.length, 1, "the selected set is recorded once, for audit");
  } finally {
    setScorerForTest(undefined);
    ws.dispose();
  }
});

test("a refusal re-injects the lesson aimed at the weakest dimension", async () => {
  const ws = tempStore({ tasks: qualityTasks });
  try {
    setScorerForTest(fakeScorer(0.9));
    await seedNote(ws.cwd, "learn-seed-2");
    setScorerForTest(fakeScorer(0.3));
    const started = bag(await call(ws.cwd, { op: "start", flow: "flows/architect", requestId: "learn-refuse" }));
    const refused = await call(ws.cwd, { op: "submit", instance: started.result.instanceId, artifact: artifacts.validA(started.nonce) });
    assert.equal(refused.isError, true);
    const quality = bag(refused).detail.quality;
    assert.equal(quality.weakest.id, "solves");
    assert.equal(quality.lesson.dimension, "solves", "the lesson targets the dimension that cost the most");
    assert.equal(quality.lesson.lesson, NOTE.tags[0].lesson);
    assert.equal(quality.threshold, 0.6);
  } finally {
    setScorerForTest(undefined);
    ws.dispose();
  }
});

test("an accepted step offers note instead of submit, and closes on the note", async () => {
  const ws = tempStore({ tasks: qualityTasks });
  try {
    setScorerForTest(fakeScorer(0.9));
    const started = bag(await call(ws.cwd, { op: "start", flow: "flows/architect", requestId: "learn-note" }));
    const submitted = bag(await call(ws.cwd, { op: "submit", instance: started.result.instanceId, artifact: artifacts.validA(started.nonce) }));
    assert.equal(submitted.result.status, "running", "accepted, but the reflection is owed");
    assert.ok(submitted.step.ops.includes("note"), "the brief offers the note op");
    assert.equal(submitted.step.ops.includes("submit"), false, "and does not offer a submit that would be refused");

    const blocked = await call(ws.cwd, { op: "submit", instance: started.result.instanceId, artifact: artifacts.validB(started.nonce, submitted.result.artifacts[0].digest) });
    assert.equal(blocked.isError, true);
    assert.equal(bag(blocked).code, "INSTANCE_STATE_INVALID");
    assert.equal(bag(blocked).detail.step, "draft");

    const noted = bag(await call(ws.cwd, { op: "note", instance: started.result.instanceId, subjective: NOTE }));
    assert.equal(noted.note.step, "draft");
    assert.equal(noted.note.stub, false);
    assert.equal(noted.note.noteVersion, 1);
    assert.equal(noted.result.status, "running", "the flow still has a step to run");
    assert.equal(noted.step.id, "derive");
    assert.equal(noted.step.ops.includes("submit"), true, "the next step may submit");
  } finally {
    setScorerForTest(undefined);
    ws.dispose();
  }
});

test("after the bounded attempts the engine stubs the note and the instance completes", async () => {
  const ws = tempStore({ tasks: qualityTasks });
  try {
    setScorerForTest(fakeScorer(0.9));
    const started = bag(await call(ws.cwd, { op: "start", flow: "flows/architect", requestId: "learn-stub" }));
    await call(ws.cwd, { op: "submit", instance: started.result.instanceId, artifact: artifacts.validA(started.nonce) });
    const trivial = { ...NOTE, whatBetter: NOTE.whatWrong };
    const first = await call(ws.cwd, { op: "note", instance: started.result.instanceId, subjective: trivial });
    assert.equal(first.isError, true);
    assert.equal(bag(first).code, "ARTIFACT_INVALID");
    assert.ok(bag(first).detail.missing.length > 0);
    const second = await call(ws.cwd, { op: "note", instance: started.result.instanceId, subjective: trivial });
    assert.equal(second.isError, true);

    // The budget (default 3) is spent on the third attempt: the omission is recorded, not a hang.
    const stubbed = bag(await call(ws.cwd, { op: "note", instance: started.result.instanceId, subjective: trivial }));
    assert.equal(stubbed.note.stub, true);
    assert.ok(stubbed.note.missing.length > 0, "the stub says what was missing");
    const notes = eventsOf(storeOf(ws), started.result.instanceId).filter((event) => event.type === "learning.note");
    assert.equal(notes.length, 1);
    assert.equal((notes[0].payload as { stub: boolean }).stub, true);
    assert.equal((notes[0].payload as { subjective: unknown }).subjective, null);
  } finally {
    setScorerForTest(undefined);
    ws.dispose();
  }
});
