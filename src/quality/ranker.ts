/**
 * The bounded experience query (P7): "which solved cases in THIS project store resemble what I am
 * stuck on?", answered deterministically, bounded, with provenance.
 *
 * Shape: `collectCases` assembles the solved cases from the event log (read-only), each carrying the
 * bar context it was judged under; a `RankerPort` ranks them (the deterministic implementation here
 * reuses the brief's ONE scorer, `scoreCandidate`, with the caller's need tags as the cover set); the
 * result is bounded before it leaves.
 *
 * Boundary: one store, read-only, no federation. The port exists so a jev-relevance ranker can be
 * dropped in later as an opt-in — it is NOT built here and jev-search is not a dependency.
 */
import { LearningNoteSchema } from "../types/learning.ts";
import { parseWith, TaskConfigSchema, type TaskConfig } from "../types/schema.ts";
import type { Store } from "../store/db.ts";
import { readDefinition } from "../store/definitions.ts";
import { loadInstance } from "../store/instance.ts";
import { assertObserver } from "../runner/engine/authority.ts";
import { loadPinnedFlow } from "../runner/engine/flow.ts";
import { withStore } from "../runner/engine/support.ts";
import { EVENT } from "../runner/engine/types.ts";
import type { EngineOptions } from "../runner/engine/types.ts";
import { scanEvents } from "./bar.ts";
import { scoreCandidate } from "./recall.ts";

/** What the agent says it needs, in its own words plus the dimensions it wants covered. */
export interface QueryNeed {
  text: string;
  /** Rubric dimension ids; the caller may default these to its current step's. */
  tags: readonly string[];
}

/** The bar context a case was judged under, so a pure port can score it without a store. */
export interface CaseSignals {
  /** The global bar in force when the case's artifact was judged. */
  barThen: number;
  /** How many bar levels were raised for that task after the case. */
  levels: number;
  /** Independent agents (besides the author) who tagged each dimension across the store. */
  corroborationBy: Map<string, number>;
}

/** One solved case: an accepted artifact, its judgment, and the lesson recorded for it. */
export interface ExperienceCase {
  instance: string;
  task: string;
  taskVersion: number;
  step: string;
  version: number;
  digest: string;
  outcome: "pass";
  score: number;
  mean: number;
  flagged: string[];
  writtenBy: string;
  at: string;
  lesson: { whatWrong: string; whatRight: string; whatBetter: string; tags: { dimension: string; lesson: string }[] };
  /** The recorded per-dimension rationale of this case's verdict, keyed by dimension id (D12c). */
  rationales: Map<string, string>;
  /** Not returned to the caller; the ranking's inputs only. */
  signals: CaseSignals;
}

/** One ranked case: the case, the weighted score, the signal breakdown and why it won. */
export interface RankedCase extends ExperienceCase {
  /** The ONE relevant dimension's rationale for this query, when the verdict has one (D12c). */
  rationale?: string;
  score2: number;
  relevance: { need: number; outcome: number; corroboration: number; recency: number; margin: number };
  reason: string;
}

/** The port. A test injects a fake; a jev-relevance ranker is a future drop-in behind this shape. */
export interface RankerPort {
  rank(input: { need: QueryNeed; candidates: readonly ExperienceCase[] }): RankedCase[];
}

const clip = (text: string, limit: number): string => (text.length <= limit ? text : text.slice(0, limit - 1) + "\u2026");

/**
 * The rationale to show for a case: the ONE relevant dimension's — the first query tag whose verdict
 * carries one, in the caller's tag order (refusal passes the refused set, the brief its rubric). No
 * fallback to another dimension: showing the wrong dimension's why would be worse than none (D12c).
 */
function relevantRationale(tags: readonly string[], rationales: Map<string, string>): string | undefined {
  for (const tag of tags) {
    const line = rationales.get(tag);
    if (line !== undefined) return line;
  }
  return undefined;
}

/** The rough token cost of one lesson, used only to respect the payload budget. */
function lessonTokens(candidate: ExperienceCase): number {
  const rationale = (candidate as { rationale?: string }).rationale;
  const chars =
    candidate.lesson.whatWrong.length +
    candidate.lesson.whatRight.length +
    candidate.lesson.whatBetter.length +
    candidate.lesson.tags.reduce((sum, tag) => sum + tag.lesson.length + tag.dimension.length, 0) +
    // The exemplar's rationale travels with it, so the budget must count it (D12c).
    (rationale === undefined ? 0 : rationale.length);
  return Math.ceil(chars / 4) + 8;
}

