/**
 * The real quality scorer: pi-jev's typed judgment over a task's rubric, in ONE request.
 *
 * A dimension that declares criteria (the probes the task author wrote) is COMPOSED from them: one
 * question per criterion, in the same request as the witness `noul` that asks whether the statement
 * holds. The composed score is the MINIMUM per-criterion satisfaction, with code-owned arithmetic
 * (task-self-improvement D3, D4, D6):
 *
 *   noul   -> its probability
 *   score  -> position / (levels - 1)
 *   choice -> 1 iff the declared clean option was answered
 *
 * The witness is recorded (`statementScore`) and never gates (D5); the criterion that produced the
 * minimum is recorded (`bound`); the why is rendered from those same answers, so the verdict and its
 * explanation cannot disagree. The second, explain-only pass is retired (D7): there is one rubric and
 * one call. A dimension with NO criteria is judged exactly as before — its statement `noul` is the
 * score — so the eleven criteria-less tasks keep their scale byte-identically (O7).
 *
 * pi-jev validates that every question id carries one matching answer, and every answer is read
 * strictly here: a missing or mistyped criterion answer is a throw, never a fabricated score, and
 * `evaluateArtifact` turns that throw into a fail-closed `error` verdict. The TypeSafe credential is
 * read by pi-jev itself; no domain logic lives in this file beyond the reading and the arithmetic.
 */
import { evaluate } from "pi-jev";
import type { Answer, JevRequest, Question } from "pi-jev";
import type { Probe } from "../types/quality.ts";
import { TORN_CLEAN_BAND, TORN_NOUL_BAND, TORN_SPREAD } from "../runner/engine/types.ts";
import type { CriterionAnswer, DimensionJudgment, Scorer } from "./evaluate.ts";

/** The instruction the WITNESS question carries; the dimension's statement is appended (unchanged). */
const JUDGE = "Judge the artifact strictly against this standard; answer the probability it is fully satisfied: ";

/** The witness's id suffix: one flat namespace with the criteria, so a dimension id is never reused. */
const WITNESS = "__statement";

/** How far the witness may sit from the composed score before it is recorded as divergent (D5, R7). */
export const DIVERGENCE_MIN = 0.2;

/** The rendered line's bound per dimension (kept from verdict-rationale D7). */
export const RATIONALE_MAX = 240;
/** How many non-clean criteria one line may name. */
export const RATIONALE_MAX_CLAUSES = 3;
/** The divergence wording (verdict-rationale D11): clean criteria over a low score indict the statement. */
export const RATIONALE_DIVERGENCE =
  "/ the score is below the bar but every criterion is clean: the dimension statement may be too vague";

export interface JevScorerOptions {
  /** The pi-jev call. A test injects a fake here; a real run uses pi-jev's own `evaluate`. */
  evaluateFn?: typeof evaluate;
  /** Model override; pi-jev's own precedence (opts, request, default) applies when absent. */
  model?: string;
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);
const clip = (text: string, limit: number): string => (text.length <= limit ? text : text.slice(0, limit - 1) + "\u2026");

/** One criterion's question id: the dimension and the criterion in one flat namespace (D5). */
const criterionKey = (dimensionId: string, criterionId: string): string => dimensionId + "." + criterionId;

/** pi-jev guarantees a matching answer per question id; anything else is a validation regression. */
function noulOf(answer: Answer | undefined, id: string): number {
  if (answer === undefined || answer.type !== "noul") {
    throw new Error("jev answer " + JSON.stringify(id) + " is not a noul");
  }
  return answer.noul;
}

/** One section as the task declares it: the id a criterion targets, and the judge-facing intent. */
export interface SectionIntent {
  id: string;
  goal?: string;
  rationale?: string;
}

/** The task's own intent, as the judge is told it. */
export interface TaskIntent {
  goal: string;
  rationale?: string;
  scope?: string;
}

/** A request-bound bound on the composed strings: the prefix adds at most a few hundred bytes per question. */
const COMPOSED_MAX = 4096;
const clipTo = (text: string, limit: number): string => (text.length <= limit ? text : text.slice(0, limit - 1) + "\u2026");

