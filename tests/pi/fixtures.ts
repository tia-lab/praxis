/**
 * Pi-tool fixtures (claim D): the `v2` flow document, the task units it composes, the
 * gate-shaped payloads, fake session contexts, a temp project/store and a pending-artifact
 * seed. Helpers and data only — no test cases. The five runtime exports are exactly what
 * plan step 1 checks: `config, artifacts, fakeContext, pendingArtifact, tempStore`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { FlowConfig, TaskConfig } from "../../src/types/schema.ts";
import type { PiSessionContext } from "../../src/pi/host.ts";
import { canonicalBytes, digest, digestOf } from "../../src/runner/canonical.ts";
import { instanceIdFor } from "../../src/runner/engine/index.ts";
import { actorFor, setAlignJudgeForTest } from "../../src/pi/tool.ts";
import type { AlignJudge } from "../../src/quality/jev-align.ts";
import { openStore } from "../../src/store/db.ts";
import { createInstance } from "../../src/store/instance.ts";
import { recordArtifact } from "../../src/store/artifacts.ts";
import { insertDefinition, insertPublication } from "../../src/store/definitions.ts";

/** The task units the fixture flow composes, published so a pin may take them. */
export const tasks: readonly TaskConfig[] = [
  {
    id: "draft",
    version: 1,
    state: "published",
    goal: "write the architecture draft",
    capabilities: ["artifact.write", "emit"],
    produces: { schema: "praxis.artifact.architecture/v1" },
    gate: "schema-valid-and-nonce",
  },
  {
    id: "derive",
    version: 1,
    state: "published",
    goal: "derive the next artifact from the draft",
    capabilities: ["artifact.read", "artifact.write", "emit"],
    produces: { schema: "praxis.artifact.derive/v1" },
    gate: "schema-valid-and-nonce",
  },
];

/** The accepted flow, copied so a fixture never reads the project's own config. */
export const config = {
  schema: "praxis.flow/v2",
  flow: "flows/architect",
  nodes: [
    { id: "draft", task: "tasks/draft" },
    { id: "derive", task: "tasks/derive" },
  ],
  edges: [{ kind: "data", from: "draft", to: "derive" }],
  result: "praxis.result/v1",
} satisfies FlowConfig;

const WRONG_DIGEST = "sha256:" + "0".repeat(64);
const DEFAULT_SESSION = "session-alpha";
const NOW = "2026-10-29T12:00:00.000Z";

/** Gate-shaped payloads; each takes the nonce the engine pinned for the instance. */
export const artifacts = {
  validA: (nonce: string) => ({ schema: "praxis.artifact.architecture/v1", nonce, claim: "draft artifact" }),
  validB: (nonce: string, derivedFrom: string) => ({ schema: "praxis.artifact.derive/v1", nonce, derivedFrom, claim: "derive artifact" }),
  wrongDerivedFromB: (nonce: string) => ({ schema: "praxis.artifact.derive/v1", nonce, derivedFrom: WRONG_DIGEST, claim: "wrong derivation" }),
  missingNonceA: () => ({ schema: "praxis.artifact.architecture/v1", claim: "no nonce" }),
};

/**
 * A fake alignment judge: no model call, no network. `aligned` is what most tests want, because an
 * aligned start must look exactly like a pre-unit start; the alignment tests install their own.
 */
export function fakeAlignJudge(decision: "aligned" | "misaligned" = "aligned", reason = "fake align judge"): AlignJudge {
  return {
    async judge({ order }) {
      return { decision, reason, model: "fake-align/v1", orderDigest: digest(order) };
    },
  };
}

/** Install the aligned fake for a whole test file, so no start reaches the real judge. */
export function useAlignedJudge(): void {
  setAlignJudgeForTest(fakeAlignJudge("aligned"));
}

export interface FakeContextOptions {
  cwd: string;
  /** Defaults to `session-alpha`; `null` omits the session manager entirely. */
  sessionId?: string | null;
}

/** A host context: cwd drives the engine paths, sessionId drives the actor label. */
export function fakeContext(options: FakeContextOptions): PiSessionContext {
  const sessionId = options.sessionId === undefined ? DEFAULT_SESSION : options.sessionId;
  if (sessionId === null) return { cwd: options.cwd };
  return { cwd: options.cwd, sessionManager: { getSessionId: () => sessionId } };
}

export interface TempStore {
  /** Project root the tool resolves `.pi/praxis/...` under. */
  cwd: string;
  configPath: string;
  storeDir: string;
  tasksDir: string;
  dispose(): void;
}

/**
 * The fixture tasks with a required quality floor on `draft` (quality loop): the rubric the agent
 * must see before it submits, and the floor each injected fake scorer is measured against. Same
 * ids as `tasks`, so the accepted fixture flow document composes them unchanged.
 */
