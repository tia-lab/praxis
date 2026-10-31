/**
 * Slice 1, disclosure (R13): the brief shows WHAT DECIDES — every criterion with the text it asks,
 * its options or levels, and the aggregation rule — before the agent submits. Disclosure only:
 * `op=check` still writes nothing, scores nothing and costs no attempt.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { executePraxisTool, setScorerForTest } from "../../src/pi/tool.ts";
import type { PiToolResult } from "../../src/pi/host.ts";
import { sequenceScorer } from "../testkit.ts";
import type { FlowConfig, TaskConfig } from "../../src/types/schema.ts";
import { eventsOf, instanceRow, type Workspace } from "../testkit.ts";
import { fakeContext, tempStore, useAlignedJudge } from "./fixtures.ts";

// No test may reach a model: every start here goes through the injected aligned judge.
useAlignedJudge();

const SESSION = "session-brief-criteria";

/** Five dimensions carrying nineteen criteria between them, as the research rubric does. */
const PROBES = (dimension: string, count: number) => [
  { id: "n1", type: "noul" as const, instructions: dimension + " holds" },
  ...(count > 1 ? [{ id: "s1", type: "score" as const, instructions: dimension + " degree", criteria: ["none", "partial", "full"] }] : []),
  ...(count > 2 ? [{ id: "c1", type: "choice" as const, instructions: dimension + " shape", criteria: { one: "one issue", many: "many issues" }, clean: "one" }] : []),
  ...(count > 3 ? [{ id: "n2", type: "noul" as const, instructions: dimension + " is bounded" }] : []),
];

const TASKS: readonly TaskConfig[] = [
  {
    id: "draft",
    version: 1,
    state: "published",
    goal: "draft the finding",
    capabilities: ["artifact.write", "emit", "evaluate"],
    produces: { schema: "praxis.artifact.architecture/v1" },
    gate: "section-requirements",
    quality: {
      dimensions: [
        { id: "d1", statement: "first", probes: PROBES("d1", 4) },
        { id: "d2", statement: "second", probes: PROBES("d2", 4) },
        { id: "d3", statement: "third", probes: PROBES("d3", 4) },
        { id: "d4", statement: "fourth", probes: PROBES("d4", 4) },
        { id: "d5", statement: "fifth", probes: PROBES("d5", 3) },
      ],
      threshold: 0.6,
      policy: "required",
    },
  },
  {
    id: "plain",
    version: 1,
    state: "published",
    goal: "plain step",
    capabilities: ["artifact.write", "emit", "evaluate"],
    produces: { schema: "praxis.artifact.architecture/v1" },
    gate: "section-requirements",
    quality: { dimensions: [{ id: "solves", statement: "it solves the goal" }], threshold: 0.6, policy: "required" },
  },
];

const FLOW = {
  schema: "praxis.flow/v2",
  flow: "flows/composed",
  nodes: [
    { id: "draft", task: "tasks/draft" },
    { id: "plain", task: "tasks/plain" },
  ],
  edges: [{ kind: "data", from: "draft", to: "plain" }],
  result: "praxis.result/v1",
} satisfies FlowConfig;

const call = (cwd: string, args: unknown): Promise<PiToolResult> =>
  executePraxisTool(args, fakeContext({ cwd, sessionId: SESSION }));
const bag = (result: PiToolResult): any => result.details;
const storeOf = (ws: { storeDir: string }): Workspace => ({ store: ws.storeDir } as Workspace);

test("R13: the brief lists every criterion and op=check still writes nothing", async () => {
  const project = tempStore({ config: FLOW, tasks: TASKS });
  try {
    const started = bag(await call(project.cwd, { op: "start", flow: "flows/composed", order: "carry out the task this flow runs", requestId: "brief" }));
    assert.equal(started.code, undefined, JSON.stringify(started).slice(0, 300));
    const quality = started.step.brief.quality;
    assert.equal(quality.criteriaAggregation, "min", "the aggregation rule is stated");
    const criteria = quality.dimensions.flatMap((dimension: any) => dimension.criteria ?? []);
    assert.equal(criteria.length, 19, "every criterion of every dimension is disclosed");
    assert.deepEqual(quality.dimensions.map((dimension: any) => dimension.criteria.length), [4, 4, 4, 4, 3]);
    const choice = criteria.find((criterion: any) => criterion.type === "choice");
    assert.deepEqual(choice.options, { one: "one issue", many: "many issues" });
    assert.equal(choice.clean, "one", "the clean option is disclosed, so the agent knows what satisfies it");
    const score = criteria.find((criterion: any) => criterion.type === "score");
    assert.deepEqual(score.levels, ["none", "partial", "full"]);
    assert.match(quality.judging, /COMPOSED/, "the stance states composition");

    // op=check is a dry run: no event, no state change, no attempt spent.
    const ws = storeOf(project);
    const before = eventsOf(ws, started.result.instanceId).length;
    const rowBefore = instanceRow(ws, started.result.instanceId);
    const checked = bag(await call(project.cwd, { op: "check", instance: started.result.instanceId, artifact: { schema: "praxis.artifact.architecture/v1", attempt: 1 } }));
    assert.equal(checked.code, undefined, JSON.stringify(checked).slice(0, 300));
    assert.equal(eventsOf(ws, started.result.instanceId).length, before, "check records nothing");
    assert.deepEqual(instanceRow(ws, started.result.instanceId), rowBefore, "check changes no state");
    setScorerForTest(sequenceScorer([0.9]));
    setScorerForTest(undefined);
  } finally {
    project.dispose();
  }
});

test("R13: a task with no criteria shows no criteria and no aggregation rule", async () => {
  const project = tempStore({ config: FLOW, tasks: TASKS });
  try {
    const started = bag(await call(project.cwd, { op: "start", flow: "flows/composed", order: "carry out the task this flow runs", requestId: "flat" }));
    // The FIRST node is the composed one; reach the plain step by accepting a passing draft.
    setScorerForTest(sequenceScorer([0.9]));
    const accepted = bag(await call(project.cwd, { op: "submit", instance: started.result.instanceId, artifact: { schema: "praxis.artifact.architecture/v1", nonce: started.nonce, attempt: 1 } }));
    assert.equal(accepted.code, undefined, JSON.stringify(accepted).slice(0, 300));
    const plain = accepted.step.brief.quality;
    assert.equal(plain.criteriaAggregation, undefined, "nothing is composed on this step");
    assert.equal(plain.dimensions[0].criteria, undefined, "and no criteria are listed");
  } finally {
    setScorerForTest(undefined);
    project.dispose();
  }
});