/**
 * The deterministic ranker: the brief's own scorer with the caller's need standing in for the
 * weak-set. Nothing new is invented — same weights, same signals, same tie-break — so a query and
 * the brief can never disagree about what "relevant" means.
 */
export function deterministicRanker(): RankerPort {
  return {
    rank({ need, candidates }) {
      const ranked = candidates.map((candidate) => {
        const scored = scoreCandidate({
          cover: need.tags,
          tags: candidate.lesson.tags,
          outcome: candidate.outcome,
          hasBetter: candidate.lesson.whatBetter.trim() !== "",
          score: candidate.score,
          barThen: candidate.signals.barThen,
          levels: candidate.signals.levels,
          author: candidate.writtenBy,
          corroborationAgents: (dimension) => candidate.signals.corroborationBy.get(dimension) ?? 0,
        });
        const breakdown = scored.breakdown;
        const strongest = (["coverage", "outcome", "corroboration", "recency", "margin"] as const)
          .map((name) => ({ name, value: breakdown[name] }))
          .sort((left, right) => right.value - left.value || left.name.localeCompare(right.name))[0];
        // The ONE relevant dimension's rationale: the first query tag this verdict explains (D12c).
        const rationale = relevantRationale(need.tags, candidate.rationales);
        return {
          ...candidate,
          ...(rationale === undefined ? {} : { rationale }),
          score2: scored.relevance,
          relevance: {
            need: breakdown.coverage,
            outcome: breakdown.outcome,
            corroboration: breakdown.corroboration,
            recency: breakdown.recency,
            margin: breakdown.margin,
          },
          reason: strongest.name + "=" + strongest.value.toFixed(2),
        };
      });
      return ranked.sort(
        (left, right) => right.score2 - left.score2 || left.instance.localeCompare(right.instance) || left.step.localeCompare(right.step),
      );
    },
  };
}

/** The injected port: a test replaces it, `undefined` restores the deterministic ranker. */
let rankerOverride: RankerPort | undefined;

/** Replace the ranker; `undefined` restores the deterministic one. */
export function setRankerForTest(ranker: RankerPort | undefined): void {
  rankerOverride = ranker;
}

/** The stage-1 ranker in force: the injected one in a test, the deterministic one otherwise. */
export function activeRanker(): RankerPort {
  return rankerOverride ?? deterministicRanker();
}

/** The task document a case's instance pinned, so its bars are that task's own. */
function pinnedQuality(store: Store, instance: string, task: string): TaskConfig["quality"] | undefined {
  try {
    const row = readDefinition(store, instance, "task", task);
    return parseWith(TaskConfigSchema, JSON.parse(Buffer.from(row.bytes).toString("utf8")), "PIN_CORRUPT", "pinned task").quality;
  } catch {
    return undefined;
  }
}

/**
 * Every solved case in the store, oldest first. A solved case is an `artifact.accepted` with no
 * `failed` marker, a recorded verdict for that version, and a learning note with a SUBJECTIVE part —
 * a stub note has no lesson, a continued-FAILED acceptance is not a solution, and an acceptance with
 * no note cannot say what was learned. Anything else is not evidence and is not returned.
 */
