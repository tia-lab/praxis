/**
 * The `praxis` tool: one bounded surface over the accepted Slice 0 engine (R1-R13).
 *
 * Three flow operations plus two issue operations over one argument surface: `start`
 * opens or re-opens the instance a request id names and returns the six-key result with
 * the derived step descriptor and the pinned nonce; `submit` scores the artifact first when the
 * current task declares a quality floor, then calls `advance` exactly once through
 * `advanceEvaluated`; `read` returns one recorded artifact, and only after the current step's grant
 * allows `artifact.read`; `issue.template` and `issue.open` read the flow's optional
 * `issue` block and delegate to the writer in `src/runner/issues.ts`.
 *
 * The descriptor is derived from the pinned flow and the instance on every call and
 * is never stored (R6). Every operation failure leaves through one typed `isError`
 * result built from `src/types/errors.ts`; a failed instance state is not an
 * operation failure and travels inside a successful six-key result (R8, R13).
 *
 * Limit, stated plainly: the guard here constrains calls routed through this tool.
 * It does not block `bash`, `read`, Fabric, MCP, another extension or a new session,
 * and claims no isolation, sandbox or trusted identity (R10, R11; gate #1 stays open).
 */
import { resolve } from "node:path";
import { z } from "zod";
import { asAppError, fail } from "../types/errors.ts";
import { ActorSchema, parseWith } from "../types/schema.ts";
import type { Artifact, Instance, ResolvedNode } from "../types/schema.ts";
import { ArtifactSummarySchema, FailureDetailsSchema, PraxisToolArgsSchema, PraxisToolOpSchema, ReadEnvelopeSchema, StartEnvelopeSchema, StepDescriptorSchema, StepEnvelopeSchema } from "../types/pi.ts";
import type { ArtifactSummary, FailureDetails, PraxisToolArgs, StepDescriptor } from "../types/pi.ts";
import { CAPABILITY_NAMES, grantFor, requireGrant } from "../runner/capabilities.ts";
import { digest } from "../runner/canonical.ts";
import { inspect, openFlow, readStepArtifact, start } from "../runner/engine.ts";
import type { EngineOptions, HandoffRef, OpenedFlow } from "../runner/engine.ts";
import { advanceEvaluated, jevScorer, type Scorer } from "../quality/index.ts";
import { ISSUE_CATEGORIES, issueTemplate } from "../types/issue.ts";
import { ISSUE_DISABLED, openIssue } from "../runner/issues.ts";
import type { PiSessionContext, PiToolDefinition, PiToolResult } from "./host.ts";

export const PRAXIS_TOOL_NAME = "praxis";

export const PRAXIS_TOOL_DESCRIPTION = [
  "Run one step of a Praxis flow in this session.",
  "op=start opens or re-opens a flow instance and returns the six-key result, the current step descriptor and the nonce.",
  "op=submit advances exactly one step with the artifact JSON for that step.",
  "op=read returns one recorded artifact when the current step grants artifact.read.",
  "op=issue.template returns the field spec a report for one category must answer; op=issue.open files that report through the project's configured issue block.",
  "Only calls routed through this tool are gated by the step grant: other tools are not blocked and no isolation is claimed.",
].join(" ");

/** The two issue ops; the writer in `src/runner/issues.ts` owns their semantics. */
const IssueOpSchema = z.enum(["issue.template", "issue.open"]);

/** Every op the tool accepts, widened from the shared three rather than restated. */
const PraxisOpSchema = z.enum([...PraxisToolOpSchema.options, ...IssueOpSchema.options]);

/**
 * What the host declares: the shared argument shape plus the issue ops. The three
 * original ops are still parsed by `PraxisToolArgsSchema` itself, so their per-op
 * requirements keep their single owner.
 */
const PraxisHostArgsSchema = z.strictObject({
  ...PraxisToolArgsSchema.shape,
  op: PraxisOpSchema,
  category: z.enum(ISSUE_CATEGORIES).optional(),
  title: z.string().min(1).max(120).optional(),
  summary: z.string().min(1).max(2000).optional(),
  severity: z.enum(["blocker", "major", "minor"]).optional(),
  affected: z.string().min(1).max(512).optional(),
  evidence: z.string().min(1).max(32768).optional(),
  categoryFields: z.record(z.string(), z.string().min(1).max(4096)).optional(),
});

/** The host parameters, generated from Zod (no hand-written schema). */
export const PRAXIS_TOOL_PARAMETERS = z.toJSONSchema(PraxisHostArgsSchema, {
  target: "draft-2020-12",
});

