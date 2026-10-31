/**
 * S3: the brief shows the rules the task follows, and a citing criterion shows the reference its composed
 * question came from. A task that references no rules produces the SAME envelope it produced before this
 * unit - the step descriptor is unchanged, field for field.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { executePraxisTool, setAlignJudgeForTest, setScorerForTest } from "../../src/pi/tool.ts";
import type { PiToolResult } from "../../src/pi/host.ts";
import { dispose, workspace, writeFlow, type Workspace } from "../testkit.ts";
import { fakeAlignJudge, fakeContext } from "./fixtures.ts";

const SESSION = "session-brief-rules";
const SCHEMA = "praxis.artifact.make/v1";

const SET = {
  id: "engineering",
  version: 3,
  rules: [
    { id: "one", statement: "the first rule" },
    { id: "two", statement: "the second rule" },
  ],
};

function project(ws: Workspace, withRules: boolean): void {
  if (withRules) {
    const dir = join(ws.root, ".pi", "praxis", "rules");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "engineering.json"), JSON.stringify(SET, null, 2) + "\n");
  }
  writeFlow(ws, "learn", [
    {
      id: "make",
      capabilities: ["artifact.write", "emit", "evaluate"],
      schema: SCHEMA,
      goal: "make the artifact",
      ...(withRules ? { rules: [{ set: "rules/engineering" }] } : {}),
      quality: {
        threshold: 0.6,
        policy: "required",
        dimensions: [
          {
            id: "solves",
            statement: "it solves the goal",
            probes: [
              ...(withRules
                ? [{ id: "p1", type: "noul", instructions: "does it solve the goal?", rule: { set: "rules/engineering", id: "two" } }]
                : [{ id: "p1", type: "noul", instructions: "does it solve the goal?" }]),
            ],
          },
        ],
      },
    },
  ]);
}

const call = (ws: Workspace, args: unknown): Promise<PiToolResult> =>
  executePraxisTool(args, fakeContext({ cwd: ws.root, sessionId: SESSION }));
const bag = (result: PiToolResult): any => result.details;

async function briefOf(ws: Workspace): Promise<any> {
  const priorConfig = process.env.PRAXIS_CONFIG;
  const priorStore = process.env.PRAXIS_STORE_DIR;
  process.env.PRAXIS_CONFIG = ws.config;
  process.env.PRAXIS_STORE_DIR = ws.store;
  process.env.PRAXIS_RULES_DIR = join(ws.root, ".pi", "praxis", "rules");
  try {
    setAlignJudgeForTest(fakeAlignJudge("aligned"));
    const started = bag(await call(ws, { op: "start", flow: "flows/learn", order: "make the artifact", requestId: "brief" }));
    assert.equal(started.code, undefined, JSON.stringify(started).slice(0, 300));
    return started.step.brief;
  } finally {
    setAlignJudgeForTest(undefined);
    setScorerForTest(undefined);
    if (priorConfig === undefined) delete process.env.PRAXIS_CONFIG;
    else process.env.PRAXIS_CONFIG = priorConfig;
    if (priorStore === undefined) delete process.env.PRAXIS_STORE_DIR;
    else process.env.PRAXIS_STORE_DIR = priorStore;
    delete process.env.PRAXIS_RULES_DIR;
    dispose(ws);
  }
}

test("the brief lists the task's rules in declared order, the set's order inside the ref", async () => {
  const ws = workspace();
  project(ws, true);
  const brief = await briefOf(ws);
  assert.deepEqual(
    brief.rules.map((rule: { id: string }) => rule.id),
    ["one", "two"],
    "the set's document order, not the id list's",
  );
  assert.equal(brief.rules[0].set, "rules/engineering");
  assert.equal(brief.rules[0].version, 3, "the version the brief names");
  assert.match(brief.rules[0].digest, /^sha256:/, "and the bytes it came from");
  // The citing criterion shows the question the JUDGE is asked, statement included, plus its reference.
  const criterion = brief.quality.dimensions[0].criteria[0];
  assert.equal(criterion.instructions, "does it solve the goal?\nRule two: the second rule");
  assert.deepEqual(criterion.rule, { set: "rules/engineering", id: "two" });
});

test("a task with no rules produces the same brief it produced before this unit", async () => {
  const ws = workspace();
  project(ws, false);
  const brief = await briefOf(ws);
  assert.equal("rules" in brief, false, "no rules key at all");
  assert.deepEqual(Object.keys(brief).sort(), ["goal", "produces", "quality"], "and the brief's own keys are unchanged");
  const criterion = brief.quality.dimensions[0].criteria[0];
  assert.equal("rule" in criterion, false, "no citation on an uncited criterion");
  assert.equal(criterion.instructions, "does it solve the goal?", "the authored text, unchanged");
  // The brief's own key set is exactly what it was: adding the field must not add an empty one.
  assert.deepEqual(Object.keys(brief.quality).sort(), ["aggregation", "criteriaAggregation", "dimensions", "gate", "judging", "policy", "recall", "threshold"]);
});
