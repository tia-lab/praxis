/**
 * S3 — the Q50 learning flag (quantile-bars A3, spec 3.8).
 *
 * A dimension that PASSED but sits below its own Q50 of the carried population is flagged: that is
 * where the next lesson comes from. The flag is derived on demand, never stored, and it changes no
 * decision - the gate sees exactly the same scores with and without it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { withStore } from "../../src/runner/engine/support.ts";
import { advanceEvaluated, perDimensionDecision, quantileBars } from "../../src/quality/index.ts";
import { quantileOf } from "../../src/quality/bar.ts";
import { start } from "../../src/runner/engine/index.ts";
import type { Quality } from "../../src/types/quality.ts";
import {
  clock,
  dispose,
  eventsOf,
  flowRef,
  learningOptions,
  population,
  sequenceScorer,
  workspace,
  writeFlow,
  type Workspace,
} from "../testkit.ts";

const TASK = "tasks/make";
const GOAL = "do make the artifact";
const SCHEMA = "praxis.artifact.make/v1";
const QUALITY: Quality = {
  dimensions: [{ id: "solves", statement: "it solves the stated goal" }],
  threshold: 0.6,
  policy: "required",
} as Quality;

/** A judged submit over a store already holding `history` carried observations. */
async function judged(ws: Workspace, history: readonly number[], score: number) {
  const tick = clock().next;
  const options = learningOptions(ws, tick());
  if (history.length > 0) withStore(options, (store) => population(store, TASK, "solves", history, tick()));
  const run = start({ ...options, flow: flowRef("learn"), requestId: "q50-" + history.length + "-" + score, actor: "a" });
  await advanceEvaluated({
    ...options,
    instance: run.instance.id,
    actor: "a",
    artifact: { schema: SCHEMA, nonce: run.instance.nonce, attempt: 1 },
    scorer: sequenceScorer([score]),
  });
  const verdict = eventsOf(ws, run.instance.id).find((event) => event.type === "quality.verdict")?.payload as
    | { decision: string; flagged?: string[]; dimensions: { id: string; score: number }[] }
    | undefined;
  const q50 = withStore(options, (store) => {
    const values = history.slice().sort((left, right) => left - right);
    void store;
    return quantileOf(values, 50);
  });
  const decision = withStore(options, (store) => perDimensionDecision(verdict?.dimensions ?? [], quantileBars(store, TASK, QUALITY)));
  return { verdict, q50, decision };
}

function project(): Workspace {
  const ws = workspace();
  writeFlow(ws, "learn", [
    { id: "make", capabilities: ["artifact.write", "emit", "evaluate"], schema: SCHEMA, goal: GOAL, quality: QUALITY as unknown },
  ]);
  return ws;
}

test("a passing dimension below its own Q50 is flagged", async () => {
  const ws = project();
  try {
    // The population's median is 0.95; a 0.72 pass clears the floor but sits under it.
    const { verdict, q50 } = await judged(ws, [0.95, 0.95, 0.95, 0.95], 0.72);
    assert.equal(q50, 0.95, "the median of the carried population");
    assert.equal(verdict?.decision, "pass", "the dimension passed");
    assert.deepEqual(verdict?.flagged, ["solves"], "and it is flagged as below its Q50");
  } finally {
    dispose(ws);
  }
});

test("a pass at or above its Q50 is not flagged, and no population never flags", async () => {
  const ws = project();
  try {
    const above = await judged(ws, [0.6, 0.6, 0.6, 0.6], 0.9);
    assert.equal(above.verdict?.decision, "pass");
    assert.equal(above.verdict?.flagged, undefined, "above the median: no lesson owed");
  } finally {
    dispose(ws);
  }
  const cold = project();
  try {
    const first = await judged(cold, [], 0.72);
    assert.equal(first.verdict?.decision, "pass");
    assert.equal(first.verdict?.flagged, undefined, "no population, no Q50, no flag");
  } finally {
    dispose(cold);
  }
});

test("the flag changes no decision", async () => {
  const flaggedRun = project();
  const plainRun = project();
  try {
    // Same score, same measured bar (none raised: four observations cannot raise), different Q50.
    const flagged = await judged(flaggedRun, [0.95, 0.95, 0.95, 0.95], 0.72);
    const plain = await judged(plainRun, [], 0.72);
    assert.deepEqual(flagged.verdict?.flagged, ["solves"]);
    assert.equal(plain.verdict?.flagged, undefined);
    assert.equal(flagged.verdict?.decision, plain.verdict?.decision, "identical decision");
    assert.equal(flagged.decision.pass, plain.decision.pass, "and the gate agrees with the record");
    assert.deepEqual(flagged.decision.refused, plain.decision.refused);
  } finally {
    dispose(flaggedRun);
    dispose(plainRun);
  }
});
