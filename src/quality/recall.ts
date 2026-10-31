/**
 * Recall (O1/F3/F7, task-level): choose the most useful recorded lessons for a task and hand them
 * to the brief. Selection, never synthesis — a deterministic, auditable ranking over the note
 * events with frozen weights, MMR-style coverage, and a recorded set, so "why these lessons" is
 * reproducible from the store alone. Semantic clustering of lesson text is Occam's, not this.
 *
 * Frozen defaults (O1): relevance = 0.35 weakness-coverage + 0.25 outcome + 0.20 corroboration +
 * 0.10 recency-by-bar-version + 0.10 score-margin; N <= 5; ~1000 tokens; >= 1 passing exemplar when
 * one exists; empty store -> empty recall (no fabrication).
 */
import { LearningNoteSchema, RecallSetSchema, type RecallNote, type RecallSet } from "../types/learning.ts";
import { parseWith, type Quality } from "../types/schema.ts";
import { WITHHELD_NOTE } from "./screen.ts";
import type { Store } from "../store/db.ts";
import { appendEvent } from "../store/events.ts";
import { withStore } from "../runner/engine/support.ts";
import { EVENT } from "../runner/engine/types.ts";
import type { EngineOptions } from "../runner/engine/types.ts";
import { noteObjective } from "../runner/note-gate.ts";
import { barAt, effectiveBars, ofTask, raisesOf, scanEvents } from "./bar.ts";

/** The frozen signal weights (O1). They sum to 1 and are never chosen by the agent. */
export const RECALL_WEIGHTS = {
  weakness: 0.35,
  outcome: 0.25,
  corroboration: 0.2,
  recency: 0.1,
  margin: 0.1,
} as const;
/** How many notes one recall set may carry. */
export const RECALL_MAX = 5;
/** The approximate token ceiling for the recall payload. */
export const RECALL_TOKEN_BUDGET = 1000;
/** Rough characters per token, used only to bound the payload. */
const CHARS_PER_TOKEN = 4;
/** Retention is keep-all, but recall reads a bounded recent window (O6). */
const RECENT_NOTES = 40;
const RECENT_VERDICTS = 20;
/** Recency decay per bar level between a note and now. */
const RECENCY_DECAY = 0.7;
/** Recency decay applied per verdict going back in time when the weak-set is scored (steering). */
const VERDICT_RECENCY_DECAY = 0.7;

const clip = (text: string, limit: number): string => (text.length <= limit ? text : text.slice(0, limit - 1) + "\u2026");
const normalize = (text: string): string => text.trim().replace(/\s+/g, " ").toLowerCase();
const round4 = (value: number): number => Math.round(value * 10000) / 10000;
const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * A RECENCY-WEIGHTED mean over a chronological list (oldest first): the newest value weighs 1 and
 * each step back multiplies by `decay`. The weak-set is steering, not an audit, so a dimension whose
 * early scores were low and which has since recovered must stop being flagged — a plain mean keeps
 * that early dip in the average long after the fix, which is the regression this replaces.
 */
const recencyWeightedMean = (values: readonly number[], decay: number): number => {
  if (values.length === 0) return 0;
  let weighted = 0;
  let weights = 0;
  values.forEach((value, index) => {
    const weight = decay ** (values.length - 1 - index);
    weighted += weight * value;
    weights += weight;
  });
  return weighted / weights;
};

/**
 * The weak-set: the dimensions currently costing the most, from the RECENCY-WEIGHTED mean score of
 * the task's recent verdicts (bounded window, spanning bar versions — the bottleneck carries across
 * levels). The newest verdict dominates, so a dimension that has recovered stops being flagged. The
 * bottom three below the bar, or the single lowest when everything clears it.
 */
