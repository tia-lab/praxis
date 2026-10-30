/**
 * The quality rework loop (units 1+2, then onFailure): rubric-grounded refusal feedback, a bounded
 * attempt budget, the no-progress rule, the digest score-cache, and the two onFailure policies —
 * `escalate` halts the instance in `failed` with a needs-guidance signal, `continue` carries the
 * best-scoring attempt forward marked FAILED.
 *
 * Every case injects a fake `Scorer`, so nothing here can reach the network. Attempt counts, the
 * previous score, the carried version and the cache are asserted against the event log, which is
 * their only owner: one case also proves the instance row still has exactly its original columns.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { isAppError, type AppError } from "../../src/types/errors.ts";
import { advance, inspect, start } from "../../src/runner/engine/index.ts";
import { advanceEvaluated, type Scorer } from "../../src/quality/index.ts";
import { NOW, artifactsOf, dispose, eventsOf, flowRef, instanceRow, workspace, writeFlow, type Workspace } from "../testkit.ts";

const SCHEMA = "praxis.artifact.make/v1";
const FINISH = "praxis.artifact.finish/v1";
const RUBRIC = [
  { id: "solves", statement: "it solves the stated goal" },
  { id: "evidence", statement: "every claim carries evidence" },
];

function options(ws: Workspace) {
  return { configPath: ws.config, storeDir: ws.store, tasksDir: ws.tasks, now: NOW };
}

/** A fake scorer that returns the next fixed score per call and counts how often it was asked. */
interface CountingScorer extends Scorer {
  calls: number;
}

function countingScorer(...scores: number[]): CountingScorer {
  const scorer: CountingScorer = {
    calls: 0,
    async score() {
      const index = Math.min(scorer.calls, scores.length - 1);
      const score = scores[index];
      scorer.calls += 1;
      return {
        dimensions: RUBRIC.map((dimension) => ({ id: dimension.id, score })),
        rationale: "fake scorer",
        scorer: "fake/v1",
      };
    },
  };
  return scorer;
}

/** One single-node flow whose only step carries a required floor; `extra` sets the policy/budget. */
function makeFlow(ws: Workspace, extra: Record<string, unknown> = {}): void {
  writeFlow(ws, "q", [
    {
      id: "make",
      capabilities: ["artifact.write", "emit", "evaluate"],
      schema: SCHEMA,
      quality: { dimensions: RUBRIC, threshold: 0.6, policy: "required", ...extra },
    },
  ]);
}

/** make (judged) -> finish (consumes): the shape a carried-forward artifact has to survive. */
function pipelineFlow(ws: Workspace, extra: Record<string, unknown> = {}): void {
  writeFlow(ws, "q", [
    {
      id: "make",
      capabilities: ["artifact.write", "emit", "evaluate"],
      schema: SCHEMA,
      quality: { dimensions: RUBRIC, threshold: 0.6, policy: "required", ...extra },
    },
    {
      id: "finish",
      capabilities: ["artifact.read", "artifact.write", "emit"],
      schema: FINISH,
    },
  ]);
}

function startQ(ws: Workspace, requestId: string): { id: string; nonce: string } {
  const started = start({ ...options(ws), flow: flowRef("q"), requestId, actor: "a" });
  return { id: started.instance.id, nonce: started.instance.nonce };
}

/** One submit of a distinct payload, so each attempt is different bytes. */
function submit(ws: Workspace, id: string, nonce: string, attempt: number, scorer: Scorer): Promise<unknown> {
  return advanceEvaluated({
    ...options(ws),
    instance: id,
    actor: "a",
    artifact: { schema: SCHEMA, nonce, attempt },
    scorer,
  });
}

/** The typed failure a call throws, so its detail can be asserted. */
async function failureOf(run: () => Promise<unknown>): Promise<AppError> {
  try {
    await run();
  } catch (error) {
    assert.ok(isAppError(error), "the refusal must be a typed AppError");
    return error;
  }
  throw new Error("expected a typed refusal, the call succeeded");
}

function eventsOfType(ws: Workspace, id: string, type: string): Array<Record<string, unknown>> {
  return eventsOf(ws, id).filter((event) => event.type === type);
}

