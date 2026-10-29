/**
 * The step engine: start an instance, advance exactly one step per invocation,
 * record a verdict, hand off a reference (R5, R6, R8, R9, R10).
 *
 * Invariants this file owns:
 * - the flow is data, loaded from disk and pinned by digest on the instance;
 * - a step runs only under its own grant and every capability call is traced;
 * - the gate is deterministic and its verdict is a durable event;
 * - a consuming step receives {artifactRef, digest, path, schema} and nothing else;
 * - bytes are verified against the recorded digest before any dispatch.
 *
 * Limit, stated plainly: artifact files are written and read by this process with
 * ordinary filesystem calls. The capability checks gate the step body, not the OS;
 * gate #1 (isolation) stays open.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { fail, isAppError } from "../types/errors.ts";
import {
  parseFlowConfig,
  type Artifact,
  type ArtifactRef,
  type FlowConfig,
  type Instance,
  type Result,
  type StepConfig,
} from "../types/schema.ts";
import { openStore, type Store } from "../store/db.ts";
import { createInstance, loadInstance, setStatus } from "../store/instance.ts";
import { appendEvent, listEvents } from "../store/events.ts";
import { acceptArtifact, readArtifact, recordArtifact } from "../store/artifacts.ts";
import { call, grantFor, traceOf, type Grant } from "./capabilities.ts";
import { canonicalBytes, digest, digestOf } from "./canonical.ts";
import { buildResult } from "./result.ts";

export const EVENT = {
  instanceCreated: "instance.created",
  gateVerdict: "gate.verdict",
  artifactAccepted: "artifact.accepted",
  stepTrace: "step.trace",
  instanceCompleted: "instance.completed",
} as const;

/** The literal handoff a consuming step receives (R7): four fields, no more. */
export interface Handoff {
  artifactRef: string;
  digest: string;
  path: string;
  schema: string;
}

export interface EngineOptions {
  /** Store root; default <cwd>/.pi/praxis/state or PRAXIS_STORE_DIR. */
  storeDir?: string;
  /** Flow config path; default <cwd>/.pi/praxis/config.json or PRAXIS_CONFIG. */
  configPath?: string;
  /** Pinned timestamp for the artifact rows; defaults to the wall clock. */
  now?: string;
  /** Actor pinned at creation; default PRAXIS_ACTOR or "cli". */
  actor?: string;
}

export interface StartOptions extends EngineOptions {
  flow: string;
  requestId: string;
}

export interface AdvanceOptions extends EngineOptions {
  instance: string;
  /** Parsed artifact payload supplied by the caller for the step being run. */
  artifact?: unknown;
}

export interface InspectOptions extends EngineOptions {
  instance: string;
}

export interface ReadOptions extends InspectOptions {
  step: string;
}

export interface OpenedFlow {
  config: FlowConfig;
  configDigest: string;
  path: string;
}

export interface Started {
  instance: Instance;
  flow: OpenedFlow;
  created: boolean;
}

export interface Inspection {
  instance: Instance;
  result: Result;
}

const GateSubject = z.looseObject({
  schema: z.string().min(1),
  nonce: z.string().min(1),
  derivedFrom: z.string().min(1).optional(),
});

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Store root resolution: explicit, then env, then the project default. */
export function storeDirOf(options: EngineOptions): string {
  return resolve(
    options.storeDir ?? process.env.PRAXIS_STORE_DIR ?? join(process.cwd(), ".pi/praxis/state"),
  );
}

function withStore<T>(options: EngineOptions, body: (store: Store, storeDir: string) => T): T {
  const storeDir = storeDirOf(options);
  mkdirSync(join(storeDir, "artifacts"), { recursive: true });
  const store = openStore(join(storeDir, "praxis.sqlite"));
  try {
    return body(store, storeDir);
  } finally {
    store.close();
  }
}

/** Read, validate and digest the flow config. The digest is what an instance pins. */
export function openFlow(options: EngineOptions): OpenedFlow {
  const path = resolve(
    options.configPath ?? process.env.PRAXIS_CONFIG ?? join(process.cwd(), ".pi/praxis/config.json"),
  );
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw fail("CONFIG_INVALID", "flow config is not readable at " + path, { path, reason: messageOf(error) });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (error) {
    throw fail("CONFIG_INVALID", "flow config at " + path + " is not JSON", { path, reason: messageOf(error) });
  }
  const config = parseFlowConfig(raw);
  validateFlow(config);
  return { config, configDigest: digestOf(config), path };
}

