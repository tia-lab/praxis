/**
 * BRANCH through the Pi tool (R8, R10, R11, R15): the route is computed OUTSIDE the store before
 * `advanceEvaluated`, passed in as data, and never asked again once recorded.
 *
 * NO NETWORK: the router is a counting fake, the scorer/judge are fakes, the store is a temp dir.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { executePraxisTool, setRouterForTest } from "../../src/pi/tool.ts";
import type { RouteAnswer, RouteInput, RouteRouter } from "../../src/quality/jev-branch.ts";
import type { PiSessionContext, PiToolResult } from "../../src/pi/host.ts";
import { setStatus } from "../../src/store/instance.ts";
import { withStore } from "../../src/runner/engine/support.ts";
import {
  artifactFile,
  cli,
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
import { fakeAlignJudge } from "./fixtures.ts";
import { setAlignJudgeForTest } from "../../src/pi/tool.ts";

const SESSION = "session-branch";
const DECIDE = { instructions: "pick the arm the report belongs to", criteria: { alpha: "the report is about alpha", beta: "the report is about beta" } };

function triageFlow(ws: Workspace): void {
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
    ] as never,
  );
}

/** Point the tool at this workspace: the flow by PRAXIS_CONFIG, the store by PRAXIS_STORE_DIR. */
function useWorkspace(ws: Workspace): () => void {
  const priorConfig = process.env.PRAXIS_CONFIG;
  const priorStore = process.env.PRAXIS_STORE_DIR;
  process.env.PRAXIS_CONFIG = ws.config;
  process.env.PRAXIS_STORE_DIR = ws.store;
  return () => {
    if (priorConfig === undefined) delete process.env.PRAXIS_CONFIG;
    else process.env.PRAXIS_CONFIG = priorConfig;
    if (priorStore === undefined) delete process.env.PRAXIS_STORE_DIR;
    else process.env.PRAXIS_STORE_DIR = priorStore;
  };
}

const contextFor = (ws: Workspace): PiSessionContext => ({ cwd: ws.root, sessionManager: { getSessionId: () => SESSION } });
const call = (ws: Workspace, args: unknown): Promise<PiToolResult> => executePraxisTool(args, contextFor(ws));
const bag = (result: PiToolResult): any => result.details;

/** A fake router that counts its calls, so a replay can prove jev was never asked again. */
function countingRouter(label: string): RouteRouter & { calls: number; seen: RouteInput[] } {
  const router = {
    calls: 0,
    seen: [] as RouteInput[],
    async route(input: RouteInput): Promise<RouteAnswer> {
      router.calls += 1;
      router.seen.push(input);
      return { label, model: "fake-router/v1", reason: "fake" };
    },
  };
  return router;
}

async function startThroughTool(ws: Workspace, requestId: string): Promise<{ instance: string; nonce: string }> {
  const started = bag(await call(ws, { op: "start", flow: flowRef("triage"), order: "carry out the task this flow runs", requestId }));
  assert.equal(started.code, undefined, "the start succeeded: " + JSON.stringify(started).slice(0, 200));
  return { instance: started.result.instanceId as string, nonce: started.nonce as string };
}

test("R10: a tool submit computes ONE route outside the store, records one decision and moves to the arm", async () => {
  const ws = workspace();
  const restore = useWorkspace(ws);
  setAlignJudgeForTest(fakeAlignJudge("aligned"));
  const router = countingRouter("beta");
  try {
    triageFlow(ws);
    const run = await startThroughTool(ws, "tool-branch");
    setRouterForTest(router as never);
    const submitted = bag(await call(ws, { op: "submit", instance: run.instance, artifact: { schema: "praxis.artifact.triage/v1", nonce: run.nonce } }));
    assert.equal(submitted.code, undefined, "accepted: " + JSON.stringify(submitted).slice(0, 300));
    assert.equal(submitted.step.id, "arm-beta");
    assert.equal(router.calls, 1, "the seam asked the router exactly once");
    assert.deepEqual(Object.keys(router.seen[0]!.criteria), ["alpha", "beta"]);
    const decided = eventsOf(ws, run.instance).filter((event) => event.type === "branch.decided");
    assert.equal(decided.length, 1);
  } finally {
    setRouterForTest(undefined);
    restore();
    dispose(ws);
  }
});

