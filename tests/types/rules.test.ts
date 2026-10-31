/**
 * The rule-set atom (spec 3-4): a file-owned set of named one-line rules, and the two reference shapes a task
 * and a probe use to point at one. Parse-time rules only - the loader's `id === last segment` check belongs to
 * the resolve slice, because it needs the path the schema does not carry.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { QualitySchema } from "../../src/types/quality.ts";
import {
  RULE_REFS_PER_TASK_MAX,
  RULES_PER_SET_MAX,
  RULE_STATEMENT_MAX,
  RuleRefSchema,
  RuleSetSchema,
  TaskRulesSchema,
} from "../../src/types/rules.ts";
import { TaskConfigSchema } from "../../src/types/schema.ts";

const rule = (id: string, statement = "one line of guidance") => ({ id, statement });
const setOf = (rules: unknown[], id = "engineering") => ({ id, version: 1, rules });

const TASK = {
  id: "draft",
  version: 1,
  state: "published",
  goal: "draft the finding",
  capabilities: ["artifact.write", "emit", "evaluate"],
  produces: { schema: "praxis.artifact.architecture/v1" },
  gate: "section-requirements",
  quality: { threshold: 0.6, policy: "required", dimensions: [{ id: "solves", statement: "it solves the goal" }] },
};

test("a valid rule-set parses, and its shape is closed", () => {
  assert.equal(RuleSetSchema.safeParse(setOf([rule("smallest-sufficient"), rule("cite-the-seam")])).success, true);
  // Deliberately absent: severity, tags, selectors, enabled flags. An undeclared key is refused.
  assert.equal(RuleSetSchema.safeParse({ ...setOf([rule("a")]), severity: "high" }).success, false);
  assert.equal(RuleSetSchema.safeParse(setOf([{ ...rule("a"), tags: ["x"] }])).success, false);
});

test("the set's bounds and uniqueness are enforced at parse", () => {
  assert.equal(RuleSetSchema.safeParse(setOf([])).success, false, "an empty set is refused");
  const atMax = Array.from({ length: RULES_PER_SET_MAX }, (_, index) => rule("r" + index));
  assert.equal(RuleSetSchema.safeParse(setOf(atMax)).success, true, RULES_PER_SET_MAX + " rules is the bound");
  assert.equal(RuleSetSchema.safeParse(setOf([...atMax, rule("one-more")])).success, false, "one more is refused");
  assert.equal(RuleSetSchema.safeParse(setOf([rule("same"), rule("same")])).success, false, "a duplicate id is refused");
  assert.equal(RuleSetSchema.safeParse(setOf([rule("a", "x".repeat(RULE_STATEMENT_MAX))])).success, true);
  assert.equal(RuleSetSchema.safeParse(setOf([rule("a", "x".repeat(RULE_STATEMENT_MAX + 1))])).success, false, "a statement over the bound is refused");
  assert.equal(RuleSetSchema.safeParse(setOf([rule("Not-Kebab")])).success, false, "a non-kebab id is refused");
});

test("a task references sets by file, optionally narrowed to ids", () => {
  assert.equal(TaskRulesSchema.safeParse([{ set: "rules/engineering" }]).success, true, "a file ref takes every rule");
  assert.equal(TaskRulesSchema.safeParse([{ set: "rules/engineering", rules: ["smallest-sufficient"] }]).success, true);
  assert.equal(TaskRulesSchema.safeParse([{ set: "rules/engineering" }, { set: "rules/core/verification" }]).success, true);
  assert.equal(
    TaskRulesSchema.safeParse([{ set: "rules/engineering" }, { set: "rules/engineering", rules: ["a"] }]).success,
    false,
    "the same set twice would make the order ambiguous",
  );
  assert.equal(TaskRulesSchema.safeParse([]).success, false, "an empty list is not a declaration");
  const tooMany = Array.from({ length: RULE_REFS_PER_TASK_MAX + 1 }, (_, index) => ({ set: "rules/set-" + index }));
  assert.equal(TaskRulesSchema.safeParse(tooMany).success, false, "one ref over the bound is refused");
  assert.equal(RuleRefSchema.safeParse({ set: "tasks/engineering" }).success, false, "a ref names a rules path, not any path");
  assert.equal(RuleRefSchema.safeParse({ set: "rules/engineering", rules: [] }).success, false, "an empty id list is refused");
});

test("a task carries rules, and a task without them is unchanged", () => {
  assert.equal(TaskConfigSchema.safeParse(TASK).success, true, "no rules: exactly the document that shipped");
  assert.deepEqual(TaskConfigSchema.parse(TASK), TASK, "and parsing adds no field");
  const withRules = { ...TASK, rules: [{ set: "rules/engineering" }] };
  assert.equal(TaskConfigSchema.safeParse(withRules).success, true);
  assert.deepEqual(TaskConfigSchema.parse(withRules).rules, [{ set: "rules/engineering" }]);
});

test("a criterion may cite a rule; the citation is a reference, never text", () => {
  const rubric = (probe: Record<string, unknown>) => ({ threshold: 0.6, policy: "required", dimensions: [{ id: "d", statement: "s", probes: [probe] }] });
  const noul = { id: "p", type: "noul", instructions: "does it hold?" };
  assert.equal(QualitySchema.safeParse(rubric(noul)).success, true, "a criterion with no citation parses as before");
  assert.equal(QualitySchema.safeParse(rubric({ ...noul, rule: { set: "rules/engineering", id: "cite-the-seam" } })).success, true);
  assert.equal(QualitySchema.safeParse(rubric({ ...noul, rule: { set: "tasks/engineering", id: "x" } })).success, false, "a citation names a rules path");
  assert.equal(QualitySchema.safeParse(rubric({ ...noul, rule: { set: "rules/engineering" } })).success, false, "and it needs an id");
  assert.equal(QualitySchema.safeParse(rubric({ ...noul, rule: { set: "rules/engineering", id: "x", text: "inline" } })).success, false, "the citation carries no text");
});
