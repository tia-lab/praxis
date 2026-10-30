/**
 * The hooks contract, R1–R11, at the tool surface.
 *
 * The two asymmetries are the point: a `before_` hook can stop an op and leaves NOTHING behind,
 * while an `after_` hook cannot fail an op that already committed. With no binding registered,
 * every op is byte-identical to what it was before this unit.
 *
 * NO NETWORK and no model: the alignment judge and the scorer are both injected fakes.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { executePraxisTool, setAlignJudgeForTest, setScorerForTest } from "../../src/pi/tool.ts";
import type { PiToolResult } from "../../src/pi/host.ts";
import { hookCount, registerHook, resetHooks, HOOK_LOG_PREFIX } from "../../src/runner/hooks.ts";
import type { BeforeStartPayload, HookBinding, HookName, HookPayloads } from "../../src/types/hooks.ts";
import { digest } from "../../src/runner/canonical.ts";
import { query, type Workspace } from "../testkit.ts";
import { artifacts, fakeAlignJudge, fakeContext, qualityTasks, tempStore, tasks as floorlessTasks } from "./fixtures.ts";

const SESSION = "session-hooks";
const ORDER = "draft the architecture for the auth module";

async function call(cwd: string, args: unknown): Promise<PiToolResult> {
  return executePraxisTool(args, fakeContext({ cwd, sessionId: SESSION }));
}

const bag = (result: PiToolResult): any => result.details;
const storeOf = (ws: { storeDir: string }): Workspace => ({ store: ws.storeDir } as Workspace);

function counts(ws: { storeDir: string }): Record<string, number> {
  const out: Record<string, number> = {};
  for (const table of ["instance", "event", "artifact", "definition", "publication"]) {
    out[table] = Number(query(storeOf(ws), `select count(*) as n from ${table}`)[0]?.n ?? -1);
  }
  return out;
}

/** Capture stderr for the length of one body, so containment can be asserted rather than assumed. */
async function withStderr<T>(body: (lines: string[]) => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  (process.stderr as { write: unknown }).write = (chunk: unknown): boolean => {
    lines.push(String(chunk));
    return true;
  };
  try {
    const result = await body(lines);
    return { result, lines };
  } finally {
    (process.stderr as { write: unknown }).write = original;
  }
}

/** A hook that records the payloads it saw. */
function recorder<N extends HookName>(name: N, seen: unknown[], id = "rec"): () => void {
  return registerHook({ name, id, run: (payload: HookPayloads[N]) => { seen.push(payload); } } as HookBinding<N>);
}

/** A hook that vetoes by throwing — the documented way a before_ hook refuses. */
function vetoer<N extends HookName>(name: N, reason = "not allowed here", id = "veto"): () => void {
  return registerHook({ name, id, run: () => { throw new Error(reason); } } as HookBinding<N>);
}

// R1: the taxonomy is closed at eight names; a ninth does not typecheck.
// @ts-expect-error - the closed taxonomy has no ninth name
const _ninth: HookName = "after_read";
void _ninth;

// R5: the order TEXT is never part of before_start's payload; an extra field does not typecheck.
const _validBeforeStart: BeforeStartPayload = {
  op: "start",
  flow: "flows/architect",
  requestId: "r",
  orderDigest: "sha256:" + "0".repeat(64),
  anchor: { flow: "f", flowDigest: "sha256:" + "0".repeat(64), step: "s", goal: "g", produces: "p" },
};
// @ts-expect-error - before_start carries the order's digest, never its text
const _withText: BeforeStartPayload = { ..._validBeforeStart, order: "write the draft" };
void _withText;

test("R2: registration order, sequential dispatch, idempotent unregister, duplicate id refused", async () => {
  const order: string[] = [];
  const ws = tempStore();
  try {
    registerHook({ name: "after_check", id: "a", run: async () => { await Promise.resolve(); order.push("a"); } });
    registerHook({ name: "after_check", id: "b", run: () => { order.push("b"); } });
    assert.equal(hookCount("after_check"), 2);
    assert.throws(() => registerHook({ name: "after_check", id: "a", run: () => {} }), /already has a binding/);
    assert.throws(() => registerHook({ name: "after_read" as HookName, id: "x", run: () => {} }), /unknown hook name/);

    const started = bag(await call(ws.cwd, { op: "start", flow: "flows/architect", requestId: "h-order", order: ORDER }));
    await call(ws.cwd, { op: "check", instance: started.result.instanceId, artifact: artifacts.validA(started.nonce) });
    assert.deepEqual(order, ["a", "b"], "declared order, and b only ran after a's promise settled");
    resetHooks();
    assert.equal(hookCount("after_check"), 0);
  } finally {
    resetHooks();
    setScorerForTest(undefined);
    ws.dispose();
  }
});

