/**
 * Retry after a gate refusal (owner decision 2026-10-29: evidence-versioned retry).
 *
 * A refused artifact keeps its pending row and its bytes; the instance keeps running on
 * the same step; a corrected retry is recorded as the next version and only that version
 * is accepted. A pending version with no recorded refusal is still a killed attempt, so
 * different content for it stays ARTIFACT_VERSION_CONFLICT (P8, covered in tests/pi).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, writeFileSync } from "node:fs";

import {
  artifactsOf,
  artifactFile,
  cli,
  createInstance,
  dispose,
  eventsOf,
  instanceRow,
  workspace,
  type Workspace,
} from "../testkit.ts";

const DRAFT = "praxis.artifact.architecture/v1";
const DERIVE = "praxis.artifact.derive/v1";

interface Failure {
  code: string;
  message: string;
  detail?: { version?: number; missing?: string[]; checks?: Record<string, boolean> };
}

/** The accepted two-step flow, with a section requirement on the first step. */
function writeRequiringFlow(ws: Workspace, flow: string): void {
  writeFileSync(
    ws.config,
    JSON.stringify({
      schema: "praxis.config/v1",
      flow,
      steps: [
        {
          id: "draft",
          capabilities: ["artifact.write", "emit"],
          produces: { schema: DRAFT },
          gate: "section-requirements",
          requires: { section: "sources", minItems: 1, each: ["url"] },
        },
        {
          id: "derive",
          capabilities: ["artifact.read", "artifact.write", "emit"],
          consumes: "draft",
          produces: { schema: DERIVE },
          gate: "schema-valid-and-nonce",
        },
      ],
      result: "praxis.result/v1",
    }),
  );
}

const draft = (nonce: string, extra: Record<string, unknown> = {}) => ({ schema: DRAFT, nonce, ...extra });
const complete = (nonce: string) => draft(nonce, { sources: [{ url: "https://example.test/a", claim: "primary" }] });

function failureOf(run: { lines: Array<Record<string, unknown>> }): Failure {
  const line = run.lines.find((entry) => entry.error !== undefined);
  assert.ok(line, "expected a typed failure line: " + JSON.stringify(run.lines));
  return line.error as Failure;
}

function bytesAt(path: unknown): string {
  return readFileSync(String(path), "utf8");
}

