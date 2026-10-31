/**
 * The quality loop at the tool surface: the agent sees the rubric before it submits, a below-
 * threshold refusal names every dimension with its score and the rubric's own statement, the
 * escalate policy halts in `failed` with the reason in the six-key result, and the default
 * continue policy carries the flow to the next step instead of failing.
 *
 * NO NETWORK: every case installs a fake scorer through `setScorerForTest` and restores the
 * pi-jev default afterwards, so the real adapter never runs in this suite.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { executePraxisTool, setScorerForTest } from "../../src/pi/tool.ts";
import type { PiToolResult } from "../../src/pi/host.ts";
import type { Scorer } from "../../src/quality/index.ts";
import { artifacts, escalateTasks, fakeContext, qualityTasks, tempStore, useAlignedJudge } from "./fixtures.ts";

useAlignedJudge();
import type { FlowConfig, TaskConfig } from "../../src/types/schema.ts";

const SESSION = "session-alpha";

/** A fake scorer returning one fixed score per rubric dimension; never touches the network. */
function fakeScorer(score: number, calls: { count: number } = { count: 0 }): Scorer {
  return {
    async score(input) {
      calls.count += 1;
      return {
        dimensions: input.rubric.map((dimension) => ({ id: dimension.id, score })),
        rationale: "fake scorer",
        scorer: "fake/v1",
      };
    },
  };
}

async function call(cwd: string, args: unknown): Promise<PiToolResult> {
  return executePraxisTool(args, fakeContext({ cwd, sessionId: SESSION }));
}

const bag = (result: PiToolResult): any => result.details;

/** A temp project whose `draft` task carries a required quality floor. */
function project(): ReturnType<typeof tempStore> {
  return tempStore({ tasks: qualityTasks });
}

test("start shows the quality rubric in the step descriptor", async () => {
  const ws = project();
  try {
    const started = bag(await call(ws.cwd, { op: "start", order: "carry out the task this flow runs", flow: "flows/architect", requestId: "q-brief" }));
    const quality = started.step.brief.quality;
    assert.deepEqual(quality.dimensions.map((dimension: { id: string }) => dimension.id), ["solves", "evidence"]);
    assert.equal(quality.dimensions[0].statement, "the draft answers the stated goal");
    // S2/S6: the reported standard is the measured bar - the floor when nothing is raised.
    assert.equal(quality.threshold, 0.5);
    assert.equal(quality.policy, "required");
    // The disclosure names the aggregation rule and the judging stance too, so the agent learns
    // the standard from the brief and never from the source (F1).
    assert.equal(quality.aggregation, "min");
    assert.match(quality.judging, /MINIMUM/);
    assert.deepEqual(quality.recall, { bar: 0.5, weakSet: [], notes: [] }, "cold start: an empty recall set at the floor");
    // The gate the agent must actually clear (pareto-gate): below the 0.8 Pareto point it equals the
    // earned bar, so the disclosure is unchanged in value and only richer in shape.
    // S2: the gate shows the MEASURED per-dimension bars (none yet, so the floor), uncapped.
    assert.deepEqual(quality.gate, { threshold: 0.5, dimensions: { solves: 0.5, evidence: 0.5 } });
    assert.equal(Object.keys(quality).sort().join(","), "aggregation,dimensions,gate,judging,policy,recall,threshold");
  } finally {
    ws.dispose();
  }
});