export function weakSetFor(store: Store, task: string, taskVersion: number, quality: Quality): string[] {
  const verdicts = scanEvents(store, [EVENT.qualityVerdict])
    .filter((event) => ofTask(event, task))
    .slice(-RECENT_VERDICTS);
  void taskVersion;
  const sums = new Map<string, number[]>();
  for (const event of verdicts) {
    const dimensions = Array.isArray(event.payload.dimensions) ? event.payload.dimensions : [];
    for (const entry of dimensions) {
      const cell = entry as { id?: unknown; score?: unknown };
      const id = String(cell.id);
      const list = sums.get(id) ?? [];
      list.push(Number(cell.score));
      sums.set(id, list);
    }
  }
  // The per-dimension bars are what "below bar" means now, so the weak-set follows each dimension
  // to its own floor instead of comparing everything against the global MEAN bar.
  const bars = effectiveBars(store, task, quality);
  void taskVersion;
  const ranked = [...sums.entries()]
    .map(([id, scores]) => ({ id, mean: recencyWeightedMean(scores, VERDICT_RECENCY_DECAY) }))
    .sort((left, right) => left.mean - right.mean || left.id.localeCompare(right.id));
  const below = ranked.filter((entry) => entry.mean < (bars.perDimension.get(entry.id) ?? bars.global));
  return (below.length > 0 ? below : ranked.slice(0, 1)).slice(0, 3).map((entry) => entry.id);
}

/** One candidate note with its computed relevance, so selection is a pure comparison. */
interface Candidate {
  note: RecallNote;
  relevance: number;
  tags: { dimension: string; lesson: string }[];
}

/** What one candidate's relevance is computed from: numbers and lookups only, so any caller can supply them. */
export interface CandidateSignals {
  /** What this candidate should COVER: the task's weak-set for the brief, the caller's need tags for a query. */
  cover: readonly string[];
  /** The candidate's own dimension tags. */
  tags: readonly { dimension: string; lesson: string }[];
  outcome: RecallNote["outcome"];
  /** Did the case carry a concrete improvement (an empty lesson teaches less)? */
  hasBetter: boolean;
  /** The score the case achieved. */
  score: number;
  /** The bar in force when it was judged. */
  barThen: number;
  /** How many bar levels have been raised since. */
  levels: number;
  /** The author, so corroboration can exclude them from their own count. */
  author: string;
  /** Independent agents (other than the author) who tagged this dimension. */
  corroborationAgents: (dimension: string) => number;
}

/** The relevance of one candidate, with the signals that produced it (the breakdown is auditable). */
export interface CandidateRelevance {
  relevance: number;
  breakdown: { coverage: number; outcome: number; corroboration: number; recency: number; margin: number };
}

/**
 * THE scorer: one weighted sum over five normalized signals (O1's frozen weights), used by the
 * brief's recall (cover = the weak-set) and by the experience query (cover = the caller's need
 * tags). Kept in one place so a query can never rank by a second, drifting formula.
 */
export function scoreCandidate(signals: CandidateSignals): CandidateRelevance {
  const coverage =
    signals.cover.length === 0
      ? 0
      : signals.cover.filter((dimension) => signals.tags.some((tag) => tag.dimension === dimension)).length / signals.cover.length;
  // Corroboration is the mean over the candidate's own lessons: an independent agent recording a
  // similar lesson, saturating as 1 - 1/(1+k). Averaged so one well-known tag cannot carry a
  // candidate whose other lesson nobody else found.
  const corroborations = signals.tags.map((tag) => {
    const agents = signals.corroborationAgents(tag.dimension);
    return 1 - 1 / (1 + agents);
  });
  const corroboration = mean(corroborations);
  const recency = RECENCY_DECAY ** signals.levels;
  const margin = signals.barThen >= 1 ? 1 : Math.max(0, Math.min(1, (signals.score - signals.barThen) / (1 - signals.barThen)));
  const outcome = outcomeValue(signals.outcome, signals.hasBetter);
  const relevance =
    RECALL_WEIGHTS.weakness * coverage +
    RECALL_WEIGHTS.outcome * outcome +
    RECALL_WEIGHTS.corroboration * corroboration +
    RECALL_WEIGHTS.recency * recency +
    RECALL_WEIGHTS.margin * margin;
  return {
    relevance: round4(relevance),
    breakdown: { coverage: round4(coverage), outcome: round4(outcome), corroboration: round4(corroboration), recency: round4(recency), margin: round4(margin) },
  };
}

/** The outcome value of a note: a pass teaches most, an empty/escalated note least (O1). */
function outcomeValue(outcome: RecallNote["outcome"], hasBetter: boolean): number {
  if (outcome === "pass") return 1;
  if (outcome === "continued-failed") return hasBetter ? 0.5 : 0.1;
  return 0.1;
}