/** An escalation halts the instance in `failed`, records the failure and asks for guidance. */
test("escalate halts in failed, records the failure and emits needs-guidance", async () => {
  const ws = workspace();
  try {
    makeFlow(ws, { onFailure: "escalate" });
    const { id, nonce } = startQ(ws, "esc-1");
    const scorer = countingScorer(0.2, 0.35, 0.5);

    await failureOf(() => submit(ws, id, nonce, 1, scorer));
    await failureOf(() => submit(ws, id, nonce, 2, scorer));
    const halted = await failureOf(() => submit(ws, id, nonce, 3, scorer));
    assert.equal(halted.code, "QUALITY_BLOCKED");

    const detail = halted.detail as {
      attempts: number;
      maxAttempts: number;
      policy: string;
      status: string;
      reason: string;
      quality: { score: number; dimensions: { id: string; score: number }[] };
      history: { score: number }[];
    };
    assert.equal(detail.status, "failed");
    assert.equal(detail.policy, "escalate");
    assert.equal(detail.attempts, 3, "the default budget is three attempts");
    assert.equal(detail.maxAttempts, 3);
    assert.equal(detail.quality.score, 0.5);
    assert.deepEqual(detail.history.map((attempt) => attempt.score), [0.2, 0.35, 0.5]);
    assert.deepEqual(detail.quality.dimensions.map((dimension) => dimension.id), ["solves", "evidence"]);
    assert.match(detail.reason, /attempt budget of 3 exhausted at attempt 3/);

    const row = instanceRow(ws, id);
    assert.equal(row?.status, "failed");
    assert.equal(row?.current_step, "make");
    assert.deepEqual(Object.keys(row ?? {}).sort(), [
      "actor",
      "created_at",
      "current_step",
      "flow",
      "id",
      "nonce",
      "revision",
      "status",
      "updated_at",
    ]);

    const failed = eventsOfType(ws, id, "instance.failed");
    assert.equal(failed.length, 1, "exactly one instance.failed event");
    const failedPayload = failed[0].payload as { step: string; attempts: number; verdict: { score: number }; reason: string };
    assert.equal(failedPayload.step, "make");
    assert.equal(failedPayload.attempts, 3);
    assert.equal(failedPayload.verdict.score, 0.5);
    assert.equal(failedPayload.reason, detail.reason);

    const guidance = eventsOfType(ws, id, "needs.guidance");
    assert.equal(guidance.length, 1, "exactly one needs-guidance signal");
    const guidancePayload = guidance[0].payload as { step: string; policy: string; reason: string; verdict: unknown; history: unknown[] };
    assert.equal(guidancePayload.step, "make");
    assert.equal(guidancePayload.policy, "escalate");
    assert.equal(guidancePayload.reason, detail.reason);
    assert.ok(guidancePayload.verdict, "the signal carries the verdict");
    assert.equal(guidancePayload.history.length, 3);
    assert.equal(eventsOfType(ws, id, "quality.verdict").length, 3);
    assert.equal(eventsOfType(ws, id, "quality.continued").length, 0);
    assert.equal(artifactsOf(ws, id).filter((row) => row.state === "accepted").length, 0);

    const view = inspect({ ...options(ws), instance: id, actor: "a" });
    assert.equal(view.result.status, "failed");
    assert.equal(view.instance.failedReason, detail.reason, "the reason is derived from the event log");
    assert.match(view.result.summary, /^failed at make/);
    assert.ok(String(view.result.summary).includes("attempt budget of 3"), "the summary carries the reason");
    assert.match(view.result.nextAction, /^needs-guidance: /);
  } finally {
    dispose(ws);
  }
});

/** The no-progress rule fires before the budget is spent, and escalate still escalates. */
test("escalate on no progress stops the retry loop early", async () => {
  const ws = workspace();
  try {
    makeFlow(ws, { maxAttempts: 5, onFailure: "escalate" });
    const { id, nonce } = startQ(ws, "esc-2");
    const scorer = countingScorer(0.4);

    await failureOf(() => submit(ws, id, nonce, 1, scorer));
    const halted = await failureOf(() => submit(ws, id, nonce, 2, scorer));
    assert.equal(halted.code, "QUALITY_BLOCKED", "an equal score is no progress");
    const detail = halted.detail as { attempts: number; maxAttempts: number; reason: string };
    assert.equal(detail.attempts, 2);
    assert.equal(detail.maxAttempts, 5);
    assert.match(detail.reason, /no progress/);
    assert.equal(instanceRow(ws, id)?.status, "failed");
    assert.equal(eventsOfType(ws, id, "needs.guidance").length, 1);
  } finally {
    dispose(ws);
  }
});

