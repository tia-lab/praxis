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
import type { Answer, JevRequest, Question } from "pi-jev";
import type { Probe } from "../types/schema.ts";
import type { ExplainedDimension, Scorer } from "./evaluate.ts";

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
    // The explain-only battery (D3): one call over the rubric's probes, rendered, never scored.
    explain: jevBattery(opts),
  };
}

// ---------------------------------------------------------------------------------------------
// The explain-only battery (verdict-rationale D3-D7, D11).
//
// The scoring call above is untouched: this pass asks every dimension's PROBES in ONE request and
// renders the pattern of answers into a bounded line. It sees no score and changes none; a throw, a
// timeout or an unreadable answer costs the why, never the verdict.
// ---------------------------------------------------------------------------------------------

/** The rendered line's bound per dimension (spec D7). */
export const RATIONALE_MAX = 240;
/** How many non-clean probes one line may name. */
export const RATIONALE_MAX_CLAUSES = 3;
/** The divergence clause (D11): a low score over clean probes points at the statement, not the work. */
export const RATIONALE_DIVERGENCE =
  "/ the score is below the bar but every probe is clean: the dimension statement may be too vague";

/** pi-jev's own protocol bounds (node_modules/pi-jev/src/client.ts:5,34), enforced before we call. */
const JEV_MAX_QUESTIONS = 128;
const JEV_MAX_REQUEST_BYTES = 262_144;

const clipRationale = (text: string, limit: number): string => (text.length <= limit ? text : text.slice(0, limit - 1) + "\u2026");

/** One probe's question id: the dimension and the probe in one flat namespace (D5). */
const probeKeyOf = (dimensionId: string, probeId: string): string => dimensionId + "." + probeId;

/** Is this answer the clean one? choice: the declared option; noul: >= 0.5; score: the top level. */
function isClean(probe: Probe, answer: string | number): boolean {
  if (probe.type === "noul") return typeof answer === "number" && answer >= 0.5;
  if (probe.type === "score") {
    return typeof answer === "number" && Array.isArray(probe.criteria) && answer >= probe.criteria.length - 1;
  }
  return typeof answer === "string" && probe.clean !== undefined && answer === probe.clean;
}

/**
 * The actionable clause for one non-clean answer, taken from the AUTHORED text: a choice's option
 * meaning, a score's level, or — for a noul — the probe's own ask. Nothing is invented.
 */
function clauseOf(probe: Probe, answer: string | number): string | undefined {
  if (probe.type === "choice" && typeof answer === "string" && !Array.isArray(probe.criteria)) {
    return probe.criteria === undefined ? undefined : probe.criteria[answer];
  }
  if (probe.type === "score" && typeof answer === "number" && Array.isArray(probe.criteria)) {
    return probe.criteria[answer];
  }
  if (probe.type === "noul") return "not satisfied: " + probe.instructions.trim();
  return undefined;
}

/**
 * Render one dimension's line: the dimension id, then one clause per non-clean probe (at most
 * RATIONALE_MAX_CLAUSES), clipped to RATIONALE_MAX — or, when every probe is clean and the dimension
 * still fell short, the divergence clause (D11). Deterministic: the same answers always render the
 * same string. A probe whose answer is missing or unknown is OMITTED, never invented.
 */
export function rationaleFor(
  dimension: { id: string; probes?: readonly Probe[] },
  answers: readonly { probe: string; answer: string | number }[],
  weak: boolean,
): string | undefined {
  const probes = dimension.probes ?? [];
  const byId = new Map(answers.map((entry) => [entry.probe, entry.answer]));
  const clauses: string[] = [];
  for (const probe of probes) {
    const answer = byId.get(probe.id);
    if (answer === undefined || isClean(probe, answer)) continue;
    const clause = clauseOf(probe, answer);
    if (clause === undefined || clause.trim() === "") continue;
    clauses.push(clipRationale(clause.trim(), 160));
    if (clauses.length >= RATIONALE_MAX_CLAUSES) break;
  }
  if (clauses.length === 0) {
    // Nothing the battery flags; if the SCORE still fell short, say what that most likely means.
    return weak && probes.length > 0 ? clipRationale(dimension.id + ": " + RATIONALE_DIVERGENCE, RATIONALE_MAX) : undefined;
  }
  return clipRationale(dimension.id + ": " + clauses.join("; "), RATIONALE_MAX);
}