/** `issue.open` arguments: the common fields, plus the category's own under `categoryFields`. */
const IssueOpArgsSchema = z
  .strictObject({
    op: IssueOpSchema,
    category: z.enum(ISSUE_CATEGORIES),
    title: z.string().min(1).max(120).optional(),
    summary: z.string().min(1).max(2000).optional(),
    severity: z.enum(["blocker", "major", "minor"]).optional(),
    affected: z.string().min(1).max(512).optional(),
    evidence: z.string().min(1).max(32768).optional(),
    categoryFields: z.record(z.string(), z.string().min(1).max(4096)).optional(),
  })
  .superRefine((args, ctx) => {
    if (args.op !== "issue.open") return;
    for (const field of ["title", "summary", "severity", "affected", "evidence"] as const) {
      if (args[field] === undefined) ctx.addIssue({ code: "custom", path: [field], message: `issue.open requires ${field}` });
    }
  });
type IssueOpArgs = z.infer<typeof IssueOpArgsSchema>;

/** Wire envelopes for the two issue ops; the writer owns the shapes they carry. */
const IssueTemplateEnvelopeSchema = z.strictObject({
  template: z.strictObject({ category: z.string().min(1), fields: z.array(z.strictObject({ name: z.string().min(1), required: z.boolean() })) }),
});
const IssueReportEnvelopeSchema = z.strictObject({ issue: z.strictObject({ file: z.string().min(1), id: z.string().min(1) }) });

/**
 * Resolve the engine paths under the host session's cwd, never `process.cwd()`:
 * a caller's project root is the host context's, not this module's (R3, R5, G3-F6).
 */
export function engineOptions(
  ctx: PiSessionContext,
): Required<Pick<EngineOptions, "configPath" | "storeDir" | "tasksDir">> {
  if (typeof ctx.cwd !== "string" || ctx.cwd === "") {
    throw fail("CONFIG_INVALID", "the host context carries no working directory");
  }
  // A project may declare more than one flow (the accepted research flow and the
  // delivery flow that mirrors docs/WORKFLOW.md). The selector is the environment,
  // never a tool argument: an agent may not choose its own gates (R1, R10).
  const selected = process.env.PRAXIS_CONFIG;
  return {
    configPath:
      typeof selected === "string" && selected !== ""
        ? resolve(ctx.cwd, selected)
        : resolve(ctx.cwd, ".pi/praxis/flows/engineering/feature.json"),
    storeDir: resolve(ctx.cwd, ".pi/praxis/state"),
    tasksDir: resolve(ctx.cwd, ".pi/praxis/tasks"),
  };
}

/** First 32 hex of sha256 over `session:` + id, with the `sha256:` prefix removed. */
function shortDigest(sessionId: string): string {
  return digest("session:" + sessionId).slice(7, 39);
}

/**
 * The actor is a correlation label derived from the host session, never from tool
 * arguments (R10). `start` uses it to decide re-open versus conflict; `submit` and
 * `read` are bound by the instance and the step grant. No authorization decision
 * may rely on it: gate #3 stays open.
 */
export function actorFor(ctx: PiSessionContext): string {
  const sessionId = ctx.sessionManager?.getSessionId?.();
  if (typeof sessionId !== "string" || sessionId === "") {
    throw fail("CONFIG_INVALID", "the host session has no id to label the actor", {
      source: "sessionManager.getSessionId",
    });
  }
  return parseWith(ActorSchema, "pi-session:" + shortDigest(sessionId), "CONFIG_INVALID", "actor label");
}

/** The current node of the pinned flow, resolved against its task unit, or a refusal. */
function currentStepOf(flow: OpenedFlow, instance: Instance): ResolvedNode {
  const node = flow.config.nodes.find((candidate) => candidate.id === instance.currentStep);
  if (node === undefined) {
    throw fail("CONFIG_INVALID", "current step " + JSON.stringify(instance.currentStep) + " is not in the pinned flow", {
      instance: instance.id,
      step: instance.currentStep,
      path: flow.path,
    });
  }
  const task = flow.tasks.get(node.task);
  if (task === undefined) {
    throw fail("PIN_MISSING", "the pinned flow names a task that has no pinned row", {
      instance: instance.id,
      node: node.id,
      task: node.task,
    });
  }
  const sources = flow.config.edges
    .filter((edge) => (edge.kind === "data" || edge.kind === "join") && edge.to === node.id)
    .map((edge) => edge.from);
  const refuse = flow.config.edges.find((edge) => edge.kind === "refuse" && edge.from === node.id)?.to;
  return refuse === undefined ? { node, task, sources } : { node, task, sources, refuse };
}