test("R3: a vetoing before_start refuses the op and writes nothing at all", async () => {
  const ws = tempStore();
  try {
    setAlignJudgeForTest(fakeAlignJudge("aligned"));
    vetoer("before_start");
    const refused = await call(ws.cwd, { op: "start", flow: "flows/architect", requestId: "h-veto-start", order: ORDER });
    assert.equal(refused.isError, true);
    const failure = bag(refused);
    assert.equal(failure.code, "HOOK_VETOED");
    assert.deepEqual(failure.detail, { hook: "before_start/veto", name: "before_start", reason: "hook threw: not allowed here" });
    assert.equal(existsSync(join(ws.storeDir, "praxis.sqlite")), false, "no store was opened, let alone written");
  } finally {
    resetHooks();
    setAlignJudgeForTest(undefined);
    ws.dispose();
  }
});

test("R3: a vetoing before_ hook refuses check, submit and note write-free", async () => {
  const ws = tempStore({ tasks: qualityTasks });
  try {
    setAlignJudgeForTest(fakeAlignJudge("aligned"));
    const started = bag(await call(ws.cwd, { op: "start", flow: "flows/architect", requestId: "h-veto-ops", order: ORDER }));
    const instance = started.result.instanceId;
    const before = counts(ws);
    setScorerForTest({ score: async (input) => ({ dimensions: input.rubric.map((d) => ({ id: d.id, score: 0.9 })), rationale: "fake", scorer: "fake/v1" }) });

    vetoer("before_check");
    assert.equal(bag(await call(ws.cwd, { op: "check", instance, artifact: artifacts.validA(started.nonce) })).code, "HOOK_VETOED");
    resetHooks();
    vetoer("before_submit");
    assert.equal(bag(await call(ws.cwd, { op: "submit", instance, artifact: artifacts.validA(started.nonce) })).code, "HOOK_VETOED");
    resetHooks();
    vetoer("before_note");
    assert.equal(bag(await call(ws.cwd, { op: "note", instance, subjective: { whatWrong: "a", whatRight: "b", whatBetter: "c", tags: [{ dimension: "solves", lesson: "d" }] } })).code, "HOOK_VETOED");

    assert.deepEqual(counts(ws), before, "a veto leaves every table exactly as it was");
  } finally {
    resetHooks();
    setScorerForTest(undefined);
    setAlignJudgeForTest(undefined);
    ws.dispose();
  }
});

test("R3/R5: before_start runs before the alignment judge, and never sees the order text", async () => {
  const ws = tempStore();
  const sequence: string[] = [];
  const seen: BeforeStartPayload[] = [];
  try {
    registerHook({ name: "before_start", id: "first", run: (payload) => { sequence.push("hook"); seen.push(payload); } });
    setAlignJudgeForTest({
      async judge(input) {
        sequence.push("judge");
        return { decision: "aligned", reason: "fake", model: "fake-align/v1", orderDigest: digest(input.order) };
      },
    });
    await call(ws.cwd, { op: "start", flow: "flows/architect", requestId: "h-order-2", order: ORDER });

    assert.deepEqual(sequence, ["hook", "judge"], "the hook runs at entry, before the external call it might save");
    assert.deepEqual(Object.keys(seen[0]).sort(), ["anchor", "flow", "op", "orderDigest", "requestId"]);
    assert.equal(seen[0].orderDigest, digest(ORDER), "the digest stands in for the text");
    assert.equal(JSON.stringify(seen[0]).includes(ORDER), false, "the order text is nowhere in the payload");
    assert.deepEqual(Object.keys(seen[0].anchor).sort(), ["flow", "flowDigest", "goal", "produces", "step"]);
  } finally {
    resetHooks();
    setAlignJudgeForTest(undefined);
    ws.dispose();
  }
});

test("R6/R7: after_ hooks observe the outcome; a throw is contained and the next hook still runs", async () => {
  const ws = tempStore();
  const seen: unknown[] = [];
  try {
    setAlignJudgeForTest(fakeAlignJudge("aligned"));
    const started = bag(await call(ws.cwd, { op: "start", flow: "flows/architect", requestId: "h-after", order: ORDER }));
    const instance = started.result.instanceId;
    const plain = bag(await call(ws.cwd, { op: "check", instance, artifact: artifacts.validA(started.nonce) }));

    registerHook({ name: "after_check", id: "boom", run: () => { throw new Error("composer exploded"); } });
    recorder("after_check", seen, "second");

    const { result, lines } = await withStderr(async () =>
      call(ws.cwd, { op: "check", instance, artifact: artifacts.validA(started.nonce) }),
    );
    assert.deepEqual(bag(result), plain, "the envelope is identical to the no-hook run");
    assert.equal(seen.length, 1, "the second hook ran despite the first throwing");
    assert.deepEqual(Object.keys(seen[0] as object).sort(), ["instance", "missing", "ok", "op", "step"]);
    assert.equal(lines.length, 1, "one stderr line for one contained failure");
    assert.match(lines[0], /^\[praxis\] hook after_check\/boom failed after check: composer exploded/);
    assert.equal(lines[0].startsWith(HOOK_LOG_PREFIX), true);
  } finally {
    resetHooks();
    setAlignJudgeForTest(undefined);
    ws.dispose();
  }
});