test("a below-threshold submit names each dimension score and its statement", async () => {
  const ws = project();
  const calls = { count: 0 };
  try {
    setScorerForTest(fakeScorer(0.3, calls));
    const started = bag(await call(ws.cwd, { op: "start", order: "carry out the task this flow runs", flow: "flows/architect", requestId: "q-below" }));
    const submitted = await call(ws.cwd, {
      op: "submit",
      instance: started.result.instanceId,
      artifact: artifacts.validA(started.nonce),
    });
    assert.equal(submitted.isError, true);
    const failure = bag(submitted);
    assert.equal(failure.code, "QUALITY_BELOW_THRESHOLD");
    const quality = failure.detail.quality;
    assert.equal(quality.overall, 0.3);
    // S2/S6: the reported standard is the measured bar - the floor when nothing is raised.
    assert.equal(quality.threshold, 0.5);
    assert.equal(quality.policy, "required");
    assert.equal(quality.source, "jev");
    assert.deepEqual(
      quality.dimensions.map((dimension: { id: string; score: number; statement: string; belowThreshold: boolean }) => [
        dimension.id,
        dimension.score,
        dimension.statement,
        dimension.belowThreshold,
      ]),
      [
        ["solves", 0.3, "the draft answers the stated goal", true],
        ["evidence", 0.3, "every claim carries evidence", true],
      ],
    );
    assert.equal(quality.weakest.id, "solves", "the lowest-scoring dimension is named");
    assert.equal(quality.rationale, "fake scorer");
    assert.equal(calls.count, 1, "one judgment per attempt");
    // The instance is still running at the same step: a refusal is retryable, not death.
    const reread = bag(await call(ws.cwd, { op: "start", order: "carry out the task this flow runs", flow: "flows/architect", requestId: "q-below" }));
    assert.equal(reread.result.status, "running");
    assert.equal(reread.step.id, "draft");
  } finally {
    setScorerForTest(undefined);
    ws.dispose();
  }
});

test("a passing submit advances and the next step declares no floor", async () => {
  const ws = project();
  try {
    setScorerForTest(fakeScorer(0.9));
    const started = bag(await call(ws.cwd, { op: "start", order: "carry out the task this flow runs", flow: "flows/architect", requestId: "q-pass" }));
    const submitted = await call(ws.cwd, {
      op: "submit",
      instance: started.result.instanceId,
      artifact: artifacts.validA(started.nonce),
    });
    assert.notEqual(submitted.isError, true);
    const advanced = bag(submitted);
    assert.equal(advanced.result.status, "running");
    assert.equal(advanced.step.id, "derive");
    assert.equal(advanced.step.brief.quality, undefined, "the derive task declares no floor");
    assert.equal(advanced.result.artifacts.length, 1);
  } finally {
    setScorerForTest(undefined);
    ws.dispose();
  }
});

/**
 * A two-node flow whose second step judges a quality floor and refuses back to the first.
 * The feedback must name the RUNNING step's rubric, not the step the work returned to.
 */
const REFUSE_FLOW = {
  schema: "praxis.flow/v2",
  flow: "flows/architect",
  nodes: [
    { id: "draft", task: "tasks/draft" },
    { id: "derive", task: "tasks/derive" },
  ],
  edges: [
    { kind: "data", from: "draft", to: "derive" },
    { kind: "refuse", from: "derive", to: "draft" },
  ],
  result: "praxis.result/v1",
} satisfies FlowConfig;

const REFUSE_TASKS: readonly TaskConfig[] = [
  {
    id: "draft",
    version: 1,
    state: "published",
    goal: "write the architecture draft",
    capabilities: ["artifact.write", "emit"],
    produces: { schema: "praxis.artifact.architecture/v1" },
    gate: "schema-valid-and-nonce",
  },
  {
    id: "derive",
    version: 1,
    state: "published",
    goal: "derive the next artifact from the draft",
    capabilities: ["artifact.read", "artifact.write", "emit", "evaluate"],
    produces: { schema: "praxis.artifact.derive/v1" },
    gate: "schema-valid-and-nonce",
    quality: {
      dimensions: [{ id: "traces", statement: "the derivation traces back to the draft" }],
      threshold: 0.7,
      policy: "required",
    },
  },
];

