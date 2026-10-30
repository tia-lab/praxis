/**
 * Quality evaluation (quality eval): score a produced artifact with a typed judgment and let the
 * gate enforce a floor. THE SEAM: `Scorer` is an injected port shaped like fabric's `jev.evaluate`;
 * a real driver wraps that provider, tests pass a fake, and an absent scorer degrades to
 * `unavailable` (fail-closed for a `required` floor). The score is computed here — OUTSIDE any store
 * transaction — then handed to the synchronous engine, which records it and enforces the floor.
 */
import { digestOf } from "../runner/canonical.ts";
import { advance, inspect, type AdvanceOptions } from "../runner/engine.ts";
import { parseWith, QualityVerdictSchema, type Quality, type QualityVerdict } from "../types/schema.ts";

/** The injected typed-judgment port. Returns a per-dimension score in [0,1] and its own id. */
export interface Scorer {
  score(input: {
    goal: string;
    rubric: readonly { id: string; statement: string }[];
    artifact: unknown;
    subjectDigest?: string;
  }): Promise<{ dimensions: { id: string; score: number }[]; rationale: string; scorer: string }>;
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);
const clip = (text: string, limit = 2000): string => (text.length <= limit ? text : text.slice(0, limit - 1) + "\u2026");
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** An unavailable/error verdict carrying the pinned ruler, so the record stays auditable. */
function degraded(rubricDigest: string, source: "unavailable" | "error", rationale: string): QualityVerdict {
  return { decision: "unavailable", score: 0, dimensions: [], rationale: clip(rationale), rubricDigest, scorer: source, source };
}

/**
 * Score one artifact against a task's quality rubric. The overall score is the MINIMUM dimension —
 * a floor is only as strong as its weakest dimension, which also avoids weighted scoring (MIN-011).
 * Fail-closed: a missing or throwing scorer yields `unavailable`, never a fabricated pass.
 */
export async function evaluateArtifact(
  scorer: Scorer | undefined,
  quality: Quality,
  input: { goal: string; artifact: unknown; subjectDigest?: string },
): Promise<QualityVerdict> {
  const rubricDigest = digestOf(quality);
  if (scorer === undefined) return degraded(rubricDigest, "unavailable", "no scorer available");
  let raw: { dimensions: { id: string; score: number }[]; rationale: string; scorer: string };
  try {
    raw = await scorer.score({
      goal: input.goal,
      rubric: quality.dimensions,
      artifact: input.artifact,
      subjectDigest: input.subjectDigest,
    });
  } catch (error) {
    return degraded(rubricDigest, "error", "scorer error: " + messageOf(error));
  }
  const dimensions = raw.dimensions.map((d) => ({ id: d.id, score: clamp01(d.score) }));
  const score = dimensions.length === 0 ? 0 : Math.min(...dimensions.map((d) => d.score));
  const decision = score >= quality.threshold ? "pass" : "below";
  return parseWith(
    QualityVerdictSchema,
    { decision, score, dimensions, rationale: clip(raw.rationale), rubricDigest, scorer: raw.scorer, source: "jev" },
    "RESULT_INVALID",
    "quality verdict",
  );
}

/**
 * Advance one step, scoring first when the current task declares a quality floor and holds the
 * `evaluate` capability. The score is computed here (no store transaction is open) and passed to the
 * synchronous `advance`, which records a `quality.verdict` event and enforces the floor. A task
 * without a quality floor, or lacking the capability, advances exactly as the plain engine does.
 */
export async function advanceEvaluated(
  options: AdvanceOptions & { scorer?: Scorer },
): Promise<ReturnType<typeof advance>> {
  if (options.qualityVerdict === undefined) {
    const view = inspect({ ...options });
    const node = view.flow.config.nodes.find((candidate) => candidate.id === view.instance.currentStep);
    const task = node === undefined ? undefined : view.flow.tasks.get(node.task);
    const effective = task?.quality ?? view.flow.config.quality;
    if (effective !== undefined && task !== undefined && task.capabilities.includes("evaluate")) {
      const subjectDigest = view.handoffs.length === 1 ? view.handoffs[0].digest : undefined;
      const verdict = await evaluateArtifact(options.scorer, effective, {
        goal: task.goal,
        artifact: options.artifact,
        subjectDigest,
      });
      return advance({ ...options, qualityVerdict: verdict });
    }
  }
  return advance({ ...options });
}
