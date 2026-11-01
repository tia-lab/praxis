# Per-dimension + global bars — plan

## Owner decisions (frozen)
- Acceptance = **per-dimension floors AND a global floor, BOTH must pass.**
- **Global = MEAN** of the dimensions, with its own adaptive ratchet.
- Each dimension **self-governs**: its own floor and its own ratchet.
- **Warmup**: no raise of ANY scope until the task-version has **>= 10 genuine observations** (so the mean is meaningful and we stop ratcheting too eagerly).
- **Extensible**: adding a dimension = drop in its floor; it ratchets only after its own warmup; the other scopes are untouched. “Extend judgment indefinitely without changing anything.”

## Model
**Acceptance** (replaces `MIN >= bar`):
```
pass iff (for every dimension i: score_i >= b_i) AND (mean(scores) >= B)
```
where `b_i` = effective per-dimension bar (seed `dimension.floor`, ratchets), `B` = effective global bar
(seed `quality.threshold`, ratchets). MIN stays the reported headline score; the GATE now uses the
compound above.

**Ratchet** (run independently per scope — each dimension + `global`), only AFTER warmup:
window `W=5` of that scope's genuine-pass values; raise when lower-quartile headroom `>= 0.12` AND
`stdev <= 0.08` AND `meanAttempts <= 2` AND cooldown elapsed; step `min(0.05, 0.5*(margin-0.12))`;
never auto-lower; a full post-raise window with no pass emits `bar.contested`.

**Warmup**: `effectiveBar(scope)` = its seed floor until the task-version has `>= WARMUP_MIN (10)`
genuine observations; below that, no ratchet is evaluated for any scope.

## Why MEAN-global is non-redundant
Per-dimension floors catch one weak dimension; the global MEAN bar catches *uniform mediocrity*
(every dimension scraping its own floor). A 0.68/0.68/0.95 that clears each floor can still fail the
mean gate — and once a dimension's own bar ratchets up (grounded proving ~0.80 -> bar ~0.75), a later
0.68 grounded REFUSES and the attempt budget forces rework. That is the anti-mediocrity lever.

## Changes
- **schema**: `DimensionSchema` gains optional `floor` (defaults to `quality.threshold` when omitted);
  `threshold` stays as the global MEAN seed.
- **bar.ts**: keep `BAR_WINDOW=5`; add `WARMUP_MIN=10`; `BarRaisedSchema`/`BarContestedSchema` gain
  `scope: "global" | <dimensionId>`; `effectiveBar`/`recomputeBar`/`decideRaise`/`decideContest`
  become per-scope; add `effectiveBars(store, task, version, quality) -> { perDimension: Map<id,number>, global }`.
- **gate / quality-loop**: the `qualityFloor` check -> the compound (all dims >= their bar AND mean >=
  global bar); the refusal diagnostic names which dimension(s) and/or the mean failed and by how much.
- **verdict**: carry `mean` alongside `score` (MIN) so the gate and audit are reproducible.
- **recall `weakSetFor`**: “below bar” uses the per-dimension bars (otherwise unchanged; recency-weighted mean stays).

## Migration
- Adding `floor` changes `research.json` -> task **v3** (fresh lineage). The disposable `/tmp` experiment
  restarts under v3 with the new model; the single legacy `bar.raised` (0.60->0.63) does not carry over.
- A scope-less legacy `bar.raised` (if ever read) is interpreted as `global` for back-compat.
- Repo tests updated to the compound model.

## Acceptance (this unit)
- `tsc` clean; full suite green under the no-network stub (bar/recall/quality-loop tests updated).
- New tests: (a) **warmup** — < 10 obs never raises any scope; (b) a **per-dimension** bar raises
  independently of the global; (c) **compound acceptance** — an artifact with one dimension below its
  ratcheted bar REFUSES even when the mean is high, AND a uniformly-floor artifact REFUSES on the mean
  gate; (d) **extensibility** — adding a 4th dimension at floor 0.60 disturbs no other scope's bar and
  ratchets only after its own warmup.
- **Live probe after merge**: restart the experiment under v3; confirm (i) no raise before 10 obs;
  (ii) a 0.68-grounded submit REFUSES once grounded's bar has ratcheted; (iii) the mean gate refuses a
  uniformly-floor artifact.

## Lead calls (owner-overridable)
- `dimension.floor` defaults to `threshold` when omitted; one `bar.raised` event type with a `scope`
  discriminator; warmup = 10 applies per scope; the experiment store is reset under v3.

## Not in scope
MIN stays the reported headline score; the scorer, `RECALL_WEIGHTS`, other tasks' rubrics (unless they
add a `floor`), and any identity/isolation/exactly-once claim are untouched.

## Final locked decisions (owner, 2026-10-30)
- **Per-dimension tolerance = 5 absolute points, FLAGGED.** Accept a dimension down to `b_i - 0.05`;
  that pass is flagged and the agent's note must tag that dimension as underperforming. Below
  `b_i - 0.05` = hard refuse on that dimension. (10 pts was rejected as too weak.)
- **Global MEAN gate is HARD** (no tolerance) and enforces compensation: a 0.05 sag in one dimension
  must be paid back elsewhere or the mean fails.
- The 0.05 band is an ACCEPTANCE concept only — the ratchet still works on raw scores vs bars.
- **Bars keyed by dimension identity (id + statement), global by dimension-set.** Add a dimension → it
  warms from its floor, unchanged dimensions INHERIT their earned bars, the global RE-WARMS. Remove →
  removed bar dormant, remaining inherit, global re-warms. Edit a statement → that dimension resets +
  global re-warms. (Full-reset-on-any-change was rejected — it throws away learned competence.)
- Warmup `WARMUP_MIN = 10` genuine observations per scope before any raise.
- Note-gate: an accepted verdict carrying flagged dimensions requires the note to tag each flagged one.