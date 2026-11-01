# Research — a jev-backed, distinct-exemplar recall ranker with a persisted lazy cache

Task: jev-recall-ranker · Hash: 966ef33b · Gate: G1 · Date: 2026-10-30
Method: read the recall path, the pi-jev seam, the store's schema/identity mechanism and the bar fold.
Every claim cites `path:line`. Nothing here is executed behaviour; the numbers are quoted from code.

## 1. The ranker and its port

- `RankerPort` — `src/quality/ranker.ts:69-81`: `rank(input: { need: QueryNeed; candidates: readonly
  ExperienceCase[] }): RankedCase[]`, **synchronous**. The comment already names the intent: "a
  jev-relevance ranker is a future drop-in behind this shape" (`:9-10`, `:68`).
- `deterministicRanker` (`ranker.ts:90-…`) reuses the brief's ONE scorer, `scoreCandidate`
  (`src/quality/recall.ts:139`), with the need's tags as the cover set.
- `collectCases` (`ranker.ts:154-227`) assembles cases from the log: an `artifact.accepted` with no
  `failed` flag that has BOTH a `quality.verdict` at that version and a `learning.note` with a
  subjective half (`:196-200`). **It scans the whole log** (`scanEvents`, `bar.ts:90-107`) with no
  limit — the "recent window" in the brief is the *recall.ts* paths (`RECENT_NOTES = 40`,
  `RECENT_VERDICTS = 20`, `recall.ts:33-34`), not this one. So stage 1 bounds the JEV input (≤20) but
  its own read is O(log); recorded as a fact and a follow-up, not changed here.
- `recallExperience` (`ranker.ts:291-308`): **synchronous**, `withStore` → `loadInstance` →
  `assertObserver` → `collectCases` → `ranker.rank` (injectable via `setRankerForTest`, `ranker.ts:23`)
  → `applyBounds(ranked, max)` (≤ `max` cases, ~1200-token budget, `ranker.ts:257-286`). It writes
  nothing.
- `src/quality/recall.ts` is the BRIEF path, not this port: `recallFor` (`:286-302`) builds a
  `RecallSet` (`bar`, `weakSet`, `notes`) from a weak set and `RECALL_MAX = 5` notes (`:30`);
  `briefRecall` (`:304-325`) records `EVENT.recallSelected` once per (instance, step) — an existing
  precedent for recording a derived/disclosure fact as an event.
- Counts/cover the locked design wants already come from the CALLER: `recallExperience`'s `tags`
  default to the step's rubric ids (`ranker.ts:302`, i.e. ALL dimensions) and `max` defaults to 5;
  the refusal path passes the failed dimensions and `max: 3` (`src/pi/operations.ts` `recallFeedback`).
  So N=5@start and N=3@refusal need no new plumbing.

## 2. The pi-jev seam

- `src/quality/jev-align.ts:84` — `JevAlignOptions { evaluateFn?: typeof evaluate; model?: string }`;
  `:95` — `const run = opts.evaluateFn ?? evaluate;`. Tests inject a fake; production uses pi-jev's
  `evaluate`. This is the seam to reuse: no new dependency, and the same injection pattern is already
  accepted in this repo.
- The wire contract (`node_modules/pi-jev/dist/src/types.d.ts:1-46`): `evaluate({ state, questions,
  model? })` → `{ model, answers, usage? }`; a question is `choice` (`criteria: Record<key,string>`),
  `noul`, or `score` (`instructions`, `criteria: string[]`); an answer is the matching shape with an
  optional `confidence`. **There is no pairwise/list question type** — a single call can ask up to N
  independent `score` questions keyed by id, and nothing more.
- Consequence for "N most substantively distinct": jev can score each candidate's *distinctiveness and
  usefulness* in one call, but it cannot compare candidates with each other. Pairwise distinctness
  must therefore be completed deterministically (a near-duplicate collapse over the lessons), which
  is also what guarantees N *different* exemplars rather than N echoes. The spec pins this hybrid.

