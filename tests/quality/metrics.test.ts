/**
 * The metrics read-model (metrics unit): hand-computed numbers over a fixture store, the provisional
 * flag below 20 observations, and the boundaries that make it a READ model - no DDL, no storage, no
 * import from the decision path, and no per-agent attribution.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { appendEvent } from "../../src/store/events.ts";
import { insertInstance } from "../../src/store/instance.ts";
import { withStore } from "../../src/runner/engine/support.ts";
import { PROVISIONAL_MIN, formatMetrics, readMetrics } from "../../src/quality/metrics.ts";
import { learningOptions, workspace, type Workspace } from "../testkit.ts";

const TASK = "tasks/make";
const AT = "2026-10-31T10:00:00.000Z";

type Store = Parameters<Parameters<typeof withStore>[1]>[0];
const storeOf = <T>(ws: Workspace, body: (store: Store) => T): T => withStore(learningOptions(ws, AT), body);

const ids = (index: number): string => "i" + String(index).padStart(32, "0");

function instance(store: Store, index: number): string {
  const id = ids(index);
  try {
    insertInstance(store, { id, flow: "flows/make", actor: "a", status: "running", currentStep: "draft", nonce: String(index).padStart(32, "0"), now: AT });
  } catch {
    // already seeded
  }
  return id;
}

function verdict(store: Store, id: string, at: string, version: number, decision: "pass" | "below", scores: Record<string, number>, flagged: string[] = []): void {
  appendEvent(store, id, {
    type: "quality.verdict",
    payload: {
      step: "draft",
      version,
      artifactDigest: "sha256:" + String(version).padStart(64, "a"),
      task: TASK,
      taskVersion: 1,
      decision,
      score: Math.min(...Object.values(scores)),
      dimensions: Object.entries(scores).map(([dim, score]) => ({ id: dim, score })),
      ...(flagged.length === 0 ? {} : { flagged }),
      rationale: "fixture",
      rubricDigest: "sha256:" + "b".repeat(64),
      scorer: "fixture/v1",
      source: "jev",
    },
    at,
  });
}

function accepted(store: Store, id: string, at: string, version: number): void {
  appendEvent(store, id, {
    type: "artifact.accepted",
    payload: { step: "draft", version, path: "x", digest: "sha256:" + String(version).padStart(64, "a"), schema: "praxis.artifact.make/v1", task: TASK, taskVersion: 1 },
    at,
  });
}

/** The fixture the numbers below are computed against by hand. */
function fixture(ws: Workspace): void {
  storeOf(ws, (store) => {
    const first = instance(store, 1);
    verdict(store, first, "2026-10-30T09:00:00.000Z", 1, "pass", { alpha: 0.9, beta: 0.8 });
    accepted(store, first, "2026-10-30T09:00:00.000Z", 1);

    const second = instance(store, 2);
    verdict(store, second, "2026-10-30T10:00:00.000Z", 1, "below", { alpha: 0.4, beta: 0.7 }, ["beta"]);
    verdict(store, second, "2026-10-30T10:05:00.000Z", 2, "pass", { alpha: 0.8, beta: 0.8 });
    accepted(store, second, "2026-10-30T10:05:00.000Z", 2);

    const third = instance(store, 3);
    verdict(store, third, "2026-10-31T11:00:00.000Z", 1, "below", { alpha: 0.3, beta: 0.9 });

    // alpha's bar was measured to 0.7; beta has no raise (the floor) and one contest.
    appendEvent(store, first, {
      type: "bar.raised",
      payload: { task: TASK, taskVersion: 1, scope: "alpha", from: 0.5, to: 0.7, percentile: 25, n: 28, formulaId: "praxis.bar.quantile/v1", at: "2026-10-30T09:30:00.000Z" },
      at: "2026-10-30T09:30:00.000Z",
    });
    appendEvent(store, third, {
      type: "bar.contested",
      payload: { task: TASK, taskVersion: 1, scope: "beta", bar: 0.5, attempts: 40, reason: "a full window yielded no pass" },
      at: "2026-10-31T11:00:00.000Z",
    });
  });
}