/** Refuse a flow whose references cannot be resolved (R1: typed refusal, zero writes). */
export function validateFlow(config: FlowConfig): void {
  const seen = new Set<string>();
  config.steps.forEach((step, index) => {
    if (seen.has(step.id)) {
      throw fail("CONFIG_INVALID", "duplicate step id " + JSON.stringify(step.id), { step: step.id });
    }
    seen.add(step.id);
    grantFor(step);
    if (step.consumes !== undefined) {
      const consumed = config.steps.findIndex((candidate) => candidate.id === step.consumes);
      if (consumed < 0) {
        throw fail("CONFIG_INVALID", "step " + JSON.stringify(step.id) + " consumes unknown step " + JSON.stringify(step.consumes), {
          step: step.id,
          consumes: step.consumes,
        });
      }
      if (consumed >= index) {
        throw fail("CONFIG_INVALID", "step " + JSON.stringify(step.id) + " consumes a step that does not precede it", {
          step: step.id,
          consumes: step.consumes,
        });
      }
    }
  });
}

/** Instance id is a pure function of (flow, requestId): a repeated request cannot fork. */
export function instanceIdFor(flow: string, requestId: string): string {
  if (flow === "" || requestId === "") throw fail("CONFIG_INVALID", "flow and request id are required");
  return "i" + digest("request:" + flow + "\u0000" + requestId).slice(7, 39);
}

