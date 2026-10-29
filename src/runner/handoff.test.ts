import assert from "node:assert/strict";
import { test } from "node:test";
import {
  artifactsOf,
  artifactFile,
  cli,
  cliKilledAtStepStart,
  createInstance,
  dispose,
  eventsOf,
  instanceRow,
  MAIN_STEPS,
  workspace,
  writeFlow,
} from "./testkit.ts";

interface Ref {
  step: string;
  version: number;
  digest: string;
  schema: string;
}

function refs(run: { result?: Record<string, unknown> }): Ref[] {
  const artifacts = run.result?.artifacts;
  return Array.isArray(artifacts) ? (artifacts as Ref[]) : [];
}

function traces(ws: ReturnType<typeof workspace>, instance: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const event of eventsOf(ws, instance)) {
    if (event.type !== "step.trace") continue;
    const payload = event.payload as { step: string; calls: string[] };
    found.set(payload.step, payload.calls);
  }
  return found;
}

/**
 * P3: the two phases are two OS processes, and the second one touches only the
 * artifact capabilities. Nothing here is an isolation claim: the processes share
 * the filesystem, and gate #1 stays open.
 */
test("P3: draft and derive are distinct PIDs and derive's trace holds only artifact capabilities", async () => {
  const ws = workspace();
  try {
    writeFlow(ws, "architect", MAIN_STEPS);
    const { instance, nonce } = await createInstance(ws, "architect", "req-p3");

    const draftPayload = {
      schema: "praxis.artifact.architecture/v1",
      nonce,
      architecture: { phases: 2, note: "canonical form, sorted keys" },
    };
    const draft = await cli(ws, ["resume", instance, "--artifact", artifactFile(ws, "draft.json", draftPayload)]);
    assert.equal(draft.status, 0, draft.stderr);
    const draftRefs = refs(draft);
    assert.equal(draftRefs.length, 1, "phase A accepted exactly one artifact");
    assert.equal(draftRefs[0].step, "draft");
    assert.match(draftRefs[0].digest, /^sha256:[0-9a-f]{64}$/);
    assert.equal(draft.result?.status, "running");

    const derivePayload = {
      schema: "praxis.artifact.derive/v1",
      nonce,
      derivedFrom: draftRefs[0].digest,
      derived: { phases: ["draft", "derive"], bounded: true },
    };
    const derive = await cli(ws, ["resume", instance, "--artifact", artifactFile(ws, "derive.json", derivePayload)]);
    assert.equal(derive.status, 0, derive.stderr);

    // Distinct processes: neither phase shares a PID with the test or with each other.
    assert.equal(typeof draft.pid, "number");
    assert.equal(typeof derive.pid, "number");
    assert.notEqual(draft.pid, derive.pid, "phase A and phase B must not be the same process");
    assert.notEqual(draft.pid, process.pid);
    assert.notEqual(derive.pid, process.pid);

    const deriveRefs = refs(derive);
    assert.equal(deriveRefs.length, 2);
    assert.equal(derive.result?.status, "completed");

    const traced = traces(ws, instance);
    assert.deepEqual(traced.get("draft"), ["artifact.write"]);
    assert.deepEqual(traced.get("derive"), ["artifact.read", "artifact.write"]);
    for (const calls of traced.values()) {
      for (const entry of calls) assert.match(entry, /^artifact\.(read|write)$/);
    }

    const rows = artifactsOf(ws, instance);
    assert.equal(rows.length, 2);
    for (const row of rows) assert.equal(row.state, "accepted");
    const deriveRow = rows.find((row) => row.step === "derive");
    assert.equal(deriveRow?.derived_from, draftRefs[0].digest, "R8: derive records what it consumed");
    assert.equal(deriveRow?.version, 1);

    // The accepted verdict precedes B: the verdict event has a lower seq than B's artifact.
    const events = eventsOf(ws, instance);
    const acceptedDraft = events.find(
      (event) => event.type === "gate.verdict" && (event.payload as { step: string; decision: string }).step === "draft",
    );
    const acceptedDerive = events.find(
      (event) => event.type === "gate.verdict" && (event.payload as { step: string; decision: string }).step === "derive",
    );
    assert.equal((acceptedDraft?.payload as { decision: string }).decision, "accept");
    assert.equal((acceptedDerive?.payload as { decision: string }).decision, "accept");
    assert.ok(Number(acceptedDraft?.seq) < Number(acceptedDerive?.seq));
  } finally {
    dispose(ws);
  }
});

/**
 * P8: a real SIGKILL while phase B is running. The claim is durable invariant, not
 * kill-point precision: after the retry there is exactly one artifact row per step,
 * the recorded digest is unchanged, and the step pointer never moved backwards.
 */
test("P8: a SIGKILL between phases keeps the same step and digest with no duplicate artifact row", async () => {
  const ws = workspace();
  try {
    writeFlow(ws, "architect", MAIN_STEPS);
    const { instance, nonce } = await createInstance(ws, "architect", "req-p8");

    const draftPayload = { schema: "praxis.artifact.architecture/v1", nonce, architecture: { phases: 2 } };
    const draft = await cli(ws, ["resume", instance, "--artifact", artifactFile(ws, "draft.json", draftPayload)]);
    assert.equal(draft.status, 0, draft.stderr);
    const draftDigest = refs(draft)[0].digest;

    // A large payload widens the window between dispatch and commit, so the kill
    // lands inside phase B rather than after it.
    const derivePayload = {
      schema: "praxis.artifact.derive/v1",
      nonce,
      derivedFrom: draftDigest,
      padding: "x".repeat(200_000),
    };
    const deriveFile = artifactFile(ws, "derive.json", derivePayload);

    const beforeRetryAt = instanceRow(ws, instance);
    assert.equal(beforeRetryAt?.current_step, "derive", "phase A left the pointer at derive");

    const killed = await cliKilledAtStepStart(ws, ["resume", instance, "--artifact", deriveFile]);
    assert.equal(killed.signal, "SIGKILL", "the process must die by signal, not by finishing");
    assert.equal(killed.result, undefined, "a killed process must not report a result");

    const afterKill = instanceRow(ws, instance);
    assert.equal(afterKill?.current_step, "derive", "the step pointer survives the death unchanged");
    assert.equal(afterKill?.config_digest, beforeRetryAt?.config_digest);

    const retry = await cli(ws, ["resume", instance, "--artifact", deriveFile]);
    assert.equal(retry.status, 0, retry.stderr);
    assert.equal(retry.result?.status, "completed");

    const rows = artifactsOf(ws, instance);
    assert.equal(rows.length, 2, "one artifact row per step: the retry must not duplicate a row");
    const deriveRows = rows.filter((row) => row.step === "derive");
    assert.equal(deriveRows.length, 1);
    assert.equal(deriveRows[0].version, 1);
    assert.equal(deriveRows[0].digest, refs(retry).find((ref) => ref.step === "derive")?.digest);
    assert.equal(deriveRows[0].derived_from, draftDigest, "the accepted digest of A is preserved across the crash");

    const events = eventsOf(ws, instance);
    const seqs = events.map((event) => Number(event.seq));
    assert.deepEqual(seqs, seqs.map((_, index) => index + 1), "event seq is contiguous: nothing was duplicated or lost");
  } finally {
    dispose(ws);
  }
});
