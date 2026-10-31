/**
 * brief-gate (quantile-bars S2): the step brief shows the bars the GATE applies - the measured,
 * floored per-dimension levels - uncapped, because the bar is a quantile of live work and the Pareto
 * point has nothing left to do. Authored floors and thresholds are disclosed and set nothing.
 *
 * NO NETWORK: fake scorers, a temp workspace.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { executePraxisTool, setAlignJudgeForTest } from "../../src/pi/tool.ts";
import type { PiSessionContext, PiToolResult } from "../../src/pi/host.ts";
import { clock, dimensionScorer, dispose, judgedFlow, startJudged, submitJudged, workspace, type Workspace } from "../testkit.ts";
import { fakeAlignJudge } from "./fixtures.ts";

const SESSION = "session-brief";

function useWorkspace(ws: Workspace): () => void {
  const priorConfig = process.env.PRAXIS_CONFIG;
  const priorStore = process.env.PRAXIS_STORE_DIR;
  process.env.PRAXIS_CONFIG = ws.config;
  process.env.PRAXIS_STORE_DIR = ws.store;
  return () => {
    if (priorConfig === undefined) delete process.env.PRAXIS_CONFIG;
    else process.env.PRAXIS_CONFIG = priorConfig;
    if (priorStore === undefined) delete process.env.PRAXIS_STORE_DIR;
    else process.env.PRAXIS_STORE_DIR = priorStore;
  };
}

const contextFor = (ws: Workspace): PiSessionContext => ({ cwd: ws.root, sessionManager: { getSessionId: () => SESSION } });
const call = (ws: Workspace, args: unknown): Promise<PiToolResult> => executePraxisTool(args, contextFor(ws));
const bag = (result: PiToolResult): any => result.details;

/** The quality block of a started instance's brief. */
async function briefOf(ws: Workspace, requestId: string): Promise<any> {
  const started = bag(await call(ws, { op: "start", flow: "flows/learn", order: "carry out the task this flow runs", requestId }));
  assert.equal(started.code, undefined, "the start succeeded: " + JSON.stringify(started).slice(0, 200));
  return started.step.brief.quality;
}

test("the brief shows the MEASURED bar per dimension, uncapped", async () => {
  const ws = workspace();
  // An authored floor of 0.9 and threshold 0.87: neither sets the bar any more (A1/A2).
  judgedFlow(ws, {
    threshold: 0.87,
    dimensions: [
      { id: "solves", statement: "it solves the stated goal", floor: 0.9 },
      { id: "evidence", statement: "every claim carries evidence" },
      { id: "trace", statement: "the reasoning traces back to its sources" },
    ],
  });
  const restore = useWorkspace(ws);
  try {
    setAlignJudgeForTest(fakeAlignJudge("aligned"));
    const quality = await briefOf(ws, "brief-above");
    assert.equal(quality.gate.threshold, 0.5, "there is no global bar: the floor is the default");
    for (const dimension of ["solves", "evidence", "trace"]) {
      assert.equal(quality.gate.dimensions[dimension], 0.5, "an unmeasured dimension sits at the floor");
    }
    const authored = quality.dimensions.find((dimension: { id: string }) => dimension.id === "solves");
    assert.equal(authored.floor, 0.9, "the authored floor is still disclosed, and sets nothing");
  } finally {
    setAlignJudgeForTest(undefined);
    restore();
    dispose(ws);
  }
});

test("a measured bar above 0.8 is shown as it is: there is no cap", async () => {
  const ws = workspace();
  judgedFlow(ws);
  const restore = useWorkspace(ws);
  try {
    setAlignJudgeForTest(fakeAlignJudge("aligned"));
    const tick = clock().next;
    // 30 carried observations per dimension: the first raise lands at 28 (spec 3.6.1).
    for (let index = 1; index <= 30; index += 1) {
      const run = startJudged(ws, "climb-" + index, tick());
      await submitJudged(ws, run, tick(), 1, dimensionScorer([{ solves: 0.95, evidence: 0.95, trace: 0.95 }]));
    }
    const quality = await briefOf(ws, "brief-climbed");
    assert.equal(quality.gate.dimensions.solves, 0.95, "the measured bar, uncapped");
    assert.equal(quality.gate.dimensions.evidence, 0.95);
    assert.equal(quality.gate.threshold, 0.5, "and no global bar was invented");
  } finally {
    setAlignJudgeForTest(undefined);
    restore();
    dispose(ws);
  }
});

test("an authored threshold is reported but never gates", async () => {
  const ws = workspace();
  judgedFlow(ws, { threshold: 0.6 });
  const restore = useWorkspace(ws);
  try {
    setAlignJudgeForTest(fakeAlignJudge("aligned"));
    const quality = await briefOf(ws, "brief-below");
    // S6: the brief reports the standard the GATE applies, which is per dimension; the scalar is the floor.
    assert.equal(quality.threshold, 0.5, "the floor is the scalar standard");
    assert.equal(quality.gate.threshold, 0.5, "but the gate starts at the floor, not at it");
    for (const dimension of ["solves", "evidence", "trace"]) {
      assert.equal(quality.gate.dimensions[dimension], 0.5);
    }
  } finally {
    setAlignJudgeForTest(undefined);
    restore();
    dispose(ws);
  }
});
