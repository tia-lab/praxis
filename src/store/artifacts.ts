/**
 * Artifact rows and their bytes (spec R4, R5, R10).
 *
 * Three rules hold here and nowhere else:
 *  - a recorded version is never rewritten: a duplicate `(instance, step, version)` is
 *    `ARTIFACT_VERSION_CONFLICT`, and only the state column may change afterwards;
 *  - bytes are verified against the recorded digest at write, read and acceptance, so a
 *    corrupted file fails closed before any dispatch;
 *  - `acceptArtifact` is the single transition out of `pending`, so a caller cannot
 *    declare its own artifact accepted (the gate owns that decision).
 *
 * `at` is the timestamp of the row's current state; the event log keeps the timeline.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import { type Store, storeCall, transact } from "./db.ts";
import { digest } from "../runner/canonical.ts";
import { asAppError, fail } from "../types/errors.ts";
import {
  ArtifactStateSchema,
  DigestSchema,
  InstanceIdSchema,
  SchemaNameSchema,
  StepIdSchema,
  TimestampSchema,
  parseWith,
  type Artifact,
} from "../types/schema.ts";

/** The row as SQLite returns it (plan "Store schema"). */
const ArtifactRowSchema = z.strictObject({
  instance: InstanceIdSchema,
  step: StepIdSchema,
  version: z.int().min(1),
  path: z.string().min(1),
  digest: DigestSchema,
  schema: SchemaNameSchema,
  state: ArtifactStateSchema,
  derived_from: DigestSchema.nullable(),
  at: TimestampSchema,
});

const RecordSchema = z.strictObject({
  instance: InstanceIdSchema,
  step: StepIdSchema,
  version: z.int().min(1),
  path: z.string().min(1).max(4096),
  digest: DigestSchema,
  schema: SchemaNameSchema,
  state: ArtifactStateSchema.default("pending"),
  derivedFrom: DigestSchema.nullable().default(null),
  at: TimestampSchema,
});

const SELECT_ROW =
  "SELECT instance, step, version, path, digest, schema, state, derived_from, at FROM artifact WHERE instance = ? AND step = ?";

const INSERT_ROW =
  "INSERT INTO artifact(instance, step, version, path, digest, schema, state, derived_from, at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)";

const ACCEPT_ROW =
  "UPDATE artifact SET state = 'accepted', at = ? WHERE instance = ? AND step = ? AND version = ? AND state = 'pending'";

export interface RecordArtifactInput {
  instance: string;
  step: string;
  version: number;
  path: string;
  digest: string;
  schema: string;
  state?: "pending" | "accepted";
  derivedFrom?: string | null;
  at: string;
}

/** Artifact plus the exact bytes those bytes' digest was taken over. */
export interface ArtifactRead {
  artifact: Artifact;
  bytes: Uint8Array;
}

function toArtifact(row: unknown, what: string): Artifact {
  const parsed = parseWith(ArtifactRowSchema, row, "ARTIFACT_INVALID", what);
  return {
    instance: parsed.instance,
    step: parsed.step,
    version: parsed.version,
    path: parsed.path,
    digest: parsed.digest,
    schema: parsed.schema,
    state: parsed.state,
    derivedFrom: parsed.derived_from,
    at: parsed.at,
  };
}

function find(store: Store, instance: string, step: string, version?: number): Artifact | undefined {
  const row =
    version === undefined
      ? storeCall("read the latest artifact", () =>
          store.db.prepare(`${SELECT_ROW} ORDER BY version DESC LIMIT 1`).get(instance, step),
        )
      : storeCall("read one artifact", () =>
          store.db.prepare(`${SELECT_ROW} AND version = ?`).get(instance, step, version),
        );
  if (row === undefined) return undefined;
  return toArtifact(row, `artifact row ${step}@${version ?? "latest"}`);
}

function requireArtifact(store: Store, instance: string, step: string, version: number): Artifact {
  const found = find(store, instance, step, version);
  if (found === undefined) {
    throw fail("ARTIFACT_UNAVAILABLE", `no artifact ${step} v${version} for ${instance}`, { instance, step, version });
  }
  return found;
}

function readBytes(path: string, detail: Record<string, unknown>): Uint8Array {
  try {
    return readFileSync(path);
  } catch (error) {
    throw fail("ARTIFACT_UNAVAILABLE", `artifact bytes are unreadable: ${path}`, {
      ...detail,
      path,
      cause: asAppError(error).message,
    });
  }
}