export const qualityTasks: readonly TaskConfig[] = [
  {
    id: "draft",
    version: 1,
    state: "published",
    goal: "write the architecture draft",
    capabilities: ["artifact.write", "emit", "evaluate"],
    produces: { schema: "praxis.artifact.architecture/v1" },
    gate: "schema-valid-and-nonce",
    quality: {
      dimensions: [
        { id: "solves", statement: "the draft answers the stated goal" },
        { id: "evidence", statement: "every claim carries evidence" },
      ],
      threshold: 0.6,
      policy: "required",
    },
  },
  {
    id: "derive",
    version: 1,
    state: "published",
    goal: "derive the next artifact from the draft",
    capabilities: ["artifact.read", "artifact.write", "emit"],
    produces: { schema: "praxis.artifact.derive/v1" },
    gate: "schema-valid-and-nonce",
  },
];

/**
 * The same fixture tasks with the floor set to `escalate`, so a test can prove the halting policy
 * at the tool surface; `qualityTasks` keeps the default `continue`.
 */
export const escalateTasks: readonly TaskConfig[] = qualityTasks.map((task) =>
  task.quality === undefined ? task : { ...task, quality: { ...task.quality, onFailure: "escalate" as const } },
);

/** A throwaway project root with the default flow document, its task units and a store. */
export function tempStore(overrides: { config?: unknown; raw?: string; tasks?: readonly TaskConfig[] } = {}): TempStore {
  const cwd = mkdtempSync(join(tmpdir(), "praxis-pi-"));
  const configPath = join(cwd, ".pi", "praxis", "flows", "engineering", "feature.json");
  const storeDir = join(cwd, ".pi", "praxis", "state");
  const tasksDir = join(cwd, ".pi", "praxis", "tasks");
  mkdirSync(dirname(configPath), { recursive: true });
  mkdirSync(tasksDir, { recursive: true });
  mkdirSync(join(storeDir, "artifacts"), { recursive: true });
  writeFileSync(configPath, overrides.raw ?? JSON.stringify(overrides.config ?? config, null, 2) + "\n");
  for (const task of overrides.tasks ?? tasks) {
    writeFileSync(join(tasksDir, `${task.id}.json`), JSON.stringify(task, null, 2) + "\n");
  }
  return { cwd, configPath, storeDir, tasksDir, dispose: () => rmSync(cwd, { recursive: true, force: true }) };
}

export interface PendingSeed {
  instance: string;
  nonce: string;
  step: string;
  version: number;
  digest: string;
}

function schemaFor(step: string): string {
  const node = config.nodes.find((candidate) => candidate.id === step);
  if (node === undefined) throw new Error("no step " + JSON.stringify(step) + " in the fixture flow");
  const task = tasks.find((candidate) => "tasks/" + candidate.id === node.task);
  if (task === undefined) throw new Error("no task " + node.task + " in the fixture library");
  return task.produces.schema;
}

function newNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Seed a running instance at `step` with one `pending` artifact version through the
 * store API the engine uses (P15), including the pins `start` would have written, so a
 * later `submit` reads pinned definitions rather than the library. The actor label comes
 * from `actorFor`, so a later `start` with the same request id and session re-opens this
 * instance rather than conflicting.
 */
export function pendingArtifact(
  store: TempStore,
  options: { requestId?: string; sessionId?: string; step?: string; payload?: (nonce: string) => unknown } = {},
): PendingSeed {
  const step = options.step ?? "draft";
  const requestId = options.requestId ?? "pi-pending-1";
  const sessionId = options.sessionId ?? DEFAULT_SESSION;
  const nonce = newNonce();
  const value = options.payload === undefined ? artifacts.validA(nonce) : options.payload(nonce);
  const bytes = canonicalBytes(value);
  const digestOfBytes = digest(bytes);
  const instance = instanceIdFor(config.flow, requestId);
  const path = join(store.storeDir, "artifacts", instance, step, "v1.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);

  const db = openStore(join(store.storeDir, "praxis.sqlite"));
  try {
    createInstance(db, {
      id: instance,
      flow: config.flow,
      actor: actorFor(fakeContext({ cwd: store.cwd, sessionId })),
      status: "running",
      currentStep: step,
      nonce,
      now: NOW,
    });
    insertDefinition(db, {
      instance,
      kind: "flow",
      id: config.flow,
      digest: digestOf(config),
      bytes: canonicalBytes(config),
    });
    for (const task of tasks) {
      const taskBytes = canonicalBytes(task);
      insertDefinition(db, {
        instance,
        kind: "task",
        id: "tasks/" + task.id,
        digest: digest(taskBytes),
        bytes: taskBytes,
      });
      insertPublication(db, { task: "tasks/" + task.id, version: task.version, digest: digest(taskBytes), at: NOW });
    }
    recordArtifact(db, { instance, step, version: 1, path, digest: digestOfBytes, schema: schemaFor(step), derivedFrom: null, at: NOW });
  } finally {
    db.close();
  }
  return { instance, nonce, step, version: 1, digest: digestOfBytes };
}
