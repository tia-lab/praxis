/**
 * The jev distinct-exemplar stage and its persisted, lazily read-through cache (spec D1-D11).
 *
 * Two stages behind the recall surface: the deterministic pre-rank in `ranker.ts` bounds the jev
 * input to JEV_POOL candidates, and ONE pi-jev `evaluate` call orders those by how much NEW guidance
 * each would add. The result is a DERIVED cache, never a fact: a `recall.ranked` event keyed by the
 * evidence state (task, task version, cover, solved-case watermark), folded like the adaptive bars
 * (`barAt`/`effectiveBars`) and served WITHOUT any jev call while fresh. A jev failure is never
 * cached — the deterministic answer serves that one call and the next jev-up call recomputes.
 *
 * No store table, no migration: the event log is already the durable, append-only, rebuildable place
 * a derived record belongs (`src/store/db.ts:18,150-158` pins the schema identity, so a table would
 * open the migration gate).
 */
import { evaluate } from "pi-jev";
import type { JevRequest } from "pi-jev";
import { RecallRankedSchema, type RecallRanked } from "../types/learning.ts";
import { screenCases, type ScreenOutcome } from "./screen.ts";
import { parseWith } from "../types/schema.ts";
import type { Store } from "../store/db.ts";
import { appendEvent } from "../store/events.ts";
import { loadInstance } from "../store/instance.ts";
import { assertObserver } from "../runner/engine/authority.ts";
import { loadPinnedFlow } from "../runner/engine/flow.ts";
import { withStore } from "../runner/engine/support.ts";
import { EVENT } from "../runner/engine/types.ts";
import type { EngineOptions } from "../runner/engine/types.ts";
import { digest } from "../runner/canonical.ts";
import { scanEvents } from "./bar.ts";
import {
  activeRanker,
  applyBounds,
  collectCases,
  DUPLICATE_JACCARD,
  JEV_CLIP,
  JEV_POOL,
  SINGLE_FLIGHT_WAIT_MS,
  type DistinctChoice,
  caseKey,
  excludedFor,
  rubricKeys,
  type DistinctOutcome,
  type DistinctRanker,
  type QueryNeed,
  type RankedCase,
  type RankedKey,
  type RecallPayload,
} from "./ranker.ts";

/**
 * The three distinctness criteria (S5, R29-R31) and their FROZEN weights (D16, R30): constants in
 * code, never model-chosen, never task-authored, never tuned per call. Each criterion is asked as its
 * own `noul`, so an answer says WHICH property a candidate has instead of one opaque score.
 */
export const WEIGHT_DISTINCT = 0.5;
export const WEIGHT_USEFUL = 0.3;
export const WEIGHT_READABLE = 0.2;

/** The authored trio: an id (the question suffix), the text, and the weight it carries. */
export const DISTINCT_CRITERIA = [
  { id: "distinct", text: "It is substantively distinct from the other candidates' guidance.", weight: WEIGHT_DISTINCT },
  { id: "useful", text: "It is directly useful for the stated need.", weight: WEIGHT_USEFUL },
  { id: "readable", text: "It is still worth reading even when its existing relevance score is high.", weight: WEIGHT_READABLE },
] as const;

/** The weighted sum of the three probabilities: the ordering value, in [0,1] (R30). */
export function weightedTotal(nouls: Readonly<Record<string, number>>): number {
  let total = 0;
  for (const criterion of DISTINCT_CRITERIA) total += criterion.weight * (nouls[criterion.id] ?? 0);
  return Math.min(1, Math.max(0, total));
}

const clipField = (text: string): string => (text.length <= JEV_CLIP ? text : text.slice(0, JEV_CLIP - 1) + "\u2026");

/** A candidate's question id: positional, so the answer map is O(1) to read. */
const questionId = (index: number): string => "c" + String(index);

/** The tokens a duplicate check compares: the guidance a reader would actually take away. */
function tokensOf(candidate: RankedCase): Set<string> {
  const text = candidate.lesson.whatBetter + " " + candidate.lesson.tags.map((tag) => tag.lesson).join(" ");
  return new Set(
    text
      .trim()
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word !== ""),
  );
}

