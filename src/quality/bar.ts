/**
 * The adaptive bars (O2, task-level): every scope has its own floor and its own ratchet.
 *
 * SCOPES. \`global\` is the MEAN of the dimensions (seed \`quality.threshold\`); every dimension is its
 * own scope (seed \`dimension.floor\`, defaulting to the task's threshold). Acceptance needs BOTH: each
 * dimension within its tolerance band and the MEAN at or above the global bar (see
 * \`compoundDecision\`). MIN stays the reported headline score.
 *
 * IDENTITY. A dimension's bars are keyed by its identity (id + statement), never by task version:
 * republishing a task with unchanged dimensions inherits their earned bars; editing a dimension's
 * statement resets only it; adding one warms only itself; the global scope is keyed by the rubric's
 * composition, so any composition change re-warms the MEAN.
 *
 * All inputs are derived from the append-only event log — passes from \`artifact.accepted\` paired
 * with their \`quality.verdict\`, raises from \`bar.raised\` — so the bars are engine-computed,
 * auditable and never set by the agent. Every scope ratchets by ONE rule under one formula id
 * (`praxis.bar.ema/v3`): the **nine-period EMA of that scope's own genuine-pass values**
 * (`alpha = 2/(N+1) = 0.2`, seeded with the first value) is the earned level, and the bar moves toward
 * it by at most 0.05 when the gap is at least 0.01 -
 * `to = min(0.9, current + min(0.05, max(0, ema - current)))`. A raise is still gated by
 * WARMUP_MIN = 10 observations of that scope, by the cooldown (a raise only once BAR_WINDOW = 5 new
 * genuine passes have accumulated) and by mean attempts <= 2. Never auto-lowers: the effective bar is
 * `max(current, EMA)`, so a dip records nothing, and a full window under a raised bar with no pass
 * emits `bar.contested` for that scope (owner authority lowers a contested bar; the code never does).
 */
import { z } from "zod";
import { BarContestedSchema, BarRaisedSchema } from "../types/learning.ts";
import { parseWith, type Quality } from "../types/schema.ts";
import type { Store } from "../store/db.ts";
import { appendEvent } from "../store/events.ts";
import { EVENT } from "../runner/engine/types.ts";
import {
  ABSOLUTE_MIN,
  DEFAULT_QUANTILE,
  FIRST_HALF,
  FIRST_RAISE_MIN,
  HALF_WINDOW,
  QUANTILE_FORMULA_ID,
  QUANTILE_WINDOW,
  RAISE_STEP,
} from "../runner/engine/types.ts";

/** The frozen formula identity, recorded on every raise so the record is reproducible. */
export const BAR_FORMULA_ID = "praxis.bar.ema/v3";
/** The cooldown: how many genuine passes must accumulate after a raise before the next one. */
export const BAR_WINDOW = 5;
/** How many observations of a scope must accumulate before it may raise at all. */
export const WARMUP_MIN = 10;
/** Maximum mean attempts: when agents pass easily, the bar is too low. */
export const BAR_MEAN_ATTEMPTS_MAX = 2;
/** Above this, model-judge noise dominates. */
export const BAR_CEILING = 0.9;
/** The largest single raise. */
export const BAR_MAX_STEP = 0.05;
/** How many genuine passes the EMA remembers: N = 9. */
export const BAR_EMA_PERIODS = 9;
/** `2 / (BAR_EMA_PERIODS + 1)`: the weight the newest pass carries. */
export const BAR_EMA_ALPHA = 0.2;
/** Below this gap the EMA sits too close to the bar to be worth recording. */
export const BAR_MIN_STEP = 0.01;
/** The scope name of the global (MEAN) bar. */
// The read layer lives in `scope.ts` (a MOVE): imported for the ratchet, re-exported for every importer.
import {
  compositionKey,
  dimensionKey,
  flooredBar,
  ofTask,
  raisesFor,
  sampleFor,
  scanEvents,
  scopeOf,
} from "./scope.ts";
export { DIMENSION_TOLERANCE } from "./scope.ts";
export {
  GLOBAL_SCOPE,
  flooredBar,
  quantileBars,
  quantileBarsFor,
  type QuantileBars,
  scanEvents,
  ofTask,
  dimensionKey,
  compositionKey,
  barsFromQuality,
  raisesOf,
  scopeOf,
  raisesFor,
  barAt,
  effectiveBars,
  effectiveBarsFor,
  effectiveBar,
  effectiveBarFor,
  sampleFor,
} from "./scope.ts";
export type {
  LogEvent,
  Bars,
} from "./scope.ts";
export interface GenuinePass {
  instance: string;
  step: string;
  version: number;
  /** MIN over the dimensions: the headline score. */
  score: number;
  /** MEAN over the dimensions: the value the global scope ratchets on. */
  mean: number;
  /** Each dimension of that verdict, with the identity key it was judged under. */
  dimensions: Map<string, { score: number; key: string | undefined }>;
  attempts: number;
  at: string;
}

