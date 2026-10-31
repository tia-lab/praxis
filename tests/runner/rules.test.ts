/**
 * The rules atom, S2: resolution, composition, pinning, and the identity split (R9').
 *
 * R9' is the owner's reversal: editing a CITED rule's statement (or bumping the set's version) changes what the
 * judge is asked and MUST NOT change a dimensionKey or a bar. This file proves that by computing both
 * accessors over the same task before and after an edit; it is the one place the distinction is visible.
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { isAppError } from "../../src/types/errors.ts";
import { COMPOSED_INSTRUCTION_MAX } from "../../src/types/rules.ts";
import type { Quality } from "../../src/types/quality.ts";
import { loadPinnedFlow, openFlow, start } from "../../src/runner/engine/index.ts";
import { authoredQuality, judgeQuality, loadRuleSet, resolveRules, withRuleText } from "../../src/runner/engine/rules.ts";
import { withStore } from "../../src/runner/engine/support.ts";
import { digest } from "../../src/runner/canonical.ts";
import { dimensionKey, quantileBars } from "../../src/quality/index.ts";
import { readDefinition } from "../../src/store/definitions.ts";
import { dispose, flowRef, learningOptions, raiseBar, workspace, writeFlow, type Workspace } from "../testkit.ts";

const TASK = "tasks/make";
const AT = "2026-10-31T12:00:00.000Z";
const SCHEMA = "praxis.artifact.make/v1";

const SET = {
  id: "engineering",
  version: 1,
  rules: [
    { id: "one", statement: "the first rule" },
    { id: "two", statement: "the second rule" },
    { id: "three", statement: "the third rule" },
  ],
};

const qualityOf = (cited: string): Quality =>
  ({
    dimensions: [
      {
        id: "solves",
        statement: "it solves the goal",
        probes: [{ id: "p1", type: "noul", instructions: "does it solve the goal?", rule: { set: "rules/engineering", id: cited } }],
      },
    ],
    threshold: 0.6,
    policy: "required",
  }) as Quality;

/** A workspace with one rule-set file and a task that references it. */
function project(ws: Workspace, cited = "two", rules: unknown = [{ set: "rules/engineering" }]): string {
  const dir = join(ws.root, ".pi", "praxis", "rules");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "engineering.json");
  writeFileSync(file, JSON.stringify(SET, null, 2) + "\n");
  writeFlow(ws, "learn", [
    {
      id: "make",
      capabilities: ["artifact.write", "emit", "evaluate"],
      schema: SCHEMA,
      goal: "make the artifact",
      ...(rules === null ? {} : { rules }),
      quality: qualityOf(cited),
    },
  ]);
  return file;
}

const optionsOf = (ws: Workspace) => ({ ...learningOptions(ws, AT), rulesDir: join(ws.root, ".pi", "praxis", "rules") });

test("a set is read from disk; a missing file, a bad document and a wrong id refuse by name", () => {
  const ws = workspace();
  try {
    project(ws);
    const rulesDir = join(ws.root, ".pi", "praxis", "rules");
    const set = loadRuleSet(rulesDir, "rules/engineering");
    assert.equal(set.doc.rules.length, 3);
    assert.equal(set.digest, digest(readFileSync(join(rulesDir, "engineering.json"))), "the digest is the file's bytes");
    assert.throws(
      () => loadRuleSet(rulesDir, "rules/absent"),
      (error: unknown) => isAppError(error) && error.code === "RULE_NOT_FOUND" && (error.detail as { reason?: string }).reason === "set-missing",
    );
    writeFileSync(join(rulesDir, "wrong.json"), JSON.stringify({ ...SET, id: "other" }));
    assert.throws(() => loadRuleSet(rulesDir, "rules/wrong"), (error: unknown) => isAppError(error) && error.code === "CONFIG_INVALID", "the id must be the last segment");
    writeFileSync(join(rulesDir, "broken.json"), "{not json");
    assert.throws(() => loadRuleSet(rulesDir, "rules/broken"), (error: unknown) => isAppError(error) && error.code === "CONFIG_INVALID");
  } finally {
    dispose(ws);
  }
});

test("refs expand in declared order, the set's order inside each ref", () => {
  const ws = workspace();
  try {
    project(ws);
    const flow = openFlow(optionsOf(ws));
    const task = flow.tasks.get(TASK)!;
    assert.deepEqual(resolveRules(task, flow.rules).map((rule) => rule.id), ["one", "two", "three"], "a file ref takes every rule, in document order");
    // An id-narrowed ref is still checked against the task's citations, so this case uses an UNCITED rubric.
    const uncited = { ...task, quality: { ...task.quality!, dimensions: [{ id: "solves", statement: "it solves the goal", probes: [{ id: "p1", type: "noul" as const, instructions: "does it solve the goal?" }] }] } };
    const narrowed = resolveRules({ ...uncited, rules: [{ set: "rules/engineering", rules: ["three", "one"] }] }, flow.rules);
    assert.deepEqual(narrowed.map((rule) => rule.id), ["one", "three"], "ids select; the SET's order decides, not the list's");
    assert.throws(
      () => resolveRules({ ...task, rules: [{ set: "rules/engineering", rules: ["absent"] }] }, flow.rules),
      (error: unknown) => isAppError(error) && error.code === "RULE_NOT_FOUND" && (error.detail as { reason?: string }).reason === "rule-missing",
    );
    assert.throws(
      () => resolveRules({ ...task, rules: undefined }, flow.rules),
      (error: unknown) => isAppError(error) && error.code === "RULE_NOT_FOUND" && (error.detail as { reason?: string }).reason === "citation-not-referenced",
      "a probe cannot cite a rule its task does not reference",
    );
  } finally {
    dispose(ws);
  }
});

