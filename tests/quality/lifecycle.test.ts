/**
 * Slice 3: the DIMENSION LIFECYCLE. Bars are keyed by dimension IDENTITY (id + statement) and the
 * global bar by the rubric's composition, so a republish does not throw away learned competence:
 * unchanged dimensions INHERIT their earned bars, a new or reworded dimension starts again at its
 * floor and warms up on its own observations, a removed dimension goes dormant, and the global MEAN
 * bar re-warms whenever the composition changes.
 *
 * Each case earns real bars first (ten genuine passes through the judged flow), then republishes the
 * task at a new version, exactly as an owner editing a rubric would. A fake scorer: no network.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { WARMUP_MIN, compositionKey, dimensionKey, effectiveBarsFor } from "../../src/quality/index.ts";
import type { Quality } from "../../src/types/schema.ts";
import {
  JUDGED_SCHEMA,
  clock,
  dimensionScorer,
  dispose,
  eventsOf,
  learningOptions,
  startJudged,
  submitJudged,
  workspace,
  writeFlow,
  type JudgedRun,
  type Workspace,
} from "../testkit.ts";

const TASK = "tasks/make";
const GROUNDED = { id: "grounded", statement: "claims are grounded in sources", floor: 0.6 };
const COVERS = { id: "covers-question", statement: "the answer covers the question", floor: 0.6 };
const TRACE = { id: "trace", statement: "the reasoning traces back to its sources", floor: 0.6 };

/** Publish the task at `version` with `dimensions`; the flow document itself never changes. */
function publish(ws: Workspace, version: number, dimensions: readonly typeof GROUNDED[]): void {
  writeFlow(ws, "learn", [
    {
      id: "make",
      version,
      capabilities: ["artifact.write", "emit", "evaluate"],
      schema: JUDGED_SCHEMA,
      quality: { dimensions, threshold: 0.6, policy: "required" },
    },
  ]);
}

const qualityOf = (dimensions: readonly typeof GROUNDED[]): Quality => ({
  dimensions: [...dimensions],
  threshold: 0.6,
  policy: "required",
});

/** Ten stable, high passes: every scope warm, and every bar raised 0.60 -> 0.65. */
async function earnBars(ws: Workspace, tick: () => string, dimensions: readonly typeof GROUNDED[]): Promise<JudgedRun[]> {
  const runs: JudgedRun[] = [];
  for (let index = 1; index <= WARMUP_MIN; index += 1) {
    const run = startJudged(ws, "earn-" + index, tick());
    runs.push(run);
    const frame = Object.fromEntries(dimensions.map((dimension) => [dimension.id, 0.95]));
    await submitJudged(ws, run, tick(), 1, dimensionScorer([frame]));
  }
  return runs;
}

/** Submit `count` more high passes at the currently published rubric. */
async function passMore(ws: Workspace, tick: () => string, dimensions: readonly typeof GROUNDED[], count: number, prefix: string): Promise<JudgedRun[]> {
  const runs: JudgedRun[] = [];
  for (let index = 1; index <= count; index += 1) {
    const run = startJudged(ws, prefix + index, tick());
    runs.push(run);
    const frame = Object.fromEntries(dimensions.map((dimension) => [dimension.id, 0.95]));
    await submitJudged(ws, run, tick(), 1, dimensionScorer([frame]));
  }
  return runs;
}

const raisesOf = (ws: Workspace, runs: readonly JudgedRun[], scope: string): Array<Record<string, unknown>> =>
  runs.flatMap((run) =>
    eventsOf(ws, run.instance)
      .filter((event) => event.type === "bar.raised" && (event.payload as { scope?: string }).scope === scope)
      .map((event) => event.payload as Record<string, unknown>),
  );