## 3. The bars as the event-fold precedent (and the store's identity mechanism)

- `scanEvents` (`bar.ts:90-107`) reads any event types across every instance in one total order
  (`ORDER BY at, instance, seq`), SQL-filtered by `type IN (...)`.
- `barAt` (`bar.ts:165-172`) folds the raise events up to an instant; `effectiveBars` (`:181-189`)
  folds per scope with an identity key (`scope` + `key`). A raise is `appendEvent`-ed on the
  triggering instance (`bar.ts` `decideRaise` → `appendEvent(store, raised.instance, ...)`).
- `EVENT` (`src/runner/engine/types.ts:6-21`) is a plain `const` registry of event names — adding one
  is a code change with **no DDL**.
- The store's own schema identity: `STORE_SCHEMA = "praxis.store/v2"` (`src/store/db.ts:18`), applied as
  `CREATE TABLE IF NOT EXISTS …` statements (`:20-78`), then `INSERT INTO meta(schema)` +
  **a hard identity check that fails closed** (`:150-158`: `store schema mismatch … { found, expected }`).
  So adding a TABLE means new files get it silently while **existing files hard-fail** unless the
  identity is bumped AND a migration rewrites `meta` — the migration question is an open vision §13
  gate, exactly as the lead said.
- `event` rows are append-only in the database by trigger (`db.ts:72-77`): a cache entry cannot be
  edited, only superseded — which is the right shape for a derived, watermark-versioned record.
- Transaction discipline: `withStore` (`src/runner/engine/support.ts:75-84`) opens and closes the
  store and **holds no transaction**; `appendEvent` (`src/store/events.ts:39-60`) wraps its own tiny
  `transact`. So a jev call can run between them with no write transaction open.

## 4. Event-fold vs new table — evidence and recommendation

| | `recall.ranked` event (fold) | New table |
| --- | --- | --- |
| DDL | none (`EVENT` registry + a payload schema) | `CREATE TABLE` + `STORE_SCHEMA` bump |
| Existing stores | keep working; the new type simply has no rows yet | **hard-fail** on the identity check (`db.ts:150-158`) unless a migration runs → opens vision §13 |
| Rebuildable | yes, by construction: delete-free, supersede by a newer entry | yes, but the table becomes a second place a fact lives |
| Read cost | one SQL scan filtered by type (`scanEvents`), O(entries of this type) | one indexed SELECT |
| Audit | the entry is in the same immutable log as everything else | a separate mutable surface |
| Retention | grows with (task, cover, watermark) changes — bounded by solved cases | same, but deletable |
| Precedent | bars (`bar.raised` → `barAt`/`effectiveBars`), `recall.selected` | `instance` (mutable), `publication` |

**Recommendation: the event fold.** It needs no migration, reuses the exact mechanism the adaptive
bars already use, keeps the cache rebuildable and non-authoritative, and avoids opening the
store-migration gate for a performance cache. The honest costs: log growth proportional to solved
cases (not to recall calls), and a read path that scans this event type — acceptable because retention
is keep-all by design and the scan is type-filtered.

## 5. Unknowns

- **Cross-process single-flight**: "1000 agents" are 1000 PROCESSES sharing a file; an in-process
  promise map cannot coalesce them. The most that is honest is: in-process coalescing, a bounded wait
  for a fresh entry, then the deterministic answer for that one call. Duplicate `recall.ranked` rows
  are possible and harmless (the fold takes the latest fresh entry). No exactly-once claim.
- **jev latency/cost** is unmeasured here; the call is bounded to ≤20 questions with clipped lessons.
- **Watermark**: a solved-case COUNT per task is monotone (cases are append-only; a note arriving
  later turns an accepted artifact into a case) and cheap to compute from the same `collectCases`
  the ranker already runs. A timestamp watermark would be finer but needs the cases' `at` to be
  totally ordered across instances — the count is simpler and cannot go backwards.
- **Ranker result shape**: stage 2 cannot return more than stage 1 gave it, so a store with 3 cases
  yields ≤3 exemplars no matter what jev says.
