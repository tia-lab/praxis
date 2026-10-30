/**
 * pareto-gate: the acceptance gate stops tightening at the Pareto point (default 0.8), while the EMA
 * ratchet keeps recording the level it reaches (option A).
 *
 * Proves: a good run is accepted although the ratcheted bar sits above it; below the Pareto point
 * nothing changes; the default applies when a task declares no threshold; a task override is
 * honoured in the strict direction; and the bars still ratchet above the Pareto point.
 *
 * NO NETWORK: a fake scorer drives every case; the store is a temp workspace.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_PARETO_THRESHOLD,
  barsFromQuality,
  compoundDecision,
  effectiveBarsFor,
} from "../../src/quality/index.ts";
import { isAppError } from "../../src/types/errors.ts";
import type { Quality } from "../../src/types/schema.ts";
import {
  LEARNING_RUBRIC,
  clock,
  dimensionScorer,
  dispose,
  eventsOf,
  judgedFlow,
  learningOptions,
  startJudged,
  submitJudged,
  workspace,
  type JudgedRun,
  type Workspace,
} from "../testkit.ts";

const TASK = "tasks/make";
const DEFAULT_QUALITY: Quality = { dimensions: LEARNING_RUBRIC, threshold: 0.6, policy: "required" };

/** One submit scored per dimension; the typed refusal comes back instead of throwing. */
async function submit(
  ws: Workspace,
  tick: () => string,
  requestId: string,
  frame: Record<string, number>,
): Promise<{ run: JudgedRun; refusal: unknown }> {
  const run = startJudged(ws, requestId, tick());
  try {
    await submitJudged(ws, run, tick(), 1, dimensionScorer([frame]));
    return { run, refusal: undefined };
  } catch (error) {
    assert.ok(isAppError(error), "a refusal is a typed AppError");
    return { run, refusal: error };
  }
}

const barsNow = (ws: Workspace, quality: Quality) =>
  effectiveBarsFor(learningOptions(ws, "2026-10-30T00:00:00.000Z"), TASK, quality);

test("gateBar caps at the Pareto point and never lifts a bar into it", () => {
  assert.equal(DEFAULT_PARETO_THRESHOLD, 0.8);
  assert.equal(barsFromQuality(DEFAULT_QUALITY).pareto, 0.8, "the code default when a task declares none");
  assert.equal(barsFromQuality({ ...DEFAULT_QUALITY, paretoThreshold: 0.9 }).pareto, 0.9);
  const bars = barsFromQuality(DEFAULT_QUALITY);
  assert.deepEqual(
    compoundDecision(
      [
        { id: "solves", score: 0.82 },
        { id: "evidence", score: 0.82 },
        { id: "trace", score: 0.82 },
      ],
      { global: 0.87, perDimension: new Map(), pareto: bars.pareto },
    ),
    { pass: true, mean: 0.82, flagged: [], refused: [] },
    "a 0.82 run passes a 0.87 bar because the gate caps at 0.8",
  );
  assert.equal(
    compoundDecision(
      [
        { id: "solves", score: 0.82 },
        { id: "evidence", score: 0.82 },
        { id: "trace", score: 0.82 },
      ],
      { global: 0.87, perDimension: new Map(), pareto: 1 },
    ).pass,
    false,
    "uncapped, the same run is refused — the cap is what accepts it",
  );
});

