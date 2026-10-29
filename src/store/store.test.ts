/**
 * P2: the store is real - four tables, WAL with synchronous=FULL, an event table that
 * refuses UPDATE and DELETE, a compare-and-set instance row, digest-verified artifacts,
 * and the committed flow config parsing against its schema.
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, type Store } from "./db.ts";
import { createInstance, loadInstance, setStatus } from "./instance.ts";
import { appendEvent, listEvents } from "./events.ts";
import { acceptArtifact, readArtifact, recordArtifact } from "./artifacts.ts";
import { canonicalBytes, digest } from "../runner/canonical.ts";
import { ResultSchema, parseFlowConfig, parseWith } from "../types/schema.ts";
import { isAppError } from "../types/errors.ts";

const NOW = "2026-10-29T11:00:00.000Z";
const LATER = "2026-10-29T11:00:01.000Z";
const NONCE = "0123456789abcdef0123456789abcdef";
const CONFIG_DIGEST = digest(canonicalBytes({ flow: "architect" }));
const STEP_SCHEMA = "praxis.artifact.architecture/v1";

interface Fixture {
  store: Store;
  dir: string;
}

function fixture(t: TestContext): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "praxis-store-"));
  const store = openStore(join(dir, "praxis.sqlite"));
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, dir };
}

function seed(store: Store, id = "instance-0001") {
  return createInstance(store, {
    id,
    flow: "architect",
    actor: "engineer-1",
    configDigest: CONFIG_DIGEST,
    status: "running",
    currentStep: "draft",
    nonce: NONCE,
    now: NOW,
  });
}

function expectCode(code: string, body: () => unknown): void {
  assert.throws(body, (error: unknown) => isAppError(error) && error.code === code);
}

function count(store: Store, table: "instance" | "event" | "artifact"): number {
  const row = store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as unknown as { n: number };
  return Number(row.n);
}

test("the store creates the four tables, WAL and synchronous=FULL", (t) => {
  const { store } = fixture(t);
  const tables = store.db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as unknown as { name: string }[];
  assert.deepEqual(
    tables.map((row) => row.name),
    ["artifact", "event", "instance", "meta"],
  );
  const mode = store.db.prepare("PRAGMA journal_mode").get() as unknown as { journal_mode: string };
  assert.equal(mode.journal_mode, "wal");
  const sync = store.db.prepare("PRAGMA synchronous").get() as unknown as { synchronous: number };
  assert.equal(Number(sync.synchronous), 2);
  const meta = store.db.prepare("SELECT value FROM meta WHERE key = 'schema'").get() as unknown as { value: string };
  assert.equal(meta.value, "praxis.store/v1");
});

test("the event table rejects UPDATE and DELETE", (t) => {
  const { store } = fixture(t);
  seed(store);
  const appended = appendEvent(store, "instance-0001", { type: "instance.created", payload: { a: 1 }, at: NOW });
  assert.equal(appended.seq, 1);
  assert.throws(() => store.db.prepare("UPDATE event SET type = 'tampered'").run(), /append-only/);
  assert.throws(() => store.db.prepare("DELETE FROM event").run(), /append-only/);
  assert.equal(listEvents(store, "instance-0001").length, 1);
});

test("createInstance pins the payload and refuses a duplicate id without writing", (t) => {
  const { store } = fixture(t);
  const created = seed(store);
  assert.equal(created.revision, 0);
  assert.equal(created.configDigest, CONFIG_DIGEST);
  assert.equal(created.currentStep, "draft");
  assert.equal(created.nonce, NONCE);
  expectCode("REQUEST_CONFLICT", () => seed(store));
  assert.equal(count(store, "instance"), 1);
});

test("loadInstance fails closed on an unknown id", (t) => {
  const { store } = fixture(t);
  expectCode("INSTANCE_NOT_FOUND", () => loadInstance(store, "instance-9999"));
});

test("setStatus compare-and-sets the revision and refuses illegal transitions", (t) => {
  const { store } = fixture(t);
  const created = seed(store);

  const blocked = setStatus(store, created.id, { status: "blocked", currentStep: "draft" }, 0);
  assert.equal(blocked.revision, 1);
  assert.equal(blocked.status, "blocked");

  expectCode("REVISION_CONFLICT", () =>
    setStatus(store, created.id, { status: "running", currentStep: "draft" }, 0),
  );

  const running = setStatus(store, created.id, { status: "running", currentStep: "draft" }, 1);
  assert.equal(running.revision, 2);

  const completed = setStatus(store, created.id, { status: "completed", currentStep: "draft" }, 2);
  assert.equal(completed.status, "completed");
  assert.equal(completed.revision, 3);

  expectCode("INSTANCE_STATE_INVALID", () =>
    setStatus(store, created.id, { status: "running", currentStep: "draft" }, 3),
  );
  assert.equal(loadInstance(store, created.id).revision, 3);
});

test("appendEvent sequences, canonicalises and refuses a non-canonical payload", (t) => {
  const { store } = fixture(t);
  seed(store);
  const created = appendEvent(store, "instance-0001", { type: "instance.created", payload: { b: 2, a: 1 }, at: NOW });
  const verdict = appendEvent(store, "instance-0001", { type: "gate.verdict", payload: { decision: "accept" }, at: NOW });
  assert.deepEqual([created.seq, verdict.seq], [1, 2]);
  assert.deepEqual(created.payload, { a: 1, b: 2 });

  const stored = store.db
    .prepare("SELECT payload FROM event WHERE instance = ? AND seq = 1")
    .get("instance-0001") as unknown as { payload: string };
  assert.equal(stored.payload, '{"a":1,"b":2}');

  assert.deepEqual(listEvents(store, "instance-0001", 1).map((event) => event.seq), [2]);

  expectCode("CANONICAL_INVALID", () =>
    appendEvent(store, "instance-0001", { type: "gate.verdict", payload: { bad: Number.NaN }, at: NOW }),
  );
  assert.equal(count(store, "event"), 2);
});

test("recordArtifact verifies the digest it records and never rewrites a version", (t) => {
  const { store, dir } = fixture(t);
  seed(store);
  const path = join(dir, "v1.json");
  const value = { schema: STEP_SCHEMA, nonce: NONCE };
  const bytes = canonicalBytes(value);
  const artifactDigest = digest(bytes);
  writeFileSync(path, bytes);

  const recorded = recordArtifact(store, {
    instance: "instance-0001",
    step: "draft",
    version: 1,
    path,
    digest: artifactDigest,
    schema: STEP_SCHEMA,
    state: "pending",
    derivedFrom: null,
    at: NOW,
  });
  assert.equal(recorded.state, "pending");
  assert.equal(recorded.digest, artifactDigest);

  expectCode("ARTIFACT_DIGEST_MISMATCH", () =>
    recordArtifact(store, {
      instance: "instance-0001",
      step: "derive",
      version: 1,
      path,
      digest: digest(canonicalBytes({ other: true })),
      schema: "praxis.artifact.derive/v1",
      at: NOW,
    }),
  );
  expectCode("ARTIFACT_UNAVAILABLE", () =>
    recordArtifact(store, {
      instance: "instance-0001",
      step: "derive",
      version: 1,
      path: join(dir, "missing.json"),
      digest: artifactDigest,
      schema: "praxis.artifact.derive/v1",
      at: NOW,
    }),
  );
  expectCode("ARTIFACT_VERSION_CONFLICT", () =>
    recordArtifact(store, {
      instance: "instance-0001",
      step: "draft",
      version: 1,
      path,
      digest: artifactDigest,
      schema: STEP_SCHEMA,
      at: NOW,
    }),
  );
  expectCode("ARTIFACT_STATE_INVALID", () =>
    recordArtifact(store, {
      instance: "instance-0001",
      step: "derive",
      version: 2,
      path,
      digest: artifactDigest,
      schema: "praxis.artifact.derive/v1",
      state: "accepted",
      at: NOW,
    }),
  );
  assert.equal(count(store, "artifact"), 1);
});

test("readArtifact verifies the bytes and refuses a corrupted file", (t) => {
  const { store, dir } = fixture(t);
  seed(store);
  const path = join(dir, "v1.json");
  const value = { schema: STEP_SCHEMA, nonce: NONCE };
  const bytes = canonicalBytes(value);
  writeFileSync(path, bytes);
  recordArtifact(store, {
    instance: "instance-0001",
    step: "draft",
    version: 1,
    path,
    digest: digest(bytes),
    schema: STEP_SCHEMA,
    at: NOW,
  });

  const read = readArtifact(store, "instance-0001", "draft", 1);
  assert.equal(digest(read.bytes), digest(bytes));
  assert.deepEqual(JSON.parse(Buffer.from(read.bytes).toString("utf8")), value);

  expectCode("ARTIFACT_UNAVAILABLE", () => readArtifact(store, "instance-0001", "derive"));

  writeFileSync(path, canonicalBytes({ tampered: true }));
  expectCode("ARTIFACT_DIGEST_MISMATCH", () => readArtifact(store, "instance-0001", "draft", 1));
});

test("acceptArtifact is a verified transition and replaying it writes nothing", (t) => {
  const { store, dir } = fixture(t);
  seed(store);
  const path = join(dir, "v1.json");
  const bytes = canonicalBytes({ schema: STEP_SCHEMA, nonce: NONCE });
  writeFileSync(path, bytes);
  recordArtifact(store, {
    instance: "instance-0001",
    step: "draft",
    version: 1,
    path,
    digest: digest(bytes),
    schema: STEP_SCHEMA,
    at: NOW,
  });

  const accepted = acceptArtifact(store, "instance-0001", "draft", 1, LATER);
  assert.equal(accepted.state, "accepted");
  assert.equal(accepted.at, LATER);

  const replay = acceptArtifact(store, "instance-0001", "draft", 1, NOW);
  assert.equal(replay.state, "accepted");
  assert.equal(replay.at, LATER);

  const corruptPath = join(dir, "v2.json");
  const corruptBytes = canonicalBytes({ schema: "praxis.artifact.derive/v1", nonce: NONCE });
  writeFileSync(corruptPath, corruptBytes);
  recordArtifact(store, {
    instance: "instance-0001",
    step: "derive",
    version: 1,
    path: corruptPath,
    digest: digest(corruptBytes),
    schema: "praxis.artifact.derive/v1",
    at: NOW,
  });
  writeFileSync(corruptPath, canonicalBytes({ tampered: true }));
  expectCode("ARTIFACT_DIGEST_MISMATCH", () => acceptArtifact(store, "instance-0001", "derive", 1, LATER));
  assert.equal(readArtifact(store, "instance-0001", "draft", 1).artifact.state, "accepted");
});

test("the committed flow config parses and a malformed one is refused", () => {
  const text = readFileSync(new URL("../../.pi/praxis/config.json", import.meta.url), "utf8");
  const raw = JSON.parse(text) as Record<string, unknown>;
  const config = parseFlowConfig(raw);
  assert.equal(config.flow, "architect");
  assert.deepEqual(config.steps.map((step) => step.id), ["draft", "derive"]);
  assert.equal(config.steps[1].consumes, "draft");

  expectCode("CONFIG_INVALID", () => parseFlowConfig({ ...raw, schema: "praxis.config/v2" }));
  expectCode("CONFIG_INVALID", () => parseFlowConfig({ ...raw, extra: true }));

  const badCapability = structuredClone(raw) as { steps: { capabilities: string[] }[] };
  badCapability.steps[0].capabilities = ["shell"];
  expectCode("CONFIG_INVALID", () => parseFlowConfig(badCapability));

  const badGate = structuredClone(raw) as { steps: { gate: string }[] };
  badGate.steps[0].gate = "model-review";
  expectCode("CONFIG_INVALID", () => parseFlowConfig(badGate));

  const badRef = structuredClone(raw) as { steps: { consumes?: string }[] };
  badRef.steps[1].consumes = "nowhere";
  expectCode("CONFIG_INVALID", () => parseFlowConfig(badRef));

  const thirdStep = structuredClone(raw) as { steps: unknown[] };
  thirdStep.steps.push(structuredClone(thirdStep.steps[0]));
  expectCode("CONFIG_INVALID", () => parseFlowConfig(thirdStep));
});

test("the result schema admits exactly the six whitelisted fields", () => {
  const base = {
    instanceId: "instance-0001",
    flow: "architect",
    status: "running",
    artifacts: [{ step: "draft", version: 1, digest: CONFIG_DIGEST, schema: STEP_SCHEMA }],
    summary: "running at draft: 1 artifact(s) accepted",
    nextAction: "resume",
  };
  const parsed = parseWith(ResultSchema, base, "RESULT_INVALID", "result");
  assert.deepEqual(Object.keys(parsed).sort(), [
    "artifacts",
    "flow",
    "instanceId",
    "nextAction",
    "status",
    "summary",
  ]);
  expectCode("RESULT_INVALID", () => parseWith(ResultSchema, { ...base, events: [] }, "RESULT_INVALID", "result"));
});