/**
 * The ranked candidates for a task, in one deterministic pass over the recent notes: every signal
 * is a pure function of the store, and the tie-break is the note id, so the same store always
 * yields the same order.
 */
function candidates(store: Store, task: string, quality: Quality, weakSet: readonly string[]): Candidate[] {
  const notes = scanEvents(store, [EVENT.learningNote])
    .filter((event) => ofTask(event, task))
    .slice(-RECENT_NOTES)
    .map((event) => ({ note: parseWith(LearningNoteSchema, event.payload, "STORE_INVALID", "learning note"), at: event.at }))
    .filter((entry) => entry.note.subjective !== null);
  const authorities = new Map<string, Set<string>>();
  for (const { note } of notes) {
    for (const tag of note.subjective?.tags ?? []) {
      const agents = authorities.get(tag.dimension) ?? new Set<string>();
      agents.add(note.provenance.agent);
      authorities.set(tag.dimension, agents);
    }
  }
  const raises = raisesOf(store, task);
  const out: Candidate[] = [];
  for (const { note, at } of notes) {
    const subjective = note.subjective;
    if (subjective === null) continue;
    const objective = noteObjective(store, note.instance, note.step, at);
    const outcome = objective?.outcome ?? "pass";
    const score = objective?.bestScore ?? 0;
    const barThen = barAt(raises, quality.threshold, at);
    const { relevance } = scoreCandidate({
      cover: weakSet,
      tags: subjective.tags,
      outcome,
      hasBetter: subjective.whatBetter.trim() !== "",
      score,
      barThen,
      levels: raises.filter((raise) => raise.at > at).length,
      author: note.provenance.agent,
      corroborationAgents: (dimension) => [...(authorities.get(dimension) ?? new Set<string>())].filter((agent) => agent !== note.provenance.agent).length,
    });
    out.push({
      note: {
        id: note.instance + ":" + note.step,
        step: note.step,
        outcome,
        score,
        relevance,
        whatWrong: clip(subjective.whatWrong, 400),
        whatRight: clip(subjective.whatRight, 400),
        whatBetter: clip(subjective.whatBetter, 400),
        tags: subjective.tags.map((tag) => ({ dimension: tag.dimension, lesson: clip(tag.lesson, 240) })),
        screened: false,
        withheld: WITHHELD_NOTE,
      },
      relevance,
      tags: subjective.tags.map((tag) => ({ dimension: tag.dimension, lesson: tag.lesson })),
    });
  }
  return out.sort((left, right) => right.relevance - left.relevance || left.note.id.localeCompare(right.note.id));
}

/** The rough token cost of one note in the payload, used only to respect the budget. */
function tokenCost(note: RecallNote): number {
  const chars =
    note.whatWrong.length + note.whatRight.length + note.whatBetter.length + note.tags.reduce((sum, tag) => sum + tag.lesson.length + tag.dimension.length, 0);
  return Math.ceil(chars / CHARS_PER_TOKEN) + 8;
}

/**
 * MMR-style selection: take the best remaining note, then down-weight the ones that repeat a
 * dimension already covered (coverage, not top-N duplicates). Exact duplicate lessons for the same
 * dimension are dropped outright — a lookup, never semantic clustering (O5).
 */
function select(ranked: readonly Candidate[]): Candidate[] {
  const chosen: Candidate[] = [];
  const covered = new Set<string>();
  const seen = new Set<string>();
  let budget = RECALL_TOKEN_BUDGET;
  const pool = [...ranked];
  while (chosen.length < RECALL_MAX && pool.length > 0) {
    const scored = pool
      .map((candidate) => {
        const repeat = candidate.tags.some((tag) => covered.has(tag.dimension));
        const duplicate = candidate.tags.every((tag) => seen.has(tag.dimension + "|" + normalize(tag.lesson)));
        return { candidate, value: duplicate ? -1 : repeat ? candidate.relevance * 0.5 : candidate.relevance };
      })
      .sort((left, right) => right.value - left.value || left.candidate.note.id.localeCompare(right.candidate.note.id));
    const pick = scored[0];
    if (pick === undefined || pick.value < 0) break;
    const cost = tokenCost(pick.candidate.note);
    if (cost > budget && chosen.length > 0) break;
    budget -= cost;
    chosen.push(pick.candidate);
    pool.splice(pool.indexOf(pick.candidate), 1);
    for (const tag of pick.candidate.tags) {
      covered.add(tag.dimension);
      seen.add(tag.dimension + "|" + normalize(tag.lesson));
    }
  }
  return chosen;
}

