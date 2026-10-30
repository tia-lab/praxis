# Spec — EMA ratchet for every quality bar

Task: ema-ratchet · Hash: c6dbbfaf · Gate: G2 · Status: amended, owner-decided (D3 = ALL SCOPES) · Date: 2026-10-30
Amends `docs/execution-learning/DESIGN.md:198-232` (§7, O2) and
`docs/per-dimension-bars/PLAN.md:15-25` for **every** scope: one EMA rule, one formula id (D3, D6 —
amended 2026-10-30 by owner decision, see §"Amendments").

## Outcome

Every quality bar — the global (MEAN) bar and each dimension bar alike — stops ratcheting on a
pessimistic five-pass snapshot and starts tracking the **smoothed level** of genuine passes: a
nine-period EMA of that scope's own genuine-pass values, consulted under the existing warmup and
cooldown, moves the bar toward that level in the existing 0.01–0.05 steps. The ratchet is preserved
exactly — the effective bar is `max(current, EMA)`, so a recent dip can never lower an earned bar and
nothing auto-lowers. The seeds (`quality.threshold`, `dimension.floor`), the tolerance band,
`compoundDecision`, `bar.contested`, the ceiling, the warmup, the event log format and every store and
flow document are unchanged.

Boundary: this changes **how far and how often** the global bar rises, not **what acceptance means**
(`compoundDecision` is untouched), and it adds no new owner of any fact — the bar stays a fold of
`bar.raised` events over the append-only log.

## Frozen decisions

- **D1 — the value a pass contributes (the "high").** One genuine pass contributes its own value for
  the scope: for `global`, the pass's **MEAN over its dimension scores** (exactly the input used
  today, `src/quality/bar.ts:349`). A genuine pass is already the high side of the evidence (it is a
  *pass*); failed attempts and continued-FAILED artifacts contribute nothing. "High" therefore names
  the fact that only admitted passes enter the series — it is **not** a maximum.
- **D2 — the recurrence.** `alpha = 2/(N+1)`, `N = 9` → **alpha = 0.2**; `ema_1 = v_1`;
  `ema_t = alpha*v_t + (1-alpha)*ema_{t-1}`, over the scope's genuine passes in log order (the array
  `bar.ts:349-355` already builds). Half-life 3.11 passes; a level shift is ~87% absorbed after nine
  passes. **Seeded with the first observation**, not with the seed bar, so the EMA is a property of the
  evidence.
- **D3 — SCOPE: ALL SCOPES (owner decision, 2026-10-30).** The EMA rule applies to the global
  scope and to every dimension scope, uniformly, under one formula id. The per-dimension bars are real
  gates, not decoration: acceptance is `compoundDecision`, where every dimension must satisfy
  `score_d >= bar_d - DIMENSION_TOLERANCE` **and** the mean must clear the global bar
  (`src/quality/bar.ts:294-307`), so a dimension bar that tracks only a pessimistic five-pass snapshot
  gates work that has already reached the level. Each dimension's EMA is computed from **that
  dimension's own scores**, never from the mean.
- **D4 — the ratchet.** `to = round4(min(BAR_CEILING, current + min(BAR_MAX_STEP, max(0, ema - current))))`
  and a raise is emitted only when `to > current` **and** `ema - current >= BAR_MIN_STEP` (= 0.01).
  Equivalently: the effective bar is `max(current, EMA)`, approached in steps of at most 0.05 and
  ignored when the gap is under 0.01. A dip leaves `ema < current` → no event, no change.
- **D5 — what still gates a raise.** Unchanged and load-bearing: warmup (`WARMUP_MIN = 10` verdict
  observations of the scope, `bar.ts:37,389-390`), the cooldown (a raise only once `BAR_WINDOW = 5`
  new genuine passes have accumulated since the last one, `bar.ts:392-393`), the effort gate
  (`mean attempts <= BAR_MEAN_ATTEMPTS_MAX = 2`, `bar.ts:420`) and the ceiling (`0.9`). **Retired for
  every scope** (O1, owner decision 2026-10-30): the 0.12 lower-quartile margin (replaced by the EMA
  level itself) and the stdev gate (the EMA *is* the noise filter — a volatile series raises only toward
  its smoothed level, never to its best pass).
- **D6 — identity and replay: ONE formula id.** `BAR_FORMULA_ID` becomes `praxis.bar.ema/v3` for every
  scope; there is no mixed v2/v3 model. A raise records the EMA that decided it (R6). Replaying the same
  log yields the same bars.

## Requirements

