/**
 * Step 6, rows 33-38 and 42: the subject binding. A `bindsSubject` task must carry the
 * digest of the artifact it judged; the pair check precedes the retained derivedFrom
 * comparison, and the first failing check decides the code (spec R6, plan A10).
 *
 * Reviewer defects 5-8 are answered here: row 34 asserts no accepted row, row 35 asserts
 * the instance stays current, row 33 covers the v2-accepted oracle, and row 42 drives the
 * shipped `v2` flow through start/advance instead of calling the gate with a payload.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { cpSync, readFileSync, writeFileSync } from "node:fs";

import { isAppError } from "../../src/types/errors.ts";
import { advance, openFlow, start } from "../../src/runner/engine.ts";
import { canonicalBytes, digest, digestOf } from "../../src/runner/canonical.ts";
import { NOW, artifactsOf, dispose, flowRef, workspace, writeFlow, type Workspace } from "../testkit.ts";

const PLAN = "praxis.artifact.plan/v1";
const REVIEW = "praxis.artifact.review/v1";
const DELIVERY = "praxis.artifact.delivery/v1";

function options(ws: Workspace) {
  return { configPath: ws.config, storeDir: ws.store, tasksDir: ws.tasks, now: NOW, actor: "tester" };
}

function expectCode(code: string, body: () => unknown): void {
  assert.throws(body, (error: unknown) => isAppError(error) && error.code === code);
}

/** The reviewed flow; `withRefuse` adds the `review -> implement` return edge. */
function reviewedFlow(ws: Workspace, withRefuse = true): void {
  writeFlow(
    ws,
    "reviewed",
    [
      { id: "implement", capabilities: ["artifact.write", "emit"], schema: PLAN },
      {
        id: "review",
        capabilities: ["artifact.read", "artifact.write", "emit"],
        schema: REVIEW,
        requires: { section: "review", required: ["verdict"], equals: { verdict: "PASS" } },
        bindsSubject: true,
      },
    ],
    withRefuse
      ? [
          { kind: "data", from: "implement", to: "review" },
          { kind: "refuse", from: "review", to: "implement" },
        ]
      : [{ kind: "data", from: "implement", to: "review" }],
  );
}

function begun(ws: Workspace, requestId: string, withRefuse = true) {
  reviewedFlow(ws, withRefuse);
  const started = start({ ...options(ws), flow: flowRef("reviewed"), requestId });
  const nonce = started.instance.nonce;
  const implement = { schema: PLAN, nonce, plan: { steps: ["one"] } };
  const implemented = advance({ ...options(ws), instance: started.instance.id, artifact: implement });
  assert.equal(implemented.instance.currentStep, "review");
  return { instance: started.instance.id, nonce, planDigest: digest(canonicalBytes(implement)) };
}

/** Accepted rows for one step: the assertion rows 34 and 35 were missing. */
function acceptedRows(ws: Workspace, instance: string, step: string): number {
  return artifactsOf(ws, instance).filter((row) => row.step === step && row.state === "accepted").length;
}

test("a review citing the accepted version is accepted", () => {
  const ws = workspace();
  try {
    // (a) the cited version is current.
    const first = begun(ws, "r-33a");
    const done = advance({
      ...options(ws),
      instance: first.instance,
      artifact: {
        schema: REVIEW,
        nonce: first.nonce,
        derivedFrom: first.planDigest,
        subject: first.planDigest,
        review: { verdict: "PASS" },
      },
    });
    assert.equal(done.result.status, "completed");
    assert.equal(done.result.artifacts.length, 2);

    // (b) the cited version is the accepted v2, after a refusal forced a second implement.
    const second = begun(ws, "r-33b");
    expectCode("ARTIFACT_INVALID", () =>
      advance({
        ...options(ws),
        instance: second.instance,
        artifact: {
          schema: REVIEW,
          nonce: second.nonce,
          derivedFrom: second.planDigest,
          subject: second.planDigest,
          review: { verdict: "FAIL" },
        },
      }),
    );
    const v2 = { schema: PLAN, nonce: second.nonce, plan: { steps: ["one", "two"] } };
    advance({ ...options(ws), instance: second.instance, artifact: v2 });
    const v2Digest = digest(canonicalBytes(v2));
    const reviewed = advance({
      ...options(ws),
      instance: second.instance,
      artifact: {
        schema: REVIEW,
        nonce: second.nonce,
        derivedFrom: v2Digest,
        subject: v2Digest,
        review: { verdict: "PASS" },
      },
    });
    assert.equal(reviewed.result.status, "completed");
    assert.equal(acceptedRows(ws, second.instance, "review"), 1);
  } finally {
    dispose(ws);
  }
});

