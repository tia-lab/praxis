# Spec — a per-dimension quantile bar with an absolute floor

Task: quantile-bars · Hash: cbc26826 · Gate: G2 (amended) · Status: draft — owner review · Date: 2026-10-31
Predecessor: `research.md`. Implements the owner's F1–F7 and the seven FINAL locked decisions (amendments marked
**[A1]–[A7]**). Design only: no code, no store change, no dependency. The plan is `plan.md` (G3).

## 1. Outcome

One threshold per dimension, owned by the engine: `pass_d ⟺ score_d ≥ max(ABSOLUTE_MIN, Q_gate(d))`, with
`ABSOLUTE_MIN = 0.5` an engine constant, `Q_gate(d)` the measured `Q_p` of that dimension's own population, and `p`
from the dimension's optional `quantileGate` (default 25). PASS is the AND over dimensions. The global MEAN gate, the
Pareto cap and the tolerance band go away, as do all authored absolute thresholds. The quantile is derived on demand
from stored verdicts; only the raised bar is recorded, because monotonicity is a decision that must survive.

| Owner decision | Implementation |
|---|---|
| **F1** no global/mean/aggregate score | §3.8 gate; §6 ledger: global scope, mean check, Pareto cap deleted; the mean is never a gate input |
| **F2** PASS = pure AND | §3.8: `∀d score_d ≥ B_d`; no tolerance, no k-of-n, no weighting |
| **F3** no authored absolute threshold | §3.5 + **[A2]**: `quantileGate` authors a RANK (strictness), never a value; `threshold`/`floor`/`paretoThreshold` are deprecated and ignored, then removed from the 12 documents |
| **F4** calibration | §3.5: `CALIBRATION_MIN = 20`; before that the wall is `ABSOLUTE_MIN` |
| **F5** gentle low quantile over ALL scored work | §3.1–3.4: population = every instance's **carried** score; window 40; default `p = 0.25` |
| **F6** monotonic | §3.7: schema refinement `to ≥ from` **and** a max fold; no code path lowers a bar |
| **F7** never impossible, still rejects bad work | §3.9 T2/T3 with **[A1]**: `max(0.5, Q)` — good work clears the low floor, sub-0.5 work always fails |
| **[A1]** hybrid floor | §3.5/§3.8: the bar is stored floored at 0.5; `max(0.5, Q)` is the threshold in force |
| **[A2]** per-dimension quantile selector | §3.3/§4 R11: `quantileGate` integer 1–99, default 25 |
| **[A3]** Q50 learning flag | §3.8/§4 R12: a passing dimension below its own Q50 needs a lesson; no gate effect |
| **[A4]** quantiles derived, nothing stored | §3.3/§4 R13: no event, table, column or snapshot; Q50/Q75 computed on demand |
| **[A5]** metrics need no storage | §4 R14: `quality.verdict` already carries task/taskVersion/step/dimensions |
| **[A6]** Q75 exemplar band dropped | §4 R15: informational only if ever shown; never gates, never tags |
| **[A7]** keep monotone/calibration/population/AND/no-mean | §3.1–3.9 |

## 2. The tension, and its resolution

Monotonicity and never-impossible coexist because **the bar is never assigned an unconfirmed level**: every value it
takes is the `Q_gate` of a measured window (for a raise, the lower of two halves), floored at `ABSOLUTE_MIN`. At the
instant of assignment at least a quarter of that window already clears the measured part, and anything at or above
0.5 clears the floor. Monotonicity then only preserves the highest such value: it never compounds two of them and
never adds a step.

The hybrid closes the last hole **[A1]**. A measured `Q_gate` can fall *below* 0.5 on a weak rubric; letting the bar
follow it down would admit work the owner calls bad, and pinning it at 0.5 alone (without the quantile) would reject
good-but-still-weak work forever. `max(0.5, Q)` does neither: **sub-0.5 work can never pass (F7 strengthened), and
work at or above the hybrid threshold always can (T2 preserved).**

## 3. The math (exact)

### 3.1 The observation — one per instance

```text
x_(i,d) = the dimension-d score of the artifact version instance i CARRIED
          accepted version        when the step was accepted
          the best-scoring version when onFailure=continue carried a failure
          the last scored version  when nothing was carried (still an observation)
```

Excluded: `unavailable`/`error` verdicts (no score exists) and every attempt other than the carried one. One work
unit = one observation; counting attempts would weight failing work by its retries. **The population never depends on
the current bar** — that is the whole point.