/** Normalized-token Jaccard: 1 means the same guidance, 0 means nothing in common. */
function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) return 1;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/**
 * The jev ranker: ONE `evaluate` call, one `score` question per candidate (spec D2). pi-jev has no
 * pairwise question type, so jev orders by how much new guidance each case adds and the deterministic
 * duplicate collapse guarantees the N exemplars are actually different from each other (D3).
 */
export function jevRanker(opts: { evaluateFn?: typeof evaluate; model?: string } = {}): DistinctRanker {
  const run = opts.evaluateFn ?? evaluate;
  return {
    async rankDistinct({ need, ranked, max }) {
      const pool = ranked.slice(0, JEV_POOL);
      // Three `noul`s per pooled candidate (R29): <candidate>.<criterion>. At the 20-candidate pool,
      // that is 60 questions — under pi-jev's 128 — and it never splits across calls.
      const questions: Record<string, { type: "noul"; instructions: string }> = {};
      pool.forEach((_candidate, index) => {
        for (const criterion of DISTINCT_CRITERIA) {
          questions[questionId(index) + "." + criterion.id] = { type: "noul", instructions: criterion.text };
        }
      });
      const request: JevRequest = {
        state: {
          need: clipField(need.text),
          cover: need.tags,
          cases: pool.map((candidate, index) => ({
            id: questionId(index),
            step: candidate.step,
            score: candidate.score2,
            whatWrong: clipField(candidate.lesson.whatWrong),
            whatRight: clipField(candidate.lesson.whatRight),
            whatBetter: clipField(candidate.lesson.whatBetter),
            tags: candidate.lesson.tags.map((tag) => ({ dimension: tag.dimension, lesson: clipField(tag.lesson) })),
          })),
        },
        questions,
        ...(opts.model === undefined ? {} : { model: opts.model }),
      };
      const response = await run(request);
      const scored = pool.map((candidate, index) => {
        const nouls: Record<string, number> = {};
        for (const criterion of DISTINCT_CRITERIA) {
          const id = questionId(index) + "." + criterion.id;
          const answer = response.answers[id];
          // Strict: a missing or mistyped answer makes the whole stage unavailable, never partial.
          if (answer === undefined || answer.type !== "noul" || !Number.isFinite(answer.noul)) {
            throw new Error("jev answer " + JSON.stringify(id) + " is not a finite noul");
          }
          nouls[criterion.id] = Math.min(1, Math.max(0, answer.noul));
        }
        const total = weightedTotal(nouls);
        return { case: candidate, jev: total, nouls, total };
      });
      const ordered = scored.sort(
        (left, right) =>
          right.jev - left.jev ||
          right.case.score2 - left.case.score2 ||
          left.case.instance.localeCompare(right.case.instance) ||
          left.case.step.localeCompare(right.case.step),
      );
      const chosen: DistinctChoice[] = [];
      for (const item of ordered) {
        if (chosen.length >= max) break;
        const tokens = tokensOf(item.case);
        if (chosen.some((kept) => jaccard(tokensOf(kept.case), tokens) >= DUPLICATE_JACCARD)) continue;
        chosen.push(item);
      }
      return {
        chosen,
        model: response.model,
        ...(response.usage === undefined
          ? {}
          : { usage: { input: response.usage.input_tokens, output: response.usage.output_tokens } }),
      };
    },
  };
}

/** The injected stage-2 ranker: a test replaces it, `undefined` restores the jev one. */
let distinctOverride: DistinctRanker | undefined;

/** Replace the stage-2 ranker; `undefined` restores the jev-backed one. */
export function setDistinctRankerForTest(ranker: DistinctRanker | undefined): void {
  distinctOverride = ranker;
}

/** The injected cache write, so a test can prove a persist failure cannot cost the answer. */
let persistOverride: (() => void) | undefined;

/** Replace the cache write; `undefined` restores the real one. */
export function setRankedPersistForTest(persist: (() => void) | undefined): void {
  persistOverride = persist;
}

/** How long a cold miss waits for a concurrent publisher; tests set 0 so no case sleeps. */
let singleFlightWaitMs = SINGLE_FLIGHT_WAIT_MS;

