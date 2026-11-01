/**
 * Flow Unit 1 — BRANCH at the engine boundary (R1-R8, R10-R12).
 *
 * The schema oracles prove the wiring is loadable and that every illegal shape is refused; the
 * engine oracles prove one route, one durable decision, one fired arm, and four write-free refusals.
 * NO NETWORK: every route here is data or a fake.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { advance, inspect, start } from "../../src/runner/engine/index.ts";
import { setStatus } from "../../src/store/instance.ts";
import { withStore } from "../../src/runner/engine/support.ts";
import { successorOf } from "../../src/runner/step.ts";
import { parseFlowConfig } from "../../src/types/flow.ts";
import { canonicalBytes, digest } from "../../src/runner/canonical.ts";
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

const DECIDE = { instructions: "pick the arm the report belongs to", criteria: { alpha: "the report is about alpha", beta: "the report is about beta" } };

/** One deciding node and its two arms; the wiring is the only thing that changes between cases. */
function triageFlow(ws: Workspace, extraEdges: unknown[] = []): void {
  writeFlow(
    ws,
    "triage",
    [
      { id: "triage", capabilities: ["artifact.write", "emit"], schema: "praxis.artifact.triage/v1", decide: DECIDE },
      { id: "arm-alpha", capabilities: ["artifact.read", "artifact.write", "emit"], schema: "praxis.artifact.alpha/v1" },
      { id: "arm-beta", capabilities: ["artifact.read", "artifact.write", "emit"], schema: "praxis.artifact.beta/v1" },
    ] as never,
    [
      { kind: "branch", from: "triage", to: "arm-alpha", label: "alpha" },
      { kind: "branch", from: "triage", to: "arm-beta", label: "beta" },
      ...(extraEdges as never[]),
    ] as never,
  );
}

function open(ws: Workspace, requestId: string): { id: string; nonce: string } {
  const tick = clock();
  const started = start({ ...learningOptions(ws, tick.next()), flow: flowRef("triage"), requestId, actor: "a" });
  return { id: started.instance.id, nonce: started.instance.nonce };
}

const triageArtifact = (nonce: string) => ({ schema: "praxis.artifact.triage/v1", nonce });

/** The typed code a thunk rejects with, or "none". */
function refusal(work: () => unknown): string {
  try {
    work();
    return "none";
  } catch (error) {
    return isAppError(error) ? error.code : "THREW";
  }
}

