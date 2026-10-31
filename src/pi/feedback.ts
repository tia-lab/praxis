/**
 * The refusal formatter: a quality error becomes actionable feedback (the typed verdict, the rubric's
 * own statements, the bars in force and the single best recorded lesson), and nothing else is touched.
 * Moved out of `operations.ts` verbatim (file cap, AGENTS.md 3); no behaviour changed.
 */
import { fail, isAppError } from "../types/errors.ts";
import { QualityVerdictSchema } from "../types/schema.ts";
import { inspect } from "../runner/engine/index.ts";
import type { EngineOptions } from "../runner/engine/index.ts";
import { ABSOLUTE_MIN } from "../runner/engine/types.ts";
import { briefRecall, escalatedLesson, quantileBarsFor } from "../quality/index.ts";

export const QUALITY_CODES: ReadonlySet<string> = new Set(["QUALITY_REQUIRED", "QUALITY_BELOW_THRESHOLD", "QUALITY_BLOCKED"]);

/**
 * Turn a quality refusal into actionable feedback: the typed verdict plus the rubric's own
 * dimension statements, so the agent learns which named dimensions are below the floor and by
 * how much, and can fix those. Praxis reports the standard it measured against; it never
 * authors remediation prose. Best effort — a failure that cannot be re-read is passed through
 * untouched, so the typed code is never lost (R8).
 */
export function qualityFeedback(error: unknown, options: EngineOptions & { instance: string }): unknown {
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
    // S2/S6: the standard reported is the MEASURED per-dimension bar, floored - never a mean or a cap.
    const bars = node === undefined || task === undefined ? undefined : quantileBarsFor(options, node.task, effective);
    const barOf = (id: string): number => Math.max(ABSOLUTE_MIN, bars?.perDimension.get(id) ?? ABSOLUTE_MIN);
    const statements = new Map(effective.dimensions.map((dimension) => [dimension.id, dimension.statement]));
    const dimensions = verdict.dimensions.map((dimension) => ({
      id: dimension.id,
      score: dimension.score,
      statement: statements.get(dimension.id) ?? "",
      belowThreshold: dimension.score < barOf(dimension.id),
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
        // The scalar beside the dimension detail: the STRICTEST measured bar, which is the floor when
        // nothing has been raised (the gate itself compares each dimension against its own).
        threshold: bars === undefined || bars.perDimension.size === 0 ? ABSOLUTE_MIN : Math.max(ABSOLUTE_MIN, ...[...bars.perDimension.values()]),
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

