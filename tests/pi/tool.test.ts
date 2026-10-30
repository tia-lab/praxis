/**
 * `praxis` tool behaviour: the 34 named cases mapped to steps 2-4 in plan.md.
 *
 * Uses `tests/pi/fixtures.ts` (claim D) for the flow config, the gate-shaped
 * payloads, the fake host context, the temp project/store and the pending-version
 * seed. Only the assertions and the store probes are local: the earlier duplicated
 * helpers (local config copy, context factory, payload builders, pending seed) were
 * removed once claim D landed. No case is skipped or weakened.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { actorFor, engineOptions, executePraxisTool } from "../../src/pi/tool.ts";
import type { PiToolResult } from "../../src/pi/host.ts";
import { PraxisToolArgsSchema } from "../../src/types/pi.ts";
import { canonicalBytes } from "../../src/runner/canonical.ts";
import { artifacts, config, fakeContext, pendingArtifact, tempStore } from "./fixtures.ts";

const SIX_KEYS = ["artifacts", "flow", "instanceId", "nextAction", "status", "summary"];
const UNKNOWN_INSTANCE = "i0123456789abcdef0123456789abcdef";
const SESSION = "session-alpha";
const OTHER_SESSION = "session-beta";

/** A fresh temp project from the fixture; the test only needs its root. */
const project = (): string => tempStore().cwd;

async function call(cwd: string, args: unknown, sessionId: string = SESSION): Promise<PiToolResult> {
  return executePraxisTool(args, fakeContext({ cwd, sessionId }));
}

const start = (cwd: string, requestId = "req-1", sessionId: string = SESSION): Promise<PiToolResult> =>
  call(cwd, { op: "start", flow: "flows/architect", requestId }, sessionId);

/** The envelope of a tool result; success and failure details are both validated there. */
const bag = (result: PiToolResult): any => result.details;

function rows<T>(cwd: string, sql: string, ...params: (string | number)[]): T[] {
  const db = new DatabaseSync(join(cwd, ".pi/praxis/state/praxis.sqlite"));
  try {
    return db.prepare(sql).all(...params) as unknown as T[];
  } finally {
    db.close();
  }
}

const count = (cwd: string, table: "event" | "artifact", instance: string): number =>
  rows<{ n: number }>(cwd, `select count(*) as n from ${table} where instance = ?`, instance)[0].n;

/** `start`, then `submit` the draft artifact: the state every read test needs. */
async function throughDraft(cwd: string) {
  const started = bag(await start(cwd));
  const nonce = started.nonce as string;
  const instance = started.result.instanceId as string;
  const advanced = bag(await call(cwd, { op: "submit", instance, artifact: artifacts.validA(nonce) }));
  return { nonce, instance, digestA: advanced.result.artifacts[0].digest as string, step: advanced.step };
}

// --------------------------------------------------------------------------- step 2

test("schema rejects missing start flow", async () => {
  assert.equal(PraxisToolArgsSchema.safeParse({ op: "start", requestId: "req" }).success, false);
  const result = await call(project(), { op: "start", requestId: "req" });
  assert.equal(result.isError, true);
  assert.equal(bag(result).code, "CONFIG_INVALID");
});

test("schema rejects missing submit instance", async () => {
  assert.equal(PraxisToolArgsSchema.safeParse({ op: "submit", artifact: artifacts.missingNonceA() }).success, false);
  const result = await call(project(), { op: "submit", artifact: artifacts.missingNonceA() });
  assert.equal(bag(result).code, "CONFIG_INVALID");
});

test("schema rejects missing read instance", async () => {
  assert.equal(PraxisToolArgsSchema.safeParse({ op: "read", step: "draft" }).success, false);
  const result = await call(project(), { op: "read", step: "draft" });
  assert.equal(bag(result).code, "CONFIG_INVALID");
});

test("schema rejects missing read step", async () => {
  assert.equal(PraxisToolArgsSchema.safeParse({ op: "read", instance: UNKNOWN_INSTANCE }).success, false);
  const result = await call(project(), { op: "read", instance: UNKNOWN_INSTANCE });
  assert.equal(bag(result).code, "CONFIG_INVALID");
});