### 3.2 The scope

`(task path, dimensionKey)`. `dimensionKey` already hashes the dimension's id **and its criteria** (`scope.ts`), so a
rubric edit re-keys exactly that dimension; an unchanged dimension inherits its population. No new identity.

### 3.3 The quantile **[A2] [A4]**

```text
p_d       = the dimension's quantileGate ?? 25        // integer percentile, 1..99
Q_gate(d) = sort(population_d).at(floor(p_d/100 * (n - 1)))   // empirical, lower side
```

- `p = 25` by default, chosen from the measured table (research §4): p25 gives **40.6 % (v6) / 45.3 % (v7)** carried-
  per-instance joint pass; p50 gives 9.8 % (the strangle); p60 5.3 %; p20 43.9 %.
- `quantileGate` authors **strictness only** — which rank of the same population. It cannot express an absolute
  level, so it cannot reintroduce the impossibility bug (the bar is still a quantile of live work, floored at 0.5).
- **Nothing quantile-related is stored.** The population is the `quality.verdict` log; `Q_gate`, `Q50` and `Q75` are
  computed on demand. The only recorded level is the bar itself (`bar.raised`), because monotonicity is a decision.

### 3.4 The window

`WINDOW = 40` observations, two halves of 20; `W_eff = min(40, n)`.

Why a window: the bar must track a genuine shift; a lifetime population would freeze early work into the floor
forever. Why two halves: a shift confined to the newest batch (a lucky streak) must not raise the bar, so **both
halves** must show it.

### 3.5 Calibration and the bar **[A1]**

| n (observations of the scope) | The bar in force |
|---|---|
| `n < 20` | **calibrating**: no measured bar exists; the threshold is `ABSOLUTE_MIN = 0.5`. The verdict records `calibrating: true`. |
| `n ≥ 20` | the folded bar `B_d` (see below), **always ≥ 0.5** |

```text
B_d = max(ABSOLUTE_MIN, last recorded raise.to)     // the fold; the floor is the default when no raise exists
```

**There is no seed event** **[A7]**: the floor is the default bar, and the first measured level is the first raise
from it. That first raise is the only one that can lock a bar forever, so it is never taken from a single window: it
becomes eligible at `n ≥ FIRST_RAISE_MIN = CALIBRATION_MIN + 2·FIRST_HALF = 28` and is confirmed on evidence the
estimate never saw (§3.6.1). If the measured quantile is below the floor, nothing is recorded and the bar stays 0.5 —
the measured value only ever *raises* above the floor, never lowers it.

`quantizeDown(x) = floor(x * 100) / 100` — the bar is reported to two decimals and at or below the measured quantile.

### 3.6 The raise rule

#### 3.6.1 The first raise — eligible at `n ≥ 28` (20 + 4 + 4)

The first raise can lock a bar forever, so it is decided on evidence the estimate never saw. Over the last
`FIRST_RAISE_MIN = 28` observations (oldest first, 0-based slices of `n`):

```text
E   = obs[n-28 .. n-9]    (20)   the estimate window — CALIBRATION_MIN
H1  = obs[n-8  .. n-5]    (4)    first confirmation half
H2  = obs[n-4  .. n-1]    (4)    second confirmation half
c   = max(ABSOLUTE_MIN, quantizeDown( Q_gate(E) ))
support(H, c)  ⟺  |{ x in H : x < c }| ≤ floor(p * |H| / 100)     // p=25, |H|=4 → at most 1 below, i.e. ≥3 of 4 at or above c
raise  ⟺  c ≥ ABSOLUTE_MIN + STEP (0.02)  ∧  support(H1, c)  ∧  support(H2, c)  ∧  the sample is STABLE (S3)
to = c
```

The index math is explicit: at `n = 28` the slices are `[0,20)`, `[20,24)`, `[24,28)` — the twenty calibration
observations and the eight that follow them, split 4 + 4. `FIRST_HALF = 4` and
`FIRST_RAISE_MIN = CALIBRATION_MIN + 2·FIRST_HALF = 28` are the only constants the guard adds; the support test
reuses the same percentile `p` as the bar (`quantileGate`, default 25).

#### 3.6.2 Steady state — a bar above the floor exists, `n ≥ 40` (two halves of 20):