/** The default policy moves the flow on with the best attempt, marked FAILED, and the next step reads it. */
test("the default onFailure continues carrying the best-scoring version, marked FAILED", async () => {
  const ws = workspace();
  try {
    pipelineFlow(ws); // no onFailure declared: the default is continue
    const { id, nonce } = startQ(ws, "con-1");
    // Attempt 1 scores 0.5, attempt 2 scores 0.2: no progress, so the bound is reached with
    // version 1 as the best-scoring artifact of the step.
    const scorer = countingScorer(0.5, 0.2);

    await failureOf(() => submit(ws, id, nonce, 1, scorer));
    const advanced = (await submit(ws, id, nonce, 2, scorer)) as {
      result: { status: string; artifacts: { step: string; version: number; digest: string }[] };
    };
    assert.equal(advanced.result.status, "running", "continue keeps the flow running");

    const records = artifactsOf(ws, id);
    const make = records.filter((record) => record.step === "make");
    assert.deepEqual(
      make.map((record) => [record.version, record.state]),
      [
        [1, "accepted"],
        [2, "pending"],
      ],
      "the best attempt is accepted and the worse one stays refused",
    );
    const best = make[0];
    assert.deepEqual(advanced.result.artifacts, [
      { step: "make", version: 1, digest: best.digest, schema: SCHEMA },
    ]);

    const accepted = eventsOfType(ws, id, "artifact.accepted");
    assert.equal(accepted.length, 1);
    const acceptedPayload = accepted[0].payload as { version: number; failed?: { score: number; decision: string } };
    assert.equal(acceptedPayload.version, 1);
    assert.equal(acceptedPayload.failed?.score, 0.5, "the record marks the carried artifact FAILED");
    assert.equal(acceptedPayload.failed?.decision, "below");

    const continued = eventsOfType(ws, id, "quality.continued");
    assert.equal(continued.length, 1);
    const continuedPayload = continued[0].payload as { carried: { version: number; score: number }; attempts: number };
    assert.deepEqual(continuedPayload.carried, { version: 1, score: 0.5 });
    assert.equal(continuedPayload.attempts, 2);
    assert.equal(eventsOfType(ws, id, "instance.failed").length, 0, "continue never halts the instance");
    assert.equal(eventsOfType(ws, id, "needs.guidance").length, 0);

    // The next step really can consume the carried version: the handoff resolved to v1.
    const finished = await advance({
      ...options(ws),
      instance: id,
      actor: "a",
      artifact: { schema: FINISH, nonce, derivedFrom: best.digest },
    });
    assert.equal(finished.result.status, "completed");
    assert.equal(finished.result.artifacts.length, 2);
    assert.equal(instanceRow(ws, id)?.status, "completed");
  } finally {
    dispose(ws);
  }
});

/** At the terminal node, continue completes the flow with the failed artifact on the record. */
test("continue at the terminal node completes the flow", async () => {
  const ws = workspace();
  try {
    makeFlow(ws, { maxAttempts: 1 });
    const { id, nonce } = startQ(ws, "con-2");
    const advanced = (await submit(ws, id, nonce, 1, countingScorer(0.3))) as { result: { status: string; artifacts: unknown[] } };
    assert.equal(advanced.result.status, "completed");
    assert.equal(advanced.result.artifacts.length, 1);
    const rows = artifactsOf(ws, id);
    assert.equal(rows[0].state, "accepted");
    assert.equal(eventsOfType(ws, id, "quality.continued").length, 1);
    assert.equal(eventsOfType(ws, id, "instance.completed").length, 1);
  } finally {
    dispose(ws);
  }
});

/** A deterministic gate failure is never carried forward: the policy only covers the floor. */
test("continue does not carry an artifact that fails the deterministic gate", async () => {
  const ws = workspace();
  try {
    makeFlow(ws, { maxAttempts: 1 });
    const { id } = startQ(ws, "con-3");
    const refused = await failureOf(() =>
      advanceEvaluated({
        ...options(ws),
        instance: id,
        actor: "a",
        artifact: { schema: SCHEMA, attempt: 1 }, // no nonce
        scorer: countingScorer(0.0),
      }),
    );
    assert.equal(refused.code, "ARTIFACT_INVALID");
    assert.equal(instanceRow(ws, id)?.status, "running");
    assert.equal(eventsOfType(ws, id, "quality.continued").length, 0);
  } finally {
    dispose(ws);
  }
});

/** An improving retry that crosses the floor advances normally, under either policy. */
test("an improving attempt that crosses the floor advances the flow", async () => {
  const ws = workspace();
  try {
    makeFlow(ws, { onFailure: "escalate" });
    const { id, nonce } = startQ(ws, "pass-1");
    const scorer = countingScorer(0.2, 0.9);

    const first = await failureOf(() => submit(ws, id, nonce, 1, scorer));
    assert.equal(first.code, "QUALITY_BELOW_THRESHOLD");
    const firstDetail = first.detail as { quality: { score: number } };
    assert.equal(firstDetail.quality.score, 0.2, "the refusal carries the typed verdict");

    const advanced = (await submit(ws, id, nonce, 2, scorer)) as { result: { status: string } };
    assert.equal(advanced.result.status, "completed");
    assert.deepEqual(
      eventsOfType(ws, id, "quality.verdict").map((event) => (event.payload as { decision: string }).decision),
      ["below", "pass"],
    );
    assert.equal(eventsOfType(ws, id, "instance.failed").length, 0);
    const accepted = eventsOfType(ws, id, "artifact.accepted")[0].payload as { failed?: unknown };
    assert.equal(accepted.failed, undefined, "a passing artifact carries no FAILED mark");
  } finally {
    dispose(ws);
  }
});