test("a review citing a superseded version is SUBJECT_STALE", () => {
  const ws = workspace();
  try {
    const flow = begun(ws, "r-34");
    // A FAIL is a refusal: the work returns to `implement` and a second version lands.
    expectCode("ARTIFACT_INVALID", () =>
      advance({
        ...options(ws),
        instance: flow.instance,
        artifact: {
          schema: REVIEW,
          nonce: flow.nonce,
          derivedFrom: flow.planDigest,
          subject: flow.planDigest,
          review: { verdict: "FAIL" },
        },
      }),
    );
    const second = { schema: PLAN, nonce: flow.nonce, plan: { steps: ["one", "two"] } };
    advance({ ...options(ws), instance: flow.instance, artifact: second });

    expectCode("SUBJECT_STALE", () =>
      advance({
        ...options(ws),
        instance: flow.instance,
        artifact: {
          schema: REVIEW,
          nonce: flow.nonce,
          derivedFrom: flow.planDigest,
          subject: flow.planDigest,
          review: { verdict: "PASS" },
        },
      }),
    );
    assert.equal(acceptedRows(ws, flow.instance, "review"), 0, "a stale review is never accepted");

    // Defect 1: an *accepted* review must be judged again when it is replayed. Here the
    // review was accepted while implement v1 was current; after v2 lands, the same bytes
    // are stale, and the accepted-artifact shortcut must not wave them through.
    writeFlow(
      ws,
      "replayed",
      [
        { id: "implement", capabilities: ["artifact.write", "emit"], schema: PLAN },
        {
          id: "review",
          capabilities: ["artifact.read", "artifact.write", "emit"],
          schema: REVIEW,
          requires: { section: "review", required: ["verdict"], equals: { verdict: "PASS" } },
          bindsSubject: true,
        },
        { id: "publish", capabilities: ["artifact.read", "artifact.write", "emit"], schema: REVIEW },
      ],
      [
        { kind: "data", from: "implement", to: "review" },
        { kind: "data", from: "review", to: "publish" },
        { kind: "refuse", from: "publish", to: "implement" },
      ],
    );
    const replay = start({ ...options(ws), flow: flowRef("replayed"), requestId: "r-34b" });
    const nonce = replay.instance.nonce;
    const v1 = { schema: PLAN, nonce, plan: { steps: ["one"] } };
    advance({ ...options(ws), instance: replay.instance.id, artifact: v1 });
    const v1Digest = digest(canonicalBytes(v1));
    const reviewV1 = {
      schema: REVIEW,
      nonce,
      derivedFrom: v1Digest,
      subject: v1Digest,
      review: { verdict: "PASS" },
    };
    advance({ ...options(ws), instance: replay.instance.id, artifact: reviewV1 });
    assert.equal(acceptedRows(ws, replay.instance.id, "review"), 1);

    expectCode("ARTIFACT_INVALID", () =>
      advance({ ...options(ws), instance: replay.instance.id, artifact: { schema: REVIEW, nonce, derivedFrom: v1Digest, review: { verdict: "FAIL" } } }),
    );
    const v2 = { schema: PLAN, nonce, plan: { steps: ["one", "two"] } };
    advance({ ...options(ws), instance: replay.instance.id, artifact: v2 });

    expectCode("SUBJECT_STALE", () =>
      advance({ ...options(ws), instance: replay.instance.id, artifact: reviewV1 }),
    );
    assert.equal(acceptedRows(ws, replay.instance.id, "review"), 1, "the replay adds no acceptance");
  } finally {
    dispose(ws);
  }
});

test("a review without a subject is SUBJECT_MISSING", () => {
  const ws = workspace();
  try {
    // No refuse edge: R6 says the stage then stays current.
    const flow = begun(ws, "r-35", false);
    expectCode("SUBJECT_MISSING", () =>
      advance({
        ...options(ws),
        instance: flow.instance,
        artifact: {
          schema: REVIEW,
          nonce: flow.nonce,
          derivedFrom: flow.planDigest,
          review: { verdict: "PASS" },
        },
      }),
    );
    const row = artifactsOf(ws, flow.instance);
    assert.equal(acceptedRows(ws, flow.instance, "review"), 0, "a missing subject is never accepted");
    assert.equal(row.filter((entry) => entry.step === "review").length, 1, "the attempt stays pending as evidence");
    const current = start({ ...options(ws), flow: flowRef("reviewed"), requestId: "r-35" });
    assert.equal(current.instance.currentStep, "review", "without a refuse edge the stage stays current");
    assert.equal(current.instance.status, "running");
  } finally {
    dispose(ws);
  }
});

test("a subject that contradicts its own derivedFrom is ARTIFACT_INVALID", () => {
  const ws = workspace();
  try {
    const flow = begun(ws, "r-36");
    const unrelated = digestOf({ not: "the judged artifact" });
    expectCode("ARTIFACT_INVALID", () =>
      advance({
        ...options(ws),
        instance: flow.instance,
        artifact: {
          schema: REVIEW,
          nonce: flow.nonce,
          derivedFrom: flow.planDigest,
          subject: unrelated,
          review: { verdict: "PASS" },
        },
      }),
    );
    assert.equal(acceptedRows(ws, flow.instance, "review"), 0);
  } finally {
    dispose(ws);
  }
});

