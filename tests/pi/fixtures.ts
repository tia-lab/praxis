/**
 * Pi-tool fixtures (claim D): flow config, artifact payloads, fake session contexts, a
 * temp store and a pending-artifact seed. Helpers and data only — no test cases; those
 * are claim C. The five runtime exports are exactly what plan step 1 checks:
 * `config, artifacts, fakeContext, pendingArtifact, tempStore`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { FlowConfig } from "../../src/types/schema.ts";
import type { PiSessionContext } from "../../src/pi/host.ts";
import { canonicalBytes, digest, digestOf } from "../../src/runner/canonical.ts";
import { instanceIdFor } from "../../src/runner/engine.ts";
import { actorFor } from "../../src/pi/tool.ts";
import { openStore } from "../../src/store/db.ts";
import { createInstance } from "../../src/store/instance.ts";
import { recordArtifact } from "../../src/store/artifacts.ts";

/** The accepted flow, copied so a fixture never reads the project's own config. */
export const config = {
  schema: "praxis.config/v1",
  flow: "architect",
  steps: [
    { id: "draft", capabilities: ["artifact.write", "emit"], produces: { schema: "praxis.artifact.architecture/v1" }, gate: "schema-valid-and-nonce" },
    { id: "derive", capabilities: ["artifact.read", "artifact.write", "emit"], consumes: "draft", produces: { schema: "praxis.artifact.derive/v1" }, gate: "schema-valid-and-nonce" },
  ],
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
  dispose(): void;
}

/** A throwaway project root with a flow config and an empty store directory. */
export function tempStore(overrides: { config?: unknown; raw?: string } = {}): TempStore {
  const cwd = mkdtempSync(join(tmpdir(), "praxis-pi-"));
  const configPath = join(cwd, ".pi", "praxis", "config.json");
  const storeDir = join(cwd, ".pi", "praxis", "state");
  mkdirSync(join(cwd, ".pi", "praxis"), { recursive: true });
  mkdirSync(join(storeDir, "artifacts"), { recursive: true });
  writeFileSync(configPath, overrides.raw ?? JSON.stringify(overrides.config ?? config, null, 2) + "\n");
  return { cwd, configPath, storeDir, dispose: () => rmSync(cwd, { recursive: true, force: true }) };
}

export interface PendingSeed {
  instance: string;
  nonce: string;
  step: string;
  version: number;
  digest: string;
}

function schemaOf(step: string): string {
  const found = config.steps.find((candidate) => candidate.id === step);
  if (found === undefined) throw new Error("no step " + JSON.stringify(step) + " in the fixture flow");
  return found.produces.schema;
}

function newNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Seed a running instance at `step` with one `pending` artifact version through the
 * store API the engine uses (P15). The actor label comes from `actorFor`, so a later
 * `start` with the same request id and session re-opens this instance rather than
 * conflicting, and a `submit` with the same payload reuses version 1.
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
      configDigest: digestOf(config),
      status: "running",
      currentStep: step,
      nonce,
      now: NOW,
    });
    recordArtifact(db, { instance, step, version: 1, path, digest: digestOfBytes, schema: schemaOf(step), derivedFrom: null, at: NOW });
  } finally {
    db.close();
  }
  return { instance, nonce, step, version: 1, digest: digestOfBytes };
}