/** Always keep one passing exemplar when the store has one: the lesson plus the proof (O1). */
function withExemplar(chosen: readonly Candidate[], ranked: readonly Candidate[]): Candidate[] {
  if (chosen.some((candidate) => candidate.note.outcome === "pass")) return [...chosen];
  const exemplar = ranked.find((candidate) => candidate.note.outcome === "pass");
  if (exemplar === undefined) return [...chosen];
  if (chosen.length < RECALL_MAX) return [...chosen, exemplar];
  return [...chosen.slice(0, RECALL_MAX - 1), exemplar];
}

/**
 * The RecallSet for a task version: the selected lessons plus the weak-set and bar they were ranked
 * against, so the disclosure is reproducible. Cold start returns an empty set, never invented text.
 */
/**
 * The note as it may be SERVED (S4, R26-R27): a case whose text passed the screen is served as it
 * is; every other case keeps its record and loses its free text. `screens` is keyed by note id and
 * is supplied by a caller that ran the screen (the sync path never has one, so it withholds).
 */
function serve(note: RecallNote, screens?: ReadonlyMap<string, { passed: boolean }>): RecallNote {
  if (screens?.get(note.id)?.passed === true) return { ...note, screened: true };
  return { ...note, whatWrong: "", whatRight: "", whatBetter: "", screened: false, withheld: WITHHELD_NOTE };
}

export function recallFor(
  store: Store,
  task: string,
  taskVersion: number,
  quality: Quality,
  /** Screens a caller already ran, keyed by note id. Absent means nothing was screened. */
  screens?: ReadonlyMap<string, { passed: boolean }>,
): RecallSet {
  const weakSet = weakSetFor(store, task, taskVersion, quality);
  const ranked = candidates(store, task, quality, weakSet);
  const selected = ranked.length === 0 ? [] : withExemplar(select(ranked), ranked);
  const clipped = selected.slice(0, RECALL_MAX);
  return parseWith(
    RecallSetSchema,
    {
      bar: effectiveBars(store, task, quality).global,
      weakSet,
      notes: clipped.map((candidate) => serve(candidate.note, screens)),
    },
    "RESULT_INVALID",
    "recall set",
  );
}

/** `recallFor` for a caller holding options, recording the set for audit the first time it is used. */
export function briefRecall(
  options: EngineOptions,
  input: { instance: string; step: string; task: string; taskVersion: number; quality: Quality },
): RecallSet {
  return withStore(options, (store) => {
    const set = recallFor(store, input.task, input.taskVersion, input.quality);
    if (set.notes.length === 0) return set;
    const already = scanEvents(store, [EVENT.recallSelected]).some(
      (event) => event.instance === input.instance && event.payload.step === input.step,
    );
    if (!already) {
      appendEvent(store, input.instance, {
        type: EVENT.recallSelected,
        payload: { step: input.step, task: input.task, taskVersion: input.taskVersion, recall: set },
        at: new Date().toISOString(),
      });
    }
    return set;
  });
}

/** One lesson pointed at a single dimension: what a refusal re-injects (O1, escalating help). */
export interface TargetedLesson {
  dimension: string;
  lesson: string;
  noteId: string;
  step: string;
  relevance: number;
}

/**
 * The single most-corroborated lesson for the verdict's weakest dimension: a refusal is not a flat
 * repeat, it points at the one recorded lesson most likely to move that dimension.
 */
export function escalatedLesson(set: RecallSet, weakest: string | undefined): TargetedLesson | undefined {
  if (weakest === undefined) return undefined;
  const hits = set.notes
    .map((note) => ({ note, tag: note.tags.find((tag) => tag.dimension === weakest) }))
    .filter((entry): entry is { note: RecallNote; tag: { dimension: string; lesson: string } } => entry.tag !== undefined)
    .sort((left, right) => right.note.relevance - left.note.relevance || left.note.id.localeCompare(right.note.id));
  const best = hits[0];
  if (best === undefined) return undefined;
  return {
    dimension: weakest,
    lesson: best.tag.lesson,
    noteId: best.note.id,
    step: best.note.step,
    relevance: best.note.relevance,
  };
}
