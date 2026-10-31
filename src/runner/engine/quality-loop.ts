/**
 * The quality loop: the failure record and the onFailure policy. Attempt counts, the previous
 * score, the carried version and the reason are all derived from the event log, so nothing here
 * adds a store column. Neither branch ever fabricates a pass verdict.
 */
import { fail, type AppError } from "../../types/errors.ts";
import {
  QualityVerdictSchema,
  parseWith,
  type Instance,
  type Quality,
  type QualityVerdict,
  type TaskConfig,
} from "../../types/schema.ts";
import type { Store } from "../../store/db.ts";
import { acceptArtifact } from "../../store/artifacts.ts";
import { appendEvent, listEvents } from "../../store/events.ts";
import { setStatus } from "../../store/instance.ts";
import { traceOf, type Grant } from "../capabilities.ts";
import type { Handoff, Verdict } from "../step.ts";
import { recomputeBar, type QuantileBars } from "../../quality/bar.ts";
import { ABSOLUTE_MIN } from "./types.ts";
import { writeNote } from "../note-gate.ts";
import { payloadOf } from "./support.ts";
import { DEFAULT_MAX_ATTEMPTS, DEFAULT_ON_FAILURE, EVENT, type QualityAttempt } from "./types.ts";

/**
 * Every recorded quality attempt for one step, in append order, derived from the event log.
 * The attempt budget, the no-progress rule and the digest score-cache all read this one
 * function: the event log is the only owner of the fact, so no store column is added and a
 * reopened store counts exactly the same attempts.
 */
export function qualityHistory(store: Store, instance: string, step: string): QualityAttempt[] {
  const attempts: QualityAttempt[] = [];
  for (const event of listEvents(store, instance)) {
    if (event.type !== EVENT.qualityVerdict) continue;
    const payload = payloadOf(event.payload);
    if (payload.step !== step) continue;
    attempts.push({
      step,
      version: Number(payload.version),
      artifactDigest: String(payload.artifactDigest),
      verdict: parseWith(
        QualityVerdictSchema,
        {
          decision: payload.decision,
          score: payload.score,
          dimensions: payload.dimensions,
          // S2: the judge's uncertainty is recorded evidence; a re-read must not drop it (R14, R17).
          ...(payload.torn === undefined ? {} : { torn: payload.torn }),
          // T3: the anchor is what the score cache compares, so a re-read that dropped it would make
          // every anchored resubmit a miss (R18) and lose the anchor from the brief (R17).
          ...(payload.anchored === undefined ? {} : { anchored: payload.anchored }),
          ...(payload.anchorDigest === undefined ? {} : { anchorDigest: payload.anchorDigest }),
          // S6: the provisional report is recorded evidence too; a re-read must not drop it (R35).
          ...(payload.provisional === undefined ? {} : { provisional: payload.provisional }),
          ...(payload.provisionalOn === undefined ? {} : { provisionalOn: payload.provisionalOn }),
          rationale: payload.rationale,
          rubricDigest: payload.rubricDigest,
          scorer: payload.scorer,
          source: payload.source,
        },
        "STORE_INVALID",
        "recorded quality verdict",
      ),
    });
  }
  return attempts;
}

/**
 * The reason a failed instance carries, read back from its own `instance.failed` event.
 * Derived on read: the instance row has no column for it, so the event log stays the one
 * owner of the fact and an escalated instance reads the same before and after a restart.
 */
function failedReasonOf(store: Store, instance: Instance): string | undefined {
  let reason: string | undefined;
  for (const event of listEvents(store, instance.id)) {
    if (event.type !== EVENT.instanceFailed) continue;
    const payload = payloadOf(event.payload);
    if (typeof payload.reason === "string") reason = payload.reason;
  }
  return reason;
}

/** The instance value the parent sees: the row, plus its derived failure reason when it has one. */
export function withFailedReason(store: Store, instance: Instance): Instance {
  const reason = failedReasonOf(store, instance);
  return reason === undefined ? instance : { ...instance, failedReason: reason };
}

/**
 * The deterministic reason recorded when a step cannot reach its floor: the rule that fired, the
 * score, the floor and the rubric's own dimension ids below it. Praxis writes no remediation
 * prose — the per-dimension detail travels in the failure, and the agent decides how to fix it.
 */
