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
import { advance, inspect, orderFor, type AdvanceOptions } from "../runner/engine/index.ts";
import { parseWith, QualityVerdictSchema, type Probe, type Quality, type QualityVerdict, type TaskConfig } from "../types/schema.ts";
import type { QualityAttempt } from "../runner/engine/index.ts";
import { carriedPopulation, perDimensionDecision, quantileBarsFor, quantileOf, type QuantileBars } from "./bar.ts";
import { ABSOLUTE_MIN } from "../runner/engine/types.ts";
import { dimensionKey } from "./scope.ts";
import { withStore } from "../runner/engine/support.ts";
import { authoredQuality, judgeQuality } from "../runner/engine/rules.ts";
import { RATIONALE_DIVERGENCE, RATIONALE_MAX } from "./jev-scorer.ts";

/**
 * One criterion's recorded answer: the evidence a composed score was computed from, plus the judge's
 * own uncertainty about it when pi-jev reported any (S2). Every uncertainty field is ABSENT when it
 * was not reported — never zero-filled, never inferred — and a noul carries none at all.
 */
export interface CriterionAnswer {
  probe: string;
  answer: string | number;
  /** The artifact sections this criterion was asked to judge; absent means the whole artifact (R17). */
  sections?: string[];
  /** The answer's own confidence, when the client reported one. */
  confidence?: number;
  /** choice: P(the declared clean option). */
  pClean?: number;
  /** score: P(the top level); choice: P(the most likely option). */
  pTop?: number;
  /** 1 − max(p): how widely the judge spread its mass. */
  spread?: number;
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
  /** Criterion ids the judge answered near its own boundary (S2, R17). Disclosure, never a gate. */
  torn?: string[];
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
/**
 * What the judge is working ON (T3): the order the work was done for, the task's own intent, and the
 * intent of each section a criterion targets. An INPUT to the scorer, never part of the request state:
 * the state keeps exactly its three keys, so an order-less, untargeted call is byte-identical to today.
 */
export interface ScoringContext {
  order?: string;
  task?: { rationale?: string; scope?: string };
  sections?: readonly { id: string; goal?: string; rationale?: string }[];
}

export interface Scorer {
  score(input: {
    goal: string;
    rubric: readonly { id: string; statement: string; probes?: readonly Probe[] }[];
    artifact: unknown;
    subjectDigest?: string;
    /** The assignment, when the caller has one (T3). Absent means today's behaviour exactly. */
    context?: ScoringContext;
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
export function rulerDigest(quality: Quality, bars: { perDimension: ReadonlyMap<string, number> }, formula: string = COMPOSE_FORMULA_ID): string {
  return digestOf({ ruler: quality, floors: [...bars.perDimension], formula });
}

/**
 * The score-cache key (T3, R18): the ruler AND the order the artifact was judged under. The same bytes
 * submitted under a different order are a MISS, because the old verdict judged a different
 * assignment. `rulerDigest` itself is untouched: the verdict still records the ruler alone.
 */
export function anchorKey(ruler: string, anchor: string | undefined): string {
  return digestOf({ ruler, anchor: anchor ?? null });
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

/** The gate bars of a rubric with no history: every dimension at the absolute floor. */
const floorOnly = (quality: Quality): Map<string, number> =>
  new Map(quality.dimensions.map((dimension) => [dimension.id, ABSOLUTE_MIN]));

/**
 * The ruler's own bars, with no history: the floor per dimension plus each dimension's identity key.
 * The DECISION reads the MEASURED bars (the `gate` argument); this is what the ruler digest names.
 */
const floorBars = (quality: Quality): QuantileBars => ({
  perDimension: floorOnly(quality),
  keys: new Map(quality.dimensions.map((dimension) => [dimension.id, dimensionKey(dimension)])),
});
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
  input: { goal: string; artifact: unknown; subjectDigest?: string; context?: ScoringContext },
  /** The bars in force; absent means the rubric's own seed floors (no history consulted). */
  bars: QuantileBars = floorBars(quality),
  /** The measured per-dimension bars the DECISION reads (S2). Absent means the floor only. */
  gate?: {
    perDimension: ReadonlyMap<string, number>;
    q50?: ReadonlyMap<string, number | undefined>;
    /**
     * The AUTHORED rubric, when the caller hands the judge a composed one (task-rules R9'): the ruler
     * digest and therefore every cache key and identity read THIS, never the composed text. Defaults to
     * `quality`, so a caller without rules is unchanged.
     */
    identity?: Quality;
  },
): Promise<QualityVerdict> {
  // Identity is the AUTHORED rubric: a cited rule's statement may change what the judge is asked, never
  // which ruler the verdict was judged under (invariant I6).
  const rubricDigest = rulerDigest(gate?.identity ?? quality, bars);
  if (scorer === undefined) return degraded(rubricDigest, "unavailable", "no scorer available");
  let raw: { dimensions: DimensionJudgment[]; rationale: string; scorer: string };
  try {
    raw = await scorer.score({
      goal: input.goal,
      rubric: quality.dimensions,
      artifact: input.artifact,
      subjectDigest: input.subjectDigest,
      ...(input.context === undefined ? {} : { context: input.context }),
    });
  } catch (error) {
    return degraded(rubricDigest, "error", "scorer error: " + messageOf(error));
  }
  const judged = raw.dimensions.map((dimension) => ({ ...dimension, score: clamp01(dimension.score) }));
  // MIN stays the reported headline score; the DECISION is the compound (per-dimension bars with the
  // tolerance band AND the hard MEAN bar), so the verdict the gate receives is already the answer.
  const score = judged.length === 0 ? 0 : Math.min(...judged.map((d) => d.score));
  // The PURE AND (S2): every dimension must clear its own bar, floored at ABSOLUTE_MIN. No mean,
  // no tolerance band, no Pareto cap - the bar cannot creep above the level work reaches.
  const verdictOf = perDimensionDecision(judged, gate ?? { perDimension: floorOnly(quality) });
  const decision = verdictOf.pass ? "pass" : "below";
  const weak = new Set(verdictOf.refused);
  // The Q50 learning flag (A3): a dimension that PASSED but sits below its own median of the carried
  // population is where the next lesson comes from. Derived on demand, no gate effect, no storage.
  const flagged = judged
    .filter((dimension) => {
      const median = gate?.q50?.get(dimension.id);
      return !weak.has(dimension.id) && median !== undefined && dimension.score < median;
    })
    .map((dimension) => dimension.id);
  // The torn set, in the same flat namespace as the request: <dimension>.<criterion> (R17).
  const torn = judged.flatMap((dimension) => (dimension.torn ?? []).map((criterion) => dimension.id + "." + criterion));
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
      ...(dimension.torn === undefined || dimension.torn.length === 0 ? {} : { torn: dimension.torn }),
      ...(rationale === undefined ? {} : { rationale }),
    };
  });
  // The provisional report (S6, R33-R35): a DECIDING criterion was torn. It is derived AFTER the
  // decision and never passed into it, so acceptance, the mean, the flagged set and the bars are
  // identical with and without it.
  const provisionalOn = judged.flatMap((dimension) => {
    if (dimension.torn === undefined || dimension.bound === undefined) return [];
    if (!dimension.torn.includes(dimension.bound)) return [];
    const entry = dimension.diagnosis?.find((answer) => answer.probe === dimension.bound);
    if (entry === undefined) return [];
    // Which signal made it torn: mass for a distribution, otherwise the answer's confidence, else the
    // single-probability band a noul has (R34) - a noul is never presented as a distribution.
    const signal = entry.spread !== undefined || entry.pClean !== undefined || entry.pTop !== undefined
      ? "mass"
      : entry.confidence !== undefined
        ? "confidence"
        : "noul-band";
    return [{ dimension: dimension.id, criterion: dimension.bound, signal }];
  });
  return parseWith(
    QualityVerdictSchema,
    {
      decision,
      score,
      dimensions,
      // `mean` is no longer written (S2). `flagged` is the Q50 set above; both stay optional in the
      // schema so a verdict recorded before either change still parses.
      ...(flagged.length === 0 ? {} : { flagged }),
      ...(torn.length === 0 ? {} : { torn }),
      ...(provisionalOn.length === 0 ? {} : { provisional: true, provisionalOn }),
      // T3: was this artifact judged against an order, and which one? Absent when there was none, so a
      // verdict recorded without an assignment parses and compares exactly as before.
      ...(input.context?.order === undefined ? {} : { anchored: true, anchorDigest: digest(input.context.order) }),
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
 * The assignment for one submission (T3): the order it was done for, the task's own intent and the
 * intent of every section it declares. `undefined` when there is nothing to say, so an unanchored
 * submission sends exactly the request it always did (R19).
 */
function scoringContextOf(task: TaskConfig, order: string | undefined): ScoringContext | undefined {
  const clauses = task.requires === undefined ? [] : Array.isArray(task.requires) ? task.requires : [task.requires];
  const sections = clauses.flatMap((clause) =>
    clause.goal === undefined && clause.rationale === undefined
      ? []
      : [
          {
            id: clause.section,
            ...(clause.goal === undefined ? {} : { goal: clause.goal }),
            ...(clause.rationale === undefined ? {} : { rationale: clause.rationale }),
          },
        ],
  );
  const intent =
    task.rationale === undefined && task.scope === undefined
      ? undefined
      : {
          ...(task.rationale === undefined ? {} : { rationale: task.rationale }),
          ...(task.scope === undefined ? {} : { scope: task.scope }),
        };
  if (order === undefined && intent === undefined && sections.length === 0) return undefined;
  return {
    ...(order === undefined ? {} : { order }),
    ...(intent === undefined ? {} : { task: intent }),
    ...(sections.length === 0 ? {} : { sections }),
  };
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
  cacheKey: string,
): QualityVerdict | undefined {
  let found: QualityVerdict | undefined;
  for (const attempt of history) {
    if (attempt.artifactDigest !== artifactDigest) continue;
    // Both sides of the comparison are built the same way: the CURRENT ruler + order against the
    // ruler + order the candidate verdict was RECORDED under (R18).
    const recorded = anchorKey(attempt.verdict.rubricDigest, attempt.verdict.anchorDigest);
    if (recorded !== cacheKey) continue;
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
    const effective = task === undefined ? view.flow.config.quality : authoredQuality(view.flow, task);
    if (effective !== undefined && task !== undefined && node !== undefined && task.capabilities.includes("evaluate")) {
      // The ruler is the rubric as declared; its own bars are the FLOOR per dimension (history-free),
      // so the digest is stable, while the DECISION reads the measured bars through `gate`.
      // The AUTHORED ruler: bars, digest, cache key and the q50 keying all read it.
      const ruler = { ...effective, threshold: ABSOLUTE_MIN };
      // The COMPOSED rubric: the scorer's request and nothing else (invariant I6). A task with no rules
      // returns the AUTHORED object unchanged, so this fallback is the unreachable case.
      const composed = judgeQuality(view.flow, task);
      const judged = composed === undefined ? ruler : { ...composed, threshold: ABSOLUTE_MIN };
      const bars = floorBars(ruler);
      const subjectDigest = view.handoffs.length === 1 ? view.handoffs[0].digest : undefined;
      const artifactDigest = digest(canonicalBytes(options.artifact === undefined ? {} : options.artifact));
      // T3: the assignment the judge is given. The reads here are pure and the store is already
      // closed when the scorer runs, so no jev call happens inside a transaction.
      const order = orderFor({ ...options });
      const context = scoringContextOf(task, order);
      const cacheKey = anchorKey(rulerDigest(ruler, bars), order === undefined ? undefined : digest(order));
      const cached = cachedVerdict(view.qualityHistory, artifactDigest, cacheKey);
      if (cached !== undefined) return advance({ ...options, qualityVerdict: cached });
      // S2: the DECISION reads the measured per-dimension bars, and the Q50 flag reads the same
      // population's median (A3, A4). One store read, before the scorer runs.
      const measuredBars = quantileBarsFor(options, node.task, ruler);
      // One short read, closed before the scorer runs: the population median per dimension.
      const q50 = withStore(options, (store) => {
        const medians = new Map<string, number | undefined>();
        for (const dimension of ruler.dimensions) {
          const values = carriedPopulation(store, node.task, dimension.id, dimensionKey(dimension));
          medians.set(dimension.id, quantileOf([...values].sort((left, right) => left - right), 50));
        }
        return medians;
      });
      const verdict = await evaluateArtifact(
        options.scorer,
        judged,
        { goal: task.goal, artifact: options.artifact, subjectDigest, ...(context === undefined ? {} : { context }) },
        bars,
        { perDimension: measuredBars.perDimension, q50, identity: ruler },
      );
      return advance({ ...options, qualityVerdict: verdict });
    }
  }
  return advance({ ...options });
}
