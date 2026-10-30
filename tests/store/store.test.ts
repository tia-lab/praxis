/**
 * P2: the store is real - six tables, WAL with synchronous=FULL, an event table that
 * refuses UPDATE and DELETE, a compare-and-set instance row, digest-verified artifacts,
 * the v2 identity that refuses a v1 file, and the committed v2 flow document parsing
 * against its schema.
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openStore, type Store } from "../../src/store/db.ts";
import { createInstance, loadInstance, setStatus } from "../../src/store/instance.ts";
import { appendEvent, listEvents } from "../../src/store/events.ts";
import { acceptArtifact, readArtifact, recordArtifact } from "../../src/store/artifacts.ts";
import { canonicalBytes, digest } from "../../src/runner/canonical.ts";
import { InstanceStatusSchema, ResultSchema, parseFlowConfig, parseWith } from "../../src/types/schema.ts";
import { isAppError } from "../../src/types/errors.ts";

const NOW = "2026-10-29T11:00:00.000Z";
const LATER = "2026-10-29T11:00:01.000Z";
const NONCE = "0123456789abcdef0123456789abcdef";
const PIN_DIGEST = digest(canonicalBytes({ flow: "flows/architect" }));
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
    flow: "flows/architect",
    actor: "engineer-1",
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

test("the store creates the six tables, WAL and synchronous=FULL", (t) => {
  const { store } = fixture(t);
  const tables = store.db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as unknown as { name: string }[];
  assert.deepEqual(
    tables.map((row) => row.name),
    ["artifact", "definition", "event", "instance", "meta", "publication"],
  );
  const mode = store.db.prepare("PRAGMA journal_mode").get() as unknown as { journal_mode: string };
  assert.equal(mode.journal_mode, "wal");
  const sync = store.db.prepare("PRAGMA synchronous").get() as unknown as { synchronous: number };
  assert.equal(Number(sync.synchronous), 2);
  const meta = store.db.prepare("SELECT value FROM meta WHERE key = 'schema'").get() as unknown as { value: string };
  assert.equal(meta.value, "praxis.store/v2");
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

test("createInstance records the request and refuses a duplicate id without writing", (t) => {
  const { store } = fixture(t);
  const created = seed(store);
  assert.equal(created.revision, 0);
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

  expectCode("REVISION_CONFLICT", () =>
    setStatus(store, created.id, { status: "completed", currentStep: "draft" }, 1),
  );

  const completed = setStatus(store, created.id, { status: "completed", currentStep: "draft" }, 0);
  assert.equal(completed.status, "completed");
  assert.equal(completed.revision, 1);

  expectCode("INSTANCE_STATE_INVALID", () =>
    setStatus(store, created.id, { status: "running", currentStep: "draft" }, 1),
  );
  assert.equal(loadInstance(store, created.id).revision, 1);
});

test("a transition outside the table is INSTANCE_STATE_INVALID", (t) => {
  const { store } = fixture(t);
  const created = seed(store);
  const failed = setStatus(store, created.id, { status: "failed", currentStep: "draft" }, 0);
  assert.equal(failed.status, "failed");

  expectCode("INSTANCE_STATE_INVALID", () =>
    setStatus(store, created.id, { status: "completed", currentStep: "draft" }, 1),
  );
  expectCode("INSTANCE_STATE_INVALID", () =>
    setStatus(store, created.id, { status: "blocked" as never, currentStep: "draft" }, 1),
  );
  assert.equal(loadInstance(store, created.id).revision, 1);
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

test("a v1 store is refused as STORE_INVALID", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "praxis-store-v1-"));
  const path = join(dir, "praxis.sqlite");
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT");
  db.prepare("INSERT INTO meta(key, value) VALUES('schema', 'praxis.store/v1')").run();
  db.close();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  expectCode("STORE_INVALID", () => openStore(path));
});

test("blocked is not a declared instance status", (t) => {
  const { store } = fixture(t);
  seed(store);
  store.db
    .prepare(
      "INSERT INTO instance(id, flow, actor, status, current_step, revision, nonce, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run("instance-0002", "flows/architect", "engineer-1", "blocked", "draft", 0, NONCE, NOW, NOW);

  expectCode("STORE_INVALID", () => loadInstance(store, "instance-0002"));
  expectCode("STORE_INVALID", () => parseWith(InstanceStatusSchema, "blocked", "STORE_INVALID", "instance status"));
  assert.equal(count(store, "instance"), 2);
});

test("the committed flow document parses and a malformed one is refused", () => {
  const text = readFileSync(new URL("../praxis-schemas/flows/workflow.json", import.meta.url), "utf8");
  const raw = JSON.parse(text) as Record<string, unknown>;
  const config = parseFlowConfig(raw);
  assert.equal(config.flow, "flows/workflow");
  assert.deepEqual(
    config.nodes.map((node) => node.id),
    ["research", "spec", "plan", "implement", "review"],
  );
  assert.deepEqual(
    config.nodes.map((node) => node.task),
    ["tasks/research", "tasks/spec", "tasks/plan", "tasks/implement", "tasks/review"],
  );
  assert.deepEqual(
    config.edges.map((edge) => `${edge.kind}:${edge.from}>${edge.to}`),
    [
      "data:research>spec",
      "data:spec>plan",
      "data:plan>implement",
      "data:implement>review",
      "refuse:review>plan",
    ],
  );

  expectCode("CONFIG_INVALID", () => parseFlowConfig({ ...raw, schema: "praxis.config/v1" }));
  expectCode("CONFIG_INVALID", () => parseFlowConfig({ ...raw, extra: true }));

  const thirdKey = structuredClone(raw) as { nodes: Record<string, unknown>[] };
  thirdKey.nodes[0].consumes = "research";
  expectCode("NODE_INVALID", () => parseFlowConfig(thirdKey));

  const badRef = structuredClone(raw) as { nodes: { task: string }[] };
  badRef.nodes[1].task = "spec";
  expectCode("CONFIG_INVALID", () => parseFlowConfig(badRef));

  const badKind = structuredClone(raw) as { edges: { kind: string }[] };
  badKind.edges[0].kind = "branch";
  expectCode("CONFIG_INVALID", () => parseFlowConfig(badKind));
});

test("the result schema admits exactly the six whitelisted fields", () => {
  const base = {
    instanceId: "instance-0001",
    flow: "flows/architect",
    status: "running",
    artifacts: [{ step: "draft", version: 1, digest: PIN_DIGEST, schema: STEP_SCHEMA }],
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
