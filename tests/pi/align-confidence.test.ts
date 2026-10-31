/**
 * The optional slice (R37-R38): an aligned alignment answer that sits close to the boundary starts
 * WITH a flag naming both probabilities; a decided answer starts clean; a misaligned label is
 * refused exactly as before, whatever its distribution looked like.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { JevRequest, JevResponse } from "pi-jev";
import { ALIGNMENT_CONFIDENCE, ALIGNED, MISALIGNED, jevAlignJudge } from "../../src/quality/jev-align.ts";
import { executePraxisTool, setAlignJudgeForTest, setScorerForTest } from "../../src/pi/tool.ts";
import type { PiToolResult } from "../../src/pi/host.ts";
import { dispose, judgedFlow, workspace, type Workspace } from "../testkit.ts";
import { fakeContext } from "./fixtures.ts";

const SESSION = "session-align-confidence";

/** A judge answering the alignment choice with a stated distribution. */
function judgeWith(choice: string, probabilities: Record<string, number>) {
  const evaluateFn = async (request: JevRequest): Promise<JevResponse> => ({
    model: "fake/align",
    answers: Object.fromEntries(Object.keys(request.questions).map((id) => [id, { type: "choice", choice, probabilities }])),
  } as JevResponse);
  return jevAlignJudge({ evaluateFn: evaluateFn as never });
}

const call = (ws: Workspace, args: unknown): Promise<PiToolResult> =>
  executePraxisTool(args, fakeContext({ cwd: ws.root, sessionId: SESSION }));
const bag = (result: PiToolResult): any => result.details;

function project(): { ws: Workspace; restore: () => void } {
  const ws = workspace();
  judgedFlow(ws);
  const priorConfig = process.env.PRAXIS_CONFIG;
  const priorStore = process.env.PRAXIS_STORE_DIR;
  process.env.PRAXIS_CONFIG = ws.config;
  process.env.PRAXIS_STORE_DIR = ws.store;
  return {
    ws,
    restore: () => {
      if (priorConfig === undefined) delete process.env.PRAXIS_CONFIG;
      else process.env.PRAXIS_CONFIG = priorConfig;
      if (priorStore === undefined) delete process.env.PRAXIS_STORE_DIR;
      else process.env.PRAXIS_STORE_DIR = priorStore;
      setAlignJudgeForTest(undefined);
      setScorerForTest(undefined);
      dispose(ws);
    },
  };
}

const start = (ws: Workspace, requestId: string) =>
  call(ws, { op: "start", flow: "flows/learn", order: "carry out the task this flow runs", requestId });

test("R37: a soft aligned answer starts with a flag naming both probabilities", async () => {
  assert.equal(ALIGNMENT_CONFIDENCE, 0.7, "the threshold is a code constant");
  const { ws, restore } = project();
  try {
    // Decided: no flag at all.
    setAlignJudgeForTest(judgeWith(ALIGNED, { [ALIGNED]: 0.95, [MISALIGNED]: 0.05 }));
    const clean = bag(await start(ws, "decided"));
    assert.equal(clean.code, undefined, JSON.stringify(clean).slice(0, 300));
    assert.equal(clean.step.alignment, undefined, "a decided start carries no flag");
    assert.equal(String(clean.result.summary).includes("alignment"), false);

    // Soft: starts, with the flag and the two probabilities.
    setAlignJudgeForTest(judgeWith(ALIGNED, { [ALIGNED]: 0.62, [MISALIGNED]: 0.38 }));
    const soft = bag(await start(ws, "soft"));
    assert.equal(soft.code, undefined, "a soft start still starts: " + JSON.stringify(soft).slice(0, 300));
    assert.equal(soft.result.status, "running");
    assert.equal(soft.step.alignment.decision, "soft");
    assert.equal(soft.step.alignment.aligned, 0.62);
    assert.equal(soft.step.alignment.misaligned, 0.38);
    assert.match(String(soft.result.summary), /alignment soft: 0\.62 aligned vs 0\.38 misaligned/);

    // No distribution at all: today's behaviour, byte for byte.
    setAlignJudgeForTest({
      async judge() {
        return { decision: "aligned" as const, reason: "no mass here", model: "fake", orderDigest: "sha256:" + "a".repeat(64) };
      },
    });
    const bare = bag(await start(ws, "bare"));
    assert.equal(bare.step.alignment, undefined, "no distribution, no flag");
  } finally {
    restore();
  }
});

test("R38: a misaligned answer is refused exactly as before, soft distribution or not", async () => {
  const { ws, restore } = project();
  try {
    setAlignJudgeForTest(judgeWith(MISALIGNED, { [ALIGNED]: 0.45, [MISALIGNED]: 0.55 }));
    const refused = await start(ws, "misaligned");
    const details = bag(refused);
    assert.equal(refused.isError, true);
    assert.equal(details.code, "ALIGNMENT_REJECTED", "the same typed code as before");
    assert.equal(details.detail.decision, "misaligned");
    // Nothing was created: the refusal wrote no instance.
    assert.equal(details.result, undefined);
  } finally {
    restore();
  }
});
