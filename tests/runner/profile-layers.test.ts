/**
 * S1: the loader reads all three layers. The domain layer keeps its exact previous behaviour, so every existing
 * caller is unchanged; conduct and role join it, because the composed prompt needs them.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { loadProfile, loadProfileLayer } from "../../src/runner/engine/profile.ts";

const root = (): string => mkdtempSync(join(tmpdir(), "praxis-layers-"));

function put(dir: string, layer: string, id: string, doc: unknown): void {
  mkdirSync(join(dir, layer), { recursive: true });
  writeFileSync(join(dir, layer, id + ".json"), JSON.stringify(doc, null, 2) + "\n");
}

const profile = (id: string, layer: string, extra: Record<string, unknown> = {}): unknown => ({
  id,
  version: 1,
  layer,
  name: id,
  description: "a profile",
  overview: "what this layer asks for",
  invariants: ["one invariant"],
  prefer: [],
  avoid: [],
  ...extra,
});

const codeOf = (error: unknown): string | undefined => (error as { code?: string }).code;

/** The three layers load, each keeping its own folder and identity. */
test("conduct, role and domain each load from their own layer", () => {
  const dir = root();
  put(dir, "conduct", "occam", profile("occam", "conduct", { body: "the flowing prose" }));
  put(dir, "role", "architect", profile("architect", "role"));
  put(dir, "domain", "code", profile("code", "domain"));

  const conduct = loadProfileLayer(dir, "conduct", "occam");
  assert.equal(conduct.doc.layer, "conduct");
  assert.equal(conduct.path, "occam");
  assert.equal(conduct.doc.body, "the flowing prose");
  assert.match(conduct.digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(Buffer.from(conduct.bytes).toString("utf8").includes("flowing prose"), true);

  assert.equal(loadProfileLayer(dir, "role", "architect").doc.layer, "role");
  assert.equal(loadProfileLayer(dir, "domain", "code").doc.layer, "domain");
});

/** The old entry point is the domain layer, byte for byte. */
test("loadProfile still reads only the domain layer", () => {
  const dir = root();
  put(dir, "domain", "code", profile("code", "domain"));
  put(dir, "conduct", "occam", profile("occam", "conduct"));
  assert.equal(loadProfile(dir, "code").doc.layer, "domain");
  assert.throws(
    () => loadProfile(dir, "occam"),
    (error: unknown) => codeOf(error) === "PROFILE_NOT_FOUND",
    "a conduct id must not resolve through the domain loader",
  );
});

/** A document in the wrong folder is refused, not silently re-layered. */
test("a profile whose layer disagrees with its folder is PROFILE_INVALID", () => {
  const dir = root();
  put(dir, "conduct", "mislabelled", profile("mislabelled", "role"));
  assert.throws(
    () => loadProfileLayer(dir, "conduct", "mislabelled"),
    (error: unknown) => codeOf(error) === "PROFILE_INVALID",
  );
});

/** The filename is the identity. */
test("a profile whose id disagrees with its filename is PROFILE_INVALID", () => {
  const dir = root();
  put(dir, "role", "architect", profile("someone-else", "role"));
  assert.throws(
    () => loadProfileLayer(dir, "role", "architect"),
    (error: unknown) => codeOf(error) === "PROFILE_INVALID",
  );
});

/** A missing file is a typed miss, and a broken one is not a miss. */
test("a missing profile is PROFILE_NOT_FOUND and bad JSON is PROFILE_INVALID", () => {
  const dir = root();
  assert.throws(
    () => loadProfileLayer(dir, "conduct", "occam"),
    (error: unknown) => codeOf(error) === "PROFILE_NOT_FOUND",
  );
  mkdirSync(join(dir, "conduct"), { recursive: true });
  writeFileSync(join(dir, "conduct", "broken.json"), "{ not json");
  assert.throws(
    () => loadProfileLayer(dir, "conduct", "broken"),
    (error: unknown) => codeOf(error) === "PROFILE_INVALID",
  );
});
