/**
 * The task document (spec R1, plan step 2): one strict `praxis.task/v1` unit.
 *
 * Each row names the typed code the load throws and proves the library on disk is
 * untouched by a refusal — a task document is data a caller reads, never a thing a
 * parse writes. The seven rows are plan §7 rows 1-7.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { TaskConfigSchema, parseWith } from "../../src/types/schema.ts";
import { tmpdir } from "node:os";

const TASKS = ".pi/praxis/tasks";

/** A valid task document; each negative mutates exactly one field. */
function task(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "draft",
    version: 1,
    state: "published",
    goal: "Write the architecture draft",
    capabilities: ["artifact.write", "emit"],
    produces: { schema: "praxis.artifact.architecture/v1" },
    gate: "schema-valid-and-nonce",
    ...overrides,
  };
}

/** The library listing a refusal must not change (absent directory counts as empty). */
function librarySnapshot(root: string): string[] {
  const dir = join(root, TASKS);
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

const ROOT = tmpdir();

function expectCode(code: string, value: unknown): void {
  let thrown: unknown;
  try {
    parseWith(TaskConfigSchema, value, "CONFIG_INVALID", "task document");
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof Error, "expected a typed refusal, got none");
  assert.equal((thrown as { code?: string }).code, code);
}

test("a task document with the declared keys loads", () => {
  const before = librarySnapshot(ROOT);
  const parsed = parseWith(TaskConfigSchema, task(), "CONFIG_INVALID", "task document");
  assert.equal(parsed.id, "draft");
  assert.equal(parsed.version, 1);
  assert.equal(parsed.state, "published");
  assert.deepEqual(parsed.capabilities, ["artifact.write", "emit"]);
  assert.deepEqual(librarySnapshot(ROOT), before);
});

test("an undeclared task key is CONFIG_INVALID", () => {
  expectCode("CONFIG_INVALID", task({ consumes: "draft" }));
  expectCode("CONFIG_INVALID", task({ onRefuse: "plan" }));
});

test("a task without an id is CONFIG_INVALID", () => {
  const { id: _id, ...withoutId } = task();
  expectCode("CONFIG_INVALID", withoutId);
});

test("an unknown capability is CONFIG_INVALID", () => {
  expectCode("CONFIG_INVALID", task({ capabilities: ["shell"] }));
});

test("an upper-case task id is CONFIG_INVALID", () => {
  expectCode("CONFIG_INVALID", task({ id: "Research" }));
});

test("version 0 is CONFIG_INVALID", () => {
  expectCode("CONFIG_INVALID", task({ version: 0 }));
});

test("a string version is CONFIG_INVALID", () => {
  expectCode("CONFIG_INVALID", task({ version: "1" }));
});