export function collectCases(store: Store): ExperienceCase[] {
  const events = scanEvents(store, [EVENT.artifactAccepted, EVENT.qualityVerdict, EVENT.learningNote, EVENT.barRaised]);
  const notes = new Map<string, { agent: string; at: string; note: ReturnType<typeof LearningNoteSchema.parse> }>();
  const verdicts = new Map<string, { score: number; mean: number; flagged: string[]; rationales: Map<string, string> }>();
  const authorities = new Map<string, Set<string>>();
  const raisesByTask = new Map<string, { to: number; at: string }[]>();
  for (const event of events) {
    if (event.type === EVENT.learningNote) {
      const note = LearningNoteSchema.safeParse(event.payload);
      if (!note.success || note.data.subjective === null) continue;
      notes.set(note.data.instance + "\u0000" + note.data.step, { agent: note.data.provenance.agent, at: event.at, note: note.data });
      for (const tag of note.data.subjective.tags) {
        const set = authorities.get(tag.dimension) ?? new Set<string>();
        set.add(note.data.provenance.agent);
        authorities.set(tag.dimension, set);
      }
    } else if (event.type === EVENT.qualityVerdict) {
      const payload = event.payload;
      verdicts.set(
        String(payload.instance ?? event.instance) + "\u0000" + String(payload.step) + "\u0000" + String(payload.version),
        {
          score: Number(payload.score),
          mean: typeof payload.mean === "number" ? payload.mean : Number(payload.score),
          flagged: Array.isArray(payload.flagged) ? payload.flagged.map(String) : [],
          // The battery's rendered why per dimension, read BY REFERENCE from the verdict (D12c): the
          // note event stays the one owner of lesson text, and this is the verdict's own evidence.
          rationales: new Map(
            (Array.isArray(payload.dimensions) ? payload.dimensions : []).flatMap((entry) => {
              const cell = entry as { id?: unknown; rationale?: unknown };
              return typeof cell.id === "string" && typeof cell.rationale === "string" ? [[cell.id, cell.rationale]] : [];
            }),
          ),
        },
      );
    } else if (event.type === EVENT.barRaised) {
      const task = String(event.payload.task ?? "");
      const list = raisesByTask.get(task) ?? [];
      list.push({ to: Number(event.payload.to), at: event.at });
      raisesByTask.set(task, list);
    }
  }
  const cases: ExperienceCase[] = [];
  for (const event of events) {
    if (event.type !== EVENT.artifactAccepted) continue;
    if (event.payload.failed !== undefined) continue;
    const instance = event.instance;
    const step = String(event.payload.step);
    const version = Number(event.payload.version);
    const task = String(event.payload.task ?? "");
    const note = notes.get(instance + "\u0000" + step);
    const verdict = verdicts.get(instance + "\u0000" + step + "\u0000" + version);
    if (note === undefined || verdict === undefined || task === "") continue;
    const subjective = note.note.subjective;
    if (subjective === null) continue;
    const quality = pinnedQuality(store, instance, task);
    const raises = raisesByTask.get(task) ?? [];
    const barThen = quality === undefined ? 0 : foldBar(raises, quality.threshold, note.at);
    const corroborationBy = new Map<string, number>();
    for (const tag of subjective.tags) {
      const agents = [...(authorities.get(tag.dimension) ?? new Set<string>())].filter((agent) => agent !== note.agent).length;
      corroborationBy.set(tag.dimension, agents);
    }
    cases.push({
      instance,
      task,
      taskVersion: Number(event.payload.taskVersion ?? 0),
      step,
      version,
      digest: String(event.payload.digest),
      outcome: "pass",
      score: verdict.score,
      mean: verdict.mean,
      flagged: verdict.flagged,
      rationales: verdict.rationales,
      writtenBy: note.agent,
      at: event.at,
      lesson: {
        whatWrong: clip(subjective.whatWrong, 400),
        whatRight: clip(subjective.whatRight, 400),
        whatBetter: clip(subjective.whatBetter, 400),
        tags: subjective.tags.map((tag) => ({ dimension: tag.dimension, lesson: clip(tag.lesson, 240) })),
      },
      signals: { barThen, levels: raises.filter((raise) => raise.at > note.at).length, corroborationBy },
    });
  }
  return cases.sort((left, right) => left.at.localeCompare(right.at) || left.instance.localeCompare(right.instance));
}

/** The bar in force at an instant: the seed folded through the raises recorded up to it. */
function foldBar(raises: readonly { to: number; at: string }[], seed: number, at: string): number {
  let bar = seed;
  for (const raise of raises) {
    if (raise.at > at) continue;
    bar = raise.to;
  }
  return bar;
}