/**
 * Every genuine pass of a task, in log order. A continued-FAILED artifact is excluded twice over —
 * its acceptance carries \`failed\` and its verdict never decided \`pass\` — so \`onFailure=continue\`
 * cannot inflate any bar.
 */

/** Population standard deviation: the window's own spread, not a sample estimate. */

/** The lower quartile of the sorted window: one lucky high score cannot lift the bar. */

/**
 * The exponential moving average of a series of genuine-pass values: `alpha = 2/(periods+1)`, seeded
 * with the first value, so the result is a property of the evidence rather than of an authored floor.
 * It is the earned level the ratchet moves toward - a dip drags it, but `max(current, EMA)` means a
 * drag can never lower a bar. An empty series has no EMA.
 */

/**
 * The bar a gate actually compares against: the bar in force, capped at the Pareto point. Acceptance
 * stops tightening there while the ratchet keeps recording the level it reaches (option A).
 */

/**
 * The compound acceptance test, in ONE place so the scorer path, the gate and the audit cannot
 * drift: every dimension must sit at or above `effBar - DIMENSION_TOLERANCE` (a dimension inside
 * `[effBar - tolerance, effBar)` PASSES but is FLAGGED, and below the band is a hard refuse), and the
 * MEAN must clear the global bar with NO tolerance. Both compare against `effBar = gateBar(bar,
 * pareto)`: the gate stops tightening at the Pareto point while the bars themselves keep rising.
 * MIN is not consulted here; it stays the headline.
 */
export interface Compound {
  pass: boolean;
  mean: number;
  /** Dimensions that passed only because of the tolerance band. */
  flagged: string[];
  /** Dimensions below \`bar - tolerance\`. */
  refused: string[];
}


/** What one evaluation of one scope decided, so a caller (or a test) can assert it. */
export type BarDecision =
  | { scope: string; kind: "raised"; raised: z.infer<typeof BarRaisedSchema> }
  | { scope: string; kind: "contested"; contested: z.infer<typeof BarContestedSchema> }
  | { scope: string; kind: "warming"; observations: number }
  | { scope: string; kind: "held"; reason: string };

const round4 = (value: number): number => Math.round(value * 10000) / 10000;

/** One scope's observation count and its genuine-pass values, in log order. */
/** A scope whose raise is due but which no sample vouches for: what the sampler has to judge. */
export interface DueScope {
  scope: string;
  key?: string;
}

/**
 * The dimensions whose raise is due yet unsampled (S3 guard). Read-only, and the ONLY way the tool
 * boundary learns it has work to do: it runs the same rule the ratchet runs, so the sampler and the
 * hold cannot disagree about what is due.
 */
export function unsampledDueScopes(store: Store, task: string, taskVersion: number, quality: Quality, at: string): DueScope[] {
  const composition = compositionKey(quality);
  if (sampleFor(store, task, taskVersion, composition) !== undefined) return [];
  const due: DueScope[] = [];
  for (const dimension of quality.dimensions) {
    const key = dimensionKey(dimension);
    const observations = carriedObservations(store, task, dimension.id, key);
    const raises = raisesFor(store, task, dimension.id, key);
    const current = flooredBar(raises, ABSOLUTE_MIN);
    // The selector lands as a task field in S4; until then every dimension uses the default rank.
    const percentile = dimension.quantileGate ?? DEFAULT_QUANTILE;
    const target = raiseTarget(observations.map((observation) => observation.score), percentile, raises.length > 0);
    if (target === undefined || !(target >= current + RAISE_STEP)) continue;
    due.push({ scope: dimension.id, key });
  }
  void at;
  return due;
}

/**
 * Does a confirmation half support the candidate (spec 3.6.1)? At most floor(p * |H| / 100) of its
 * observations may sit BELOW it - at p=25 and four observations that is one below, i.e. three of four
 * at or above. The support test reuses the bar's own percentile, so a stricter knob confirms harder.
 */