test("composition is instructions + a newline + the rule, and no rules means the SAME object", () => {
  const quality = qualityOf("two");
  const rules = [{ set: "rules/engineering", version: 1, setDigest: "sha256:" + "a".repeat(64), id: "two", statement: "the second rule" }];
  const composed = withRuleText(quality, rules)!;
  assert.equal(composed.dimensions[0]!.probes![0]!.instructions, "does it solve the goal?\nRule two: the second rule");
  assert.equal(withRuleText(quality, []), quality, "no rules: identity, not a copy");
  assert.equal(withRuleText(undefined, []), undefined);
  assert.throws(
    () => withRuleText(quality, [{ ...rules[0]!, statement: "x".repeat(COMPOSED_INSTRUCTION_MAX) }]),
    (error: unknown) => isAppError(error) && error.code === "CONFIG_INVALID",
    "an over-long question refuses rather than clipping a rule",
  );
});

test("R9': a statement edit and a version bump leave every dimensionKey and every bar unchanged", () => {
  const ws = workspace();
  try {
    const file = project(ws);
    const options = optionsOf(ws);
    // A measured bar first, so "unchanged" is not a comparison of two floors.
    withStore(options, (store) => raiseBar(store, TASK, "solves", 0.7, dimensionKey(qualityOf("two").dimensions[0]!)));

    const before = openFlow(options);
    const task = before.tasks.get(TASK)!;
    const authoredBefore = authoredQuality(before, task)!;
    const judgedBefore = judgeQuality(before, task)!;
    const keysBefore = authoredBefore.dimensions.map((dimension) => dimensionKey(dimension));
    const barsBefore = withStore(options, (store) => quantileBars(store, TASK, authoredBefore).perDimension.get("solves"));
    assert.equal(barsBefore, 0.7, "the seeded bar is in force");
    assert.match(judgedBefore.dimensions[0]!.probes![0]!.instructions, /Rule two: the second rule/);

    // The owner's case: the CITED rule's statement changes and the set's version is bumped.
    const edited = { ...SET, version: 2, rules: SET.rules.map((rule) => (rule.id === "two" ? { id: "two", statement: "a completely rewritten second rule" } : rule)) };
    writeFileSync(file, JSON.stringify(edited, null, 2) + "\n");

    const after = openFlow(options);
    const taskAfter = after.tasks.get(TASK)!;
    const authoredAfter = authoredQuality(after, taskAfter)!;
    const judgedAfter = judgeQuality(after, taskAfter)!;
    assert.deepEqual(authoredAfter.dimensions.map((dimension) => dimensionKey(dimension)), keysBefore, "every dimensionKey is UNCHANGED");
    assert.equal(
      withStore(options, (store) => quantileBars(store, TASK, authoredAfter).perDimension.get("solves")),
      barsBefore,
      "and the bar does not re-warm",
    );
    assert.match(
      judgedAfter.dimensions[0]!.probes![0]!.instructions,
      /Rule two: a completely rewritten second rule/,
      "while the judge's composed question reflects the new statement",
    );

    // The other half of R9': changing WHICH rule a probe cites IS an identity change.
    writeFlow(ws, "learn", [
      {
        id: "make",
        capabilities: ["artifact.write", "emit", "evaluate"],
        schema: SCHEMA,
        goal: "make the artifact",
        rules: [{ set: "rules/engineering" }],
        quality: qualityOf("three"),
      },
    ]);
    const recut = openFlow(options).tasks.get(TASK)!;
    assert.notDeepEqual(authoredQuality(openFlow(options), recut)!.dimensions.map((dimension) => dimensionKey(dimension)), keysBefore, "citing a different rule re-keys the dimension");
  } finally {
    dispose(ws);
  }
});

test("start pins the raw rule-file bytes once per set, and a rules-free task pins none", () => {
  const ws = workspace();
  try {
    const file = project(ws);
    const options = optionsOf(ws);
    const started = start({ ...options, flow: flowRef("learn"), requestId: "pin", actor: "a" });
    const bytes = readFileSync(file);
    const row = withStore(options, (store) => readDefinition(store, started.instance.id, "ruleset", "rules/engineering"));
    assert.equal(row.digest, digest(bytes), "the pin names the file's own bytes");
    assert.equal(Buffer.compare(Buffer.from(row.bytes), bytes), 0, "and carries them exactly");

    // A finished run keeps the version it pinned even after the file moves on.
    writeFileSync(file, JSON.stringify({ ...SET, version: 9 }, null, 2) + "\n");
    const pinned = withStore(options, (store) => loadPinnedFlow(store, started.instance));
    assert.equal(resolveRules(pinned.tasks.get(TASK)!, pinned.rules)[0]!.version, 1, "the instance keeps its pinned version");
    assert.equal(resolveRules(openFlow(options).tasks.get(TASK)!, openFlow(options).rules)[0]!.version, 9, "the library has moved on");

    // A rules-free task writes no ruleset row at all.
    const plain = workspace();
    try {
      project(plain, "two", null);
      const plainStarted = start({ ...optionsOf(plain), flow: flowRef("learn"), requestId: "plain", actor: "a" });
      const rows = withStore(optionsOf(plain), (store) => {
        try {
          readDefinition(store, plainStarted.instance.id, "ruleset", "rules/engineering");
          return 1;
        } catch (error) {
          return isAppError(error) && error.code === "PIN_MISSING" ? 0 : 2;
        }
      });
      assert.equal(rows, 0, "no rules: no pin, and the rules directory is never read");
    } finally {
      dispose(plain);
    }
  } finally {
    dispose(ws);
  }
});
