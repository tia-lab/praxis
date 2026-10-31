/**
 * T2 — the order becomes durable (R7-R11).
 *
 * `op=start` already REQUIRES the order and spent it only on the alignment gate. Now it is recorded on
 * `instance.created` beside its digest, readable through `orderOf`, and nothing judges it yet: the
 * same artifact scores the same with and without one.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { digest } from "../../src/runner/canonical.ts";
import { orderOf, start } from "../../src/runner/engine/index.ts";
import type { EngineOptions } from "../../src/runner/engine/index.ts";
import { withStore } from "../../src/runner/engine/support.ts";
import { executePraxisTool, setAlignJudgeForTest, setScorerForTest } from "../../src/pi/tool.ts";
import type { PiToolResult } from "../../src/pi/host.ts";
import type { Store } from "../../src/store/db.ts";
import {
  clock,
  dispose,
  eventsOf,
  flowRef,
  judgedFlow,
  learningOptions,
  sequenceScorer,
  submitJudged,
  workspace,
  type Workspace,
} from "../testkit.ts";
import { fakeContext, fakeAlignJudge, tempStore, useAlignedJudge } from "../pi/fixtures.ts";

const SESSION = "session-order";
const ORDER = "establish whether the retry path works, from the code";

/** A workspace with the fixture flow, and the store handle the readers take. */
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

const call = (ws: Workspace, args: unknown): Promise<PiToolResult> =>
  executePraxisTool(args, fakeContext({ cwd: ws.root, sessionId: SESSION }));
const bag = (result: PiToolResult): any => result.details;

/** The created payload of an instance, as recorded. */
const createdOf = (ws: Workspace, instance: string): Record<string, unknown> => {
  const event = eventsOf(ws, instance).find((candidate) => candidate.type === "instance.created");
  assert.ok(event, "the instance has a created event");
  return event!.payload as Record<string, unknown>;
};

const withStoreOf = <T>(ws: Workspace, body: (store: Store) => T): T =>
  withStore(learningOptions(ws, "2026-10-31T00:00:00.000Z") as EngineOptions, body);

test("R7: start persists the order and its digest on instance.created", async () => {
  useAlignedJudge();
  const { ws, restore } = project();
  try {
    const started = bag(await call(ws, { op: "start", flow: "flows/learn", order: ORDER, requestId: "order-1" }));
    assert.equal(started.code, undefined, JSON.stringify(started).slice(0, 300));
    const payload = createdOf(ws, started.result.instanceId);
    assert.equal(payload.order, ORDER, "the order is on the record, verbatim");
    assert.equal(payload.orderDigest, digest(ORDER), "the digest is taken over the raw text");
  } finally {
    restore();
  }
});

test("R8: a start without an order writes no order key", () => {
  const { ws, restore } = project();
  try {
    const started = start({ ...learningOptions(ws, "2026-10-31T00:00:01.000Z"), flow: flowRef("learn"), requestId: "no-order", actor: "a" });
    const payload = createdOf(ws, started.instance.id);
    // The pre-T2 golden: exactly these keys, and no others.
    assert.deepEqual(
      Object.keys(payload).sort(),
      ["actor", "flow", "flowDigest", "nonce", "requestId", "storeDir"],
      "the payload is byte-identical in shape to the pre-T2 record",
    );
    assert.equal("order" in payload, false);
    assert.equal("orderDigest" in payload, false);
  } finally {
    restore();
  }
});

test("R9: orderOf reads the order back and returns undefined for an old instance", () => {
  const { ws, restore } = project();
  try {
    const withOrder = start({
      ...learningOptions(ws, "2026-10-31T00:00:02.000Z"),
      flow: flowRef("learn"),
      requestId: "read-order",
      actor: "a",
      order: ORDER,
    });
    // A pre-T2 instance: created with no order, exactly as the old code wrote it.
    const withoutOrder = start({ ...learningOptions(ws, "2026-10-31T00:00:03.000Z"), flow: flowRef("learn"), requestId: "old", actor: "a" });

    assert.equal(withOrderOf(ws, withOrder.instance.id), ORDER, "the order reads back");
    assert.equal(withOrderOf(ws, withoutOrder.instance.id), undefined, "an instance without one reads as undefined");
  } finally {
    restore();
  }

  function withOrderOf(target: Workspace, instance: string): string | undefined {
    return withStoreOf(target, (store) => orderOf(store, instance));
  }
});

test("R10: the order alone changes no verdict", async () => {
  const { ws, restore } = project();
  try {
    const tick = clock().next;
    const options = learningOptions(ws, tick());
    const withOrder = start({ ...options, flow: flowRef("learn"), requestId: "verdict-order", actor: "a", order: ORDER });
    const withoutOrder = start({ ...options, flow: flowRef("learn"), requestId: "verdict-plain", actor: "a" });
    const payload = { schema: "praxis.artifact.make/v1", attempt: 1 };
    await submitJudged(ws, { instance: withOrder.instance.id, nonce: withOrder.instance.nonce }, tick(), 1, sequenceScorer([0.9]));
    await submitJudged(ws, { instance: withoutOrder.instance.id, nonce: withoutOrder.instance.nonce }, tick(), 1, sequenceScorer([0.9]));
    const payloads = [withOrder.instance.id, withoutOrder.instance.id].map((instance) => {
      const event = eventsOf(ws, instance).find((candidate) => candidate.type === "quality.verdict");
      assert.ok(event, "a verdict was recorded");
      return event!.payload as Record<string, unknown>;
    });
    // Two fields cannot be equal and must not be: artifactDigest covers the artifact, which carries
    // each instance own nonce, and T3 records the ANCHOR MARKERS on an anchored verdict by design
    // (R17). Everything else - the scoring arithmetic: composition, MIN, bound, statementScore - is
    // unchanged under a fixed judge. Narrowed by the lead ruling of 2026-10-31 (R10 is T2 scaffolding
    // and T3 legitimately makes the order change the verdict).
    const scoring = payloads.map((recorded) => {
      const copy = { ...recorded };
      delete copy.artifactDigest;
      delete copy.anchored;
      delete copy.anchorDigest;
      return JSON.stringify(copy);
    });
    assert.equal(scoring[0], scoring[1], "the order changes no field the scoring arithmetic produced");
    // The ONLY difference is the anchor, and it appears exactly where an order exists.
    assert.equal(payloads[0]!.anchored, true, "the anchored run records the anchor");
    assert.equal(payloads[0]!.anchorDigest, digest(ORDER), "with the digest of the order it judged");
    assert.equal(payloads[1]!.anchored, undefined, "the unanchored run records no anchor");
    assert.equal(payloads[1]!.anchorDigest, undefined);
    void payload;
  } finally {
    restore();
  }
});

test("R11: the alignment gate refuses exactly as before", async () => {
  setAlignJudgeForTest(fakeAlignJudge("misaligned"));
  const project_ = tempStore();
  try {
    const refused = await call(
      { root: project_.cwd, store: project_.storeDir } as Workspace,
      { op: "start", flow: "flows/architect", order: "write the unrelated marketing page", requestId: "misaligned" },
    );
    const details = bag(refused);
    assert.equal(refused.isError, true);
    assert.equal(details.code, "ALIGNMENT_REJECTED", "the same typed code");
    assert.deepEqual(Object.keys(details.detail).sort(), ["anchor", "decision", "model", "orderDigest", "reason"], "the same detail keys");
    // Nothing was written: no instance, so no created event to carry an order either.
    assert.equal(details.result, undefined);
  } finally {
    project_.dispose();
  }
});
