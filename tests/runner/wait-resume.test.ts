/**
 * Flow Unit 2 — WAIT: the resume side (R5-R10, R12, R13).
 *
 * A matching event resumes at the SAME step with one receipt; every refusal writes nothing except the
 * lazy timeout, which fails the instance closed by design; two identical resumes are one receipt; and
 * the human node is a wait whose resumed step is still judged by the ordinary gate. NO NETWORK.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { advance, inspect, resume, start } from "../../src/runner/engine/index.ts";
import { advanceEvaluated } from "../../src/quality/index.ts";
import { isAppError } from "../../src/types/errors.ts";
import {
  clock,
  dimensionScorer,
  dispose,
  eventsOf,
  flowRef,
  instanceRow,
  learningOptions,
  workspace,
  writeFlow,
  type Workspace,
} from "../testkit.ts";

const WAIT = { on: { type: "human.submitted", match: { ticket: 7 } }, timeoutMs: 60000 };
const RUBRIC = { dimensions: [{ id: "solves", statement: "it solves the stated goal" }], threshold: 0.6, policy: "required" };

/** draft -> review(wait, judged) -> publish: a human node the ordinary gate still judges (R13). */
function humanFlow(ws: Workspace): void {
  writeFlow(ws, "human", [
    { id: "draft", capabilities: ["artifact.write", "emit"], schema: "praxis.artifact.architecture/v1" },
    { id: "review", capabilities: ["artifact.read", "artifact.write", "emit", "evaluate"], schema: "praxis.artifact.derive/v1", wait: WAIT, quality: RUBRIC },
    { id: "publish", capabilities: ["artifact.read", "artifact.write", "emit"], schema: "praxis.artifact.publish/v1" },
  ] as never);
}

/** Park an instance at `review` and return what the resume cases need. */
function park(ws: Workspace, tick: () => string, requestId: string) {
  humanFlow(ws);
  const started = start({ ...learningOptions(ws, tick()), flow: flowRef("human"), requestId, actor: "a" });
  const arrivedAt = tick();
  const out = advance({ ...learningOptions(ws, arrivedAt), instance: started.instance.id, actor: "a", artifact: { schema: "praxis.artifact.architecture/v1", nonce: started.instance.nonce } });
  assert.equal(out.instance.status, "waiting");
  return { instance: started.instance.id, nonce: started.instance.nonce, arrivedAt, draftDigest: out.handoffs[0]!.digest };
}

const codeOf = (work: () => unknown): string => {
  try {
    work();
    return "none";
  } catch (error) {
    return isAppError(error) ? error.code : "THREW";
  }
};

test("R5/R6: a matching event resumes at the SAME step with exactly one receipt", () => {
  const ws = workspace();
  const ticks = clock();
  const tick = ticks.next;
  try {
    const run = park(ws, tick, "resume-1");
    const out = resume({ ...learningOptions(ws, tick()), instance: run.instance, actor: "a", event: { type: "human.submitted", fields: { ticket: 7 } } });
    assert.equal(out.instance.status, "running");
    assert.equal(out.instance.currentStep, "review", "the same step");
    const receipts = eventsOf(ws, run.instance).filter((event) => event.type === "wait.resumed");
    assert.equal(receipts.length, 1, "one receipt per resume");
    const payload = receipts[0]!.payload as Record<string, unknown>;
    assert.equal(payload.step, "review");
    assert.equal(payload.eventType, "human.submitted");
    assert.deepEqual(payload.matched, { ticket: 7 }, "only the declared field is stored");
    assert.match(String(payload.eventDigest), /^sha256:[0-9a-f]{64}$/);
    assert.equal(typeof payload.parkSeq, "number");
  } finally {
    dispose(ws);
  }
});

test("R9: a wrong value, a missing field and a wrong type each refuse with ZERO writes", () => {
  const ws = workspace();
  const ticks = clock();
  const tick = ticks.next;
  try {
    const run = park(ws, tick, "resume-2");
    const before = { events: eventsOf(ws, run.instance).length, status: instanceRow(ws, run.instance)!.status, revision: instanceRow(ws, run.instance)!.revision };
    const base = { ...learningOptions(ws, tick()), instance: run.instance, actor: "a" };
    assert.equal(codeOf(() => resume({ ...base, event: { type: "human.submitted", fields: { ticket: 8 } } })), "WAIT_EVENT_INVALID");
    assert.equal(codeOf(() => resume({ ...base, event: { type: "human.submitted", fields: {} } })), "WAIT_EVENT_INVALID");
    assert.equal(codeOf(() => resume({ ...base, event: { type: "human.submitted", fields: { ticket: "7" } } })), "WAIT_EVENT_INVALID");
    assert.equal(codeOf(() => resume({ ...base, event: { type: "human.approved", fields: { ticket: 7 } } })), "WAIT_EVENT_INVALID");
    assert.deepEqual(
      { events: eventsOf(ws, run.instance).length, status: instanceRow(ws, run.instance)!.status, revision: instanceRow(ws, run.instance)!.revision },
      before,
      "no event, no status move, no revision bump",
    );
  } finally {
    dispose(ws);
  }
});

