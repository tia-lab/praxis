/**
 * Quality evaluation (quality eval): score a produced artifact with a typed judgment and let the
 * gate enforce a floor. THE SEAM: `Scorer` is an injected port shaped like fabric's `jev.evaluate`;
 * a real driver wraps that provider, tests pass a fake, and an absent scorer degrades to
 * `unavailable` (fail-closed for a `required` floor). The score is computed here — OUTSIDE any store
 * transaction — then handed to the synchronous engine, which records it and enforces the floor.
 */
import { canonicalBytes, digest, digestOf } from "../runner/canonical.ts";
import { advance, inspect, type AdvanceOptions } from "../runner/engine/index.ts";
import { parseWith, QualityVerdictSchema, type Probe, type Quality, type QualityVerdict } from "../types/schema.ts";
import type { QualityAttempt } from "../runner/engine/index.ts";
import { barsFromQuality, compoundDecision, effectiveBarsFor, type Bars } from "./bar.ts";

/** One dimension's structured why: the battery's answers, and the line rendered from them. */
export interface ExplainedDimension {
  id: string;
  diagnosis: { probe: string; answer: string | number }[];
  rationale?: string;
}

/**
 * The injected typed-judgment port. Returns a per-dimension score in [0,1] and its own id — and,
 * OPTIONALLY, a second explain-only pass over the rubric's probe batteries (verdict-rationale D3).
 * `explain` never sees or changes a score: it is evidence, and a throw from it leaves the verdict
 * exactly as the scoring pass produced it.
 */
export interface Scorer {
  score(input: {
    goal: string;
    rubric: readonly { id: string; statement: string }[];
    artifact: unknown;
    subjectDigest?: string;
  }): Promise<{ dimensions: { id: string; score: number }[]; rationale: string; scorer: string }>;
  explain?(input: {
    goal: string;
    rubric: readonly { id: string; statement: string; probes?: readonly Probe[] }[];
    artifact: unknown;
    subjectDigest?: string;
    /** Dimensions that did not clear their bar (refused or flagged), for the divergence clause (D11). */
    weak: readonly string[];
  }): Promise<{ dimensions: ExplainedDimension[]; scorer: string }>;
}

/**
 * The ruler's digest: the quality declaration AND its bars (global + every dimension). One helper,
 * used by the verdict and by the score-cache, so a raise in any scope is a different ruler and
 * recorded verdicts are never reused across it.
 */
function rulerDigest(quality: Quality, bars: Bars): string {
  return digestOf({ ruler: quality, floors: [...bars.perDimension] });
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);
const clip = (text: string, limit = 2000): string => (text.length <= limit ? text : text.slice(0, limit - 1) + "\u2026");
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Run the explain pass, swallowing EVERY failure: the why is evidence, never a gate input (D3). */
async function explainQuietly(
  scorer: Scorer,
  input: Parameters<NonNullable<Scorer["explain"]>>[0],
): Promise<Map<string, ExplainedDimension> | undefined> {
  if (scorer.explain === undefined) return undefined;
  try {
    const explained = await scorer.explain(input);
    return new Map(explained.dimensions.map((dimension) => [dimension.id, dimension]));
  } catch {
    return undefined;
  }
}

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
  const dimensions = raw.dimensions.map((d) => ({ id: d.id, score: clamp01(d.score), key: bars.keys.get(d.id) }));
  // MIN stays the reported headline score; the DECISION is the compound (per-dimension bars with the
  // tolerance band AND the hard MEAN bar), so the verdict the gate receives is already the answer.
  const score = dimensions.length === 0 ? 0 : Math.min(...dimensions.map((d) => d.score));
  const compound = compoundDecision(dimensions, bars);
  const decision = compound.pass ? "pass" : "below";
  // The battery runs AFTER the verdict is decided and never touches it: a throw, a timeout or an
  // unreadable answer costs the structured why, never the score (spec D3, R7).
  const explained = scorer.explain === undefined
    ? undefined
    : await explainQuietly(scorer, {
        goal: input.goal,
        rubric: quality.dimensions,
        artifact: input.artifact,
        ...(input.subjectDigest === undefined ? {} : { subjectDigest: input.subjectDigest }),
        weak: [...compound.refused, ...compound.flagged],
      });
  const judged = explained === undefined
    ? dimensions
    : dimensions.map((dimension) => {
        const why = explained.get(dimension.id);
        if (why === undefined || why.diagnosis.length === 0) return dimension;
        return {
          ...dimension,
          diagnosis: why.diagnosis,
          ...(why.rationale === undefined ? {} : { rationale: why.rationale }),
        };
      });
  return parseWith(
    QualityVerdictSchema,
    {
      decision,
      score,
      dimensions: judged,
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
