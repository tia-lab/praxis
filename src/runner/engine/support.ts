/**
 * Session plumbing the engine shares: where the store and the library live, one store handle per
 * operation, the pinned timestamp, and the small payload/JSON readers every other module needs.
 */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fail, isAppError } from "../../types/errors.ts";
import { openStore, type Store } from "../../store/db.ts";
import { loadInstance } from "../../store/instance.ts";
import type { Instance } from "../../types/schema.ts";
import type { EngineOptions } from "./types.ts";

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Store root resolution: explicit, then env, then the project default. */
export function storeDirOf(options: EngineOptions): string {
  return resolve(
    options.storeDir ?? process.env.PRAXIS_STORE_DIR ?? join(process.cwd(), ".pi/praxis/state"),
  );
}

/** Task library resolution: explicit, then env, then the project default (spec R1, A4). */
export function tasksDirOf(options: EngineOptions): string {
  return resolve(options.tasksDir ?? process.env.PRAXIS_TASKS_DIR ?? join(process.cwd(), ".pi/praxis/tasks"));
}

export function withStore<T>(options: EngineOptions, body: (store: Store, storeDir: string) => T): T {
  const storeDir = storeDirOf(options);
  mkdirSync(join(storeDir, "artifacts"), { recursive: true });
  const store = openStore(join(storeDir, "praxis.sqlite"));
  try {
    return body(store, storeDir);
  } finally {
    store.close();
  }
}

export function nonceFor(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function stamp(options: EngineOptions): string {
  return options.now ?? new Date().toISOString();
}

export function payloadOf(payload: unknown): Record<string, unknown> {
  if (typeof payload === "object" && payload !== null) return payload as Record<string, unknown>;
  return {};
}

export function loadExisting(store: Store, id: string): Instance | undefined {
  try {
    return loadInstance(store, id);
  } catch (error) {
    if (isAppError(error) && error.code === "INSTANCE_NOT_FOUND") return undefined;
    throw error;
  }
}

/** Parse pinned bytes as JSON, treating unparseable pin content as `PIN_CORRUPT`. */
export function pinnedJson(bytes: Uint8Array, what: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch (error) {
    throw fail("PIN_CORRUPT", `pinned ${what} is not JSON`, { reason: messageOf(error) });
  }
}
