/**
 * The flow layer: read and resolve the flow document against the task library, pin it with every
 * task version, and read the pins back. No node runs here.
 */
import { readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fail } from "../../types/errors.ts";
import {
  FlowConfigSchema,
  parseFlowConfig,
  parseTaskRef,
  parseWith,
  TaskConfigSchema,
  type ArtifactRef,
  type FlowConfig,
  type Instance,
  type TaskConfig,
} from "../../types/schema.ts";
import type { Store } from "../../store/db.ts";
import { readDefinition } from "../../store/definitions.ts";
import { listEvents } from "../../store/events.ts";
import { grantFor } from "../capabilities.ts";
import { digest, digestOf } from "../canonical.ts";
import { messageOf, payloadOf, pinnedJson, profileDirOf, rulesDirOf, tasksDirOf } from "./support.ts";
import { EVENT, type EngineOptions, type HandoffRef, type OpenedFlow } from "./types.ts";
import { loadRuleSet, type PinnedRuleSet } from "./rules.ts";
import { loadProfile } from "./profile.ts";
import { ProfileSchema, type PinnedProfile } from "../../types/profile.ts";
import { RuleSetSchema } from "../../types/rules.ts";

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

/**
 * Every rule-set the given tasks reference, loaded once per path. A flow whose tasks declare no `rules`
 * returns an EMPTY map and never calls the loader: that is what keeps a rules-free project byte-identical
 * (and what keeps it from touching a rules directory that may not exist).
 */
/**
 * Every DOMAIN profile the flow's nodes declare, loaded once per id. A node's own `domains` win; a flow's
 * `domains` are the default for nodes that declare none. No domains anywhere means an EMPTY map and no
 * filesystem access - which is what keeps a domain-free project byte-identical.
 */
function loadReferencedProfiles(
  config: FlowConfig,
  load: (ref: string) => PinnedProfile,
): ReadonlyMap<string, PinnedProfile> {
  const profiles = new Map<string, PinnedProfile>();
  const flowDefault = config.domains ?? [];
  for (const ref of flowDefault) {
    if (!profiles.has(ref)) profiles.set(ref, load(ref));
  }
  for (const node of config.nodes) {
    for (const ref of node.domains ?? []) {
      if (profiles.has(ref)) continue;
      profiles.set(ref, load(ref));
    }
  }
  return profiles;
}

function loadReferencedRules(
  tasks: ReadonlyMap<string, TaskConfig>,
  load: (ref: string) => PinnedRuleSet,
): ReadonlyMap<string, PinnedRuleSet> {
  const sets = new Map<string, PinnedRuleSet>();
  for (const task of tasks.values()) {
    for (const ref of task.rules ?? []) {
      if (sets.has(ref.set)) continue;
      sets.set(ref.set, load(ref.set));
    }
  }
  return sets;
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
  // The rule-sets this flow's TASKS reference, read once: the same set shared by two tasks is loaded once,
  // and a flow whose tasks declare none reads nothing at all (the unchanged case).
  return {
    config,
    flowDigest: digestOf(config),
    path,
    tasks,
    rules: loadReferencedRules(tasks, (ref) => loadRuleSet(rulesDirOf(options), ref)),
    // The DOMAIN profiles the flow's NODES declare (a node's own list, else the flow default). Only the
    // domain layer is read: conduct and role belong to the host (gate #2).
    profiles: loadReferencedProfiles(config, (ref) => loadProfile(profileDirOf(options), ref)),
  };
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
  return {
    config,
    flowDigest: flowRow.digest,
    path: "pinned:" + instance.flow,
    tasks,
    // The pinned rule-sets: read back from the instance, digest verified against the bytes, so a finished
    // run's rules cannot change when the file on disk does.
    profiles: loadReferencedProfiles(config, (ref) => {
      const row = readDefinition(store, instance.id, "profile", ref);
      const doc = parseWith(ProfileSchema, pinnedJson(row.bytes, `profile ${ref}`), "PIN_CORRUPT", `pinned profile ${ref}`);
      const actual = digest(row.bytes);
      if (actual !== row.digest) {
        throw fail("PIN_CORRUPT", `pinned profile ${ref} no longer matches its digest`, {
          instance: instance.id,
          profile: ref,
          pinned: row.digest,
          actual,
        });
      }
      return { path: ref, doc, bytes: row.bytes, digest: row.digest };
    }),
    rules: loadReferencedRules(tasks, (ref) => {
      const row = readDefinition(store, instance.id, "ruleset", ref);
      const doc = parseWith(RuleSetSchema, pinnedJson(row.bytes, `rule-set ${ref}`), "PIN_CORRUPT", `pinned rule-set ${ref}`);
      const actual = digest(row.bytes);
      if (actual !== row.digest) {
        throw fail("PIN_CORRUPT", `pinned rule-set ${ref} no longer matches its digest`, {
          instance: instance.id,
          set: ref,
          pinned: row.digest,
          actual,
        });
      }
      return { path: ref, doc, bytes: row.bytes, digest: row.digest };
    }),
  };
}