test("adding a dimension: unchanged bars inherit, the new one starts at its floor and the global re-warms", async () => {
  const ws = workspace();
  try {
    const tick = clock().next;
    publish(ws, 1, [GROUNDED, COVERS]);
    const earned = await earnBars(ws, tick, [GROUNDED, COVERS]);
    const before = effectiveBarsFor(learningOptions(ws, tick()), TASK, qualityOf([GROUNDED, COVERS]));
    assert.equal(before.perDimension.get("grounded"), 0.65);
    assert.equal(before.perDimension.get("covers-question"), 0.65);
    assert.equal(before.global, 0.65, "the global MEAN bar was earned under the two-dimension rubric");

    // Republish at v2 with a THIRD dimension: nothing about the first two identities changed.
    const wider = [GROUNDED, COVERS, TRACE];
    publish(ws, 2, wider);
    const after = effectiveBarsFor(learningOptions(ws, tick()), TASK, qualityOf(wider));
    assert.equal(after.perDimension.get("grounded"), 0.65, "unchanged identity INHERITS its earned bar");
    assert.equal(after.perDimension.get("covers-question"), 0.65, "and so does the other unchanged one");
    assert.equal(after.perDimension.get("trace"), 0.6, "the new dimension starts at its own floor");
    assert.equal(after.global, 0.6, "the global MEAN bar re-warms: the averaged set changed");
    assert.notEqual(after.composition, before.composition, "the composition key records the change");
    assert.equal(compositionKey(qualityOf(wider)), after.composition, "the bar read and the key agree");
    assert.equal(dimensionKey(GROUNDED), before.keys.get("grounded"), "an unchanged dimension keeps its identity");

    // Five high passes: the warmed dimensions may keep ratcheting, the new one may NOT, and neither
    // may the global bar — both are still under their own WARMUP_MIN observations.
    const five = await passMore(ws, tick, wider, WARMUP_MIN / 2, "warm-a-");
    assert.equal(raisesOf(ws, five, "trace").length, 0, "a new dimension cannot raise before its own warmup");
    assert.equal(raisesOf(ws, five, "global").length, 0, "and neither can the re-warming global bar");
    assert.equal(raisesOf(ws, five, "grounded").length, 1, "while an unchanged, warmed dimension keeps ratcheting");

    // Ten observations of the new composition later, both may act.
    const ten = await passMore(ws, tick, wider, WARMUP_MIN - WARMUP_MIN / 2, "warm-b-");
    assert.equal(raisesOf(ws, ten, "trace").length, 1, "at ten observations the new dimension earns its first raise");
    assert.equal(raisesOf(ws, ten, "global").length, 1, "and the global bar ratchets again under the new composition");
    void earned;
  } finally {
    dispose(ws);
  }
});

test("removing a dimension: its bar goes dormant, the rest inherit, the global re-warms", async () => {
  const ws = workspace();
  try {
    const tick = clock().next;
    publish(ws, 1, [GROUNDED, COVERS]);
    const earned = await earnBars(ws, tick, [GROUNDED, COVERS]);

    publish(ws, 2, [GROUNDED]);
    const after = effectiveBarsFor(learningOptions(ws, tick()), TASK, qualityOf([GROUNDED]));
    assert.equal(after.perDimension.get("grounded"), 0.65, "the remaining dimension inherits its bar");
    assert.equal(after.perDimension.has("covers-question"), false, "the removed dimension has no bar in force");
    assert.equal(after.global, 0.6, "the global MEAN bar re-warms");
    // Dormant, not deleted: the earned history is still in the log, so re-adding it would inherit.
    assert.equal(raisesOf(ws, earned, "covers-question").length, 1, "the removed dimension's raise is still recorded");
  } finally {
    dispose(ws);
  }
});

test("editing a statement: that dimension resets, the untouched one inherits, the global re-warms", async () => {
  const ws = workspace();
  try {
    const tick = clock().next;
    publish(ws, 1, [GROUNDED, COVERS]);
    await earnBars(ws, tick, [GROUNDED, COVERS]);

    const reworded = { ...GROUNDED, statement: "every claim names the exact source line it rests on" };
    publish(ws, 2, [reworded, COVERS]);
    const after = effectiveBarsFor(learningOptions(ws, tick()), TASK, qualityOf([reworded, COVERS]));
    assert.notEqual(dimensionKey(reworded), dimensionKey(GROUNDED), "a reworded dimension is a new identity");
    assert.equal(after.perDimension.get("grounded"), 0.6, "the edited dimension resets to its floor");
    assert.equal(after.perDimension.get("covers-question"), 0.65, "the untouched dimension keeps what it earned");
    assert.equal(after.global, 0.6, "and the global bar re-warms again");
  } finally {
    dispose(ws);
  }
});