function failedReasonFor(args: {
  step: string;
  attempts: number;
  maxAttempts: number;
  bars: QuantileBars;
  verdict: QualityVerdict;
  previous?: QualityAttempt;
}): string {
  const score = args.verdict.score.toFixed(2);
  const previous = args.previous;
  let cause: string;
  if (args.verdict.decision === "unavailable") {
    cause = "no score available (" + args.verdict.source + ") after " + args.attempts + " attempt(s)";
  } else if (previous !== undefined && args.verdict.score <= previous.verdict.score) {
    cause = "no progress: attempt " + args.attempts + " scored " + score + ", not above the previous " +
      previous.verdict.score.toFixed(2);
  } else {
    cause = "attempt budget of " + args.maxAttempts + " exhausted at attempt " + args.attempts;
  }
  // The PURE AND: name every dimension that fell below its own measured bar. Numbers, never prose
  // the agent must guess, and no mean or Pareto claim the gate did not apply.
  const barOf = (id: string): number => args.bars.perDimension.get(id) ?? ABSOLUTE_MIN;
  const below = args.verdict.dimensions.filter((dimension) => dimension.score < barOf(dimension.id));
  const named =
    below.length === 0
      ? ""
      : "; below its bar: " +
        below
          .map((dimension) => dimension.id + " " + dimension.score.toFixed(2) + " < " + barOf(dimension.id).toFixed(2))
          .join(", ");
  return cause + "; step " + JSON.stringify(args.step) + " scored " + score + named;
}

/**
 * Was the first failing check the quality floor? The gate runs every deterministic check before the
 * floor, so a QUALITY_* code proves the artifact was well formed and only the judgment fell short —
 * the one case an onFailure policy may carry forward. A malformed or incomplete artifact still
 * refuses, exactly as it did before the policy existed.
 */
export function qualityRefusal(verdict: Verdict): verdict is Verdict & { quality: QualityVerdict } {
  if (verdict.quality === undefined) return false;
  return verdict.code === "QUALITY_BELOW_THRESHOLD" || verdict.code === "QUALITY_REQUIRED";
}

/** The bounded tail of the attempt history a refusal carries: scores, never artifact bytes. */
function historyView(history: readonly QualityAttempt[]): { version: number; artifactDigest: string; decision: string; score: number }[] {
  return history.map((attempt) => ({
    version: attempt.version,
    artifactDigest: attempt.artifactDigest,
    decision: attempt.verdict.decision,
    score: attempt.verdict.score,
  }));
}

/** The best-scoring recorded attempt of a step: highest score, and the latest version on a tie. */
function bestAttempt(history: readonly QualityAttempt[]): QualityAttempt | undefined {
  let best: QualityAttempt | undefined;
  for (const attempt of history) {
    if (best === undefined || attempt.verdict.score >= best.verdict.score) best = attempt;
  }
  return best;
}

/** What the onFailure policy decides once a step can no longer reach its floor. */
export type FailureOutcome =
  | { kind: "retry" }
  | { kind: "escalate"; failure: AppError }
  | { kind: "continue"; best: QualityAttempt; attempts: number; reason: string };

/**
 * The bounded retry of the quality loop, and what happens when the bound is reached. Attempts and
 * the previous score are derived from the `quality.verdict` events this step already holds, so the
 * budget survives a restart and no store column was added for it.
 *
 * Below the bound the refusal is the evidence it always was: the step retries, staying current or
 * following its refuse edge. At the bound the declared onFailure policy decides, and neither branch
 * fabricates a pass verdict: `escalate` records the failure plus a needs-guidance signal and halts
 * the instance in `failed`; `continue` records the failure and hands the best-scoring attempt on,
 * marked FAILED, so the flow keeps moving.
 */
