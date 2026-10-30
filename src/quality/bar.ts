/**
 * The adaptive bar (O2, task-level): the effective floor a task is judged against, and the
 * ratchet that raises it from *stable, easily-earned* competence. Every input is derived from the
 * append-only event log — passes from `artifact.accepted` paired with their `quality.verdict`,
 * raises from `bar.raised` — so the bar is engine-computed, auditable and never set by the agent.
 *
 * Frozen defaults (O2): window W = 5 genuine passes; raise only when the lower-quartile headroom
 * is >= 0.12 AND stdev <= 0.08 AND mean attempts <= 2 AND the cooldown has elapsed; step is
 * `min(0.05, 0.5 * (margin - 0.12))`, clamped to `[min_floor, 0.9]`. Never auto-lowers: a full
 * window under the raised bar with no pass emits `bar.contested` for the owner instead.
 */
import { z } from "zod";
import { BarContestedSchema, BarRaisedSchema, parseWith, type Quality } from "../types/schema.ts";
import { storeCall, type Store } from "../store/db.ts";
import { appendEvent } from "../store/events.ts";
import { withStore } from "../runner/engine/support.ts";
import { EVENT } from "../runner/engine/types.ts";
import type { EngineOptions } from "../runner/engine/types.ts";

/** The frozen formula identity, recorded on every raise so the record is reproducible. */
export const BAR_FORMULA_ID = "praxis.bar/v1";
/** How many genuine passes the window judges. */
export const BAR_WINDOW = 5;
/** Minimum lower-quartile headroom above the floor. */
export const BAR_MARGIN_MIN = 0.12;
/** Maximum score spread the window may carry. */
export const BAR_STDEV_MAX = 0.08;
/** Maximum mean attempts: when agents pass easily, the bar is too low. */
export const BAR_MEAN_ATTEMPTS_MAX = 2;
/** Above this, model-judge noise dominates. */
export const BAR_CEILING = 0.9;
/** The largest single raise. */
export const BAR_MAX_STEP = 0.05;

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

/** Does this event belong to the task version named? Task-scoped reads filter exactly here. */
export function ofTask(event: LogEvent, task: string, taskVersion: number): boolean {
  return event.payload.task === task && Number(event.payload.taskVersion) === taskVersion;
}

/** Every raise recorded for one task version, in log order. */
export function raisesOf(store: Store, task: string, taskVersion: number): z.infer<typeof BarRaisedSchema>[] {
  return scanEvents(store, [EVENT.barRaised])
    .filter((event) => ofTask(event, task, taskVersion))
    .map((event) => parseWith(BarRaisedSchema, event.payload, "STORE_INVALID", "bar.raised"));
}

/**
 * The floor in force at an instant: the authored `min_floor` folded through every raise recorded
 * up to `at` (all raises when `at` is absent). Pure, so the same store yields the same number.
 */
export function barAt(raises: readonly { to: number; at: string }[], minFloor: number, at?: string): number {
  let bar = minFloor;
  for (const raise of raises) {
    if (at !== undefined && raise.at > at) continue;
    bar = raise.to;
  }
  return bar;
}

/** The effective floor for a task version right now: never below the authored `min_floor`. */
export function effectiveBar(store: Store, task: string, taskVersion: number, quality: Quality): number {
  return barAt(raisesOf(store, task, taskVersion), quality.threshold);
}

/** `effectiveBar` for a caller that holds options rather than an open store (the scorer, the brief). */
export function effectiveBarFor(
  options: EngineOptions,
  task: string,
  taskVersion: number,
  quality: Quality,
): number {
  return withStore(options, (store) => effectiveBar(store, task, taskVersion, quality));
}

/** One genuine pass: an accepted artifact whose own verdict passed and was not a carried failure. */
export interface GenuinePass {
  instance: string;
  step: string;
  version: number;
  score: number;
  attempts: number;
  at: string;
}

/**
 * Every genuine pass of a task version, in log order. A continued-FAILED artifact is excluded
 * twice over — its acceptance carries `failed` and its verdict never decided `pass` — so
 * `onFailure=continue` cannot inflate the bar.
 */
