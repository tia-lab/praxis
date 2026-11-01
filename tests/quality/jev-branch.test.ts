/**
 * The branch decider (R9): ONE typed `choice` question, a strict label read, fail-CLOSED. Four
 * properties: a valid answer routes; a throw or a timeout is ROUTE_UNAVAILABLE; an answer naming no
 * declared label is ROUTE_INVALID; the captured request carries exactly one `choice` question whose
 * criteria ARE the node's. Plus the golden that the shared builder left the scorer's own request
 * byte-identical.
 *
 * NO NETWORK: every router here is a fake.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { ROUTER_ID, jevRouteRouter, routeOf, type RouteInput, type RouteRouter } from "../../src/quality/jev-branch.ts";
import { choiceQuestion, jevScorer } from "../../src/quality/jev-scorer.ts";
import { isAppError } from "../../src/types/errors.ts";
import { digest } from "../../src/runner/canonical.ts";

const INPUT: RouteInput = {
  instructions: "pick the arm that fits the report",
  criteria: { alpha: "the report is about alpha", beta: "the report is about beta" },
  artifact: "{\"schema\":\"x\"}",
  digest: "sha256:" + "a".repeat(64),
  step: "triage",
  goal: "triage the incoming report",
};

/** The typed code a rejection carries, or "none" when it did not reject. */
async function rejection(work: Promise<unknown>): Promise<string> {
  try {
    await work;
    return "none";
  } catch (error) {
    return isAppError(error) ? error.code : "THREW";
  }
}

test("R9: one choice question, its criteria the node's own, and a declared label routes", async () => {
  let captured: any;
  const router = jevRouteRouter({
    evaluateFn: (async (request: unknown) => {
      captured = request;
      return { answers: { route: { type: "choice", choice: "beta" } }, model: "fake-jev/v1" };
    }) as never,
    model: "fake-jev/v1",
  });
  const decision = await routeOf(router, INPUT);
  assert.equal(decision.label, "beta");
  assert.equal(decision.router, ROUTER_ID);
  assert.equal(decision.digest, INPUT.digest);
  assert.equal(decision.model, "fake-jev/v1");
  const questions = captured.questions as Record<string, { type: string; criteria?: Record<string, string> }>;
  assert.deepEqual(Object.keys(questions), ["route"], "exactly one question");
  assert.equal(questions.route!.type, "choice");
  assert.deepEqual(questions.route!.criteria, INPUT.criteria, "the criteria ARE the node's");
  assert.equal(captured.state.subjectDigest, INPUT.digest);
});

test("R9: a throwing router is ROUTE_UNAVAILABLE and writes nothing", async () => {
  const boom: RouteRouter = { async route() { throw new Error("model down"); } };
  assert.equal(await rejection(routeOf(boom, INPUT)), "ROUTE_UNAVAILABLE");
});

test("R9: an undeclared label is ROUTE_INVALID, never a guessed arm", async () => {
  const wild: RouteRouter = { async route() { return { label: "gamma", model: "fake/v1" }; } };
  assert.equal(await rejection(routeOf(wild, INPUT)), "ROUTE_INVALID");
});

test("R9: a router that never answers is ROUTE_UNAVAILABLE, not a hung advance", async () => {
  const silent: RouteRouter = { route: () => new Promise(() => {}) };
  assert.equal(await rejection(routeOf(silent, INPUT, { timeoutMs: 10 })), "ROUTE_UNAVAILABLE");
});

test("golden: extracting choiceQuestion left the scorer's request byte-identical", async () => {
  let captured: any;
  const scorer = jevScorer({
    evaluateFn: (async (request: unknown) => {
      captured = request;
      return {
        answers: {
          "d.p": { type: "choice", choice: "yes" },
          "d.__statement": { type: "noul", noul: 0.9 },
        },
        model: "fake-jev/v1",
      };
    }) as never,
  });
  const rubric = [{ id: "d", statement: "the standard", probes: [{ id: "p", type: "choice", instructions: "which?", criteria: { yes: "it holds", no: "it does not" } }] }];
  await scorer.score({ goal: "g", rubric: rubric as never, artifact: "{}", subjectDigest: "sha256:" + "b".repeat(64) } as never);
  const question = captured.questions["d.p"];
  assert.deepEqual(question, { type: "choice", instructions: "which?", criteria: { yes: "it holds", no: "it does not" } });
  assert.deepEqual(question, choiceQuestion("which?", { yes: "it holds", no: "it does not" }), "one builder, one shape");
  assert.equal(captured.state.subjectDigest, "sha256:" + "b".repeat(64));
  assert.equal(digest("x").startsWith("sha256:"), true);
});
