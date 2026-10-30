/**
 * The step engine: start an instance, advance exactly one node per invocation, record a
 * verdict, hand off references (spec R4, R5, R6, R7, R8; plan step 5).
 *
 * Invariants this file owns:
 * - the flow is data loaded from disk, resolved against the task library, and pinned at
 *   start: the flow document and every task version it names, in one transaction;
 * - an advance reads pins only, never the library, and recomputes every pinned digest;
 * - a node runs only under its own grant and every capability call is traced;
 * - the gate is deterministic and its verdict is a durable event;
 * - bytes are verified against the recorded digest before any dispatch.
 *
 * Limit, stated plainly: artifact files are written and read by this process with
 * ordinary filesystem calls. The capability checks gate the step body, not the OS;
 * gate #1 (isolation) stays open.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fail, isAppError, type AppError } from "../types/errors.ts";
import { RoleAssignmentSchema, type QualityVerdict } from "../types/schema.ts";
import { ROLE_DEFINITION_ID, roleAssignment } from "./identity.ts";
import {
  FlowConfigSchema,
  parseFlowConfig,
  parseTaskRef,
  parseWith,
  TaskConfigSchema,
  type Artifact,
  type ArtifactRef,
  type FlowConfig,
  type Instance,
  type ResolvedNode,
  type Result,
  type TaskConfig,
} from "../types/schema.ts";
import { openStore, transact, type Store } from "../store/db.ts";
import { insertInstance, loadInstance, setStatus } from "../store/instance.ts";
import { appendEvent, listEvents } from "../store/events.ts";
import { acceptArtifact, readArtifact } from "../store/artifacts.ts";
import { insertDefinition, insertPublication, readDefinition } from "../store/definitions.ts";
import { grantFor, traceOf } from "./capabilities.ts";
import { canonicalBytes, digest, digestOf } from "./canonical.ts";
import { buildResult } from "./result.ts";
import { buildHandoffs, gate, runStep, successorOf } from "./step.ts";

/** The gate and its verdict keep their published home on the engine surface. */
export { gate } from "./step.ts";
export type { Verdict } from "./step.ts";

export const EVENT = {
  instanceCreated: "instance.created",
  gateVerdict: "gate.verdict",
  qualityVerdict: "quality.verdict",
  artifactAccepted: "artifact.accepted",
  stepTrace: "step.trace",
  instanceCompleted: "instance.completed",
} as const;

export interface EngineOptions {
  /** Store root; default <cwd>/.pi/praxis/state or PRAXIS_STORE_DIR. */
  storeDir?: string;
  /** Flow document; default <cwd>/.pi/praxis/flows/engineering/feature.json or PRAXIS_CONFIG. */
  configPath?: string;
  /** Task library root; default <cwd>/.pi/praxis/tasks or PRAXIS_TASKS_DIR. */
  tasksDir?: string;
  /** Pinned timestamp for the artifact rows; defaults to the wall clock. */
  now?: string;
  /** Actor pinned at creation; default PRAXIS_ACTOR or "cli". */
  actor?: string;
}

export interface StartOptions extends EngineOptions {
  flow: string;
  requestId: string;
  /** Optional role -> actor map, pinned at creation and immutable (team relay). */
  roles?: Record<string, string>;
}

export interface AdvanceOptions extends EngineOptions {
  instance: string;
  /** Parsed artifact payload supplied by the caller for the node being run. */
  artifact?: unknown;
  /** A quality verdict pre-computed outside any transaction (quality eval); enforced by the gate. */
  qualityVerdict?: QualityVerdict;
}

export interface InspectOptions extends EngineOptions {
  instance: string;
}

export interface ReadOptions extends InspectOptions {
  step: string;
}

/** A flow document plus the task units it names, all resolved before any write. */
export interface OpenedFlow {
  config: FlowConfig;
  flowDigest: string;
  path: string;
  /** Keyed by the `id@version` reference a node carries. */
  tasks: ReadonlyMap<string, TaskConfig>;
}