test("the fixture's numbers are the hand-computed ones", () => {
  const ws = workspace();
  try {
    fixture(ws);
    const model = storeOf(ws, (store) => readMetrics(store, { task: TASK }));

    // Four verdicts carry both dimensions; two of them are refusals.
    const alpha = model.dimensions.find((row) => row.dimension === "alpha")!;
    assert.deepEqual(
      { n: alpha.n, mean: alpha.mean, median: alpha.median, belowFloor: alpha.belowFloor, bar: alpha.bar, headroom: alpha.headroom },
      { n: 4, mean: 0.6, median: 0.6, belowFloor: 0.5, bar: 0.7, headroom: -0.1 },
      "alpha: [0.9, 0.4, 0.8, 0.3] against a measured bar of 0.7",
    );
    assert.equal(alpha.bottleneckShare, 1, "alpha had the lowest score in BOTH refusals");
    assert.equal(alpha.q50Rate, 0, "alpha was never flagged");
    assert.equal(alpha.contested, 0);

    const beta = model.dimensions.find((row) => row.dimension === "beta")!;
    assert.deepEqual(
      { n: beta.n, mean: beta.mean, median: beta.median, belowFloor: beta.belowFloor, bar: beta.bar, headroom: beta.headroom },
      { n: 4, mean: 0.8, median: 0.8, belowFloor: 0, bar: 0.5, headroom: 0.3 },
      "beta: [0.8, 0.7, 0.8, 0.9] with no raise, so the floor",
    );
    assert.equal(beta.q50Rate, 0.25, "beta was flagged in 1 of its 4 verdicts");
    assert.equal(beta.contested, 1);

    const task = model.tasks[0]!;
    assert.deepEqual(
      { verdicts: task.verdicts, instances: task.instances, eventual: task.eventualPassRate, first: task.firstAttemptPassRate, q50: task.q50Rate },
      { verdicts: 4, instances: 3, eventual: 0.6667, first: 0.3333, q50: 0.25 },
      "2 of 3 instances eventually passed; 1 passed first time; 1 of 4 verdicts flagged something",
    );
    assert.equal(task.bottleneckDimension, "alpha");

    // The workflow shape the instance events support.
    assert.deepEqual(
      { instances: model.flow.instances, accepted: model.flow.acceptedSteps, attempts: model.flow.attemptsToAccept, escalations: model.flow.escalations, stalls: model.flow.stalls },
      { instances: 3, accepted: 2, attempts: 1.5, escalations: 0, stalls: 0 },
      "two accepted steps over 3 verdicts = 1.5 attempts per acceptance",
    );

    // The daily series carries the bar in force at the END of that day.
    const alphaFirstDay = model.timeseries.find((point) => point.dimension === "alpha" && point.day === "2026-10-30")!;
    assert.equal(alphaFirstDay.bar, 0.7, "the raise landed that morning");
    assert.equal(alphaFirstDay.mean, 0.7, "(0.9 + 0.4 + 0.8) / 3");
    assert.equal(alphaFirstDay.monotone, true);
    assert.equal(model.timeseries.every((point) => point.monotone), true, "no bar fell");

    // Every row carries its own n and is provisional below the calibration floor.
    assert.equal(PROVISIONAL_MIN, 20);
    assert.equal(model.dimensions.every((row) => row.provisional && row.n < PROVISIONAL_MIN), true);
    assert.equal(model.tasks.every((row) => row.provisional), true);
    assert.match(formatMetrics(model), /provisional/, "the print surface says so");
  } finally {
    ws; // the workspace is a temp dir; nothing to dispose beyond it
  }
});

test("a row with 20 or more observations is not provisional", () => {
  const ws = workspace();
  try {
    storeOf(ws, (store) => {
      const id = instance(store, 9);
      for (let index = 0; index < PROVISIONAL_MIN; index += 1) {
        verdict(store, id, "2026-10-30T09:00:00.000Z", index + 1, "pass", { alpha: 0.9, beta: 0.9 });
      }
    });
    const model = storeOf(ws, (store) => readMetrics(store, { task: TASK }));
    const alpha = model.dimensions.find((row) => row.dimension === "alpha")!;
    assert.equal(alpha.n, PROVISIONAL_MIN);
    assert.equal(alpha.provisional, false, "at the calibration floor the row is no longer provisional");
    assert.equal(model.tasks[0]!.provisional, false);
  } finally {
    ws;
  }
});

test("the read model is read-only and outside the decision path", () => {
  const root = new URL("../../", import.meta.url).pathname;
  const source = readFileSync(root + "src/quality/metrics.ts", "utf8");
  // No DDL, no writes: the projection can only read.
  for (const forbidden of ["CREATE TABLE", "CREATE VIEW", "ALTER TABLE", "INSERT INTO", "UPDATE ", "DELETE FROM", "DROP "]) {
    assert.equal(source.includes(forbidden), false, "metrics.ts must not contain " + forbidden);
  }
  // No per-agent attribution: the instance is the unit, and store gate #3 is deferred.
  assert.equal(source.includes(".actor"), false, "metrics.ts must not read an actor field");
  assert.equal(source.includes("actor:"), false, "and must not project one either");
  // Nothing in the decision path imports the read model.
  for (const file of ["src/quality/evaluate.ts", "src/runner/step.ts", "src/runner/engine/advance.ts", "src/runner/engine/quality-loop.ts"]) {
    const text = readFileSync(root + file, "utf8");
    assert.equal(text.includes("metrics"), false, file + " must not import the metrics read model");
  }
});