/**
 * Derived `{id, capabilities, ops, steps, brief}` (R6): `submit` only while running
 * under `artifact.write`, `read` whenever the grant carries `artifact.read`, in that
 * order. `steps` is the pinned flow's ordered node ids, so the agent knows where it is;
 * `brief` is the current task's goal, output schema and section contract, so the agent
 * knows what to produce before its first submit instead of discovering it by rejection.
 * Both are projected from state already loaded and pinned; nothing new is read or stored.
 */
export function stepDescriptor(flow: OpenedFlow, instance: Instance, handoffs: readonly HandoffRef[] = []): StepDescriptor {
  const resolved = currentStepOf(flow, instance);
  const single = handoffs.length === 1 ? handoffs[0].digest : undefined;
  const grant = grantFor({ id: resolved.node.id, capabilities: resolved.task.capabilities });
  const ops: ("submit" | "read")[] = [];
  if (instance.status === "running" && grant.capabilities.has("artifact.write")) ops.push("submit");
  if (grant.capabilities.has("artifact.read")) ops.push("read");
  return parseWith(
    StepDescriptorSchema,
    {
      id: grant.step,
      capabilities: CAPABILITY_NAMES.filter((name) => grant.capabilities.has(name)),
      ops,
      steps: flow.config.nodes.map((node) => node.id),
      brief: {
        goal: resolved.task.goal,
        produces: resolved.task.produces.schema,
        ...(resolved.task.requires !== undefined ? { requires: resolved.task.requires } : {}),
        ...(resolved.task.bindsSubject !== undefined ? { bindsSubject: resolved.task.bindsSubject } : {}),
        ...(handoffs.length > 0 ? { consumes: handoffs.map((handoff) => ({ step: handoff.step, schema: handoff.schema, digest: handoff.digest })) } : {}),
        ...(single !== undefined ? { derivedFrom: single } : {}),
        ...(single !== undefined && resolved.task.bindsSubject === true ? { subject: single } : {}),
      },
    },
    "RESULT_INVALID",
    "step descriptor",
  );
}

/** The store row minus its path and bytes: what the parent is allowed to see (R7). */
function artifactSummary(artifact: Artifact): ArtifactSummary {
  return parseWith(
    ArtifactSummarySchema,
    {
      step: artifact.step,
      version: artifact.version,
      digest: artifact.digest,
      schema: artifact.schema,
      state: artifact.state,
    },
    "RESULT_INVALID",
    "artifact summary",
  );
}

/** A validated success envelope: `content` is the JSON text of the same `details` (R7). */
export function ok(schema: z.ZodType, details: unknown): PiToolResult {
  const parsed = schema.safeParse(details);
  if (!parsed.success) {
    throw fail(
      "RESULT_INVALID",
      "tool envelope is invalid",
      parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message })),
    );
  }
  return { content: [{ type: "text", text: JSON.stringify(parsed.data) }], details: parsed.data };
}

/** A typed operation failure (R8): `AppError` passes through, anything else is INTERNAL. */
export function failure(error: unknown): PiToolResult {
  const appError = asAppError(error);
  let details: FailureDetails;
  try {
    details = FailureDetailsSchema.parse(
      appError.detail === undefined
        ? { code: appError.code, message: appError.message }
        : { code: appError.code, message: appError.message, detail: appError.detail },
    );
  } catch {
    details = { code: appError.code, message: appError.message };
  }
  return { content: [{ type: "text", text: JSON.stringify(details) }], details, isError: true };
}

function required(value: string | undefined, what: string): string {
  if (value === undefined || value === "") {
    throw fail("CONFIG_INVALID", what + " is required");
  }
  return value;
}

function startOperation(args: PraxisToolArgs, ctx: PiSessionContext): PiToolResult {
  const actor = actorFor(ctx);
  const options = engineOptions(ctx);
  const started = start({
    ...options,
    flow: required(args.flow, "flow"),
    requestId: required(args.requestId, "requestId"),
    actor,
    ...(args.roles !== undefined ? { roles: args.roles } : {}),
  });
  const { instance, result, flow, handoffs } = inspect({ ...options, instance: started.instance.id, actor });
  return ok(StartEnvelopeSchema, {
    result,
    step: stepDescriptor(flow, instance, handoffs),
    nonce: instance.nonce,
  });
}

/**
 * The submit-path scorer. It defaults to the real pi-jev adapter; an injected fake replaces it
 * so no unit test can reach the network, and `undefined` restores the default. The TypeSafe
 * credential is read by pi-jev itself and never appears here.
 */
let scorerOverride: Scorer | undefined;

/** Replace the submit-path scorer; `undefined` restores the pi-jev default. */
export function setScorerForTest(scorer: Scorer | undefined): void {
  scorerOverride = scorer;
}