export function genuinePasses(store: Store, task: string, taskVersion: number): GenuinePass[] {
  const events = scanEvents(store, [EVENT.artifactAccepted, EVENT.qualityVerdict]);
  const verdicts = new Map<string, { version: number; decision: string; score: number }[]>();
  for (const event of events) {
    if (event.type !== EVENT.qualityVerdict) continue;
    const key = event.instance + "\u0000" + String(event.payload.step);
    const list = verdicts.get(key) ?? [];
    list.push({
      version: Number(event.payload.version),
      decision: String(event.payload.decision),
      score: Number(event.payload.score),
    });
    verdicts.set(key, list);
  }
  const passes: GenuinePass[] = [];
  for (const event of events) {
    if (event.type !== EVENT.artifactAccepted) continue;
    if (!ofTask(event, task, taskVersion)) continue;
    if (event.payload.failed !== undefined) continue;
    const version = Number(event.payload.version);
    const step = String(event.payload.step);
    const attempts = (verdicts.get(event.instance + "\u0000" + step) ?? []).filter(
      (verdict) => verdict.version <= version,
    );
    const own = attempts.find((verdict) => verdict.version === version && verdict.decision === "pass");
    if (own === undefined) continue;
    passes.push({ instance: event.instance, step, version, score: own.score, attempts: attempts.length, at: event.at });
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

/** What one evaluation of the ratchet decided, so a caller (or a test) can assert it. */
export type BarDecision =
  | { kind: "raised"; raised: z.infer<typeof BarRaisedSchema> }
  | { kind: "contested"; contested: z.infer<typeof BarContestedSchema> }
  | { kind: "held"; reason: string };

const round4 = (value: number): number => Math.round(value * 10000) / 10000;

/**
 * Re-evaluate the ratchet after one terminal task outcome. Cheap to call every time: it only acts
 * when a full qualifying window has accumulated. Both signals are appended to the log, so a raise
 * and a contest are as durable and as auditable as the passes they were computed from.
 */
export function recomputeBar(
  store: Store,
  task: string,
  taskVersion: number,
  quality: Quality,
  at: string,
): BarDecision {
  const raises = raisesOf(store, task, taskVersion);
  const current = barAt(raises, quality.threshold);
  const lastRaise = raises.length === 0 ? undefined : raises[raises.length - 1].at;
  // Cooldown: the window is built only from passes recorded AFTER the last raise, so a raise can
  // never follow another one before a full W of fresh passes has accumulated.
  const sinceRaise = genuinePasses(store, task, taskVersion).filter(
    (pass) => lastRaise === undefined || pass.at > lastRaise,
  );
  const window = sinceRaise.slice(-BAR_WINDOW);
  const raised = decideRaise(task, taskVersion, quality, at, current, window);
  if (raised !== undefined) {
    appendEvent(store, raised.instance, { type: EVENT.barRaised, payload: raised.raised, at });
    return { kind: "raised", raised: raised.raised };
  }
  const contested = decideContest(store, task, taskVersion, at, current, raises);
  if (contested !== undefined) return { kind: "contested", contested };
  return { kind: "held", reason: "no qualifying window" };
}

/** The raise itself: all four frozen gates must hold over a full window of genuine passes. */
function decideRaise(
  task: string,
  taskVersion: number,
  quality: Quality,
  at: string,
  current: number,
  window: readonly GenuinePass[],
): { raised: z.infer<typeof BarRaisedSchema>; instance: string } | undefined {
  if (window.length < BAR_WINDOW) return undefined;
  const scores = window.map((pass) => pass.score);
  const quartile = lowerQuartile([...scores].sort((left, right) => left - right));
  const margin = quartile - current;
  const spread = stdev(scores);
  const meanAttempts = window.reduce((sum, pass) => sum + pass.attempts, 0) / window.length;
  if (margin < BAR_MARGIN_MIN || spread > BAR_STDEV_MAX || meanAttempts > BAR_MEAN_ATTEMPTS_MAX) {
    return undefined;
  }
  const step = Math.min(BAR_MAX_STEP, 0.5 * (margin - BAR_MARGIN_MIN));
  const to = round4(Math.min(BAR_CEILING, Math.max(quality.threshold, current + step)));
  if (!(to > current)) return undefined;
  const raised = parseWith(
    BarRaisedSchema,
    {
      task,
      taskVersion,
      from: current,
      to,
      window: {
        passes: scores,
        lowerQuartile: quartile,
        margin: round4(margin),
        stdev: round4(spread),
        meanAttempts: round4(meanAttempts),
      },
      formulaId: BAR_FORMULA_ID,
      at,
    },
    "RESULT_INVALID",
    "bar.raised",
  );
  // Recorded on the instance whose outcome triggered it, so the signal travels with the work.
  return { raised, instance: window[window.length - 1].instance };
}

/** The loud signal: a full window under the raised bar with zero passes. Never an auto-lower. */
function decideContest(
  store: Store,
  task: string,
  taskVersion: number,
  at: string,
  current: number,
  raises: readonly { to: number; at: string }[],
): z.infer<typeof BarContestedSchema> | undefined {
  if (raises.length === 0) return undefined;
  const lastRaise = raises[raises.length - 1].at;
  const verdicts = scanEvents(store, [EVENT.qualityVerdict]).filter(
    (event) => ofTask(event, task, taskVersion) && event.at > lastRaise,
  );
  const passes = genuinePasses(store, task, taskVersion).filter((pass) => pass.at > lastRaise);
  if (verdicts.length < BAR_WINDOW || passes.length > 0) return undefined;
  const already = scanEvents(store, [EVENT.barContested]).some(
    (event) => ofTask(event, task, taskVersion) && Number(event.payload.bar) === current,
  );
  if (already) return undefined;
  const contested = parseWith(
    BarContestedSchema,
    {
      task,
      taskVersion,
      bar: current,
      attempts: verdicts.length,
      reason: "a full window (" + verdicts.length + " attempts) under the raised bar yielded no pass",
    },
    "RESULT_INVALID",
    "bar.contested",
  );
  appendEvent(store, verdicts[verdicts.length - 1].instance, { type: EVENT.barContested, payload: contested, at });
  return contested;
}