function nonceFor(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stamp(options: EngineOptions): string {
  return options.now ?? new Date().toISOString();
}

function payloadOf(payload: unknown): Record<string, unknown> {
  if (typeof payload === "object" && payload !== null) return payload as Record<string, unknown>;
  return {};
}

/** Accepted artifact references, derived from the append-only event log alone. */
export function acceptedRefs(store: Store, instance: string): ArtifactRef[] {
  const refs: ArtifactRef[] = [];
  for (const event of listEvents(store, instance)) {
    if (event.type !== EVENT.artifactAccepted) continue;
    const payload = payloadOf(event.payload);
    refs.push({
      step: String(payload.step),
      version: Number(payload.version),
      digest: String(payload.digest),
      schema: String(payload.schema),
    });
  }
  return refs;
}

/** Create or re-open the instance a request id names; never fork (R2). */
export function start(options: StartOptions): Started {
  const flow = openFlow(options);
  if (flow.config.flow !== options.flow) {
    throw fail("CONFIG_INVALID", "config declares flow " + JSON.stringify(flow.config.flow), {
      requested: options.flow,
      declared: flow.config.flow,
      path: flow.path,
    });
  }
  const actor = options.actor ?? process.env.PRAXIS_ACTOR ?? "cli";
  const id = instanceIdFor(flow.config.flow, options.requestId);
  const at = stamp(options);
  const first = flow.config.steps[0];

  return withStore(options, (store, storeDir) => {
    const existing = loadExisting(store, id);
    if (existing !== undefined) {
      if (existing.configDigest !== flow.configDigest || existing.actor !== actor) {
        throw fail(
          "REQUEST_CONFLICT",
          "request " + JSON.stringify(options.requestId) + " was already used with a different payload",
          {
            instance: id,
            pinned: { configDigest: existing.configDigest, actor: existing.actor },
            offered: { configDigest: flow.configDigest, actor },
          },
        );
      }
      return { instance: existing, flow, created: false };
    }

    const instance = createInstance(store, {
      id,
      flow: flow.config.flow,
      actor,
      configDigest: flow.configDigest,
      status: "running",
      currentStep: first.id,
      nonce: nonceFor(),
      now: at,
    });
    appendEvent(store, id, {
      type: EVENT.instanceCreated,
      payload: {
        flow: flow.config.flow,
        requestId: options.requestId,
        actor,
        configDigest: flow.configDigest,
        nonce: instance.nonce,
        storeDir,
      },
      at,
    });
    return { instance, flow, created: true };
  });
}

function loadExisting(store: Store, id: string): Instance | undefined {
  try {
    return loadInstance(store, id);
  } catch (error) {
    if (isAppError(error) && error.code === "INSTANCE_NOT_FOUND") return undefined;
    throw error;
  }
}

/** Current durable state plus the bounded result, without running a step. */
export function inspect(options: InspectOptions): Inspection {
  return withStore(options, (store) => {
    const instance = loadInstance(store, options.instance);
    return { instance, result: buildResult(instance, acceptedRefs(store, instance.id)) };
  });
}

/** Read one recorded artifact and return its parsed value (the `artifact.read` surface). */
export function readStepArtifact(options: ReadOptions): { artifact: Artifact; value: unknown } {
  return withStore(options, (store) => {
    const read = readArtifact(store, options.instance, options.step);
    const text = Buffer.from(read.bytes).toString("utf8");
    let value: unknown;
    try {
      value = JSON.parse(text) as unknown;
    } catch (error) {
      throw fail("ARTIFACT_INVALID", "recorded artifact is not JSON", { reason: messageOf(error) });
    }
    return { artifact: read.artifact, value };
  });
}

/**
 * Advance the instance by exactly one step.
 * Resume never guesses a step: `currentStep` in the store names it, and the accepted
 * predecessor artifact is reloaded from the store by reference.
 */
export function advance(options: AdvanceOptions): { instance: Instance; result: Result } {
  const flow = openFlow(options);
  return withStore(options, (store, storeDir) => {
    const instance = loadInstance(store, options.instance);
    const at = stamp(options);
    if (instance.status === "completed") {
      return { instance, result: buildResult(instance, acceptedRefs(store, instance.id)) };
    }
    if (instance.status !== "running") {
      throw fail("INSTANCE_STATE_INVALID", "instance " + instance.id + " is " + instance.status, {
        instance: instance.id,
        status: instance.status,
        step: instance.currentStep,
      });
    }
    if (flow.configDigest !== instance.configDigest) {
      throw fail("CONFIG_INVALID", "the flow config no longer matches the digest this instance pinned", {
        instance: instance.id,
        pinned: instance.configDigest,
        offered: flow.configDigest,
        path: flow.path,
      });
    }

    const index = flow.config.steps.findIndex((step) => step.id === instance.currentStep);
    if (index < 0) {
      throw fail("CONFIG_INVALID", "current step " + JSON.stringify(instance.currentStep) + " is not in the flow", {
        instance: instance.id,
        step: instance.currentStep,
      });
    }
    const step = flow.config.steps[index];
    const grant = grantFor(step);
    const handoff = step.consumes === undefined ? undefined : buildHandoff(store, instance, step, grant);
    const artifact = runStep({ store, storeDir, instance, step, grant, handoff, payload: options.artifact, at });

    const accepted = acceptedRefs(store, instance.id);
    const alreadyAccepted = accepted.some((ref) => ref.step === step.id && ref.version === artifact.version);

    if (!alreadyAccepted) {
      const verdict = gate(artifact.value, {
        schema: step.produces.schema,
        nonce: instance.nonce,
        derivedFrom: handoff === undefined ? undefined : handoff.digest,
      });
      appendEvent(store, instance.id, {
        type: EVENT.gateVerdict,
        payload: {
          step: step.id,
          decision: verdict.decision,
          checks: verdict.checks,
          artifactDigest: artifact.digest,
        },
        at,
      });
      if (verdict.decision !== "accept") {
        setStatus(store, instance.id, { status: "failed", currentStep: step.id }, instance.revision);
        throw fail("ARTIFACT_INVALID", "artifact for step " + JSON.stringify(step.id) + " failed the gate", {
          instance: instance.id,
          step: step.id,
          checks: verdict.checks,
        });
      }

      acceptArtifact(store, instance.id, step.id, artifact.version, at);
      appendEvent(store, instance.id, {
        type: EVENT.artifactAccepted,
        payload: {
          step: step.id,
          version: artifact.version,
          path: artifact.path,
          digest: artifact.digest,
          schema: step.produces.schema,
          derivedFrom: handoff === undefined ? null : handoff.digest,
        },
        at,
      });
      appendEvent(store, instance.id, {
        type: EVENT.stepTrace,
        payload: { step: step.id, calls: traceOf(grant) },
        at,
      });
    }

    const next = flow.config.steps[index + 1];
    const finished = next === undefined;
    const updated = setStatus(
      store,
      instance.id,
      { status: finished ? "completed" : "running", currentStep: finished ? step.id : next.id },
      instance.revision,
    );
    if (finished) {
      appendEvent(store, instance.id, { type: EVENT.instanceCompleted, payload: { step: step.id }, at });
    }
    return { instance: updated, result: buildResult(updated, acceptedRefs(store, instance.id)) };
  });
}

interface RunStepArgs {
  store: Store;
  storeDir: string;
  instance: Instance;
  step: StepConfig;
  grant: Grant;
  handoff?: Handoff;
  payload?: unknown;
  at: string;
}

interface StepArtifact {
  version: number;
  path: string;
  digest: string;
  value: unknown;
}

/**
 * Execute the step body under its grant: read the predecessor when consuming,
 * canonicalise and persist this step's artifact. A version left `pending` by a killed
 * attempt is reused, never re-recorded (P8).
 */
function runStep(args: RunStepArgs): StepArtifact {
  const { store, storeDir, instance, step, grant, handoff, payload, at } = args;
  const existing = probeArtifact(store, instance.id, step.id);
  const version = existing === undefined ? 1 : existing.artifact.version;
  const value: unknown = payload === undefined ? {} : payload;
  const bytes = canonicalBytes(value);
  const artifactDigest = digest(bytes);

  if (existing !== undefined) {
    if (existing.artifact.digest !== artifactDigest) {
      throw fail("ARTIFACT_VERSION_CONFLICT", "step " + JSON.stringify(step.id) + " has a recorded attempt with different content", {
        instance: instance.id,
        step: step.id,
        version,
        recorded: existing.artifact.digest,
        offered: artifactDigest,
      });
    }
    return {
      version,
      path: existing.artifact.path,
      digest: existing.artifact.digest,
      value: parseStored(store, instance.id, step.id, version),
    };
  }

  const path = join(storeDir, "artifacts", instance.id, step.id, "v" + version + ".json");

  if (handoff !== undefined) {
    const consumed = step.consumes as string;
    call(grant, "artifact.read", () => {
      const read = readArtifact(store, instance.id, consumed);
      const seen = digest(read.bytes);
      if (seen !== handoff.digest) {
        throw fail("ARTIFACT_DIGEST_MISMATCH", "re-read of " + handoff.artifactRef + " no longer matches", {
          artifactRef: handoff.artifactRef,
          expected: handoff.digest,
          observed: seen,
        });
      }
    });
  }

  call(grant, "artifact.write", () => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    recordArtifact(store, {
      instance: instance.id,
      step: step.id,
      version,
      path,
      digest: artifactDigest,
      schema: step.produces.schema,
      state: "pending",
      derivedFrom: handoff === undefined ? null : handoff.digest,
      at,
    });
  });

  return { version, path, digest: artifactDigest, value };
}

