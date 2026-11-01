/**
 * The branch decider (R9): ONE typed `choice` judgment that names which labeled arm an
 * ACCEPTED artifact takes next.
 *
 * Contract, and the honest boundary:
 *  - it runs OUTSIDE the store, before `advance`, and returns data (D4): no jev call may sit
 *    inside a store window, and `advance` stays synchronous;
 *  - it is fail-CLOSED, unlike the alignment gate: a throw, a timeout or an unreadable answer
 *    is `ROUTE_UNAVAILABLE`, and an answer that names no declared label is `ROUTE_INVALID`;
 *  - it never guesses and never fails open. A wrong arm runs the wrong work silently, and a
 *    missing route is recoverable by a retry while a wrong arm is not.
 *
 * The question is built by the scorer's own `choiceQuestion`, so a branch decision and a
 * `choice` probe are one shape, not two (one owner per fact).
 */
import { evaluate } from "pi-jev";
import type { Answer, ChoiceAnswer, JevRequest } from "pi-jev";
import { fail } from "../types/errors.ts";
import type { RouteDecision } from "../runner/engine/types.ts";
import { choiceQuestion } from "./jev-scorer.ts";

/** The router every recorded decision names, so a recorded label says which decider produced it. */
export const ROUTER_ID = "jev.choice";

/** How long a route may take before it is unavailable. A route is routing, not a gate: bounded, not endless. */
export const ROUTE_TIMEOUT_MS = 20_000;

/** What the router is asked: the node's own instruction and options, and the accepted artifact. */
export interface RouteInput {
  /** The deciding node's authored instruction, verbatim. */
  instructions: string;
  /** The node's declared options: label -> what that label means. Never restated elsewhere. */
  criteria: Record<string, string>;
  /** The accepted artifact the decision is made about. */
  artifact: string;
  /** Its digest: the decision is bound to these exact bytes (R10). */
  digest: string;
  /** The deciding node and its task goal, context for the question only. */
  step: string;
  goal: string;
}

/** What a router returns: the chosen label, and what produced it. */
export interface RouteAnswer {
  label: string;
  model: string;
  reason?: string;
}

/** The injected port. A test passes a fake; a real run uses `jevRouteRouter()`. */
export interface RouteRouter {
  route(input: RouteInput): Promise<RouteAnswer>;
}

/** The durable shape of one decision (R10), owned by the engine surface that records it. */
export type { RouteDecision };

export interface JevRouteOptions {
  /** The pi-jev call. A test injects a fake here; a real run uses pi-jev's own `evaluate`. */
  evaluateFn?: typeof evaluate;
  /** Model override; pi-jev's own precedence applies when absent. */
  model?: string;
}

/** One bounded wait: a router that never answers is unavailable, never a hung advance. */
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("route timed out after " + ms + "ms")), ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * The `RouteRouter` backed by pi-jev: ONE `choice` question keyed `route`, its criteria the node's
 * own `decide.criteria`, the accepted artifact and its digest in `state`. A pi-jev throw is not
 * caught here; `routeOf` owns the fail-closed mapping, exactly as `evaluateArtifact` owns the
 * scorer's.
 */
export function jevRouteRouter(opts: JevRouteOptions = {}): RouteRouter {
  const run = opts.evaluateFn ?? evaluate;
  return {
    async route(input) {
      const questions = { route: choiceQuestion(input.instructions, input.criteria) };
      const request: JevRequest = {
        state: { goal: input.goal, step: input.step, artifact: input.artifact, subjectDigest: input.digest },
        questions,
        model: opts.model,
      };
      const response = await run(request);
      const answer = response.answers.route as Answer | undefined;
      if (answer === undefined || answer.type !== "choice") {
        throw new Error("jev answer \"route\" is not a choice");
      }
      const label = (answer as ChoiceAnswer).choice;
      return { label, model: response.model, reason: "jev chose " + JSON.stringify(label) };
    },
  };
}

/**
 * Run the router and normalize its result: any throw or timeout is `ROUTE_UNAVAILABLE`, and an
 * answer that names no declared label is `ROUTE_INVALID`. This is the ONLY place the fail-closed
 * decision is made, and it happens before any write.
 */
export async function routeOf(
  router: RouteRouter,
  input: RouteInput,
  opts: { timeoutMs?: number } = {},
): Promise<RouteDecision> {
  let answer: RouteAnswer;
  try {
    answer = await withTimeout(router.route(input), opts.timeoutMs ?? ROUTE_TIMEOUT_MS);
  } catch (error) {
    throw fail("ROUTE_UNAVAILABLE", "the router could not decide the route for step " + JSON.stringify(input.step), {
      step: input.step,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  if (typeof answer.label !== "string" || !Object.prototype.hasOwnProperty.call(input.criteria, answer.label)) {
    throw fail(
      "ROUTE_INVALID",
      "the router chose " + JSON.stringify(answer.label) + ", which node " + JSON.stringify(input.step) + " does not declare",
      { step: input.step, label: answer.label, labels: Object.keys(input.criteria) },
    );
  }
  return {
    label: answer.label,
    router: ROUTER_ID,
    ...(answer.model === undefined ? {} : { model: answer.model }),
    ...(answer.reason === undefined ? {} : { reason: answer.reason }),
    digest: input.digest,
  };
}