```text
A   = the most recent 20 observations
Bw  = the 20 observations before A
c   = max(ABSOLUTE_MIN, quantizeDown( min( Q_gate(A), Q_gate(Bw) ) ))
raise  ⟺  c ≥ B + STEP (0.02)  AND  the rubric sample for this composition is STABLE (S3)
B' = c
```

Otherwise the bar holds. The adopted value is the **lower** half’s floored quantile, so after a raise at least a
quarter of *both* halves clears the measured part, and every observation ≥ 0.5 clears the floor. A bar moves only to a
measured, twice-confirmed level — never by a fixed step.

#### 3.6.3 Handover

The rule is selected by **state, not by n**: while no raise is recorded for the identity, the scope is in 3.6.1 (a
rolling 28, so a late first raise is still measured on the most recent work); once the first raise is written, every
later evaluation uses 3.6.2. Crossing `n = 40` with no bar does not fall back to the looser steady rule — the first
raise keeps its 8-observation confirmation until it happens.

### 3.7 Monotonicity (F6)

1. **The record refuses a decrease**: `bar.raised` gains the refinement `to ≥ from`; a decreasing raise fails to parse.
2. **The fold takes the maximum**: `B := max(B, raise.to)`, so even a legacy sequence cannot lower the effective bar.

No code path lowers a bar. `bar.contested` stays a signal (a full window at the bar with zero dimension-passes).

### 3.8 The gate and the learning flag **[A1] [A3]**

```text
pass_verdict  ⟺  ∀ dimension d:  score_d ≥ max(ABSOLUTE_MIN, B_d)        // B_d is already floored
flag_d        ⟺  score_d ≥ max(ABSOLUTE_MIN, B_d)  AND  score_d < Q50(d) // derived on demand, no gate effect
```

- No tolerance band, no mean, no Pareto cap: the bar cannot creep above the level work reaches, so the cap has nothing
  left to do.
- **The Q50 learning flag replaces the tolerance-band `flagged`**: a dimension that passed but sits below its own
  median is where the next lesson comes from. The note gate already requires a tag per flagged dimension; it is fed
  this derived set. Measured trigger rate: **62–69 % of passing verdicts** (25–28 % of passing dimensions) in v6/v7 —
  alive and discriminating, unlike a band the bars had already swallowed.
- The MIN headline stays on the verdict as a **reported** value; it never gates.

### 3.9 The proofs

**T1 — outlier immunity.** `Q_gate` of a 20-window is an order statistic; adding any value *above* it leaves every
rank at or below it unchanged. A spike cannot move the raise candidate (the EMA moved by `α·(v − B)`).

**T2 — reachability, hybrid form [A1].** Every adopted `B_d` is `max(0.5, c)` where `c` is the lower half’s `Q_gate`.
Hence (i) `B_d ≥ 0.5`, so no sub-0.5 work ever passes (F7 strengthened); and (ii) the measured part `c` was, at
confirmation, cleared by at least a quarter of both halves, so any population at least as good as the confirming one
clears it. `ABSOLUTE_MIN` therefore *preserves* T2 (good work always clears the low floor) while *strengthening* F7
(bad work below the floor always fails). The bar becomes unreachable only if the population falls below
`max(0.5, c)` — a population regression, which is the rejection F7 requires.

**T3 — strictness.** At confirmation the bottom `p`% of the window is below the bar and refused. Across five
dimensions the AND refuses roughly 60 % of the current population (measured 59 % in v6, 55 % in v7).

**T4 — survivorship-freedom.** The population is defined by the work, not by the decision: an instance enters it
whichever way the gate ruled. The fixed-point pathology of research §5 cannot arise.

**T5 — no single easy batch can raise the first bar (K3 closed).** The estimate window `E` and the two confirmation
halves are pairwise disjoint, so the observations that decide the first raise are never the ones that produced the
candidate. A raise needs 3 of 4 at or above `c` in *each* half — six of eight fresh observations, in two independent
groups. For a dimension whose true share at or above `c` is `s`, one half supports with probability `s³(4−3s)`, so
confirmation has probability `[s³(4−3s)]²`: **0.545 at s = 0.75** (a genuine level confirms within a couple of
windows) and **0.098 at s = 0.5** (a marginal one waits). An easy batch can therefore only *propose* a candidate,
and the candidate it proposes is a `Q25` of 20 — already spike-immune (T1). T2 holds: `c` is a `Q25` of `E`, so at
most 25 % of `E` lies below it, and both halves then show a 75 % share at or above it — the bar was reachable at
adoption. F6 holds: the first raise requires `c ≥ 0.5 + 0.02 > 0.5 = current`, so `to > from`, and the refine plus the
max fold keep every later state monotone. A failed confirmation is safe: the bar stays at the floor, the gentlest
reachable state.

