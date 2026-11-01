/**
 * Domain injection, brief side: a flow NODE that declares `domains` injects a composed, pinned block into the
 * step brief beside the agent's fixed conduct and role. A node that declares none emits NO key at all, so its
 * envelope is byte-identical to the one it produced before this unit.
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { executePraxisTool, setAlignJudgeForTest, setScorerForTest } from "../../src/pi/tool.ts";
import type { PiToolResult } from "../../src/pi/host.ts";
import { digest } from "../../src/runner/canonical.ts";
import { composeDomains } from "../../src/runner/engine/profile.ts";
import { dispose, workspace, writeFlow, type Workspace } from "../testkit.ts";
import { fakeAlignJudge, fakeContext } from "./fixtures.ts";

const SESSION = "session-brief-domain";
const SCHEMA = "praxis.artifact.make/v1";

const CODE = {
  id: "code",
  version: 2,
  layer: "domain",
  name: "Code",
  description: "source code, configuration and tests",
  overview: "What the subject demands when the artifact is code.",
  invariants: ["Read the code before changing it.", "Reproduce a failure before repairing it."],
  prefer: ["Keep the diff legible."],
  avoid: ["Do not suppress a symptom as a fix."],
};

const QUANT = {
  id: "quant",
  version: 1,
  layer: "domain",
  name: "Quant",
  description: "numbers, statistics and measurement",
  overview: "What the subject demands when the artifact is a measurement.",
  invariants: ["Read the code before changing it.", "State the denominator."],
  prefer: ["Name the sample size."],
  avoid: ["Do not report a mean without its spread."],
};

function writeProfile(ws: Workspace, doc: unknown, as = (doc as { id: string }).id): void {
  const dir = join(ws.root, ".pi", "praxis", "profile", "domain");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, as + ".json"), JSON.stringify(doc, null, 2) + "\n");
}

function project(ws: Workspace, opts: { node?: string[]; flow?: string[] }): void {
  writeFlow(ws, "learn", [
    {
      id: "make",
      capabilities: ["artifact.write", "emit", "evaluate"],
      schema: SCHEMA,
      goal: "make the artifact",
    },
  ], undefined, undefined, opts.node === undefined ? undefined : { make: opts.node }, opts.flow);
}

const call = (ws: Workspace, args: unknown): Promise<PiToolResult> =>
  executePraxisTool(args, fakeContext({ cwd: ws.root, sessionId: SESSION }));
const bag = (result: PiToolResult): any => result.details;

async function start(ws: Workspace): Promise<any> {
  const prior = [process.env.PRAXIS_CONFIG, process.env.PRAXIS_STORE_DIR, process.env.PRAXIS_PROFILE_DIR];
  process.env.PRAXIS_CONFIG = ws.config;
  process.env.PRAXIS_STORE_DIR = ws.store;
  process.env.PRAXIS_PROFILE_DIR = join(ws.root, ".pi", "praxis", "profile");
  try {
    setAlignJudgeForTest(fakeAlignJudge("aligned"));
    return bag(await call(ws, { op: "start", flow: "flows/learn", order: "make the artifact", requestId: "domain" }));
  } finally {
    setAlignJudgeForTest(undefined);
    setScorerForTest(undefined);
    for (const [index, key] of ["PRAXIS_CONFIG", "PRAXIS_STORE_DIR", "PRAXIS_PROFILE_DIR"].entries()) {
      if (prior[index] === undefined) delete process.env[key];
      else process.env[key] = prior[index];
    }
  }
}

/** A start that MUST succeed. */
async function startOk(ws: Workspace): Promise<any> {
  const started = await start(ws);
  assert.equal(started.code, undefined, JSON.stringify(started).slice(0, 400));
  return started;
}

const profilePath = (ws: Workspace, id: string): string => join(ws.root, ".pi", "praxis", "profile", "domain", id + ".json");

