/**
 * Step 5, rows 27-31: the pins. Start writes the flow and every task version into the
 * instance's own `definition` rows; advance reads them, verifies them, and never opens
 * the library. A missing row is `PIN_MISSING` (non-terminal); a mismatching one is
 * `PIN_CORRUPT` and fails the instance.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isAppError } from "../../src/types/errors.ts";
import { advance, start } from "../../src/runner/engine.ts";
import { canonicalBytes, digest, digestOf } from "../../src/runner/canonical.ts";
import { openStore, type Store } from "../../src/store/db.ts";
import { NOW, dispose, flowRef, query, taskRef, workspace, writeFlow, type Workspace } from "../testkit.ts";

const DRAFT = "praxis.artifact.architecture/v1";
const DERIVE = "praxis.artifact.derive/v1";

function options(ws: Workspace) {
  return { configPath: ws.config, storeDir: ws.store, tasksDir: ws.tasks, now: NOW, actor: "tester" };
}

function expectCode(code: string, body: () => unknown): void {
  assert.throws(body, (error: unknown) => isAppError(error) && error.code === code);
}

function withStore<T>(ws: Workspace, body: (store: Store) => T): T {
  const store = openStore(join(ws.store, "praxis.sqlite"));
  try {
    return body(store);
  } finally {
    store.close();
  }
}

function flowWithTwoNodes(ws: Workspace): void {
  writeFlow(ws, "architect", [
    { id: "draft", capabilities: ["artifact.write", "emit"], schema: DRAFT },
    { id: "derive", capabilities: ["artifact.read", "artifact.write", "emit"], schema: DERIVE },
  ]);
}

function definitions(ws: Workspace): Array<Record<string, unknown>> {
  return query(ws, "SELECT instance, kind, id, digest FROM definition ORDER BY kind, id");
}

function artifactCount(ws: Workspace): number {
  return Number(query(ws, "SELECT COUNT(*) AS n FROM artifact")[0].n);
}

test("start pins the flow and every task version", () => {
  const ws = workspace();
  try {
    flowWithTwoNodes(ws);
    const started = start({ ...options(ws), flow: flowRef("architect"), requestId: "r-27" });
    const rows = definitions(ws);
    assert.equal(rows.length, 3, "one flow row and one row per task path");
    const flow = rows.find((row) => row.kind === "flow");
    assert.ok(flow);
    assert.equal(flow.id, "flows/architect");
    assert.equal(flow.digest, digestOf(JSON.parse(readFileSync(ws.config, "utf8"))));
    for (const node of ["draft", "derive"]) {
      const row = rows.find((candidate) => candidate.kind === "task" && candidate.id === taskRef(node));
      assert.ok(row, "expected a pin for " + node);
      assert.equal(row.digest, digestOf(JSON.parse(readFileSync(join(ws.tasks, node + ".json"), "utf8"))));
    }
    assert.equal(started.instance.id, rows[0].instance);
  } finally {
    dispose(ws);
  }
});

test("editing the flow and task files after start changes nothing on advance", () => {
  const ws = workspace();
  try {
    flowWithTwoNodes(ws);
    const started = start({ ...options(ws), flow: flowRef("architect"), requestId: "r-28" });
    const nonce = started.instance.nonce;
    const draftPayload = { schema: DRAFT, nonce, architecture: { phases: 2 } };
    const first = advance({ ...options(ws), instance: started.instance.id, artifact: draftPayload });
    assert.equal(first.instance.currentStep, "derive");
    const draftDigest = digest(canonicalBytes(draftPayload));
    const pins = definitions(ws);

    // Both inputs move on disk after start; the pins do not.
    const flow = JSON.parse(readFileSync(ws.config, "utf8")) as { flow: string };
    // A rewritten identity is a valid one: the flow key is a path, not a free string.
    flow.flow = "flows/rewritten";
    writeFileSync(ws.config, JSON.stringify(flow, null, 2) + "\n");
    const taskPath = join(ws.tasks, "draft.json");
    const task = JSON.parse(readFileSync(taskPath, "utf8")) as { goal: string };
    task.goal = "rewritten after start";
    writeFileSync(taskPath, JSON.stringify(task, null, 2) + "\n");

    const second = advance({
      ...options(ws),
      instance: started.instance.id,
      artifact: { schema: DERIVE, nonce, derivedFrom: draftDigest },
    });
    assert.equal(second.result.status, "completed");
    assert.deepEqual(definitions(ws), pins, "the pinned digests are unchanged");
  } finally {
    dispose(ws);
  }
});

test("a deleted pin row is PIN_MISSING", () => {
  const ws = workspace();
  try {
    flowWithTwoNodes(ws);
    const started = start({ ...options(ws), flow: flowRef("architect"), requestId: "r-29" });
    const nonce = started.instance.nonce;
    const before = artifactCount(ws);
    withStore(ws, (store) =>
      store.db.prepare("DELETE FROM definition WHERE kind = 'task' AND id = ?").run(taskRef("draft")),
    );

    expectCode("PIN_MISSING", () =>
      advance({ ...options(ws), instance: started.instance.id, artifact: { schema: DRAFT, nonce } }),
    );
    const row = query(ws, "SELECT status, current_step FROM instance WHERE id = ?", [started.instance.id])[0];
    assert.equal(row.status, "running", "a missing pin is not terminal");
    assert.equal(row.current_step, "draft");
    assert.equal(artifactCount(ws), before, "no artifact row was written");
  } finally {
    dispose(ws);
  }
});

test("one corrupted pinned byte is PIN_CORRUPT and fails the instance", () => {
  const ws = workspace();
  try {
    flowWithTwoNodes(ws);
    const started = start({ ...options(ws), flow: flowRef("architect"), requestId: "r-30" });
    const nonce = started.instance.nonce;
    const before = artifactCount(ws);
    withStore(ws, (store) =>
      store.db
        .prepare("UPDATE definition SET bytes = ? WHERE kind = 'flow' AND id = ?")
        .run(canonicalBytes({ tampered: true }), flowRef("architect")),
    );

    expectCode("PIN_CORRUPT", () =>
      advance({ ...options(ws), instance: started.instance.id, artifact: { schema: DRAFT, nonce } }),
    );
    const row = query(ws, "SELECT status, current_step FROM instance WHERE id = ?", [started.instance.id])[0];
    assert.equal(row.status, "failed", "a mismatch is terminal");
    assert.equal(row.current_step, "draft");
    assert.equal(artifactCount(ws), before, "no artifact row was written");
  } finally {
    dispose(ws);
  }
});

test("the flow digest has one owner: the definition row", () => {
  const ws = workspace();
  try {
    flowWithTwoNodes(ws);
    const started = start({ ...options(ws), flow: flowRef("architect"), requestId: "r-31" });
    const columns = query(ws, "SELECT name FROM pragma_table_info('instance')").map((row) => String(row.name));
    assert.equal(columns.includes("config_digest"), false, "the instance column is retired");
    const flows = definitions(ws).filter((row) => row.kind === "flow");
    assert.equal(flows.length, 1, "exactly one row owns the flow digest");
    assert.equal(flows[0].digest, digestOf(JSON.parse(readFileSync(ws.config, "utf8"))));
    assert.equal(flows[0].instance, started.instance.id);
  } finally {
    dispose(ws);
  }
});
