/**
 * The op handlers: every operation the `praxis` tool exposes, plus the plumbing only they use
 * (path resolution, the actor label, the refusal envelope, the injected scorer and judge, the
 * quality failure feedback). The surface that Pi loads — the argument schema, the dispatcher and the
 * tool definition — stays in `tool.ts`, which imports these handlers and re-exports the names that
 * tests and fixtures import from there.
 *
 * Moved verbatim out of `tool.ts` (the 600-line split); no logic changed.
 */
import { resolve } from "node:path";
import { z } from "zod";
import { asAppError, fail, isAppError, type AppError } from "../types/errors.ts";
import { ActorSchema, QualityVerdictSchema, parseWith } from "../types/schema.ts";
import { CheckEnvelopeSchema, FailureDetailsSchema, NoteEnvelopeSchema, ReadEnvelopeSchema, RecallEnvelopeSchema, StartEnvelopeSchema, StepEnvelopeSchema } from "../types/pi.ts";
import type { FailureDetails, PraxisToolArgs } from "../types/pi.ts";
import type { VerdictSummary } from "../types/hooks.ts";
import { missingFor } from "../runner/requirements.ts";
import { ISSUE_CATEGORIES, issueTemplate } from "../types/issue.ts";
import { ISSUE_DISABLED, openIssue } from "../runner/issues.ts";
import { grantFor, requireGrant } from "../runner/capabilities.ts";
import { digest, digestOf } from "../runner/canonical.ts";
import { inspect, openFlow, qualityHistory, readStepArtifact, start } from "../runner/engine/index.ts";
import type { EngineOptions } from "../runner/engine/index.ts";
import { projectConfig, projectMaxAttempts, withStore } from "../runner/engine/support.ts";
import { afterOp, beforeOp } from "../runner/hooks.ts";
import { noteStanding, recordNote } from "../runner/note-gate.ts";
import { advanceEvaluated, briefRecall, compoundDecision, effectiveBarsFor, escalatedLesson, gateBar, jevScorer, recallRanked, type Scorer } from "../quality/index.ts";
import { anchorOf, jevAlignJudge, judgeOrder, orderDigestOf, uncheckedClause, type AlignJudge } from "../quality/jev-align.ts";
import { artifactSummary, currentStepOf, learningView, stepDescriptor } from "./descriptor.ts";
import type { PiSessionContext, PiToolResult } from "./host.ts";

export const IssueOpSchema = z.enum(["issue.template", "issue.open"]);

/** Every op the tool accepts, widened from the shared three rather than restated. */

