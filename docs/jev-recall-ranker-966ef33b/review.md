# Review — jev distinct-exemplar recall (jev-recall-ranker) — G3

## G3 implementation review — attempt 1 — PASS — 2026-10-30T19:29:57Z
subjects (sha256, first 16):
spec.md fe03b789e3c88053
ranker-jev.ts aa141adbff190809
learning.ts 87e2223a96834c7d
jev-ranker.test.ts d01a7343600e947c
README.md 0d760343bdd69c7a
reviewer: lead (session). independence: independent of the author (wB:p22).

verified (commands run this session, not reported-only):
- `npm run check` (tsc) → exit 0; `npm test` → 292 pass / 0 fail (284 + 8).
- STORE UNTOUCHED: `git diff --stat src/store` empty; `STORE_SCHEMA` still "praxis.store/v2". No table, no
  migration; R10 held. Scope is the 5 quality/pi/types files + the new ranker-jev.ts + README + test + docs.
- `recallRanked` read in full: empty pool/task → deterministic (zero jev); a FRESH watermark entry → served
  from cache with ZERO jev; a miss → in-process single-flight (Map<key,Promise>) + bounded cross-process wait
  (awaitPublished, 250ms) → ONE stage-2 evaluate; jev throw/timeout/unreadable → catch → deterministic and
  NOTHING persisted; the persist is its own small transaction AFTER jev (D8), and a write failure is caught so
  it costs only the cache. jev runs between the withStore read and the separate appendEvent write — never inside
  a held transaction.
- RecallRankedSchema stores ONLY ids (cover tags, coverDigest, rankedBy:"jev", model/usage/pool, and
  chosen[{instance, step, version, jev}]) — NO lesson text; the note event remains the single owner of the
  lesson body. Correct under one-owner-per-fact.
- `recallExperience` is still `export function` (sync, line 296), unchanged and the fallback implementation;
  op=recall and the refusal path `await recallRanked(...)`; recallFeedback stayed try/catch-wrapped so a ranker
  fault cannot cost the typed refusal.
- Distinctness is deterministic (Jaccard>=0.8 collapse) over jev-ordered candidates — the honest hybrid, since
  pi-jev has no pairwise question; R3 test asserts no returned pair >=0.8 and both distinct lessons kept.
- Tests R1-R10 present and meaningful: <=20 pool / one call / all score / clipped; cold store zero calls;
  distinct-not-echoes; key (order-independent cover, extra-tag miss, new-solved-case miss); fresh second recall
  ZERO calls and deep-equal; write-failure still returns the answer; in-process concurrency ONE call; jev-down
  deep-equal to the deterministic payload with nothing cached. Existing recall/ranker/tool/refusal tests pass
  unchanged (they exercise the deterministic fallback under the no-network stub).

honest notes (not blockers): a fresh hit still does cheap local scans (watermark + entry lookup) — only the jev
call is cached, which is the cost the scale concern targets. The two bugs the engineer caught (task REF vs
TaskConfig.id in the key; digest clipped to 16 hex) are the kind a silent cache-only catch would hide — the
"second recall still called jev" oracle caught them, which is the right test.

verdict: PASS. A shared, persisted, distinct-exemplar recall that costs one jev call across many agents, never
blocks, never fabricates, keeps the note the owner of the lesson, and adds no table/migration/dependency — the
owner's scale design landing at its minimal shape. Release to commit.