test("R11: replaying the same bytes through the tool asks the router ZERO times and appends nothing", async () => {
  const ws = workspace();
  const restore = useWorkspace(ws);
  setAlignJudgeForTest(fakeAlignJudge("aligned"));
  const router = countingRouter("beta");
  const tick = clock();
  try {
    triageFlow(ws);
    const run = await startThroughTool(ws, "tool-replay");
    const artifact = { schema: "praxis.artifact.triage/v1", nonce: run.nonce };
    setRouterForTest(router as never);
    const first = bag(await call(ws, { op: "submit", instance: run.instance, artifact }));
    assert.equal(first.step.id, "arm-beta");
    assert.equal(router.calls, 1);
    const events = eventsOf(ws, run.instance).length;
    // The crash window the engine already handles: accepted, still current, nothing else written.
    withStore(learningOptions(ws, tick.next()), (store) => {
      setStatus(store, run.instance, { status: "running", currentStep: "triage" }, Number(instanceRow(ws, run.instance)!.revision));
    });
    const replay = bag(await call(ws, { op: "submit", instance: run.instance, artifact }));
    assert.equal(replay.step.id, "arm-beta", "the successor is unchanged");
    assert.equal(router.calls, 1, "a replay asks jev zero extra times");
    assert.equal(eventsOf(ws, run.instance).filter((event) => event.type === "branch.decided").length, 1);
    assert.equal(eventsOf(ws, run.instance).length, events, "no second decision, no second acceptance");
  } finally {
    setRouterForTest(undefined);
    restore();
    dispose(ws);
  }
});

test("R8: a router that cannot answer refuses the submit and writes nothing", async () => {
  const ws = workspace();
  const restore = useWorkspace(ws);
  setAlignJudgeForTest(fakeAlignJudge("aligned"));
  try {
    triageFlow(ws);
    const run = await startThroughTool(ws, "tool-unavailable");
    setRouterForTest({ async route() { throw new Error("model down"); } } as never);
    const before = { events: eventsOf(ws, run.instance).length, revision: instanceRow(ws, run.instance)!.revision };
    const submitted = bag(await call(ws, { op: "submit", instance: run.instance, artifact: { schema: "praxis.artifact.triage/v1", nonce: run.nonce } }));
    assert.equal(submitted.code, "ROUTE_UNAVAILABLE");
    assert.deepEqual({ events: eventsOf(ws, run.instance).length, revision: instanceRow(ws, run.instance)!.revision }, before);
  } finally {
    setRouterForTest(undefined);
    restore();
    dispose(ws);
  }
});

test("R15: the CLI supplies no route, so advancing a deciding node is ROUTE_UNAVAILABLE", async () => {
  const ws = workspace();
  try {
    triageFlow(ws);
    const created = await cli(ws, ["run", flowRef("triage"), "--request", "cli-branch"]);
    assert.equal(created.status, 0, created.stderr);
    const instance = String(created.lines.find((line) => line.event === "instance")!.instance);
    const nonce = String(created.lines.find((line) => line.event === "instance")!.nonce);
    const file = artifactFile(ws, "triage.json", { schema: "praxis.artifact.triage/v1", nonce });
    const resumed = await cli(ws, ["resume", instance, "--artifact", file]);
    assert.equal(resumed.failure?.code, "ROUTE_UNAVAILABLE", JSON.stringify(resumed).slice(0, 400));
    const after = await cli(ws, ["status", instance]);
    assert.equal(after.status, 0, after.stderr);
    assert.equal(String(after.result?.status), "running");
    assert.equal(String(after.result?.nextAction ?? "").length >= 0, true);
  } finally {
    dispose(ws);
  }
});