export function failureOutcome(args: {
  store: Store;
  instance: Instance;
  step: string;
  /** The task the step runs, so the ratchet can be re-evaluated for the right unit. */
  taskRef: string;
  taskVersion: number;
  quality: Quality | undefined;
  /** The effective bars (per dimension + global MEAN) this attempt was judged against. */
  bars: QuantileBars;
  /** The project's default budget, threaded in by the caller; the task's own still wins. */
  defaultMaxAttempts?: number;
  verdict: QualityVerdict;
  at: string;
}): FailureOutcome {
  const { store, instance, step, taskRef, taskVersion, quality, bars, verdict, at } = args;
  const maxAttempts = quality?.maxAttempts ?? args.defaultMaxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  // The verdict for this attempt was appended above, so it is the last element here.
  const history = qualityHistory(store, instance.id, step);
  const attempts = history.length;
  const previous = attempts >= 2 ? history[attempts - 2] : undefined;
  const exhausted = attempts >= maxAttempts;
  const stalled = previous !== undefined && verdict.score <= previous.verdict.score;
  if (!exhausted && !stalled) return { kind: "retry" };

  const reason = failedReasonFor({
    step,
    attempts,
    maxAttempts,
    bars,
    verdict,
    ...(previous === undefined ? {} : { previous }),
  });
  const tail = historyView(history);
  const policy = quality?.onFailure ?? DEFAULT_ON_FAILURE;
  const best = bestAttempt(history);

  if (policy === "continue" && best !== undefined) {
    appendEvent(store, instance.id, {
      type: EVENT.qualityContinued,
      payload: {
        step,
        attempts,
        maxAttempts,
        reason,
        verdict,
        carried: { version: best.version, score: best.verdict.score },
        history: tail,
      },
      at,
    });
    // A terminal outcome either way, so the ratchet is re-evaluated on it: a carried failure is
    // not a pass and cannot lift the bar, but it does count toward a `bar.contested` window.
    recomputeBar(store, taskRef, taskVersion, quality as Quality, at);
    return { kind: "continue", best, attempts, reason };
  }

  appendEvent(store, instance.id, {
    type: EVENT.instanceFailed,
    payload: { step, attempts, maxAttempts, reason, verdict, history: tail },
    at,
  });
  appendEvent(store, instance.id, {
    type: EVENT.needsGuidance,
    payload: { step, attempts, maxAttempts, policy, reason, verdict, history: tail },
    at,
  });
  // F2: even an escalated terminal outcome leaves a note. The agent cannot act on a failed
  // instance, so the engine records the omission itself, with provenance, rather than losing it.
  writeNote({
    store,
    instance,
    step,
    task: taskRef,
    taskVersion,
    subjective: null,
    stub: true,
    agent: instance.actor,
    at,
  });
  setStatus(store, instance.id, { status: "failed", currentStep: instance.currentStep }, instance.revision);
  recomputeBar(store, taskRef, taskVersion, quality as Quality, at);
  return {
    kind: "escalate",
    failure: fail("QUALITY_BLOCKED", "step " + JSON.stringify(step) + " could not reach its floor: " + reason, {
      instance: instance.id,
      status: "failed",
      step,
      attempts,
      maxAttempts,
      policy,
      reason,
      quality: verdict,
      history: tail,
    }),
  };
}


/**
 * Record one accepted artifact version: the verified state transition, the acceptance event and the
 * step trace. The ordinary accept and the onFailure `continue` path share this one writer, so the
 * two cannot drift; `failed` carries the verdict that did not clear the floor, which marks the
 * record FAILED instead of pretending the artifact passed its own standard.
 */
export function recordAcceptance(args: {
  store: Store;
  instance: Instance;
  step: string;
  task: TaskConfig;
  /** The library path the task was pinned from, so the learning scans are task-scoped. */
  taskRef: string;
  grant: Grant;
  version: number;
  digest: string;
  path: string;
  handoffs: readonly Handoff[];
  at: string;
  actor?: string;
  failed?: QualityVerdict;
}): void {
  const { store, instance, step, task, handoffs, at } = args;
  acceptArtifact(store, instance.id, step, args.version, at);
  appendEvent(store, instance.id, {
    type: EVENT.artifactAccepted,
    payload: {
      step,
      version: args.version,
      path: args.path,
      digest: args.digest,
      schema: task.produces.schema,
      task: args.taskRef,
      taskVersion: task.version,
      derivedFrom: handoffs.length === 1 ? handoffs[0].digest : null,
      ...(handoffs.length > 1 ? { sources: handoffs.map((handoff) => handoff.artifactRef) } : {}),
      ...(args.actor === undefined ? {} : { actor: args.actor }),
      ...(args.failed === undefined
        ? {}
        : {
            failed: {
              decision: args.failed.decision,
              score: args.failed.score,
              rubricDigest: args.failed.rubricDigest,
            },
          }),
    },
    at,
  });
  appendEvent(store, instance.id, {
    type: EVENT.stepTrace,
    payload: { step, calls: traceOf(args.grant) },
    at,
  });
}