export function supported(half: readonly number[], candidate: number, percentile: number): boolean {
  const tolerated = Math.floor((percentile * half.length) / 100);
  return half.filter((value) => value < candidate).length <= tolerated;
}

/**
 * The level this population justifies right now, chosen by STATE and not by n (spec 3.6.3).
 *
 * No raise yet: the FIRST raise (3.6.1) is eligible at n >= 28 over the last 28 observations - a
 * 20-observation estimate and two 4-observation confirmation halves the estimate never saw. Once a
 * raise exists: the STEADY rule (3.6.2) over two 20-observation halves, adopting the LOWER half's
 * quantile so a lucky newest batch cannot carry the bar on its own.
 */
export function raiseTarget(population: readonly number[], percentile: number, hasRaise: boolean): number | undefined {
  const n = population.length;
  if (!hasRaise) {
    if (n < FIRST_RAISE_MIN) return undefined;
    const estimate = population.slice(n - FIRST_RAISE_MIN, n - 2 * FIRST_HALF);
    const candidate = raiseCandidate(estimate, percentile);
    if (candidate === undefined) return undefined;
    const first = population.slice(n - 2 * FIRST_HALF, n - FIRST_HALF);
    const second = population.slice(n - FIRST_HALF);
    if (!supported(first, candidate, percentile) || !supported(second, candidate, percentile)) return undefined;
    return candidate;
  }
  if (n < QUANTILE_WINDOW) return undefined;
  const newest = population.slice(n - HALF_WINDOW);
  const previous = population.slice(n - QUANTILE_WINDOW, n - HALF_WINDOW);
  const left = raiseCandidate(newest, percentile);
  const right = raiseCandidate(previous, percentile);
  if (left === undefined || right === undefined) return undefined;
  return Math.floor(Math.min(left, right) * 100) / 100;
}

/** The part of a dimension the ratchet reads: identity, criteria (for the key) and the selector. */
type GatedDimension = { id: string; statement: string; probes?: readonly import("../types/schema.ts").Probe[]; quantileGate?: number };

/** The raise this dimension is due, if any: the target, attributed to the instance that produced it. */
function raiseFor(
  store: Store,
  task: string,
  dimension: GatedDimension,
  observations: readonly { score: number; instance: string }[],
): { to: number; instance: string; current: number; raises: { to: number; at: string }[]; percentile: number; n: number } | undefined {
  const key = dimensionKey(dimension);
  const raises = raisesFor(store, task, dimension.id, key);
  const current = flooredBar(raises, ABSOLUTE_MIN);
  const percentile = dimension.quantileGate ?? DEFAULT_QUANTILE;
  const target = raiseTarget(observations.map((observation) => observation.score), percentile, raises.length > 0);
  if (target === undefined) return undefined;
  // Monotone and worth recording: a candidate below the step changes nothing, so nothing is written.
  if (!(target >= current + RAISE_STEP)) return undefined;
  const last = observations[observations.length - 1];
  if (last === undefined) return undefined;
  return { to: round4(target), instance: last.instance, current, raises, percentile, n: observations.length };
}

