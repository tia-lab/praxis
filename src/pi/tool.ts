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
import { asAppError, fail, isAppError } from "../types/errors.ts";
import { ActorSchema, QualityVerdictSchema, parseWith } from "../types/schema.ts";
import type { Artifact, Instance, ResolvedNode } from "../types/schema.ts";
import { ArtifactSummarySchema, CheckEnvelopeSchema, FailureDetailsSchema, PraxisToolArgsSchema, PraxisToolOpSchema, ReadEnvelopeSchema, StartEnvelopeSchema, StepDescriptorSchema, StepEnvelopeSchema } from "../types/pi.ts";
import { NoteEnvelopeSchema } from "../types/pi.ts";
import { missingFor } from "../runner/requirements.ts";
import type { ArtifactSummary, FailureDetails, PraxisToolArgs, StepDescriptor } from "../types/pi.ts";
import type { RecallSet } from "../types/learning.ts";
import type { Quality } from "../types/schema.ts";
import { CAPABILITY_NAMES, grantFor, requireGrant } from "../runner/capabilities.ts";
import { digest } from "../runner/canonical.ts";
import { inspect, openFlow, readStepArtifact, start } from "../runner/engine/index.ts";
import type { EngineOptions, HandoffRef, OpenedFlow } from "../runner/engine/index.ts";
import { advanceEvaluated, briefRecall, effectiveBarsFor, escalatedLesson, jevScorer, type Scorer } from "../quality/index.ts";
import { noteStanding, recordNote } from "../runner/note-gate.ts";
import { projectConfig, projectMaxAttempts } from "../runner/engine/support.ts";
import { anchorOf, jevAlignJudge, judgeOrder, uncheckedClause, type AlignJudge } from "../quality/jev-align.ts";
import { ISSUE_CATEGORIES, issueTemplate } from "../types/issue.ts";
import { ISSUE_DISABLED, openIssue } from "../runner/issues.ts";
import type { PiSessionContext, PiToolDefinition, PiToolResult } from "./host.ts";

export const PRAXIS_TOOL_NAME = "praxis";

