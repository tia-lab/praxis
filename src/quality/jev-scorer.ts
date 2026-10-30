/**
 * The real quality scorer: pi-jev's typed `noul` judgment over a task's rubric.
 *
 * One `noul` question per rubric dimension, keyed by the dimension id, in one request; each
 * answer is the probability the artifact fully satisfies that dimension's statement. pi-jev
 * validates that every question id carries one matching answer, so a missing dimension is a
 * throw, never a fabricated score, and `evaluateArtifact` turns that throw into a fail-closed
 * `error` verdict. There is no threshold, aggregation or retry here: the engine owns MIN and
 * the floor. The TypeSafe credential is read by pi-jev itself; it is never read, held or
 * logged in Praxis, and no domain logic lives in this file beyond the mapping.
 */
import { evaluate } from "pi-jev";
import type { Answer, JevRequest } from "pi-jev";
import type { Scorer } from "./evaluate.ts";

/** The instruction each dimension question carries; the dimension's statement is appended. */
const JUDGE = "Judge the artifact strictly against this standard; answer the probability it is fully satisfied: ";

export interface JevScorerOptions {
  /** The pi-jev call. A test injects a fake here; a real run uses pi-jev's own `evaluate`. */
  evaluateFn?: typeof evaluate;
  /** Model override; pi-jev's own precedence (opts, request, default) applies when absent. */
  model?: string;
}

/** pi-jev guarantees a matching answer per question id; anything else is a validation regression. */
function noulOf(answer: Answer, id: string): number {
  if (answer.type !== "noul") {
    throw new Error("jev answer " + JSON.stringify(id) + " is not a noul");
  }
  return answer.noul;
}

/**
 * The `Scorer` port backed by pi-jev. A pi-jev throw is not caught here: `evaluateArtifact`
 * already degrades a throw to `error`, so a required floor stays fail-closed.
 */
export function jevScorer(opts: JevScorerOptions = {}): Scorer {
  const run = opts.evaluateFn ?? evaluate;
  return {
    async score({ goal, rubric, artifact, subjectDigest }) {
      const questions = Object.fromEntries(
        rubric.map((dimension) => [
          dimension.id,
          { type: "noul" as const, instructions: JUDGE + dimension.statement },
        ]),
      );
      const request: JevRequest = { state: { goal, artifact, subjectDigest }, questions, model: opts.model };
      const response = await run(request);
      const dimensions = rubric.map((dimension) => ({
        id: dimension.id,
        score: noulOf(response.answers[dimension.id], dimension.id),
      }));
      return {
        dimensions,
        rationale: response.model + " noul: " + dimensions.map((d) => d.id + "=" + d.score.toFixed(2)).join(", "),
        scorer: response.model,
      };
    },
  };
}
