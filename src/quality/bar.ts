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
import { ABSOLUTE_MIN, DEFAULT_PARETO_THRESHOLD } from "../runner/engine/types.ts";
import { digest } from "../runner/canonical.ts";

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
  GLOBAL_SCOPE,
  barAt,
  barsFromQuality,
  compositionKey,
  ofTask,
  raisesFor,
  sampleFor,
  scanEvents,
  scopeOf,
  type Bars,
} from "./scope.ts";import { DIMENSION_TOLERANCE } from "./scope.ts";
export {
  GLOBAL_SCOPE,
  DIMENSION_TOLERANCE,
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
export function genuinePasses(store: Store, task: string): GenuinePass[] {
  const events = scanEvents(store, [EVENT.artifactAccepted, EVENT.qualityVerdict]);
  const verdicts = new Map<string, Array<{ version: number; decision: string; score: number; mean: number; dimensions: Map<string, { score: number; key: string | undefined }> }>>();
  for (const event of events) {
    if (event.type !== EVENT.qualityVerdict) continue;
    const key = event.instance + "\u0000" + String(event.payload.step);
    const list = verdicts.get(key) ?? [];
    const dimensions = new Map<string, { score: number; key: string | undefined }>();
    for (const entry of Array.isArray(event.payload.dimensions) ? event.payload.dimensions : []) {
      const cell = entry as { id?: unknown; score?: unknown; key?: unknown };
      dimensions.set(String(cell.id), { score: Number(cell.score), key: typeof cell.key === "string" ? cell.key : undefined });
    }
    const values = [...dimensions.values()].map((dimension) => dimension.score);
    list.push({
      version: Number(event.payload.version),
      decision: String(event.payload.decision),
      score: Number(event.payload.score),
      mean: typeof event.payload.mean === "number" ? event.payload.mean : values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length,
      dimensions,
    });
    verdicts.set(key, list);
  }
  const passes: GenuinePass[] = [];
  for (const event of events) {
    if (event.type !== EVENT.artifactAccepted) continue;
    if (!ofTask(event, task)) continue;
    if (event.payload.failed !== undefined) continue;
    const version = Number(event.payload.version);
    const step = String(event.payload.step);
    const attempts = (verdicts.get(event.instance + "\u0000" + step) ?? []).filter((verdict) => verdict.version <= version);
    const own = attempts.find((verdict) => verdict.version === version && verdict.decision === "pass");
    if (own === undefined) continue;
    passes.push({
      instance: event.instance,
      step,
      version,
      score: own.score,
      mean: own.mean,
      dimensions: own.dimensions,
      attempts: attempts.length,
      at: event.at,
    });
  }
  return passes;
}

/** Population standard deviation: the window's own spread, not a sample estimate. */
export function stdev(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** The lower quartile of the sorted window: one lucky high score cannot lift the bar. */
export function lowerQuartile(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.floor((sorted.length - 1) * 0.25)];
}

/**
 * The exponential moving average of a series of genuine-pass values: `alpha = 2/(periods+1)`, seeded
 * with the first value, so the result is a property of the evidence rather than of an authored floor.
 * It is the earned level the ratchet moves toward - a dip drags it, but `max(current, EMA)` means a
 * drag can never lower a bar. An empty series has no EMA.
 */
export function emaOf(values: readonly number[], periods: number = BAR_EMA_PERIODS): number | undefined {
  if (values.length === 0) return undefined;
  const alpha = 2 / (periods + 1);
  let ema = values[0];
  for (let index = 1; index < values.length; index += 1) ema = alpha * values[index] + (1 - alpha) * ema;
  return ema;
}

/**
 * The bar a gate actually compares against: the bar in force, capped at the Pareto point. Acceptance
 * stops tightening there while the ratchet keeps recording the level it reaches (option A).
 */
export function gateBar(bar: number, pareto: number | undefined): number {
  return Math.min(bar, pareto ?? DEFAULT_PARETO_THRESHOLD);
}

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

export function compoundDecision(
  dimensions: readonly { id: string; score: number }[],
  bars: Pick<Bars, "global" | "perDimension"> & { readonly pareto?: number },
): Compound {
  const flagged: string[] = [];
  const refused: string[] = [];
  for (const dimension of dimensions) {
    const bar = gateBar(bars.perDimension.get(dimension.id) ?? bars.global, bars.pareto);
    if (dimension.score < bar - DIMENSION_TOLERANCE) refused.push(dimension.id);
    else if (dimension.score < bar) flagged.push(dimension.id);
  }
  const mean = dimensions.length === 0 ? 0 : dimensions.reduce((sum, dimension) => sum + dimension.score, 0) / dimensions.length;
  return { pass: refused.length === 0 && mean >= gateBar(bars.global, bars.pareto), mean, flagged, refused };
}

/** What one evaluation of one scope decided, so a caller (or a test) can assert it. */
export type BarDecision =
  | { scope: string; kind: "raised"; raised: z.infer<typeof BarRaisedSchema> }
  | { scope: string; kind: "contested"; contested: z.infer<typeof BarContestedSchema> }
  | { scope: string; kind: "warming"; observations: number }
  | { scope: string; kind: "held"; reason: string };

const round4 = (value: number): number => Math.round(value * 10000) / 10000;

/** One scope's observation count and its genuine-pass values, in log order. */
interface Scope {
  name: string;
  key: string;
  seed: number;
  observations: number;
  passes: { value: number; attempts: number; at: string; instance: string }[];
}

/** The scopes of a rubric, each with its own observations and its own pass values. */
function scopesOf(store: Store, task: string, quality: Quality): Scope[] {
  const seeds = barsFromQuality(quality);
  const verdicts = scanEvents(store, [EVENT.qualityVerdict]).filter((event) => ofTask(event, task));
  const passes = genuinePasses(store, task);
  const globalObservations = verdicts.filter((event) => {
    const keys = new Set<string>();
    for (const entry of Array.isArray(event.payload.dimensions) ? event.payload.dimensions : []) {
      const cell = entry as { key?: unknown };
      if (typeof cell.key === "string") keys.add(cell.key);
    }
    if (keys.size !== seeds.keys.size) return false;
    return [...seeds.keys.values()].every((key) => keys.has(key));
  }).length;
  const scopes: Scope[] = [
    {
      name: GLOBAL_SCOPE,
      key: seeds.composition,
      seed: seeds.global,
      observations: globalObservations,
      passes: passes
        .filter((pass) => passCompositionOf(pass) === seeds.composition)
        .map((pass) => ({ value: pass.mean, attempts: pass.attempts, at: pass.at, instance: pass.instance })),
    },
  ];
  for (const [id, key] of seeds.keys) {
    const seed = seeds.perDimension.get(id) ?? seeds.global;
    scopes.push({
      name: id,
      key,
      seed,
      observations: verdicts.filter((event) => (Array.isArray(event.payload.dimensions) ? event.payload.dimensions : []).some((entry) => (entry as { key?: unknown }).key === key)).length,
      passes: passes
        .filter((pass) => pass.dimensions.get(id)?.key === key)
        .map((pass) => ({ value: pass.dimensions.get(id)?.score ?? 0, attempts: pass.attempts, at: pass.at, instance: pass.instance })),
    });
  }
  return scopes;
}

/** The composition a pass was judged under: the sorted identity keys of its dimensions. */
function passCompositionOf(pass: GenuinePass): string {
  const keys = [...pass.dimensions.values()].map((dimension) => dimension.key ?? "").sort();
  return digest("rubric:" + keys.join(",")).slice(7, 23);
}

/**
 * Re-evaluate the ratchet for EVERY scope after one terminal task outcome. Cheap to call every
 * time: a scope only acts once it has warmed up and a full qualifying window exists. Each raise and
 * contest is appended with its scope and identity key, so the record explains itself.
 */

/** A scope whose raise is due but which no sample vouches for: what the sampler has to judge. */
export interface DueScope {
  scope: string;
  key?: string;
}

/**
 * The scopes that are due a raise yet unsampled (S3, R20-R22). Read-only, and the ONLY way the tool
 * boundary learns it has work to do: it runs the same window arithmetic as the ratchet itself, so
 * the sampler and the hold cannot disagree about what is due.
 */
export function unsampledDueScopes(store: Store, task: string, taskVersion: number, quality: Quality, at: string): DueScope[] {
  const composition = compositionKey(quality);
  // One sample per (task, version, composition): a second attempt records and asks for nothing.
  if (sampleFor(store, task, taskVersion, composition) !== undefined) return [];
  const due: DueScope[] = [];
  for (const scope of scopesOf(store, task, quality)) {
    if (scope.observations < WARMUP_MIN) continue;
    if (raiseFor(store, task, taskVersion, scope, quality, at) === undefined) continue;
    due.push({ scope: scope.name, ...(scope.key === undefined ? {} : { key: scope.key }) });
  }
  return due;
}

/**
 * Re-evaluate the ratchet for EVERY scope after one terminal task outcome. Cheap to call every
 * time: a scope only acts once it has warmed up and a full qualifying window exists. Each raise and
 * contest is appended with its scope and identity key, so the record explains itself.
 */
export function recomputeBar(store: Store, task: string, taskVersion: number, quality: Quality, at: string): BarDecision[] {
  const decisions: BarDecision[] = [];
  for (const scope of scopesOf(store, task, quality)) {
    decisions.push(evaluateScope(store, task, taskVersion, scope, quality, at));
  }
  return decisions;
}

/**
 * The raise this scope is due, if any: the same window arithmetic the ratchet has always used. Pure
 * — `decideRaise` only computes — so the read-only due check and the write path share it exactly.
 */
function raiseFor(
  store: Store,
  task: string,
  taskVersion: number,
  scope: Scope,
  quality: Quality,
  at: string,
): { raised: z.infer<typeof BarRaisedSchema>; instance: string; current: number; raises: { to: number; at: string }[] } | undefined {
  const raises = raisesFor(store, task, scope.name, scope.key);
  const current = barAt(raises, scope.seed);
  const lastRaise = raises.length === 0 ? undefined : raises[raises.length - 1].at;
  const window = scope.passes.filter((pass) => lastRaise === undefined || pass.at > lastRaise).slice(-BAR_WINDOW);
  const raised = decideRaise(task, taskVersion, scope, quality, at, current, window);
  return raised === undefined ? undefined : { ...raised, current, raises };
}

/** One scope's turn: warm up, then maybe raise, then maybe contest. Never lowers. */
function evaluateScope(store: Store, task: string, taskVersion: number, scope: Scope, quality: Quality, at: string): BarDecision {
  if (scope.observations < WARMUP_MIN) return { scope: scope.name, kind: "warming", observations: scope.observations };
  const due = raiseFor(store, task, taskVersion, scope, quality, at);
  // The same fold the ratchet uses, whether or not a raise is due.
  const raises = due?.raises ?? raisesFor(store, task, scope.name, scope.key);
  if (due !== undefined) {
    // S3/R22: a bar may not ratchet on an identity nobody has sampled. Without a stable sample the
    // raise is HELD — recorded, never applied — and the step itself is untouched: it decided
    // normally one line above.
    const composition = compositionKey(quality);
    const sample = sampleFor(store, task, taskVersion, composition);
    if (sample === undefined || !sample.stable) {
      appendEvent(store, due.instance, {
        type: EVENT.barHeld,
        payload: {
          task,
          taskVersion,
          scope: scope.name,
          ...(scope.key === undefined ? {} : { key: scope.key }),
          composition,
          from: due.current,
          to: due.raised.to,
          reason: sample === undefined ? "no rubric sample" : "the rubric sample was unstable",
          at,
        },
        at,
      });
      return { scope: scope.name, kind: "held", reason: "no stable rubric sample" };
    }
    const payload = {
      ...due.raised,
      stability: { repeats: sample.repeats, stable: sample.stable, artifactDigest: sample.artifactDigest, criteria: sample.criteria },
    };
    appendEvent(store, due.instance, { type: EVENT.barRaised, payload, at });
    return { scope: scope.name, kind: "raised", raised: payload };
  }
  const current = barAt(raises, scope.seed);
  const contested = decideContest(store, task, taskVersion, scope, at, current, raises);
  if (contested !== undefined) return { scope: scope.name, kind: "contested", contested };
  const lastRaise = raises.length === 0 ? undefined : raises[raises.length - 1].at;
  const window = scope.passes.filter((pass) => lastRaise === undefined || pass.at > lastRaise).slice(-BAR_WINDOW);
  return { scope: scope.name, kind: "held", reason: window.length < BAR_WINDOW ? "no full window" : "gates not met" };
}

/**
 * The raise itself, under the EMA rule that every scope shares: the bar moves TOWARD the smoothed level
 * of that scope's genuine passes, by at most BAR_MAX_STEP, and only when the gap is worth recording. The
 * caller has already checked warmup; the cooldown is the window itself.
 */
function decideRaise(
  task: string,
  taskVersion: number,
  scope: Scope,
  quality: Quality,
  at: string,
  current: number,
  window: readonly { value: number; attempts: number; instance: string }[],
): { raised: z.infer<typeof BarRaisedSchema>; instance: string } | undefined {
  if (window.length < BAR_WINDOW) return undefined;
  // The EMA runs over the whole series of this identity; the window is the cooldown, not the statistic.
  const values = scope.passes.map((pass) => round4(pass.value));
  const ema = emaOf(values);
  if (ema === undefined) return undefined;
  const margin = ema - current;
  const meanAttempts = window.reduce((sum, pass) => sum + pass.attempts, 0) / window.length;
  if (meanAttempts > BAR_MEAN_ATTEMPTS_MAX) return undefined;
  if (margin < BAR_MIN_STEP) return undefined;
  const step = Math.min(BAR_MAX_STEP, margin);
  const to = round4(Math.min(BAR_CEILING, Math.max(scope.seed, current + step)));
  if (!(to > current)) return undefined;
  // Four decimals: the record is an audit value, not a place for float noise.
  const scores = window.map((pass) => round4(pass.value));
  const quartile = lowerQuartile([...scores].sort((left, right) => left - right));
  const raised = parseWith(
    BarRaisedSchema,
    {
      task,
      taskVersion,
      scope: scope.name,
      key: scope.key,
      from: current,
      to,
      window: {
        passes: scores,
        lowerQuartile: quartile,
        margin: round4(margin),
        stdev: round4(stdev(scores)),
        meanAttempts: round4(meanAttempts),
      },
      ema: { periods: BAR_EMA_PERIODS, alpha: BAR_EMA_ALPHA, value: round4(ema), samples: values.length },
      formulaId: BAR_FORMULA_ID,
      at,
    },
    "RESULT_INVALID",
    "bar.raised",
  );
  void quality;
  // Recorded on the instance whose outcome triggered it, so the signal travels with the work.
  return { raised, instance: window[window.length - 1].instance };
}

/** The loud signal for one scope: a full window under its raised bar with zero passes. */
function decideContest(
  store: Store,
  task: string,
  taskVersion: number,
  scope: Scope,
  at: string,
  current: number,
  raises: readonly { to: number; at: string }[],
): z.infer<typeof BarContestedSchema> | undefined {
  if (raises.length === 0) return undefined;
  const lastRaise = raises[raises.length - 1].at;
  const verdicts = scanEvents(store, [EVENT.qualityVerdict]).filter(
    (event) => ofTask(event, task) && event.at > lastRaise,
  );
  const passes = scope.passes.filter((pass) => pass.at > lastRaise);
  if (verdicts.length < BAR_WINDOW || passes.length > 0) return undefined;
  const already = scanEvents(store, [EVENT.barContested]).some(
    (event) =>
      ofTask(event, task) &&
      scopeOf(event.payload as { scope?: unknown }) === scope.name &&
      Number((event.payload as { bar?: unknown }).bar) === current,
  );
  if (already) return undefined;
  const contested = parseWith(
    BarContestedSchema,
    {
      task,
      taskVersion,
      scope: scope.name,
      key: scope.key,
      bar: current,
      attempts: verdicts.length,
      reason: "a full window (" + verdicts.length + " attempts) under the raised " + scope.name + " bar yielded no pass",
    },
    "RESULT_INVALID",
    "bar.contested",
  );
  appendEvent(store, verdicts[verdicts.length - 1].instance, { type: EVENT.barContested, payload: contested, at });
  return contested;
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
export function carriedPopulation(store: Store, task: string, dimensionId: string, key?: string): number[] {
  const events = scanEvents(store, [EVENT.qualityVerdict, EVENT.artifactAccepted]);
  const accepted = new Map<string, { version: number; failed: boolean }>();
  const scored = new Map<string, { version: number; score: number; overall: number }[]>();
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
    list.push({ version: Number(payload.version), score: cell.score, overall: Number(payload.score) });
    scored.set(event.instance, list);
  }
  const population: number[] = [];
  for (const [instance, verdicts] of scored) {
    const carried = accepted.get(instance);
    if (carried === undefined) continue;
    // A carried failure picks ONE version - the best-scoring one by its headline - and the dimension
    // is read from THAT version, never per dimension (spec 3.1: one observation, one version).
    const chosen = carried.failed
      ? verdicts.reduce((best, entry) => (entry.overall > best.overall ? entry : best), verdicts[0]!)
      : verdicts.find((entry) => entry.version === carried.version);
    if (chosen !== undefined) population.push(chosen.score);
  }
  return population;
}