export const PRAXIS_TOOL_DESCRIPTION = [
  "Run one step of a Praxis flow in this session.",
  "op=start opens or re-opens a flow instance and returns the six-key result, the current step descriptor and the nonce.",
  "op=submit advances exactly one step with the artifact JSON for that step.",
  "op=check dry-runs an artifact against the current step's section requirements and returns {ok, missing, step} without recording anything: no event, no attempt, no nonce or schema check.",
  "op=read returns one recorded artifact when the current step grants artifact.read.",
  "op=note submits the subjective lesson a step owes once its artifact was accepted (whatWrong, whatRight, whatBetter, dimension-keyed tags): the engine derives the objective half itself, and the step's work does not advance until the note is recorded.",
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
): Required<Pick<EngineOptions, "configPath" | "storeDir" | "tasksDir">> & Pick<EngineOptions, "defaultMaxAttempts"> {
  if (typeof ctx.cwd !== "string" || ctx.cwd === "") {
    throw fail("CONFIG_INVALID", "the host context carries no working directory");
  }
  // A project may declare more than one flow (the accepted research flow and the
  // delivery flow that mirrors docs/WORKFLOW.md). The selector is the environment,
  // never a tool argument: an agent may not choose its own gates (R1, R10).
  const selected = process.env.PRAXIS_CONFIG;
  const options: Required<Pick<EngineOptions, "configPath" | "storeDir" | "tasksDir">> & Pick<EngineOptions, "defaultMaxAttempts"> = {
    configPath:
      typeof selected === "string" && selected !== ""
        ? resolve(ctx.cwd, selected)
        : resolve(ctx.cwd, ".pi/praxis/flows/engineering/feature.json"),
    // The Pi path used to hardcode the default and so SHADOWED the environment: env first, then the
    // project's declared default, then the built-in one, all resolved against the host's cwd.
    storeDir: resolve(ctx.cwd, process.env.PRAXIS_STORE_DIR ?? projectConfig(ctx.cwd)?.defaults?.storeDir ?? ".pi/praxis/state"),
    tasksDir: resolve(ctx.cwd, ".pi/praxis/tasks"),
  };
  // The project's own defaults are loaded HERE, once, and threaded into the engine as a value: the
  // engine never reads configuration, and a broken project config falls back to the code default.
  const defaultMaxAttempts = projectMaxAttempts(ctx.cwd);
  if (defaultMaxAttempts !== undefined) options.defaultMaxAttempts = defaultMaxAttempts;
  return options;
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

/** The judging stance, in the agent's own terms (F1/O1): how a score is produced and combined. */
export const JUDGING_STANCE =
  "an independent judge scores each dimension from 0 to 1 for how fully the artifact meets its statement, given the task goal; the overall score is the MINIMUM of those dimension scores, so every dimension must clear the floor on its own; the floor is this task's current bar and may rise as its history proves stable competence";

/** What the brief discloses about the standard plus what the past teaches (F1, F3, F7). */
interface LearningView {
  bar: number | undefined;
  recall: RecallSet | undefined;
  /** The step that already reached its terminal outcome and still owes a note. */
  pending: string | undefined;
  attempts: number;
  budget: number;
}

/**
 * The learning disclosure for the current step, derived from the store on every call: the effective
 * bar (O2), the ranked recall set (O1) and whether a note is owed (O3). Nothing here is stored on
 * the descriptor, and the same store state yields the same disclosure byte for byte.
 */
function learningView(options: EngineOptions, flow: OpenedFlow, instance: Instance): LearningView {
  const resolved = currentStepOf(flow, instance);
  const quality: Quality | undefined = resolved.task.quality ?? flow.config.quality;
  const standing = noteStanding(options, instance, flow);
  const recall =
    quality === undefined
      ? undefined
      : briefRecall(options, {
          instance: instance.id,
          step: resolved.node.id,
          task: resolved.node.task,
          taskVersion: resolved.task.version,
          quality,
        });
  return {
    bar: recall?.bar,
    recall,
    pending: standing.pending?.step,
    attempts: standing.attempts,
    budget: standing.budget,
  };
}

/**
 * Derived `{id, capabilities, ops, steps, brief}` (R6): `submit` only while running
 * under `artifact.write`, `read` whenever the grant carries `artifact.read`, in that
 * order. `steps` is the pinned flow's ordered node ids, so the agent knows where it is;
 * `brief` is the current task's goal, output schema and section contract, so the agent
 * knows what to produce before its first submit instead of discovering it by rejection.
 * Both are projected from state already loaded and pinned; nothing new is read or stored.
 */
export function stepDescriptor(
  flow: OpenedFlow,
  instance: Instance,
  handoffs: readonly HandoffRef[] = [],
  learning?: LearningView,
): StepDescriptor {
  const resolved = currentStepOf(flow, instance);
  const single = handoffs.length === 1 ? handoffs[0].digest : undefined;
  const grant = grantFor({ id: resolved.node.id, capabilities: resolved.task.capabilities });
  const quality = resolved.task.quality ?? flow.config.quality;
  const ops: ("submit" | "read" | "note" | "check")[] = [];
  // A step that owes a note cannot submit: the reflection comes first (O3). The engine refuses the
  // submit anyway; saying so here means the agent learns it from the brief, not from a rejection.
  if (learning?.pending !== undefined) ops.push("note");
  else if (instance.status === "running" && grant.capabilities.has("artifact.write")) {
    ops.push("submit");
    // The dry run is offered wherever a submit is: check first, submit when it comes back clean.
    ops.push("check");
  }
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
        // The standard this step is judged against, before it submits rather than only on refusal:
        // the rubric, the floor IN FORCE (the adaptive bar, not the authored one), how the judgments
        // aggregate, how the judge works, and the lessons previous agents on this task recorded.
        ...(quality === undefined
          ? {}
          : {
              quality: {
                dimensions: quality.dimensions,
                threshold: learning?.bar ?? quality.threshold,
                policy: quality.policy,
                aggregation: "min" as const,
                judging: JUDGING_STANCE,
                ...(learning?.recall === undefined ? {} : { recall: learning.recall }),
              },
            }),
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

/**
 * The alignment judge. It defaults to the real pi-jev adapter; an injected fake replaces it so no
 * unit test can reach the network, and `undefined` restores the default.
 */
let alignJudgeOverride: AlignJudge | undefined;

/** Replace the alignment judge; `undefined` restores the pi-jev default. */
export function setAlignJudgeForTest(judge: AlignJudge | undefined): void {
  alignJudgeOverride = judge;
}

/**
 * The alignment gate (routing hygiene, not isolation and not identity): the order the agent was
 * handed is judged against the task the flow will run, BEFORE anything is written. Three outcomes:
 * `aligned` proceeds untouched; `misaligned` refuses with ALIGNMENT_REJECTED and writes nothing;
 * `unavailable` proceeds with a VISIBLE flag (descriptor + summary clause), because a model outage
 * must not halt every start. Only a genuine misalignment refuses.
 */
async function startOperation(args: PraxisToolArgs, ctx: PiSessionContext): Promise<PiToolResult> {
  const actor = actorFor(ctx);
  const options = engineOptions(ctx);
  const flowName = required(args.flow, "flow");
  const requestId = required(args.requestId, "requestId");
  const order = required(args.order, "order");
  // The anchor is read from the flow document this start would pin, and the judgment happens here,
  // BEFORE start(): a refusal leaves no instance, pin, event or artifact behind.
  const anchor = anchorOf(openFlow(options));
  const verdict = await judgeOrder(alignJudgeOverride ?? jevAlignJudge(), { order, anchor });
  if (verdict.decision === "misaligned") {
    throw fail("ALIGNMENT_REJECTED", "the order does not belong to the task this flow runs", {
      decision: verdict.decision,
      reason: clipText(verdict.reason, 400),
      model: verdict.model,
      orderDigest: verdict.orderDigest,
      anchor,
    });
  }
  const started = start({ ...options, flow: flowName, requestId, actor, ...(args.roles !== undefined ? { roles: args.roles } : {}) });
  const { instance, result, flow, handoffs } = inspect({ ...options, instance: started.instance.id, actor });
  const step = stepDescriptor(flow, instance, handoffs, learningView(options, flow, instance));
  if (verdict.decision === "aligned") {
    return ok(StartEnvelopeSchema, { result, step, nonce: instance.nonce });
  }
  // Judged unavailable: proceed, and make it VISIBLE to both parties without adding a result key.
  const flag = { decision: "unchecked" as const, reason: clipText(verdict.reason, 400), orderDigest: verdict.orderDigest };
  return ok(StartEnvelopeSchema, {
    result: { ...result, summary: clipText(result.summary + uncheckedClause(verdict), 4096) },
    step: { ...step, alignment: flag },
    nonce: instance.nonce,
  });
}

/** Keep a derived string inside the field's own bound. */
function clipText(text: string, limit: number): string {
  return text.length <= limit ? text : text.slice(0, limit - 1) + "\u2026";
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

/** The codes a quality floor can refuse with; only these carry per-dimension feedback. */
const QUALITY_CODES: ReadonlySet<string> = new Set(["QUALITY_REQUIRED", "QUALITY_BELOW_THRESHOLD", "QUALITY_BLOCKED"]);

/**
 * Turn a quality refusal into actionable feedback: the typed verdict plus the rubric's own
 * dimension statements, so the agent learns which named dimensions are below the floor and by
 * how much, and can fix those. Praxis reports the standard it measured against; it never
 * authors remediation prose. Best effort — a failure that cannot be re-read is passed through
 * untouched, so the typed code is never lost (R8).
 */
function qualityFeedback(error: unknown, options: EngineOptions & { instance: string }): unknown {
  if (!isAppError(error) || !QUALITY_CODES.has(error.code)) return error;
  const detail = error.detail;
  if (typeof detail !== "object" || detail === null) return error;
  const parsed = QualityVerdictSchema.safeParse((detail as { quality?: unknown }).quality);
  if (!parsed.success) return error;
  const verdict = parsed.data;
  try {
    const view = inspect({ ...options });
    // The step that refused, not necessarily the current one: a refuse edge has already sent the
    // work back, and the rubric to report on is the one that judged the artifact.
    const refused = (detail as { step?: unknown }).step;
    const step = typeof refused === "string" ? refused : view.instance.currentStep;
    const node = view.flow.config.nodes.find((candidate) => candidate.id === step);
    const task = node === undefined ? undefined : view.flow.tasks.get(node.task);
    const effective = task?.quality ?? view.flow.config.quality;
    if (effective === undefined) return error;
    // The floor this attempt was judged against is the adaptive bar, not the authored threshold.
    const bar = node === undefined || task === undefined ? effective.threshold : effectiveBarsFor(options, node.task, effective).global;
    const statements = new Map(effective.dimensions.map((dimension) => [dimension.id, dimension.statement]));
    const dimensions = verdict.dimensions.map((dimension) => ({
      id: dimension.id,
      score: dimension.score,
      statement: statements.get(dimension.id) ?? "",
      belowThreshold: dimension.score < bar,
    }));
    const weakest = dimensions.length === 0 ? undefined : dimensions.reduce((low, current) => (current.score < low.score ? current : low));
    // Escalating re-injection (O1): the refusal points at the single best-recorded lesson for the
    // dimension that cost the most, instead of repeating the same flat feedback.
    const lesson =
      weakest === undefined || node === undefined || task === undefined
        ? undefined
        : escalatedLesson(
            briefRecall(options, {
              instance: view.instance.id,
              step,
              task: node.task,
              taskVersion: task.version,
              quality: effective,
            }),
            weakest.id,
          );
    return fail(error.code, error.message, {
      ...(detail as Record<string, unknown>),
      quality: {
        overall: verdict.score,
        threshold: bar,
        policy: effective.policy,
        dimensions,
        weakest,
        rationale: verdict.rationale,
        source: verdict.source,
        scorer: verdict.scorer,
        ...(lesson === undefined ? {} : { lesson }),
      },
    });
  } catch {
    return error;
  }
}

/**
 * Submit one artifact. Scoring happens in `advanceEvaluated`, outside any store transaction,
 * and only when the pinned task declares an effective quality floor and holds `evaluate`;
 * the engine then records the verdict and enforces the floor in the same synchronous advance.
 * A quality refusal reaches the agent with the named dimensions and their scores, and the
 * attempt budget and no-progress rule live in the engine (they are bounds, not prompt text).
 */
async function submitOperation(args: PraxisToolArgs, ctx: PiSessionContext): Promise<PiToolResult> {
  const options = engineOptions(ctx);
  const instance = required(args.instance, "instance");
  try {
    const advanced = await advanceEvaluated({
      ...options,
      instance,
      artifact: args.artifact,
      actor: actorFor(ctx),
      scorer: scorerOverride ?? jevScorer(),
    });
    return ok(StepEnvelopeSchema, {
      result: advanced.result,
      step: stepDescriptor(advanced.flow, advanced.instance, advanced.handoffs, learningView(options, advanced.flow, advanced.instance)),
    });
  } catch (error) {
    throw qualityFeedback(error, { ...options, instance });
  }
}

/**
 * Record the reflection a step owes (O3/O4). The agent supplies the subjective half only; the
 * objective half is derived from the verdicts, acceptances and failures the log already holds, and
 * the provenance is stamped from this session's binding. An inadequate note is refused with typed
 * gaps while the attempt budget lasts; once it is spent the engine records a stub and the flow
 * proceeds, so the reflection is mandatory but never a deadlock.
 */
function noteOperation(args: PraxisToolArgs, ctx: PiSessionContext): PiToolResult {
  const options = engineOptions(ctx);
  const actor = actorFor(ctx);
  const instance = required(args.instance, "instance");
  const outcome = recordNote({
    options: { ...options, instance },
    actor,
    subjective: args.subjective,
    at: new Date().toISOString(),
  });
  const view = inspect({ ...options, instance, actor });
  return ok(NoteEnvelopeSchema, {
    result: view.result,
    step: stepDescriptor(view.flow, view.instance, view.handoffs, learningView(options, view.flow, view.instance)),
    note: {
      step: outcome.step,
      noteVersion: outcome.noteVersion,
      stub: outcome.stub,
      ...(outcome.missing === undefined ? {} : { missing: outcome.missing }),
    },
  });
}

/**
 * The dry run (`op=check`): validate an artifact's SECTIONS against the current step's declared
 * `requires` before spending a submit. Stateless and read-only on purpose — it records nothing, so
 * it writes no event, advances nothing, scores nothing, consumes no quality attempt and does not
 * enforce the nonce or the schema. It reports exactly what the synchronous section gate would say.
 */
function checkOperation(args: PraxisToolArgs, ctx: PiSessionContext): PiToolResult {
  const options = engineOptions(ctx);
  // Observer-level, like reading the descriptor: the pin is verified and the actor is observed,
  // but no step grant is consulted and no capability is gained.
  const { instance, flow } = inspect({ ...options, instance: required(args.instance, "instance"), actor: actorFor(ctx) });
  const resolved = currentStepOf(flow, instance);
  const missing = resolved.task.requires === undefined ? [] : missingFor(args.artifact ?? {}, resolved.task.requires);
  return ok(CheckEnvelopeSchema, { ok: missing.length === 0, missing, step: resolved.node.id });
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
    // `await`, not `return`: an async rejection must reach the catch below (R8: never reject).
    if (parsed.op === "start") return await startOperation(parsed, ctx);
    // `await`, not `return`: an async rejection must reach the catch below (R8: never reject).
    if (parsed.op === "submit") return await submitOperation(parsed, ctx);
    if (parsed.op === "note") return noteOperation(parsed, ctx);
    if (parsed.op === "check") return checkOperation(parsed, ctx);
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
