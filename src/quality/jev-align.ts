/**
 * The jev alignment gate's judge: one typed `choice` judgment over (the incoming order, the task
 * anchor the pinned flow already fixes). It answers whether the order belongs to the task the flow
 * will make the agent run.
 *
 * Contract, and the honest boundary:
 *  - the anchor comes from the flow document, never from the order (spec D2); the order is only
 *    ever the thing judged, and only its digest is kept;
 *  - a genuine `misaligned` verdict is the ONLY refusal (spec D4);
 *  - a throw, an unreadable answer or an unavailable model is `unavailable`, and the caller
 *    PROCEEDS with a visible flag (owner decision ii): a model outage must not halt every start,
 *    because this is routing hygiene, not a safety gate (spec D3, D3a, R9);
 *  - it is not isolation (gate #1) and not trusted identity (gate #3): the anchor is trusted
 *    because the flow is pinned at spawn, never because the caller proved who it is.
 */
import { evaluate } from "pi-jev";
import type { Answer, ChoiceAnswer, JevRequest } from "pi-jev";
import { digest } from "../runner/canonical.ts";
import type { OpenedFlow } from "../runner/engine/index.ts";

/** The task the flow will actually run, fixed before any write. Never derived from the order. */
export interface AlignmentAnchor {
  /** The flow's own identity, e.g. `flows/engineering/feature`. */
  flow: string;
  /** The digest of the flow document the start would pin. */
  flowDigest: string;
  /** The first step: the node this start would put the agent on. */
  step: string;
  /** That task's declared goal. */
  goal: string;
  /** That task's declared role, when it has one. */
  role?: string;
  /** The schema that task must produce. */
  produces: string;
}

/** Three outcomes; only `misaligned` refuses, `unavailable` proceeds with a flag. */
export interface AlignmentVerdict {
  decision: "aligned" | "misaligned" | "unavailable";
  reason: string;
  model: string;
  /** `sha256:` over the order text: the text itself is never stored or logged. */
  orderDigest: string;
}

/** The injected port. A test passes a fake; a real run uses `jevAlignJudge()`. */
export interface AlignJudge {
  judge(input: { order: string; anchor: AlignmentAnchor }): Promise<AlignmentVerdict>;
}

/** The named options the choice question offers, and the exact strings a note must pick from. */
export const ALIGNED = "aligned";
export const MISALIGNED = "misaligned";

/** The stance the judge is given. Fixed text: the anchor and the order are the only variables. */
const STANCE =
  "You are routing work. Decide whether the ORDER below is work the TASK below can accept, or work for a different task. " +
  "Answer aligned only when the order's subject is the task's goal; answer misaligned when it asks for different work, " +
  "a different artefact, or a different stage. Judge the order's content, not its tone or length.";

/** The order's digest, so a refusal or a flag can name it without keeping the text. */
export function orderDigestOf(order: string): string {
  return digest(order);
}

/**
 * Read a `choice` answer strictly. pi-jev already validates that the choice is one of the
 * criteria keys; anything else here (a different answer type, an unexpected value) throws rather
 * than guessing, and `judgeOrder` turns that throw into `unavailable`.
 */
function choiceOf(answer: Answer | undefined, id: string): string {
  if (answer === undefined || answer.type !== "choice") {
    throw new Error("jev answer " + JSON.stringify(id) + " is not a choice");
  }
  const choice = (answer as ChoiceAnswer).choice;
  if (choice !== ALIGNED && choice !== MISALIGNED) {
    throw new Error("jev answer " + JSON.stringify(id) + " picked an unknown option " + JSON.stringify(choice));
  }
  return choice;
}

export interface JevAlignOptions {
  /** The pi-jev call. A test injects a fake here; a real run uses pi-jev's own `evaluate`. */
  evaluateFn?: typeof evaluate;
  /** Model override; pi-jev's own precedence applies when absent. */
  model?: string;
}

/**
 * The `AlignJudge` backed by pi-jev: ONE `choice` question keyed `alignment` with two named
 * criteria, the anchor and the order carried in `state`. A pi-jev throw is not caught here;
 * `judgeOrder` owns the `unavailable` mapping, exactly as `evaluateArtifact` owns the scorer's.
 */
export function jevAlignJudge(opts: JevAlignOptions = {}): AlignJudge {
  const run = opts.evaluateFn ?? evaluate;
  return {
    async judge({ order, anchor }) {
      const questions = {
        alignment: {
          type: "choice" as const,
          instructions:
            STANCE +
            " TASK goal: " + anchor.goal +
            (anchor.role === undefined ? "" : " (role: " + anchor.role + ")") +
            " Step: " + anchor.step + " of " + anchor.flow + ", producing " + anchor.produces + ". ORDER:",
          criteria: {
            [ALIGNED]: "the order asks for the task's own goal, at this step",
            [MISALIGNED]: "the order asks for different work, a different artefact, or a different stage",
          },
        },
      };
      const request: JevRequest = { state: { order, anchor }, questions, model: opts.model };
      const response = await run(request);
      const choice = choiceOf(response.answers.alignment, "alignment");
      const confidence = (response.answers.alignment as ChoiceAnswer).confidence;
      return {
        decision: choice === ALIGNED ? "aligned" : "misaligned",
        reason:
          (choice === ALIGNED ? "the order matches the task's goal" : "the order does not match the task's goal") +
          (typeof confidence === "number" ? " (confidence " + confidence.toFixed(2) + ")" : ""),
        model: response.model,
        orderDigest: orderDigestOf(order),
      };
    },
  };
}

/**
 * Run the judge and normalize its result: any throw, timeout or unreadable answer becomes
 * `unavailable` with the cause in the reason. This is the ONLY place the fail-open decision is
 * made, so it is one line to change if the owner ever wants a hard gate.
 */
export async function judgeOrder(
  judge: AlignJudge,
  input: { order: string; anchor: AlignmentAnchor },
): Promise<AlignmentVerdict> {
  try {
    const verdict = await judge.judge(input);
    if (verdict.decision !== "aligned" && verdict.decision !== "misaligned" && verdict.decision !== "unavailable") {
      throw new Error("judge returned an unknown decision " + JSON.stringify(verdict.decision));
    }
    return verdict;
  } catch (error) {
    return {
      decision: "unavailable",
      reason: "judge unavailable: " + (error instanceof Error ? error.message : String(error)),
      model: "unavailable",
      orderDigest: orderDigestOf(input.order),
    };
  }
}

/** The task anchor of a start, read from the flow document that start would pin (spec D2). */
export function anchorOf(flow: OpenedFlow): AlignmentAnchor {
  const first = flow.config.nodes[0];
  if (first === undefined) {
    throw new Error("flow " + JSON.stringify(flow.config.flow) + " declares no nodes");
  }
  const task = flow.tasks.get(first.task);
  if (task === undefined) {
    throw new Error("flow " + JSON.stringify(flow.config.flow) + " names an unresolved task " + JSON.stringify(first.task));
  }
  return {
    flow: flow.config.flow,
    flowDigest: flow.flowDigest,
    step: first.id,
    goal: task.goal,
    ...(task.role === undefined ? {} : { role: task.role }),
    produces: task.produces.schema,
  };
}

/** What the visible flag looks like when the judge could not answer (spec D3a). */
export interface AlignmentFlag {
  decision: "unchecked";
  reason: string;
  orderDigest: string;
}

/** The clause appended to the existing `summary` string, so the parent sees it without a new key. */
export function uncheckedClause(verdict: AlignmentVerdict): string {
  return "; alignment unchecked: " + verdict.reason;
}