/** One dimension's turn: calibrate, then maybe raise, then maybe contest. Never lowers. */
function evaluateDimension(
  store: Store,
  task: string,
  taskVersion: number,
  dimension: GatedDimension,
  quality: Quality,
  at: string,
): BarDecision {
  const key = dimensionKey(dimension);
  const observations = carriedObservations(store, task, dimension.id, key);
  const raises = raisesFor(store, task, dimension.id, key);
  const current = flooredBar(raises, ABSOLUTE_MIN);
  const due = raiseFor(store, task, dimension, observations);
  if (due !== undefined) {
    // The S3 guard: a bar may not ratchet on an identity nobody has sampled. Without a stable sample
    // the raise is HELD - recorded, never applied - and the step itself is untouched.
    const composition = compositionKey(quality);
    const sample = sampleFor(store, task, taskVersion, composition);
    if (sample === undefined || !sample.stable) {
      appendEvent(store, due.instance, {
        type: EVENT.barHeld,
        payload: {
          task,
          taskVersion,
          scope: dimension.id,
          key,
          composition,
          from: due.current,
          to: due.to,
          reason: sample === undefined ? "no rubric sample" : "the rubric sample was unstable",
          at,
        },
        at,
      });
      return { scope: dimension.id, kind: "held", reason: "no stable rubric sample" };
    }
    const payload = {
      task,
      taskVersion,
      scope: dimension.id,
      key,
      from: due.current,
      to: due.to,
      percentile: due.percentile,
      n: due.n,
      formulaId: QUANTILE_FORMULA_ID,
      stability: { repeats: sample.repeats, stable: sample.stable, artifactDigest: sample.artifactDigest, criteria: sample.criteria },
      at,
    };
    const raised = parseWith(BarRaisedSchema, payload, "RESULT_INVALID", "bar.raised");
    appendEvent(store, due.instance, { type: EVENT.barRaised, payload: raised, at });
    return { scope: dimension.id, kind: "raised", raised };
  }
  // The loud signal: a full window under a raised bar in which NOTHING passed. It records and never
  // lowers; the contention is a finding for the owner, not a reason to weaken the floor.
  if (raises.length > 0 && current > ABSOLUTE_MIN && observations.length >= QUANTILE_WINDOW) {
    const window = observations.slice(-QUANTILE_WINDOW);
    const contested = decideContest(store, task, taskVersion, dimension.id, key, at, current, window);
    if (contested !== undefined) return { scope: dimension.id, kind: "contested", contested };
  }
  if (observations.length < FIRST_RAISE_MIN) {
    return { scope: dimension.id, kind: "warming", observations: observations.length };
  }
  return { scope: dimension.id, kind: "held", reason: raises.length === 0 ? "the first raise is not confirmed" : "the halves do not clear the step" };
}

/** The loud signal for one dimension: a full 40-window under its bar with zero passes. */
function decideContest(
  store: Store,
  task: string,
  taskVersion: number,
  dimensionId: string,
  key: string,
  at: string,
  current: number,
  window: readonly { score: number; instance: string }[],
): z.infer<typeof BarContestedSchema> | undefined {
  const already = scanEvents(store, [EVENT.barContested]).some(
    (event) =>
      ofTask(event, task) &&
      scopeOf(event.payload as { scope?: unknown }) === dimensionId &&
      Number((event.payload as { bar?: unknown }).bar) === current,
  );
  if (already) return undefined;
  const contested = parseWith(
    BarContestedSchema,
    {
      task,
      taskVersion,
      scope: dimensionId,
      key,
      bar: current,
      attempts: window.length,
      reason: "a full window (" + window.length + " work units) under the " + dimensionId + " bar yielded no pass",
    },
    "RESULT_INVALID",
    "bar.contested",
  );
  const last = window[window.length - 1];
  if (last === undefined) return undefined;
  appendEvent(store, last.instance, { type: EVENT.barContested, payload: contested, at });
  return contested;
}

/**
 * Re-evaluate the ratchet for every dimension after one terminal task outcome. Cheap to call every
 * time: a dimension only acts once its population can support a measured level. Each raise, hold and
 * contest is appended with its scope and identity key, so the record explains itself.
 */
export function recomputeBar(store: Store, task: string, taskVersion: number, quality: Quality, at: string): BarDecision[] {
  const decisions: BarDecision[] = [];
  for (const dimension of quality.dimensions) {
    decisions.push(evaluateDimension(store, task, taskVersion, dimension, quality, at));
  }
  return decisions;
}

/**
 * The pure-AND gate (S2): a verdict passes iff EVERY dimension clears its own bar, where the bar in
 * force is max(ABSOLUTE_MIN, measured). No tolerance band, no mean, no Pareto cap: the measured part
 * is a quantile of live work, so it cannot creep above the level work reaches, and the floor keeps a
 * weak rubric from setting an impossible standard (A1, F1, F7).
 */
export function perDimensionDecision(
  dimensions: readonly { id: string; score: number }[],
  bars: { perDimension: ReadonlyMap<string, number> },
): { pass: boolean; refused: string[] } {
  const refused = dimensions
    .filter((dimension) => dimension.score < Math.max(ABSOLUTE_MIN, bars.perDimension.get(dimension.id) ?? ABSOLUTE_MIN))
    .map((dimension) => dimension.id);
  return { pass: refused.length === 0, refused };
}

