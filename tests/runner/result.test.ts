import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, writeFileSync } from "node:fs";

import { digestOf } from "../../src/runner/canonical.ts";
import { isAppError } from "../../src/types/errors.ts";
import { parseWith, ResultSchema, type Instance } from "../../src/types/schema.ts";
import { buildResult, RESULT_FIELDS } from "../../src/runner/result.ts";
import { artifactFile, cli, createInstance, dispose, MAIN_TASKS, NOW, workspace, writeFlow } from "../testkit.ts";

interface Ref {
  step: string;
  version: number;
  digest: string;
  schema: string;
}

function refs(result: Record<string, unknown> | undefined): Ref[] {
  const artifacts = result?.artifacts;
  return Array.isArray(artifacts) ? (artifacts as Ref[]) : [];
}

/**
 * P5 / R11: the caller receives six keys and artifact references, never the event
 * log, the bytes, the store path or any transcript.
 */
test("P5: a completed run returns exactly the six declared keys and no history", async () => {
  const ws = workspace();
  try {
    writeFlow(ws, "architect", MAIN_TASKS);
    const { instance, nonce } = await createInstance(ws, "architect", "req-p5");
    const draft = await cli(ws, [
      "resume",
      instance,
      "--artifact",
      artifactFile(ws, "draft.json", { schema: "praxis.artifact.architecture/v1", nonce }),
    ]);
    assert.equal(draft.status, 0, draft.stderr);
    const draftDigest = refs(draft.result)[0].digest;

    const derive = await cli(ws, [
      "resume",
      instance,
      "--artifact",
      artifactFile(ws, "derive.json", { schema: "praxis.artifact.derive/v1", nonce, derivedFrom: draftDigest }),
    ]);
    assert.equal(derive.status, 0, derive.stderr);

    const result = derive.result;
    assert.ok(result, "a completed run prints a result");
    assert.deepEqual(Object.keys(result).sort(), [...RESULT_FIELDS].sort());
    assert.equal(result.status, "completed");
    assert.equal(result.nextAction, "none");
    assert.equal(typeof result.summary, "string");
    assert.ok(String(result.summary).length > 0);

    const accepted = refs(result);
    assert.equal(accepted.length, 2);
    for (const ref of accepted) {
      assert.deepEqual(Object.keys(ref).sort(), ["digest", "schema", "step", "version"]);
      assert.match(ref.digest, /^sha256:[0-9a-f]{64}$/);
    }

    const text = JSON.stringify(result);
    for (const leak of ["payload", "events", "transcript", "artifacts/{\"path\"", "/state/"]) {
      assert.equal(text.includes(leak), false, "the result must not carry " + leak);
    }
    assert.equal("path" in accepted[0], false, "an artifact reference carries no path");

    // The same run read back through `status` is the same bounded shape.
    const status = await cli(ws, ["status", instance]);
    assert.equal(status.status, 0, status.stderr);
    assert.deepEqual(Object.keys(status.result ?? {}).sort(), [...RESULT_FIELDS].sort());
    assert.deepEqual(status.result?.artifacts, result.artifacts);
  } finally {
    dispose(ws);
  }
});

/**
 * R9 / row 41: the parent result carries no pin. The run's flow is edited after start, so
 * the pin and the library genuinely differ, and the six keys are unchanged either way.
 */
test("the result keeps exactly six keys when the pin differs from the library", async () => {
  const ws = workspace();
  try {
    writeFlow(ws, "architect", MAIN_TASKS);
    const pinnedFlow = digestOf(JSON.parse(readFileSync(ws.config, "utf8")));
    const { instance, nonce } = await createInstance(ws, "architect", "req-pin-differs");
    const draft = await cli(ws, [
      "resume",
      instance,
      "--artifact",
      artifactFile(ws, "d1.json", { schema: "praxis.artifact.architecture/v1", nonce }),
    ]);
    assert.equal(draft.status, 0, draft.stderr);
    const draftDigest = refs(draft.result)[0].digest;
    const derive = await cli(ws, [
      "resume",
      instance,
      "--artifact",
      artifactFile(ws, "d2.json", { schema: "praxis.artifact.derive/v1", nonce, derivedFrom: draftDigest }),
    ]);
    assert.equal(derive.status, 0, derive.stderr);

    const moved = JSON.parse(readFileSync(ws.config, "utf8")) as Record<string, unknown>;
    moved.flow = "architect-v2";
    writeFileSync(ws.config, JSON.stringify(moved, null, 2) + "\n");
    assert.notEqual(digestOf(JSON.parse(readFileSync(ws.config, "utf8"))), pinnedFlow, "the library really moved");

    const status = await cli(ws, ["status", instance]);
    assert.equal(status.status, 0, status.stderr);
    const result = status.result ?? {};
    assert.deepEqual(Object.keys(result).sort(), [...RESULT_FIELDS].sort());
    const text = JSON.stringify(result);
    assert.equal(text.includes(pinnedFlow), false, "the pinned flow digest is not exposed");
    assert.equal(refs(result).length, 2);
  } finally {
    dispose(ws);
  }
});

/** R11 is enforced by the schema, not by convention: an extra key is refused. */
test("P5: buildResult validates the six-key shape and refuses an extra key", () => {
  const instance: Instance = {
    id: "i0123456789ab",
    flow: "flows/architect",
    actor: "cli",
    status: "running",
    currentStep: "derive",
    revision: 3,
    nonce: "b".repeat(32),
    createdAt: NOW,
    updatedAt: NOW,
  };
  const result = buildResult(instance, [
    { step: "draft", version: 1, digest: "sha256:" + "c".repeat(64), schema: "praxis.artifact.architecture/v1" },
  ]);
  assert.deepEqual(Object.keys(result).sort(), [...RESULT_FIELDS].sort());
  assert.equal(result.nextAction, "resume");
  assert.deepEqual(Object.keys(result.artifacts[0]).sort(), ["digest", "schema", "step", "version"]);

  assert.throws(
    () => parseWith(ResultSchema, { ...result, events: [] }, "RESULT_INVALID", "result"),
    (error: unknown) => isAppError(error) && error.code === "RESULT_INVALID",
    "an undeclared key must be refused, not silently dropped",
  );
});