/**
 * The goal every question in the request shares (T3, R12): the ORDER first, then the task's own intent.
 *
 * With no order and no rationale/scope there is nothing to add, so the task's goal is returned VERBATIM
 * - which is what keeps an unanchored call byte-identical to the request this adapter sent before
 * (R19). The labels are added only when something is actually composed.
 */
export function composeGoal(order: string | undefined, task: TaskIntent): string {
  const lines: string[] = [];
  const trimmed = order === undefined ? "" : order.trim();
  if (trimmed !== "") lines.push(clipTo(trimmed, 4000));
  if (lines.length === 0 && task.rationale === undefined && task.scope === undefined) return task.goal;
  lines.push("Task: " + clipTo(task.goal, 1000));
  if (task.rationale !== undefined) lines.push("Why: " + clipTo(task.rationale, 1000));
  if (task.scope !== undefined) lines.push("Scope: " + clipTo(task.scope, 1000));
  return clipTo(lines.join("\n"), COMPOSED_MAX);
}

/**
 * One criterion's question when it TARGETS sections (T3, R13): the question itself says which
 * sections to judge and what those sections are for, so ONE request can carry differently scoped
 * questions without slicing the artifact. A probe with no sections never reaches this function.
 */
export function composeQuestion(sections: readonly SectionIntent[], probe: Pick<Probe, "instructions">): string {
  const ids = sections.map((section) => section.id).join("+");
  const goals = sections.flatMap((section) => (section.goal === undefined ? [] : [section.goal]));
  const whys = sections.flatMap((section) => (section.rationale === undefined ? [] : [section.rationale]));
  const about = goals.length === 0 ? "" : " (" + goals.join("; ") + (whys.length === 0 ? "" : ". Why: " + whys.join("; ")) + ")";
  return clipTo("Judge ONLY the " + ids + " section(s)" + about + ". Criterion: " + probe.instructions, COMPOSED_MAX);
}

/**
 * The ONE `choice` question builder (verdict rationale + branch routing). A branch decision asks the
 * same typed question a `choice` probe does, so it is built here once and shared, never re-shaped in
 * the router (R9). The probe's own instructions and options are carried verbatim.
 */
export function choiceQuestion(instructions: string, criteria: Record<string, string>): Question {
  return { type: "choice", instructions, criteria };
}

/** The question a criterion asks: its own authored type, instructions and options, unchanged. */
function questionOf(probe: Probe): Question {
  if (probe.type === "choice") {
    return choiceQuestion(probe.instructions, probe.criteria as Record<string, string>);
  }
  if (probe.type === "score") {
    return { type: "score", instructions: probe.instructions, criteria: probe.criteria as string[] };
  }
  return { type: "noul", instructions: probe.instructions };
}

/**
 * Read one criterion answer strictly: the declared type, an option the criterion names, a level on
 * its scale, a finite probability. Anything else throws, so a required floor stays fail-closed (R6).
 */
function readAnswer(answer: Answer | undefined, key: string, probe: Probe): { value: string | number; answer: Answer } {
  const label = "jev answer " + JSON.stringify(key);
  if (answer === undefined || answer.type !== probe.type) throw new Error(label + " is missing or mistyped");
  if (answer.type === "choice") {
    const options = probe.criteria;
    const known = typeof options === "object" && options !== null && !Array.isArray(options) &&
      Object.prototype.hasOwnProperty.call(options, answer.choice);
    if (!known) throw new Error(label + " picked an unknown option");
    return { value: answer.choice, answer };
  }
  if (answer.type === "score") {
    const levels = Array.isArray(probe.criteria) ? probe.criteria.length : 0;
    if (!Number.isFinite(answer.score) || answer.score < 0 || answer.score > levels - 1) {
      throw new Error(label + " is off its scale");
    }
    return { value: answer.score, answer };
  }
  if (!Number.isFinite(answer.noul)) throw new Error(label + " is not a finite probability");
  return { value: clamp01(answer.noul), answer };
}

/**
 * The judge's own uncertainty for one criterion (S2, R15-R17), read from what pi-jev actually
 * returned and NOTHING more. A `choice`/`score` answer carries a distribution after slice 0: its
 * spread (1 − max p), P(clean) for a choice, P(top level) for a score, and any `confidence`. A
 * `noul` returns ONE probability, so it records no mass and no confidence, ever (D9) — its only
 * signal is the value's distance from 0.5. A map that does not sum to 1 is treated as ABSENT rather
 * than normalised by guesswork (plan K8), and absent mass is never zero-filled.
 *
 * This is disclosure only: the score was already computed from the answer, and mass never touches it.
 */