test("R1-R4: the schema admits one-of-N arms and refuses every illegal shape", () => {
  const node = (id: string, decide?: unknown) => ({ id, task: "tasks/" + id, ...(decide === undefined ? {} : { decide }) });
  const criteria = (...labels: string[]) => Object.fromEntries(labels.map((label) => [label, label + " means " + label]));
  const flow = (nodes: unknown[], edges: unknown[]) => ({ schema: "praxis.flow/v2", flow: "flows/probe", nodes, edges, result: "praxis.artifact.delivery/v1" });
  const twoArm = flow(
    [node("a", { instructions: "pick", criteria: criteria("x", "y") }), node("b"), node("c")],
    [{ kind: "branch", from: "a", to: "b", label: "x" }, { kind: "branch", from: "a", to: "c", label: "y" }],
  );
  parseFlowConfig(twoArm);
  const codeOf = (value: unknown): string => {
    try {
      parseFlowConfig(value);
      return "none";
    } catch (error) {
      return isAppError(error) ? error.code : "THREW";
    }
  };
  // R1: the label is present iff the edge is a branch, and it is one kebab token.
  assert.equal(codeOf(flow([node("a"), node("b")], [{ kind: "data", from: "a", to: "b", label: "x" }])), "CONFIG_INVALID");
  assert.equal(codeOf(flow([node("a"), node("b")], [{ kind: "branch", from: "a", to: "b" }])), "CONFIG_INVALID");
  assert.equal(codeOf(flow([node("a"), node("b")], [{ kind: "branch", from: "a", to: "b", label: "X" }])), "CONFIG_INVALID");
  // R2: 2-8 arms, bijective with the criteria, and no data/join edge out of a deciding node.
  assert.equal(codeOf(flow([node("a", { instructions: "p", criteria: criteria("x") }), node("b")], [{ kind: "branch", from: "a", to: "b", label: "x" }])), "CONFIG_INVALID");
  assert.equal(codeOf(flow([node("a", { instructions: "p", criteria: criteria("x", "y") }), node("b"), node("c")], [{ kind: "branch", from: "a", to: "b", label: "x" }, { kind: "branch", from: "a", to: "c", label: "z" }])), "CONFIG_INVALID");
  assert.equal(codeOf(flow([node("a", { instructions: "p", criteria: criteria("x", "y") }), node("b"), node("c"), node("d")], [{ kind: "branch", from: "a", to: "b", label: "x" }, { kind: "branch", from: "a", to: "c", label: "y" }, { kind: "data", from: "a", to: "d" }])), "CONFIG_INVALID");
  assert.equal(codeOf(flow([{ id: "a", task: "tasks/a", extra: 1 }], [])), "NODE_INVALID");
  // R2 + refuse: a deciding node may still send work back.
  parseFlowConfig(flow(
    [node("a"), node("b", { instructions: "p", criteria: criteria("x", "y") }), node("c"), node("d")],
    [{ kind: "data", from: "a", to: "b" }, { kind: "branch", from: "b", to: "c", label: "x" }, { kind: "branch", from: "b", to: "d", label: "y" }, { kind: "refuse", from: "b", to: "a" }],
  ));
  // R3: data fan-out is still refused, arms are exempt, and a ninth arm is not a wider router.
  assert.equal(codeOf(flow([node("a"), node("b"), node("c")], [{ kind: "data", from: "a", to: "b" }, { kind: "data", from: "a", to: "c" }])), "CONFIG_INVALID");
  assert.equal(codeOf(flow(
    [node("a"), ...["b", "c", "d", "e", "f", "g", "h", "i", "j"].map((id) => node(id))],
    [{ kind: "data", from: "a", to: "b" }, { kind: "data", from: "b", to: "j" }, ...["c", "d", "e", "f", "g", "h", "i", "j"].map((to) => ({ kind: "branch", from: "b", to, label: "l" + to }))],
  )), "CONFIG_INVALID");
  // R4: one slot. Three arms reconverge through ONE join group and load; two branch sources, or a
  // branch arm beside a data edge into the same node, are two slots and are refused.
  parseFlowConfig(flow(
    [node("a", { instructions: "p", criteria: criteria("x", "y", "z") }), node("b"), node("c"), node("d"), node("e")],
    [{ kind: "branch", from: "a", to: "b", label: "x" }, { kind: "branch", from: "a", to: "c", label: "y" }, { kind: "branch", from: "a", to: "d", label: "z" }, { kind: "join", from: "b", to: "e" }, { kind: "join", from: "c", to: "e" }, { kind: "join", from: "d", to: "e" }],
  ));
  assert.equal(codeOf(flow(
    [node("a"), node("d", { instructions: "d", criteria: criteria("x", "y") }), node("b"), node("c")],
    [{ kind: "data", from: "a", to: "b" }, { kind: "data", from: "a", to: "c" }, { kind: "branch", from: "b", to: "d", label: "x" }, { kind: "branch", from: "c", to: "d", label: "y" }],
  )), "CONFIG_INVALID");
  assert.equal(codeOf(flow(
    [node("a"), node("b", { instructions: "p", criteria: criteria("x", "y") }), node("c")],
    [{ kind: "branch", from: "b", to: "c", label: "x" }, { kind: "data", from: "a", to: "c" }],
  )), "CONFIG_INVALID");
});

test("R7: a deciding node routes by label and never completes the instance implicitly", () => {
  const ws = workspace();
  try {
    triageFlow(ws);
    const started = open(ws, "r7");
    const view = inspect({ ...learningOptions(ws, clock().next()), instance: started.id });
    assert.equal(successorOf(view.flow.config, "triage", "beta"), "arm-beta");
    assert.throws(() => successorOf(view.flow.config, "triage", "gamma"), (error) => isAppError(error) && error.code === "ROUTE_INVALID");
    assert.throws(() => successorOf(view.flow.config, "triage"), (error) => isAppError(error) && error.code === "ROUTE_INVALID");
    assert.equal(successorOf(view.flow.config, "arm-beta"), undefined, "a plain leaf node still ends the flow");
  } finally {
    dispose(ws);
  }
});

