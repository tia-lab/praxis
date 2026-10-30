/**
 * Zod schemas for the slice's declared contracts (spec R1, R3, R11, R12).
 *
 * Types are inferred from the schemas so there is one authority per shape. Every
 * object is strict: an undeclared key is a typed refusal, never a silent pass.
 * Zod is the only third-party dependency the slice admits.
 */
import { z } from "zod";
import { fail, type Code } from "./errors.ts";
import { IssueConfigSchema } from "./issue.ts";

const KEBAB = /^[a-z][a-z0-9-]{0,63}$/;

/** Step identifiers used in the flow config, event payloads and artifacts. */
export const StepIdSchema = z.string().regex(KEBAB, "expected a lower-case kebab name");
export type StepId = z.infer<typeof StepIdSchema>;

/**
 * The one rule both reference kinds obey (spec R1, R2): a root directory and one or more
 * lower-case kebab segments. The folder group is zero-or-more, so a flat
 * `tasks/research` and a nested `tasks/core/research` are the same grammar, and no
 * segment may be a dot or carry `.json`, so a path outside the root cannot be written.
 */
const PATH_SEGMENTS = "([a-z][a-z0-9-]{0,63}/)*[a-z][a-z0-9-]{0,63}";

/** The directory a task reference names; the loader reads everything below it. */
const TASKS_ROOT = "tasks/";

/** Build the path schema for one root: `tasks/<segments>` or `flows/<segments>`. */
function pathUnder(root: "tasks" | "flows"): z.ZodString {
  return z.string().regex(new RegExp("^" + root + "/" + PATH_SEGMENTS + "$"), "expected " + root + "/<path>");
}

/**
 * Flow identity: a path under `flows/`, e.g. `flows/workflow` or `flows/core/review`,
 * built from the same segment rule a task reference uses.
 */
export const FlowNameSchema = pathUnder("flows");

/** The closed capability registry (spec R7). An unknown name cannot be declared. */
export const CapabilitySchema = z.enum(["artifact.read", "artifact.write", "emit"]);
export type Capability = z.infer<typeof CapabilitySchema>;

/** The only gate this slice implements: deterministic, no model in the loop. */
export const GateSchema = z.enum(["schema-valid-and-nonce", "section-requirements"]);
export type Gate = z.infer<typeof GateSchema>;

/** Declared artifact/result schema name, e.g. `praxis.artifact.architecture/v1`. */
export const SchemaNameSchema = z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*\/v[1-9][0-9]*$/);
export type SchemaName = z.infer<typeof SchemaNameSchema>;

/** `sha256:` plus 64 lowercase hex characters. */
export const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
export type Digest = z.infer<typeof DigestSchema>;

/** Instance identifier; the store derives it from the creation payload. */
export const InstanceIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

/** Instance nonce carried into artifacts so a gate can prove provenance. */
export const NonceSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

export const ActorSchema = z.string().min(1).max(128);

/** A flow role an actor may be assigned to (team relay): a lower-case kebab name. */
export const RoleNameSchema = z.string().regex(KEBAB, "expected a lower-case kebab role name");
export type RoleName = z.infer<typeof RoleNameSchema>;

/** The pinned role -> authorized-actor map an instance runs under (team relay). */
export const RoleAssignmentSchema = z.record(RoleNameSchema, ActorSchema);
export type RoleAssignment = z.infer<typeof RoleAssignmentSchema>;

/** ISO-8601 instant. An explicit offset is accepted; the caller owns the value. */
export const TimestampSchema = z.iso.datetime({ offset: true });

/** Event type, dotted lower-case, e.g. `instance.created`. */
export const EventTypeSchema = z.string().regex(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/);

/**
 * One step of the flow. `consumes` names the step whose accepted artifact this
 * step receives; the first step consumes nothing.
 */
/** The value types a field may be constrained to; absent means presence only. */
export const FieldTypeSchema = z.enum(["string", "number", "boolean", "object", "array"]);
export type FieldType = z.infer<typeof FieldTypeSchema>;

/**
 * One field of a section's contract. A bare string names a field that must be present and
 * non-empty, the behaviour the slice shipped with. The object form adds, all optional and all
 * deterministic: a `type`, a human `note` carried into the brief, string/array `minLength`/
 * `maxLength`, a `pattern` the string must match, an `enum` of allowed values, and
 * `references` ("section.field") naming the set this value must be drawn from.
 */