test("a good run is accepted although the ratcheted bars sit above it", async () => {
  const ws = workspace();
  try {
    const tick = clock().next;
    // Authored floors ARE the effective bars with no history: a 0.87 MEAN bar and a 0.90 dimension bar,
    // both above the Pareto point — the state the owner described (a ratchet that climbed too high).
    const quality: Quality = {
      dimensions: [
        { id: "solves", statement: "it solves the stated goal", floor: 0.9 },
        { id: "evidence", statement: "every claim carries evidence" },
        { id: "trace", statement: "the reasoning traces back to its sources" },
      ],
      threshold: 0.87,
      policy: "required",
    };
    judgedFlow(ws, { dimensions: quality.dimensions, threshold: 0.87 });
    const bars = barsNow(ws, quality);
    assert.equal(bars.global, 0.87);
    assert.equal(bars.perDimension.get("solves"), 0.9);

    const frame = { solves: 0.82, evidence: 0.82, trace: 0.82 };
    const { run, refusal } = await submit(ws, tick, "good-run", frame);
    assert.equal(refusal, undefined, "a mean of 0.82 is good enough: nothing is refused");

    const verdict = eventsOf(ws, run.instance).find((event) => event.type === "quality.verdict")?.payload as
      | { decision: string; mean: number; flagged: string[] }
      | undefined;
    assert.ok(verdict, "the verdict is recorded");
    assert.equal(verdict.decision, "pass");
    assert.equal(verdict.mean, 0.82);
    assert.deepEqual(verdict.flagged, [], "every dimension is at or above the capped bar");

    // The same scores against the SAME bars, uncapped, would be refused — the cap is the only difference.
    const dims = quality.dimensions.map((dimension) => ({ id: dimension.id, score: 0.82 }));
    assert.equal(compoundDecision(dims, { global: bars.global, perDimension: bars.perDimension, pareto: 1 }).pass, false);
    assert.equal(compoundDecision(dims, { global: bars.global, perDimension: bars.perDimension, pareto: bars.pareto }).pass, true);
  } finally {
    dispose(ws);
  }
});

test("a task-level paretoThreshold override is honoured", async () => {
  const strict = workspace();
  const standard = workspace();
  try {
    const tick = clock().next;
    // The same 0.95 floor, capped at 0.9 (the task's own override) vs the default 0.8.
    judgedFlow(strict, { threshold: 0.95, paretoThreshold: 0.9 });
    judgedFlow(standard, { threshold: 0.95 });
    const frame = { solves: 0.84, evidence: 0.84, trace: 0.84 };

    const strictRun = await submit(strict, tick, "strict", frame);
    assert.equal(barsNow(strict, { ...DEFAULT_QUALITY, threshold: 0.95, paretoThreshold: 0.9 }).pareto, 0.9);
    assert.ok(strictRun.refusal, "a 0.84 run sits under the 0.9 cap's band and is refused");
    assert.equal((strictRun.refusal as { code: string }).code, "QUALITY_BELOW_THRESHOLD");

    const standardRun = await submit(standard, tick, "standard", frame);
    assert.equal(standardRun.refusal, undefined, "the same run passes at the default 0.8 cap");
  } finally {
    dispose(strict);
    dispose(standard);
  }
});

test("the ratchet still records above the Pareto point, and the gate accepts below it", async () => {
  const ws = workspace();
  try {
    judgedFlow(ws);
    const tick = clock().next;
    const runs: JudgedRun[] = [];
    // Warmup (10) then one raise per cooldown (5): 0.65, 0.70, 0.75, 0.80, 0.85 — past the Pareto point.
    for (let index = 1; index <= 30; index += 1) {
      const run = startJudged(ws, "climb-" + index, tick());
      runs.push(run);
      await submitJudged(ws, run, tick(), 1, dimensionScorer([{ solves: 0.95, evidence: 0.95, trace: 0.95 }]));
    }
    const raises = runs
      .flatMap((run) => eventsOf(ws, run.instance))
      .filter((event) => event.type === "bar.raised")
      .map((event) => event.payload as { scope?: string; to: number });
    const globalRaises = raises.filter((payload) => (payload.scope ?? "global") === "global");
    assert.deepEqual(
      globalRaises.map((payload) => payload.to),
      [0.65, 0.7, 0.75, 0.8, 0.85],
      "the ratchet records every level it reaches, including above 0.8",
    );
    const bars = barsNow(ws, DEFAULT_QUALITY);
    assert.equal(bars.global, 0.85, "the bar in force is above the Pareto point");
    assert.equal(bars.pareto, 0.8, "and the gate still caps at 0.8");

    // A 0.82 run is accepted at the capped 0.8 and would be refused at the uncapped 0.85 MEAN bar.
    const { run, refusal } = await submit(ws, tick, "after-climb", { solves: 0.82, evidence: 0.82, trace: 0.82 });
    assert.equal(refusal, undefined, "good enough is accepted even though the bar climbed higher");
    const verdict = eventsOf(ws, run.instance).find((event) => event.type === "quality.verdict")?.payload as { decision: string };
    assert.equal(verdict.decision, "pass");
    assert.equal(barsNow(ws, DEFAULT_QUALITY).global, 0.85, "acceptance never lowers the recorded bar");
  } finally {
    dispose(ws);
  }
});