test("schema rejects unknown key", async () => {
  const args = { op: "read", instance: UNKNOWN_INSTANCE, step: "draft", actor: "cli" };
  const parsed = PraxisToolArgsSchema.safeParse(args);
  assert.equal(parsed.success, false);
  assert.match(String(parsed.error?.issues[0]?.message), /Unrecognized key/);
  assert.equal(bag(await call(project(), args)).code, "CONFIG_INVALID");
});

test("actor label is stable per session", async () => {
  const cwd = project();
  const first = actorFor(fakeContext({ cwd, sessionId: SESSION }));
  assert.equal(first, actorFor(fakeContext({ cwd, sessionId: SESSION })));
  assert.notEqual(first, actorFor(fakeContext({ cwd, sessionId: OTHER_SESSION })));
  assert.match(first, /^pi-session:[0-9a-f]{32}$/);
});

test("missing session id is a typed failure", async () => {
  const cwd = project();
  const result = await executePraxisTool({ op: "start", flow: "flows/architect", requestId: "req-1" }, fakeContext({ cwd, sessionId: null }));
  assert.equal(result.isError, true);
  assert.equal(bag(result).code, "CONFIG_INVALID");
  assert.deepEqual(bag(result).detail, { source: "sessionManager.getSessionId" });
  assert.equal(existsSync(join(cwd, ".pi/praxis/state", "praxis.sqlite")), false);
});

test("descriptor draft lists submit", async () => {
  assert.deepEqual(bag(await start(project())).step, {
    id: "draft",
    capabilities: ["artifact.write", "emit"],
    ops: ["submit", "check"],
    steps: ["draft", "derive"],
    brief: { goal: "write the architecture draft", produces: "praxis.artifact.architecture/v1" },
  });
});

test("descriptor derive lists submit and read", async () => {
  const { step, digestA } = await throughDraft(project());
  assert.deepEqual(step, {
    id: "derive",
    capabilities: ["artifact.read", "artifact.write", "emit"],
    ops: ["submit", "check", "read"],
    steps: ["draft", "derive"],
    brief: {
      goal: "derive the next artifact from the draft",
      produces: "praxis.artifact.derive/v1",
      consumes: [{ step: "draft", schema: "praxis.artifact.architecture/v1", digest: digestA }],
      derivedFrom: digestA,
    },
  });
});

test("descriptor completed lists read", async () => {
  const cwd = project();
  const { nonce, instance, digestA } = await throughDraft(cwd);
  await call(cwd, { op: "submit", instance, artifact: artifacts.validB(nonce, digestA) });
  assert.deepEqual(bag(await start(cwd)).step, {
    id: "derive",
    capabilities: ["artifact.read", "artifact.write", "emit"],
    ops: ["read"],
    steps: ["draft", "derive"],
    brief: {
      goal: "derive the next artifact from the draft",
      produces: "praxis.artifact.derive/v1",
      consumes: [{ step: "draft", schema: "praxis.artifact.architecture/v1", digest: digestA }],
      derivedFrom: digestA,
    },
  });
});

// --------------------------------------------------------------------------- step 3

test("start returns six keys and nonce", async () => {
  const cwd = project();
  const details = bag(await start(cwd));
  assert.deepEqual(Object.keys(details.result).sort(), SIX_KEYS);
  assert.match(details.nonce, /^[A-Za-z0-9_-]{8,64}$/);
  const [stored] = rows<{ nonce: string }>(cwd, "select nonce from instance where id = ?", details.result.instanceId);
  assert.equal(stored.nonce, details.nonce);
});

test("repeat start returns the same instance and nonce", async () => {
  const cwd = project();
  const first = bag(await start(cwd));
  const second = bag(await start(cwd));
  assert.equal(second.result.instanceId, first.result.instanceId);
  assert.equal(second.nonce, first.nonce);
  assert.equal(rows(cwd, "select id from instance").length, 1);
});