**Corollary.** With `p = 0.25` per dimension, the independence bound is `0.75^5 ≈ 24 %` joint; measured 40.6 %/45.3 %
because the dimensions are positively correlated. The rule is distribution-free: its level is measured, its behaviour
is not.

## 4. Requirements

| R | Requirement | Failure behaviour | Oracle |
|---|---|---|---|
| R1 | **One observation per instance.** Population for `(task, dimension)` = the carried version's dimension score; every instance contributes at most one value, whatever the decision. | An instance with no scored version contributes nothing; a missing carried version falls back to its last scored version. | Replaying v6 gives **64** observations per dimension, not 132; a retried instance contributes one value. |
| R2 | **Quantile = `Q_gate`**, `p_d = quantileGate ?? 25`, lower definition `sort[floor(p/100*(n−1))]`. | An empty population has no quantile; the threshold is `ABSOLUTE_MIN`. | `Q25` of 20 values is the 5th smallest; of 64 the 16th; `quantileGate: 40` selects Q40 of the same population. |
| R3 | **Window = 40**, two halves of 20; `W_eff = min(40, n)`. | Below 20 no candidate; between 20 and 39 only the first-raise check. | n=39 → no two-half raise; n=40 → eligible. |
| R4 | **Calibration.** `n < 20`: threshold = `ABSOLUTE_MIN`, verdict records `calibrating: true`. | A dimension that never reaches 20 stays calibrating and uses the floor — it never blocks the flow on an unknown bar. | Fresh store: the first 19 instances carry `calibrating`; the 20th may write the first raise. |
| R5 | **Hybrid floor [A1].** The bar in force is `B_d = max(ABSOLUTE_MIN, folded measured)`; no bar can be below 0.5. | A stored raise below 0.5 is refused by the schema (and the fold floors it). | Every recorded `to` is ≥ 0.5; every threshold in force is ≥ 0.5. |
| R6 | **First raise, two-half confirmed, no seed event [A7].** Eligible at `n ≥ FIRST_RAISE_MIN = 28 = 20 + 4 + 4`: `c = max(0.5, quantizeDown(Q_gate(E)))` over `E = obs[n−28..n−9]`, confirmed by TWO 4-observation halves `H1 = obs[n−8..n−5]`, `H2 = obs[n−4..n−1]`, each requiring `count(x < c) ≤ floor(p·4/100)` (p=25 → ≥3 of 4 at or above `c`). Raise iff `c ≥ 0.5 + 0.02`, both halves support, and the sample is stable; `to = c`. | A measured quantile below 0.52 writes nothing; a failed half writes nothing; the bar stays at the floor. | At n=28 the slices are exactly `[0,20)`, `[20,24)`, `[24,28)`; an easy 20 followed by 8 weak observations writes **no** raise; 8 at-or-above with ≥3/4 per half writes one `from: 0.5, to: c`. |
| R7 | **Steady-state two-half raise.** Once a bar above the floor exists, at `n ≥ 40`: `c = max(0.5, quantizeDown(min(Q_gate(A), Q_gate(Bw))))`; raise iff `c ≥ B + 0.02` and the sample is stable; `B' = c`. | Absent/unstable sample → hold (`bar.held`), never a refusal of the step. | A window where only the newest half improved → no raise; both improved → one raise to the lower half's quantile. |
| R8 | **Monotone.** Schema refinement `to ≥ from` **and** a `max` fold. | A decreasing raise cannot be written; a legacy decrease cannot lower the effective bar. | A hand-written `to < from` fails to parse; a folded sequence equals the maximum `to`. |
| R9 | **Contested, never lowered.** A full window (40) at the bar with zero dimension-passes appends `bar.contested` once per (scope, bar). | The bar is unchanged; only the signal is recorded. | After a simulated regression the bar is unchanged, `bar.contested` appears once, the pass rate falls. |
| R10 | **Pure AND [F2].** `pass ⟺ ∀d score_d ≥ B_d`. No tolerance, no mean, no Pareto cap, no weighting. | A calibrated dimension with no bar is `INSTANCE_STATE_INVALID` at read time, never a silent pass. | `step.ts` has exactly one quality check; `qualityMean`, `gateBar`, `pareto`, `DIMENSION_TOLERANCE` are gone. |
| R11 | **Reported vs gating.** `score` (MIN) stays reported; it is never consulted by the gate. | A verdict without `score` is `RESULT_INVALID` (unchanged). | Changing `score` alone changes no decision. |
| R12 | **`quantileGate` [A2].** Optional per dimension: `z.int().min(1).max(99)`, default 25. It selects a RANK, never a value. `threshold`, `dimensions[].floor`, `paretoThreshold` are deprecated and ignored. | Out-of-range → `CONFIG_INVALID`; a deprecated field has no effect on any bar. | Q25 vs Q40 of the same population give different bars; declaring `threshold: 0.9` changes nothing. |
| R13 | **Q50 learning flag [A3].** A dimension that passed but sits below its own `Q50` is `flagged`; the note gate requires one lesson per flagged dimension; no gate effect. | A passing dimension with no `Q50` (empty population) is not flagged. | v6/v7: 62–69 % of passing verdicts carry ≥ 1 flag; removing the flag changes no decision. |
| R14 | **Nothing quantile-related stored [A4].** No new event, table, column or snapshot; `Q_gate`/`Q50`/`Q75` are computed on demand. The only recorded level is the bar (`bar.raised`). | A missing event history simply yields no bar (the floor). | The store has zero new object kinds after the change; a fresh query yields every quantile. |
| R15 | **Metrics need no new storage [A5].** `quality.verdict` already carries `task`, `taskVersion`, `step` and `dimensions[{id, score, key}]`. | — | Verified in both stores: one query per (task, dimension) yields n, mean, Q25/Q50/Q75. |
| R16 | **Q75 exemplar band dropped [A6].** No exemplar tag, no gate, no stored band. | — | No code path reads Q75 for selection; showing it informationally is allowed, computing it is on demand. |
| R17 | **Stored-record compatibility.** Old pins (`threshold`/`floor`/`paretoThreshold`) and old verdicts (`mean`/`flagged`/`window`/`ema`) still parse; new fields are optional. | Deleting a stored field would make `qualityHistory`/`loadPinnedFlow` fail on existing stores — a migration, which this unit does not authorise. | The v6 and v7 stores re-parse end to end with zero errors. |
| R18 | **No-progress uses the vector.** `stalled` compares the number of dimensions below their bars, not the MIN headline. | A run that fixes one dimension and dips another is not terminated as stalled. | MIN falls while the failing-dimension count falls → `stalled` false. |
| R19 | **Display.** The brief and the refusal show each dimension's bar or `calibrating`; refusal names the dimension, its score and its bar. No global threshold is shown anywhere. | A missing bar renders `calibrating`. | The brief lists five bars and no `threshold`; the refusal detail has one entry per refused dimension. |
| R20 | **Formula identity.** `BAR_FORMULA_ID = praxis.bar.q50-floor/v1` (name TBD in the plan) is recorded on every raise. | A raise with an unknown formula id still folds (evidence, not authority). | Every `bar.raised` in a replayed run carries the id. |