/** Set the cross-process wait; `undefined` restores the frozen default. */
export function setSingleFlightWaitForTest(waitMs: number | undefined): void {
  singleFlightWaitMs = waitMs ?? SINGLE_FLIGHT_WAIT_MS;
}

/** The cover digest: a stable key for the same dimension set in any order. */
export function coverDigestOf(tags: readonly string[]): string {
  // Same shape as the other identity keys (16 hex of the digest), so the record stays small.
  return digest("cover:" + [...tags].sort().join(",")).slice(7, 23);
}

const keyOf = (key: RankedKey): string =>
  key.task + "\u0000" + String(key.taskVersion) + "\u0000" + key.coverDigest + "\u0000" + String(key.watermark);

/** The freshest entry recorded for a key, or `undefined` when no entry matches (miss or stale). */
function freshEntry(store: Store, key: RankedKey): RecallRanked | undefined {
  const entries = scanEvents(store, [EVENT.recallRanked])
    .map((event) => ({ at: event.at, parsed: RecallRankedSchema.safeParse(event.payload) }))
    .filter((entry) => entry.parsed.success)
    .map((entry) => ({ at: entry.at, value: entry.parsed.data as RecallRanked }))
    .filter(
      (entry) =>
        entry.value.task === key.task &&
        entry.value.taskVersion === key.taskVersion &&
        entry.value.coverDigest === key.coverDigest &&
        entry.value.watermark === key.watermark,
    );
  if (entries.length === 0) return undefined;
  // The log scans in (at, instance, seq) order; the latest `at` wins among fresh entries.
  return entries.sort((left, right) => left.at.localeCompare(right.at)).at(-1)?.value;
}

/** The evidence state one recall reads, held across the jev call while the store is closed. */
interface RecallState {
  instance: string;
  key: RankedKey;
  need: QueryNeed;
  ranked: RankedCase[];
  max: number;
  /** Dimensions excluded because a case's identity changed since it was judged (S4, R28). */
  excluded: string[];
  fresh: RecallRanked | undefined;
}

