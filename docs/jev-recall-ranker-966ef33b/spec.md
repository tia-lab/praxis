# Spec — jev-backed distinct-exemplar recall, persisted as a derived event cache

Task: jev-recall-ranker · Hash: 966ef33b · Gate: G2 · Status: draft — owner must confirm D6 (the persistence
mechanism) and the open points before G3. Consumes the locked design from the owner; it does not re-litigate it.

## Outcome

Recall stops returning near-duplicate lessons ranked by a formula alone. Behind the existing
`RankerPort` a second stage asks pi-jev ONE question set over at most twenty pre-ranked candidates and
picks the most substantively DISTINCT exemplars, preferring higher score. The ranked result is
persisted as a derived `recall.ranked` event — keyed by (task, taskVersion, cover, watermark) — so a
thousand agents observing the same evidence cost about ONE jev call: the first computes and persists,
the rest read the fresh entry with no jev at all. The `RecallSet`/`RecallEnvelope`/`RecallPayload`
shapes, the op=recall arguments and the six-key result are unchanged.

Boundary: this is a relevance ranker and a cache, not a new durable authority. If jev is down the
deterministic ranker answers that call; nothing is fabricated and nothing is cached from a failure.

## Frozen decisions

- **D1 — Two stages, one port boundary.** Stage 1 is today's deterministic pre-rank (`collectCases` +
  `deterministicRanker`/`scoreCandidate`), cut to `JEV_POOL = 20` by relevance. Stage 2 is ONE pi-jev
  `evaluate` call over those ≤20 candidates. `RankerPort` stays synchronous and unchanged: stage 2 is
  a new, separate async seam (`DistinctRanker`), so every existing port test is untouched.
- **D2 — The jev question.** One `evaluate({ state, questions })` call, one `score` question per
  candidate, keyed `c0..c19`, each `criteria: ["substantively distinct from the other candidates',
  guidance", "directly useful for the stated need", "still worth reading when its score is high"]`, with
  the candidate's goal/lesson clipped to `JEV_CLIP = 240` characters per field and the need text
  carried once in `state`. Bounded: ≤20 questions, no free-form generation.
- **D3 — Distinctness is completed deterministically.** pi-jev has no pairwise question (research §2),
  so after the jev scores the selection sorts by (jev score desc, deterministic relevance desc) and
  then collapses near-duplicates with a deterministic normalised-token Jaccard ≥ `DUPLICATE_JACCARD =
  0.8` over the lessons' `whatBetter` + tag lessons. The result is ≤N exemplars that are (a) ordered by
  jev, and (b) provably different from each other. Fewer than N distinct cases yields fewer, never
  padding.
- **D4 — Two entry points, counts from the caller.** `op=recall` at a start: cover = ALL rubric
  dimension ids, N = 5. The refusal path: cover = the refused dimensions, N = 3. Both are already the
  callers' arguments (`recallExperience` defaults `tags` to the step's rubric, `max` to 5; the refusal
  passes `refused`/`3`), so no new count plumbing is introduced.
- **D5 — The API split.** `recallExperience` stays synchronous and deterministic (unchanged, every
  caller and test untouched). A new `recallRanked(options, input): Promise<RecallPayload>` performs the
  read-through cache lookup, stage 1 + stage 2 on a miss, the persist, and the fallback. `op=recall`
  and the refusal feedback call `recallRanked`; the deterministic function remains the fallback
  implementation, exercised by the same tests as today.
- **D6 — Persistence: a derived `recall.ranked` EVENT, folded like the bars. NOT a table.**
  (research §4; owner confirms.) Adding a table would require a `STORE_SCHEMA` bump and a migration for
  existing files (`src/store/db.ts:18,150-158`) — the open store-migration gate. The event needs no DDL,
  is append-only, rebuildable and type-filtered on read (`scanEvents`), and follows the `bar.raised`
  precedent exactly. It is a CACHE: derived, non-authoritative, superseded never edited, and a stale or
  corrupt entry is simply ignored rather than repaired.