function verifiedBytes(artifact: Artifact): Uint8Array {
  const bytes = readBytes(artifact.path, {
    instance: artifact.instance,
    step: artifact.step,
    version: artifact.version,
  });
  const observed = digest(bytes);
  if (observed !== artifact.digest) {
    throw fail("ARTIFACT_DIGEST_MISMATCH", "artifact bytes no longer match the recorded digest", {
      artifact: `${artifact.step}@${artifact.version}`,
      recorded: artifact.digest,
      observed,
    });
  }
  return bytes;
}

/** Record a pending version after confirming the bytes on disk match the digest. */
export function recordArtifact(store: Store, input: RecordArtifactInput): Artifact {
  const record = parseWith(RecordSchema, input, "ARTIFACT_INVALID", "artifact record");
  if (record.state !== "pending") {
    throw fail("ARTIFACT_STATE_INVALID", "a recorded artifact starts pending; acceptance is its own verified transition", {
      instance: record.instance,
      step: record.step,
      version: record.version,
      state: record.state,
    });
  }
  const bytes = readBytes(record.path, { instance: record.instance, step: record.step, version: record.version });
  const observed = digest(bytes);
  if (observed !== record.digest) {
    throw fail("ARTIFACT_DIGEST_MISMATCH", `bytes at ${record.path} do not match the digest being recorded`, {
      recorded: record.digest,
      observed,
    });
  }

  return transact(store, () => {
    const existing = find(store, record.instance, record.step, record.version);
    if (existing !== undefined) {
      throw fail("ARTIFACT_VERSION_CONFLICT", `artifact ${record.step} v${record.version} is already recorded`, {
        instance: record.instance,
        state: existing.state,
        digest: existing.digest,
      });
    }
    storeCall("record an artifact", () =>
      store.db
        .prepare(INSERT_ROW)
        .run(
          record.instance,
          record.step,
          record.version,
          record.path,
          record.digest,
          record.schema,
          record.state,
          record.derivedFrom,
          record.at,
        ),
    );
    return requireArtifact(store, record.instance, record.step, record.version);
  });
}

/** Read the newest version (or the named one) and verify its bytes before returning them. */
export function readArtifact(store: Store, instance: string, step: string, version?: number): ArtifactRead {
  const instanceId = parseWith(InstanceIdSchema, instance, "CONFIG_INVALID", "instance id");
  const stepId = parseWith(StepIdSchema, step, "CONFIG_INVALID", "step id");
  const wanted = version === undefined ? undefined : parseWith(z.int().min(1), version, "ARTIFACT_INVALID", "artifact version");
  const artifact = find(store, instanceId, stepId, wanted);
  if (artifact === undefined) {
    throw fail("ARTIFACT_UNAVAILABLE", `no artifact ${stepId} for ${instanceId}`, {
      instance: instanceId,
      step: stepId,
      version: wanted ?? null,
    });
  }
  return { artifact, bytes: verifiedBytes(artifact) };
}

/**
 * Accept a recorded version after re-verifying its bytes. Repeating an acceptance is a
 * no-op, so a resumed process writes nothing twice (spec R6, P9).
 */
export function acceptArtifact(store: Store, instance: string, step: string, version: number, at: string): Artifact {
  const instanceId = parseWith(InstanceIdSchema, instance, "CONFIG_INVALID", "instance id");
  const stepId = parseWith(StepIdSchema, step, "CONFIG_INVALID", "step id");
  const wanted = parseWith(z.int().min(1), version, "ARTIFACT_INVALID", "artifact version");
  const acceptedAt = parseWith(TimestampSchema, at, "ARTIFACT_INVALID", "acceptance timestamp");

  return transact(store, () => {
    const current = requireArtifact(store, instanceId, stepId, wanted);
    verifiedBytes(current);
    if (current.state === "accepted") return current;
    const info = storeCall("accept an artifact", () =>
      store.db.prepare(ACCEPT_ROW).run(acceptedAt, instanceId, stepId, wanted),
    );
    if (Number(info.changes) !== 1) {
      throw fail("ARTIFACT_STATE_INVALID", `artifact ${stepId} v${wanted} could not be accepted`, {
        instance: instanceId,
        state: current.state,
      });
    }
    return requireArtifact(store, instanceId, stepId, wanted);
  });
}