## 5. Model — one owner per fact

| Fact | Owner | Shape | Derived? |
|---|---|---|---|
| What work scored | the `quality.verdict` event | dimension scores, task, taskVersion, step | recorded |
| Which version counts | the `artifact.accepted` event (carried version) | one per instance | derived |
| The population | no owner — a read | per `(task, dimension)` | derived on every evaluation |
| `Q_gate`, `Q50`, `Q75` | no owner — a read **[A4]** | quantiles of the population | derived on demand |
| The bar | `bar.raised` events (folded from `ABSOLUTE_MIN`) | `{scope, key, from, to, percentile?, n?, formulaId, at}` | derived fold (max) |
| Calibration | no owner — a read of `n < 20` | boolean | derived |
| The decision | `gate()` in `step.ts` | per-dimension `score ≥ bar` | derived |
| The learning flag | no owner — a read of `score < Q50` | set of dimension ids | derived |
| The judge-stability record | `rubric.sampled` (S3, unchanged) | repeats/agreement | recorded |

No new table, no new store, no new event kind: the ratchet writes only `bar.raised`/`bar.held`/`bar.contested`, all of
which already exist.

## 6. Ledger — removed, kept, changed

**REMOVED from behaviour**

1. The **global MEAN scope** (`GLOBAL_SCOPE`, its seed, its series of per-verdict means) — F1.
2. The **mean gate** in the decision and the `qualityMean` check — F1/F2.
3. The **Pareto cap** (`gateBar`, `paretoThreshold`, `DEFAULT_PARETO_THRESHOLD`) — nothing left to cap.
4. The **tolerance band** `DIMENSION_TOLERANCE` and the `flagged` set as a decision input — F2 (replaced by the Q50
   learning flag, R13).
