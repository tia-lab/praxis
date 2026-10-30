/**
 * The alignment gate at the tool surface: three outcomes, and the difference between them is the
 * point of the unit.
 *
 *  - aligned      -> the start is EXACTLY what it was before this unit (same three keys, no flag);
 *  - misaligned   -> ALIGNMENT_REJECTED, and nothing is written at all;
 *  - unavailable  -> the start PROCEEDS, flagged visibly to the agent (descriptor) and the parent
 *                    (summary clause), never silently and never as a refusal.
 *
 * NO NETWORK: every case installs a fake judge through `setAlignJudgeForTest`.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { executePraxisTool, setAlignJudgeForTest } from "../../src/pi/tool.ts";
import type { PiToolResult } from "../../src/pi/host.ts";
import type { AlignJudge } from "../../src/quality/jev-align.ts";
import { digest } from "../../src/runner/canonical.ts";
import { query, type Workspace } from "../testkit.ts";
import { fakeAlignJudge, fakeContext, tempStore } from "./fixtures.ts";

const SESSION = "session-align";
const ORDER = "write the architecture draft";

async function call(cwd: string, args: unknown): Promise<PiToolResult> {
  return executePraxisTool(args, fakeContext({ cwd, sessionId: SESSION }));
}

const bag = (result: PiToolResult): any => result.details;

/** The fixture store in the shape the testkit's raw reader expects. */
const storeOf = (ws: { storeDir: string }): Workspace => ({ store: ws.storeDir } as Workspace);

/** Every row count the unit must leave untouched on a refusal. */
function counts(ws: { storeDir: string }): Record<string, number> {
  const tables = ["instance", "event", "artifact", "definition", "publication"];
  const out: Record<string, number> = {};
  for (const table of tables) out[table] = Number(query(storeOf(ws), `select count(*) as n from ${table}`)[0]?.n ?? -1);
  return out;
}

test("aligned: the start is exactly the pre-unit envelope, with nothing added", async () => {
  const ws = tempStore();
  try {
    setAlignJudgeForTest(fakeAlignJudge("aligned"));
    const started = bag(await call(ws.cwd, { op: "start", flow: "flows/architect", requestId: "align-ok", order: ORDER }));
    assert.deepEqual(Object.keys(started).sort(), ["nonce", "result", "step"], "still exactly result + step + nonce");
    assert.equal(started.step.alignment, undefined, "an aligned start carries no flag");
    assert.equal(/alignment/.test(String(started.result.summary)), false, "and no clause in the summary");
    assert.deepEqual(Object.keys(started.result).sort(), ["artifacts", "flow", "instanceId", "nextAction", "status", "summary"], "the six result keys");
    assert.equal(started.step.id, "draft");
  } finally {
    setAlignJudgeForTest(undefined);
    ws.dispose();
  }
});

test("misaligned: refused with ALIGNMENT_REJECTED, and nothing is written at all", async () => {
  const ws = tempStore();
  try {
    setAlignJudgeForTest(fakeAlignJudge("misaligned", "the order asks for a different stage"));
    const refused = await call(ws.cwd, {
      op: "start",
      flow: "flows/architect",
      requestId: "align-no",
      order: "write the deployment runbook",
    });
    assert.equal(refused.isError, true, "the start is refused");
    const failure = bag(refused);
    assert.equal(failure.code, "ALIGNMENT_REJECTED");
    // D4: the refusal names the decision, the reason, the model, the order digest and the anchor.
    assert.equal(failure.detail.decision, "misaligned");
    assert.match(String(failure.detail.reason), /different stage/);
    assert.equal(failure.detail.model, "fake-align/v1");
    assert.equal(failure.detail.orderDigest, digest("write the deployment runbook"));
    assert.deepEqual(Object.keys(failure.detail.anchor).sort(), ["flow", "flowDigest", "goal", "produces", "step"]);
    assert.equal(failure.detail.anchor.step, "draft");
    assert.equal(failure.detail.anchor.flow, "flows/architect");
    // Write-free: in a fresh project the store file does not even exist afterwards.
    assert.equal(existsSync(join(ws.storeDir, "praxis.sqlite")), false, "no store was opened, let alone written");
  } finally {
    setAlignJudgeForTest(undefined);
    ws.dispose();
  }
});

