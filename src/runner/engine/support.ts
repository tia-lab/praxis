/**
 * Session plumbing the engine shares: where the store and the library live, one store handle per
 * operation, the pinned timestamp, and the small payload/JSON readers every other module needs.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fail, isAppError } from "../../types/errors.ts";
import { openStore, type Store } from "../../store/db.ts";
import { loadInstance } from "../../store/instance.ts";
import { listEvents } from "../../store/events.ts";
import { ProjectConfigSchema, type ProjectConfig } from "../../types/project.ts";
import type { Instance } from "../../types/schema.ts";
import { EVENT, type EngineOptions } from "./types.ts";

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Store root resolution: the explicit option (the CLI's `--store`), then the environment, then the
 * project config, then the built-in default. The project config sits BELOW the environment on
 * purpose: a checkout can be pointed elsewhere without editing a committed file.
 */
export function storeDirOf(options: EngineOptions): string {
  return resolve(
    options.storeDir ??
      process.env.PRAXIS_STORE_DIR ??
      projectStoreDir(process.cwd()) ??
      join(process.cwd(), ".pi/praxis/state"),
  );
}

/** Task library resolution: explicit, then env, then the project default (spec R1, A4). */
export function tasksDirOf(options: EngineOptions): string {
  return resolve(options.tasksDir ?? process.env.PRAXIS_TASKS_DIR ?? join(process.cwd(), ".pi/praxis/tasks"));
}

/** Rule-set library resolution: explicit, then env, then the project default (task-rules). */
export function profileDirOf(options: EngineOptions): string {
  return resolve(options.profileDir ?? process.env.PRAXIS_PROFILE_DIR ?? join(process.cwd(), ".pi/praxis/profile"));
}

export function rulesDirOf(options: EngineOptions): string {
  return resolve(options.rulesDir ?? process.env.PRAXIS_RULES_DIR ?? join(process.cwd(), ".pi/praxis/rules"));
}

/** Where a project declares its own defaults, relative to the project root. */
export const PROJECT_CONFIG = ".pi/praxis/config.json";

/** Successful parses only, so a file that appears later in the same process is still read. */
const projectConfigs = new Map<string, ProjectConfig>();

/**
 * The project's own defaults, read at most once per process per project root. A missing,
 * unreadable or invalid file yields `undefined` and never an exception: this config is a fallback,
 * and a broken one must degrade to the code default rather than fail every run.
 */
export function projectConfig(cwd: string): ProjectConfig | undefined {
  const path = join(cwd, PROJECT_CONFIG);
  const cached = projectConfigs.get(path);
  if (cached !== undefined) return cached;
  let parsed: ProjectConfig;
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    const result = ProjectConfigSchema.safeParse(raw);
    if (!result.success) return undefined;
    parsed = result.data;
  } catch {
    return undefined;
  }
  projectConfigs.set(path, parsed);
  return parsed;
}

/** The project-wide attempt budget, when it declares one: the last fallback before the constant. */
export function projectMaxAttempts(cwd: string): number | undefined {
  return projectConfig(cwd)?.defaults?.maxAttempts;
}

/** The project's declared store root, when it declares one (never the default, never the env). */
export function projectStoreDir(cwd: string): string | undefined {
  return projectConfig(cwd)?.defaults?.storeDir;
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

/**
 * The order an instance was created with (T2): a pure read of its `instance.created` event.
 *
 * A pre-T2 instance carries no `order` key, so this returns `undefined` rather than throwing - the
 * caller falls back to the task's own goal, which is exactly the behaviour before this slice.
 */
export function orderOf(store: Store, instance: string): string | undefined {
  const event = listEvents(store, instance).find((candidate) => candidate.type === EVENT.instanceCreated);
  if (event === undefined) return undefined;
  const order = payloadOf(event.payload).order;
  return typeof order === "string" ? order : undefined;
}

/** `orderOf` for a caller holding options: opens and CLOSES the store before any jev call runs. */
export function orderFor(options: EngineOptions & { instance: string }): string | undefined {
  return withStore(options, (store) => orderOf(store, options.instance));
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