5. The **EMA statistic** (`emaOf`, `BAR_EMA_PERIODS`, `BAR_EMA_ALPHA`) and its evidence (`ema`).
6. The **step/ceiling/cooldown apparatus** (`BAR_MAX_STEP`, `BAR_CEILING`, `BAR_MIN_STEP`,
   `BAR_MEAN_ATTEMPTS_MAX`, the 5-pass cooldown, `WARMUP_MIN = 10`).
7. **`genuinePasses`** (the survivor set) as a ratchet input.
8. The **authored seed path** (`dimension.floor`, `quality.threshold`) — F3.
9. **`bar.seeded`** (the earlier draft's new event) — superseded by “the floor is the default bar, the first raise
   is from it” **[A7]**, so no new event kind exists.
10. The **Q75 exemplar band** **[A6]**, and any stored quantile snapshot **[A4]**.

**KEPT**

1. `dimensionKey` (id + criteria) and `compositionKey`.
2. The event-fold model (`bar.raised`, `bar.contested`, append-only) and `raisesFor`/`barAt`.
3. `scanEvents`, `ofTask` — the one cross-instance read.
4. The S3 stability sample as a raise precondition.
5. **One decision site**: `gate()` in `step.ts`.
6. `maxAttempts`, `onFailure`, `policy`.
7. The MIN headline as a **reported** value.
8. The `quantileGate` **selector** only, as the single authorable strictness knob **[A2]**.

**CHANGED**

1. `Bars` → `{ perDimension: Map<id, number>, keys }` (no `global`, no `pareto`, no seeds; floor ≥ 0.5).
2. `barsFromQuality` → deleted; the fold starts at `ABSOLUTE_MIN`.
3. `compoundDecision` → `perDimensionDecision` returning `{pass, refused}` plus the derived `flagged` set.
4. `recomputeBar` → first-raise/two-half confirmation on the carried population.
5. The verdict: `mean`/`flagged` no longer written by the gate path (kept optional for old records); `calibrating?` added;
   `score` stays.
6. `stalled` compares the failing-dimension count (R18).
7. The brief, the refusal and the failure message show per-dimension bars/`calibrating`.

**DEPRECATED but still PARSED** (kept so old stores load; read by nothing): `threshold`, `floor`, `paretoThreshold`
in `QualitySchema`; `mean`, `flagged`, `window`, `ema` in stored records. Deleting them would turn every existing store
into `PIN_CORRUPT`/`STORE_INVALID` — a migration this unit does not authorise (gate #6 stays open).

## 7. Minimal change surface

| # | File | Change |
|---|---|---|
| 1 | `src/quality/scope.ts` | drop `GLOBAL_SCOPE`, `DIMENSION_TOLERANCE`, `Bars.global/pareto`, `barsFromQuality`; `barAt` → max fold from `ABSOLUTE_MIN`; `effectiveBars` → per dimension |
| 2 | `src/quality/bar.ts` | drop `emaOf`, `gateBar`, `compoundDecision`, `genuinePasses`, the EMA/step/ceiling constants; add `quantileOf`/`quantizeDown`/`carriedPopulation`, the first-raise + two-half rule in `recomputeBar`; `decideContest` on all work |
| 3 | `src/quality/evaluate.ts` | decision = `perDimensionDecision`; stop writing `mean`; derive the `flagged` set from `Q50` |
| 4 | `src/runner/step.ts` | pure AND; one quality check; no `gateBar` |
| 5 | `src/runner/engine/advance.ts` | thread per-dimension bars; the `recomputeBar` call site is unchanged |
| 6 | `src/runner/engine/quality-loop.ts` | per-dimension failure wording; `stalled` by failing count |
| 7 | `src/types/quality.ts` | `QualityDimensionSchema.quantileGate?` (int 1..99); deprecated `threshold`/`floor`/`paretoThreshold` |
| 8 | `src/types/schema.ts` | verdict: `mean`/`flagged` legacy-optional, `calibrating?`; `BarRaisedSchema` move to learning.ts |
| 9 | `src/types/learning.ts` | `BarRaisedSchema`: `to ≥ from` refine, optional `percentile`/`n`, `ema`/`window` deprecated |
| 10 | `src/runner/engine/types.ts` | `BAR_FORMULA_ID`, `ABSOLUTE_MIN = 0.5`, `BAR_WINDOW = 40`, `CALIBRATION_MIN = 20`, `RAISE_STEP = 0.02`, `DEFAULT_QUANTILE = 25` |
| 11 | `src/quality/index.ts`, `src/pi/{descriptor,feedback,operations}.ts` | exports; per-dimension display and refusal detail; note-gate flag input |
| 12 | `.pi/praxis/tasks/**/*.json` (12) | remove `threshold`, `floor`, `paretoThreshold`; bump `version` |

## 8. What this spec does NOT do

No store schema change, no migration, no new dependency, no new result key, no new event kind. No change to the
artifact contract, the alignment gate, the hooks, the six-key result or the recall model. No change to the rubric
criteria themselves. No claim that work quality improves. No cross-task learning.

## 9. Alternatives rejected

| Alternative | Rejected because |
|---|---|
| Let a measured `Q_gate` below 0.5 become the bar **(the earlier OQ1 answer)** | **[A1]** supersedes it: sub-0.5 work must never pass |
| Pin 0.5 as the bar without the quantile | rejects good-but-weak work forever on a weak rubric; the hybrid keeps the quantile above the floor |
| Keep the EMA and cap it at the quantile | the minimum always wins: the EMA becomes dead weight and dead code |
| p50 (median) | 9.8 % joint in v6 — that is the strangle |
| p20 | 43.9 % but weaker rejection of bad work for +3 points |
| Trimmed mean | not rank-based; an outlier still moves it |
| Store quantiles for speed **[A4]** | “data stays data”: the verdict log already answers every query, and a cache would be a second owner |
| Keep the Q75 exemplar band **[A6]** | 2–3 cases/run, redundant with the recall margin |

## 10. Open questions — all RESOLVED by the owner

| # | Question | Resolution |
|---|---|---|
| OQ1 | seed below the 0.5 calibration floor | **RESOLVED [A1]**: hybrid `max(0.5, Q_gate)`; the floor always wins below 0.5 |
| OQ2 | tolerance removal makes `flagged` inert | **RESOLVED [A3]**: `flagged` is now “passed but below Q50”; the note gate requires a lesson |
| OQ3 | delete vs deprecate stored fields | **RESOLVED**: deprecate-not-delete; no migration (gate #6 stays open) |
| OQ4 | population unit | **RESOLVED**: carried version, one observation per instance |
| OQ5 | window/calibration sizes | **RESOLVED**: 40 / 20, engine constants, never authored |
| OQ6 | can strictness be authored? | **RESOLVED [A2]**: `quantileGate` (rank only), default 25 |
| OQ7 | where do metrics/flags get their data? | **RESOLVED [A4]/[A5]**: derived on demand from `quality.verdict`; no new storage |

## 11. Acceptance oracles

1. **Replay, carried-per-instance, p25, hybrid floor:** joint pass **40.6 % (v6)** and **45.3 % (v7)** — the owner's
   ~41 %/~47 % — accepted within **±5** points. Outside that band the rule was not implemented as specified.
2. **T1:** append one 0.99 to a 20-window → the candidate is unchanged; append one 0.0 → at most one order statistic.
3. **T2/hybrid:** every recorded `to ≥ 0.5`; every raise `to ≤ max(0.5, Q_gate)` of the window it cites; a synthetic
   population entirely at 0.4 yields no raise and refuses all work.
4. **Regression:** shift a simulated population down by 0.2 → bar unchanged, pass rate falls, `bar.contested` once.
5. **Monotone:** a recorded raise with `to < from` is refused by the schema; the fold equals the max.
6. **Compatibility:** v6 and v7 re-parse end to end (every pin, every verdict) with zero errors.
7. **Flag rate:** on v6/v7, 62–69 % of passing verdicts carry at least one Q50 flag (25–28 % of passing dimensions).
8. **First raise (K3):** an easy 20-observation estimate followed by 8 weak observations → **no** `bar.raised`; the
   same estimate followed by 8 at-or-above (≥3 of 4 in each half) → exactly one `bar.raised {from: 0.5, to: c}`; two
   below `c` in either half → no raise.
