/**
 * Unit: the quality floor (quality eval). A fake scorer makes every case deterministic — no network.
 * Proves: a required floor blocks below-threshold and fail-closed when no score is available; an
 * advisory floor records but passes; the verdict is recorded as evidence; and a task without a
 * quality block advances exactly as the plain engine does.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { isAppError } from "../../src/types/errors.ts";
import { start } from "../../src/runner/engine/index.ts";
import { advanceEvaluated, type Scorer } from "../../src/quality/index.ts";
import { NOW, dispose, eventsOf, flowRef, workspace, writeFlow, type Workspace } from "../testkit.ts";

const SCHEMA = "praxis.artifact.make/v1";

function options(ws: Workspace) {
  return { configPath: ws.config, storeDir: ws.store, tasksDir: ws.tasks, now: NOW };
}

/** A fake scorer returning one fixed per-dimension score, so the assertion is deterministic. */
function fakeScorer(score: number): Scorer {
  return { score: async () => ({ dimensions: [{ id: "solves", score }], rationale: "fake", scorer: "fake/v1" }) };
}

function makeFlow(ws: Workspace, policy: "required" | "advisory", withCap = true): void {
  writeFlow(ws, "q", [
    {
      id: "make",
      capabilities: withCap ? ["artifact.write", "emit", "evaluate"] : ["artifact.write", "emit"],
      schema: SCHEMA,
      quality: { dimensions: [{ id: "solves", statement: "does it solve the task" }], threshold: 0.6, policy },
    },
  ]);
}

function startQ(ws: Workspace, req: string): { id: string; nonce: string } {
  const s = start({ ...options(ws), flow: flowRef("q"), requestId: req, actor: "a" });
  return { id: s.instance.id, nonce: s.instance.nonce };
}

function expectCode(body: () => Promise<unknown>, code: string): Promise<void> {
  return assert.rejects(body, (e: unknown) => isAppError(e) && e.code === code);
}

test("a required floor below threshold refuses the step and still records the verdict", async () => {
  const ws = workspace();
  try {
    makeFlow(ws, "required");
    const { id, nonce } = startQ(ws, "q1");
    await expectCode(
      () => advanceEvaluated({ ...options(ws), instance: id, actor: "a", artifact: { schema: SCHEMA, nonce }, scorer: fakeScorer(0.2) }),
      "QUALITY_BELOW_THRESHOLD",
    );
    const q = eventsOf(ws, id).find((e) => e.type === "quality.verdict");
    assert.ok(q, "a quality.verdict is recorded even on refusal");
    assert.equal((q!.payload as { decision: string }).decision, "below");
  } finally {
    dispose(ws);
  }
});

test("a required floor at or above threshold passes and records a pass verdict", async () => {
  const ws = workspace();
  try {
    makeFlow(ws, "required");
    const { id, nonce } = startQ(ws, "q2");
    const r = await advanceEvaluated({ ...options(ws), instance: id, actor: "a", artifact: { schema: SCHEMA, nonce }, scorer: fakeScorer(0.9) });
    assert.equal(r.result.status, "completed");
    const q = eventsOf(ws, id).find((e) => e.type === "quality.verdict");
    assert.equal((q!.payload as { decision: string; source: string }).decision, "pass");
    assert.equal((q!.payload as { source: string }).source, "jev");
  } finally {
    dispose(ws);
  }
});

test("an advisory floor below threshold is recorded but does not block", async () => {
  const ws = workspace();
  try {
    makeFlow(ws, "advisory");
    const { id, nonce } = startQ(ws, "q3");
    const r = await advanceEvaluated({ ...options(ws), instance: id, actor: "a", artifact: { schema: SCHEMA, nonce }, scorer: fakeScorer(0.1) });
    assert.equal(r.result.status, "completed");
    const q = eventsOf(ws, id).find((e) => e.type === "quality.verdict");
    assert.equal((q!.payload as { decision: string }).decision, "below");
  } finally {
    dispose(ws);
  }
});

test("a required floor with no scorer fails closed", async () => {
  const ws = workspace();
  try {
    makeFlow(ws, "required");
    const { id, nonce } = startQ(ws, "q4");
    await expectCode(
      () => advanceEvaluated({ ...options(ws), instance: id, actor: "a", artifact: { schema: SCHEMA, nonce } }),
      "QUALITY_REQUIRED",
    );
  } finally {
    dispose(ws);
  }
});

test("a required floor without the evaluate capability is refused", async () => {
  const ws = workspace();
  try {
    makeFlow(ws, "required", false);
    const { id, nonce } = startQ(ws, "q5");
    await expectCode(
      () => advanceEvaluated({ ...options(ws), instance: id, actor: "a", artifact: { schema: SCHEMA, nonce }, scorer: fakeScorer(0.9) }),
      "QUALITY_REQUIRED",
    );
  } finally {
    dispose(ws);
  }
});

test("a task without a quality block advances unchanged through advanceEvaluated", async () => {
  const ws = workspace();
  try {
    writeFlow(ws, "q", [{ id: "make", capabilities: ["artifact.write", "emit"], schema: SCHEMA }]);
    const { id, nonce } = startQ(ws, "q6");
    const r = await advanceEvaluated({ ...options(ws), instance: id, actor: "a", artifact: { schema: SCHEMA, nonce }, scorer: fakeScorer(0.0) });
    assert.equal(r.result.status, "completed");
    assert.equal(eventsOf(ws, id).find((e) => e.type === "quality.verdict"), undefined);
  } finally {
    dispose(ws);
  }
});

test("a flow-level quality default applies to a task that declares none", async () => {
  const ws = workspace();
  try {
    writeFlow(
      ws,
      "q",
      [{ id: "make", capabilities: ["artifact.write", "emit", "evaluate"], schema: SCHEMA }],
      undefined,
      { dimensions: [{ id: "solves", statement: "does it solve the task" }], threshold: 0.6, policy: "required" },
    );
    const { id, nonce } = startQ(ws, "qd1");
    await expectCode(
      () => advanceEvaluated({ ...options(ws), instance: id, actor: "a", artifact: { schema: SCHEMA, nonce }, scorer: fakeScorer(0.2) }),
      "QUALITY_BELOW_THRESHOLD",
    );
  } finally {
    dispose(ws);
  }
});

test("a task's own quality overrides the flow default", async () => {
  const ws = workspace();
  try {
    writeFlow(
      ws,
      "q",
      [
        {
          id: "make",
          capabilities: ["artifact.write", "emit", "evaluate"],
          schema: SCHEMA,
          quality: { dimensions: [{ id: "solves", statement: "task floor" }], threshold: 0.1, policy: "required" },
        },
      ],
      undefined,
      { dimensions: [{ id: "solves", statement: "flow floor" }], threshold: 0.9, policy: "required" },
    );
    const { id, nonce } = startQ(ws, "qd2");
    // The task's own threshold (0.1) governs, not the flow default (0.9): a 0.3 score passes.
    const r = await advanceEvaluated({ ...options(ws), instance: id, actor: "a", artifact: { schema: SCHEMA, nonce }, scorer: fakeScorer(0.3) });
    assert.equal(r.result.status, "completed");
  } finally {
    dispose(ws);
  }
});