export const FieldSpecSchema = z.union([
  z.string().min(1).max(64),
  z.strictObject({
    field: z.string().min(1).max(64),
    type: FieldTypeSchema.optional(),
    note: z.string().min(1).max(500).optional(),
    minLength: z.number().int().min(0).max(100000).optional(),
    maxLength: z.number().int().min(1).max(100000).optional(),
    pattern: z.string().min(1).max(500).optional(),
    enum: z.array(z.union([z.string(), z.number(), z.boolean()])).min(1).max(64).optional(),
    references: z.string().regex(/^[a-z][a-z0-9-]{0,63}\.[a-z][a-z0-9-]{0,63}$/, "expected section.field").optional(),
  }),
]);
export type FieldSpec = z.infer<typeof FieldSpecSchema>;

/** What a stage's document section must contain to pass (spec: stage requirement). */
export const RequirementSchema = z.strictObject({
  section: z.string().min(1).max(64),
  /** Human guidance for this section, carried into the brief; never machine-graded. */
  note: z.string().min(1).max(500).optional(),
  /** Reject any field this clause does not name (an object section or each array entry). */
  strict: z.boolean().optional(),
  minItems: z.number().int().min(0).max(1000).optional(),
  required: z.array(FieldSpecSchema).max(32).optional(),
  each: z.array(FieldSpecSchema).max(32).optional(),
  /** Exact values a section's fields must carry, e.g. verdict: "PASS". */
  equals: z
    .record(z.string().min(1).max(64), z.union([z.string(), z.number(), z.boolean()]))
    .optional(),
});
export type Requirement = z.infer<typeof RequirementSchema>;

/**
 * A stage may demand several sections at once (one document, many clauses):
 * `research.md` alone has eight. A bare clause stays valid.
 */
export const RequirementsSchema = z.union([RequirementSchema, z.array(RequirementSchema).min(1).max(16)]);
export type Requirements = z.infer<typeof RequirementsSchema>;

/** A task's declared state; only `published` may be pinned (spec R3). */
export const TaskStateSchema = z.enum(["draft", "published"]);
export type TaskState = z.infer<typeof TaskStateSchema>;

/**
 * One task document, a strict `praxis.task/v1` unit (spec R1). The task owns the
 * work; the flow owns the wiring, so there is no `consumes` and no `onRefuse`
 * here — edges carry both facts.
 */
export const TaskConfigSchema = z.strictObject({
  id: StepIdSchema,
  version: z.int().min(1),
  state: TaskStateSchema,
  /** What the agent must achieve in this stage. Required (A3). */
  goal: z.string().min(1).max(1000),
  capabilities: z.array(CapabilitySchema).max(8),
  produces: z.strictObject({ schema: SchemaNameSchema }),
  gate: GateSchema,
  /** What the document must contain before this stage may pass: one clause or many. */
  requires: RequirementsSchema.optional(),
  /** The flow role authorized to submit this step; absent means the instance creator. */
  role: RoleNameSchema.optional(),
  /** A review must carry the digest of the version it judged (spec R6). */
  bindsSubject: z.boolean().optional(),
});
export type TaskConfig = z.infer<typeof TaskConfigSchema>;

/**
 * A node's task reference: a path under `tasks/`, e.g. `tasks/research` or
 * `tasks/core/research`, never a bare id (spec R2, R3). A nested path is how one
 * library holds task families without flattening their names.
 */
export const TaskRefSchema = pathUnder("tasks");
export type TaskRef = z.infer<typeof TaskRefSchema>;

/**
 * One node of the flow: an id and the task unit it runs. The flow owns the wiring, so
 * a node carries no capability, gate or schema and a third key is refused (spec R2).
 */
export const NodeSchema = z.strictObject({ id: StepIdSchema, task: TaskRefSchema });
export type Node = z.infer<typeof NodeSchema>;

/** The three declared edge kinds (spec R7): `data`, `join`, `refuse`. */
export const EdgeKindSchema = z.enum(["data", "join", "refuse"]);
export type EdgeKind = z.infer<typeof EdgeKindSchema>;

export const EdgeSchema = z.strictObject({ kind: EdgeKindSchema, from: StepIdSchema, to: StepIdSchema });
export type Edge = z.infer<typeof EdgeSchema>;

/**
 * The library-relative path a reference names: `tasks/core/research` -> `core/research`.
 * The library file name is derived from it, so a caller never passes a path of its own
 * (spec R1, A4); a bare id is `CONFIG_INVALID`. No segment may be a dot, so a path
 * escaping the library is refused here by the contract, before any loader sees it.
 */
export function parseTaskRef(value: unknown): string {
  const ref = parseWith(TaskRefSchema, value, "CONFIG_INVALID", "task reference");
  return ref.slice(TASKS_ROOT.length);
}

/**
 * The flow is data (spec R1, R7): nodes name task units, typed edges carry the
 * wiring. `issue` is the optional issue-reporting declaration the tool's two
 * `issue.*` ops read; its shape is owned by `src/types/issue.ts`, never restated here.
 *
 * `nodes[]` is declared in execution order (A1): a `data` or `join` edge runs from a
 * lower index to a higher one, a `refuse` edge from a higher index to a lower one.
 * That ordering is what makes "acyclic" checkable without a graph library.
 */
