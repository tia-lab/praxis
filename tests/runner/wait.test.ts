/**
 * Flow Unit 2 — WAIT: the arrival side (R1-R4, R14).
 *
 * An arrival at a `wait` node parks: one durable `instance.parked`, status `waiting`, no step run.
 * A repeated arrival appends no second park, a flow with no wait never parks, and the transition map
 * refuses a park that would skip the work. NO NETWORK.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { advance, arriveAt, inspect, start } from "../../src/runner/engine/index.ts";
import { setStatus } from "../../src/store/instance.ts";
import { withStore } from "../../src/runner/engine/support.ts";
import { isAppError } from "../../src/types/errors.ts";
import {
  artifactsOf,
  clock,
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

/** draft -> review(wait) -> publish: the parked shape every case here starts from. */
function gatedFlow(ws: Workspace): void {
  writeFlow(ws, "gated", [
    { id: "draft", capabilities: ["artifact.write", "emit"], schema: "praxis.artifact.architecture/v1" },
    { id: "review", capabilities: ["artifact.read", "artifact.write", "emit"], schema: "praxis.artifact.derive/v1", wait: WAIT },
    { id: "publish", capabilities: ["artifact.read", "artifact.write", "emit"], schema: "praxis.artifact.publish/v1" },
  ] as never);
}

function open(ws: Workspace, flow: string, requestId: string, at: string) {
  return start({ ...learningOptions(ws, at), flow: flowRef(flow), requestId, actor: "a" });
}

test("R3/R4: accepting the predecessor parks at the wait node with exactly one park record", () => {
  const ws = workspace();
  const tick = clock();
  try {
    gatedFlow(ws);
    const at = tick.next();
    const started = open(ws, "gated", "park-1", at);
    const arrivedAt = tick.next();
    const out = advance({ ...learningOptions(ws, arrivedAt), instance: started.instance.id, actor: "a", artifact: { schema: "praxis.artifact.architecture/v1", nonce: started.instance.nonce } });
    assert.equal(out.instance.status, "waiting");
    assert.equal(out.instance.currentStep, "review");
    const parks = eventsOf(ws, started.instance.id).filter((event) => event.type === "instance.parked");
    assert.equal(parks.length, 1, "one park per arrival");
    const payload = parks[0]!.payload as Record<string, unknown>;
    assert.equal(payload.step, "review");
    assert.equal(payload.eventType, "human.submitted");
    assert.deepEqual(payload.match, { ticket: 7 });
    assert.equal(payload.deadline, new Date(Date.parse(arrivedAt) + 60000).toISOString(), "the deadline comes from the injected clock");
    assert.equal(artifactsOf(ws, started.instance.id).length, 1, "the parked step ran nothing");
    assert.equal(out.result.status, "waiting");
    assert.equal(out.result.nextAction, "wait: human.submitted", "R10: the parked result names the event");
    assert.equal(out.result.summary, "waiting at review: 1 artifact(s) accepted");
  } finally {
    dispose(ws);
  }
});

test("R3: a repeated arrival appends no second park (idempotent by construction)", () => {
  const ws = workspace();
  const tick = clock();
  try {
    gatedFlow(ws);
    const started = open(ws, "gated", "park-2", tick.next());
    advance({ ...learningOptions(ws, tick.next()), instance: started.instance.id, actor: "a", artifact: { schema: "praxis.artifact.architecture/v1", nonce: started.instance.nonce } });
    const before = eventsOf(ws, started.instance.id).length;
    const view = inspect({ ...learningOptions(ws, tick.next()), instance: started.instance.id });
    withStore(learningOptions(ws, tick.next()), (store) => {
      arriveAt(store, view.instance, view.flow, "review", tick.next());
    });
    assert.equal(eventsOf(ws, started.instance.id).filter((event) => event.type === "instance.parked").length, 1);
    assert.equal(eventsOf(ws, started.instance.id).length, before, "a repeat arrival writes no event");
    assert.equal(String(instanceRow(ws, started.instance.id)!.status), "waiting");
  } finally {
    dispose(ws);
  }
});

test("R3/R14: a flow with no wait node never parks and keeps its status and events", () => {
  const ws = workspace();
  const tick = clock();
  try {
    writeFlow(ws, "plain", [
      { id: "draft", capabilities: ["artifact.write", "emit"], schema: "praxis.artifact.architecture/v1" },
      { id: "derive", capabilities: ["artifact.read", "artifact.write", "emit"], schema: "praxis.artifact.derive/v1" },
    ] as never);
    const started = open(ws, "plain", "plain-1", tick.next());
    const out = advance({ ...learningOptions(ws, tick.next()), instance: started.instance.id, actor: "a", artifact: { schema: "praxis.artifact.architecture/v1", nonce: started.instance.nonce } });
    assert.equal(out.instance.status, "running");
    assert.equal(out.instance.currentStep, "derive");
    assert.equal(eventsOf(ws, started.instance.id).filter((event) => event.type === "instance.parked").length, 0);
    assert.equal(out.result.nextAction, "resume", "an unparked running instance is asked to resume, as before");
  } finally {
    dispose(ws);
  }
});

test("R1: a waiting instance cannot be advanced or completed directly, and both refusals write nothing", () => {
  const ws = workspace();
  const tick = clock();
  try {
    gatedFlow(ws);
    const started = open(ws, "gated", "park-3", tick.next());
    advance({ ...learningOptions(ws, tick.next()), instance: started.instance.id, actor: "a", artifact: { schema: "praxis.artifact.architecture/v1", nonce: started.instance.nonce } });
    const before = { events: eventsOf(ws, started.instance.id).length, revision: instanceRow(ws, started.instance.id)!.revision };
    assert.throws(
      () => advance({ ...learningOptions(ws, tick.next()), instance: started.instance.id, actor: "a", artifact: { schema: "praxis.artifact.derive/v1", nonce: started.instance.nonce } }),
      (error) => isAppError(error) && error.code === "INSTANCE_STATE_INVALID",
    );
    assert.throws(
      () => withStore(learningOptions(ws, tick.next()), (store) => setStatus(store, started.instance.id, { status: "completed", currentStep: "review" }, Number(instanceRow(ws, started.instance.id)!.revision))),
      (error) => isAppError(error) && error.code === "INSTANCE_STATE_INVALID",
    );
    assert.deepEqual({ events: eventsOf(ws, started.instance.id).length, revision: instanceRow(ws, started.instance.id)!.revision }, before);
  } finally {
    dispose(ws);
  }
});

test("R3: a wait on the FIRST node parks at start, with no deadline when no timeout is declared", () => {
  const ws = workspace();
  const tick = clock();
  try {
    writeFlow(ws, "first-wait", [
      { id: "intake", capabilities: ["artifact.write", "emit"], schema: "praxis.artifact.architecture/v1", wait: { on: { type: "human.submitted" } } },
      { id: "work", capabilities: ["artifact.read", "artifact.write", "emit"], schema: "praxis.artifact.derive/v1" },
    ] as never);
    const started = open(ws, "first-wait", "first-1", tick.next());
    assert.equal(started.created, true);
    assert.equal(started.instance.status, "waiting");
    assert.equal(started.instance.currentStep, "intake");
    const parks = eventsOf(ws, started.instance.id).filter((event) => event.type === "instance.parked");
    assert.equal(parks.length, 1);
    assert.equal((parks[0]!.payload as Record<string, unknown>).eventType, "human.submitted");
    assert.equal((parks[0]!.payload as Record<string, unknown>).deadline, undefined, "no timeout declared, no deadline");
  } finally {
    dispose(ws);
  }
});