/** Criterion 1 + 3: a node's domains are injected, composed in node order, with their pinned digests. */
test("a node's domains are injected into the brief, composed in node order", async () => {
  const ws = workspace();
  try {
    writeProfile(ws, CODE);
    writeProfile(ws, QUANT);
    project(ws, { node: ["code", "quant"] });
    const started = await startOk(ws);
    const domain = started.step.brief.domain;
    assert.ok(Array.isArray(domain), "brief.domain must be present when a node declares domains");
    assert.deepEqual(domain.map((entry: any) => entry.id), ["code", "quant"]);
    assert.equal(domain[0].version, 2);
    assert.equal(domain[0].overview, CODE.overview);
    assert.deepEqual(domain[0].invariants, CODE.invariants);
    assert.deepEqual(domain[1].avoid, QUANT.avoid);
    // The digest names the bytes the brief came from.
    assert.equal(domain[0].digest, digest(readFileSync(profilePath(ws, "code"))));
    // The union the agent actually reads: shared invariants appear once.
    const composed = composeDomains([
      { path: "code", doc: CODE as any, bytes: new Uint8Array(), digest: "x" },
      { path: "quant", doc: QUANT as any, bytes: new Uint8Array(), digest: "y" },
    ]);
    assert.equal(composed.invariants.filter((entry) => entry === "Read the code before changing it.").length, 1);
    assert.equal(composed.invariants.length, 3, "the union, not the concatenation");
  } finally {
    dispose(ws);
  }
});

/** Criterion 6, the unchanged case: no domains anywhere, no key, no file read. */
test("a flow with no domains emits no domain key at all", async () => {
  const ws = workspace();
  try {
    project(ws, {});
    const started = await startOk(ws);
    assert.equal("domain" in started.step.brief, false, "a domain-free brief must not gain a key");
    assert.equal(started.code, undefined);
  } finally {
    dispose(ws);
  }
});

/** Criterion 2: a node's own domains win over the flow-level default. */
test("a node's domains override the flow default", async () => {
  const ws = workspace();
  try {
    writeProfile(ws, CODE);
    writeProfile(ws, QUANT);
    project(ws, { node: ["quant"], flow: ["code"] });
    const started = await startOk(ws);
    assert.deepEqual(started.step.brief.domain.map((entry: any) => entry.id), ["quant"]);
  } finally {
    dispose(ws);
  }
});

/** The flow default applies when the node says nothing. */
test("the flow default applies to a node that declares none", async () => {
  const ws = workspace();
  try {
    writeProfile(ws, CODE);
    project(ws, { flow: ["code"] });
    const started = await startOk(ws);
    assert.deepEqual(started.step.brief.domain.map((entry: any) => entry.id), ["code"]);
  } finally {
    dispose(ws);
  }
});

/** Criterion 4a: an unknown domain fails closed, typed, before anything is written. */
test("an unknown domain reference refuses the start with PROFILE_NOT_FOUND", async () => {
  const ws = workspace();
  try {
    project(ws, { node: ["ghost"] });
    const payload = await start(ws);
    assert.equal(payload.code, "PROFILE_NOT_FOUND", JSON.stringify(payload).slice(0, 300));
    assert.match(String(payload.message), /ghost/);
  } finally {
    dispose(ws);
  }
});

/** Criterion 4b: an invalid profile (unknown key, wrong layer, id != filename) is PROFILE_INVALID. */
for (const [label, doc, as] of [
  ["an unknown key", { ...CODE, tools: ["bash"] }, "code"],
  ["another layer", { ...CODE, layer: "role" }, "code"],
  ["a mismatched id", { ...CODE, id: "other" }, "code"],
  ["no content", { ...CODE, invariants: [], prefer: [], avoid: [] }, "code"],
] as const) {
  test("a domain profile with " + label + " is PROFILE_INVALID", async () => {
    const ws = workspace();
    try {
      writeProfile(ws, doc as any, as);
      project(ws, { node: ["code"] });
      const payload = await start(ws);
      assert.equal(payload.code, "PROFILE_INVALID", JSON.stringify(payload).slice(0, 300));
    } finally {
      dispose(ws);
    }
  });
}