// ---------------------------------------------------------------------------------------------
// The quantile machinery (quantile-bars S1): pure, and called by nothing yet.
//
// The population is ONE observation per instance - the dimension score of the version the instance
// CARRIED - so failing work is never weighted by its retries. The bar is a percentile of that
// population, floored at ABSOLUTE_MIN, and monotone because the fold takes the maximum. None of this
// stores anything: every value is a read over the event log (A4).
// ---------------------------------------------------------------------------------------------

/**
 * One criterion's quantile, lower definition: the value at rank floor(p/100 * (n - 1)) of the
 * SORTED population (spec 3.3). Lower-side by construction, so a quantile never overstates the work.
 */
export function quantileOf(sorted: readonly number[], percentile: number): number | undefined {
  if (sorted.length === 0) return undefined;
  const rank = Math.floor((percentile / 100) * (sorted.length - 1));
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

/**
 * The level a population would justify: its percentile, quantized DOWN to two decimals and floored at
 * ABSOLUTE_MIN (spec 3.5). Pure: the caller decides whether it is a raise (the window, the step and
 * the stability sample), so this function cannot move a bar by itself.
 */
export function raiseCandidate(
  population: readonly number[],
  percentile: number,
  floor: number = ABSOLUTE_MIN,
): number | undefined {
  const sorted = [...population].sort((left, right) => left - right);
  const quantile = quantileOf(sorted, percentile);
  if (quantile === undefined) return undefined;
  return Math.max(floor, Math.floor(quantile * 100) / 100);
}

/**
 * The carried population of one (task, dimension) scope: ONE observation per instance (spec 3.1).
 *
 * The observation is the dimension score of the version the instance CARRIED: the accepted version
 * when the step was accepted, the best-scoring version when a carried failure was accepted, and the
 * last scored version when nothing was carried. Verdicts with no score (unavailable/error) are not
 * observations, and neither is any attempt other than the carried one: one work unit, one value.
 */
/**
 * The carried observations themselves: the score, the instance it was carried by and its instant.
 * The ratchet needs the instance to record a raise against, so the read is shared and
 * `carriedPopulation` is the values alone (the public, score-only view).
 */
export function carriedObservations(
  store: Store,
  task: string,
  dimensionId: string,
  key?: string,
): { score: number; instance: string; at: string }[] {
  const events = scanEvents(store, [EVENT.qualityVerdict, EVENT.artifactAccepted]);
  const accepted = new Map<string, { version: number; failed: boolean }>();
  const scored = new Map<string, { version: number; score: number; overall: number; at: string }[]>();
  for (const event of events) {
    const payload = event.payload as Record<string, unknown>;
    if (String(payload.task ?? "") !== task) continue;
    if (event.type === EVENT.artifactAccepted) {
      const version = Number(payload.version);
      const current = accepted.get(event.instance);
      if (current === undefined || version >= current.version) {
        accepted.set(event.instance, { version, failed: payload.failed !== undefined });
      }
      continue;
    }
    if (payload.source !== "jev") continue;
    const dimensions = Array.isArray(payload.dimensions) ? payload.dimensions : [];
    const cell = dimensions.find((entry) => (entry as { id?: unknown }).id === dimensionId) as
      | { score?: unknown; key?: unknown }
      | undefined;
    if (cell === undefined || typeof cell.score !== "number") continue;
    if (key !== undefined && typeof cell.key === "string" && cell.key !== key) continue;
    const list = scored.get(event.instance) ?? [];
    list.push({ version: Number(payload.version), score: cell.score, overall: Number(payload.score), at: event.at });
    scored.set(event.instance, list);
  }
  const observations: { score: number; instance: string; at: string }[] = [];
  for (const [instance, verdicts] of scored) {
    const carried = accepted.get(instance);
    if (carried === undefined) continue;
    // A carried failure picks ONE version - the best-scoring one by its headline - and the dimension
    // is read from THAT version, never per dimension (spec 3.1: one observation, one version).
    const chosen = carried.failed
      ? verdicts.reduce((best, entry) => (entry.overall > best.overall ? entry : best), verdicts[0]!)
      : verdicts.find((entry) => entry.version === carried.version);
    if (chosen !== undefined) observations.push({ score: chosen.score, instance, at: chosen.at });
  }
  return observations;
}

/** The carried population as values only: one observation per instance (spec 3.1). */
export function carriedPopulation(store: Store, task: string, dimensionId: string, key?: string): number[] {
  return carriedObservations(store, task, dimensionId, key).map((observation) => observation.score);
}
