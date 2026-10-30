/**
 * brief-gate: the step brief shows the EFFECTIVE (Pareto-capped) gate beside the earned bar, so an
 * agent never over-works to beat a standard the gate does not apply. Display only — the decision is
 * compoundDecision, which reads the same cap.
 *
 * Proves: above the Pareto point the earned threshold is reported unchanged while the gate shows the
 * cap (global and per dimension); below it the two are equal; and a REAL ratcheted bar above 0.8 is
 * displayed the same way.
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

test("above the Pareto point the brief reports the earned bar and the capped gate", async () => {
  const ws = workspace();
  // A dimension floor of 0.90 and a 0.87 MEAN bar: both above the default cap of 0.80.
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

    assert.equal(quality.threshold, 0.87, "the EARNED bar is still reported");
    assert.equal(quality.gate.threshold, 0.8, "and the gate shows what the mean must actually reach");
    assert.equal(quality.gate.dimensions.solves, 0.8, "the 0.90 floor is capped for the gate");
    assert.equal(quality.gate.dimensions.evidence, 0.8);
    assert.equal(quality.gate.dimensions.trace, 0.8);
    const authored = quality.dimensions.find((dimension: { id: string }) => dimension.id === "solves");
    assert.equal(authored.floor, 0.9, "the authored aspiration is untouched");
  } finally {
    setAlignJudgeForTest(undefined);
    restore();
    dispose(ws);
  }
});

test("below the Pareto point the gate and the earned bar are identical", async () => {
  const ws = workspace();
  judgedFlow(ws, { threshold: 0.6 });
  const restore = useWorkspace(ws);
  try {
    setAlignJudgeForTest(fakeAlignJudge("aligned"));
    const quality = await briefOf(ws, "brief-below");
    assert.equal(quality.threshold, 0.6);
    assert.equal(quality.gate.threshold, 0.6, "no cap applies: the gate equals the earned bar");
    for (const dimension of ["solves", "evidence", "trace"]) {
      assert.equal(quality.gate.dimensions[dimension], 0.6);
    }
  } finally {
    setAlignJudgeForTest(undefined);
    restore();
    dispose(ws);
  }
});

test("a ratcheted earned bar above the cap is displayed beside the capped gate", async () => {
  const ws = workspace();
  judgedFlow(ws);
  const restore = useWorkspace(ws);
  try {
    setAlignJudgeForTest(fakeAlignJudge("aligned"));
    const tick = clock().next;
    // Warmup (10) then one raise per cooldown (5): the global bar reaches 0.85, past the 0.8 cap.
    for (let index = 1; index <= 30; index += 1) {
      const run = startJudged(ws, "climb-" + index, tick());
      await submitJudged(ws, run, tick(), 1, dimensionScorer([{ solves: 0.95, evidence: 0.95, trace: 0.95 }]));
    }
    const quality = await briefOf(ws, "brief-climbed");
    assert.equal(quality.threshold, 0.85, "the ratchet's record is reported faithfully");
    assert.equal(quality.gate.threshold, 0.8, "while the gate the agent must clear is the cap");
    assert.equal(quality.gate.dimensions.solves, 0.8);
  } finally {
    setAlignJudgeForTest(undefined);
    restore();
    dispose(ws);
  }
});
