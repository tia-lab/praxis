/**
 * S4: the hook. It replaces the whole prompt with one composed document, nests nothing twice, and composes
 * nothing at all when it cannot know the role - fail closed to Pi's own prompt.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { CONDUCT_ID, createPromptHook } from "../../src/pi/prompt-hook.ts";
import { PROMPT_ADVISORY, PROMPT_MARKER_PREFIX } from "../../src/runner/engine/prompt.ts";

const ENVIRONMENT = "Pi's own prompt.\n\n## Project context\nAGENTS.md";

const CONDUCT = {
  id: "occam",
  version: 1,
  layer: "conduct",
  name: "Occam",
  description: "the base conduct",
  overview: "reason from evidence",
  invariants: ["state the evidence"],
  prefer: ["prefer the smallest change"],
  avoid: ["do not claim what you did not run"],
  body: "the spine",
};

const ARCHITECT = {
  id: "architect",
  version: 1,
  layer: "role",
  name: "Architect",
  description: "the design seat",
  overview: "design before building",
  invariants: ["bind the design to a spec"],
  prefer: [],
  avoid: [],
};

interface Fixture {
  readonly cwd: string;
  readonly store: string;
}

function project(options: { roles?: Record<string, unknown>; conduct?: unknown; config?: unknown } = {}): Fixture {
  const cwd = mkdtempSync(join(tmpdir(), "praxis-hook-"));
  const profile = join(cwd, ".pi", "praxis", "profile");
  mkdirSync(join(profile, "conduct"), { recursive: true });
  mkdirSync(join(profile, "role"), { recursive: true });
  writeFileSync(join(profile, "conduct", CONDUCT_ID + ".json"), JSON.stringify(options.conduct ?? CONDUCT, null, 2));
  for (const [id, doc] of Object.entries(options.roles ?? { architect: ARCHITECT })) {
    writeFileSync(join(profile, "role", id + ".json"), JSON.stringify(doc, null, 2));
  }
  if (options.config !== undefined) {
    mkdirSync(join(cwd, ".pi", "praxis"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "praxis", "config.json"), JSON.stringify(options.config, null, 2));
  }
  const store = join(cwd, ".pi", "praxis", "state");
  mkdirSync(store, { recursive: true });
  return { cwd, store };
}

function snapshot(fixture: Fixture, body: unknown): void {
  writeFileSync(join(fixture.store, "active.json"), typeof body === "string" ? body : JSON.stringify(body));
}

const RUNNING = (domains: unknown[]) => ({
  v: 1,
  instance: "i1",
  flow: "flows/learn",
  step: "make",
  task: "tasks/make",
  status: "running",
  domains,
  at: "2026-11-01T00:00:00.000Z",
});

const CODE_SNAPSHOT = {
  id: "code",
  version: 1,
  digest: "sha256:" + "a".repeat(64),
  overview: "read before changing",
  invariants: ["read the code first"],
  prefer: [],
  avoid: [],
};

const hook = (fixture: Fixture, env: Record<string, string | undefined> = { PRAXIS_ROLE: "architect" }, warnings: string[] = []) =>
  createPromptHook({
    cwd: fixture.cwd,
    storeDir: fixture.store,
    env,
    warn: (line) => warnings.push(line),
    trace: () => undefined,
  });

/** The whole point: one document, four sections in this order, Pi's prompt nested verbatim and last. */
test("the hook replaces the prompt with conduct, role, domain and the environment verbatim", () => {
  const fixture = project();
  snapshot(fixture, RUNNING([CODE_SNAPSHOT]));
  const result = hook(fixture)({ systemPrompt: ENVIRONMENT });
  assert.ok(result?.systemPrompt !== undefined, "a claimed role composes");
  const text = result.systemPrompt;
  assert.equal(text.startsWith(PROMPT_MARKER_PREFIX), true);
  const order = ["# Conduct", "# Role", "# Domain", "# Environment"].map((heading) => text.indexOf(heading));
  assert.ok(order.every((at) => at > 0), "every section is present");
  assert.deepEqual([...order].sort((left, right) => left - right), order, "in this order");
  // The environment is Pi's own prompt, untouched, and it closes the document.
  assert.equal(text.endsWith("# Environment\n\n" + ENVIRONMENT), true);
  assert.equal(text.includes(ENVIRONMENT), true);
  // The advisory line: once, before the environment.
  assert.equal(text.split(PROMPT_ADVISORY).length - 1, 1);
  assert.ok(text.indexOf(PROMPT_ADVISORY) < text.indexOf("# Environment"));
});