function uncertaintyOf(probe: Probe, answer: Answer, value: string | number): { fields: Omit<CriterionAnswer, "probe" | "answer">; torn: boolean } {
  if (answer.type === "noul") {
    const p = typeof value === "number" ? value : 0;
    return { fields: {}, torn: p >= TORN_NOUL_BAND[0] && p <= TORN_NOUL_BAND[1] };
  }
  const fields: Omit<CriterionAnswer, "probe" | "answer"> = {};
  if (answer.confidence !== undefined) fields.confidence = answer.confidence;
  const mass = answer.probabilities;
  if (mass === undefined) return { fields, torn: false };
  const values = Array.isArray(mass) ? mass : Object.values(mass);
  if (values.length === 0) return { fields, torn: false };
  const sum = values.reduce((total, p) => total + p, 0);
  if (sum < 0.99 || sum > 1.01) return { fields, torn: false };
  const peak = Math.max(...values);
  fields.spread = 1 - peak;
  const pClean = answer.type === "choice" && probe.clean !== undefined
    ? (mass as Record<string, number>)[probe.clean]
    : undefined;
  if (pClean !== undefined) fields.pClean = pClean;
  fields.pTop = answer.type === "score" ? values[values.length - 1]! : peak;
  const torn = fields.spread > TORN_SPREAD ||
    (pClean !== undefined && pClean >= TORN_CLEAN_BAND[0] && pClean <= TORN_CLEAN_BAND[1]);
  return { fields, torn };
}

/** How fully one criterion is satisfied, in [0,1] (D4). `choice` is categorical, never mass-weighted. */
function satisfactionOf(probe: Probe, answer: string | number): number {
  if (probe.type === "noul") return typeof answer === "number" ? clamp01(answer) : 0;
  if (probe.type === "score") {
    const levels = Array.isArray(probe.criteria) ? probe.criteria.length : 1;
    return typeof answer === "number" && levels > 1 ? clamp01(answer / (levels - 1)) : 0;
  }
  return typeof answer === "string" && probe.clean !== undefined && answer === probe.clean ? 1 : 0;
}

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
 * meaning, a score's level, or — for a noul — the criterion's own ask. Nothing is invented.
 */
function clauseOf(probe: Probe, answer: string | number): string | undefined {
  if (probe.type === "choice" && typeof answer === "string" && typeof probe.criteria === "object" && probe.criteria !== null && !Array.isArray(probe.criteria)) {
    return probe.criteria[answer];
  }
  if (probe.type === "score" && typeof answer === "number" && Array.isArray(probe.criteria)) {
    return probe.criteria[answer];
  }
  if (probe.type === "noul") return "not satisfied: " + probe.instructions.trim();
  return undefined;
}

/**
 * Render one dimension's why from the answers that produced its score (R9): the BINDING criterion
 * first, then the other non-clean ones in declared order, at most RATIONALE_MAX_CLAUSES clauses and
 * RATIONALE_MAX characters. Deterministic — the same answers always render the same string — and an
 * answer that is clean, missing or unknown is omitted, never paraphrased. Returns undefined when
 * nothing is worth saying; the divergence line belongs to the caller that knows the bar.
 */
export function rationaleFrom(
  dimension: { id: string; probes?: readonly Probe[] },
  answers: readonly CriterionAnswer[],
  binding?: string,
): string | undefined {
  const probes = dimension.probes ?? [];
  const byId = new Map(answers.map((entry) => [entry.probe, entry.answer]));
  const ordered = binding === undefined ? probes : [
    ...probes.filter((probe) => probe.id === binding),
    ...probes.filter((probe) => probe.id !== binding),
  ];
  const clauses: string[] = [];
  for (const probe of ordered) {
    const answer = byId.get(probe.id);
    if (answer === undefined || isClean(probe, answer)) continue;
    const clause = clauseOf(probe, answer);
    if (clause === undefined || clause.trim() === "") continue;
    clauses.push(clip(clause.trim(), 160));
    if (clauses.length >= RATIONALE_MAX_CLAUSES) break;
  }
  if (clauses.length === 0) return undefined;
  return clip(dimension.id + ": " + clauses.join("; "), RATIONALE_MAX);
}