test("R9: an undeclared extra field is ignored and still resumes", () => {
  const ws = workspace();
  const ticks = clock();
  const tick = ticks.next;
  try {
    const run = park(ws, tick, "resume-3");
    const out = resume({ ...learningOptions(ws, tick()), instance: run.instance, actor: "a", event: { type: "human.submitted", fields: { ticket: 7, note: "extra" } } });
    assert.equal(out.instance.status, "running");
    const payload = eventsOf(ws, run.instance).find((event) => event.type === "wait.resumed")!.payload as Record<string, unknown>;
    assert.deepEqual(payload.matched, { ticket: 7 }, "the receipt carries no undeclared field");
  } finally {
    dispose(ws);
  }
});

test("R5: a stranger is INSTANCE_FORBIDDEN and a resume while running is INSTANCE_STATE_INVALID", () => {
  const ws = workspace();
  const ticks = clock();
  const tick = ticks.next;
  try {
    const run = park(ws, tick, "resume-4");
    assert.equal(codeOf(() => resume({ ...learningOptions(ws, tick()), instance: run.instance, actor: "stranger", event: { type: "human.submitted", fields: { ticket: 7 } } })), "INSTANCE_FORBIDDEN");
    resume({ ...learningOptions(ws, tick()), instance: run.instance, actor: "a", event: { type: "human.submitted", fields: { ticket: 7 } } });
    assert.equal(codeOf(() => resume({ ...learningOptions(ws, tick()), instance: run.instance, actor: "a", event: { type: "human.submitted", fields: { ticket: 7 } } })), "INSTANCE_STATE_INVALID");
  } finally {
    dispose(ws);
  }
});

test("R7/R12: two identical resumes write one receipt, and a repeated start forks nothing", () => {
  const ws = workspace();
  const ticks = clock();
  const tick = ticks.next;
  try {
    const run = park(ws, tick, "resume-5");
    const event = { type: "human.submitted", fields: { ticket: 7 } };
    resume({ ...learningOptions(ws, tick()), instance: run.instance, actor: "a", event });
    const after = eventsOf(ws, run.instance).length;
    // A redelivered event after the resume finds the instance running, which is the documented refusal.
    assert.equal(codeOf(() => resume({ ...learningOptions(ws, tick()), instance: run.instance, actor: "a", event })), "INSTANCE_STATE_INVALID");
    assert.equal(eventsOf(ws, run.instance).filter((event) => event.type === "wait.resumed").length, 1);
    assert.equal(eventsOf(ws, run.instance).length, after, "the duplicate writes nothing");
    const again = start({ ...learningOptions(ws, tick()), flow: flowRef("human"), requestId: "resume-5", actor: "a" });
    assert.equal(again.created, false, "one request id, one instance");
    assert.equal(again.instance.id, run.instance);
  } finally {
    dispose(ws);
  }
});

test("R8: a resume past the deadline fails the instance closed and writes no receipt", () => {
  const ws = workspace();
  const ticks = clock();
  const tick = ticks.next;
  try {
    const run = park(ws, tick, "resume-6");
    const late = new Date(Date.parse(run.arrivedAt) + 61000).toISOString();
    assert.equal(codeOf(() => resume({ ...learningOptions(ws, late), instance: run.instance, actor: "a", event: { type: "human.submitted", fields: { ticket: 7 } } })), "WAIT_TIMEOUT");
    assert.equal(String(instanceRow(ws, run.instance)!.status), "failed");
    assert.equal(eventsOf(ws, run.instance).filter((event) => event.type === "wait.resumed").length, 0, "no receipt");
    const failed = eventsOf(ws, run.instance).find((event) => event.type === "instance.failed")!.payload as Record<string, unknown>;
    assert.equal(failed.code, "WAIT_TIMEOUT");
    assert.equal(failed.step, "review");
    const view = inspect({ ...learningOptions(ws, late), instance: run.instance });
    assert.equal(view.instance.status, "failed");
    assert.match(String(view.instance.failedReason), /deadline/, "failedReason derives from the event");
  } finally {
    dispose(ws);
  }
});

test("R13: park -> resume -> submit still meets the ordinary quality gate", async () => {
  const ws = workspace();
  const ticks = clock();
  const tick = ticks.next;
  try {
    const run = park(ws, tick, "resume-7");
    resume({ ...learningOptions(ws, tick()), instance: run.instance, actor: "a", event: { type: "human.submitted", fields: { ticket: 7 } } });
    const submitted = advanceEvaluated({
      ...learningOptions(ws, tick()),
      instance: run.instance,
      actor: "a",
      artifact: { schema: "praxis.artifact.derive/v1", nonce: run.nonce, derivedFrom: run.draftDigest },
      scorer: dimensionScorer([{ solves: 0.2 }]) as never,
    });
    await assert.rejects(submitted, (error) => isAppError(error) && error.code === "QUALITY_BELOW_THRESHOLD");
    assert.equal(String(instanceRow(ws, run.instance)!.status), "running", "a refusal is evidence, not death");
    assert.equal(String(instanceRow(ws, run.instance)!.current_step), "review", "the step stays current for a retry");
  } finally {
    dispose(ws);
  }
});