test("misaligned after a real instance exists still writes nothing", async () => {
  const ws = tempStore();
  try {
    setAlignJudgeForTest(fakeAlignJudge("aligned"));
    await call(ws.cwd, { op: "start", flow: "flows/architect", requestId: "align-first", order: ORDER });
    const before = counts(ws);
    setAlignJudgeForTest(fakeAlignJudge("misaligned", "different work"));
    const refused = await call(ws.cwd, { op: "start", flow: "flows/architect", requestId: "align-second", order: "deploy it" });
    assert.equal(bag(refused).code, "ALIGNMENT_REJECTED");
    assert.deepEqual(counts(ws), before, "no row was added to any of the five tables");
  } finally {
    setAlignJudgeForTest(undefined);
    ws.dispose();
  }
});

test("unavailable: the start PROCEEDS, flagged for the agent and the parent", async () => {
  const ws = tempStore();
  try {
    const throwing: AlignJudge = {
      async judge() {
        throw new Error("TypeSafe HTTP 503");
      },
    };
    setAlignJudgeForTest(throwing);
    const started = bag(await call(ws.cwd, { op: "start", flow: "flows/architect", requestId: "align-down", order: ORDER }));
    assert.equal(started.step.id, "draft", "the start went ahead");
    assert.equal(started.step.alignment.decision, "unchecked", "the agent is told it was not checked");
    assert.match(String(started.step.alignment.reason), /judge unavailable: TypeSafe HTTP 503/);
    assert.equal(started.step.alignment.orderDigest, digest(ORDER));
    assert.match(String(started.result.summary), /alignment unchecked: judge unavailable/, "and so is the parent");
    assert.deepEqual(Object.keys(started.result).sort(), ["artifacts", "flow", "instanceId", "nextAction", "status", "summary"], "no result key was added");
    assert.equal(existsSync(join(ws.storeDir, "praxis.sqlite")), true, "the instance really was created");
  } finally {
    setAlignJudgeForTest(undefined);
    ws.dispose();
  }
});

test("a missing or empty order is refused at the parse, before anything runs", async () => {
  const ws = tempStore();
  try {
    setAlignJudgeForTest(fakeAlignJudge("aligned"));
    for (const args of [
      { op: "start", flow: "flows/architect", requestId: "no-order" },
      { op: "start", flow: "flows/architect", requestId: "empty-order", order: "" },
    ]) {
      const refused = await call(ws.cwd, args);
      assert.equal(refused.isError, true);
      assert.equal(bag(refused).code, "CONFIG_INVALID");
      const issues = bag(refused).detail as Array<{ path: string; message: string }>;
      assert.ok(issues.some((issue) => issue.path === "order"), "the refusal names the order field: " + JSON.stringify(issues));
    }
    assert.equal(existsSync(join(ws.storeDir, "praxis.sqlite")), false, "nothing was created");
  } finally {
    setAlignJudgeForTest(undefined);
    ws.dispose();
  }
});

test("the judge receives the order verbatim and the flow-pinned anchor, and nothing else", async () => {
  const ws = tempStore();
  try {
    let seen: { order: string; anchor: Record<string, unknown> } | undefined;
    setAlignJudgeForTest({
      async judge(input) {
        seen = { order: input.order, anchor: input.anchor as unknown as Record<string, unknown> };
        return { decision: "aligned", reason: "fake", model: "fake-align/v1", orderDigest: digest(input.order) };
      },
    });
    await call(ws.cwd, { op: "start", flow: "flows/architect", requestId: "align-anchor", order: ORDER });
    assert.ok(seen, "the judge ran");
    assert.equal(seen.order, ORDER, "the order text arrives verbatim");
    assert.deepEqual(Object.keys(seen.anchor).sort(), ["flow", "flowDigest", "goal", "produces", "step"], "the anchor is exactly the D2 fields");
    assert.equal(seen.anchor.goal, "write the architecture draft", "the goal comes from the pinned task");
    assert.equal(seen.anchor.produces, "praxis.artifact.architecture/v1");
    assert.match(String(seen.anchor.flowDigest), /^sha256:[0-9a-f]{64}$/, "the anchor names the exact document judged");
  } finally {
    setAlignJudgeForTest(undefined);
    ws.dispose();
  }
});