| Id | Requirement | Failure behaviour | Oracle |
| --- | --- | --- | --- |
| R1 | **The EMA series.** For a scope, the series is its genuine passes in log order (the `scope.passes` array, `bar.ts:349-355`); `ema` is computed by D2 over that series, in `round4`. | Fewer than one pass → no EMA → no raise (`held`: `"no genuine passes"`). A malformed pass value (outside `[0,1]`) cannot occur: scores are schema-validated verdicts; if it did, the fold refuses as today (`parseWith` on the record). | A synthetic five-pass log at a known level yields the exact `ema` (assert `round4` value); a single pass yields `ema == that pass's mean`. |
| R2 | **The ratchet.** `to = round4(min(0.9, current + min(0.05, max(0, ema - current))))`, emitted only when `to > current` and `ema - current >= 0.01`. The bar never decreases: a pass series below the bar produces **no event** and leaves `effectiveBars` unchanged. | If the fold would produce `to <= current` (e.g. at the ceiling) the decision is `held` with a reason and nothing is appended. | (a) A high series raises the global bar by the capped 0.05. (b) A series below the bar appends nothing and the fold returns the same bar. (c) A series exactly 0.005 above leaves the bar alone (`held`). (d) After a raise, a dip series leaves the bar at the raised value and emits no `bar.raised`. |
| R3 | **Warmup unchanged.** No global raise before `WARMUP_MIN = 10` verdict observations of the scope's composition. Below that the decision is `warming` with the count, exactly as today (`bar.ts:389-390`). | None: the decision is a report, not an error. | A log with 9 observations and a maximal EMA yields no raise (`warming`, `observations: 9`); the 10th observation permits one. |
| R4 | **Cooldown unchanged.** A raise is only considered once `BAR_WINDOW = 5` genuine passes have accumulated after the last raise of that scope; the EMA is computed over the full series, not the window. | Short window → `held: "cooldown"` (the existing `no full window` reason), no event. | Two raises on a long strong series are exactly five passes apart; a fourth pass after a raise raises nothing. |
| R5 | **Contested preserved.** A raised global bar followed by `>= BAR_WINDOW` verdicts with zero passes emits `bar.contested` once per `(scope, bar)`, with the same fields as today (`bar.ts:453-489`). It never lowers the bar. | Once already recorded for that bar value, none is appended a second time (`bar.ts:470-476`). | A post-raise window of five failed verdicts emits exactly one `bar.contested` at the raised value; a second evaluation emits none. |
| R6 | **Disclosure.** Every raise records `ema: { periods: 9, alpha: 0.2, value, samples }` **in addition to** the existing `window` block, and `formulaId = "praxis.bar.ema/v3"` for every scope. The `window` block stays as disclosure (its quartile and stdev are no longer decision inputs anywhere); `margin` records the EMA gap that decided the raise. | A raise whose record does not parse is refused (`RESULT_INVALID`, unchanged) and nothing is appended. | The recorded event parses against `BarRaisedSchema`; `ema.samples` equals the number of genuine passes of that scope at that instant; `ema.value` equals `round4` of the recomputed `emaOf`; `window` is still present; every raise in the log carries the same `formulaId`. |
| R7 | **Every scope uses the EMA rule, under one formula id.** The global scope and every dimension scope run the same `decideRaise` with the same constants; there is no mixed v2/v3 model and no scope-specific branch inside the formula. A dimension's EMA is computed from that dimension's scores. | A scope with fewer than one genuine pass computes no EMA → `held`, no event (the same rule for every scope). | `tests/quality/bar.test.ts` is re-derived for **both** families: the global and the per-dimension assertions both change; a test asserts that every recorded raise (global or dimension) carries `praxis.bar.ema/v3`. |
| R8 | **No schema change to the store or the flows.** The event log stays the generic row + JSON payload; `BarRaisedSchema` gains exactly one **optional** field (`ema`) so older records still parse; no task, flow or `Quality` document changes; seeds and `compoundDecision` untouched. | Old records without `ema` read exactly as today (`barAt` uses `to`/`at` only, `bar.ts:165-172`). | The suite's existing records parse; a synthetic pre-change `bar.raised` payload (no `ema`) still folds into the same bar; `git diff` shows no change under `src/types/schema.ts`, `src/store/` or `.pi/praxis/`. |
| R9 | **Determinism.** The same event log produces the same decisions and the same bars, with no dependence on wall-clock, map order or float noise (all recorded values `round4`). | — | Running `recomputeBar` twice over the same store appends at most one raise (the second sees the cooldown) and yields identical `effectiveBars`. |

## Model

| Element | Owner | Valid states | Invariants | Requirement | Failure if absent |
| --- | --- | --- | --- | --- | --- |
| `BAR_EMA_PERIODS = 9`, `BAR_EMA_ALPHA = 0.2` | `src/quality/bar.ts` constants, beside the existing frozen defaults (`bar.ts:33-49`) | positive integer, `0 < alpha <= 1` | `alpha == 2/(periods+1)` (asserted by a test, not by code) | R1, D2 | The recurrence would be a magic number in a function, untunable and undocumented. |
| `BAR_MIN_STEP = 0.01` | same file | `0 < min <= BAR_MAX_STEP` | never exceeds the step cap | R2, D4 | Every 0.001 EMA wobble would append a raise: log churn as noise. |
| `emaOf(values, periods)` | `src/quality/bar.ts` (pure helper, exported for the test) | empty → `undefined`; otherwise a number in `[0,1]` | monotone in the inputs; `ema(v) == v` for one sample; independent of array identity | R1 | The decision would re-implement smoothing inline and drift from its test. |
| `ema` field on `BarRaisedSchema` | `src/types/learning.ts` | absent (legacy record) or `{periods, alpha, value, samples}` | additive and optional only | R6, R8 | The raise would not be reproducible from the log, breaking `DESIGN.md:230-232`. |
| `decideRaise` (one function, every scope) | `src/quality/bar.ts` | raise / held / (contest decided separately) | never returns `to <= current`; no scope-specific branch | R2, R7 | The ratchet would be able to lower a bar, or the scopes would drift apart. |
| `BAR_FORMULA_ID = "praxis.bar.ema/v3"` | `src/quality/bar.ts` | one string for every scope | no second id | R6, R7, D6 | The log could not say which rule produced a raise, or would imply a mixed model that no longer exists. |