/** One computed ranking, or `undefined` when stage 2 was unavailable (D10: nothing is persisted). */
interface Computed {
  chosen: DistinctChoice[];
  model: string;
  usage?: { input: number; output: number };
  /** False when the ranking came from an entry another process published while we waited. */
  persist: boolean;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The bounded cross-process wait: another process may publish while this one was deciding. */
async function awaitPublished(options: EngineOptions, key: RankedKey, waitMs: number): Promise<RecallRanked | undefined> {
  if (waitMs <= 0) return undefined;
  const polls = 5;
  for (let index = 0; index < polls; index += 1) {
    await sleep(waitMs / polls);
    const found = withStore(options, (store) => freshEntry(store, key));
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Map a persisted entry's chosen ids back onto this call's ranked cases, in the entry's order. */
/** The trio a cache entry already recorded, so a fresh hit repeats the same explanation (R31). */
function evidenceOf(entry: RecallRanked, ranked: readonly RankedCase[]): Map<string, { nouls?: Record<string, number>; total?: number }> {
  const evidence = new Map<string, { nouls?: Record<string, number>; total?: number }>();
  for (const pick of entry.chosen) {
    const key = pick.instance + "/" + pick.step + "/" + String(pick.version);
    evidence.set(key, {
      ...(pick.nouls === undefined ? {} : { nouls: pick.nouls }),
      ...(pick.total === undefined ? {} : { total: pick.total }),
    });
  }
  void ranked;
  return evidence;
}

function fromEntry(entry: RecallRanked, ranked: readonly RankedCase[]): DistinctChoice[] {
  const byIdentity = new Map(
    ranked.map((candidate) => [candidate.instance + "\u0000" + candidate.step + "\u0000" + String(candidate.version), candidate]),
  );
  const chosen: DistinctChoice[] = [];
  for (const pick of entry.chosen) {
    const candidate = byIdentity.get(pick.instance + "\u0000" + pick.step + "\u0000" + String(pick.version));
    if (candidate !== undefined) chosen.push({ case: candidate, jev: pick.jev });
  }
  return chosen;
}

/** The payload builder shared by every path: at most `max` cases, within the token budget. */
function payloadOf(
  need: string,
  ordered: readonly RankedCase[],
  total: number,
  max: number,
  screens?: ReadonlyMap<string, { passed: boolean }>,
  excluded?: readonly string[],
  evidence?: ReadonlyMap<string, { nouls?: Record<string, number>; total?: number }>,
): RecallPayload {
  const cases = applyBounds(ordered, max, 1200, screens, evidence);
  return {
    need,
    count: cases.length,
    truncated: cases.length < total,
    ...(excluded === undefined || excluded.length === 0 ? {} : { excluded: [...excluded] }),
    cases,
  };
}

/**
 * Screen the chosen cases in ONE batched call (S4, R25). A case's text is what the screen judges; a
 * throw propagates and every case is withheld by the caller (R27).
 */
async function screenChosen(chosen: readonly DistinctChoice[]): Promise<Map<string, ScreenOutcome>> {
  return screenCases(
    chosen.map((pick) => ({
      key: caseKey(pick.case),
      text: [pick.case.lesson.whatWrong, pick.case.lesson.whatRight, pick.case.lesson.whatBetter]
        .filter((part) => part.trim() !== "")
        .join("\n"),
    })),
  );
}

/** The screens a cached entry already recorded, so a fresh hit costs no call at all. */
function screensOf(entry: RecallRanked, ranked: readonly RankedCase[]): Map<string, ScreenOutcome> {
  const byKey = new Map(ranked.map((candidate) => [caseKey(candidate), candidate] as const));
  const screens = new Map<string, ScreenOutcome>();
  for (const pick of entry.chosen) {
    if (pick.screen === undefined) continue;
    const candidate = byKey.get(pick.instance + "/" + pick.step + "/" + String(pick.version));
    if (candidate === undefined) continue;
    screens.set(caseKey(candidate), pick.screen);
  }
  return screens;
}

/** The in-process single flight: concurrent misses in one process share one jev call. */
const inflight = new Map<string, Promise<Computed | undefined>>();

/** The recall surface with the jev distinct-exemplar stage and its lazy, persisted cache behind it. */
export async function recallRanked(
  options: EngineOptions & { instance: string; actor?: string },
  input: { need: string; tags?: readonly string[]; max?: number },
): Promise<RecallPayload> {
  const max = input.max ?? 5;
  // Phase A: read the evidence state. No transaction is held here, and none is opened around jev.
  const state: RecallState = withStore(options, (store) => {
    const instance = loadInstance(store, options.instance);
    assertObserver(store, instance, options.actor);
    const flow = loadPinnedFlow(store, instance);
    const node = flow.config.nodes.find((candidate) => candidate.id === instance.currentStep);
    const task = node === undefined ? undefined : flow.tasks.get(node.task);
    const tags = input.tags ?? (task?.quality?.dimensions.map((dimension) => dimension.id) ?? []);
    const need: QueryNeed = { text: input.need, tags };
    // S4/R28: cases are scoped to the dimensions whose identity is unchanged, and the exclusions
    // are reported once with the set.
    const keys = task?.quality === undefined ? undefined : rubricKeys(task.quality);
    const candidates = collectCases(store, keys);
    const excluded = keys === undefined ? [] : excludedFor(collectCases(store), candidates, keys);
    const ranked = activeRanker().rank({ need, candidates });
    const key: RankedKey = {
      // The task REF as the flow knows it (`tasks/<path>`), never the bare id.
      task: node?.task ?? "",
      taskVersion: task?.version ?? 0,
      cover: tags,
      coverDigest: coverDigestOf(tags),
      watermark: candidates.length,
    };
    return { instance: instance.id, key, need, ranked, max, excluded, fresh: freshEntry(store, key) };
  });

  // No screen ran on this path (jev down, cold pool, or a deterministic fallback), so the payload
  // withholds every case's text and says so per case (R27).
  const deterministic = (): RecallPayload => payloadOf(input.need, state.ranked, state.ranked.length, max, undefined, state.excluded);

  // Nothing solved yet: there is nothing to rank and nothing to cache, so no model call is made.
  if (state.ranked.length === 0 || state.key.task === "") return deterministic();

  // Fresh: serve the cached ORDER with zero jev calls. Stage 1 still ran (the watermark needs it), so
  // the relevance numbers in the payload are the same computation the deterministic path would produce.
  if (state.fresh !== undefined) {
    const cached = fromEntry(state.fresh, state.ranked);
    if (cached.length > 0) {
      return payloadOf(
        input.need,
        cached.map((pick) => pick.case),
        state.ranked.length,
        max,
        screensOf(state.fresh, state.ranked),
        state.excluded,
        evidenceOf(state.fresh, state.ranked),
      );
    }
  }

  const key = keyOf(state.key);
  let computed = inflight.get(key);
  if (computed === undefined) {
    computed = (async (): Promise<Computed | undefined> => {
      const published = await awaitPublished(options, state.key, singleFlightWaitMs);
      if (published !== undefined) {
        const chosen = fromEntry(published, state.ranked);
        if (chosen.length > 0) return { chosen, model: published.model, usage: published.usage, persist: false };
      }
      const ranker = distinctOverride ?? jevRanker();
      try {
        const outcome: DistinctOutcome = await ranker.rankDistinct({ need: state.need, ranked: state.ranked, max });
        return { ...outcome, persist: true };
      } catch {
        // jev down, a timeout, or an unreadable answer: the deterministic answer serves this call and
        // NOTHING is cached, so the next jev-up call recomputes instead of inheriting a downgrade.
        return undefined;
      }
    })();
    inflight.set(key, computed);
    void computed.finally(() => {
      if (inflight.get(key) === computed) inflight.delete(key);
    });
  }
  const outcome = await computed;
  if (outcome === undefined) return deterministic();

  // S4/R25: ONE batched screen for the whole chosen set, on the miss path only. A screen that cannot
  // answer leaves the map empty, so every case is served as a record without text (R27).
  let screens = new Map<string, ScreenOutcome>();
  try {
    screens = await screenChosen(outcome.chosen);
  } catch {
    screens = new Map<string, ScreenOutcome>();
  }

  if (outcome.persist) {
    // The write is its own small transaction AFTER jev returned; a failure costs only the cache.
    try {
      if (persistOverride !== undefined) persistOverride();
      else {
        const at = new Date().toISOString();
        withStore(options, (store) => {
          appendEvent(store, state.instance, {
            type: EVENT.recallRanked,
            payload: parseWith(
              RecallRankedSchema,
              {
                task: state.key.task,
                taskVersion: state.key.taskVersion,
                cover: [...state.key.cover],
                coverDigest: state.key.coverDigest,
                watermark: state.key.watermark,
                rankedBy: "jev",
                model: outcome.model,
                ...(outcome.usage === undefined ? {} : { usage: outcome.usage }),
                pool: state.ranked.slice(0, JEV_POOL).length,
                chosen: outcome.chosen.map((pick) => ({
                  instance: pick.case.instance,
                  step: pick.case.step,
                  version: pick.case.version,
                  jev: Math.round(pick.jev * 10000) / 10000,
                  ...(pick.nouls === undefined ? {} : { nouls: pick.nouls }),
                  ...(pick.total === undefined ? {} : { total: Math.round(pick.total * 10000) / 10000 }),
                  ...(screens.has(caseKey(pick.case)) ? { screen: screens.get(caseKey(pick.case))! } : {}),
                })),
                at,
              },
              "RESULT_INVALID",
              "recall.ranked",
            ),
            at,
          });
        });
      }
    } catch {
      // Cache only: the answer already exists, so a failed write changes nothing about this call.
    }
  }
  const evidence = new Map<string, { nouls?: Record<string, number>; total?: number }>();
  for (const pick of outcome.chosen) {
    if (pick.nouls === undefined && pick.total === undefined) continue;
    evidence.set(caseKey(pick.case), {
      ...(pick.nouls === undefined ? {} : { nouls: pick.nouls }),
      ...(pick.total === undefined ? {} : { total: pick.total }),
    });
  }
  return payloadOf(input.need, outcome.chosen.map((pick) => pick.case), state.ranked.length, max, screens, state.excluded, evidence);
}
