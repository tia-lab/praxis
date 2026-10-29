/**
 * The store: one SQLite file in WAL with `synchronous = FULL` (spec R3, R6; plan "Store schema").
 *
 * The schema is exact and STRICT. `event` is append-only by trigger, so an UPDATE or
 * DELETE aborts in the database itself, not only in review. `instance` is the only
 * mutable row and every write to it is guarded by `revision` (see ./instance.ts).
 *
 * Limit, stated plainly: WAL plus `synchronous = FULL` is tested against process death,
 * not against power loss, and nothing here is a durability proof beyond that.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { asAppError, fail, isAppError, type AppError } from "../types/errors.ts";

/** The store's own schema identity, pinned in `meta` so a stale file fails closed. */
export const STORE_SCHEMA = "praxis.store/v2";

const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS meta (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   ) STRICT`,
  `CREATE TABLE IF NOT EXISTS instance (
     id TEXT PRIMARY KEY,
     flow TEXT NOT NULL,
     actor TEXT NOT NULL,
     status TEXT NOT NULL,
     current_step TEXT,
     revision INTEGER NOT NULL,
     nonce TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   ) STRICT`,
  `CREATE TABLE IF NOT EXISTS event (
     instance TEXT NOT NULL REFERENCES instance(id),
     seq INTEGER NOT NULL,
     type TEXT NOT NULL,
     payload TEXT NOT NULL,
     at TEXT NOT NULL,
     PRIMARY KEY (instance, seq)
   ) STRICT`,
  `CREATE TABLE IF NOT EXISTS artifact (
     instance TEXT NOT NULL REFERENCES instance(id),
     step TEXT NOT NULL,
     version INTEGER NOT NULL,
     path TEXT NOT NULL,
     digest TEXT NOT NULL,
     schema TEXT NOT NULL,
     state TEXT NOT NULL,
     derived_from TEXT,
     at TEXT NOT NULL,
     PRIMARY KEY (instance, step, version)
   ) STRICT`,
  // The pins: one row per composed unit plus the flow, in the caller's transaction (R4).
  `CREATE TABLE IF NOT EXISTS definition (
     instance TEXT NOT NULL REFERENCES instance(id),
     kind TEXT NOT NULL,
     id TEXT NOT NULL,
     digest TEXT NOT NULL,
     bytes BLOB NOT NULL,
     PRIMARY KEY (instance, kind, id)
   ) STRICT`,
  // The durable publication record per task version; a digest, never bytes (R3).
  `CREATE TABLE IF NOT EXISTS publication (
     task TEXT NOT NULL,
     version INTEGER NOT NULL,
     digest TEXT NOT NULL,
     at TEXT NOT NULL,
     PRIMARY KEY (task, version)
   ) STRICT`,
  // History is append-only in the database, not merely by convention (R3).
  `CREATE TRIGGER IF NOT EXISTS event_append_only_update BEFORE UPDATE ON event
     BEGIN SELECT RAISE(ABORT, 'event rows are append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS event_append_only_delete BEFORE DELETE ON event
     BEGIN SELECT RAISE(ABORT, 'event rows are append-only'); END`,
];

/** An open store handle. `db` is exposed so a caller can read pragmas or count rows. */
export interface Store {
  readonly db: DatabaseSync;
  close(): void;
}

/** Wrap any non-typed failure from a statement call in a typed, diagnosable error. */
export function storeFailure(what: string, error: unknown): AppError {
  return fail("STORE_INVALID", `store operation failed: ${what}`, { cause: asAppError(error).message });
}

/** Run one statement call, preserving an AppError and typing anything else. */
export function storeCall<T>(what: string, statement: () => T): T {
  try {
    return statement();
  } catch (error) {
    throw isAppError(error) ? error : storeFailure(what, error);
  }
}

/**
 * Run `body` in one immediate transaction. A typed failure rolls back and re-throws
 * unchanged, so a refused write leaves no rows behind.
 */
export function transact<T>(store: Store, body: () => T): T {
  storeCall("begin a transaction", () => store.db.exec("BEGIN IMMEDIATE"));
  let result: T;
  try {
    result = body();
  } catch (error) {
    try {
      store.db.exec("ROLLBACK");
    } catch (rollbackError) {
      throw fail("STORE_INVALID", "transaction failed and could not be rolled back", {
        failure: asAppError(error).message,
        rollback: asAppError(rollbackError).message,
      });
    }
    throw isAppError(error) ? error : storeFailure("transaction body", error);
  }
  storeCall("commit a transaction", () => store.db.exec("COMMIT"));
  return result;
}

/** Open (or create) the store, apply the pragmas and the schema, and check its identity. */
export function openStore(path: string): Store {
  if (path !== ":memory:") {
    try {
      mkdirSync(dirname(path), { recursive: true });
    } catch (error) {
      throw storeFailure(`create the store directory for ${path}`, error);
    }
  }

  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path);
  } catch (error) {
    throw storeFailure(`open ${path}`, error);
  }

  const store: Store = {
    db,
    close() {
      storeCall("close the store", () => db.close());
    },
  };

  try {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = FULL");
    db.exec("PRAGMA busy_timeout = 5000");
    for (const statement of SCHEMA_STATEMENTS) db.exec(statement);
    db.prepare("INSERT INTO meta(key, value) VALUES('schema', ?) ON CONFLICT(key) DO NOTHING").run(STORE_SCHEMA);
    const row = db.prepare("SELECT value FROM meta WHERE key = 'schema'").get() as { value?: string } | undefined;
    if (row?.value !== STORE_SCHEMA) {
      throw fail("STORE_INVALID", `store schema mismatch at ${path}`, { found: row?.value ?? null, expected: STORE_SCHEMA });
    }
  } catch (error) {
    const failure = isAppError(error) ? error : storeFailure(`initialise ${path}`, error);
    try {
      db.close();
    } catch (closeError) {
      throw fail("STORE_INVALID", `store setup failed at ${path} and the handle could not be closed`, {
        setup: failure.message,
        close: asAppError(closeError).message,
      });
    }
    throw failure;
  }

  return store;
}
