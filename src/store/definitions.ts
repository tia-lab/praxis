/**
 * The pin tables' only owner (spec R3, R4, R5).
 *
 * A `definition` row holds the canonical bytes an instance was started under and the
 * digest of exactly those bytes. `readDefinition` recomputes the digest, so a missing
 * row is `PIN_MISSING` and a mismatching one is `PIN_CORRUPT`. A `publication` row is
 * the durable record that one task path's version was published: it holds a digest,
 * never bytes, and is written at the first pin of that version. The key is the path the
 * flow names plus the version the document declares, so two nested paths that end in the
 * same id stay two publications.
 *
 * The two `insert*` functions are transaction-free by contract: a caller opens the
 * transaction so the pin rows and the instance row commit together (R4).
 */
import { z } from "zod";
import { digest } from "../runner/canonical.ts";
import { fail } from "../types/errors.ts";
import {
  DigestSchema,
  InstanceIdSchema,
  TaskRefSchema,
  TimestampSchema,
  parseWith,
} from "../types/schema.ts";
import { type Store, storeCall } from "./db.ts";

/**
 * `flow` pins the flow document; `task` pins one task version; `assignment` pins the role map;
 * `ruleset` pins the RAW BYTES of one rule-set file a task references (task-rules). The column is text
 * and the key is already (instance, kind, id), so this is no DDL, no table and no schema-version bump.
 */
export const DefinitionKindSchema = z.enum(["flow", "task", "assignment", "ruleset", "profile"]);
export type DefinitionKind = z.infer<typeof DefinitionKindSchema>;

/** One row to write: the flow document, or one task version's canonical bytes. */
export interface DefinitionSeed {
  instance: string;
  kind: DefinitionKind;
  /** The flow path for `flow`; the task path for `task`. */
  id: string;
  digest: string;
  bytes: Uint8Array;
}

/** A pinned unit as the store returns it, verified by `readDefinition`. */
export interface PinnedDefinition {
  digest: string;
  bytes: Uint8Array;
}

const DefinitionRowSchema = z.strictObject({
  instance: InstanceIdSchema,
  kind: DefinitionKindSchema,
  id: z.string().min(1).max(128),
  digest: DigestSchema,
  bytes: z.instanceof(Uint8Array),
});

const PublicationRowSchema = z.strictObject({
  task: TaskRefSchema,
  version: z.int().min(1),
  digest: DigestSchema,
  at: TimestampSchema,
});
export type Publication = z.infer<typeof PublicationRowSchema>;

/** What `insertPublication` records: the version's identity and the digest of its bytes. */
export interface PublicationSeed {
  task: string;
  version: number;
  digest: string;
  at: string;
}

const SELECT_DEFINITION =
  "SELECT instance, kind, id, digest, bytes FROM definition WHERE instance = ? AND kind = ? AND id = ?";
const INSERT_DEFINITION = "INSERT INTO definition(instance, kind, id, digest, bytes) VALUES(?, ?, ?, ?, ?)";
const SELECT_PUBLICATION = "SELECT task, version, digest, at FROM publication WHERE task = ? AND version = ?";
const INSERT_PUBLICATION = "INSERT INTO publication(task, version, digest, at) VALUES(?, ?, ?, ?)";

/**
 * Write one pin row. The digest must describe the bytes it is passed with, so a row
 * that would be corrupt on read is refused before it is written.
 */
export function insertDefinition(store: Store, seed: DefinitionSeed): void {
  const instance = parseWith(InstanceIdSchema, seed.instance, "CONFIG_INVALID", "pinned instance");
  const kind = parseWith(DefinitionKindSchema, seed.kind, "CONFIG_INVALID", "definition kind");
  const id = parseWith(z.string().min(1).max(128), seed.id, "CONFIG_INVALID", "definition id");
  const pinned = parseWith(DigestSchema, seed.digest, "CONFIG_INVALID", "definition digest");
  const bytes = parseWith(z.instanceof(Uint8Array), seed.bytes, "CONFIG_INVALID", "definition bytes");
  const actual = digest(bytes);
  if (actual !== pinned) {
    throw fail("PIN_CORRUPT", `the bytes of ${kind} ${id} do not match the digest they are pinned under`, {
      id,
      pinned,
      actual,
    });
  }
  storeCall("insert a definition row", () => store.db.prepare(INSERT_DEFINITION).run(instance, kind, id, pinned, bytes));
}

/**
 * Read one pin row and verify it. A missing row is `PIN_MISSING` (a broken store); a row
 * whose bytes no longer match its digest is `PIN_CORRUPT` and fails the caller's instance.
 */
export function readDefinition(
  store: Store,
  instance: string,
  kind: DefinitionKind,
  id: string,
): PinnedDefinition {
  const instanceId = parseWith(InstanceIdSchema, instance, "CONFIG_INVALID", "pinned instance");
  const definitionKind = parseWith(DefinitionKindSchema, kind, "CONFIG_INVALID", "definition kind");
  const row = storeCall("read a definition row", () =>
    store.db.prepare(SELECT_DEFINITION).get(instanceId, definitionKind, id),
  );
  if (row === undefined) {
    throw fail("PIN_MISSING", `no pinned ${definitionKind} ${id} for instance ${instanceId}`, {
      instance: instanceId,
      kind: definitionKind,
      id,
    });
  }
  const parsed = parseWith(DefinitionRowSchema, row, "STORE_INVALID", `definition row ${definitionKind} ${id}`);
  const actual = digest(parsed.bytes);
  if (actual !== parsed.digest) {
    throw fail("PIN_CORRUPT", `pinned ${definitionKind} ${id} no longer matches its digest`, {
      id,
      pinned: parsed.digest,
      actual,
    });
  }
  return { digest: parsed.digest, bytes: parsed.bytes };
}

/** Read the publication row for one task version, or `undefined` when never published. */
export function publicationOf(store: Store, task: string, version: number): Publication | undefined {
  const row = storeCall("read a publication row", () => store.db.prepare(SELECT_PUBLICATION).get(task, version));
  if (row === undefined) return undefined;
  return parseWith(PublicationRowSchema, row, "STORE_INVALID", `publication row ${task}@${version}`);
}

/**
 * Record that one task path's version was published, or confirm it already was. A second
 * publication of the same path and version with different bytes is
 * `TASK_VERSION_CONFLICT` and writes nothing; the same digest is idempotent.
 */
export function insertPublication(store: Store, seed: PublicationSeed): Publication {
  const task = parseWith(TaskRefSchema, seed.task, "CONFIG_INVALID", "published task");
  const version = parseWith(z.int().min(1), seed.version, "CONFIG_INVALID", "published version");
  const pinned = parseWith(DigestSchema, seed.digest, "CONFIG_INVALID", "publication digest");
  const at = parseWith(TimestampSchema, seed.at, "CONFIG_INVALID", "publication instant");
  const existing = publicationOf(store, task, version);
  if (existing !== undefined) {
    if (existing.digest !== pinned) {
      throw fail("TASK_VERSION_CONFLICT", `${task}@${version} was published with different bytes`, {
        task,
        version,
        published: existing.digest,
        offered: pinned,
      });
    }
    return existing;
  }
  storeCall("insert a publication row", () => store.db.prepare(INSERT_PUBLICATION).run(task, version, pinned, at));
  return { task, version, digest: pinned, at };
}
