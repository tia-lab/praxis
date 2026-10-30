# Spec — bounded experience-query

Task: experience-query · Hash: 05d58a5d · Gate: G2 · Status: draft · Date: 2026-10-30
Contract: `research.md` §0 (the hash input). Research: `research.md` (F1–F8).

## Outcome

An agent that is stuck can ask Praxis for **similar solved cases in this project**, state its need in
its own words, and receive a small, bounded, deterministically ranked list — highest first — where
each case carries the lesson and its provenance (task, step, version, artifact digest, the agent that
wrote it). The query reads; it never writes. Ranking is deterministic today and sits behind a port so
a jev-relevance ranker can be dropped in later as an opt-in.

## Decisions

### D1 — Where the query enters: a new op `recall` (RECOMMENDED, contract change)

Add **`op=recall`** to the tool. Stated plainly: this is a tool-contract change — one more op, one
optional argument block, one return envelope — and it is owner-visible.

Why an op and not an extension of the brief:
- the brief's learning payload is a pure function of the store, asserted byte-for-byte (F7); an
  agent-parameterised query inside it would break that invariant;
- a query is *agent-initiated and repeatable*: the agent asks when it is stuck, with a need that is
  not necessarily the current step's task;
- an op is discoverable exactly where the other ops are (the descriptor's `ops` list), returns its
  own bounded envelope (the six-key result is untouched), and can be refused with the codes that
  already exist.

Why the name `recall`: it is Praxis's own word for this operation (`recallFor`, `briefRecall`,
`escalatedLesson`, `RecallSet` — F1). `search` would imply text search or semantic similarity,
which this unit does not build and the owner has not authorized.

### D2 — The ranker port (`src/quality/ranker.ts`), deterministic first

```ts
export interface QueryNeed { text: string; tags: readonly string[] }
export interface ExperienceCase {
  instance: string; task: string; taskVersion: number; step: string; version: number;
  digest: string; outcome: "pass" | "continued-failed"; score: number; mean: number;
  flagged: string[]; writtenBy: string; at: string;
  lesson: { whatWrong: string; whatRight: string; whatBetter: string; tags: { dimension: string; lesson: string }[] };
}
export interface RankedCase extends ExperienceCase {
  relevance: { need: number; outcome: number; corroboration: number; recency: number; margin: number };
  score2: number;   // the weighted sum, 0..1, deterministic
  reason: string;   // which signal carried it
}
export interface RankerPort { rank(input: { need: QueryNeed; candidates: ExperienceCase[] }): RankedCase[] }
export function deterministicRanker(): RankerPort
```

- **One scorer, not two.** `deterministicRanker` uses the SAME weights and the SAME normalized
  signals as the brief: `RECALL_WEIGHTS` (`src/quality/recall.ts:22`), the outcome mapping, the
  corroboration saturation, recency by bar level, and score margin. The only change to
  `recall.ts` is that its per-candidate scoring (today private, `candidates` at :119, relevance at
  :159) is **extracted** into a shared function whose "cover set" is a parameter: the weak-set for
  the brief, the caller's need tags for the query. Extraction, not a second implementation.
- **Per-candidate bars from that candidate's own task.** A case's margin is measured against its own
  task's effective bars (`effectiveBars`, `src/quality/bar.ts:175`). The PORT stays pure —
  `rank({need, candidates})`, no store — so the store-derived bar context (`barThen`, `levels`, the
  per-dimension corroboration counts) is attached to each `ExperienceCase` when `collectCases(store)`
  reads the log, and is not returned to the caller.
- **Injected for tests, replaceable later.** A test passes a fake `RankerPort` (the same seam shape
  as the scorer, the alignment judge and the hooks). A **jev-relevance ranker is a future drop-in
  through this port** — not built here, and `jev-search` is explicitly **not** a dependency (it is
  `.dev` reference only; adopting it needs its own inspection and owner approval).

### D3 — The query input and the bounded result

`op=recall { instance, need, tags?, max? }`

| Arg | Rule |
| --- | --- |
| `instance` | required: the routed authority check needs it (a stranger is `INSTANCE_FORBIDDEN`) |
| `need` | required, 1..500 chars: the agent's own words for what it is stuck on |
| `tags` | optional, ≤8 rubric dimension ids; defaults to the current step's rubric ids |
| `max` | optional, 1..10, default 5 |

