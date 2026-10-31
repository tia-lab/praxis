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
import { parseWith, type Probe, type Quality } from "../types/schema.ts";
import { storeCall, type Store } from "../store/db.ts";
import { appendEvent } from "../store/events.ts";
import { withStore } from "../runner/engine/support.ts";
import { EVENT } from "../runner/engine/types.ts";
import { DEFAULT_PARETO_THRESHOLD } from "../runner/engine/types.ts";
import type { EngineOptions } from "../runner/engine/types.ts";
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
export const GLOBAL_SCOPE = "global";
/** Acceptance tolerance on a single dimension: it may sit this far under its bar and still pass. */
export const DIMENSION_TOLERANCE = 0.05;

/** One row of the log read across instances; the learning scans all read this shape. */
export interface LogEvent {
  instance: string;
  seq: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

const LogRowSchema = z.strictObject({
  instance: z.string().min(1),
  seq: z.int().min(1),
  type: z.string().min(1),
  payload: z.string(),
  at: z.string().min(1),
});

/**
 * Read every event of the given types across every instance, in one total order
 * (at, instance, seq). The learning facts are task-scoped rather than instance-scoped, so this is
 * the one read that spans instances; it stays a plain scan of the existing log (O6).
 */
export function scanEvents(store: Store, types: readonly string[]): LogEvent[] {
  if (types.length === 0) return [];
  const marks = types.map(() => "?").join(", ");
  const rows = storeCall("scan the event log", () =>
    store.db
      .prepare("SELECT instance, seq, type, payload, at FROM event WHERE type IN (" + marks + ") ORDER BY at ASC, instance ASC, seq ASC")
      .all(...(types as string[])),
  );
  return rows.map((row) => {
    const parsed = parseWith(LogRowSchema, row, "STORE_INVALID", "event row");
    return {
      instance: parsed.instance,
      seq: parsed.seq,
      type: parsed.type,
      payload: payloadOf(parsed.payload),
      at: parsed.at,
    };
  });
}

function payloadOf(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text) as unknown;
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Does this event belong to the task named? Task-scoped reads filter exactly here. */
export function ofTask(event: LogEvent, task: string): boolean {
  return event.payload.task === task;
}

/**
 * The identity key of one dimension (D6, R12): the id AND what decides it. A composed dimension is
 * identified by its CRITERIA, so editing one criterion resets that dimension's bar while rewording
 * the statement — which no longer decides anything — leaves the key, and the bar, in place. A
 * dimension with no criteria is still identified by its statement, exactly as before.
 */
export function dimensionKey(dimension: { id: string; statement: string; probes?: readonly Probe[] }): string {
  const criteria = dimension.probes ?? [];
  const basis = criteria.length === 0
    ? "dimension:" + dimension.id + "\u0000" + dimension.statement
    : "dimension:" + dimension.id + "\u0000criteria\u0000" +
      JSON.stringify(criteria.map((probe) => [probe.id, probe.type, probe.instructions, probe.criteria ?? null, probe.clean ?? null]));
  return digest(basis).slice(7, 23);
}

/** The composition key of a rubric: any add, edit or removal changes it (the MEAN re-warms). */
export function compositionKey(quality: Quality): string {
  const keys = quality.dimensions.map((dimension) => dimensionKey(dimension)).sort();
  return digest("rubric:" + keys.join(",")).slice(7, 23);
}

/** The bars in force for one task: the global MEAN bar plus one bar per dimension id. */
export interface Bars {
  global: number;
  perDimension: Map<string, number>;
  /** Each dimension's identity key, so callers can stamp a verdict with what judged it. */
  keys: Map<string, string>;
  /** The rubric composition the global bar belongs to. */
  composition: string;
  /**
   * The Pareto point this rubric's gate stops tightening at (`quality.paretoThreshold`, default 0.8).
   * Derived, never stored: it travels with the bars so every decision site caps identically.
   */
  pareto: number;
}

/** The seed bars of a rubric, with no history at all: what a store-less caller should use. */
export function barsFromQuality(quality: Quality): Bars {
  const perDimension = new Map<string, number>();
  const keys = new Map<string, string>();
  for (const dimension of quality.dimensions) {
    perDimension.set(dimension.id, dimension.floor ?? quality.threshold);
    keys.set(dimension.id, dimensionKey(dimension));
  }
  return {
    global: quality.threshold,
    perDimension,
    keys,
    composition: compositionKey(quality),
    pareto: quality.paretoThreshold ?? DEFAULT_PARETO_THRESHOLD,
  };
}

/** Every raise recorded for one task, in log order (the audit view; the fold is per scope). */
export function raisesOf(store: Store, task: string): z.infer<typeof BarRaisedSchema>[] {
  return scanEvents(store, [EVENT.barRaised])
    .filter((event) => ofTask(event, task))
    .map((event) => parseWith(BarRaisedSchema, event.payload, "STORE_INVALID", "bar.raised"));
}

/** A scope name: \`global\` or a dimension id; a legacy raise carries no scope and reads as global. */
export function scopeOf(payload: { scope?: unknown }): string {
  return typeof payload.scope === "string" && payload.scope !== "" ? payload.scope : GLOBAL_SCOPE;
}

/**
 * The raises a scope owns: its own scope name AND a key that is either absent (legacy) or the one
 * currently in force. A raise from an older identity is therefore ignored, which is exactly the
 * reset — while an unchanged identity inherits every raise it earned.
 */
function raisesFor(store: Store, task: string, scope: string, key: string | undefined): { to: number; at: string }[] {
  return raisesOf(store, task)
    .filter((raise) => scopeOf(raise) === scope && (raise.key === undefined || key === undefined || raise.key === key))
    .map((raise) => ({ to: raise.to, at: raise.at }));
}

/** The floor in force at an instant: the seed folded through every raise recorded up to \`at\`. */
export function barAt(raises: readonly { to: number; at: string }[], seed: number, at?: string): number {
  let bar = seed;
  for (const raise of raises) {
    if (at !== undefined && raise.at > at) continue;
    bar = raise.to;
  }
  return bar;
}

/** The bars for a task right now: each dimension folded through its own identity's raises. */
export function effectiveBars(store: Store, task: string, quality: Quality): Bars {
  const seeds = barsFromQuality(quality);
  const perDimension = new Map<string, number>();
  for (const [id, seed] of seeds.perDimension) {
    perDimension.set(id, barAt(raisesFor(store, task, id, seeds.keys.get(id)), seed));
  }
  return { ...seeds, perDimension, global: barAt(raisesFor(store, task, GLOBAL_SCOPE, seeds.composition), seeds.global) };
}

/** \`effectiveBars\` for a caller that holds options rather than an open store (score, brief, recall). */
export function effectiveBarsFor(options: EngineOptions, task: string, quality: Quality): Bars {
  return withStore(options, (store) => effectiveBars(store, task, quality));
}

/** The global (MEAN) bar alone, for callers that only need the headline floor. */
export function effectiveBar(store: Store, task: string, quality: Quality): number {
  return effectiveBars(store, task, quality).global;
}

/** \`effectiveBar\` for a caller that holds options. */
export function effectiveBarFor(options: EngineOptions, task: string, quality: Quality): number {
  return effectiveBarsFor(options, task, quality).global;
}

/** One genuine pass: an accepted artifact whose own verdict passed and was not a carried failure. */
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
export function recomputeBar(store: Store, task: string, taskVersion: number, quality: Quality, at: string): BarDecision[] {
  const decisions: BarDecision[] = [];
  for (const scope of scopesOf(store, task, quality)) {
    decisions.push(evaluateScope(store, task, taskVersion, scope, quality, at));
  }
  return decisions;
}

/** One scope's turn: warm up, then maybe raise, then maybe contest. Never lowers. */
function evaluateScope(store: Store, task: string, taskVersion: number, scope: Scope, quality: Quality, at: string): BarDecision {
  const raises = raisesFor(store, task, scope.name, scope.key);
  const current = barAt(raises, scope.seed);
  if (scope.observations < WARMUP_MIN) return { scope: scope.name, kind: "warming", observations: scope.observations };
  const lastRaise = raises.length === 0 ? undefined : raises[raises.length - 1].at;
  const sinceRaise = scope.passes.filter((pass) => lastRaise === undefined || pass.at > lastRaise);
  const window = sinceRaise.slice(-BAR_WINDOW);
  const raised = decideRaise(task, taskVersion, scope, quality, at, current, window);
  if (raised !== undefined) {
    appendEvent(store, raised.instance, { type: EVENT.barRaised, payload: raised.raised, at });
    return { scope: scope.name, kind: "raised", raised: raised.raised };
  }
  const contested = decideContest(store, task, taskVersion, scope, at, current, raises);
  if (contested !== undefined) return { scope: scope.name, kind: "contested", contested };
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