test("R8: after_submit carries accepted/refused with the verdict, and nothing for a floorless task", async () => {
  const ws = tempStore({ tasks: qualityTasks });
  const seen: HookPayloads["after_submit"][] = [];
  try {
    setAlignJudgeForTest(fakeAlignJudge("aligned"));
    recorder("after_submit", seen);

    // accepted
    const started = bag(await call(ws.cwd, { op: "start", flow: "flows/architect", requestId: "h-sub-1", order: ORDER }));
    setScorerForTest({ score: async (input) => ({ dimensions: input.rubric.map((d) => ({ id: d.id, score: 0.9 })), rationale: "fake", scorer: "fake/v1" }) });
    await call(ws.cwd, { op: "submit", instance: started.result.instanceId, artifact: artifacts.validA(started.nonce) });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].decision, "accepted");
    assert.equal(seen[0].verdict?.score, 0.9);
    assert.equal(seen[0].verdict?.mean, 0.9);
    assert.deepEqual(seen[0].verdict?.dimensions.map((d) => d.id).sort(), ["evidence", "solves"]);
    assert.deepEqual(seen[0].verdict?.flagged, []);

    // refused (a quality refusal recorded a verdict, so it IS an outcome)
    const second = bag(await call(ws.cwd, { op: "start", flow: "flows/architect", requestId: "h-sub-2", order: ORDER }));
    setScorerForTest({ score: async (input) => ({ dimensions: input.rubric.map((d) => ({ id: d.id, score: 0.2 })), rationale: "fake", scorer: "fake/v1" }) });
    await call(ws.cwd, { op: "submit", instance: second.result.instanceId, artifact: artifacts.validA(second.nonce) });
    assert.equal(seen.length, 2);
    assert.equal(seen[1].decision, "refused");
    assert.equal(seen[1].verdict?.score, 0.2);
    assert.deepEqual(seen[1].verdict?.refused.sort(), ["evidence", "solves"]);
  } finally {
    resetHooks();
    setScorerForTest(undefined);
    setAlignJudgeForTest(undefined);
    ws.dispose();
  }
  const floorless = tempStore({ tasks: floorlessTasks });
  const seen2: HookPayloads["after_submit"][] = [];
  try {
    setAlignJudgeForTest(fakeAlignJudge("aligned"));
    recorder("after_submit", seen2);
    const started = bag(await call(floorless.cwd, { op: "start", flow: "flows/architect", requestId: "h-sub-3", order: ORDER }));
    await call(floorless.cwd, { op: "submit", instance: started.result.instanceId, artifact: artifacts.validA(started.nonce) });
    assert.equal(seen2.length, 1);
    assert.equal(seen2[0].decision, "accepted");
    assert.equal("verdict" in seen2[0], false, "a task without a floor has no verdict to report");
  } finally {
    resetHooks();
    setAlignJudgeForTest(undefined);
    floorless.dispose();
  }
});

test("R10: with no hooks registered every op is byte-identical and silent", async () => {
  const ws = tempStore({ tasks: qualityTasks });
  try {
    setAlignJudgeForTest(fakeAlignJudge("aligned"));
    const { result, lines } = await withStderr(async () => {
      const started = bag(await call(ws.cwd, { op: "start", flow: "flows/architect", requestId: "h-empty", order: ORDER }));
      const instance = started.result.instanceId;
      const checked = bag(await call(ws.cwd, { op: "check", instance, artifact: artifacts.validA(started.nonce) }));
      setScorerForTest({ score: async (input) => ({ dimensions: input.rubric.map((d) => ({ id: d.id, score: 0.9 })), rationale: "fake", scorer: "fake/v1" }) });
      const submitted = bag(await call(ws.cwd, { op: "submit", instance, artifact: artifacts.validA(started.nonce) }));
      setScorerForTest(undefined);
      const noted = bag(await call(ws.cwd, { op: "note", instance, subjective: { whatWrong: "a", whatRight: "b", whatBetter: "c", tags: [{ dimension: "solves", lesson: "d" }, { dimension: "evidence", lesson: "e" }] } }));
      return { started, checked, submitted, noted };
    });
    assert.deepEqual(Object.keys(result.started).sort(), ["nonce", "result", "step"]);
    assert.deepEqual(result.checked, { ok: true, missing: [], step: "draft" });
    assert.deepEqual(Object.keys(result.submitted).sort(), ["result", "step"]);
    assert.deepEqual(Object.keys(result.noted).sort(), ["note", "result", "step"]);
    assert.deepEqual(lines, [], "an empty registry writes nothing to stderr");
  } finally {
    resetHooks();
    setScorerForTest(undefined);
    setAlignJudgeForTest(undefined);
    ws.dispose();
  }
});

test("R9: the registry module imports no store and no engine", () => {
  const source = readFileSync(new URL("../../src/runner/hooks.ts", import.meta.url), "utf8");
  const sources = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(sources, ["../types/errors.ts", "../types/hooks.ts"], "the module's only imports are the error helper and its own types");
  assert.equal(sources.some((path) => path.includes("store")), false, "no store is reachable");
  assert.equal(sources.some((path) => path.includes("engine")), false, "no engine is reachable");
});
