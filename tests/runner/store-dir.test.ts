/**
 * Where the store lives (O-store resolution): `--store` > `PRAXIS_STORE_DIR` > the project config's
 * `defaults.storeDir` > `<cwd>/.pi/praxis/state`.
 *
 * The Pi path used to hardcode the default and so SHADOWED the environment; these cases pin the
 * order at all three call sites (the engine's `storeDirOf`, the Pi tool's `engineOptions`, and the
 * CLI flag mapping), and pin that the COMMITTED project config carries no `storeDir`, so no run or
 * test has its store moved out from under it.
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { engineOptions } from "../../src/pi/tool.ts";
import { projectStoreDir, storeDirOf } from "../../src/runner/engine/support.ts";
import { ProjectConfigSchema } from "../../src/types/project.ts";
import { workspace, dispose, type Workspace } from "../testkit.ts";

/** The repository root, so the committed project config can be read for real. */
const REPO = new URL("../../", import.meta.url).pathname;

/** A workspace whose project config declares `defaults` (or none at all when `defaults` is null). */
function project(defaults: Record<string, unknown> | null): Workspace {
  const ws = workspace();
  if (defaults !== null) {
    mkdirSync(join(ws.root, ".pi", "praxis"), { recursive: true });
    writeFileSync(
      join(ws.root, ".pi", "praxis", "config.json"),
      JSON.stringify({ schema: "praxis.project/v1", defaults }, null, 2) + "\n",
    );
  }
  return ws;
}

/** Run `body` with the process cwd inside `root` and the store env cleared, then restore both. */
function inProject<T>(root: string, body: () => T, env?: string): T {
  const cwd = process.cwd();
  const previous = process.env.PRAXIS_STORE_DIR;
  try {
    process.chdir(root);
    if (env === undefined) delete process.env.PRAXIS_STORE_DIR;
    else process.env.PRAXIS_STORE_DIR = env;
    return body();
  } finally {
    process.chdir(cwd);
    if (previous === undefined) delete process.env.PRAXIS_STORE_DIR;
    else process.env.PRAXIS_STORE_DIR = previous;
  }
}

test("projectStoreDir returns the declared value and undefined when there is none", () => {
  const declared = project({ storeDir: "state-from-config", maxAttempts: 4 });
  const without = project({ maxAttempts: 4 });
  const absent = project(null);
  const empty = project({ storeDir: "" });
  try {
    assert.equal(projectStoreDir(declared.root), "state-from-config");
    assert.equal(projectStoreDir(without.root), undefined, "a config without storeDir declares none");
    assert.equal(projectStoreDir(absent.root), undefined, "no config file at all");
    assert.equal(projectStoreDir(empty.root), undefined, "an empty storeDir is refused, not used");
  } finally {
    for (const ws of [declared, without, absent, empty]) dispose(ws);
  }
});

test("storeDirOf honors the project config when no option or env is set", () => {
  const ws = project({ storeDir: "state-from-config" });
  const bare = project(null);
  try {
    assert.equal(
      inProject(ws.root, () => storeDirOf({})),
      resolve(ws.root, "state-from-config"),
      "the project config is read when nothing above it is set",
    );
    assert.equal(
      inProject(bare.root, () => storeDirOf({})),
      resolve(bare.root, ".pi/praxis/state"),
      "control: the same call without a config resolves the built-in default",
    );
  } finally {
    dispose(ws);
    dispose(bare);
  }
});

test("the environment beats the project config, and an explicit option beats both", () => {
  const ws = project({ storeDir: "state-from-config" });
  const flag = join(ws.root, "state-from-flag");
  try {
    inProject(
      ws.root,
      () => {
        assert.equal(
          storeDirOf({}),
          resolve(ws.root, "state-from-env"),
          "PRAXIS_STORE_DIR wins over defaults.storeDir",
        );
        assert.equal(
          storeDirOf({ storeDir: flag }),
          resolve(flag),
          "the CLI's --store maps to options.storeDir, which is first",
        );
      },
      "state-from-env",
    );
  } finally {
    dispose(ws);
  }
});

test("the Pi tool path resolves env, then config, then the default, all against ctx.cwd", () => {
  const configured = project({ storeDir: "state-from-config" });
  const bare = project(null);
  try {
    inProject(
      configured.root,
      () => {
        assert.equal(engineOptions({ cwd: configured.root }).storeDir, resolve(configured.root, "state-from-env"));
        assert.equal(
          engineOptions({ cwd: bare.root }).storeDir,
          resolve(bare.root, "state-from-env"),
          "the environment wins over a project that declares nothing",
        );
      },
      "state-from-env",
    );
    // With the environment clear, the Pi path reads the project config (this used to be hardcoded).
    inProject(configured.root, () => {
      assert.equal(engineOptions({ cwd: configured.root }).storeDir, resolve(configured.root, "state-from-config"));
    });
    inProject(bare.root, () => {
      assert.equal(
        engineOptions({ cwd: bare.root }).storeDir,
        resolve(bare.root, ".pi/praxis/state"),
        "a project with no config and no env keeps the built-in default",
      );
    });
  } finally {
    dispose(configured);
    dispose(bare);
  }
});

test("the committed project config carries NO storeDir, so no run or test is redirected", () => {
  const raw = readFileSync(join(REPO, ".pi/praxis/config.json"), "utf8");
  const parsed = ProjectConfigSchema.parse(JSON.parse(raw));
  assert.equal(raw.includes("storeDir"), false, "the committed file has no storeDir key at all");
  assert.equal(parsed.schema, "praxis.project/v1");
  assert.equal(parsed.defaults?.maxAttempts, 10, "the committed budget is untouched");
  assert.equal(parsed.defaults?.storeDir, undefined);
  // And the engine agreement: with the env clear, the repo resolves to its built-in default.
  inProject(REPO, () => {
    assert.equal(storeDirOf({}), resolve(REPO, ".pi/praxis/state"));
  });
});