- **D7 — Key, watermark, freshness.** `key = (task, taskVersion, coverDigest, watermark)` where
  `coverDigest = digest("cover:" + sorted tags)` and `watermark = number of solved cases the task had
  when the entry was computed` (monotone: cases are append-only, and a late note turns an accepted
  artifact into a case). An entry is FRESH when its watermark equals the current count for that task;
  among fresh entries for (task, taskVersion, coverDigest) the latest `at` wins. Any new solved case
  makes every entry stale for that task, which is the intended granularity.
- **D8 — No write transaction around jev.** The lookup and stage 1 run inside `withStore` (no
  transaction held, `support.ts:75-84`); the jev call runs after stage 1 and outside any transaction;
  the persist is ONE `appendEvent` (its own tiny transaction, `store.ts events.ts:39-60`) AFTER jev
  returns. A crash between jev and persist loses the cache entry, never a fact.
- **D9 — Single-flight, bounded and honest.** In-process: a module-level `Map<key, Promise>` coalesces
  concurrent misses in one process. Cross-process (the real 1000-agent case is 1000 processes): after
  a miss, wait for a fresh entry up to `SINGLE_FLIGHT_WAIT_MS = 250` in short polls, then answer that
  call with the deterministic ranker. Two processes may both compute and both persist; duplicate
  entries are harmless (the fold takes the latest fresh one) and **no exactly-once claim is made**.
- **D10 — Fallback records nothing.** If jev throws, times out or answers unreadably, the call is
  served by `deterministicRanker` and NO `recall.ranked` entry is written, so the next jev-up call
  recomputes instead of inheriting a downgraded cache.
- **D11 — Audit, and what is not reproducible.** The entry records `task`, `taskVersion`, `cover`
  (the tags), `coverDigest`, `watermark`, `rankedBy: "jev"`, `model`, `usage` (input/output tokens when
  pi-jev reports them), `pool` (how many candidates stage 1 offered), the chosen case ids with their jev
  scores, and `at`. Like the alignment judgment, a jev-ranked result is RECORDED but not reproducible
  from the log alone — the deterministic stage is, and the spec says so plainly rather than implying
  determinism it does not have.

## Requirements

| Id | Requirement | Failure behaviour | Oracle |
| --- | --- | --- | --- |
| R1 | Stage 1 offers stage 2 at most `JEV_POOL = 20` candidates, the highest by the existing deterministic relevance (stable order). | A store with ≤20 cases offers all of them; with none, recall returns the deterministic empty answer and no jev call is made. | A fake jev that records its input sees ≤20 candidates, ordered by deterministic relevance; a cold store makes zero calls. |
| R2 | Stage 2 is ONE `evaluate` call whose questions are `score` questions keyed per candidate, with the fixed criteria and clipped fields (D2). | A throw, a non-`score` answer, a missing answer or a non-finite score makes the whole stage unavailable (never partial). | The fake jev asserts one call, ≤20 questions, every question `type: "score"`, and no field over the clip. |
| R3 | Selection prefers higher jev score, keeps deterministic relevance as the tie-break, and collapses near-duplicates so the returned exemplars are substantively distinct (D3). | Fewer distinct exemplars than N is a smaller `count`, never padding or repeats. | With three near-identical lessons and two different ones, the result contains the two different ones and at most one of the identical set; no two returned lessons share ≥0.8 Jaccard. |
| R4 | The cache key is (task, taskVersion, coverDigest, watermark) with the watermark = solved-case count (D7). | A different cover, task version or watermark is a different key: miss. | Recalling with tags [a,b] twice hits; with tags [a,b,c] misses once; after one new solved case misses once. |
| R5 | A FRESH entry is served with ZERO jev calls; a miss or stale entry runs both stages ONCE and persists exactly one entry. | Without a fresh entry and with jev unavailable, the deterministic answer is served and nothing is persisted. | Second recall at the same watermark: fake jev call count unchanged, answer identical. A new solved case: exactly one more call and exactly one more entry. |
| R6 | The persist happens after the jev call and outside any write transaction (D8). | A persist failure leaves the answer intact (the call already succeeded) and writes nothing. | A store stub that fails the `appendEvent` still returns the jev-ranked payload; no partial row is present. |
| R7 | Single-flight bounds a cold miss (D9) and makes no exactly-once claim. | Concurrent callers in one process share the computation; across processes one may fall back deterministically. | Two concurrent calls in one process produce ONE jev call; a cross-process-style call that finds nothing within the wait still answers (deterministically) and does not throw. |
| R8 | Shapes unchanged: `RecallSet`, `RecallPayload`, `RecallEnvelope`, the op=recall arguments, the six-key result, and `recallExperience`'s synchronous contract. | — | Every existing recall/ranker/tool test passes unchanged; the envelope key set is untouched. |
| R9 | Audit fields recorded per D11; a jev-ranked entry is explicitly not reproducible. | An entry whose payload does not parse is ignored (stale-equivalent), never repaired. | The persisted payload validates against its schema and carries model/usage/cover/watermark/pool; a malformed entry in the log is skipped and recomputed. |
| R10 | No new store table, no migration, no `STORE_SCHEMA` change, no new dependency (pi-jev is already a dependency). | — | `git diff` shows no change under `src/store/`; `STORE_SCHEMA` is byte-identical; `package.json` unchanged. |