test("request conflict for a different session", async () => {
  const cwd = project();
  const first = bag(await start(cwd, "req-1", SESSION));
  const second = await start(cwd, "req-1", OTHER_SESSION);
  assert.equal(second.isError, true);
  assert.equal(bag(second).code, "REQUEST_CONFLICT");
  const ids = rows<{ id: string }>(cwd, "select id from instance");
  assert.equal(ids.length, 1);
  assert.equal(ids[0].id, first.result.instanceId);
});

test("changed config payload is REQUEST_CONFLICT", async () => {
  const store = tempStore();
  bag(await start(store.cwd));
  writeFileSync(store.configPath, JSON.stringify({ ...config, result: "praxis.result.v2/v1" }));
  const again = await start(store.cwd);
  assert.equal(bag(again).code, "REQUEST_CONFLICT");
  assert.equal(rows(store.cwd, "select id from instance").length, 1);
});

test("submit A advances to derive", async () => {
  const { step } = await throughDraft(project());
  assert.equal(step.id, "derive");
  assert.deepEqual(step.ops, ["submit", "check", "read"]);
});

test("submit B completes", async () => {
  const cwd = project();
  const { nonce, instance, digestA } = await throughDraft(cwd);
  const done = bag(await call(cwd, { op: "submit", instance, artifact: artifacts.validB(nonce, digestA) }));
  assert.equal(done.result.status, "completed");
  assert.deepEqual(done.result.artifacts.map((a: any) => a.step), ["draft", "derive"]);
  const [row] = rows<{ derived_from: string }>(cwd, "select derived_from from artifact where instance = ? and step = 'derive'", instance);
  assert.equal(row.derived_from, digestA);
});

test("completed submit returns the completed result", async () => {
  const cwd = project();
  const { nonce, instance, digestA } = await throughDraft(cwd);
  await call(cwd, { op: "submit", instance, artifact: artifacts.validB(nonce, digestA) });
  const events = count(cwd, "event", instance);
  const again = bag(await call(cwd, { op: "submit", instance, artifact: artifacts.validB(nonce, digestA) }));
  assert.equal(again.result.status, "completed");
  assert.equal(count(cwd, "artifact", instance), 2);
  assert.equal(count(cwd, "event", instance), events);
});

test("a refused step stays running and the corrected retry is accepted as v2", async () => {
  const cwd = project();
  const started = bag(await start(cwd));
  const instance = started.result.instanceId as string;
  const rejected = await call(cwd, { op: "submit", instance, artifact: artifacts.missingNonceA() });
  assert.equal(bag(rejected).code, "ARTIFACT_INVALID");
  const [refused] = rows<{ status: string; current_step: string; revision: number }>(
    cwd,
    "select status, current_step, revision from instance where id = ?",
    instance,
  );
  assert.equal(refused.status, "running");
  assert.equal(refused.current_step, "draft");
  const retry = await call(cwd, { op: "submit", instance, artifact: artifacts.validA(started.nonce) });
  assert.equal(retry.isError, undefined);
  assert.equal(bag(retry).result.status, "running");
  assert.equal(bag(retry).step.id, "derive");
  const versions = rows<{ version: number; state: string }>(
    cwd,
    "select version, state from artifact where instance = ? and step = 'draft' order by version",
    instance,
  ).map((row) => [row.version, row.state]);
  assert.deepEqual(versions, [[1, "pending"], [2, "accepted"]]);
});

test("a refused instance reopens as a running six-key result", async () => {
  const cwd = project();
  const started = bag(await start(cwd));
  const instance = started.result.instanceId as string;
  await call(cwd, { op: "submit", instance, artifact: artifacts.missingNonceA() });
  const reopened = await start(cwd);
  assert.equal(reopened.isError, undefined);
  assert.equal(bag(reopened).result.status, "running");
  assert.deepEqual(Object.keys(bag(reopened).result).sort(), SIX_KEYS);
  assert.equal(bag(reopened).nonce, started.nonce);
  assert.equal(rows(cwd, "select id from instance").length, 1);
});

