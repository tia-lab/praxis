/**
 * Quality evaluation (quality eval): score a produced artifact with a typed judgment and let the
 * gate enforce a floor. THE SEAM: `Scorer` is an injected port shaped like fabric's `jev.evaluate`;
 * a real driver wraps that provider, tests pass a fake, and an absent scorer degrades to
 * `unavailable` (fail-closed for a `required` floor). The score is computed here — OUTSIDE any store
 * transaction — then handed to the synchronous engine, which records it and enforces the floor.
 *
 * ONE rubric, ONE call (task-self-improvement D7): the port returns a dimension's composed score
 * together with what produced it — the binding criterion, the witness probability and the rendered
 * why. Nothing here re-judges, re-renders or explains; it clamps, decides, and adds the one line the
 * evaluator alone can render, because it alone knows the bar (the divergence clause, D5).
 */
import { canonicalBytes, digest, digestOf } from "../runner/canonical.ts";
import { advance, inspect, type AdvanceOptions } from "../runner/engine/index.ts";
import { parseWith, QualityVerdictSchema, type Probe, type Quality, type QualityVerdict } from "../types/schema.ts";
import type { QualityAttempt } from "../runner/engine/index.ts";
import { barsFromQuality, compoundDecision, effectiveBarsFor, type Bars } from "./bar.ts";
import { RATIONALE_DIVERGENCE, RATIONALE_MAX } from "./jev-scorer.ts";

/** One criterion's recorded answer: the evidence a composed score was computed from. */
export interface CriterionAnswer {
  probe: string;
  answer: string | number;
}

/** One dimension's judgment: the composed score AND what produced it (D6, D7). */
export interface DimensionJudgment {
  id: string;
  score: number;
  /** The criterion that produced the minimum; absent on a dimension with no criteria (R8). */
  bound?: string;
  /** The witness `noul`'s probability. Recorded, never a gate input (D5, R7). */
  statementScore?: number;
  /** True when the witness and the composed score differ by at least `DIVERGENCE_MIN`. */
  divergence?: boolean;
  /** Every criterion's answer, in declared order (the recorded `diagnosis`). */
  diagnosis?: CriterionAnswer[];
  /** The bounded line rendered from those answers (R9). */
  rationale?: string;
  /**
   * Internal to the port: every criterion was clean. The evaluator turns this into the divergence
   * wording only when the dimension also missed its bar — the one fact the scorer does not own.
   * Never recorded on the verdict.
   */
  allClean?: boolean;
}

/**
 * The injected typed-judgment port: one call per submission, returning a per-dimension judgment.
 * It sees the criteria because composition is the judge's arithmetic (D4); it never sees a bar, so
 * it cannot refuse — the engine and the compound decision own that.
 */
export interface Scorer {
  score(input: {
    goal: string;
    rubric: readonly { id: string; statement: string; probes?: readonly Probe[] }[];
    artifact: unknown;
    subjectDigest?: string;
  }): Promise<{ dimensions: DimensionJudgment[]; rationale: string; scorer: string }>;
}

/**
 * The composition formula's identity, part of the ruler (D6, R11): when the arithmetic that turns
 * criteria into a dimension score changes, every recorded verdict is a different ruler and no cached
 * verdict may be reused across it.
 */
export const COMPOSE_FORMULA_ID = "praxis.compose/min/v1";

/**
 * The ruler's digest: the quality declaration AND its bars (global + every dimension) AND the
 * composition formula. One helper, used by the verdict and by the score-cache, so a raise in any
 * scope or a change of formula is a different ruler and recorded verdicts are never reused across it.
 */
