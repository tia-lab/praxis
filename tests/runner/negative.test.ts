import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFileSync } from "node:fs";
import { isAppError } from "../../src/types/errors.ts";
import { call, grantFor, traceOf } from "../../src/runner/capabilities.ts";
import {
  artifactsOf,
  artifactFile,
  cli,
  createInstance,
  dispose,
  eventsOf,
  instanceRow,
  MAIN_TASKS,
  workspace,
  writeFlow,
} from "../testkit.ts";

interface Ref {
  step: string;
  version: number;
  digest: string;
  schema: string;
}

function digestOfStep(run: { result?: Record<string, unknown> }, step: string): string {
  const artifacts = Array.isArray(run.result?.artifacts) ? (run.result?.artifacts as Ref[]) : [];
  const found = artifacts.find((ref) => ref.step === step);
  assert.ok(found, "expected an accepted artifact for " + step);
  return found.digest;
}

/**
 * P7 control: the same flow with artifact.read removed from the consuming step.
 * The handoff is unavailable, so the step fails before it is dispatched and nothing
 * of the instance's durable state moves.
 */
test("P7 control: a consuming step without artifact.read fails ARTIFACT_UNAVAILABLE and writes nothing", async () => {
  const ws = workspace();
  try {
    writeFlow(ws, "architect", [
      { id: "draft", capabilities: ["artifact.write", "emit"], schema: "praxis.artifact.architecture/v1" },
      {
        id: "derive",
        capabilities: ["artifact.write", "emit"],
        schema: "praxis.artifact.derive/v1",
      },
    ]);
    const { instance, nonce } = await createInstance(ws, "architect", "req-p7");
    const draft = await cli(ws, [
      "resume",
      instance,
      "--artifact",
      artifactFile(ws, "draft.json", { schema: "praxis.artifact.architecture/v1", nonce }),
    ]);
    assert.equal(draft.status, 0, draft.stderr);
    const draftDigest = digestOfStep(draft, "draft");

    const artifactsBefore = artifactsOf(ws, instance);
    const eventsBefore = eventsOf(ws, instance);
    const rowBefore = instanceRow(ws, instance);

    const denied = await cli(ws, [
      "resume",
      instance,
      "--artifact",
      artifactFile(ws, "derive.json", {
        schema: "praxis.artifact.derive/v1",
        nonce,
        derivedFrom: draftDigest,
      }),
    ]);

    assert.equal(denied.status, 1, "a denied handoff must be a non-zero exit");
    assert.equal(denied.failure?.code, "ARTIFACT_UNAVAILABLE", denied.stderr);
    assert.equal(denied.result, undefined, "a failed run must not print a result");

    assert.deepEqual(artifactsOf(ws, instance), artifactsBefore, "no artifact row may be written");
    assert.deepEqual(eventsOf(ws, instance), eventsBefore, "no event may be appended");
    const rowAfter = instanceRow(ws, instance);
    assert.deepEqual(rowAfter, rowBefore, "the instance row may not move");
    assert.equal(rowAfter?.current_step, "derive");
  } finally {
    dispose(ws);
  }
});

/**
 * R10 / P8 control: bytes that no longer match the recorded digest fail closed
 * before the consuming step is dispatched, and nothing is written.
 */
test("P8 control: corrupted artifact bytes fail ARTIFACT_DIGEST_MISMATCH before dispatch and write nothing", async () => {
  const ws = workspace();
  try {
    writeFlow(ws, "architect", MAIN_TASKS);
    const { instance, nonce } = await createInstance(ws, "architect", "req-corrupt");
    const draft = await cli(ws, [
      "resume",
      instance,
      "--artifact",
      artifactFile(ws, "draft.json", { schema: "praxis.artifact.architecture/v1", nonce, architecture: { phases: 2 } }),
    ]);
    assert.equal(draft.status, 0, draft.stderr);
    const draftDigest = digestOfStep(draft, "draft");

    const recorded = artifactsOf(ws, instance).find((row) => row.step === "draft");
    assert.ok(recorded, "the draft artifact must be recorded before it is corrupted");
    writeFileSync(String(recorded.path), JSON.stringify({ schema: "praxis.artifact.architecture/v1", nonce, tampered: true }));

    const artifactsBefore = artifactsOf(ws, instance);
    const eventsBefore = eventsOf(ws, instance);
    const rowBefore = instanceRow(ws, instance);

    const corrupted = await cli(ws, [
      "resume",
      instance,
      "--artifact",
      artifactFile(ws, "derive.json", { schema: "praxis.artifact.derive/v1", nonce, derivedFrom: draftDigest }),
    ]);

    assert.equal(corrupted.status, 1);
    assert.equal(corrupted.failure?.code, "ARTIFACT_DIGEST_MISMATCH", corrupted.stderr);
    assert.deepEqual(artifactsOf(ws, instance), artifactsBefore, "no artifact row may be written");
    assert.deepEqual(eventsOf(ws, instance), eventsBefore, "no event may be appended");
    assert.deepEqual(instanceRow(ws, instance), rowBefore, "the instance row may not move");
  } finally {
    dispose(ws);
  }
});

/**
 * P11: a capability the step was not granted is refused before the body runs, so a
 * denial has no effect at all; an unknown name is a config error, not a denial.
 */
test("P11: an ungranted capability is denied with CAPABILITY_DENIED and the body never runs", () => {
  const grant = grantFor({ id: "draft", capabilities: ["emit"] });
  let effects = 0;
  assert.throws(
    () => call(grant, "artifact.write", () => {
      effects += 1;
      return "written";
    }),
    (error: unknown) => isAppError(error) && error.code === "CAPABILITY_DENIED",
  );
  assert.equal(effects, 0, "a denial must not run the body");
  assert.deepEqual(traceOf(grant), [], "a denied call is not traced as a completed call");

  assert.throws(
    () => grantFor({ id: "draft", capabilities: ["artifact.everything"] }),
    (error: unknown) => isAppError(error) && error.code === "CONFIG_INVALID",
    "an unknown capability name is a config error at load",
  );
});
