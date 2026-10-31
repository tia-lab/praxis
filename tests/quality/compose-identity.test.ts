/**
 * Identity (R12, re-pinned for the quantile bars): a composed dimension is identified by its
 * CRITERIA, so editing one criterion re-keys exactly that dimension - it starts again at the floor -
 * while an unchanged dimension (and one whose STATEMENT alone was reworded) keeps its bar.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { withStore } from "../../src/runner/engine/support.ts";
import { ABSOLUTE_MIN, dimensionKey, quantileBars } from "../../src/quality/index.ts";
import type { Quality } from "../../src/types/quality.ts";
import { dispose, learningOptions, raiseBar, workspace } from "../testkit.ts";

const TASK = "tasks/make";
const AT = "2026-10-31T00:00:00.000Z";
const COMPOSED = {
  id: "solves",
  statement: "it solves the stated goal",
  probes: [{ id: "c1", type: "noul" as const, instructions: "does it solve the goal?" }],
};
const PLAIN = { id: "evidence", statement: "every claim carries evidence" };
const QUALITY = (dimensions: unknown[]): Quality => ({ dimensions, threshold: 0.6, policy: "required" } as unknown as Quality);

test("R12: editing a criterion resets only that dimension, and a reword resets nothing", () => {
  // Identity first, with no store: the key is the criteria, not the prose around them.
  const base = dimensionKey(COMPOSED);
  assert.equal(dimensionKey({ ...COMPOSED, statement: "a completely reworded statement" }), base, "the statement is not part of a composed identity");
  assert.notEqual(dimensionKey({ ...COMPOSED, probes: [{ ...COMPOSED.probes[0]!, instructions: "does it solve the goal, exactly?" }] }), base, "a criterion edit is a new identity");
  assert.notEqual(dimensionKey({ ...PLAIN, statement: "reworded" }), dimensionKey(PLAIN), "a statement-only dimension is identified by its statement");

  const ws = workspace();
  try {
    const options = learningOptions(ws, AT);
    withStore(options, (store) => {
      raiseBar(store, TASK, "solves", 0.8, dimensionKey(COMPOSED));
      raiseBar(store, TASK, "evidence", 0.7, dimensionKey(PLAIN));
    });
    const barsOf = (dimensions: unknown[]) => withStore(options, (store) => quantileBars(store, TASK, QUALITY(dimensions)));
    const raised = barsOf([COMPOSED, PLAIN]);
    assert.equal(raised.perDimension.get("solves"), 0.8);
    assert.equal(raised.perDimension.get("evidence"), 0.7);

    // Rewording the statement alone: BOTH bars stay where they were measured.
    const reworded = barsOf([{ ...COMPOSED, statement: "reworded prose" }, PLAIN]);
    assert.equal(reworded.perDimension.get("solves"), 0.8, "a composed dimension ignores statement prose");
    assert.equal(reworded.perDimension.get("evidence"), 0.7);

    // Editing one criterion: only THAT dimension goes back to the floor.
    const edited = barsOf([
      { ...COMPOSED, probes: [{ ...COMPOSED.probes[0]!, instructions: "does it solve the goal, exactly?" }] },
      PLAIN,
    ]);
    assert.equal(edited.perDimension.get("solves"), ABSOLUTE_MIN, "the edited identity re-warms from the floor");
    assert.equal(edited.perDimension.get("evidence"), 0.7, "the untouched dimension keeps its bar");
    assert.notEqual(edited.keys.get("solves"), raised.keys.get("solves"));
  } finally {
    dispose(ws);
  }
});