test("result has exactly six keys", async () => {
  const details = bag(await start(project()));
  assert.equal(Object.keys(details.result).length, 6);
  assert.deepEqual(Object.keys(details.result).sort(), SIX_KEYS);
});

test("content parses to details", async () => {
  const cwd = project();
  const success = await start(cwd);
  assert.deepEqual(JSON.parse(success.content[0].text), bag(success));
  const failure = await call(cwd, { op: "read", instance: UNKNOWN_INSTANCE, step: "draft" });
  assert.deepEqual(JSON.parse(failure.content[0].text), bag(failure));
});

test("typed failure envelope", async () => {
  const result = await call(project(), { op: "read", instance: UNKNOWN_INSTANCE, step: "draft" });
  assert.equal(result.isError, true);
  const details = bag(result);
  assert.equal(details.code, "INSTANCE_NOT_FOUND");
  assert.equal(typeof details.message, "string");
  assert.deepEqual(Object.keys(details).filter((key) => !["code", "message", "detail"].includes(key)), []);
  assert.deepEqual(JSON.parse(result.content[0].text), details);
});

test("submit without instance is INSTANCE_NOT_FOUND", async () => {
  const result = await call(project(), { op: "submit", instance: UNKNOWN_INSTANCE, artifact: artifacts.missingNonceA() });
  assert.equal(result.isError, true);
  assert.equal(bag(result).code, "INSTANCE_NOT_FOUND");
});

// --------------------------------------------------------------------------- step 4

test("read in draft is CAPABILITY_DENIED", async () => {
  const cwd = project();
  const instance = bag(await start(cwd)).result.instanceId as string;
  const denied = await call(cwd, { op: "read", instance, step: "draft" });
  assert.equal(denied.isError, true);
  assert.equal(bag(denied).code, "CAPABILITY_DENIED");
  assert.equal(bag(denied).detail.step, "draft");
});

test("read A in derive returns A", async () => {
  const cwd = project();
  const { nonce, instance, digestA } = await throughDraft(cwd);
  const read = bag(await call(cwd, { op: "read", instance, step: "draft" }));
  assert.equal(read.artifact.step, "draft");
  assert.equal(read.artifact.version, 1);
  assert.equal(read.artifact.state, "accepted");
  assert.equal(read.artifact.digest, digestA);
  assert.equal(read.artifact.path, undefined);
  assert.deepEqual(read.value, artifacts.validA(nonce));
});

test("corrupt A is ARTIFACT_DIGEST_MISMATCH", async () => {
  const cwd = project();
  const { nonce, instance } = await throughDraft(cwd);
  const path = join(cwd, ".pi/praxis/state/artifacts", instance, "draft", "v1.json");
  writeFileSync(path, canonicalBytes({ ...artifacts.validA(nonce), claim: "tampered" }));
  const read = await call(cwd, { op: "read", instance, step: "draft" });
  assert.equal(read.isError, true);
  assert.equal(bag(read).code, "ARTIFACT_DIGEST_MISMATCH");
});

test("gate rejection exposes details.detail.checks", async () => {
  const cwd = project();
  const { nonce, instance } = await throughDraft(cwd);
  const rejected = await call(cwd, { op: "submit", instance, artifact: artifacts.wrongDerivedFromB(nonce) });
  assert.equal(rejected.isError, true);
  const details = bag(rejected);
  assert.equal(details.code, "ARTIFACT_INVALID");
  assert.equal(details.detail.checks.schemaMatches, true);
  assert.equal(details.detail.checks.noncePresent, true);
  assert.equal(details.detail.checks.derivedFromMatches, false);
  assert.equal(details.detail.version, 1);
  const [row] = rows<{ status: string; current_step: string }>(cwd, "select status, current_step from instance where id = ?", instance);
  assert.equal(row.status, "running");
  assert.equal(row.current_step, "derive");
});