/**
 * Submit one artifact. Scoring happens in `advanceEvaluated`, outside any store transaction,
 * and only when the pinned task declares an effective quality floor and holds `evaluate`;
 * the engine then records the verdict and enforces the floor in the same synchronous advance.
 */
async function submitOperation(args: PraxisToolArgs, ctx: PiSessionContext): Promise<PiToolResult> {
  const options = engineOptions(ctx);
  const advanced = await advanceEvaluated({
    ...options,
    instance: required(args.instance, "instance"),
    artifact: args.artifact,
    actor: actorFor(ctx),
    scorer: scorerOverride ?? jevScorer(),
  });
  return ok(StepEnvelopeSchema, {
    result: advanced.result,
    step: stepDescriptor(advanced.flow, advanced.instance, advanced.handoffs),
  });
}

function readOperation(args: PraxisToolArgs, ctx: PiSessionContext): PiToolResult {
  const options = engineOptions(ctx);
  const actor = actorFor(ctx);
  // R5: the pinned definition rows are read and verified inside `inspect`, so the read
  // path never opens the library and a corrupted pin surfaces here as PIN_CORRUPT.
  const { instance, flow } = inspect({ ...options, instance: required(args.instance, "instance"), actor });
  const resolved = currentStepOf(flow, instance);
  // R5: the current node's grant decides, before any artifact is opened.
  requireGrant(grantFor({ id: resolved.node.id, capabilities: resolved.task.capabilities }), "artifact.read");
  const read = readStepArtifact({
    ...options,
    instance: instance.id,
    step: required(args.step, "step"),
    actor,
  });
  return ok(ReadEnvelopeSchema, { artifact: artifactSummary(read.artifact), value: read.value });
}

/**
 * The two issue ops: read the pinned flow's `issue` block, then either return the
 * category's field spec or hand the report to `openIssue`, which validates every
 * template field and writes atomically. A project without an active block fails
 * `ISSUE_DISABLED`; an unknown or disabled category is `CONFIG_INVALID`. The
 * reporter is this session's correlation label, never a tool argument (R10).
 */
function issueOperation(args: IssueOpArgs, ctx: PiSessionContext): PiToolResult {
  const flow = openFlow(engineOptions(ctx));
  const config = flow.config.issue;
  const enabled: readonly string[] = config?.active === true ? (config.categories ?? ISSUE_CATEGORIES) : [];
  if (!enabled.includes(args.category)) {
    throw config?.active === true
      ? fail("CONFIG_INVALID", "issue category is not enabled: " + JSON.stringify(args.category), { enabled: [...enabled] })
      : fail(ISSUE_DISABLED, "issue reporting is not enabled for this project", { active: config?.active ?? false });
  }
  if (args.op === "issue.template") {
    return ok(IssueTemplateEnvelopeSchema, { template: issueTemplate(args.category) });
  }
  const report = openIssue(
    config,
    {
      category: args.category,
      title: args.title,
      summary: args.summary,
      severity: args.severity,
      affected: args.affected,
      evidence: args.evidence,
      ...(args.categoryFields ?? {}),
    },
    { agent: actorFor(ctx) },
  );
  return ok(IssueReportEnvelopeSchema, { issue: report });
}

/** Parse the arguments, dispatch one operation, and never throw or reject (R2, R8). */
export async function executePraxisTool(args: unknown, ctx: PiSessionContext): Promise<PiToolResult> {
  try {
    const op = (args as { op?: unknown } | null | undefined)?.op;
    if (op === "issue.template" || op === "issue.open") {
      return issueOperation(parseWith(IssueOpArgsSchema, args, "CONFIG_INVALID", "praxis arguments"), ctx);
    }
    const parsed = parseWith(PraxisToolArgsSchema, args, "CONFIG_INVALID", "praxis arguments");
    if (parsed.op === "start") return startOperation(parsed, ctx);
    // `await`, not `return`: an async rejection must reach the catch below (R8: never reject).
    if (parsed.op === "submit") return await submitOperation(parsed, ctx);
    return readOperation(parsed, ctx);
  } catch (error) {
    return failure(error);
  }
}

/** The one tool definition the extension registers, in the host's own shape (R1, R4). */
export function createPraxisTool(): PiToolDefinition {
  return {
    name: PRAXIS_TOOL_NAME,
    label: "Praxis",
    description: PRAXIS_TOOL_DESCRIPTION,
    parameters: PRAXIS_TOOL_PARAMETERS,
    executionMode: "sequential",
    async execute(
      _toolCallId: string,
      params: unknown,
      _signal: AbortSignal | undefined,
      _onUpdate: ((partial: PiToolResult) => void) | undefined,
      ctx: PiSessionContext,
    ): Promise<PiToolResult> {
      return executePraxisTool(params, ctx);
    },
  };
}
