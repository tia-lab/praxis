/**
 * T1 — task, section and criterion intent (R1-R6).
 *
 * Every new field is optional: a task that declares none of them parses, digests and composes exactly
 * as it did before this slice, which is what R1 and the 12 shipped documents prove.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { canonicalBytes, digest } from "../../src/runner/canonical.ts";
import { missingFor } from "../../src/runner/requirements.ts";
import { executePraxisTool } from "../../src/pi/tool.ts";
import type { PiToolResult } from "../../src/pi/host.ts";
import { QualitySchema, TaskConfigSchema, parseWith } from "../../src/types/schema.ts";
import { isAppError } from "../../src/types/errors.ts";
import type { FlowConfig, TaskConfig } from "../../src/types/schema.ts";
import { fakeContext, tempStore, useAlignedJudge } from "../pi/fixtures.ts";

// Every start in this file goes through the injected aligned judge: no test reaches a model.
useAlignedJudge();

const SESSION = "session-intent";

/** The pre-T1 fixture: a task document with no intent and no targeting, as the tree ships them. */
const BARE: Record<string, unknown> = {
  id: "draft",
  version: 1,
  state: "published",
  goal: "draft the finding",
  capabilities: ["artifact.write", "emit", "evaluate"],
  produces: { schema: "praxis.artifact.architecture/v1" },
  gate: "section-requirements",
  requires: [{ section: "sources", minItems: 1, each: ["url", "claim"] }],
  quality: { dimensions: [{ id: "solves", statement: "the draft answers the goal" }], threshold: 0.6, policy: "required" },
};

const call = (cwd: string, args: unknown): Promise<PiToolResult> =>
  executePraxisTool(args, fakeContext({ cwd, sessionId: SESSION }));
const bag = (result: PiToolResult): any => result.details;

/** A one-step flow whose task is the given document. */
function flowWith(task: Record<string, unknown>): { config: unknown; tasks: TaskConfig[] } {
  return {
    config: {
      schema: "praxis.flow/v2",
      flow: "flows/intent",
      nodes: [{ id: String(task.id), task: "tasks/" + String(task.id) }],
      edges: [],
      result: "praxis.result/v1",
    } satisfies FlowConfig,
    tasks: [task as unknown as TaskConfig],
  };
}

test("R1: a task without intent parses and digests as before", () => {
  // The fixture's bytes are the PRE-T1 document, so its digest is the pre-T1 digest: parsing must add
  // nothing, and the pinned literal proves the canonical form did not move.
  const parsed = parseWith(TaskConfigSchema, BARE, "CONFIG_INVALID", "task");
  assert.deepEqual(parsed, BARE, "parsing adds no field and drops none");
  assert.equal(
    digest(canonicalBytes(parsed)),
    "sha256:bb496576b7a23c2f6fa593bb386c00c90e300bd6e83e57cf25f85d5685424e11",
    "the pinned PRE-T1 digest: the canonical form did not move",
  );
  assert.equal(digest(canonicalBytes(parsed)), digest(canonicalBytes(BARE)), "the parsed document digests as the raw one");
  // Bounds: both new fields are optional and bounded at 1000.
  assert.equal(TaskConfigSchema.safeParse({ ...BARE, rationale: "why this stage exists" }).success, true);
  assert.equal(TaskConfigSchema.safeParse({ ...BARE, scope: "what it is not about" }).success, true);
  assert.equal(TaskConfigSchema.safeParse({ ...BARE, rationale: "x".repeat(1001) }).success, false);
  assert.equal(TaskConfigSchema.safeParse({ ...BARE, scope: "x".repeat(1001) }).success, false);
  assert.equal(TaskConfigSchema.safeParse({ ...BARE, rationale: "" }).success, false);
});

test("R2: section intent reaches the brief and is never graded", async () => {
  const task = {
    ...BARE,
    requires: [
      {
        section: "sources",
        goal: "every source states what it establishes for THIS question",
        rationale: "an uncited claim cannot be re-checked by the next stage",
        minItems: 1,
        each: ["url", "claim"],
      },
    ],
  };
  const project = tempStore(flowWith(task));
  try {
    const started = bag(await call(project.cwd, { op: "start", flow: "flows/intent", order: "carry out the draft", requestId: "intent" }));
    assert.equal(started.code, undefined, JSON.stringify(started).slice(0, 300));
    const requires = started.step.brief.requires;
    const clause = Array.isArray(requires) ? requires[0] : requires;
    assert.equal(clause.goal, "every source states what it establishes for THIS question", "the judge-facing half reaches the brief");
    assert.equal(clause.rationale, "an uncited claim cannot be re-checked by the next stage");

    // And it is never graded: a document that omits every subjective field is missing only `required`.
    const gaps = missingFor({ sources: [{ url: "https://example.test/a" }] }, task.requires as never);
    assert.deepEqual(gaps, ["sources[0].claim"], "only the field rule reports a gap, never the intent");
    assert.equal(gaps.some((gap) => gap.includes("goal") || gap.includes("rationale")), false);
  } finally {
    project.dispose();
  }
});