function parseStored(store: Store, instance: string, step: string, version: number): unknown {
  const read = readArtifact(store, instance, step, version);
  try {
    return JSON.parse(Buffer.from(read.bytes).toString("utf8")) as unknown;
  } catch (error) {
    throw fail("ARTIFACT_INVALID", "recorded artifact " + step + " is not JSON", { reason: messageOf(error) });
  }
}

function probeArtifact(store: Store, instance: string, step: string): { artifact: Artifact; bytes: Uint8Array } | undefined {
  try {
    return readArtifact(store, instance, step);
  } catch (error) {
    if (isAppError(error) && error.code === "ARTIFACT_UNAVAILABLE") return undefined;
    throw error;
  }
}

/**
 * Build the four-field handoff for a consuming step.
 * Without artifact.read there is no handoff at all: fail closed, zero effects (R9).
 * Integrity is verified here, before any dispatch (R10).
 */
function buildHandoff(store: Store, instance: Instance, step: StepConfig, grant: Grant): Handoff {
  const consumed = step.consumes as string;
  if (!grant.capabilities.has("artifact.read")) {
    throw fail(
      "ARTIFACT_UNAVAILABLE",
      "step " + JSON.stringify(step.id) + " may not receive a handoff without artifact.read",
      { instance: instance.id, step: step.id, consumed, granted: [...grant.capabilities] },
    );
  }
  const found = probeArtifact(store, instance.id, consumed);
  if (found === undefined || found.artifact.state !== "accepted") {
    throw fail("ARTIFACT_UNAVAILABLE", "no accepted artifact from " + JSON.stringify(consumed) + " to hand off", {
      instance: instance.id,
      step: step.id,
      consumed,
      state: found === undefined ? "absent" : found.artifact.state,
    });
  }
  const observed = digest(found.bytes);
  if (observed !== found.artifact.digest) {
    throw fail("ARTIFACT_DIGEST_MISMATCH", "artifact " + consumed + " does not match its recorded digest", {
      instance: instance.id,
      artifactRef: consumed + "@" + found.artifact.version,
      recorded: found.artifact.digest,
      observed,
    });
  }
  return {
    artifactRef: consumed + "@" + found.artifact.version,
    digest: found.artifact.digest,
    path: found.artifact.path,
    schema: found.artifact.schema,
  };
}

export interface Verdict {
  decision: "accept" | "reject";
  checks: Record<string, boolean>;
}

/** The deterministic gate: schema-valid and nonce present, plus derivation (R5, R8). */
export function gate(
  value: unknown,
  expected: { schema: string; nonce: string; derivedFrom?: string },
): Verdict {
  const parsed = GateSubject.safeParse(value);
  const subject = parsed.success ? parsed.data : undefined;
  const checks: Record<string, boolean> = {
    object: parsed.success,
    schemaMatches: subject !== undefined && subject.schema === expected.schema,
    noncePresent: subject !== undefined && subject.nonce === expected.nonce,
  };
  if (expected.derivedFrom !== undefined) {
    checks.derivedFromMatches = subject !== undefined && subject.derivedFrom === expected.derivedFrom;
  }
  const accepted = Object.values(checks).every(Boolean);
  return { decision: accepted ? "accept" : "reject", checks };
}