test("pending version conflict", async () => {
  const store = tempStore();
  const seed = pendingArtifact(store, { requestId: "pi-pending-1", sessionId: SESSION });
  const reopened = bag(await start(store.cwd, "pi-pending-1", SESSION));
  assert.equal(reopened.nonce, seed.nonce);
  const conflict = await call(store.cwd, { op: "submit", instance: seed.instance, artifact: artifacts.validA("a-different-nonce-01") });
  assert.equal(conflict.isError, true);
  assert.equal(bag(conflict).code, "ARTIFACT_VERSION_CONFLICT");
  assert.equal(count(store.cwd, "artifact", seed.instance), 1);
  const [row] = rows<{ state: string; version: number }>(store.cwd, "select state, version from artifact where instance = ? and step = 'draft'", seed.instance);
  assert.equal(row.state, "pending");
  assert.equal(row.version, 1);
});

test("submit reuses a pending version", async () => {
  const store = tempStore();
  const seed = pendingArtifact(store, { requestId: "pi-pending-2", sessionId: SESSION });
  bag(await start(store.cwd, "pi-pending-2", SESSION));
  const accepted = await call(store.cwd, { op: "submit", instance: seed.instance, artifact: artifacts.validA(seed.nonce) });
  assert.equal(accepted.isError, undefined);
  assert.deepEqual(bag(accepted).result.artifacts.map((a: any) => a.version), [1]);
  assert.equal(count(store.cwd, "artifact", seed.instance), 1);
  const [row] = rows<{ state: string; version: number }>(store.cwd, "select state, version from artifact where instance = ? and step = 'draft'", seed.instance);
  assert.equal(row.state, "accepted");
  assert.equal(row.version, 1);
});

test("read without instance is INSTANCE_NOT_FOUND", async () => {
  const result = await call(project(), { op: "read", instance: UNKNOWN_INSTANCE, step: "draft" });
  assert.equal(result.isError, true);
  assert.equal(bag(result).code, "INSTANCE_NOT_FOUND");
});

test("unexpected error becomes INTERNAL", async () => {
  const cwd = project();
  rmSync(join(cwd, ".pi/praxis/state"), { recursive: true, force: true });
  writeFileSync(join(cwd, ".pi/praxis/state"), "not a directory");
  const result = await call(cwd, { op: "submit", instance: UNKNOWN_INSTANCE, artifact: artifacts.missingNonceA() });
  assert.equal(result.isError, true);
  assert.equal(bag(result).code, "INTERNAL");
});

test("denied read leaves counts unchanged", async () => {
  const cwd = project();
  const instance = bag(await start(cwd)).result.instanceId as string;
  const events = count(cwd, "event", instance);
  const artifactRows = count(cwd, "artifact", instance);
  const denied = await call(cwd, { op: "read", instance, step: "draft" });
  assert.equal(bag(denied).code, "CAPABILITY_DENIED");
  assert.equal(count(cwd, "event", instance), events);
  assert.equal(count(cwd, "artifact", instance), artifactRows);
});

test("engine options use ctx.cwd", async () => {
  const store = tempStore();
  const options = engineOptions(fakeContext({ cwd: store.cwd }));
  assert.equal(options.configPath, store.configPath);
  assert.equal(options.storeDir, store.storeDir);
  const projectState = join(process.cwd(), ".pi/praxis/state");
  const before = existsSync(projectState);
  const details = bag(await start(store.cwd));
  assert.equal(rows(store.cwd, "select id from instance where id = ?", details.result.instanceId).length, 1);
  assert.equal(existsSync(projectState), before);
});

test("submit and read are actor bound (unit F)", async () => {
  const cwd = project();
  const { nonce, instance, digestA } = await throughDraft(cwd);
  const read = await call(cwd, { op: "read", instance, step: "draft" }, OTHER_SESSION);
  assert.equal(read.isError, true);
  assert.equal(bag(read).code, "INSTANCE_FORBIDDEN");
  const submitted = await call(cwd, { op: "submit", instance, artifact: artifacts.validB(nonce, digestA) }, OTHER_SESSION);
  assert.equal(submitted.isError, true);
  assert.equal(bag(submitted).code, "INSTANCE_FORBIDDEN");
});