test("a section refusal keeps v1 pending, leaves the step current, and the retry is accepted as v2", async () => {
  const ws = workspace();
  try {
    writeRequiringFlow(ws, "architect");
    const { instance, nonce } = await createInstance(ws, "architect", "req-retry-1");
    const refusedPayload = draft(nonce);

    const refused = await cli(ws, ["resume", instance, "--artifact", artifactFile(ws, "bad.json", refusedPayload)]);
    assert.equal(refused.status, 1, "a refusal is a non-zero exit");
    const failure = failureOf(refused);
    assert.equal(failure.code, "ARTIFACT_INVALID");
    assert.deepEqual(failure.detail?.missing, ["sources"]);
    assert.equal(failure.detail?.version, 1);
    assert.equal(refused.result, undefined, "a refusal prints no result");

    const row = instanceRow(ws, instance);
    assert.equal(row?.status, "running");
    assert.equal(row?.current_step, "draft");
    assert.equal(row?.revision, 0, "a refusal must not move the instance row");

    const refusedRows = artifactsOf(ws, instance);
    assert.deepEqual(refusedRows.map((entry) => [entry.version, entry.state]), [[1, "pending"]]);
    const refusedBytes = bytesAt(refusedRows[0].path);
    assert.deepEqual(JSON.parse(refusedBytes), refusedPayload);

    const verdicts = eventsOf(ws, instance).filter((event) => event.type === "gate.verdict");
    assert.equal(verdicts.length, 1);
    assert.deepEqual(verdicts[0].payload, {
      step: "draft",
      version: 1,
      decision: "reject",
      checks: { object: true, schemaMatches: true, noncePresent: true, sectionRequirement: false },
      missing: ["sources"],
      artifactDigest: refusedRows[0].digest,
    });

    const acceptedPayload = complete(nonce);
    const accepted = await cli(ws, ["resume", instance, "--artifact", artifactFile(ws, "good.json", acceptedPayload)]);
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.equal(accepted.result?.status, "running");
    const refs = accepted.result?.artifacts as Array<{ step: string; version: number; digest: string }>;
    assert.deepEqual(refs.map((ref) => [ref.step, ref.version]), [["draft", 2]]);

    const rowsNow = artifactsOf(ws, instance);
    assert.deepEqual(rowsNow.map((entry) => [entry.version, entry.state]), [[1, "pending"], [2, "accepted"]]);
    assert.equal(bytesAt(rowsNow[0].path), refusedBytes, "the refused bytes are never deleted or rewritten");
    assert.equal(rowsNow[0].digest, refusedRows[0].digest);
    assert.equal(rowsNow[1].digest, refs[0].digest);

    const handoff = artifactsOf(ws, instance).find((entry) => entry.step === "draft" && entry.state === "accepted");
    const derived = await cli(ws, [
      "resume",
      instance,
      "--artifact",
      artifactFile(ws, "derive.json", { schema: DERIVE, nonce, derivedFrom: handoff?.digest }),
    ]);
    assert.equal(derived.status, 0, derived.stderr);
    assert.equal(derived.result?.status, "completed");
    const derivedRows = artifactsOf(ws, instance).filter((entry) => entry.step === "derive");
    assert.equal(derivedRows.length, 1);
    assert.equal(derivedRows[0].derived_from, rowsNow[1].digest, "the handoff derives from the accepted v2, not v1");
  } finally {
    dispose(ws);
  }
});

test("a repeated refusal consumes no version and the failure path stays retryable", async () => {
  const ws = workspace();
  try {
    writeRequiringFlow(ws, "architect");
    const { instance, nonce } = await createInstance(ws, "architect", "req-retry-2");
    const refusedPayload = draft(nonce);
    const path = artifactFile(ws, "bad.json", refusedPayload);

    const first = await cli(ws, ["resume", instance, "--artifact", path]);
    assert.equal(failureOf(first).code, "ARTIFACT_INVALID");
    const second = await cli(ws, ["resume", instance, "--artifact", path]);
    assert.equal(failureOf(second).code, "ARTIFACT_INVALID");
    assert.deepEqual(failureOf(second).detail?.missing, ["sources"]);

    const rowsAfterRepeat = artifactsOf(ws, instance);
    assert.deepEqual(rowsAfterRepeat.map((entry) => [entry.version, entry.state]), [[1, "pending"]]);
    assert.equal(instanceRow(ws, instance)?.status, "running");
    const refusalCount = eventsOf(ws, instance).filter(
      (event) => event.type === "gate.verdict" && (event.payload as { decision?: string }).decision === "reject",
    ).length;
    assert.equal(refusalCount, 2, "each refused attempt is its own durable verdict");

    const otherRefusal = await cli(ws, ["resume", instance, "--artifact", artifactFile(ws, "bad-nonce.json", draft("another-nonce-000"))]);
    assert.equal(failureOf(otherRefusal).code, "ARTIFACT_INVALID");
    assert.deepEqual(artifactsOf(ws, instance).map((entry) => [entry.version, entry.state]), [
      [1, "pending"],
      [2, "pending"],
    ]);

    const accepted = await cli(ws, ["resume", instance, "--artifact", artifactFile(ws, "good.json", complete(nonce))]);
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.equal(accepted.result?.status, "running");
    assert.deepEqual(artifactsOf(ws, instance).map((entry) => [entry.version, entry.state]), [
      [1, "pending"],
      [2, "pending"],
      [3, "accepted"],
    ]);
    const refs = accepted.result?.artifacts as Array<{ version: number }>;
    assert.deepEqual(refs.map((ref) => ref.version), [3]);
  } finally {
    dispose(ws);
  }
});