export const FlowConfigSchema = z
  .strictObject({
    schema: z.literal("praxis.flow/v2"),
    flow: FlowNameSchema,
    nodes: z.array(NodeSchema).min(1).max(16),
    edges: z.array(EdgeSchema).max(32),
    result: SchemaNameSchema,
    issue: IssueConfigSchema.optional(),
  })
  .superRefine((config, ctx) => {
    const at = new Map<string, number>();
    config.nodes.forEach((node, index) => {
      if (at.has(node.id)) {
        ctx.addIssue({ code: "custom", message: `duplicate node id: ${node.id}`, path: ["nodes", index, "id"] });
      }
      at.set(node.id, index);
    });

    // A `data` edge is a branch: one per target, one per source (A2). A join group — two
    // or more `join` edges into one node — is a single consumption carrying several
    // sources, so it may sit beside the data edges that already chain through it.
    // Fan-out is counted per *distinct target*: a node may feed one `data` successor and
    // one join group, never two of either (A2, reviewer defect 2). A join is counted per
    // distinct source, so repeating one source is a single-source join and is refused.
    const data = new Map<string, number>();
    const dataTargets = new Map<string, Set<string>>();
    const joinTargets = new Map<string, Set<string>>();
    const joinSources = new Map<string, Set<string>>();
    config.edges.forEach((edge, index) => {
      const from = at.get(edge.from);
      const to = at.get(edge.to);
      if (from === undefined || to === undefined) {
        ctx.addIssue({
          code: "custom",
          message: `edge names a node that is not in the flow: ${edge.from}>${edge.to}`,
          path: ["edges", index],
        });
        return;
      }
      if (edge.kind === "refuse") {
        if (from <= to) {
          ctx.addIssue({
            code: "custom",
            message: `a refuse edge must go back to an earlier node: ${edge.from}>${edge.to}`,
            path: ["edges", index],
          });
        }
        return;
      }
      if (from >= to) {
        ctx.addIssue({
          code: "custom",
          message: `a ${edge.kind} edge must run from an earlier node to a later one: ${edge.from}>${edge.to}`,
          path: ["edges", index],
        });
      }
      if (edge.kind === "join") {
        const targets = joinTargets.get(edge.from) ?? new Set<string>();
        targets.add(edge.to);
        joinTargets.set(edge.from, targets);
        const sources = joinSources.get(edge.to) ?? new Set<string>();
        sources.add(edge.from);
        joinSources.set(edge.to, sources);
      } else {
        data.set(edge.to, (data.get(edge.to) ?? 0) + 1);
        const targets = dataTargets.get(edge.from) ?? new Set<string>();
        targets.add(edge.to);
        dataTargets.set(edge.from, targets);
      }
    });

    for (const [id, targets] of dataTargets) {
      if (targets.size > 1) {
        ctx.addIssue({ code: "custom", message: `fan-out: node ${id} feeds ${targets.size} data targets`, path: ["edges"] });
      }
    }
    for (const [id, targets] of joinTargets) {
      if (targets.size > 1) {
        ctx.addIssue({ code: "custom", message: `fan-out: node ${id} feeds ${targets.size} join groups`, path: ["edges"] });
      }
    }
    for (const [id, sources] of joinSources) {
      if (sources.size < 2) {
        ctx.addIssue({ code: "custom", message: `a join needs two or more distinct sources, ${id} has ${sources.size}`, path: ["edges"] });
      }
    }
    const refusals = new Map<string, number>();
    for (const edge of config.edges) {
      if (edge.kind !== "refuse") continue;
      refusals.set(edge.from, (refusals.get(edge.from) ?? 0) + 1);
    }
    for (const [id, count] of refusals) {
      if (count > 1) {
        ctx.addIssue({ code: "custom", message: `node ${id} declares ${count} refuse edges; at most one is reviewed`, path: ["edges"] });
      }
    }
    config.nodes.forEach((node, index) => {
      // One data edge, or one join group: two of either kind into one node is refused.
      const joinGroup = [...joinSources.entries()].some(([to]) => to === node.id) ? 1 : 0;
      const incoming = (data.get(node.id) ?? 0) + joinGroup;
      if (index === 0) {
        if (incoming > 0) {
          ctx.addIssue({ code: "custom", message: "the first node cannot consume an artifact", path: ["nodes", 0] });
        }
        return;
      }
      if (incoming === 0) {
        ctx.addIssue({ code: "custom", message: "every node after the first must consume an earlier artifact", path: ["nodes", index] });
      } else if (incoming > 1) {
        ctx.addIssue({ code: "custom", message: `more than one consumption edge into ${node.id}`, path: ["nodes", index] });
      }
    });
  });