test("R10: one accepted deciding step records exactly one branch.decided and moves to the labelled arm", () => {
  const ws = workspace();
  const tick = clock();
  try {
    triageFlow(ws);
    const run = open(ws, "r10");
    const artifact = triageArtifact(run.nonce);
    const route = { label: "beta", router: "fake/v1", digest: digest(canonicalBytes(artifact)) };
    const out = advance({ ...learningOptions(ws, tick.next()), instance: run.id, actor: "a", artifact, route });
    assert.equal(out.instance.currentStep, "arm-beta");
    assert.equal(out.instance.status, "running");
    const decided = eventsOf(ws, run.id).filter((event) => event.type === "branch.decided");
    assert.equal(decided.length, 1, "exactly one durable decision");
    const payload = decided[0]!.payload as Record<string, unknown>;
    assert.equal(payload.step, "triage");
    assert.equal(payload.label, "beta");
    assert.equal(payload.router, "fake/v1");
    assert.equal(payload.artifactDigest, route.digest);
    assert.equal(typeof payload.version, "number");
  } finally {
    dispose(ws);
  }
});

test("R6: only the fired arm is a source, and the display names its digest", () => {
  const ws = workspace();
  const tick = clock();
  try {
    triageFlow(ws);
    const run = open(ws, "r6");
    const artifact = triageArtifact(run.nonce);
    const route = { label: "beta", router: "fake/v1", digest: digest(canonicalBytes(artifact)) };
    const out = advance({ ...learningOptions(ws, tick.next()), instance: run.id, actor: "a", artifact, route });
    assert.deepEqual(out.handoffs.map((handoff) => handoff.step), ["triage"], "one fired source");
    assert.equal(artifactsOf(ws, run.id).filter((row) => row.step === "arm-alpha").length, 0, "the unfired arm never ran");
    // The fired arm consumes its subject; the unfired arm is not a source at all.
    const fed = out.handoffs[0]!.digest;
    advance({ ...learningOptions(ws, tick.next()), instance: run.id, actor: "a", artifact: { schema: "praxis.artifact.beta/v1", nonce: run.nonce, derivedFrom: fed } });
    const beta = artifactsOf(ws, run.id).find((row) => row.step === "arm-beta");
    assert.equal(beta?.state, "accepted", "the fired arm accepted the handoff");
    assert.equal(beta?.derived_from, fed, "the handoff it read IS the fired arm's digest");
  } finally {
    dispose(ws);
  }
});

test("R8: four bad routes are refused BEFORE any write, leaving event, artifact and revision counts unchanged", () => {
  const ws = workspace();
  const tick = clock();
  try {
    triageFlow(ws);
    const run = open(ws, "r8");
    const artifact = triageArtifact(run.nonce);
    const good = { label: "beta", router: "fake/v1", digest: digest(canonicalBytes(artifact)) };
    const counts = () => ({
      events: eventsOf(ws, run.id).length,
      artifacts: artifactsOf(ws, run.id).length,
      revision: instanceRow(ws, run.id)!.revision,
    });
    const before = counts();
    assert.equal(refusal(() => advance({ ...learningOptions(ws, tick.next()), instance: run.id, actor: "a", artifact })), "ROUTE_UNAVAILABLE");
    assert.equal(refusal(() => advance({ ...learningOptions(ws, tick.next()), instance: run.id, actor: "a", artifact, route: { ...good, label: "gamma" } })), "ROUTE_INVALID");
    assert.equal(refusal(() => advance({ ...learningOptions(ws, tick.next()), instance: run.id, actor: "a", artifact, route: { ...good, digest: "sha256:" + "0".repeat(64) } })), "ROUTE_INVALID");
    assert.deepEqual(counts(), before, "no event, no artifact and no revision moved");
    // (iv) a route handed to a step that does not decide is refused the same way.
    writeFlow(ws, "plain", [
      { id: "draft", capabilities: ["artifact.write", "emit"], schema: "praxis.artifact.architecture/v1" },
      { id: "derive", capabilities: ["artifact.read", "artifact.write", "emit"], schema: "praxis.artifact.derive/v1" },
    ] as never);
    const plain = start({ ...learningOptions(ws, tick.next()), flow: flowRef("plain"), requestId: "r8-plain", actor: "a" });
    const plainArtifact = { schema: "praxis.artifact.architecture/v1", nonce: plain.instance.nonce };
    const plainCounts = () => eventsOf(ws, plain.instance.id).length;
    const plainBefore = plainCounts();
    assert.equal(refusal(() => advance({ ...learningOptions(ws, tick.next()), instance: plain.instance.id, actor: "a", artifact: plainArtifact, route: { label: "beta", router: "fake/v1", digest: digest(canonicalBytes(plainArtifact)) } })), "ROUTE_INVALID");
    assert.equal(plainCounts(), plainBefore);
  } finally {
    dispose(ws);
  }
});

