/**
 * Domain injection, pin side (criterion 5): the domain a step ran under is the one PINNED at start. Editing the
 * library profile afterwards changes the library - not the instance. The replay goes through the real seam:
 * loadInstance + loadPinnedFlow read the instance's own `profile` rows and verify their digests.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { executePraxisTool, setAlignJudgeForTest, setScorerForTest } from "../../src/pi/tool.ts";
import type { PiToolResult } from "../../src/pi/host.ts";
import { loadPinnedFlow } from "../../src/runner/engine/flow.ts";
import { readActiveStep } from "../../src/runner/engine/active.ts";
import { loadProfile, resolveDomains } from "../../src/runner/engine/profile.ts";
import { openStore } from "../../src/store/db.ts";
import { loadInstance } from "../../src/store/instance.ts";
import { dispose, workspace, writeFlow, type Workspace } from "../testkit.ts";
import { fakeAlignJudge, fakeContext } from "../pi/fixtures.ts";

const SESSION = "session-domain-pin";
const SCHEMA = "praxis.artifact.make/v1";

const PINNED = {
  id: "code",
  version: 1,
  layer: "domain",
  name: "Code",
  description: "source code",
  overview: "THE PINNED OVERVIEW.",
  invariants: ["THE PINNED INVARIANT."],
  prefer: [],
  avoid: [],
};

const EDITED = { ...PINNED, version: 9, overview: "THE EDITED OVERVIEW.", invariants: ["THE EDITED INVARIANT."] };

const dirOf = (ws: Workspace): string => join(ws.root, ".pi", "praxis", "profile");

function writeProfile(ws: Workspace, doc: unknown): void {
  const dir = join(dirOf(ws), "domain");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "code.json"), JSON.stringify(doc, null, 2) + "\n");
}

const call = (ws: Workspace, args: unknown): Promise<PiToolResult> =>
  executePraxisTool(args, fakeContext({ cwd: ws.root, sessionId: SESSION }));
const bag = (result: PiToolResult): any => result.details;

async function withEnv<T>(ws: Workspace, body: () => Promise<T>): Promise<T> {
  const prior = [process.env.PRAXIS_CONFIG, process.env.PRAXIS_STORE_DIR, process.env.PRAXIS_PROFILE_DIR];
  process.env.PRAXIS_CONFIG = ws.config;
  process.env.PRAXIS_STORE_DIR = ws.store;
  process.env.PRAXIS_PROFILE_DIR = dirOf(ws);
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

const task = { id: "make", capabilities: ["artifact.write", "artifact.read", "emit", "evaluate"], schema: SCHEMA, goal: "make the artifact" };

async function start(ws: Workspace): Promise<any> {
  const started = bag(await withEnv(ws, () => call(ws, { op: "start", flow: "flows/learn", order: "make the artifact", requestId: "pin" })));
  assert.equal(started.code, undefined, JSON.stringify(started).slice(0, 400));
  return started;
}

/** Re-open the instance through the PINNED seam: what the flow says now, in its own bytes. */
function replayed(ws: Workspace, instance: string): string {
  const store = openStore(join(ws.store, "praxis.sqlite"));
  const flow = loadPinnedFlow(store, loadInstance(store, instance));
  const node = flow.config.nodes.find((candidate) => candidate.id === "make");
  assert.ok(node !== undefined, "the pinned flow must keep its node, domains and all");
  const resolved = resolveDomains(node, flow.config, (ref) => {
    const pinned = flow.profiles.get(ref);
    assert.ok(pinned !== undefined, "the pin must resolve " + ref);
    return pinned;
  });
  assert.equal(resolved.length, 1);
  return resolved[0].doc.overview;
}

/** Criterion 5: a library edit after start does not change the pinned step. */
test("a domain profile edited after start does not change the pinned step", async () => {
  const ws = workspace();
  try {
    writeProfile(ws, PINNED);
    writeFlow(ws, "learn", [task], undefined, undefined, { make: ["code"] });
    const started = await start(ws);
    const instance = started.result.instanceId as string;
    // The domain reaches the agent through the composed prompt now, so the snapshot is where it is read.
    const active = readActiveStep(ws.store);
    assert.ok(active !== undefined, "the snapshot must exist after start");
    assert.equal(active.domains[0].overview, "THE PINNED OVERVIEW.");
    const pinnedDigest = active.domains[0].digest;

    writeProfile(ws, EDITED);

    // The library really moved.
    assert.equal(loadProfile(dirOf(ws), "code").doc.overview, "THE EDITED OVERVIEW.");
    // The instance did not: the pinned bytes and their digest are what re-opening yields.
    assert.equal(replayed(ws, instance), "THE PINNED OVERVIEW.");
    const store = openStore(join(ws.store, "praxis.sqlite"));
    const flow = loadPinnedFlow(store, loadInstance(store, instance));
    assert.equal(flow.profiles.get("code")!.digest, pinnedDigest, "the pinned digest is the one the brief carried");
    assert.equal(flow.profiles.get("code")!.doc.version, 1, "the pinned version, not the edited 9");
  } finally {
    dispose(ws);
  }
});

/** The flow-level default is pinned the same way: the pin is keyed on the id, not on where it was declared. */
test("a flow-level default domain is pinned and replayed too", async () => {
  const ws = workspace();
  try {
    writeProfile(ws, PINNED);
    writeFlow(ws, "learn", [task], undefined, undefined, undefined, ["code"]);
    const started = await start(ws);
    assert.deepEqual(readActiveStep(ws.store)?.domains.map((domain) => domain.id), ["code"]);
    writeProfile(ws, EDITED);
    assert.equal(replayed(ws, started.result.instanceId as string), "THE PINNED OVERVIEW.");
  } finally {
    dispose(ws);
  }
});