/**
 * The `Scorer` port backed by pi-jev. A pi-jev throw is not caught here: `evaluateArtifact` already
 * degrades a throw to `error`, so a required floor stays fail-closed.
 */
export function jevScorer(opts: JevScorerOptions = {}): Scorer {
  const run = opts.evaluateFn ?? evaluate;
  return {
    async score({ goal, rubric, artifact, subjectDigest, context }) {
      // ONE request (R10): every criterion of every composed dimension, plus one witness per
      // dimension. A dimension without criteria keeps today's question, keyed by its own id.
      // T3: ONE request, exactly today's shape. The only things that can differ are the composed GOAL
      // and a targeted criterion's own instruction text; the subject is never sliced.
      const intents = new Map((context?.sections ?? []).map((section) => [section.id, section] as const));
      const questions: Record<string, Question> = {};
      for (const dimension of rubric) {
        const probes = dimension.probes ?? [];
        if (probes.length === 0) {
          questions[dimension.id] = { type: "noul", instructions: JUDGE + dimension.statement };
          continue;
        }
        for (const probe of probes) {
          const key = criterionKey(dimension.id, probe.id);
          if (probe.sections === undefined) {
            // Untargeted: today's question, verbatim (R14").
            questions[key] = questionOf(probe);
            continue;
          }
          const targets = probe.sections.map((id) => intents.get(id) ?? { id });
          questions[key] = { ...questionOf(probe), instructions: composeQuestion(targets, probe) };
        }
        questions[dimension.id + "." + WITNESS] = { type: "noul", instructions: JUDGE + dimension.statement };
      }
      const composed = composeGoal(context?.order, { goal, ...(context?.task ?? {}) });
      const request: JevRequest = { state: { goal: composed, artifact, subjectDigest }, questions, model: opts.model };
      const response = await run(request);

      const dimensions: DimensionJudgment[] = rubric.map((dimension) => {
        const probes = dimension.probes ?? [];
        if (probes.length === 0) {
          // No criteria: the statement judges, exactly as it did before this slice (O7).
          return { id: dimension.id, score: noulOf(response.answers[dimension.id], dimension.id) };
        }
        const answers: CriterionAnswer[] = [];
        const torn: string[] = [];
        let bound = probes[0]!.id;
        let weakest = Number.POSITIVE_INFINITY;
        let allClean = true;
        for (const probe of probes) {
          const key = criterionKey(dimension.id, probe.id);
          const { value: answer, answer: raw } = readAnswer(response.answers[key], key, probe);
          const uncertainty = uncertaintyOf(probe, raw, answer);
          // The target is recorded with the answer, so the verdict shows WHAT was judged (R17).
          answers.push({
            probe: probe.id,
            answer,
            ...(probe.sections === undefined ? {} : { sections: [...probe.sections] }),
            ...uncertainty.fields,
          });
          if (uncertainty.torn) torn.push(probe.id);
          const satisfaction = satisfactionOf(probe, answer);
          // Strictly less: the FIRST criterion in declared order wins a tie (R8).
          if (satisfaction < weakest) {
            weakest = satisfaction;
            bound = probe.id;
          }
          if (allClean && !isClean(probe, answer)) allClean = false;
        }
        const composed = clamp01(weakest);
        const statementScore = clamp01(noulOf(response.answers[dimension.id + "." + WITNESS], dimension.id + "." + WITNESS));
        const rationale = rationaleFrom({ id: dimension.id, probes }, answers, bound);
        return {
          id: dimension.id,
          score: composed,
          bound,
          statementScore,
          ...(Math.abs(statementScore - composed) >= DIVERGENCE_MIN ? { divergence: true } : {}),
          diagnosis: answers,
          ...(torn.length === 0 ? {} : { torn }),
          ...(rationale === undefined ? {} : { rationale }),
          allClean,
        };
      });
      return {
        dimensions,
        rationale: response.model + " composed: " + dimensions.map((d) => d.id + "=" + d.score.toFixed(2)).join(", "),
        scorer: response.model,
      };
    },
  };
}