export type FlowConfig = z.infer<typeof FlowConfigSchema>;

/**
 * A node composed with the task it names (spec R2, R7): composition, never a copy of
 * a task field. `sources` are the node ids this node consumes in declared edge order
 * (one for `data`, many for `join`); `refuse` is the node a refusal returns work to.
 */
export interface ResolvedNode {
  readonly node: Node;
  readonly task: TaskConfig;
  readonly sources: readonly string[];
  readonly refuse?: string;
}

/** Declared states (spec R8). `blocked` is removed: no writer exists for it. */
export const InstanceStatusSchema = z.enum(["running", "completed", "failed"]);
export type InstanceStatus = z.infer<typeof InstanceStatusSchema>;

/**
 * The mutable current state as a value. The plan's snake_case names are the store's
 * column names; `src/store/instance.ts` owns the one mapping between row and value.
 * A running instance always names a current step, so the value is never null. The flow
 * digest lives in the instance's `definition` row, not here (spec R5).
 */
export const InstanceSchema = z.strictObject({
  id: InstanceIdSchema,
  flow: FlowNameSchema,
  actor: ActorSchema,
  status: InstanceStatusSchema,
  currentStep: StepIdSchema,
  revision: z.int().min(0),
  nonce: NonceSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Instance = z.infer<typeof InstanceSchema>;

/**
 * Artifact states: a recorded version starts `pending`; `accepted` is a separate,
 * digest-verified transition. A recorded version is never rewritten (spec R4).
 */
export const ArtifactStateSchema = z.enum(["pending", "accepted"]);
export type ArtifactState = z.infer<typeof ArtifactStateSchema>;

export const ArtifactSchema = z.strictObject({
  instance: InstanceIdSchema,
  step: StepIdSchema,
  version: z.int().min(1),
  path: z.string().min(1).max(4096),
  digest: DigestSchema,
  schema: SchemaNameSchema,
  state: ArtifactStateSchema,
  derivedFrom: DigestSchema.nullable(),
  at: TimestampSchema,
});
export type Artifact = z.infer<typeof ArtifactSchema>;

/** A bounded artifact reference: no bytes, no path, no transcript. */
export const ArtifactRefSchema = z.strictObject({
  step: StepIdSchema,
  version: z.int().min(1),
  digest: DigestSchema,
  schema: SchemaNameSchema,
});
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;

/** The parent-facing result: exactly these six keys (spec R11). */
export const ResultSchema = z.strictObject({
  instanceId: InstanceIdSchema,
  flow: FlowNameSchema,
  status: InstanceStatusSchema,
  artifacts: z.array(ArtifactRefSchema),
  summary: z.string().min(1).max(4096),
  nextAction: z.string().min(1).max(1024),
});
export type Result = z.infer<typeof ResultSchema>;

/** One appended event, as listed back from the store. */
export const EventSchema = z.strictObject({
  instance: InstanceIdSchema,
  seq: z.int().min(1),
  type: EventTypeSchema,
  payload: z.unknown(),
  at: TimestampSchema,
});
export type StoredEvent = z.infer<typeof EventSchema>;

/** Flatten zod issues into a detail a caller can print without a schema handbook. */
function issues(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message }));
}

/** Parse with one schema, or fail with the given typed code. */
export function parseWith<T>(schema: z.ZodType<T>, value: unknown, code: Code, what: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw fail(code, `${what} is invalid`, issues(parsed.error));
  return parsed.data;
}

/** The two keys a node may carry; a third is `NODE_INVALID`, not a config typo. */
const NODE_KEYS: ReadonlySet<string> = new Set(["id", "task"]);

/** The undeclared key of one raw node, if it carries one. */
function nodeExtraKey(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return Object.keys(value as Record<string, unknown>).find((key) => !NODE_KEYS.has(key));
}

/**
 * Parse the flow config. A node that carries an undeclared key is `NODE_INVALID`;
 * every other refusal — unknown edge kind, cycle, duplicate id, bad reference — is
 * `CONFIG_INVALID` (spec R2, R7).
 */
export function parseFlowConfig(value: unknown): FlowConfig {
  const nodes = typeof value === "object" && value !== null ? (value as { nodes?: unknown }).nodes : undefined;
  if (Array.isArray(nodes)) {
    nodes.forEach((node, index) => {
      const extra = nodeExtraKey(node);
      if (extra !== undefined) {
        throw fail("NODE_INVALID", `flow node ${index} declares an undeclared key: ${extra}`, { node: index, key: extra });
      }
    });
  }
  const parsed = FlowConfigSchema.safeParse(value);
  if (!parsed.success) throw fail("CONFIG_INVALID", "flow config is invalid", issues(parsed.error));
  return parsed.data;
}