export function rulerDigest(quality: Quality, bars: Bars, formula: string = COMPOSE_FORMULA_ID): string {
  return digestOf({ ruler: quality, floors: [...bars.perDimension], formula });
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
  /** The bars in force; absent means the rubric's own seed floors (no history consulted). */
  bars: Bars = barsFromQuality(quality),
): Promise<QualityVerdict> {
  const rubricDigest = rulerDigest(quality, bars);
  if (scorer === undefined) return degraded(rubricDigest, "unavailable", "no scorer available");
  let raw: { dimensions: DimensionJudgment[]; rationale: string; scorer: string };
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
  const judged = raw.dimensions.map((dimension) => ({ ...dimension, score: clamp01(dimension.score) }));
  // MIN stays the reported headline score; the DECISION is the compound (per-dimension bars with the
  // tolerance band AND the hard MEAN bar), so the verdict the gate receives is already the answer.
  const score = judged.length === 0 ? 0 : Math.min(...judged.map((d) => d.score));
  const compound = compoundDecision(judged, bars);
  const decision = compound.pass ? "pass" : "below";
  const weak = new Set([...compound.refused, ...compound.flagged]);
  const dimensions = judged.map((dimension) => {
    // The divergence wording (D5, R9): every criterion clean, yet the dimension missed its bar. The
    // scorer rendered no clause (there was nothing non-clean to name), so the evaluator supplies the
    // one line that needs the bar. A dimension with no criteria never gets it — nothing was composed.
    const rationale = dimension.rationale ??
      (dimension.bound !== undefined && dimension.allClean === true && weak.has(dimension.id)
        ? clip(dimension.id + ": " + RATIONALE_DIVERGENCE, RATIONALE_MAX)
        : undefined);
    return {
      id: dimension.id,
      score: dimension.score,
      key: bars.keys.get(dimension.id),
      ...(dimension.bound === undefined ? {} : { bound: dimension.bound }),
      ...(dimension.statementScore === undefined ? {} : { statementScore: dimension.statementScore }),
      ...(dimension.divergence === true ? { divergence: true } : {}),
      ...(dimension.diagnosis === undefined || dimension.diagnosis.length === 0 ? {} : { diagnosis: dimension.diagnosis }),
      ...(rationale === undefined ? {} : { rationale }),
    };
  });
  return parseWith(
    QualityVerdictSchema,
    {
      decision,
      score,
      dimensions,
      // Rounded: the recorded mean is audit evidence, not a float artefact.
      mean: Math.round(compound.mean * 10000) / 10000,
      flagged: compound.flagged,
      rationale: clip(raw.rationale),
      rubricDigest,
      scorer: raw.scorer,
      source: "jev",
    },
    "RESULT_INVALID",
    "quality verdict",
  );
}

/**
 * The digest score-cache: the same bytes judged against the same rubric never reach the scorer
 * twice. The lookup reads the step's recorded `quality.verdict` events, so the cache is exactly as
 * durable as the record — no store column, no in-memory map that a restart forgets. The recorded
 * verdict is reused unchanged, and the engine still records this attempt and still enforces the
 * floor, so a repeated failure stays visible and still counts toward the step's budget.
 */
function cachedVerdict(
  history: readonly QualityAttempt[],
  artifactDigest: string,
  rubricDigest: string,
): QualityVerdict | undefined {
  let found: QualityVerdict | undefined;
  for (const attempt of history) {
    if (attempt.artifactDigest !== artifactDigest) continue;
    if (attempt.verdict.rubricDigest !== rubricDigest) continue;
    found = attempt.verdict;
  }
  return found;
}

/**
 * Advance one step, scoring first when the current task declares a quality floor and holds the
 * `evaluate` capability. The score is computed here (no store transaction is open) and passed to the
 * synchronous `advance`, which records a `quality.verdict` event and enforces the floor. A task
 * without a quality floor, or lacking the capability, advances exactly as the plain engine does.
 * Bytes this step already had judged against this rubric reuse the recorded verdict instead of
 * paying for the same judgment twice.
 */
export async function advanceEvaluated(
  options: AdvanceOptions & { scorer?: Scorer },
): Promise<ReturnType<typeof advance>> {
  if (options.qualityVerdict === undefined) {
    const view = inspect({ ...options });
    const node = view.flow.config.nodes.find((candidate) => candidate.id === view.instance.currentStep);
    const task = node === undefined ? undefined : view.flow.tasks.get(node.task);
    const effective = task?.quality ?? view.flow.config.quality;
    if (effective !== undefined && task !== undefined && node !== undefined && task.capabilities.includes("evaluate")) {
      // The threshold the judge scores against is the ADAPTIVE bar (O2), folded from `bar.raised`
      // exactly as the engine's gate will fold it: a raised bar is a different ruler, so it also
      // changes the rubric digest the score-cache keys on.
      const bars = effectiveBarsFor(options, node.task, effective);
      const ruler = { ...effective, threshold: bars.global };
      const subjectDigest = view.handoffs.length === 1 ? view.handoffs[0].digest : undefined;
      const artifactDigest = digest(canonicalBytes(options.artifact === undefined ? {} : options.artifact));
      const cached = cachedVerdict(view.qualityHistory, artifactDigest, rulerDigest(ruler, bars));
      if (cached !== undefined) return advance({ ...options, qualityVerdict: cached });
      const verdict = await evaluateArtifact(
        options.scorer,
        ruler,
        { goal: task.goal, artifact: options.artifact, subjectDigest },
        bars,
      );
      return advance({ ...options, qualityVerdict: verdict });
    }
  }
  return advance({ ...options });
}
