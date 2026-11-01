/**
 * The flow document: nodes name task units, typed edges carry the wiring, and the strict
 * schema that admits nothing else.
 *
 * Moved out of schema.ts unchanged (file cap, AGENTS.md 3). It owns one shape each for the
 * node, the edge and the flow, and schema.ts re-exports every name below so no importer
 * moves. The three primitives the document needs while it is constructed (StepIdSchema,
 * FlowNameSchema, SchemaNameSchema) and the two shared parse helpers moved with it: a
 * module that is re-exported by schema.ts cannot import back from it without a cycle, and
 * splitting a schema from its id grammar would give one name two owners. No shape changed.
 */
import { z } from "zod";
import { fail, type Code } from "./errors.ts";
import { IssueConfigSchema } from "./issue.ts";
import { KEBAB, pathUnder } from "./paths.ts";
import { DOMAINS_PER_NODE_MAX, DomainRefSchema } from "./profile.ts";
import { QualitySchema } from "./quality.ts";
import type { TaskConfig } from "./schema.ts";

/** Step identifiers used in the flow config, event payloads and artifacts. */
export const StepIdSchema = z.string().regex(KEBAB, "expected a lower-case kebab name");
export type StepId = z.infer<typeof StepIdSchema>;

const TASKS_ROOT = "tasks/";

/**
 * Flow identity: a path under `flows/`, e.g. `flows/workflow` or `flows/core/review`,
 * built from the same segment rule a task reference uses.
 */
export const FlowNameSchema = pathUnder("flows");

/** Declared artifact/result schema name, e.g. `praxis.artifact.architecture/v1`. */
export const SchemaNameSchema = z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*\/v[1-9][0-9]*$/);
export type SchemaName = z.infer<typeof SchemaNameSchema>;

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
/** A branch option's name: the same lower-case kebab token a step id uses. */
export const LabelSchema = z.string().regex(KEBAB, "expected a lower-case kebab label");
export type Label = z.infer<typeof LabelSchema>;

/** The arms one deciding node may offer: the shared `choice` shape allows 2-8 (R2, exclusion). */
export const BRANCH_ARMS_MIN = 2;
export const BRANCH_ARMS_MAX = 8;

/**
 * What ONE node decides (D1, R2): the instructions the router answers and what each option
 * MEANS. Where each option GOES is the labelled branch edge's fact, and a load-time bijection
 * ties the two — one owner per fact, no second copy of the criteria keys.
 */
export const DecideSchema = z.strictObject({
  instructions: z.string().min(1).max(500),
  criteria: z
    .record(LabelSchema, z.string().min(1).max(500))
    .refine(
      (criteria) => Object.keys(criteria).length >= BRANCH_ARMS_MIN && Object.keys(criteria).length <= BRANCH_ARMS_MAX,
      `decide expects ${BRANCH_ARMS_MIN}-${BRANCH_ARMS_MAX} criteria`,
    ),
});
export type Decide = z.infer<typeof DecideSchema>;

/** One node: an id, the task unit it runs, and the OPTIONAL `domains` (domain injection) this step runs under. */
export const NodeSchema = z.strictObject({
  id: StepIdSchema,
  task: TaskRefSchema,
  /** The domain profiles this STEP runs under; absent means the flow-level default (then none). */
  domains: z.array(DomainRefSchema).max(DOMAINS_PER_NODE_MAX).optional(),
  /** The one-of-N router this node runs (D1, R2); absent means ordinary single-successor work. */
  decide: DecideSchema.optional(),
});
export type Node = z.infer<typeof NodeSchema>;

/** The four declared edge kinds (spec R7, R1): `data`, `join`, `branch`, `refuse`. */
export const EdgeKindSchema = z.enum(["data", "join", "branch", "refuse"]);
export type EdgeKind = z.infer<typeof EdgeKindSchema>;

