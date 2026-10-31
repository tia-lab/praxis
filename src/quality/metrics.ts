/**
 * The metrics read-model (metrics unit).
 *
 * A READ-ONLY projection over the events Praxis already keeps: `quality.verdict`, `artifact.accepted`,
 * `bar.raised`/`bar.held`/`bar.contested`, `instance.failed` and `quality.continued`. Nothing is stored,
 * no table or view exists, and this module is NOT imported by the gate, the evaluator or the engine - it
 * describes work, it never decides anything.
 *
 * Every row carries its own `n` and is marked PROVISIONAL below `PROVISIONAL_MIN` observations, because
 * a rate over a handful of verdicts is noise. The labels are descriptive: a "bottleneck share" is the
 * share of refusals in which a dimension had the lowest score, not a cause; a "Q50 rate" is a trigger
 * rate, not evidence of learning. No per-agent attribution: the instance is the unit, because a trusted
 * actor identity (store gate #3) is deferred and must not be implied by a metric.
 */
import type { Store } from "../store/db.ts";
import { ABSOLUTE_MIN, CALIBRATION_MIN, EVENT } from "../runner/engine/types.ts";
import type { EngineOptions } from "../runner/engine/types.ts";
import { withStore } from "../runner/engine/support.ts";
import { flooredBar, raisesOf, scanEvents, type LogEvent } from "./bar.ts";

/** Below this many observations a row is reported as PROVISIONAL, never as a rate. */
export const PROVISIONAL_MIN = CALIBRATION_MIN;

const round = (value: number): number => Math.round(value * 10000) / 10000;
const ratio = (part: number, whole: number): number => (whole === 0 ? 0 : round(part / whole));
const dayOf = (at: string): string => at.slice(0, 10);

/** One (task, dimension) row: what the verdicts said about a dimension, and the bar in force. */
export interface DimensionMetrics {
  task: string;
  dimension: string;
  /** Verdicts that carried a score for this dimension: the row's own sample size. */
  n: number;
  mean: number;
  median: number;
  /** Fraction of those verdicts scoring the dimension below the ABSOLUTE floor (0.5). */
  belowFloor: number;
  /** The bar in force: the fold of this dimension's recorded raises, floored at 0.5. */
  bar: number;
  /** `bar.contested` events recorded for this dimension. */
  contested: number;
  /** Fraction of this dimension's verdicts that flagged it (score passed but below its own Q50). */
  q50Rate: number;
  /** Share of the task's REFUSED verdicts in which this dimension had the lowest score. */
  bottleneckShare: number;
  /** mean - bar: how far the average judgment sat from the standard in force. */
  headroom: number;
  provisional: boolean;
}

/** One task row: the unit's throughput and the dimension that most often decided a refusal. */
export interface TaskMetrics {
  task: string;
  instances: number;
  verdicts: number;
  /** Fraction of instances that received at least one passing verdict. */
  eventualPassRate: number;
  /** Fraction of instances whose FIRST verdict passed. */
  firstAttemptPassRate: number;
  /** The dimension with the largest bottleneck share, when the task has refusals. */
  bottleneckDimension: string | undefined;
  /** Fraction of the task's verdicts that flagged at least one dimension. */
  q50Rate: number;
  provisional: boolean;
}

/** One day bucket of one dimension: the bar in force that day and the mean judgment. */
export interface BarPoint {
  task: string;
  dimension: string;
  day: string;
  n: number;
  mean: number;
  bar: number;
  /** True while the bar has not fallen since the previous bucket (the monotone record). */
  monotone: boolean;
}

/** Workflow shape, only where the instance events support it cheaply. */
export interface FlowMetrics {
  instances: number;
  acceptedSteps: number;
  /** Mean verdicts recorded for an (instance, step) before its artifact was accepted. */
  attemptsToAccept: number;
  escalations: number;
  escalationRate: number;
  /** `quality.continued` events: the bounded retry carried a failing attempt forward. */
  stalls: number;
}

export interface MetricsReadModel {
  dimensions: DimensionMetrics[];
  tasks: TaskMetrics[];
  timeseries: BarPoint[];
  flow: FlowMetrics;
}

/** A verdict as the read-model needs it: no transcript, no artifact bytes, no actor. */
interface Verdict {
  instance: string;
  at: string;
  task: string;
  decision: string;
  passed: boolean;
  flagged: string[];
  scores: { id: string; score: number }[];
}