/** The explain pass itself: ONE request over every dimension's probes, answers read strictly. */
export function jevBattery(opts: JevScorerOptions = {}): NonNullable<Scorer["explain"]> {
  const run = opts.evaluateFn ?? evaluate;
  return async ({ goal, rubric, artifact, subjectDigest, weak }) => {
    const questions: Record<string, Question> = {};
    const byDimension = new Map<string, readonly Probe[]>();
    for (const dimension of rubric) {
      const probes = dimension.probes ?? [];
      if (probes.length === 0) continue;
      byDimension.set(dimension.id, probes);
      for (const probe of probes) {
        const id = probeKeyOf(dimension.id, probe.id);
        // The probe schema already guarantees the shape each type needs (choice: a criteria map,
        // score: 2-10 levels, noul: neither), so these narrowings cannot fail at runtime.
        if (probe.type === "choice") {
          questions[id] = {
            type: "choice",
            instructions: probe.instructions,
            criteria: probe.criteria as Record<string, string>,
          };
        } else if (probe.type === "score") {
          questions[id] = { type: "score", instructions: probe.instructions, criteria: probe.criteria as string[] };
        } else {
          questions[id] = { type: "noul", instructions: probe.instructions };
        }
      }
    }
    if (Object.keys(questions).length === 0) return { dimensions: [], scorer: "jev" };
    const request: JevRequest = {
      state: { goal, artifact, ...(subjectDigest === undefined ? {} : { subjectDigest }) },
      questions,
      ...(opts.model === undefined ? {} : { model: opts.model }),
    };
    // Guard before the call: a rubric that would overflow the protocol skips the why, not the verdict.
    if (Object.keys(questions).length > JEV_MAX_QUESTIONS) {
      throw new Error("the probe battery exceeds " + JEV_MAX_QUESTIONS + " questions");
    }
    if (JSON.stringify(request).length > JEV_MAX_REQUEST_BYTES) {
      throw new Error("the probe battery request exceeds " + JEV_MAX_REQUEST_BYTES + " bytes");
    }
    const response = await run(request);
    const explained: ExplainedDimension[] = [];
    for (const [dimensionId, probes] of byDimension) {
      const answers = probes.map((probe) => {
        const answer = response.answers[probeKeyOf(dimensionId, probe.id)];
        // All-or-nothing: one unreadable answer makes the whole battery unavailable (R4).
        if (answer === undefined || answer.type !== probe.type) {
          throw new Error("jev answer " + JSON.stringify(probeKeyOf(dimensionId, probe.id)) + " is missing or mistyped");
        }
        if (answer.type === "choice") {
          if (!isRecordWith(probe.criteria, answer.choice)) {
            throw new Error("jev answer " + JSON.stringify(probeKeyOf(dimensionId, probe.id)) + " picked an unknown option");
          }
          return { probe: probe.id, answer: answer.choice };
        }
        if (answer.type === "score") {
          if (!Array.isArray(probe.criteria) || answer.score < 0 || answer.score > probe.criteria.length - 1) {
            throw new Error("jev answer " + JSON.stringify(probeKeyOf(dimensionId, probe.id)) + " is off its scale");
          }
          return { probe: probe.id, answer: answer.score };
        }
        if (!Number.isFinite(answer.noul)) {
          throw new Error("jev answer " + JSON.stringify(probeKeyOf(dimensionId, probe.id)) + " is not a finite probability");
        }
        return { probe: probe.id, answer: Math.min(1, Math.max(0, answer.noul)) };
      });
      const rationale = rationaleFor({ id: dimensionId, probes }, answers, weak.includes(dimensionId));
      explained.push({ id: dimensionId, diagnosis: answers, ...(rationale === undefined ? {} : { rationale }) });
    }
    return { dimensions: explained, scorer: response.model };
  };
}

/** A choice answer is valid only if the probe's criteria map declares it. */
function isRecordWith(criteria: unknown, key: string): boolean {
  return typeof criteria === "object" && criteria !== null && !Array.isArray(criteria) && Object.prototype.hasOwnProperty.call(criteria, key);
}