test("a refusal on a refuse edge reports the rubric of the step that judged", async () => {
  const ws = tempStore({ config: REFUSE_FLOW, tasks: REFUSE_TASKS });
  try {
    setScorerForTest(fakeScorer(0.2));
    const started = bag(await call(ws.cwd, { op: "start", order: "carry out the task this flow runs", flow: "flows/architect", requestId: "q-refuse" }));
    const draft = bag(
      await call(ws.cwd, { op: "submit", instance: started.result.instanceId, artifact: artifacts.validA(started.nonce) }),
    );
    assert.equal(draft.step.id, "derive");

    const refused = await call(ws.cwd, {
      op: "submit",
      instance: started.result.instanceId,
      artifact: artifacts.validB(started.nonce, draft.result.artifacts[0].digest),
    });
    assert.equal(refused.isError, true);
    const failure = bag(refused);
    assert.equal(failure.code, "QUALITY_BELOW_THRESHOLD");
    assert.equal(failure.detail.step, "derive");
    assert.equal(failure.detail.reworkTo, "draft");
    // The judged step declares a 0.7 authored floor, which sets nothing: the bar is the measured
    // floor until work measures a level.
    assert.equal(failure.detail.quality.threshold, 0.5);
    assert.deepEqual(
      failure.detail.quality.dimensions.map((dimension: { id: string; statement: string }) => [dimension.id, dimension.statement]),
      [["traces", "the derivation traces back to the draft"]],
    );

    // The refuse edge really moved the work back: the reason to report is still derive's rubric.
    const back = bag(await call(ws.cwd, { op: "start", order: "carry out the task this flow runs", flow: "flows/architect", requestId: "q-refuse" }));
    assert.equal(back.step.id, "draft");
    assert.equal(back.result.status, "running");
  } finally {
    setScorerForTest(undefined);
    ws.dispose();
  }
});

test("escalate halts the instance in failed and the result asks for guidance", async () => {
  const ws = tempStore({ tasks: escalateTasks });
  try {
    setScorerForTest(fakeScorer(0.2));
    const started = bag(await call(ws.cwd, { op: "start", order: "carry out the task this flow runs", flow: "flows/architect", requestId: "q-escalate" }));
    const artifact = artifacts.validA(started.nonce);
    const send = () => call(ws.cwd, { op: "submit", instance: started.result.instanceId, artifact });

    // The budget defaults to three attempts; the second identical attempt is already no progress.
    assert.equal(bag(await send()).code, "QUALITY_BELOW_THRESHOLD");
    const halted = await send();
    assert.equal(halted.isError, true);
    const failure = bag(halted);
    assert.equal(failure.code, "QUALITY_BLOCKED");
    assert.match(failure.detail.reason, /no progress/);
    assert.equal(failure.detail.status, "failed");
    assert.equal(failure.detail.policy, "escalate");
    assert.equal(failure.detail.quality.dimensions[0].statement, "the draft answers the stated goal");
    assert.equal(failure.detail.quality.overall, 0.2);

    const reopened = bag(await call(ws.cwd, { op: "start", order: "carry out the task this flow runs", flow: "flows/architect", requestId: "q-escalate" }));
    assert.equal(reopened.result.status, "failed");
    assert.match(reopened.result.nextAction, /^needs-guidance: /);
    assert.match(reopened.result.summary, /^failed at draft/);
    assert.ok(String(reopened.result.summary).includes("no progress"), "the summary carries the reason");
    assert.equal(reopened.step.ops.includes("submit"), false, "a failed step offers no submit");
    assert.deepEqual(Object.keys(reopened.result).sort(), [
      "artifacts",
      "flow",
      "instanceId",
      "nextAction",
      "status",
      "summary",
    ], "the result keeps exactly six keys");
  } finally {
    setScorerForTest(undefined);
    ws.dispose();
  }
});

test("the default onFailure carries the flow to the next step instead of failing", async () => {
  const ws = project(); // qualityTasks declares no onFailure: the default is continue
  try {
    setScorerForTest(fakeScorer(0.2));
    const started = bag(await call(ws.cwd, { op: "start", order: "carry out the task this flow runs", flow: "flows/architect", requestId: "q-continue" }));
    const artifact = artifacts.validA(started.nonce);
    const send = () => call(ws.cwd, { op: "submit", instance: started.result.instanceId, artifact });

    assert.equal(bag(await send()).code, "QUALITY_BELOW_THRESHOLD");
    const carried = await send();
    assert.notEqual(carried.isError, true, "continue is not an error: the flow moved on");
    const advanced = bag(carried);
    assert.equal(advanced.result.status, "running");
    assert.equal(advanced.step.id, "derive");
    assert.equal(advanced.result.artifacts.length, 1);
    assert.equal(advanced.step.brief.quality, undefined, "the next step declares no floor");
  } finally {
    setScorerForTest(undefined);
    ws.dispose();
  }
});