function verdictsOf(events: readonly LogEvent[]): Verdict[] {
  const verdicts: Verdict[] = [];
  for (const event of events) {
    if (event.type !== EVENT.qualityVerdict) continue;
    const payload = event.payload;
    const dimensions = Array.isArray(payload.dimensions) ? payload.dimensions : [];
    const scores = dimensions.flatMap((entry) => {
      const cell = entry as { id?: unknown; score?: unknown };
      return typeof cell.id === "string" && typeof cell.score === "number" ? [{ id: cell.id, score: cell.score }] : [];
    });
    if (scores.length === 0) continue;
    const decision = String(payload.decision ?? "unavailable");
    verdicts.push({
      instance: event.instance,
      at: event.at,
      task: String(payload.task ?? ""),
      decision,
      passed: decision === "pass",
      flagged: Array.isArray(payload.flagged) ? payload.flagged.map(String) : [],
      scores,
    });
  }
  return verdicts;
}

/** The raises recorded for one task, per dimension scope: the bar in force is their fold. */
function barsOf(store: Store, task: string): Map<string, { to: number; at: string }[]> {
  const byDimension = new Map<string, { to: number; at: string }[]>();
  for (const raise of raisesOf(store, task)) {
    const scope = raise.scope ?? "global";
    if (scope === "global") continue; // a legacy global raise is not a dimension bar
    const list = byDimension.get(scope) ?? [];
    list.push({ to: raise.to, at: raise.at });
    byDimension.set(scope, list);
  }
  return byDimension;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? round((sorted[middle - 1]! + sorted[middle]!) / 2) : sorted[middle]!;
}

/** The dimension that had the LOWEST score in one verdict: the one that decided a refusal. */
function lowestOf(verdict: Verdict): string | undefined {
  let lowest: { id: string; score: number } | undefined;
  for (const entry of verdict.scores) {
    if (lowest === undefined || entry.score < lowest.score) lowest = entry;
  }
  return lowest?.id;
}

/**
 * The read-model over one open store. Pure query: it reads the event log and computes, and writes nothing.
 * `task` narrows every row to one task ref (`tasks/<path>`); absent means every task in the store.
 */