test("R3: probe sections parse, are unique and bounded", () => {
  const rubric = (probe: Record<string, unknown>) => ({
    threshold: 0.6,
    policy: "required" as const,
    dimensions: [{ id: "d", statement: "s", probes: [probe] }],
  });
  const noul = { id: "p", type: "noul", instructions: "does it hold?" };
  assert.equal(QualitySchema.safeParse(rubric(noul)).success, true, "absent sections is allowed");
  assert.equal(QualitySchema.safeParse(rubric({ ...noul, sections: ["findings"] })).success, true);
  assert.equal(QualitySchema.safeParse(rubric({ ...noul, sections: ["a", "b", "c", "d", "e", "f"] })).success, true, "six is the bound");
  assert.equal(QualitySchema.safeParse(rubric({ ...noul, sections: ["a", "b", "c", "d", "e", "f", "g"] })).success, false, "seven is refused");
  const duplicate = QualitySchema.safeParse(rubric({ ...noul, sections: ["findings", "findings"] }));
  assert.equal(duplicate.success, false, "a duplicate section is refused");
  assert.equal(QualitySchema.safeParse(rubric({ ...noul, sections: [] })).success, false, "an empty list is refused");
  assert.equal(QualitySchema.safeParse(rubric({ ...noul, sections: ["Not_Kebab"] })).success, false, "a non-kebab id is refused");
});

test("R4: a section a criterion targets must exist in requires", () => {
  const targeted = (sections: string[]) => ({
    ...BARE,
    quality: {
      threshold: 0.6,
      policy: "required",
      dimensions: [{ id: "grounded", statement: "grounded", probes: [{ id: "cited", type: "noul", instructions: "is it cited?", sections }] }],
    },
  });
  // `findings` is not a clause of this task, so the target is refused with a path-addressable issue.
  const refused = TaskConfigSchema.safeParse(targeted(["findings"]));
  assert.equal(refused.success, false);
  const issue = (refused as { error: { issues: { path: (string | number)[]; message: string }[] } }).error.issues[0]!;
  assert.match(issue.message, /not declared in requires/);
  assert.deepEqual(issue.path, ["quality", "dimensions", "grounded", "probes", "cited", "sections"]);
  // Through the typed parser it is CONFIG_INVALID, which is the code both parse sites report.
  assert.throws(
    () => parseWith(TaskConfigSchema, targeted(["findings"]), "CONFIG_INVALID", "task"),
    (error: unknown) => isAppError(error) && error.code === "CONFIG_INVALID",
  );
  // A declared section is accepted, and a task with no targeting is untouched.
  assert.equal(TaskConfigSchema.safeParse(targeted(["sources"])).success, true);
  assert.equal(TaskConfigSchema.safeParse(BARE).success, true);
});

test("R5: the brief carries criterion sections", async () => {
  const task = {
    ...BARE,
    requires: [{ section: "sources", goal: "what each source establishes" }, { section: "findings" }],
    quality: {
      threshold: 0.6,
      policy: "required",
      dimensions: [
        {
          id: "grounded",
          statement: "grounded",
          probes: [
            { id: "cited", type: "noul", instructions: "is every claim cited?", sections: ["findings", "sources"] },
            { id: "whole", type: "noul", instructions: "is it grounded overall?" },
          ],
        },
      ],
    },
  };
  const project = tempStore(flowWith(task));
  try {
    const started = bag(await call(project.cwd, { op: "start", flow: "flows/intent", order: "carry out the draft", requestId: "sections" }));
    assert.equal(started.code, undefined, JSON.stringify(started).slice(0, 300));
    const criteria = started.step.brief.quality.dimensions[0].criteria;
    assert.deepEqual(criteria[0].sections, ["findings", "sources"], "the target is disclosed");
    assert.equal(criteria[1].sections, undefined, "an untargeted criterion carries none");
    // A brief for a task WITHOUT targeting is unchanged: no `sections` key anywhere.
    const plain = tempStore(flowWith(BARE));
    try {
      const startedPlain = bag(await call(plain.cwd, { op: "start", flow: "flows/intent", order: "carry out the draft", requestId: "plain" }));
      assert.equal(JSON.stringify(startedPlain).includes("\"sections\""), false, "no sections key on an untargeted brief");
    } finally {
      plain.dispose();
    }
  } finally {
    project.dispose();
  }
});

test("R6: the 12 shipped task documents parse unchanged", () => {
  const root = join(process.cwd(), ".pi", "praxis", "tasks");
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith(".json")) files.push(path);
    }
  };
  walk(root);
  assert.equal(files.length, 12, "the twelve shipped task documents");
  for (const file of files.sort()) {
    const parsed = TaskConfigSchema.safeParse(JSON.parse(readFileSync(file, "utf8")) as unknown);
    assert.equal(parsed.success, true, file + ": " + (parsed.success ? "" : JSON.stringify(parsed.error.issues).slice(0, 300)));
  }
});