Nothing else is added: no new module, no new store table, no new event type, no new scope.

## Alternatives

| Alternative | Rejected because |
| --- | --- |
| EMA of **max-over-dimensions** per pass | The easiest dimension would set the level for the whole rubric; a task with one trivially-scored dimension would ratchet every bar to it. Measured against D1 (the MEAN is the score acceptance actually gates on). |
| EMA of **best attempt** per step | A bar must never rise because the agent needed three tries; it would invert the effort gate (`BAR_MEAN_ATTEMPTS_MAX`, `bar.ts:43`). |
| EMA of the **window maximum** (high-water mark) | An extreme order statistic: the EMA would converge toward the luckiest single pass, which is the exact failure the current lower-quartile rule was written to prevent (`DESIGN.md:216-217`). |
| Keep the 5-pass window, replace only the quartile with the window **mean** | The window resets at every raise (`bar.ts:392`), so after each +0.01 the evidence restarts; the level the work reached is never tracked. This is the "windowed-mean" behaviour D1–D4 replace. |
| **Global only, with a mixed v2/v3 log** (the recommendation this spec first carried) | Rejected by the owner: the per-dimension bars are real gates — acceptance requires `score_d >= bar_d - 0.05` for every dimension **and** the mean at or above the global bar (`bar.ts:294-307`) — so letting only the global bar track its level would leave the sharper, per-dimension gate anchored to a pessimistic five-pass snapshot, and two formula ids would record a mixed model nobody wants. |
| Auto-lower when the EMA falls (a "true" EMA bar) | Violates "never auto-lowers" (`DESIGN.md:226-229`); owner authority to relax a contested bar is untouched. |
| Recompute the EMA from the log on every read instead of folding raises | It already is a fold of the log plus a per-scope scan; adding a second derivation of the same number would give the fact two owners. |

## Open questions

- **O1 — RESOLVED (owner, 2026-10-30): retired for every scope.** D5 retires `stdev <= 0.08` and the
  0.12 lower-quartile margin everywhere: the EMA is the noise filter, and a volatile series raises only
  toward its smoothed level, never to its best pass. The `window` block is still recorded, as disclosure.
- **O2 — RESOLVED (owner, 2026-10-30): ALL SCOPES.** See D3, R7, D6 — one rule, one formula id, no mixed
  model. The per-dimension cases in `tests/quality/bar.test.ts` are re-derived in this unit.
- **O3 — `BAR_MIN_STEP = 0.01`.** Chosen so a raise is worth recording (the current smallest raise is
  also ~0.01, `DESIGN.md:222-223`). If the owner prefers a zero floor, the only change is D4's second
  condition; log churn is the cost.

## Amendments

- **2026-10-30 — owner decision: D3 = ALL SCOPES; R7 and D6 collapse to one rule, one formula id.**
  The first draft recommended the global scope only. The owner overrode it with the acceptance code in
  hand: acceptance is `compoundDecision`, where **every** dimension must satisfy
  `score_d >= bar_d - DIMENSION_TOLERANCE` and the mean must clear the global bar
  (`src/quality/bar.ts:294-307`), so the per-dimension bars are real gates and the EMA must make each
  one track the smoothed level of that dimension's own scores. Changed: D3 (scope), D5 (the 0.12
  quartile margin **and** the stdev gate retire everywhere, not only for the global scope), D6 (one
  formula id, `praxis.bar.ema/v3`, no mixed v2/v3 model), R6 (the EMA disclosure and the single id now
  apply to every raise), R7 (every scope uses the rule; the per-dimension test expectations are
  re-derived in this unit), the Model table (one `decideRaise`, one id) and O1/O2 (both resolved).
  Unchanged: D1 (the "high" is the scope's own value), D2 (alpha 0.2, N 9, seeded with the first
  observation), D4 (the ratchet and its 0.05 cap / 0.01 floor), D5's surviving gates (warmup 10,
  cooldown 5, mean attempts <= 2, ceiling 0.9) and O3 (`BAR_MIN_STEP = 0.01`). Recorded by the lead in
  `AGENTS.md`; the G2 PASS was amended accordingly. No requirement changed its oracle, only its scope.