export function readMetrics(store: Store, options: { task?: string } = {}): MetricsReadModel {
  const events = scanEvents(store, [
    EVENT.qualityVerdict,
    EVENT.artifactAccepted,
    EVENT.barRaised,
    EVENT.barHeld,
    EVENT.barContested,
    EVENT.instanceFailed,
    EVENT.qualityContinued,
  ]);
  const allVerdicts = verdictsOf(events).filter((verdict) => verdict.task !== "");
  const tasks = [...new Set(allVerdicts.map((verdict) => verdict.task))].sort();
  const scoped = options.task === undefined ? allVerdicts : allVerdicts.filter((verdict) => verdict.task === options.task);
  const tasksInScope = options.task === undefined ? tasks : tasks.filter((task) => task === options.task);

  // Refusals per task, for the bottleneck share: which dimension had the lowest score in each one.
  const refusals = new Map<string, number>();
  const lowestCounts = new Map<string, number>();
  for (const verdict of scoped) {
    if (verdict.passed) continue;
    refusals.set(verdict.task, (refusals.get(verdict.task) ?? 0) + 1);
    const lowest = lowestOf(verdict);
    if (lowest === undefined) continue;
    const key = verdict.task + "\u0000" + lowest;
    lowestCounts.set(key, (lowestCounts.get(key) ?? 0) + 1);
  }

  // Per (task, dimension) scores in verdict order, and the flag/contest facts beside them.
  const scores = new Map<string, { task: string; dimension: string; values: number[]; flagged: number }>();
  for (const verdict of scoped) {
    for (const entry of verdict.scores) {
      const key = verdict.task + "\u0000" + entry.id;
      const row = scores.get(key) ?? { task: verdict.task, dimension: entry.id, values: [], flagged: 0 };
      row.values.push(entry.score);
      if (verdict.flagged.includes(entry.id)) row.flagged += 1;
      scores.set(key, row);
    }
  }

  const raisedBars = new Map<string, Map<string, { to: number; at: string }[]>>();
  for (const task of tasksInScope) raisedBars.set(task, barsOf(store, task));
  const contested = new Map<string, number>();
  for (const event of events) {
    if (event.type !== EVENT.barContested) continue;
    const task = String(event.payload.task ?? "");
    if (!tasksInScope.includes(task)) continue;
    const scope = String(event.payload.scope ?? "global");
    const key = task + "\u0000" + scope;
    contested.set(key, (contested.get(key) ?? 0) + 1);
  }

  const dimensions: DimensionMetrics[] = [...scores.values()]
    .map((row) => {
      const key = row.task + "\u0000" + row.dimension;
      const raises = raisedBars.get(row.task)?.get(row.dimension) ?? [];
      const bar = flooredBar(raises, ABSOLUTE_MIN);
      const n = row.values.length;
      const mean = ratio(row.values.reduce((sum, value) => sum + value, 0), n);
      return {
        task: row.task,
        dimension: row.dimension,
        n,
        mean,
        median: median(row.values),
        belowFloor: ratio(row.values.filter((value) => value < ABSOLUTE_MIN).length, n),
        bar: round(bar),
        contested: contested.get(key) ?? 0,
        q50Rate: ratio(row.flagged, n),
        bottleneckShare: ratio(lowestCounts.get(key) ?? 0, refusals.get(row.task) ?? 0),
        headroom: round(mean - bar),
        provisional: n < PROVISIONAL_MIN,
      };
    })
    .sort((left, right) => left.task.localeCompare(right.task) || right.n - left.n || left.dimension.localeCompare(right.dimension));

  const taskRows: TaskMetrics[] = tasksInScope.map((task) => {
    const own = scoped.filter((verdict) => verdict.task === task);
    const byInstance = new Map<string, Verdict[]>();
    for (const verdict of own) {
      const list = byInstance.get(verdict.instance) ?? [];
      list.push(verdict);
      byInstance.set(verdict.instance, list);
    }
    const instances = byInstance.size;
    let eventual = 0;
    let first = 0;
    for (const list of byInstance.values()) {
      if (list.some((verdict) => verdict.passed)) eventual += 1;
      if (list[0]?.passed === true) first += 1;
    }
    const ownDimensions = dimensions.filter((row) => row.task === task && row.bottleneckShare > 0);
    const bottleneck = ownDimensions.sort((left, right) => right.bottleneckShare - left.bottleneckShare)[0];
    return {
      task,
      instances,
      verdicts: own.length,
      eventualPassRate: ratio(eventual, instances),
      firstAttemptPassRate: ratio(first, instances),
      bottleneckDimension: bottleneck?.dimension,
      q50Rate: ratio(own.filter((verdict) => verdict.flagged.length > 0).length, own.length),
      provisional: own.length < PROVISIONAL_MIN,
    };
  });

  // Day buckets per (task, dimension): the bar in force at the END of that day and the mean judgment.
  const buckets = new Map<string, { task: string; dimension: string; day: string; values: number[] }>();
  for (const verdict of scoped) {
    const day = dayOf(verdict.at);
    for (const entry of verdict.scores) {
      const key = verdict.task + "\u0000" + entry.id + "\u0000" + day;
      const bucket = buckets.get(key) ?? { task: verdict.task, dimension: entry.id, day, values: [] };
      bucket.values.push(entry.score);
      buckets.set(key, bucket);
    }
  }
  const timeseries: BarPoint[] = [...buckets.values()]
    .map((bucket) => {
      const raises = (raisedBars.get(bucket.task)?.get(bucket.dimension) ?? []).filter((raise) => dayOf(raise.at) <= bucket.day);
      return {
        task: bucket.task,
        dimension: bucket.dimension,
        day: bucket.day,
        n: bucket.values.length,
        mean: ratio(bucket.values.reduce((sum, value) => sum + value, 0), bucket.values.length),
        bar: round(flooredBar(raises, ABSOLUTE_MIN)),
      };
    })
    .sort((left, right) => left.task.localeCompare(right.task) || left.dimension.localeCompare(right.dimension) || left.day.localeCompare(right.day))
    .map((point, index, list) => {
      const previous = list[index - 1];
      const sameSeries = previous !== undefined && previous.task === point.task && previous.dimension === point.dimension;
      return { ...point, monotone: sameSeries ? point.bar >= previous.bar : true };
    });

  // Workflow shape: attempts before acceptance, escalations, stalls. All from existing events.
  const instances = new Set(scoped.map((verdict) => verdict.instance)).size;
  const accepted = events.filter((event) => event.type === EVENT.artifactAccepted);
  const acceptedInScope = accepted.filter((event) => tasksInScope.includes(String(event.payload.task ?? "")));
  let attempts = 0;
  for (const event of acceptedInScope) {
    attempts += scoped.filter((verdict) => verdict.instance === event.instance && verdict.at <= event.at).length;
  }
  const escalated = events.filter((event) => event.type === EVENT.instanceFailed).length;
  const stalls = events.filter((event) => event.type === EVENT.qualityContinued).length;
  const flow: FlowMetrics = {
    instances,
    acceptedSteps: acceptedInScope.length,
    attemptsToAccept: ratio(attempts, acceptedInScope.length),
    escalations: escalated,
    escalationRate: ratio(escalated, instances),
    stalls,
  };
  void tasks;
  return { dimensions, tasks: taskRows, timeseries, flow };
}