export interface Started {
  instance: Instance;
  flow: OpenedFlow;
  created: boolean;
}

/** The accepted predecessor references the current step consumes (step, schema, digest). */
export interface HandoffRef {
  step: string;
  schema: string;
  digest: string;
}

export interface Inspection {
  instance: Instance;
  result: Result;
  /** The pinned flow, so a caller never re-opens the library (R5). */
  flow: OpenedFlow;
  /** The current step's accepted sources, so the descriptor can name provenance. */
  handoffs: HandoffRef[];
}

function messageOf(error: unknown): string {
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

/**
 * Read one task unit by its path. The reference names the path; the document declares
 * the version the pin records. Absent is `TASK_NOT_FOUND`, bad bytes `CONFIG_INVALID`.
 */
function loadTask(tasksDir: string, ref: string): TaskConfig {
  const relative = parseTaskRef(ref);
  const library = resolve(tasksDir);
  const path = resolve(library, relative + ".json");
  // Defence in depth: the reference grammar admits no dot segment; refuse one anyway.
  if (!path.startsWith(library + sep)) {
    throw fail("CONFIG_INVALID", `task ${ref} escapes the library at ${library}`, { ref, path, library });
  }
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw fail("TASK_NOT_FOUND", `no task ${ref} in the library at ${library}`, {
      ref,
      path,
      reason: messageOf(error),
    });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (error) {
    throw fail("CONFIG_INVALID", `task ${ref} at ${path} is not JSON`, { ref, path, reason: messageOf(error) });
  }
  const task = parseWith(TaskConfigSchema, raw, "CONFIG_INVALID", `task ${ref}`);
  const name = relative.slice(relative.lastIndexOf("/") + 1);
  if (task.id !== name) {
    throw fail("CONFIG_INVALID", `task ${ref} declares a different identity`, {
      ref,
      id: task.id,
      version: task.version,
      path,
    });
  }
  return task;
}

/** Read, resolve, validate and digest the flow document. The digest is what an instance pins. */
export function openFlow(options: EngineOptions): OpenedFlow {
  const path = resolve(
    options.configPath ?? process.env.PRAXIS_CONFIG ?? join(process.cwd(), ".pi/praxis/flows/engineering/feature.json"),
  );
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw fail("FLOW_INVALID", "flow config is not readable at " + path, { path, reason: messageOf(error) });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (error) {
    throw fail("CONFIG_INVALID", "flow config at " + path + " is not JSON", { path, reason: messageOf(error) });
  }
  const config = parseFlowConfig(raw);
  const tasksDir = tasksDirOf(options);
  const tasks = new Map<string, TaskConfig>();
  for (const node of config.nodes) {
    if (tasks.has(node.task)) continue;
    tasks.set(node.task, loadTask(tasksDir, node.task));
  }
  validateFlow(config, tasks);
  return { config, flowDigest: digestOf(config), path, tasks };
}

/** Refuse a flow whose references cannot be resolved (R1, R2, R7: typed refusal, zero writes). */
export function validateFlow(config: FlowConfig, tasks: ReadonlyMap<string, TaskConfig>): void {
  const consumedBy = new Map<string, string[]>();
  for (const edge of config.edges) {
    if (edge.kind === "refuse") continue;
    const sources = consumedBy.get(edge.to) ?? [];
    sources.push(edge.from);
    consumedBy.set(edge.to, sources);
  }
  for (const node of config.nodes) {
    const task = tasks.get(node.task);
    if (task === undefined) {
      throw fail("TASK_NOT_FOUND", "node " + JSON.stringify(node.id) + " names an unresolved task " + node.task, {
        node: node.id,
        task: node.task,
      });
    }
    grantFor({ id: node.id, capabilities: task.capabilities });
    if (task.bindsSubject !== true) continue;
    const sources = consumedBy.get(node.id) ?? [];
    const data = config.edges.filter((edge) => edge.kind === "data" && edge.to === node.id);
    if (sources.length !== 1 || data.length !== 1) {
      throw fail(
        "CONFIG_INVALID",
        "node " + JSON.stringify(node.id) + " binds a subject, so it takes exactly one data source",
        { node: node.id, sources },
      );
    }
  }
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

/** The accepted sources the instance's current step consumes, from refs already read. */
export function currentHandoffs(flow: OpenedFlow, instance: Instance, accepted: readonly ArtifactRef[]): HandoffRef[] {
  const node = flow.config.nodes.find((candidate) => candidate.id === instance.currentStep);
  if (node === undefined) return [];
  const sources = new Set(
    flow.config.edges
      .filter((edge) => (edge.kind === "data" || edge.kind === "join") && edge.to === node.id)
      .map((edge) => edge.from),
  );
  return accepted
    .filter((ref) => sources.has(ref.step))
    .map((ref) => ({ step: ref.step, schema: ref.schema, digest: ref.digest }));
}

/** Create or re-open the instance a request id names; never fork (R2), never re-pin (R4). */
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
  const first = flow.config.nodes[0];

  return withStore(options, (store, storeDir) => {
    const existing = loadExisting(store, id);
    if (existing !== undefined) {
      const pinned = readDefinition(store, existing.id, "flow", existing.flow).digest;
      if (pinned !== flow.flowDigest || existing.actor !== actor) {
        throw fail(
          "REQUEST_CONFLICT",
          "request " + JSON.stringify(options.requestId) + " was already used with a different payload",
          {
            instance: id,
            pinned: { flowDigest: pinned, actor: existing.actor },
            offered: { flowDigest: flow.flowDigest, actor },
          },
        );
      }
      return { instance: existing, flow, created: false };
    }

    const instance = transact(store, () => {
      const row = insertInstance(store, {
        id,
        flow: flow.config.flow,
        actor,
        status: "running",
        currentStep: first.id,
        nonce: nonceFor(),
        now: at,
      });
      // R4: the flow, every task version and the first publications commit with the row.
      insertDefinition(store, {
        instance: id,
        kind: "flow",
        id: flow.config.flow,
        digest: flow.flowDigest,
        bytes: canonicalBytes(flow.config),
      });
      for (const [ref, task] of flow.tasks) {
        if (task.state !== "published") {
          throw fail("TASK_NOT_PUBLISHED", `task ${ref} is ${task.state}, so it cannot be pinned`, {
            task: ref,
            state: task.state,
          });
        }
        const bytes = canonicalBytes(task);
        const taskDigest = digest(bytes);
        insertDefinition(store, { instance: id, kind: "task", id: ref, digest: taskDigest, bytes });
        // The path, not the label: two nested paths may end in the same id and are two
        // publications. The version is the one the document declares (R3, R5).
        insertPublication(store, { task: ref, version: task.version, digest: taskDigest, at });
      }
      if (options.roles !== undefined && Object.keys(options.roles).length > 0) {
        const roles = parseWith(RoleAssignmentSchema, options.roles, "CONFIG_INVALID", "role assignment");
        const bytes = canonicalBytes(roles);
        insertDefinition(store, { instance: id, kind: "assignment", id: ROLE_DEFINITION_ID, digest: digest(bytes), bytes });
      }
      return row;
    });
    // The event is evidence of creation, not part of the pin set, and `appendEvent` owns
    // its own transaction; the pins and the row above commit together without it.
    appendEvent(store, id, {
      type: EVENT.instanceCreated,
      payload: {
        flow: flow.config.flow,
        requestId: options.requestId,
        actor,
        flowDigest: flow.flowDigest,
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

/** Parse pinned bytes as JSON, treating unparseable pin content as `PIN_CORRUPT`. */
function pinnedJson(bytes: Uint8Array, what: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch (error) {
    throw fail("PIN_CORRUPT", `pinned ${what} is not JSON`, { reason: messageOf(error) });
  }
}

/**
 * The pinned flow and its tasks, read from the instance's own `definition` rows and
 * verified on every read (R4, R5). The library is never consulted here.
 */
export function loadPinnedFlow(store: Store, instance: Instance): OpenedFlow {
  const flowRow = readDefinition(store, instance.id, "flow", instance.flow);
  const config = parseWith(
    FlowConfigSchema,
    pinnedJson(flowRow.bytes, "flow"),
    "PIN_CORRUPT",
    `pinned flow ${instance.flow}`,
  );
  if (digestOf(config) !== flowRow.digest) {
    throw fail("PIN_CORRUPT", `pinned flow ${instance.flow} no longer matches its digest`, {
      instance: instance.id,
      pinned: flowRow.digest,
      actual: digestOf(config),
    });
  }
  const tasks = new Map<string, TaskConfig>();
  for (const node of config.nodes) {
    if (tasks.has(node.task)) continue;
    const row = readDefinition(store, instance.id, "task", node.task);
    const task = parseWith(TaskConfigSchema, pinnedJson(row.bytes, `task ${node.task}`), "PIN_CORRUPT", `pinned task ${node.task}`);
    if (digestOf(task) !== row.digest) {
      throw fail("PIN_CORRUPT", `pinned task ${node.task} no longer matches its digest`, {
        instance: instance.id,
        task: node.task,
        pinned: row.digest,
        actual: digestOf(task),
      });
    }
    tasks.set(node.task, task);
  }
  return { config, flowDigest: flowRow.digest, path: "pinned:" + instance.flow, tasks };
}


/** A typed refusal for a caller acting on an instance role it does not hold (R10). */
function forbidden(instance: Instance, actor: string, what: string): AppError {
  return fail("INSTANCE_FORBIDDEN", "actor may not " + what + " on instance " + JSON.stringify(instance.id), {
    instance: instance.id,
    actor,
  });
}

/** The author recorded for a step: the actor of its accepted artifact, when one is known. */
function stepAuthor(store: Store, instance: Instance, step: string): string | undefined {
  for (const event of listEvents(store, instance.id)) {
    if (event.type !== EVENT.artifactAccepted) continue;
    const payload = event.payload as { step?: string; actor?: string };
    if (payload.step === step && typeof payload.actor === "string") return payload.actor;
  }
  return undefined;
}

/**
 * Observe authority (inspect/read): the instance creator and every assigned role holder
 * may see the instance; an unknown actor is refused. No actor (CLI/internal) skips the check,
 * which keeps the degenerate single-actor case (unit F) and every CLI path unchanged.
 */
function assertObserver(store: Store, instance: Instance, actor: string | undefined): void {
  if (actor === undefined || actor === instance.actor) return;
  if (Object.values(roleAssignment(store, instance)).includes(actor)) return;
  throw forbidden(instance, actor, "observe");
}

/**
 * Submit authority for one step (R10, team relay): the holder of the step's declared role,
 * or the creator when the step declares none. A subject-binding step additionally refuses
 * the author of the subject it would judge — separation of duties, so no self-review, even
 * if a single actor was (mis)assigned both roles.
 */
function assertStepActor(
  store: Store,
  instance: Instance,
  task: TaskConfig,
  sources: readonly string[],
  actor: string | undefined,
): void {
  if (actor === undefined) return;
  const assignment = roleAssignment(store, instance);
  if (task.role === undefined) {
    if (actor !== instance.actor) throw forbidden(instance, actor, "submit");
  } else {
    const holder = assignment[task.role];
    if (holder !== actor) throw forbidden(instance, actor, "fill the role " + JSON.stringify(task.role));
  }
  // Separation of duties applies only to team instances (roles pinned); a solo instance,
  // which has no role assignment, legitimately reviews its own work (the shipped behaviour).
  if (task.bindsSubject === true && Object.keys(assignment).length > 0) {
    for (const source of sources) {
      if (stepAuthor(store, instance, source) === actor) {
        throw fail("INSTANCE_FORBIDDEN", "the author of " + JSON.stringify(source) + " may not also judge it", {
          instance: instance.id,
          step: task.id,
          source,
          actor,
        });
      }
    }
  }
}

/** Current durable state plus the bounded result, without running a node. */
export function inspect(options: InspectOptions): Inspection {
  return withStore(options, (store) => {
    const instance = loadInstance(store, options.instance);
    assertObserver(store, instance, options.actor);
    const accepted = acceptedRefs(store, instance.id);
    const flow = loadPinnedFlow(store, instance);
    return { instance, result: buildResult(instance, accepted), flow, handoffs: currentHandoffs(flow, instance, accepted) };
  });
}

/** Read one recorded artifact and return its parsed value (the `artifact.read` surface). */
export function readStepArtifact(options: ReadOptions): { artifact: Artifact; value: unknown } {
  return withStore(options, (store) => {
    assertObserver(store, loadInstance(store, options.instance), options.actor);
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
 * Advance the instance by exactly one node.
 * Resume never guesses a node: `currentStep` in the store names it, the wiring comes from
 * the pinned flow's edges, and the consumed artifacts are reloaded from the store.
 */
export function advance(options: AdvanceOptions): { instance: Instance; result: Result; flow: OpenedFlow; handoffs: HandoffRef[] } {
  return withStore(options, (store, storeDir) => {
    const instance = loadInstance(store, options.instance);
    assertObserver(store, instance, options.actor);
    const at = stamp(options);
    if (instance.status === "completed") {
      const accepted = acceptedRefs(store, instance.id);
      const flow = loadPinnedFlow(store, instance);
      return { instance, result: buildResult(instance, accepted), flow, handoffs: currentHandoffs(flow, instance, accepted) };
    }
    if (instance.status !== "running") {
      throw fail("INSTANCE_STATE_INVALID", "instance " + instance.id + " is " + instance.status, {
        instance: instance.id,
        status: instance.status,
        step: instance.currentStep,
      });
    }

    let flow: OpenedFlow;
    try {
      flow = loadPinnedFlow(store, instance);
    } catch (error) {
      // A mismatching pin is terminal (R5); a missing pin is not (A9).
      if (isAppError(error) && error.code === "PIN_CORRUPT") {
        setStatus(store, instance.id, { status: "failed", currentStep: instance.currentStep }, instance.revision);
      }
      throw error;
    }

    const index = flow.config.nodes.findIndex((node) => node.id === instance.currentStep);
    if (index < 0) {
      throw fail("CONFIG_INVALID", "current step " + JSON.stringify(instance.currentStep) + " is not in the flow", {
        instance: instance.id,
        step: instance.currentStep,
      });
    }
    const node = flow.config.nodes[index];
    const task = flow.tasks.get(node.task) as TaskConfig;
    const sources = flow.config.edges
      .filter((edge) => (edge.kind === "data" || edge.kind === "join") && edge.to === node.id)
      .map((edge) => edge.from);
    const refuse = flow.config.edges.find((edge) => edge.kind === "refuse" && edge.from === node.id)?.to;
    const resolved: ResolvedNode =
      refuse === undefined ? { node, task, sources } : { node, task, sources, refuse };
    assertStepActor(store, instance, task, sources, options.actor);
    const effectiveQuality = task.quality ?? flow.config.quality;
    const grant = grantFor({ id: node.id, capabilities: task.capabilities });
    const handoffs = buildHandoffs(store, instance, resolved, grant);
    const artifact = runStep({ store, storeDir, instance, node, task, grant, handoffs, payload: options.artifact, at });

    const accepted = acceptedRefs(store, instance.id);
    const alreadyAccepted = accepted.some((ref) => ref.step === node.id && ref.version === artifact.version);

    // The gate runs even for a replay of an accepted artifact: acceptance was a judgement
    // about the work as it stood, and after the work moved on the replay is stale.
    const verdict = gate(artifact.value, {
      schema: task.produces.schema,
      nonce: instance.nonce,
      ...(handoffs.length === 1 ? { derivedFrom: handoffs[0].digest } : {}),
      ...(task.requires === undefined ? {} : { requires: task.requires }),
      ...(task.bindsSubject === true ? { subject: true } : {}),
      ...(effectiveQuality === undefined ? {} : { quality: { policy: effectiveQuality.policy, threshold: effectiveQuality.threshold, verdict: options.qualityVerdict } }),
    });

    if (alreadyAccepted && verdict.decision !== "accept") {
      appendEvent(store, instance.id, {
        type: EVENT.gateVerdict,
        payload: {
          step: node.id,
          version: artifact.version,
          decision: verdict.decision,
          checks: verdict.checks,
          ...(verdict.missing === undefined ? {} : { missing: verdict.missing }),
          artifactDigest: artifact.digest,
        },
        at,
      });
      if (resolved.refuse !== undefined) {
        setStatus(store, instance.id, { status: "running", currentStep: resolved.refuse }, instance.revision);
      }
      throw fail(verdict.code ?? "ARTIFACT_INVALID", "a replay of accepted step " + JSON.stringify(node.id) + " no longer passes the gate", {
        instance: instance.id,
        step: node.id,
        version: artifact.version,
        checks: verdict.checks,
        replayed: true,
        ...(resolved.refuse === undefined ? {} : { reworkTo: resolved.refuse }),
      });
    }

    if (!alreadyAccepted) {
      appendEvent(store, instance.id, {
        type: EVENT.gateVerdict,
        payload: {
          step: node.id,
          version: artifact.version,
          decision: verdict.decision,
          checks: verdict.checks,
          ...(verdict.missing === undefined ? {} : { missing: verdict.missing }),
          artifactDigest: artifact.digest,
        },
        at,
      });
      if (verdict.quality !== undefined) {
        appendEvent(store, instance.id, {
          type: EVENT.qualityVerdict,
          payload: { step: node.id, version: artifact.version, artifactDigest: artifact.digest, ...verdict.quality },
          at,
        });
      }
      if (verdict.decision !== "accept") {
        // A refusal is evidence, not instance death. A refuse edge sends the work back to
        // the node that must be amended; without one the node stays current and is retried.
        if (resolved.refuse !== undefined) {
          setStatus(store, instance.id, { status: "running", currentStep: resolved.refuse }, instance.revision);
        }
        throw fail(verdict.code ?? "ARTIFACT_INVALID", "artifact for step " + JSON.stringify(node.id) + " failed the gate", {
          instance: instance.id,
          step: node.id,
          version: artifact.version,
          checks: verdict.checks,
          ...(verdict.missing === undefined ? {} : { missing: verdict.missing }),
          ...(resolved.refuse === undefined ? {} : { reworkTo: resolved.refuse }),
        });
      }

      acceptArtifact(store, instance.id, node.id, artifact.version, at);
      appendEvent(store, instance.id, {
        type: EVENT.artifactAccepted,
        payload: {
          step: node.id,
          version: artifact.version,
          path: artifact.path,
          digest: artifact.digest,
          schema: task.produces.schema,
          derivedFrom: handoffs.length === 1 ? handoffs[0].digest : null,
          ...(handoffs.length > 1 ? { sources: handoffs.map((handoff) => handoff.artifactRef) } : {}),
          ...(options.actor !== undefined ? { actor: options.actor } : {}),
        },
        at,
      });
      appendEvent(store, instance.id, {
        type: EVENT.stepTrace,
        payload: { step: node.id, calls: traceOf(grant) },
        at,
      });
    }

    const successor = successorOf(flow.config, node.id);
    const finished = successor === undefined;
    const updated = setStatus(
      store,
      instance.id,
      { status: finished ? "completed" : "running", currentStep: finished ? node.id : successor },
      instance.revision,
    );
    if (finished) {
      appendEvent(store, instance.id, { type: EVENT.instanceCompleted, payload: { step: node.id }, at });
    }
    const acceptedNow = acceptedRefs(store, instance.id);
    return { instance: updated, result: buildResult(updated, acceptedNow), flow, handoffs: currentHandoffs(flow, updated, acceptedNow) };
  });
}

