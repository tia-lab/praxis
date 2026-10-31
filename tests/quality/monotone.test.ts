/**
 * S7 monotonicity (spec 3.7): the record refuses a decrease, and the fold takes the maximum - so no
 * sequence, not even a legacy one written by other code, can lower a bar.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { BarRaisedSchema } from "../../src/types/learning.ts";
import { ABSOLUTE_MIN, flooredBar } from "../../src/quality/index.ts";

const raise = (from: number, to: number) => ({
  task: "tasks/make",
  taskVersion: 1,
  scope: "solves",
  from,
  to,
  formulaId: "praxis.bar.quantile/v1",
  at: "2026-10-31T00:00:00.000Z",
});

test("a raise with to < from fails to parse", () => {
  const parsed = BarRaisedSchema.safeParse(raise(0.8, 0.7));
  assert.equal(parsed.success, false, "monotonicity is a decision, so the record refuses a decrease");
  assert.match(JSON.stringify(parsed.error.issues), /lower the bar/);
  assert.equal(BarRaisedSchema.safeParse(raise(0.7, 0.7)).success, true, "equal is allowed (a re-recorded level)");
  assert.equal(BarRaisedSchema.safeParse(raise(0.7, 0.8)).success, true);
});

test("the fold takes the maximum of the recorded raises", () => {
  const raises = [
    { from: 0.5, to: 0.7, at: "2026-10-01T00:00:00.000Z" },
    { from: 0.7, to: 0.6, at: "2026-10-02T00:00:00.000Z" },
  ];
  assert.equal(flooredBar(raises, ABSOLUTE_MIN), 0.7, "a legacy decreasing sequence cannot lower the bar");
  assert.equal(flooredBar([], 0.42), ABSOLUTE_MIN, "and nothing falls below the floor");
  assert.equal(flooredBar([{ to: 0.86, at: "2026-10-03T00:00:00.000Z" }], ABSOLUTE_MIN), 0.86);
});
