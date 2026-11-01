/**
 * S3: the active-step snapshot. The engine writes it at every boundary and the host reads it; it is a derived
 * hint, so a corrupt or absent file must degrade to "no domain" and never fail a step.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { executePraxisTool, setAlignJudgeForTest, setScorerForTest } from "../../src/pi/tool.ts";
import type { PiToolResult } from "../../src/pi/host.ts";
import { activePath, readActiveStep, snapshotActive, writeActiveStep } from "../../src/runner/engine/active.ts";
import { dispose, workspace, writeFlow, type Workspace } from "../testkit.ts";
import { artifacts, fakeAlignJudge, fakeContext } from "../pi/fixtures.ts";

const SESSION = "session-active-snapshot";
const SCHEMA = "praxis.artifact.architecture/v1";

const CODE = {
  id: "code",
  version: 1,
  layer: "domain",
  name: "Code",
  description: "source code",
  overview: "we read code",
  invariants: ["read before changing"],
  prefer: [],
  avoid: [],
};

function writeProfile(ws: Workspace): void {
  const dir = join(ws.root, ".pi", "praxis", "profile", "domain");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "code.json"), JSON.stringify(CODE, null, 2) + "\n");
}

const node = (id: string) => ({ id, capabilities: ["artifact.write", "artifact.read", "emit", "evaluate"], schema: SCHEMA, goal: `do ${id}` });

const call = (ws: Workspace, args: unknown): Promise<PiToolResult> =>
  executePraxisTool(args, fakeContext({ cwd: ws.root, sessionId: SESSION }));
const bag = (result: PiToolResult): any => result.details;

async function withEnv<T>(ws: Workspace, body: () => Promise<T>): Promise<T> {
  const prior = [process.env.PRAXIS_CONFIG, process.env.PRAXIS_STORE_DIR, process.env.PRAXIS_PROFILE_DIR];
  process.env.PRAXIS_CONFIG = ws.config;
  process.env.PRAXIS_STORE_DIR = ws.store;
  process.env.PRAXIS_PROFILE_DIR = join(ws.root, ".pi", "praxis", "profile");
  try {
    setAlignJudgeForTest(fakeAlignJudge("aligned"));
    return await body();
  } finally {
    setAlignJudgeForTest(undefined);
    setScorerForTest(undefined);
    for (const [index, key] of ["PRAXIS_CONFIG", "PRAXIS_STORE_DIR", "PRAXIS_PROFILE_DIR"].entries()) {
      if (prior[index] === undefined) delete process.env[key];
      else process.env[key] = prior[index];
    }
  }
}

async function start(ws: Workspace): Promise<any> {
  const started = bag(await withEnv(ws, () => call(ws, { op: "start", flow: "flows/learn", order: "make the artifact", requestId: "active" })));
  assert.equal(started.code, undefined, JSON.stringify(started).slice(0, 400));
  return started;
}

/** The first boundary: the snapshot names the first step and the domains that step declared. */
test("start writes the first step and its domains", async () => {
  const ws = workspace();
  try {
    writeProfile(ws);
    writeFlow(ws, "learn", [node("make"), node("check")], undefined, undefined, { make: ["code"] });
    const started = await start(ws);
    const active = readActiveStep(ws.store);
    assert.ok(active !== undefined, "the snapshot must exist after start");
    assert.equal(active.status, "running");
    assert.equal(active.step, "make");
    assert.equal(active.task, "tasks/make", "the task ref the node carries");
    assert.equal(active.instance, started.result.instanceId);
    assert.equal(active.flow, "flows/learn");
    assert.deepEqual(active.domains.map((domain) => domain.id), ["code"]);
    assert.equal(active.domains[0].overview, "we read code");
    assert.match(active.domains[0].digest, /^sha256:[0-9a-f]{64}$/);
  } finally {
    dispose(ws);
  }
});

/** Every advance rewrites it: the next step, and a node that declares no domain yields none. */
test("an advance moves the snapshot to the next step and drops the domain it did not declare", async () => {
  const ws = workspace();
  try {
    writeProfile(ws);
    writeFlow(ws, "learn", [node("make"), node("check")], undefined, undefined, { make: ["code"] });
    const started = await start(ws);
    const submitted = bag(await withEnv(ws, () => call(ws, {
      op: "submit",
      instance: started.result.instanceId,
      artifact: artifacts.validA(started.nonce),
    })));
    assert.equal(submitted.code, undefined, JSON.stringify(submitted).slice(0, 400));
    const active = readActiveStep(ws.store);
    assert.ok(active !== undefined);
    assert.equal(active.step, "check");
    assert.equal(active.status, "running");
    assert.deepEqual(active.domains, [], "the check node declares no domain");
  } finally {
    dispose(ws);
  }
});

/** A finished instance is `closed`: the host then composes conduct+role only. */
test("a completed instance closes the snapshot", async () => {
  const ws = workspace();
  try {
    writeProfile(ws);
    writeFlow(ws, "learn", [node("make")], undefined, undefined, { make: ["code"] });
    const started = await start(ws);
    const submitted = bag(await withEnv(ws, () => call(ws, {
      op: "submit",
      instance: started.result.instanceId,
      artifact: artifacts.validA(started.nonce),
    })));
    assert.equal(submitted.code, undefined, JSON.stringify(submitted).slice(0, 400));
    const active = readActiveStep(ws.store);
    assert.ok(active !== undefined);
    assert.equal(active.status, "closed");
    assert.deepEqual(active.domains, []);
  } finally {
    dispose(ws);
  }
});

/** The reader is total: absent, malformed, half-written and closed all yield no domain, never a throw. */
test("the reader tolerates an absent, malformed or unknown snapshot", () => {
  const ws = workspace();
  try {
    assert.equal(readActiveStep(ws.store), undefined, "absent");
    mkdirSync(ws.store, { recursive: true });
    writeFileSync(activePath(ws.store), "{ not json");
    assert.equal(readActiveStep(ws.store), undefined, "malformed");
    writeFileSync(activePath(ws.store), JSON.stringify({ v: 2, instance: "i", flow: "f", step: "s", task: "t", status: "running", domains: [], at: "now" }));
    assert.equal(readActiveStep(ws.store), undefined, "an unknown version is refused, not guessed");
    writeFileSync(activePath(ws.store), JSON.stringify({ v: 1, instance: "i", flow: "f", step: "s", task: "t", status: "closed", domains: [], at: "now" }));
    assert.equal(readActiveStep(ws.store)?.status, "closed");
  } finally {
    dispose(ws);
  }
});

/** A snapshot that cannot be written must never fail a step: the writer only reports. */
test("a write failure is reported, not thrown", () => {
  const blocked = join(workspace().store, "file-not-a-dir");
  assert.equal(
    writeActiveStep(blocked, { v: 1, instance: "i", flow: "f", step: "s", task: "t", status: "closed", domains: [], at: "now" }),
    true,
    "a fresh directory is created and written",
  );
  writeFileSync(join(blocked, "..", "plain-file"), "x");
  const instance = { id: "i", status: "completed", currentStep: "s" } as any;
  const flow = { config: { flow: "flows/x", nodes: [] }, profiles: new Map() } as any;
  assert.equal(snapshotActive(instance, flow, join(blocked, "..", "plain-file")), false);
});
