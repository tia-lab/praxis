/**
 * What a bar IS: the identity keys, the event scans and the fold that turns recorded raises into the
 * bars in force. Split out of `bar.ts` (file cap, AGENTS.md 3) as a MOVE: every line here is a read
 * or a pure fold over what the log holds, and none of it decides whether a bar may move. `bar.ts`
 * keeps the ratchet and re-exports every name below, so no importer moved.
 */
import { z } from "zod";
import { BarRaisedSchema, RubricSampledSchema } from "../types/learning.ts";
import { parseWith, type Probe, type Quality } from "../types/schema.ts";
import { storeCall, type Store } from "../store/db.ts";
import { withStore } from "../runner/engine/support.ts";
import type { EngineOptions } from "../runner/engine/types.ts";
import { ABSOLUTE_MIN, DEFAULT_PARETO_THRESHOLD, EVENT } from "../runner/engine/types.ts";
import { digest } from "../runner/canonical.ts";

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
export function raisesFor(store: Store, task: string, scope: string, key: string | undefined): { to: number; at: string }[] {
  return raisesOf(store, task)
    .filter((raise) => scopeOf(raise) === scope && (raise.key === undefined || key === undefined || raise.key === key))
    .map((raise) => ({ to: raise.to, at: raise.at }));
}

/**
 * The floor in force at an instant: the seed folded through every raise recorded up to `at`.
 *
 * A MAX fold floored at ABSOLUTE_MIN (spec 3.5, 3.7): the fold takes the greatest raise rather than
 * the last one, so even a legacy decreasing sequence cannot lower the bar; and no result - seed or
 * fold - may sit below the floor, which is what makes every bar reachable by good work (A1).
 */
/**
 * The floor in force at an instant: the seed folded through every raise recorded up to `at`.
 *
 * A MAX fold: the greatest raise wins, so even a legacy decreasing sequence cannot lower the bar
 * (spec 3.7). The ABSOLUTE_MIN floor is applied by `flooredBar`, because the legacy seed path must
 * keep its exact value until the cutover rewrites its callers (S1 changes no behaviour).
 */
export function barAt(raises: readonly { to: number; at: string }[], seed: number, at?: string): number {
  let bar = seed;
  for (const raise of raises) {
    if (at !== undefined && raise.at > at) continue;
    bar = Math.max(bar, raise.to);
  }
  return bar;
}

/**
 * The bar in force for a quantile scope: the fold, floored at ABSOLUTE_MIN, so no bar - authored,
 * measured or carried over from a legacy record - can sit below the floor good work must clear (A1).
 */
export function flooredBar(raises: readonly { to: number; at: string }[], seed: number, at?: string): number {
  return Math.max(ABSOLUTE_MIN, barAt(raises, seed, at));
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
/**
 * The bars a quantile gate reads: one per dimension, each the max fold of its own identity's raises,
 * floored at ABSOLUTE_MIN. There is no authored seed and no global scope: the floor is the default
 * (A7) and strictness comes only from what the population measured (spec 3.5).
 */
export interface QuantileBars {
  /** One bar per dimension id, always >= ABSOLUTE_MIN. */
  perDimension: Map<string, number>;
  /** Each dimension's identity key, so a caller can stamp what judged it. */
  keys: Map<string, string>;
}

/** `quantileBars` for a caller that holds options rather than an open store (brief, refusal). */
export function quantileBarsFor(options: EngineOptions, task: string, quality: Quality): QuantileBars {
  return withStore(options, (store) => quantileBars(store, task, quality));
}

export function quantileBars(store: Store, task: string, quality: Quality): QuantileBars {
  const seeds = barsFromQuality(quality);
  const perDimension = new Map<string, number>();
  for (const [id, key] of seeds.keys) {
    perDimension.set(id, flooredBar(raisesFor(store, task, id, key), ABSOLUTE_MIN));
  }
  return { perDimension, keys: new Map(seeds.keys) };
}

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

/**
 * The rubric sample recorded for one composition, if any (S3, R20): at most one per (task, version,
 * composition), and the LATEST one wins so a re-recorded sample supersedes an older verdict.
 */
export function sampleFor(store: Store, task: string, taskVersion: number, composition: string): z.infer<typeof RubricSampledSchema> | undefined {
  let found: z.infer<typeof RubricSampledSchema> | undefined;
  for (const event of scanEvents(store, [EVENT.rubricSampled])) {
    const raw = event.payload as Record<string, unknown>;
    if (raw.task !== task || raw.taskVersion !== taskVersion || raw.composition !== composition) continue;
    found = parseWith(RubricSampledSchema, event.payload, "STORE_INVALID", "rubric.sampled");
  }
  return found;
}
