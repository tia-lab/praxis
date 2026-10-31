/**
 * The path grammar, after the move: one rule, three roots. A rule-set reference obeys exactly what a task and
 * a flow reference obey, and no reference can leave its root.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { pathUnder } from "../../src/types/paths.ts";
import { TaskRefSchema } from "../../src/types/schema.ts";

const rules = pathUnder("rules");

test("the shared grammar admits all three roots", () => {
  assert.equal(rules.safeParse("rules/engineering").success, true);
  assert.equal(rules.safeParse("rules/core/verification").success, true, "nesting is the same rule everywhere");
  assert.equal(pathUnder("flows").safeParse("flows/workflow").success, true);
  assert.equal(TaskRefSchema.safeParse("tasks/discovery/research").success, true);
  // The root is part of the identity: a path cannot claim another root.
  assert.equal(rules.safeParse("tasks/engineering").success, false);
  assert.equal(TaskRefSchema.safeParse("rules/engineering").success, false);
});

test("a reference can never leave its root", () => {
  for (const bad of ["rules/", "rules/Engineering", "rules/a.json", "rules/../escape", "rules/a/.b", "engineering"]) {
    assert.equal(rules.safeParse(bad).success, false, "refused: " + JSON.stringify(bad));
  }
  assert.equal(rules.safeParse("rules/a").success, true, "one kebab segment is the minimum");
  assert.equal(rules.safeParse("rules/" + "a".repeat(64)).success, true, "64 characters is the segment bound");
  assert.equal(rules.safeParse("rules/" + "a".repeat(65)).success, false, "65 is over it");
});
