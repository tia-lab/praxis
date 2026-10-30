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
  type DistinctOutcome,
  type DistinctRanker,
  type QueryNeed,
  type RankedCase,
  type RankedKey,
  type RecallPayload,
} from "./ranker.ts";

/** The criteria every candidate is scored against: fixed text, never derived from the caller. */
const DISTINCT_CRITERIA = [
  "substantively distinct from the other candidates' guidance",
  "directly useful for the stated need",
  "still worth reading when its existing relevance score is high",
];

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
      const questions: Record<string, { type: "score"; instructions: string; criteria: string[] }> = {};
      pool.forEach((_candidate, index) => {
        questions[questionId(index)] = {
          type: "score",
          instructions:
            "How much NEW, non-duplicated guidance would this solved case add for the need below, beyond what the other cases already say? " +
            "Score 1 when it is the most distinct and directly useful, 0 when it repeats what the others teach. CASE:",
          criteria: [...DISTINCT_CRITERIA],
        };
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
        const answer = response.answers[questionId(index)];
        // Strict: a missing answer or a non-score shape makes the whole stage unavailable, never partial.
        if (answer === undefined || answer.type !== "score" || !Number.isFinite(answer.score)) {
          throw new Error("jev answer " + JSON.stringify(questionId(index)) + " is not a finite score");
        }
        return { case: candidate, jev: Math.min(1, Math.max(0, answer.score)) };
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
function payloadOf(need: string, ordered: readonly RankedCase[], total: number, max: number): RecallPayload {
  const cases = applyBounds(ordered, max);
  return { need, count: cases.length, truncated: cases.length < total, cases };
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
    const candidates = collectCases(store);
    const ranked = activeRanker().rank({ need, candidates });
    const key: RankedKey = {
      // The task REF as the flow knows it (`tasks/<path>`), never the bare id.
      task: node?.task ?? "",
      taskVersion: task?.version ?? 0,
      cover: tags,
      coverDigest: coverDigestOf(tags),
      watermark: candidates.length,
    };
    return { instance: instance.id, key, need, ranked, max, fresh: freshEntry(store, key) };
  });

  const deterministic = (): RecallPayload => payloadOf(input.need, state.ranked, state.ranked.length, max);

  // Nothing solved yet: there is nothing to rank and nothing to cache, so no model call is made.
  if (state.ranked.length === 0 || state.key.task === "") return deterministic();

  // Fresh: serve the cached ORDER with zero jev calls. Stage 1 still ran (the watermark needs it), so
  // the relevance numbers in the payload are the same computation the deterministic path would produce.
  if (state.fresh !== undefined) {
    const cached = fromEntry(state.fresh, state.ranked);
    if (cached.length > 0) return payloadOf(input.need, cached.map((pick) => pick.case), state.ranked.length, max);
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
  return payloadOf(input.need, outcome.chosen.map((pick) => pick.case), state.ranked.length, max);
}