Result (its own envelope, `RecallEnvelopeSchema` — the six-key start/submit result is untouched):

```json
{ "need": "<echo>", "count": 2, "truncated": false,
  "cases": [ { "score": 0.81, "relevance": {"need":1,"outcome":1,"corroboration":0.5,"recency":1,"margin":0.6},
               "provenance": { "instance":"i…", "task":"tasks/discovery/research", "taskVersion":3,
                               "step":"research", "version":2, "digest":"sha256:…", "writtenBy":"pi-session:…", "at":"…" },
               "outcome":"pass", "lesson": {"whatWrong":"…","whatRight":"…","whatBetter":"…","tags":[{"dimension":"grounded","lesson":"…"}]} } ] }
```

Bounds, all enforced: at most `max` cases, at most ~1200 tokens of lesson text in total (each lesson
trimmed as the brief's recall trims one), never artifact bytes, never the event log, never another
instance's transcript.

**What counts as a solved case**: an `artifact.accepted` event with no `failed` marker, plus its
verdict, plus a `learning.note` whose `subjective` is present (F3). A **stub** note carries no lesson
and is excluded — surfacing "no lesson provided" as a lesson would be a lie with a score attached.

### D4 — Within-store only

The query reads **one store**: the project store `withStore` opens (`src/runner/engine/support.ts:29`),
scanned with the existing `scanEvents` (`src/quality/bar.ts:75`). There is no cross-project read today
and this unit adds none: cross-project similarity and federated memory are **Jung's**, and Praxis must
not become a federated memory authority (`docs/vision.md:21`, `AGENTS.md:518`, `AGENTS.md:558-559`).
A "global" ranker is out of scope by construction, not by policy alone: the code has no path to
another store.

### D5 — Nothing else changes

- **No store-schema change**: a solved case is assembled from events that already exist (F3, F5).
- **No new dependency**: the deterministic ranker is our own code; `jev-search` is not added.
- **No new result KEY**: the query's own envelope is its return; the six-key result is untouched.
- **No new Code**: a bad/absent `need` or `max` is `CONFIG_INVALID` at the args parse, an unknown
  instance is `INSTANCE_NOT_FOUND`, a stranger is `INSTANCE_FORBIDDEN` — all existing. If
  implementation finds a genuinely new refusal, the spec is amended first, not the union.
- **Read-only**: the query writes no event and no row. Consequence, stated as the audit story: the
  same store state and the same args reproduce the same ranking, so an audit is a re-run.

### D6 — Boundary

Read-only **experience retrieval** (P7): within-store, provenance-carrying, deterministic. It is not
cognition or reasoning (Occam), not cross-project synthesis or federated memory (Jung), not a
semantic search engine, and it grants no authority: the query answers with what the store already
recorded and nothing else.

## Requirements

| Id | Requirement | Failure behaviour | Oracle |
| --- | --- | --- | --- |
| R1 | `op=recall` exists with `{ instance, need, tags?, max? }` and returns its own `{ need, count, truncated, cases[] }` envelope; `need` is required (1..500), `max` is 1..10 (default 5), `tags` ≤ 8 ids. | a missing/empty/oversized `need`, or a `max` outside 1..10 → `CONFIG_INVALID` at the parse, nothing read | four negative parses assert `CONFIG_INVALID` and the field path; a valid call returns the envelope shape |
| R2 | A case is only reported when it is a real solved case: an `artifact.accepted` without `failed`, its verdict, and a note whose `subjective` is present. | a stub note, a continued-FAILED acceptance, or an acceptance with no note → excluded, not ranked low | a store seeded with one good case, one stub note, one continued-FAILED acceptance: only the good one is returned |
| R3 | Ranking reuses the brief's scorer: the same `RECALL_WEIGHTS` and normalized signals, with the caller's `tags` standing in for the weak-set, and each candidate's margin measured against ITS OWN task's bars. | a candidate whose task has no rubric → no margin signal (0), never a crash or a fabricated score | a unit test on the extracted shared scorer equates the brief's result and the query's result for the same inputs; a no-rubric task ranks without a margin |
| R4 | The port is injectable: a fake `RankerPort` replaces the deterministic one for tests, and the query path uses whatever the port returns, in the order it returns. | a throwing ranker → the op fails with the typed envelope, nothing read twice | a fake ranker returning reversed order is reflected exactly in the result |
| R5 | The result is bounded: at most `max` cases, at most ~1200 tokens of lesson text, each lesson trimmed; never artifact bytes, never the event log, never another instance's transcript. | over-budget candidates are dropped (not truncated mid-lesson), and `truncated: true` says so | a store seeded with 10 long lessons: `count ≤ max`, total lesson characters within the budget, `truncated` true |
| R6 | Each case carries provenance from the record itself: instance, task, taskVersion, step, version, artifact digest, the note's provenance agent and its timestamp. | a missing provenance field → the case is excluded (a case that cannot say where it came from is not evidence) | the returned case's provenance compared field by field with the seeded events |
| R7 | Within-store only: the query reads one store directory and has no path to another; no cross-project or federated read is added. | none available: the code has no such path | a review of the module's imports/stores (only `withStore`) plus a test that two separate project stores never appear in one result |
| R8 | Read-only: the query writes no row and no event. | any write during a query is a defect | all five table counts and the store file digest are identical before and after a query |
| R9 | No store-schema change, no new dependency, no new result key, no new `Code`. | a change outside `src/quality/ranker.ts`, `src/quality/recall.ts`, `src/quality/index.ts`, `src/pi/tool.ts`, `src/types/pi.ts` and `tests/` → out of scope, stop | `git diff --name-only` limited to the declared paths; `package.json` unchanged; the taxonomy test unchanged at 31 codes |
| R10 | The agent-facing surface teaches it: the skill gains one row and a short paragraph (when to use it, what it returns, and that it is this project's store only). | a skill that omits it leaves the op undiscoverable | the skill file read against the op list |

## Exclusions

- No cross-project, federated or global similarity — Jung's (D4).
- No jev ranker and no `jev-search` dependency; the port is the seam, the drop-in is a later unit with
  its own inspection and owner approval (D2).
- No new store table, event type, projection or index: the case set is a scan of the existing log
  (`scanEvents`), bounded by `RECENT_NOTES`-style reads.
- No semantic clustering, embeddings or keyword search — the ranking is the loop's own signals.
- No write, no cache, no recording of the query (Q3): a re-run is the audit.
- No change to the brief, the six-key result, the scoring, or any authority rule.

## Alternatives

- **A1 — extend the brief's recall block with the need.** Rejected: it breaks the brief's
  byte-for-byte determinism (F7) and would let an agent steer what the brief says every submit.
- **A2 — a keyword/BM25 or embedding search.** Rejected: a second scorer with no relation to the one
  the loop trusts, and a semantic layer that belongs to Occam/Jung, not here.
- **A3 — record every query as an event for audit.** Rejected for this unit: it makes a read a write,
  and the deterministic ranking is already reproducible by re-running (D5).
- **A4 — a CLI-only query.** Rejected: the agent that needs it works through the tool.
- **A5 — return whole artifacts.** Rejected: bytes are not lessons, and the parent must receive
  bounded results (R5).

## Open questions

- **Q5.** Whether `tags` should also accept free-text dimensions that are not the current rubric's
  (e.g. a dimension from another task). Proposed no for this unit: tags are rubric ids, which keeps
  need-coverage a lookup rather than a text match.
- **Q6.** Whether the same port should later serve the flow-level recall (Unit O7 sequencing) — out of
  scope here, and a flow-level loop needs its own unit.

## §4 note — not waivable

This unit adds a **tool op** (a contract change: op name, argument block, return envelope) and touches
the shared scorer, so the §4 waiver does not apply: G2 must pass before any code, and a plan is
required.

amended 2026-10-30 — D2 clarified: the port is PURE (`rank({need, candidates})`, no store) and the
store-derived bar context is attached to each `ExperienceCase` at `collectCases` time — same intent,
the concrete shape the implementation needed; no code change, no requirement changed.