/** Idempotence: a second boundary sees a composed prompt and nests nothing. */
test("a composed prompt is left alone, so an environment is never nested twice", () => {
  const fixture = project();
  snapshot(fixture, RUNNING([]));
  const build = hook(fixture);
  const first = build({ systemPrompt: ENVIRONMENT });
  assert.ok(first?.systemPrompt !== undefined);
  assert.equal(build({ systemPrompt: first.systemPrompt }), undefined);
  assert.equal(first.systemPrompt.split("# Environment").length - 1, 1);
});

/** No role: no composition at all, and exactly ONE warning. */
test("an unclaimed role composes nothing and warns once", () => {
  const fixture = project();
  snapshot(fixture, RUNNING([CODE_SNAPSHOT]));
  const warnings: string[] = [];
  assert.equal(hook(fixture, {}, warnings)({ systemPrompt: ENVIRONMENT }), undefined);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /no role claimed/);
});

/** The project config may claim the seat when the environment does not (lead ruling Q3). */
test("defaults.role composes when PRAXIS_ROLE is unset", () => {
  const fixture = project({ config: { schema: "praxis.project/v1", defaults: { role: "architect" } } });
  snapshot(fixture, RUNNING([]));
  const result = hook(fixture, {})({ systemPrompt: ENVIRONMENT });
  assert.ok(result?.systemPrompt !== undefined);
  assert.equal(result.systemPrompt.includes("# Role \u2014 architect v1"), true);
  assert.equal(result.systemPrompt.includes("# Domain"), false);
});

/** A role that resolves to no file is a refusal, not a partial prompt. */
test("a role with no profile composes nothing and warns", () => {
  const fixture = project();
  const warnings: string[] = [];
  assert.equal(hook(fixture, { PRAXIS_ROLE: "ghost" }, warnings)({ systemPrompt: ENVIRONMENT }), undefined);
  assert.equal(warnings.length, 1);
});

/** A closed instance has no domain; a malformed or absent snapshot has no domain and never throws. */
test("no domain for a closed, malformed or absent snapshot", () => {
  const closed = project();
  snapshot(closed, { ...RUNNING([CODE_SNAPSHOT]), status: "closed" });
  assert.equal(hook(closed)({ systemPrompt: ENVIRONMENT })?.systemPrompt?.includes("# Domain"), false);

  const malformed = project();
  snapshot(malformed, "{ not json");
  assert.equal(hook(malformed)({ systemPrompt: ENVIRONMENT })?.systemPrompt?.includes("# Domain"), false);

  const absent = project();
  assert.equal(hook(absent)({ systemPrompt: ENVIRONMENT })?.systemPrompt?.includes("# Domain"), false);
});

/** The domain comes from the snapshot, so the prompt and the pin can never disagree. */
test("the domain block is the snapshot's, version and digest included", () => {
  const fixture = project();
  snapshot(fixture, RUNNING([{ ...CODE_SNAPSHOT, version: 4, overview: "the pinned lens" }]));
  const text = hook(fixture)({ systemPrompt: "env" })?.systemPrompt ?? "";
  assert.equal(text.includes("# Domain \u2014 code v4"), true);
  assert.equal(text.includes("the pinned lens"), true);
  assert.equal(text.includes("code@4"), true, "the marker names the version");
});
