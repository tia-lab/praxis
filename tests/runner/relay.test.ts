/**
 * Unit: the team relay. Different actors own different steps of one instance; the role a
 * step declares decides who may submit it, handoff is automatic by step advancement, and a
 * subject-binding step refuses the author of what it judges (separation of duties).
 *
 * Identity here is a plain actor string set at start by the trusted launcher (the
 * Manifold-free interim). The role map is pinned and immutable; agents never assign it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { isAppError } from "../../src/types/errors.ts";
import { advance, inspect, start } from "../../src/runner/engine.ts";
import { NOW, dispose, flowRef, workspace, writeFlow, type Workspace } from "../testkit.ts";

const RESEARCH = "praxis.artifact.research/v1";
const REVIEW = "praxis.artifact.review/v1";

function options(ws: Workspace) {
  return { configPath: ws.config, storeDir: ws.store, tasksDir: ws.tasks, now: NOW };
}

function relayFlow(ws: Workspace): void {
  writeFlow(ws, "relay", [
    { id: "research", role: "researcher", capabilities: ["artifact.write", "emit"], schema: RESEARCH },
    {
      id: "review",
      role: "reviewer",
      capabilities: ["artifact.read", "artifact.write", "emit"],
      schema: REVIEW,
      bindsSubject: true,
    },
  ]);
}

function expectForbidden(body: () => unknown): void {
  assert.throws(body, (error: unknown) => isAppError(error) && error.code === "INSTANCE_FORBIDDEN");
}

test("two actors relay one instance: the researcher submits research, the reviewer submits review", () => {
  const ws = workspace();
  try {
    relayFlow(ws);
    const started = start({
      ...options(ws),
      flow: flowRef("relay"),
      requestId: "relay-1",
      actor: "orchestrator",
      roles: { researcher: "agent-a", reviewer: "agent-b" },
    });
    const id = started.instance.id;
    const nonce = started.instance.nonce;

    // the reviewer cannot submit the research step
    expectForbidden(() =>
      advance({ ...options(ws), instance: id, actor: "agent-b", artifact: { schema: RESEARCH, nonce } }),
    );

    // the researcher submits research
    const researched = advance({ ...options(ws), instance: id, actor: "agent-a", artifact: { schema: RESEARCH, nonce } });
    const researchDigest = researched.result.artifacts.find((ref) => ref.step === "research")!.digest;
    assert.equal(researched.instance.currentStep, "review");

    // the researcher (also the author) cannot submit the review: wrong role AND self-review
    expectForbidden(() =>
      advance({
        ...options(ws),
        instance: id,
        actor: "agent-a",
        artifact: { schema: REVIEW, nonce, derivedFrom: researchDigest, subject: researchDigest },
      }),
    );

    // the reviewer submits the review and the instance completes
    const reviewed = advance({
      ...options(ws),
      instance: id,
      actor: "agent-b",
      artifact: { schema: REVIEW, nonce, derivedFrom: researchDigest, subject: researchDigest },
    });
    assert.equal(reviewed.result.status, "completed");
  } finally {
    dispose(ws);
  }
});

test("separation of duties: the author may not review even when assigned the reviewer role", () => {
  const ws = workspace();
  try {
    relayFlow(ws);
    const started = start({
      ...options(ws),
      flow: flowRef("relay"),
      requestId: "relay-2",
      actor: "orchestrator",
      roles: { researcher: "agent-a", reviewer: "agent-a" },
    });
    const id = started.instance.id;
    const nonce = started.instance.nonce;
    const researched = advance({ ...options(ws), instance: id, actor: "agent-a", artifact: { schema: RESEARCH, nonce } });
    const researchDigest = researched.result.artifacts.find((ref) => ref.step === "research")!.digest;
    // agent-a holds the reviewer role, but authored the subject: self-review is refused
    expectForbidden(() =>
      advance({
        ...options(ws),
        instance: id,
        actor: "agent-a",
        artifact: { schema: REVIEW, nonce, derivedFrom: researchDigest, subject: researchDigest },
      }),
    );
  } finally {
    dispose(ws);
  }
});

test("a non-member may not observe the instance, but every assigned actor may", () => {
  const ws = workspace();
  try {
    relayFlow(ws);
    const started = start({
      ...options(ws),
      flow: flowRef("relay"),
      requestId: "relay-3",
      actor: "orchestrator",
      roles: { researcher: "agent-a", reviewer: "agent-b" },
    });
    const id = started.instance.id;
    // assigned actors and the creator observe
    for (const actor of ["orchestrator", "agent-a", "agent-b"]) {
      assert.equal(inspect({ ...options(ws), instance: id, actor }).instance.id, id);
    }
    // a stranger is refused
    expectForbidden(() => inspect({ ...options(ws), instance: id, actor: "agent-c" }));
  } finally {
    dispose(ws);
  }
});
