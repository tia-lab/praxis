# Recall steering + balance term — plan

**Evidence.** Four live runs on one store (research, v2), scores (grounded / covers-question / honest / MIN):
0.63/0.81/0.92/**0.63** → 0.73/0.73/0.94/**0.73** → 0.84/0.71/0.90/**0.71** → 0.88/0.68/0.95/**0.68**.
grounded climbs monotonically (+0.25); covers-question declines monotonically (−0.13); MIN peaked at
run 2 then **declined**. Every recall `weakSet` was `["grounded"]` — even at run 4 where grounded was the
strongest dimension. No `bar.raised`.

## Lever A — steering lag (PROVEN bug, ship now)
`src/quality/recall.ts::weakSetFor` ranks dimensions by a **plain mean** over the recent-verdict
window. A dimension's early low scores keep its mean lowest long after its recent trajectory
recovered. Over runs 1–3: grounded mean `0.733` < covers mean `0.750` → plain mean wrongly flags the
solved dimension; the loop fights the last war and MIN degrades.

**Fix:** replace the plain mean with a **recency-weighted mean** (newest verdict dominates;
`VERDICT_RECENCY_DECAY = 0.7`, weight `decay**(age)`). Recomputed on the same history: covers `0.739`
< grounded `0.758` → weakSet correctly becomes `["covers-question"]`. Surgical: one function + a helper,
~15 LOC. Everything else in `weakSetFor` unchanged. **This is the engineer unit dispatched now.**

**Acceptance:** fixture test with the exact run-1–3 numbers yields `["covers-question"]` not
`["grounded"]`; a genuinely-recently-lowest dimension still stays flagged; tsc clean; suite green.
**Live confirmation after merge:** rerun on the existing `/tmp/praxis-live-clean` store — expect the
brief's weakSet to flip to covers-question and covers-question to climb (MIN rises).

## Lever B — balance term (STAGED, owner confirm)
Nothing rewards parsimony: grounded reached 0.88 by piling on citations, with no penalty for bloat or
for the coverage it crowded out. The gate is pure minimums (no `maxItems`), and no dimension values
signal-to-noise. Proposed: add one dimension to `.pi/praxis/tasks/discovery/research.json`
`quality.dimensions` (data-only; bumps the task to v3):

> **`occam`** — *"Every included item earns its place: the artifact answers the question within its
> boundary with no padding — no off-topic source, no redundant or unverifiable claim, no filler.
> Irrelevant or unnecessary inclusions lower the score."*

Because overall = MIN, this is a hard brake: bloat caps the score and cannot be bought back by
over-grounding. Tension by design — `covers-question` pulls up (answer fully), `occam` pulls down
(don't pad). **Open:** the name (`occam` vs `parsimony`/`pareto`) and whether the 0.6 threshold needs a
look now that there are four MIN floors. **Decide after A's live result** — if A alone re-steers and MIN
climbs cleanly, B may be a refinement rather than a fix. Owner-overridable in one line.

## Not in scope
No change to bar.ts, the bar-raise formula, RECALL_WEIGHTS, schemas, the scorer, or any other task's
rubric. No identity/isolation/exactly-once claim.