export const EdgeSchema = z
  .strictObject({
    kind: EdgeKindSchema,
    from: StepIdSchema,
    to: StepIdSchema,
    /** The option this edge carries (R1): present iff the kind is `branch`, never otherwise. */
    label: LabelSchema.optional(),
  })
  .superRefine((edge, ctx) => {
    if ((edge.kind === "branch") !== (edge.label !== undefined)) {
      ctx.addIssue({
        code: "custom",
        message: edge.kind === "branch" ? "a branch edge requires a label" : `a ${edge.kind} edge carries no label`,
        path: ["label"],
      });
    }
  });
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
  /** The DOMAIN default for every step (domain injection); absent means the flow declares none. */
  domains: z.array(DomainRefSchema).max(DOMAINS_PER_NODE_MAX).optional(),
    schema: z.literal("praxis.flow/v2"),
    flow: FlowNameSchema,
    nodes: z.array(NodeSchema).min(1).max(16),
    edges: z.array(EdgeSchema).max(32),
    result: SchemaNameSchema,
    issue: IssueConfigSchema.optional(),
    /** An optional flow-level quality floor a task inherits when it declares none (quality eval). */
    quality: QualitySchema.optional(),
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
    // A branch edge is neither a data edge nor a join edge: it is exempt from both fan-out
    // counts (R3) and counted only as a MERGE SLOT by its distinct source (R4).
    const branchTargets = new Map<string, Set<string>>();
    const branchSources = new Map<string, Set<string>>();
    const branchLabels = new Map<string, string[]>();
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
      if (edge.kind === "branch") {
        const targets = branchTargets.get(edge.from) ?? new Set<string>();
        targets.add(edge.to);
        branchTargets.set(edge.from, targets);
        const sources = branchSources.get(edge.to) ?? new Set<string>();
        sources.add(edge.from);
        branchSources.set(edge.to, sources);
        branchLabels.set(edge.from, [...(branchLabels.get(edge.from) ?? []), edge.label as string]);
        return;
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
      // The router (R2): a deciding node owns 2-8 labelled arms that are exactly its criteria
      // keys, and it emits no data or join edge. A node that emits a branch edge must decide.
      const labels = branchLabels.get(node.id) ?? [];
      if (node.decide === undefined) {
        if (branchTargets.has(node.id)) {
          ctx.addIssue({ code: "custom", message: `node ${node.id} emits a branch edge without a decide block`, path: ["nodes", index] });
        }
      } else {
        if (dataTargets.has(node.id) || joinTargets.has(node.id)) {
          ctx.addIssue({ code: "custom", message: `deciding node ${node.id} also emits a data or join edge`, path: ["nodes", index] });
        }
        const criteria = Object.keys(node.decide.criteria);
        const arms = new Set(labels);
        if (arms.size !== labels.length) {
          ctx.addIssue({ code: "custom", message: `deciding node ${node.id} repeats a branch label`, path: ["nodes", index] });
        }
        if (arms.size < BRANCH_ARMS_MIN || arms.size > BRANCH_ARMS_MAX) {
          ctx.addIssue({
            code: "custom",
            message: `deciding node ${node.id} declares ${arms.size} branch arms; ${BRANCH_ARMS_MIN}-${BRANCH_ARMS_MAX} are reviewed`,
            path: ["nodes", index],
          });
        }
        const unexplained = criteria.filter((key) => !arms.has(key));
        const unlabelled = [...arms].filter((label) => !criteria.includes(label));
        if (unexplained.length > 0) {
          ctx.addIssue({ code: "custom", message: `decide criteria without a branch edge: ${unexplained.join(", ")}`, path: ["nodes", index] });
        }
        if (unlabelled.length > 0) {
          ctx.addIssue({ code: "custom", message: `branch labels without a criterion: ${unlabelled.join(", ")}`, path: ["nodes", index] });
        }
      }
      // The consumption SLOT (R4): one data edge, one join group and every DISTINCT branch
      // source into this node each cost one slot; arms of one source are a single slot.
      const joinGroup = [...joinSources.entries()].some(([to]) => to === node.id) ? 1 : 0;
      const incoming = (data.get(node.id) ?? 0) + joinGroup + (branchSources.get(node.id)?.size ?? 0);
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

/** The three keys a node may carry; a fourth is `NODE_INVALID`, not a config typo. */
/* id, task, the one dynamic conduct layer a STEP may declare, and the one router it may run. */
const NODE_KEYS: ReadonlySet<string> = new Set(["id", "task", "domains", "decide"]);

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
