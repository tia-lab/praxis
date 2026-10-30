/**
 * Task and flow references are paths (spec R1, R2). A flat path stays valid, a nested
 * one becomes possible, an escaping one is refused by the contract, and an instance
 * pins the path plus the version the task document declares.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isAppError } from "../../src/types/errors.ts";
import { openFlow, start } from "../../src/runner/engine.ts";
import { parseFlowConfig, parseTaskRef, TaskConfigSchema } from "../../src/types/schema.ts";
import { openStore } from "../../src/store/db.ts";
import { publicationOf, readDefinition } from "../../src/store/definitions.ts";
import { digestOf } from "../../src/runner/canonical.ts";
import { NOW, dispose, flowRef, workspace, writeFlow, type Workspace } from "../testkit.ts";

const SCHEMA = "praxis.artifact.architecture/v1";

function options(ws: Workspace) {
  return { configPath: ws.config, storeDir: ws.store, tasksDir: ws.tasks, now: NOW, actor: "tester" };
}

function expectCode(code: string, body: () => unknown): void {
  assert.throws(body, (error: unknown) => isAppError(error) && error.code === code);
}

/** Point the first node of the fixture flow at another task path. */
function retarget(ws: Workspace, task: string): void {
  const document = JSON.parse(readFileSync(ws.config, "utf8")) as { nodes: Array<{ id: string; task: string }> };
  document.nodes[0].task = task;
  writeFileSync(ws.config, JSON.stringify(document, null, 2) + "\n");
}

test("a task reference is a path under tasks/, flat or nested", () => {
  assert.equal(parseTaskRef("tasks/research"), "research");
  assert.equal(parseTaskRef("tasks/core/research"), "core/research");

  for (const refused of [
    "research",
    "research@1",
    "tasks/../escape",
    "tasks/core/../plan",
    "tasks/Research",
    "Tasks/research",
    "tasks//research",
    "tasks/research/",
  ]) {
    expectCode("CONFIG_INVALID", () => parseTaskRef(refused));
  }
});

test("a nested task path resolves inside the library and pins path plus declared version", () => {
  const ws = workspace();
  try {
    writeFlow(ws, "nested", [{ id: "research", capabilities: ["artifact.write"], schema: SCHEMA }]);
    // The document keeps its own version and moves to the nested path the reference names.
    const nested = JSON.parse(readFileSync(join(ws.tasks, "research.json"), "utf8")) as Record<string, unknown>;
    nested.version = 2;
    const bytes = JSON.stringify(nested, null, 2) + "\n";
    mkdirSync(join(ws.tasks, "core"), { recursive: true });
    writeFileSync(join(ws.tasks, "core", "research.json"), bytes);
    rmSync(join(ws.tasks, "research.json"));
    retarget(ws, "tasks/core/research");

    const started = start({ ...options(ws), flow: flowRef("nested"), requestId: "r-path-1" });
    const store = openStore(join(ws.store, "praxis.sqlite"));
    try {
      const pinned = readDefinition(store, started.instance.id, "task", "tasks/core/research");
      assert.equal(pinned.digest, digestOf(JSON.parse(bytes)), "the pin holds the nested document's bytes");
      const published = publicationOf(store, "tasks/core/research", 2);
      assert.ok(published, "the pin records the version the document declares, not one from the reference");
      assert.equal(published.digest, pinned.digest);
      assert.equal(publicationOf(store, "tasks/core/research", 1), undefined, "the reference names no version");
    } finally {
      store.close();
    }
  } finally {
    dispose(ws);
  }
});

test("two nested paths that end in one id are two publications", () => {
  const ws = workspace();
  try {
    // The path is the identity: `research` under `core/` and under `ops/` are different
    // task units even though the document label is the same, so neither pin conflicts.
    writeFlow(ws, "twins", [{ id: "research", capabilities: ["artifact.write"], schema: SCHEMA }]);
    const document = JSON.parse(readFileSync(join(ws.tasks, "research.json"), "utf8")) as Record<string, unknown>;
    for (const [directory, goal] of [["core", "core research"], ["ops", "ops research"]] as const) {
      mkdirSync(join(ws.tasks, directory), { recursive: true });
      writeFileSync(join(ws.tasks, directory, "research.json"), JSON.stringify({ ...document, goal }, null, 2) + "\n");
    }

    const digests: string[] = [];
    for (const [directory, requestId] of [["core", "r-path-a"], ["ops", "r-path-b"]] as const) {
      retarget(ws, "tasks/" + directory + "/research");
      const started = start({ ...options(ws), flow: flowRef("twins"), requestId });
      const store = openStore(join(ws.store, "praxis.sqlite"));
      try {
        const pinned = readDefinition(store, started.instance.id, "task", "tasks/" + directory + "/research");
        const published = publicationOf(store, "tasks/" + directory + "/research", 1);
        assert.ok(published, "each path publishes under its own key");
        assert.equal(published.digest, pinned.digest);
        digests.push(pinned.digest);
      } finally {
        store.close();
      }
    }
    assert.equal(new Set(digests).size, 2, "two paths, two byte sets, two publications");
  } finally {
    dispose(ws);
  }
});

test("a nested path with no document is TASK_NOT_FOUND", () => {
  const ws = workspace();
  try {
    writeFlow(ws, "absent", [{ id: "research", capabilities: ["artifact.write"], schema: SCHEMA }]);
    retarget(ws, "tasks/core/research");
    expectCode("TASK_NOT_FOUND", () => openFlow(options(ws)));
  } finally {
    dispose(ws);
  }
});

test("a flow identity is a path under flows/, and an absent flow is FLOW_INVALID carrying the path", () => {
  const nodes = [{ id: "draft", task: "tasks/draft" }];
  const document = { schema: "praxis.flow/v2", flow: "workflow", nodes, edges: [], result: "praxis.result/v1" };
  expectCode("CONFIG_INVALID", () => parseFlowConfig(document));
  assert.equal(parseFlowConfig({ ...document, flow: "flows/workflow" }).flow, "flows/workflow");
  assert.equal(parseFlowConfig({ ...document, flow: "flows/core/review" }).flow, "flows/core/review");

  const ws = workspace();
  try {
    const absent = join(ws.root, "flows", "absent.json");
    assert.throws(
      () => openFlow({ configPath: absent, tasksDir: ws.tasks, storeDir: ws.store }),
      (error: unknown) =>
        isAppError(error) &&
        error.code === "FLOW_INVALID" &&
        (error.detail as { path?: string } | undefined)?.path === absent,
      "an absent flow names the path it looked for",
    );
  } finally {
    dispose(ws);
  }
});

test("the committed library names its task documents by path, flat and nested", () => {
  const library = new URL("../praxis-schemas/tasks/", import.meta.url);
  assert.deepEqual(readdirSync(library).sort(), ["core", "implement.json", "plan.json", "research.json", "review.json", "spec.json"]);
  const nested = TaskConfigSchema.parse(
    JSON.parse(readFileSync(new URL("core/research.json", library), "utf8")) as unknown,
  );
  assert.equal(nested.id, "research", "a nested document's id is its last path segment");
});