export const IssueOpArgsSchema = z
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
export async function startOperation(args: PraxisToolArgs, ctx: PiSessionContext): Promise<PiToolResult> {
  const actor = actorFor(ctx);
  const options = engineOptions(ctx);
  const flowName = required(args.flow, "flow");
  const requestId = required(args.requestId, "requestId");
  const order = required(args.order, "order");
  // The anchor is read from the flow document this start would pin, and the judgment happens here,
  // BEFORE start(): a refusal leaves no instance, pin, event or artifact behind.
  const anchor = anchorOf(openFlow(options));
  // before_start runs at entry and BEFORE the judge it might save: a veto must cost nothing.
  await beforeOp("before_start", { op: "start", flow: flowName, requestId, orderDigest: orderDigestOf(order), anchor });
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
  // after_start: the instance exists (created or re-opened), so the outcome is a fact.
  await afterOp("after_start", { op: "start", instance: instance.id, status: instance.status, step: instance.currentStep });
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
    // The floor this attempt was judged against is the adaptive bar, not the authored threshold — and
    // the GATE caps it at the Pareto point, so the reported threshold is the one that decided.
    const bars = node === undefined || task === undefined ? undefined : effectiveBarsFor(options, node.task, effective);
    const bar = gateBar(bars?.global ?? effective.threshold, bars?.pareto);
    const statements = new Map(effective.dimensions.map((dimension) => [dimension.id, dimension.statement]));
    const dimensions = verdict.dimensions.map((dimension) => ({
      id: dimension.id,
      score: dimension.score,
      statement: statements.get(dimension.id) ?? "",
      belowThreshold: dimension.score < bar,
      // The battery's structured why for this dimension, beside the recalled exemplars (D12a). Absent
      // when the task declares no probes or the battery was unavailable — never an empty object.
      ...(dimension.rationale === undefined ? {} : { rationale: dimension.rationale }),
      ...(dimension.diagnosis === undefined ? {} : { diagnosis: dimension.diagnosis }),
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

/**
 * The recorded verdict of the step an op just acted on, as a hook summary — read from the
 * `quality.verdict` events the engine already wrote, so no engine signature changes. Absent when the
 * task declares no quality floor.
 */
function verdictSummaryOf(options: EngineOptions & { instance: string }, step: string, version: number): VerdictSummary | undefined {
  const view = inspect(options);
  // `inspect` reports the history of the CURRENT step, and an accepted submit has already advanced
  // past the step it judged, so the recorded attempts are read for that step explicitly. Read-only,
  // through the engine's own store seam: no engine signature changes.
  const attempt = withStore(options, (store) => qualityHistory(store, options.instance, step))
    .filter((entry) => entry.version === version)
    .pop();
  if (attempt === undefined) return undefined;
  const verdict = attempt.verdict;
  // Refused/flagged come from the SAME compound test the gate used, so the hook sees the decision
  // the record reflects rather than a second opinion.
  const node = view.flow.config.nodes.find((candidate) => candidate.id === step);
  const quality = node === undefined ? undefined : (view.flow.tasks.get(node.task)?.quality ?? view.flow.config.quality);
  const compound = node === undefined || quality === undefined
    ? undefined
    : compoundDecision(verdict.dimensions, effectiveBarsFor(options, node.task, quality));
  const mean = verdict.mean ?? (verdict.dimensions.length === 0
    ? 0
    : verdict.dimensions.reduce((sum, dimension) => sum + dimension.score, 0) / verdict.dimensions.length);
  return {
    score: verdict.score,
    mean: Math.round(mean * 10000) / 10000,
    dimensions: verdict.dimensions.map((dimension) => ({ id: dimension.id, score: dimension.score })),
    flagged: compound?.flagged ?? verdict.flagged ?? [],
    refused: compound?.refused ?? [],
    rubricDigest: verdict.rubricDigest,
  };
}

export async function submitOperation(args: PraxisToolArgs, ctx: PiSessionContext): Promise<PiToolResult> {
  const options = engineOptions(ctx);
  const instance = required(args.instance, "instance");
  const actor = actorFor(ctx);
  const before = inspect({ ...options, instance, actor });
  const step = before.instance.currentStep;
  const artifact = args.artifact;
  await beforeOp("before_submit", { op: "submit", instance, step, artifact, artifactDigest: digestOf(artifact === undefined ? {} : artifact) });
  try {
    const advanced = await advanceEvaluated({
      ...options,
      instance,
      artifact,
      actor,
      scorer: scorerOverride ?? jevScorer(),
    });
    const accepted = advanced.result.artifacts.find((ref) => ref.step === step);
    const verdict = verdictSummaryOf({ ...options, instance }, step, accepted === undefined ? 0 : accepted.version);
    await afterOp("after_submit", { op: "submit", instance, step, decision: "accepted", ...(verdict === undefined ? {} : { verdict }) });
    return ok(StepEnvelopeSchema, {
      result: advanced.result,
      step: stepDescriptor(advanced.flow, advanced.instance, advanced.handoffs, learningView(options, advanced.flow, advanced.instance)),
    });
  } catch (error) {
    const reviewed = qualityFeedback(error, { ...options, instance });
    if (isAppError(reviewed) && QUALITY_CODES.has(reviewed.code)) {
      // A quality refusal recorded its verdict, so it IS an outcome a composer can observe.
      const detail = reviewed.detail as { step?: string; version?: number } | undefined;
      const refusedStep = typeof detail?.step === "string" ? detail.step : step;
      const verdict = verdictSummaryOf({ ...options, instance }, refusedStep, Number(detail?.version ?? 0));
      await afterOp("after_submit", { op: "submit", instance, step: refusedStep, decision: "refused", ...(verdict === undefined ? {} : { verdict }) });
      // The refusal carries the examples for the dimensions that failed; nothing else about it changes.
      throw await recallFeedback(reviewed, { ...options, instance, actor }, refusedStep, verdict);
    }
    throw reviewed;
  }
}

/**
 * Attach the recalled passing work for the dimensions the gate refused, so a below-bar refusal arrives
 * with examples instead of only numbers. Read-only (`recallExperience` writes nothing), bounded (three
 * cases) and best effort: a cold store returns the refusal untouched rather than an empty field, and
 * any failure returns it as it was, so the typed code is never lost.
 *
 * The dimensions come from the verdict the gate itself produced (`verdictSummaryOf` runs the same
 * `compoundDecision`), falling back to the step's whole rubric when the refusal was the MEAN gate
 * alone — that refusal means "every dimension may be the reason", not "no dimension".
 */
async function recallFeedback(
  error: AppError,
  options: EngineOptions & { instance: string; actor: string },
  step: string,
  verdict: VerdictSummary | undefined,
): Promise<AppError> {
  // No recorded verdict means no below-bar judgment to point examples at (e.g. QUALITY_REQUIRED).
  if (verdict === undefined) return error;
  try {
    const detail = (typeof error.detail === "object" && error.detail !== null ? error.detail : {}) as Record<string, unknown>;
    const view = inspect({ ...options });
    const node = view.flow.config.nodes.find((candidate) => candidate.id === step);
    const task = node === undefined ? undefined : view.flow.tasks.get(node.task);
    const quality = task?.quality ?? view.flow.config.quality;
    if (quality === undefined) return error;
    const statements = new Map(quality.dimensions.map((dimension) => [dimension.id, dimension.statement]));
    const refused = verdict.refused.length === 0 ? [...statements.keys()] : verdict.refused;
    const tags = refused.filter((id) => statements.has(id));
    if (tags.length === 0) return error;
    const need = clipText(
      "passing work for " + tags.map((id) => id + ": " + (statements.get(id) ?? "")).join("; "),
      500,
    );
    const payload = await recallRanked(options, { need, tags, max: 3 });
    if (payload.cases.length === 0) return error;
    return fail(error.code, error.message, { ...detail, recall: payload });
  } catch {
    return error;
  }
}

/**
 * Record the reflection a step owes (O3/O4). The agent supplies the subjective half only; the
 * objective half is derived from the verdicts, acceptances and failures the log already holds, and
 * the provenance is stamped from this session's binding. An inadequate note is refused with typed
 * gaps while the attempt budget lasts; once it is spent the engine records a stub and the flow
 * proceeds, so the reflection is mandatory but never a deadlock.
 */
export async function noteOperation(args: PraxisToolArgs, ctx: PiSessionContext): Promise<PiToolResult> {
  const options = engineOptions(ctx);
  const actor = actorFor(ctx);
  const instance = required(args.instance, "instance");
  // The step the note is owed for, read before the op so a before_note hook sees it.
  const before = inspect({ ...options, instance, actor });
  const step = noteStanding(options, before.instance, before.flow).pending?.step ?? before.instance.currentStep;
  await beforeOp("before_note", { op: "note", instance, step, subjective: args.subjective ?? null });
  const outcome = recordNote({
    options: { ...options, instance },
    actor,
    subjective: args.subjective,
    at: new Date().toISOString(),
  });
  // Only a recorded note (real or stub) is an outcome; an inadequate note threw above and is
  // observed by the caller, not by an after_ hook.
  await afterOp("after_note", { op: "note", instance, step: outcome.step, noteVersion: outcome.noteVersion, stub: outcome.stub });
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
export async function checkOperation(args: PraxisToolArgs, ctx: PiSessionContext): Promise<PiToolResult> {
  const options = engineOptions(ctx);
  // Observer-level, like reading the descriptor: the pin is verified and the actor is observed,
  // but no step grant is consulted and no capability is gained.
  const { instance, flow } = inspect({ ...options, instance: required(args.instance, "instance"), actor: actorFor(ctx) });
  const resolved = currentStepOf(flow, instance);
  const artifact = args.artifact ?? {};
  await beforeOp("before_check", { op: "check", instance: instance.id, step: resolved.node.id, artifact, artifactDigest: digestOf(artifact) });
  const missing = resolved.task.requires === undefined ? [] : missingFor(artifact, resolved.task.requires);
  const clean = missing.length === 0;
  await afterOp("after_check", { op: "check", instance: instance.id, step: resolved.node.id, ok: clean, missing });
  return ok(CheckEnvelopeSchema, { ok: clean, missing, step: resolved.node.id });
}

/**
 * `op=recall`: the bounded experience query. The ranking, the case assembly and the bounds live in
 * `src/quality/ranker.ts`; this handler is the wiring and nothing else. Read-only: no event, no row.
 */
export async function recallOperation(args: PraxisToolArgs, ctx: PiSessionContext): Promise<PiToolResult> {
  const options = engineOptions(ctx);
  // The jev distinct-exemplar stage behind a persisted, lazily read-through cache: a fresh entry is
  // served with no model call, a cold or stale one computes once (and falls back deterministically
  // when jev is unavailable). The envelope is unchanged.
  const payload = await recallRanked(
    { ...options, instance: required(args.instance, "instance"), actor: actorFor(ctx) },
    {
      need: required(args.need, "need"),
      ...(args.tags === undefined ? {} : { tags: args.tags }),
      ...(args.max === undefined ? {} : { max: args.max }),
    },
  );
  return ok(RecallEnvelopeSchema, payload);
}

export function readOperation(args: PraxisToolArgs, ctx: PiSessionContext): PiToolResult {
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
export function issueOperation(args: IssueOpArgs, ctx: PiSessionContext): PiToolResult {
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