/** Identical bytes are judged once; the second attempt is no progress and escalates. */
test("identical bytes reuse the recorded verdict instead of calling the scorer", async () => {
  const ws = workspace();
  try {
    makeFlow(ws, { onFailure: "escalate" });
    const { id, nonce } = startQ(ws, "cache-1");
    const scorer = countingScorer(0.2);
    const bytes = { schema: SCHEMA, nonce };
    const send = () => advanceEvaluated({ ...options(ws), instance: id, actor: "a", artifact: bytes, scorer });

    await failureOf(send);
    const second = await failureOf(send);
    assert.equal(scorer.calls, 1, "the same bytes and rubric are judged once");
    assert.equal(second.code, "QUALITY_BLOCKED", "an identical resubmit is no progress");
    const detail = second.detail as { quality: { score: number }; reason: string };
    assert.equal(detail.quality.score, 0.2, "the cached verdict is reused unchanged");
    assert.match(detail.reason, /no progress/);
  } finally {
    dispose(ws);
  }
});

/** The flow-level quality default supplies both the policy and the budget. */
test("the flow-level quality default supplies the policy and the budget", async () => {
  const ws = workspace();
  try {
    writeFlow(
      ws,
      "q",
      [{ id: "make", capabilities: ["artifact.write", "emit", "evaluate"], schema: SCHEMA }],
      undefined,
      { dimensions: RUBRIC, threshold: 0.6, policy: "required", maxAttempts: 1, onFailure: "escalate" },
    );
    const { id, nonce } = startQ(ws, "flow-1");
    const halted = await failureOf(() => submit(ws, id, nonce, 1, countingScorer(0.3)));
    assert.equal(halted.code, "QUALITY_BLOCKED");
    const detail = halted.detail as { attempts: number; maxAttempts: number; policy: string };
    assert.equal(detail.maxAttempts, 1, "the flow default supplies the budget");
    assert.equal(detail.policy, "escalate", "the flow default supplies the policy");
    assert.equal(detail.attempts, 1);
  } finally {
    dispose(ws);
  }
});

/** A judge that cannot score must not spin: one fail-closed refusal, then the policy applies. */
test("an unavailable score rejects once and then escalates instead of looping", async () => {
  const ws = workspace();
  try {
    makeFlow(ws, { onFailure: "escalate" });
    const { id, nonce } = startQ(ws, "unavailable-1");
    const broken: Scorer = {
      async score() {
        throw new Error("no judge available");
      },
    };
    const first = await failureOf(() => submit(ws, id, nonce, 1, broken));
    assert.equal(first.code, "QUALITY_REQUIRED", "the first attempt fails closed, not silently");
    const second = await failureOf(() => submit(ws, id, nonce, 2, broken));
    assert.equal(second.code, "QUALITY_BLOCKED", "an unjudgeable step cannot retry forever");
    const detail = second.detail as { reason: string; quality: { source: string; decision: string } };
    assert.match(detail.reason, /no score available \(error\) after 2 attempt\(s\)/);
    assert.equal(detail.quality.source, "error");
    assert.equal(detail.quality.decision, "unavailable");
  } finally {
    dispose(ws);
  }
});

/** An escalated instance is durable: nothing resumes it, and re-opening reads it as failed. */
test("a failed instance is durable and is not silently resumed", async () => {
  const ws = workspace();
  try {
    makeFlow(ws, { maxAttempts: 1, onFailure: "escalate" });
    const { id, nonce } = startQ(ws, "dur-1");
    await failureOf(() => submit(ws, id, nonce, 1, countingScorer(0.2)));

    const resumed = await failureOf(async () =>
      advance({ ...options(ws), instance: id, actor: "a", artifact: { schema: SCHEMA, nonce } }),
    );
    assert.equal(resumed.code, "INSTANCE_STATE_INVALID");
    const resubmitted = await failureOf(() => submit(ws, id, nonce, 2, countingScorer(0.9)));
    assert.equal(resubmitted.code, "INSTANCE_STATE_INVALID");

    const again = start({ ...options(ws), flow: flowRef("q"), requestId: "dur-1", actor: "a" });
    assert.equal(again.created, false, "re-opening reads the failed instance, it does not reset it");
    assert.equal(again.instance.status, "failed");
    assert.equal(instanceRow(ws, id)?.status, "failed");
    assert.equal(eventsOfType(ws, id, "instance.failed").length, 1, "the escalation is recorded once");
  } finally {
    dispose(ws);
  }
});
