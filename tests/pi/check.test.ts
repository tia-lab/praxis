/**
 * `op=check`: the stateless dry run. It validates an artifact's SECTIONS against the current step's
 * declared `requires` and reports the same path-addressable gaps a refusal would, so an agent can
 * fix structure before spending a submit.
 *
 * The third case is the important one: check must be a NO-OP. It records no event, leaves the
 * instance row untouched, and a later submit still reports attempt 1 — it consumes no quality
 * attempt and enforces neither the nonce nor the schema.
 *
 * NO NETWORK: the submit in the no-op case runs a fake scorer.
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

const SESSION = "session-check";

/** A flow whose single step declares section requirements AND a floor, so both paths are visible. */
const TASKS: readonly TaskConfig[] = [
  {
    id: "draft",
    version: 1,
    state: "published",
    goal: "draft the finding",
    capabilities: ["artifact.write", "emit", "evaluate"],
    produces: { schema: "praxis.artifact.architecture/v1" },
    gate: "section-requirements",
    requires: { section: "sources", minItems: 2, each: ["url", "claim"] },
    quality: {
      dimensions: [{ id: "solves", statement: "the draft answers the goal" }],
      threshold: 0.6,
      policy: "required",
    },
  },
];

const FLOW = {
  schema: "praxis.flow/v2",
  flow: "flows/architect",
  nodes: [{ id: "draft", task: "tasks/draft" }],
  edges: [],
  result: "praxis.result/v1",
} satisfies FlowConfig;

function project(): ReturnType<typeof tempStore> {
  return tempStore({ config: FLOW, tasks: TASKS });
}

/** The fixture store in the shape the testkit's raw readers expect. */
const storeOf = (ws: { storeDir: string }): Workspace => ({ store: ws.storeDir } as Workspace);

async function call(cwd: string, args: unknown): Promise<PiToolResult> {
  return executePraxisTool(args, fakeContext({ cwd, sessionId: SESSION }));
}

const bag = (result: PiToolResult): any => result.details;

/** A fresh instance of the fixture flow, plus the nonce it pinned. */
async function started(cwd: string, requestId: string): Promise<{ instance: string; nonce: string }> {
  const start = bag(await call(cwd, { op: "start", order: "carry out the task this flow runs", flow: "flows/architect", requestId }));
  return { instance: start.result.instanceId, nonce: start.nonce };
}

const VALID_SOURCES = [
  { url: "https://example.test/a", claim: "the first claim" },
  { url: "https://example.test/b", claim: "the second claim" },
];

test("a complete artifact checks clean, and the descriptor offers the dry run", async () => {
  const ws = project();
  try {
    const { instance, nonce } = await started(ws.cwd, "check-ok");
    const checked = bag(
      await call(ws.cwd, {
        op: "check",
        instance,
        // A wrong nonce on purpose: check validates SECTIONS only, never the nonce or the schema.
        artifact: { schema: "not.the.step.schema/v1", nonce: "not-the-instance-nonce", sources: VALID_SOURCES },
      }),
    );
    assert.deepEqual(checked, { ok: true, missing: [], step: "draft" });

    const again = bag(await call(ws.cwd, { op: "start", order: "carry out the task this flow runs", flow: "flows/architect", requestId: "check-ok" }));
    assert.deepEqual(again.step.ops, ["submit", "check"], "offered wherever a submit is");
    assert.equal(again.nonce, nonce);
  } finally {
    ws.dispose();
  }
});

test("a malformed artifact checks dirty with path-addressable gaps", async () => {
  const ws = project();
  try {
    const { instance } = await started(ws.cwd, "check-gaps");
    const one = bag(
      await call(ws.cwd, { op: "check", instance, artifact: { sources: [{ url: "https://example.test/a" }] } }),
    );
    assert.equal(one.ok, false);
    assert.equal(one.step, "draft");
    assert.ok(
      one.missing.some((gap: string) => gap.startsWith("sources[0]")),
      "the gap addresses the exact field: " + one.missing.join(" | "),
    );
    assert.ok(
      one.missing.some((gap: string) => gap.includes("needs 2 items")),
      "the section is short: " + one.missing.join(" | "),
    );

    const empty = bag(await call(ws.cwd, { op: "check", instance, artifact: {} }));
    assert.equal(empty.ok, false);
    assert.ok(empty.missing.length > 0, "an empty artifact cannot satisfy a required section");
  } finally {
    ws.dispose();
  }
});

test("check records nothing: no event, no state change, and no attempt spent", async () => {
  const ws = project();
  try {
    const { instance, nonce } = await started(ws.cwd, "check-noop");
    const before = eventsOf(storeOf(ws), instance);
    const rowBefore = instanceRow(storeOf(ws), instance);

    for (let index = 0; index < 3; index += 1) {
      const checked = bag(
        await call(ws.cwd, { op: "check", instance, artifact: { sources: index === 0 ? [] : VALID_SOURCES } }),
      );
      assert.equal(typeof checked.ok, "boolean");
    }

    assert.equal(eventsOf(storeOf(ws), instance).length, before.length, "check appended no event");
    assert.deepEqual(instanceRow(storeOf(ws), instance), rowBefore, "check changed no instance state");
    assert.equal(
      eventsOf(storeOf(ws), instance).filter((event) => event.type === "quality.verdict").length,
      0,
      "three checks produced no judgment",
    );
    assert.equal(
      eventsOf(storeOf(ws), instance).filter((event) => event.type === "gate.verdict").length,
      0,
      "three checks ran no gate",
    );

    // The proof that no budget moved: the two real attempts are attempt 1 and attempt 2, so the
    // stall on the second reports attempts 2 - three checks would otherwise have made it five.
    setScorerForTest(sequenceScorer([0.3, 0.2]));
    const refused = await call(ws.cwd, {
      op: "submit",
      instance,
      artifact: { schema: "praxis.artifact.architecture/v1", nonce, sources: VALID_SOURCES },
    });
    assert.equal(refused.isError, true);
    assert.equal(bag(refused).code, "QUALITY_BELOW_THRESHOLD");
    const carried = await call(ws.cwd, {
      op: "submit",
      instance,
      artifact: { schema: "praxis.artifact.architecture/v1", nonce, sources: VALID_SOURCES, revision: 2 },
    });
    assert.notEqual(carried.isError, true, "the second miss is carried by the default policy");
    const continued = eventsOf(storeOf(ws), instance).filter((event) => event.type === "quality.continued");
    assert.equal(continued.length, 1);
    const continuedPayload = continued[0].payload as { attempts: number };
    assert.equal(continuedPayload.attempts, 2, "three checks cost zero quality attempts");
    assert.equal(
      eventsOf(storeOf(ws), instance).filter((event) => event.type === "quality.verdict").length,
      2,
      "exactly two judgments were recorded, both by submits",
    );
  } finally {
    setScorerForTest(undefined);
    ws.dispose();
  }
});