## Model

| Element | Owner | Valid states | Invariants | Requirement | Failure if absent |
| --- | --- | --- | --- | --- | --- |
| `DistinctRanker` (async seam) | `src/quality/ranker.ts` | selected / unavailable | never returns more than it was offered; never invents a case | R2, R3 | The jev stage would have no injectable boundary and no test. |
| `recall.ranked` payload schema | `src/types/learning.ts` | one entry per (key, computation) | derived, superseded never edited, watermark-versioned | R4, R9 | The cache would be un-parsable evidence in an append-only log. |
| `EVENT.recallRanked` | `src/runner/engine/types.ts` | one name | additive, no DDL | R10 | The event could not be written or scanned. |
| `recallRanked(options, input)` | `src/quality/ranker.ts` | fresh-serve / compute-and-persist / deterministic-fallback | one persist per computation; jev outside any transaction | R5, R6, R7 | Callers would each re-implement the cache. |
| `JEV_POOL`, `JEV_CLIP`, `DUPLICATE_JACCARD`, `SINGLE_FLIGHT_WAIT_MS` | same file, beside the existing frozen constants | positive integers / 0..1 | fixed in code, never agent-set | R1-R3, R7 | The bounds would be magic numbers in a function. |

## Exclusions

- Changing `collectCases`' full-log scan (research §1 flags it; bounding it changes ranking results and
  belongs to its own unit).
- The brief's own `recallFor`/`briefRecall` path (it builds a `RecallSet` of notes with its own
  windows and already honours N=5); this unit's port work is the op=recall / refusal path.
- Making `op=recall` require jev, or changing its argument schema; caching across projects (one store,
  as today); a table, an index or any migration; exactly-once guarantees for the persist.

## Open questions

1. **D6, the mechanism — owner confirmation.** Recommendation: the `recall.ranked` event fold
   (research §4). The alternative (a table) is refused for the migration cost, not for taste.
2. **D10, persist-on-failure.** Recommendation: persist nothing. Alternative: persist a
   `rankedBy: "deterministic"` entry plus an upgrade rule when jev returns — more code, and a cache that
   can serve a downgraded answer after an outage.
3. **Is op=recall jev-backed by default?** Recommendation: yes, with the deterministic fallback, since
   that is the point of the unit; the cost is one model call on a cold miss per (task, cover, watermark).