test("a non-bindsSubject node with a stale derivedFrom is ARTIFACT_INVALID", () => {
  const ws = workspace();
  try {
    writeFlow(ws, "plain", [
      { id: "draft", capabilities: ["artifact.write", "emit"], schema: PLAN },
      { id: "derive", capabilities: ["artifact.read", "artifact.write", "emit"], schema: REVIEW },
    ]);
    const started = start({ ...options(ws), flow: flowRef("plain"), requestId: "r-37" });
    const nonce = started.instance.nonce;
    advance({ ...options(ws), instance: started.instance.id, artifact: { schema: PLAN, nonce } });
    expectCode("ARTIFACT_INVALID", () =>
      advance({
        ...options(ws),
        instance: started.instance.id,
        artifact: { schema: REVIEW, nonce, derivedFrom: digestOf({ wrong: true }) },
      }),
    );
    assert.equal(acceptedRows(ws, started.instance.id, "derive"), 0);
  } finally {
    dispose(ws);
  }
});

test("a bindsSubject node over a join is CONFIG_INVALID", () => {
  const ws = workspace();
  try {
    writeFlow(
      ws,
      "joined-review",
      [
        { id: "draft", capabilities: ["artifact.write", "emit"], schema: PLAN },
        { id: "derive", capabilities: ["artifact.read", "artifact.write", "emit"], schema: PLAN },
        { id: "review", capabilities: ["artifact.read", "artifact.write", "emit"], schema: REVIEW, bindsSubject: true },
      ],
      [
        { kind: "data", from: "draft", to: "derive" },
        { kind: "join", from: "draft", to: "review" },
        { kind: "join", from: "derive", to: "review" },
      ],
    );
    expectCode("CONFIG_INVALID", () => openFlow({ ...options(ws) }));
  } finally {
    dispose(ws);
  }
});

test("a review of the shipped v2 flow without a subject is SUBJECT_MISSING", () => {
  const ws = workspace();
  try {
    const text = readFileSync(new URL("../../.pi/praxis/flows/workflow.json", import.meta.url), "utf8");
    writeFileSync(ws.config, text);
    cpSync(new URL("../../.pi/praxis/tasks", import.meta.url), ws.tasks, { recursive: true });
    const started = start({ ...options(ws), flow: flowRef("workflow"), requestId: "r-42" });
    const nonce = started.instance.nonce;
    const document = (sections: Record<string, unknown>, derivedFrom?: string) => ({
      schema: DELIVERY,
      nonce,
      ...(derivedFrom === undefined ? {} : { derivedFrom }),
      ...sections,
    });
    const submit = (artifact: unknown) =>
      advance({ ...options(ws), instance: started.instance.id, artifact });
    const digestOfStep = (run: { result: { artifacts: Array<{ step: string; digest: string }> } }, step: string): string => {
      const found = run.result.artifacts.find((ref) => ref.step === step);
      assert.ok(found, "expected an accepted " + step);
      return found.digest;
    };

    const research = submit(
      document({
        contract: { task: "t", scope: "s", acceptance: "a" },
        question: { question: "q", boundary: "b" },
        sources: [1, 2, 3].map((n) => ({ source: "s" + n, location: "l" + n, establishes: "e" + n, freshness: "f" + n })),
        explanations: [1, 2].map((n) => ({ explanation: "x" + n, evidence: "e" + n, distinguishing: "d" + n, status: "leading" })),
        findings: ["one"],
        affected: [{ path: "p", declaration: "d", callers: "c", effect: "e" }],
        uncertainty: ["one"],
      }),
    );
    const spec = submit(
      document(
        {
          outcome: { outcome: "o" },
        requirements: [{ id: "R1", requirement: "r", failure: "f", oracle: "o" }],
        model: [{ element: "e", owner: "o", states: "s", invariants: "i", requirement: "R1" }],
          exclusions: ["none"],
          alternatives: [{ alternative: "a", rejected: "r" }],
        },
        digestOfStep(research, "research"),
      ),
    );
    const plan = submit(
      document(
        {
          requirementBasis: ["R1"],
        declarations: [{ path: "p", declaration: "d", before: "b", effect: "e", requirement: "R1", callers: "c" }],
          budget: [{ path: "p", current: 1, after: 2 }],
          steps: ["s"],
          checks: [{ command: "c", scope: "s", expects: "e" }],
          recovery: { recovery: "r" },
          outOfScope: ["none"],
        },
        digestOfStep(spec, "spec"),
      ),
    );
    const implemented = submit(
      document(
        {
          changes: [{ path: "p", line: 1, what: "w" }],
          checks: [{ command: "c", expects: "e", observed: "o" }],
          evidence: { evidence: "e" },
        },
        digestOfStep(plan, "plan"),
      ),
    );
    const implementDigest = implemented.result.artifacts.find((ref) => ref.step === "implement")?.digest;
    assert.ok(implementDigest);

    expectCode("SUBJECT_MISSING", () =>
      submit(
        document({
          derivedFrom: implementDigest,
          review: { verdict: "PASS", criteria: ["c"], gaps: ["none"], minimality: "m" },
        }),
      ),
    );
    assert.equal(acceptedRows(ws, started.instance.id, "review"), 0);
    assert.equal(artifactsOf(ws, started.instance.id).filter((row) => row.step === "review").length, 1);
  } finally {
    dispose(ws);
  }
});