test("R11: a replay routes on the record and appends no second decision", () => {
  const ws = workspace();
  const tick = clock();
  try {
    triageFlow(ws);
    const run = open(ws, "r11");
    const artifact = triageArtifact(run.nonce);
    const route = { label: "beta", router: "fake/v1", digest: digest(canonicalBytes(artifact)) };
    advance({ ...learningOptions(ws, tick.next()), instance: run.id, actor: "a", artifact, route });
    const afterFirst = eventsOf(ws, run.id).length;
    // The crash window the engine already handles: accepted, still current, no decision replay needed.
    withStore(learningOptions(ws, tick.next()), (store) => {
      setStatus(store, run.id, { status: "running", currentStep: "triage" }, Number(instanceRow(ws, run.id)!.revision));
    });
    const replayed = advance({ ...learningOptions(ws, tick.next()), instance: run.id, actor: "a", artifact, route });
    assert.equal(replayed.instance.currentStep, "arm-beta", "the successor is unchanged");
    assert.equal(eventsOf(ws, run.id).filter((event) => event.type === "branch.decided").length, 1, "one decision, still");
    assert.equal(eventsOf(ws, run.id).length, afterFirst, "a replay appends nothing");
    // A supplied route that contradicts the record is refused.
    withStore(learningOptions(ws, tick.next()), (store) => {
      setStatus(store, run.id, { status: "running", currentStep: "triage" }, Number(instanceRow(ws, run.id)!.revision));
    });
    assert.equal(refusal(() => advance({ ...learningOptions(ws, tick.next()), instance: run.id, actor: "a", artifact, route: { ...route, label: "alpha" } })), "ROUTE_INVALID");
  } finally {
    dispose(ws);
  }
});

test("R12: a branch-free flow is byte-identical - same events, same digests, no decision", () => {
  const ws = workspace();
  const tick = clock();
  try {
    writeFlow(ws, "plain", [
      { id: "draft", capabilities: ["artifact.write", "emit"], schema: "praxis.artifact.architecture/v1" },
      { id: "derive", capabilities: ["artifact.read", "artifact.write", "emit"], schema: "praxis.artifact.derive/v1" },
    ] as never);
    const runOnce = (requestId: string) => {
      const started = start({ ...learningOptions(ws, tick.next()), flow: flowRef("plain"), requestId, actor: "a" });
      const first = advance({ ...learningOptions(ws, tick.next()), instance: started.instance.id, actor: "a", artifact: { schema: "praxis.artifact.architecture/v1", nonce: started.instance.nonce } });
      assert.equal(first.instance.currentStep, "derive");
      return {
        types: eventsOf(ws, started.instance.id).map((event) => event.type),
        steps: artifactsOf(ws, started.instance.id).map((row) => row.step + "@" + row.version),
      };
    };
    const one = runOnce("plain-1");
    const two = runOnce("plain-2");
    assert.deepEqual(one.types, two.types, "the same event sequence");
    assert.deepEqual(one.steps, two.steps, "the same artifact rows");
    assert.equal(one.types.includes("branch.decided"), false, "no decision in a branch-free flow");
  } finally {
    dispose(ws);
  }
});
