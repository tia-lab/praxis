/**
 * Slice 1, identity (R12): a composed dimension is identified by its CRITERIA. Editing one criterion
 * resets that dimension's bar to its seed; rewording the statement alone changes nothing, because the
 * statement no longer decides. A dimension without criteria keeps the statement identity.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { WARMUP_MIN, dimensionKey, effectiveBarsFor } from "../../src/quality/index.ts";
import type { Quality } from "../../src/types/quality.ts";
import { clock, dimensionScorer, dispose, judgedFlow, learningOptions, startJudged, submitJudged, workspace, type Workspace } from "../testkit.ts";

const TASK = "tasks/make";
const COMPOSED = {
  id: "solves",
  statement: "it solves the stated goal",
  floor: 0.6,
  probes: [{ id: "c1", type: "noul" as const, instructions: "does it solve the goal?" }],
};
const PLAIN = { id: "evidence", statement: "every claim carries evidence", floor: 0.6 };
const QUALITY = (dimensions: unknown[]): Quality => ({ threshold: 0.6, policy: "required", dimensions } as unknown as Quality);

/** Ten genuine passes raise every scope once at seed 0.6 (WARMUP_MIN observations). */
async function warmed(ws: Workspace): Promise<void> {
  const tick = clock().next;
  for (let index = 1; index <= WARMUP_MIN; index += 1) {
    const run = startJudged(ws, "warm-" + index, tick());
    await submitJudged(ws, run, tick(), 1, dimensionScorer([{ solves: 0.95, evidence: 0.95 }]));
  }
}

test("R12: editing a criterion resets only that dimension, and a reword resets nothing", async () => {
  // Identity first, with no store: the key is the criteria, not the prose around them.
  const base = dimensionKey(COMPOSED);
  assert.equal(dimensionKey({ ...COMPOSED, statement: "a completely reworded statement" }), base, "the statement is not part of a composed identity");
  assert.notEqual(dimensionKey({ ...COMPOSED, probes: [{ ...COMPOSED.probes[0]!, instructions: "does it solve the goal, exactly?" }] }), base, "a criterion edit is a new identity");
  assert.notEqual(dimensionKey({ ...PLAIN, statement: "reworded" }), dimensionKey(PLAIN), "a statement-only dimension is identified by its statement");

  const ws = workspace();
  try {
    judgedFlow(ws, { dimensions: [COMPOSED, PLAIN] });
    await warmed(ws);
    const options = learningOptions(ws, "2026-10-29T23:00:00.000Z");
    const raised = effectiveBarsFor(options, TASK, QUALITY([COMPOSED, PLAIN]));
    assert.ok((raised.perDimension.get("solves") ?? 0) > 0.6, "the composed dimension ratcheted");
    assert.ok((raised.perDimension.get("evidence") ?? 0) > 0.6, "the statement dimension ratcheted");

    // Rewording the statement alone: BOTH bars stay where they earned them.
    const reworded = effectiveBarsFor(options, TASK, QUALITY([{ ...COMPOSED, statement: "reworded prose" }, PLAIN]));
    assert.equal(reworded.perDimension.get("solves"), raised.perDimension.get("solves"));
    assert.equal(reworded.perDimension.get("evidence"), raised.perDimension.get("evidence"));

    // Editing one criterion: only THAT dimension goes back to its seed.
    const edited = effectiveBarsFor(options, TASK, QUALITY([
      { ...COMPOSED, probes: [{ ...COMPOSED.probes[0]!, instructions: "does it solve the goal, exactly?" }] },
      PLAIN,
    ]));
    assert.equal(edited.perDimension.get("solves"), 0.6, "the edited dimension re-warms from its seed");
    assert.equal(edited.perDimension.get("evidence"), raised.perDimension.get("evidence"), "the untouched dimension keeps its bar");
  } finally {
    dispose(ws);
  }
});
