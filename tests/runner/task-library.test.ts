/**
 * Step 5, rows 20-26: the task library. A task version is an identity, a draft may not be
 * pinned, a publication is durable, and an instance pins the versions it ran under.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isAppError } from "../../src/types/errors.ts";
import { start } from "../../src/runner/engine/index.ts";
import { digestOf } from "../../src/runner/canonical.ts";
import { openStore } from "../../src/store/db.ts";
import { publicationOf, readDefinition } from "../../src/store/definitions.ts";
import { NOW, dispose, flowRef, query, taskRef, workspace, writeFlow, type Workspace } from "../testkit.ts";

const SCHEMA = "praxis.artifact.architecture/v1";

function options(ws: Workspace) {
  return { configPath: ws.config, storeDir: ws.store, tasksDir: ws.tasks, now: NOW, actor: "tester" };
}

function expectCode(code: string, body: () => unknown): void {
  assert.throws(body, (error: unknown) => isAppError(error) && error.code === code);
}

function taskDocument(ws: Workspace, ref: string): unknown {
  return JSON.parse(readFileSync(join(ws.tasks, ref + ".json"), "utf8")) as unknown;
}

function rewriteTask(ws: Workspace, ref: string, goal: string): void {
  const path = join(ws.tasks, ref + ".json");
  const document = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  document.goal = goal;
  writeFileSync(path, JSON.stringify(document, null, 2) + "\n");
}

function instances(ws: Workspace): number {
  return Number(query(ws, "SELECT COUNT(*) AS n FROM instance")[0].n);
}

function publications(ws: Workspace): number {
  return Number(query(ws, "SELECT COUNT(*) AS n FROM publication")[0].n);
}

function pinned(ws: Workspace, instance: string, kind: "flow" | "task", id: string): string {
  const store = openStore(join(ws.store, "praxis.sqlite"));
  try {
    return readDefinition(store, instance, kind, id).digest;
  } finally {
    store.close();
  }
}

test("pinning a draft task is TASK_NOT_PUBLISHED", () => {
  const ws = workspace();
  try {
    writeFlow(ws, "draft-flow", [
      { id: "draft", capabilities: ["artifact.write"], schema: SCHEMA, state: "draft" },
    ]);
    expectCode("TASK_NOT_PUBLISHED", () => start({ ...options(ws), flow: flowRef("draft-flow"), requestId: "r-20" }));
    assert.equal(instances(ws), 0, "a refused pin writes nothing");
  } finally {
    dispose(ws);
  }
});

test("a rewritten published version is TASK_VERSION_CONFLICT", () => {
  const ws = workspace();
  try {
    writeFlow(ws, "lib", [{ id: "draft", capabilities: ["artifact.write"], schema: SCHEMA }]);
    const first = start({ ...options(ws), flow: flowRef("lib"), requestId: "r-21a" });
    const published = pinned(ws, first.instance.id, "task", taskRef("draft"));

    rewriteTask(ws, "draft", "a rewritten goal under the same version");
    expectCode("TASK_VERSION_CONFLICT", () => start({ ...options(ws), flow: flowRef("lib"), requestId: "r-21b" }));
    assert.equal(pinned(ws, first.instance.id, "task", taskRef("draft")), published, "the first pin is unchanged");
    assert.equal(publications(ws), 1, "no second publication row");
  } finally {
    dispose(ws);
  }
});

test("a version never published before is taken on first use", () => {
  const ws = workspace();
  try {
    writeFlow(ws, "lib", [{ id: "draft", capabilities: ["artifact.write"], schema: SCHEMA }]);
    const store = openStore(join(ws.store, "praxis.sqlite"));
    let before;
    try {
      before = publicationOf(store, taskRef("draft"), 1);
    } finally {
      store.close();
    }
    assert.equal(before, undefined, "nothing is published before the first pin");

    const started = start({ ...options(ws), flow: flowRef("lib"), requestId: "r-22" });
    const store2 = openStore(join(ws.store, "praxis.sqlite"));
    try {
      const row = publicationOf(store2, taskRef("draft"), 1);
      assert.ok(row, "the first pin publishes the version");
      assert.equal(row.digest, digestOf(taskDocument(ws, "draft")));
      assert.equal(row.digest, pinned(ws, started.instance.id, "task", taskRef("draft")));
    } finally {
      store2.close();
    }
  } finally {
    dispose(ws);
  }
});

test("one task path carries two published versions, each pinned by its own bytes", () => {
  const ws = workspace();
  try {
    // The reference names the path; the document declares the version. Two documents
    // at one path are two pins, and neither instance sees the other's bytes.
    writeFlow(ws, "f1", [{ id: "review", version: 1, capabilities: ["artifact.write"], schema: SCHEMA }]);
    const firstPath = join(ws.root, "f1.json");
    writeFileSync(firstPath, readFileSync(ws.config));
    const v1 = taskDocument(ws, "review");
    const one = start({ ...options(ws), configPath: firstPath, flow: flowRef("f1"), requestId: "r-23a" });

    writeFlow(ws, "f2", [{ id: "review", version: 2, capabilities: ["artifact.write"], schema: SCHEMA }]);
    const v2 = taskDocument(ws, "review");
    const two = start({ ...options(ws), flow: flowRef("f2"), requestId: "r-23b" });

    const d1 = pinned(ws, one.instance.id, "task", taskRef("review"));
    const d2 = pinned(ws, two.instance.id, "task", taskRef("review"));
    assert.notEqual(d1, d2, "each version pins its own bytes");
    assert.equal(d1, digestOf(v1));
    assert.equal(d2, digestOf(v2));
  } finally {
    dispose(ws);
  }
});

test("three flows reuse one published task", () => {
  const ws = workspace();
  try {
    const paths: string[] = [];
    for (const name of ["f1", "f2", "f3"]) {
      writeFlow(ws, name, [{ id: "draft", capabilities: ["artifact.write"], schema: SCHEMA }]);
      const path = join(ws.root, name + ".json");
      writeFileSync(path, readFileSync(ws.config));
      paths.push(path);
    }
    const digests = paths.map((path, index) => {
      const started = start({ ...options(ws), configPath: path, flow: flowRef("f" + (index + 1)), requestId: "r-24-" + index });
      return pinned(ws, started.instance.id, "task", taskRef("draft"));
    });
    assert.deepEqual(new Set(digests).size, 1, "one task unit, one digest, three flows");
    assert.equal(publications(ws), 1, "the first pin publishes once; the rest confirm");
  } finally {
    dispose(ws);
  }
});

test("a re-opened request with different flow bytes is REQUEST_CONFLICT", () => {
  const ws = workspace();
  try {
    writeFlow(ws, "lib", [{ id: "draft", capabilities: ["artifact.write"], schema: SCHEMA }]);
    start({ ...options(ws), flow: flowRef("lib"), requestId: "r-25" });

    writeFlow(ws, "lib", [
      { id: "draft", capabilities: ["artifact.write"], schema: SCHEMA },
      { id: "derive", capabilities: ["artifact.read", "artifact.write"], schema: "praxis.artifact.derive/v1" },
    ]);
    expectCode("REQUEST_CONFLICT", () => start({ ...options(ws), flow: flowRef("lib"), requestId: "r-25" }));
    assert.equal(instances(ws), 1);
  } finally {
    dispose(ws);
  }
});

test("an instance pins the task versions it ran under", () => {
  const ws = workspace();
  try {
    writeFlow(ws, "lib", [
      { id: "draft", capabilities: ["artifact.write"], schema: SCHEMA },
      { id: "derive", capabilities: ["artifact.read", "artifact.write"], schema: "praxis.artifact.derive/v1" },
    ]);
    const started = start({ ...options(ws), flow: flowRef("lib"), requestId: "r-26" });
    const flowDigest = pinned(ws, started.instance.id, "flow", flowRef("lib"));
    assert.equal(flowDigest, digestOf(JSON.parse(readFileSync(ws.config, "utf8"))));
    assert.equal(pinned(ws, started.instance.id, "task", taskRef("draft")), digestOf(taskDocument(ws, "draft")));
    assert.equal(pinned(ws, started.instance.id, "task", taskRef("derive")), digestOf(taskDocument(ws, "derive")));

    const before = pinned(ws, started.instance.id, "task", taskRef("draft"));
    rewriteTask(ws, "draft", "edited after start");
    assert.notEqual(digestOf(taskDocument(ws, "draft")), before, "the file really changed");
    assert.equal(
      pinned(ws, started.instance.id, "task", taskRef("draft")),
      before,
      "the pin holds the bytes the run started with, not the edited file",
    );
  } finally {
    dispose(ws);
  }
});