/** `readMetrics` for a caller holding engine options: one short read, closed before anything else runs. */
export function metricsFor(options: EngineOptions, task?: string): MetricsReadModel {
  return withStore(options, (store) => readMetrics(store, task === undefined ? {} : { task }));
}

/** The thin print surface: the model as aligned text, one block per table. */
export function formatMetrics(model: MetricsReadModel): string {
  const pct = (value: number): string => (value * 100).toFixed(1) + "%";
  const fixed = (value: number): string => value.toFixed(3);
  const mark = (row: { provisional: boolean }): string => (row.provisional ? " (provisional)" : "");
  const table = (headers: readonly string[], rows: readonly (readonly string[])[]): string => {
    const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length)));
    const line = (cells: readonly string[]): string => cells.map((cell, index) => cell.padEnd(widths[index]!)).join("  ").trimEnd();
    return [line(headers), widths.map((width) => "-".repeat(width)).join("  "), ...rows.map(line)].join("\n");
  };
  const sections: string[] = [];
  sections.push("TASKS (n = verdicts; provisional below " + PROVISIONAL_MIN + ")");
  sections.push(
    table(
      ["task", "n", "instances", "eventual pass", "first-attempt pass", "Q50 rate", "bottleneck"],
      model.tasks.map((row) => [
        row.task + mark(row),
        String(row.verdicts),
        String(row.instances),
        pct(row.eventualPassRate),
        pct(row.firstAttemptPassRate),
        pct(row.q50Rate),
        row.bottleneckDimension ?? "-",
      ]),
    ),
  );
  sections.push("");
  sections.push("DIMENSIONS (per task; n = verdicts carrying it; provisional below " + PROVISIONAL_MIN + ")");
  sections.push(
    table(
      ["task", "dimension", "n", "mean", "median", "<0.5", "bar", "headroom", "Q50 rate", "bottleneck share", "contested"],
      model.dimensions.map((row) => [
        row.task + mark(row),
        row.dimension,
        String(row.n),
        fixed(row.mean),
        fixed(row.median),
        pct(row.belowFloor),
        fixed(row.bar),
        fixed(row.headroom),
        pct(row.q50Rate),
        pct(row.bottleneckShare),
        String(row.contested),
      ]),
    ),
  );
  sections.push("");
  sections.push("TIMESERIES (day buckets; monotone = the bar has not fallen since the previous bucket)");
  sections.push(
    table(
      ["task", "dimension", "day", "n", "mean", "bar", "monotone"],
      model.timeseries.map((point) => [
        point.task,
        point.dimension,
        point.day,
        String(point.n),
        fixed(point.mean),
        fixed(point.bar),
        point.monotone ? "yes" : "NO",
      ]),
    ),
  );
  sections.push("");
  sections.push("FLOW (instance level; no per-agent attribution)");
  sections.push(
    [
      "instances",
      "accepted steps",
      "attempts to accept (mean)",
      "escalations",
      "escalation rate",
      "stalls (quality.continued)",
    ].join("  ") +
      "\n" +
      [
        String(model.flow.instances),
        String(model.flow.acceptedSteps),
        fixed(model.flow.attemptsToAccept),
        String(model.flow.escalations),
        pct(model.flow.escalationRate),
        String(model.flow.stalls),
      ].join("  "),
  );
  return sections.join("\n") + "\n";
}