/** The bounded envelope payload: at most `max` cases and at most ~1200 tokens of lesson text. */
export interface RecallPayload {
  need: string;
  count: number;
  truncated: boolean;
  cases: Array<{
    score: number;
    relevance: RankedCase["relevance"];
    provenance: { instance: string; task: string; taskVersion: number; step: string; version: number; digest: string; writtenBy: string; at: string };
    outcome: string;
    /** The relevant dimension's rationale, by reference from the verdict (verdict-rationale D12c). */
    rationale?: string;
    lesson: ExperienceCase["lesson"];
  }>;
}

/** Cut the ranked list to the caller's bound and the payload budget, and say whether it was cut. */
export function applyBounds(ranked: readonly RankedCase[], max: number, budget = 1200): RecallPayload["cases"] {
  const kept: RecallPayload["cases"] = [];
  let tokens = 0;
  for (const candidate of ranked) {
    if (kept.length >= max) break;
    const cost = lessonTokens(candidate);
    if (tokens + cost > budget && kept.length > 0) break;
    tokens += cost;
    kept.push({
      score: candidate.score2,
      relevance: candidate.relevance,
      provenance: {
        instance: candidate.instance,
        task: candidate.task,
        taskVersion: candidate.taskVersion,
        step: candidate.step,
        version: candidate.version,
        digest: candidate.digest,
        writtenBy: candidate.writtenBy,
        at: candidate.at,
      },
      outcome: candidate.outcome,
      ...(candidate.rationale === undefined ? {} : { rationale: candidate.rationale }),
      lesson: candidate.lesson,
    });
  }
  return kept;
}

/**
 * The query itself: one store, read-only, observer-authorised. Defaults the need's tags to the
 * current step's rubric ids, collects the solved cases, ranks them through the port (injectable),
 * and bounds the answer. It writes nothing, so the same store and args reproduce the same ranking.
 */
export function recallExperience(
  options: EngineOptions & { instance: string; actor?: string },
  input: { need: string; tags?: readonly string[]; max?: number },
): RecallPayload {
  const max = input.max ?? 5;
  return withStore(options, (store) => {
    const instance = loadInstance(store, options.instance);
    assertObserver(store, instance, options.actor);
    const flow = loadPinnedFlow(store, instance);
    const node = flow.config.nodes.find((candidate) => candidate.id === instance.currentStep);
    const task = node === undefined ? undefined : flow.tasks.get(node.task);
    const tags = input.tags ?? (task?.quality?.dimensions.map((dimension) => dimension.id) ?? []);
    const need: QueryNeed = { text: input.need, tags };
    const candidates = collectCases(store);
    const ranked = activeRanker().rank({ need, candidates });
    const cases = applyBounds(ranked, max);
    return { need: input.need, count: cases.length, truncated: cases.length < ranked.length, cases };
  });
}

// --- Stage 2: the jev distinct-exemplar seam (spec D1-D3, Model table). The implementation lives in
// `ranker-jev.ts` so this module stays the small, synchronous deterministic ranker.

/** How many pre-ranked candidates stage 2 offers jev: the jev input is O(1) in store size. */
export const JEV_POOL = 20;
/** The clip on each candidate field handed to jev, so one call stays bounded. */
export const JEV_CLIP = 240;
/** Two lessons at or above this normalized-token Jaccard are the same exemplar. */
export const DUPLICATE_JACCARD = 0.8;
/** How long a cold miss waits for another process to publish before computing itself. */
export const SINGLE_FLIGHT_WAIT_MS = 250;

/** One chosen exemplar: the case and the jev score that ordered it. */
export interface DistinctChoice {
  case: RankedCase;
  jev: number;
}

/** What one stage-2 run produced, with the model and spend it cost. */
export interface DistinctOutcome {
  chosen: DistinctChoice[];
  model: string;
  usage?: { input: number; output: number };
}

/**
 * The stage-2 port: async, injectable, and SEPARATE from the synchronous `RankerPort`, so every
 * existing deterministic test is untouched by the jev stage.
 */
export interface DistinctRanker {
  rankDistinct(input: { need: QueryNeed; ranked: readonly RankedCase[]; max: number }): Promise<DistinctOutcome>;
}

/** The identity of one cached ranking: the EVIDENCE state, never the caller's phrasing (spec D7). */
export interface RankedKey {
  task: string;
  taskVersion: number;
  cover: readonly string[];
  coverDigest: string;
  /** How many solved cases the task had when the entry was computed. */
  watermark: number;
}
