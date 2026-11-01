# Research — the quality gate strangulates itself: a survivorship ratchet

Task: quantile-bars · Hash: cbc26826 · Gate: G1 · Status: draft · Date: 2026-10-31
Labels: **SM** store-measured (query shown) · **SI** source-inspected (path:line) · **DOC** repo document.
Stores: `/tmp/praxis-exp-v6/praxis.sqlite` (132 verdicts, 64 instances) and `/tmp/praxis-exp-v7/praxis.sqlite`
(116 verdicts, 64 instances), model `deepseek-flash`.

## 0. Contract

<!-- One physical line per key: this block is the hash input. Never reflow it. -->

task: replace the survivorship EMA ratchet with a per-dimension representative-quantile bar and a pure AND gate, monotonic and never impossible
scope: docs/<slug>-<hash8>/; later src/quality/{bar,scope,evaluate}.ts, src/runner/{step,engine/advance,engine/quality-loop}.ts, src/types/{schema,quality,learning}.ts, src/pi/{descriptor,feedback,operations}.ts, .pi/praxis/tasks/**
acceptance: research proves from the v6 and v7 stores that the EMA ratchet learns from a self-conditioned survivor set and climbs past the level work reaches; spec gives the exact population, window, quantile, calibration, confirmation and monotonic formula with an outlier-immunity proof and a reachability proof, the minimal change surface, and the removed/kept/changed ledger; the implementation plan stays a separate unit

Recompute: `printf 'task: %s\nscope: %s\nacceptance: %s\n' '<t>' '<s>' '<a>' | sed -E 's/[[:space:]]+$//' | sha256sum | cut -c1-8` → `cbc26826`.

## 1. Question and boundary

**Question.** The quality gate rejects more work every round: 84/132 verdicts are `below` in v6 and the bar
table shows six raises in five minutes. Is the ratchet measuring the level that work reaches, or is it measuring
something that moves *because* it is a gate — and what is the smallest change that makes the floor a stable,
reachable level?

**Answer.** The ratchet trains on a set its own output defines: `genuinePasses` keeps only accepted artifacts
whose verdict passed, so every raise moves the pass set and the next estimate is computed on a *different,
higher* population. Measured: parsimony's all-work mean is 0.652 while its bar sits at **0.7709**; the global
mean is 0.879 against a 0.6 seed. The floor is not measuring the level — it is chasing the survivors.

**Boundary.** The bar/scope/decision surface only. No identity, isolation or exactly-once claim; no authored
threshold inside a task (F3); no change to the artifact contract, the store schema, the six-key result or the
alignment gate. The implementation plan (`plan.md`) is a later unit.

## 2. Sources inspected

| Path | What was read |
|---|---|
| `src/quality/bar.ts` (491 lines) | constants, `emaOf`, `gateBar`, `compoundDecision`, `recomputeBar`/`decideRaise`, `decideContest` |
| `src/quality/scope.ts` (201 lines) | `dimensionKey`, `compositionKey`, `Bars`, `barsFromQuality`, `raisesFor`, `barAt`, `effectiveBars`, `sampleFor` |
| `src/quality/evaluate.ts` | the verdict, `rulerDigest`, the score-cache, MIN headline and the `compoundDecision` call |
| `src/runner/step.ts:298-380` | the gate and its quality block (the single decision site) |
| `src/runner/engine/advance.ts:140-155,223` | the gate call and the `recomputeBar` call |
| `src/runner/engine/quality-loop.ts:87-131,200-202` | the failure message and the `stalled` rule |
| `src/types/quality.ts`, `src/types/schema.ts:154+`, `src/types/learning.ts` | `QualitySchema`/`QualityVerdictSchema`, `BarRaised`/`BarContested`/`RubricSampled` |
| `src/pi/descriptor.ts`, `src/pi/feedback.ts`, `src/pi/operations.ts` | brief and refusal display of the bars |
| `.pi/praxis/tasks/**/*.json` (12 files) | the authored thresholds to remove (F3) |
| the two stores | events, bars, per-dimension distributions (queries below) |

## 3. What the gate does today — SI

- **Two independent gates.** `compoundDecision` (`bar.ts:207-222`): every dimension must clear
  `gateBar(bar, pareto) − DIMENSION_TOLERANCE` (0.05) *and* the MEAN must clear `gateBar(global, pareto)` with no
  tolerance. `gateBar` (`:186`) caps the comparison at the Pareto point (0.8).
- **Seeds.** `barsFromQuality` (`scope.ts`) seeds every dimension from `dimension.floor ?? quality.threshold` and
  the global from `quality.threshold`; all twelve task documents author `threshold: 0.6` and `floor: 0.6` (SM).
- **The ratchet.** `recomputeBar` (`bar.ts:321`) walks every scope; `decideRaise` takes `scope.passes`, i.e.
  **genuine passes only** (`genuinePasses`, `bar.ts:108`: an accepted artifact with no `failed` flag whose own
  verdict decided `pass`), computes `emaOf` over that whole series (`:174`, α = 2/(9+1) = 0.2), and moves the bar
  toward it by at most 0.05 when the gap is ≥ 0.01, gated by warmup 10, a 5-pass cooldown and mean attempts ≤ 2.
- **The cooldown is the only brake.** One raise per five passes, each ≤ 0.05, ceiling 0.9.

## 4. The measured failure — SM

```sql
SELECT json_extract(payload,'$.scope'), json_extract(payload,'$.from'), json_extract(payload,'$.to'), json_extract(payload,'$.at')
  FROM event WHERE type='bar.raised' ORDER BY at;
```

36 raises = **six rounds × six scopes**, all within five minutes of the same run:

| round | global | grounded | covers-q | honest-u | parsimony | alignment |
|---|---|---|---|---|---|---|
| 1 | 0.65 | 0.65 | 0.65 | 0.65 | 0.6121 | 0.65 |
| 2 | 0.70 | 0.70 | 0.70 | 0.70 | 0.6621 | 0.70 |
| 3 | 0.75 | 0.75 | 0.75 | 0.75 | 0.6990 | 0.75 |
| 4 | 0.80 | 0.80 | 0.80 | 0.80 | 0.7221 | 0.80 |
| 5 | 0.85 | 0.85 | 0.8138 | 0.85 | 0.7563 | 0.85 |
| 6 | **0.879** | **0.90** | 0.8581 | **0.90** | **0.7709** | **0.90** |

The bar sits *above the level work typically reaches* on the two dimensions that decide the outcome:

| dimension | n | mean | p20 | **p25** | p50 | p60 | max | bar in force |
|---|---|---|---|---|---|---|---|---|
| grounded | 132 | 0.929 | 0.91 | **0.915** | 0.945 | 0.95 | 0.995 | **0.90** |
| covers-question | 132 | 0.721 | 0.61 | **0.65** | 0.77 | 0.79 | 0.93 | 0.8581 |
| honest-uncertainty | 132 | 0.886 | 0.90 | **0.90** | 0.91 | 0.92 | 0.95 | **0.90** |
| parsimony | 132 | 0.652 | 0.56 | **0.57** | 0.67 | 0.70 | 0.91 | **0.7709** |
| alignment | 132 | 0.889 | 0.89 | **0.89** | 0.91 | 0.91 | 0.95 | **0.90** |

Decisions: **84 below / 48 pass**; the mean gate is false 27/133 while the per-dimension gate is false far more
often. parsimony is the binding dimension: its bar (0.7709) is **+0.12 above its all-work mean** (0.652) and
+0.20 above its p25 (0.57). That gap is the survivorship bias, measured.

**The quantile simulation** (bars = p-quantile of ALL verdicts per dimension, pure AND, no mean, no tolerance):

| p | 0.60 | 0.50 | 0.40 | 0.30 | **0.25** | 0.20 |
|---|---|---|---|---|---|---|
| joint pass, v6 (132 verdicts) | 5.3 % | 9.8 % | 22.0 % | 30.3 % | **40.2 %** | 43.9 % |
| joint pass, v7 (116 verdicts) | 6.0 % | 12.1 % | 21.6 % | 35.3 % | **44.0 %** | 51.7 % |
| walk-forward p25 (best-per-instance, calibration 20) | — | — | — | — | **43.2 % / 61.4 %** | — |

The brief's table is confirmed to within rounding. **p25 is the knee**: it rejects the bottom quarter of work per
dimension (F7) while the AND of five still admits ~40 %.

## 5. The formal root cause — the fixed point of a self-conditioned estimate

Let P(B) = { accepted-pass scores x : x ≥ B } — the set the ratchet actually reads. The update is

```text
B' = B + min(0.05, μ(B) − B)      where μ(B) = E[ x | x ∈ P(B) ]
```

Since every x ∈ P(B) satisfies x ≥ B, μ(B) ≥ B for every B, so `μ(B) − B ≥ 0`: the update is **never negative and
positive whenever any survivor sits above the bar**. A fixed point requires μ(B) = B, i.e. the bar equal to the
mean of its own survivors — which is impossible for any distribution with mass above B. The recursion therefore
climbs until the survivor set thins out; the 5-pass cooldown only sets the speed. v6 is that trajectory: six
rounds, +0.30, in five minutes, after which 64 % of verdicts are `below`.

Two compounding facts make it worse:

1. **Each raise narrows the survivor set**, which raises μ(B): the estimator's input depends on its own output —
   a feedback loop, not a measurement.
2. **A recency-weighted mean over survivors has no outlier immunity**: one 0.99 among five recent passes moves
   the EMA by α·(0.99−B) = 0.2·gap, and the max-step clamp only bounds the *jump*, never the level it lands on.

The measured signature is exactly the predicted one: the bar ends **above the all-work mean** on every dimension
and **above the p60** on parsimony (0.7709 > 0.70).

## 6. Why the obvious alternatives fail

| Estimator over passing work | Outcome | Why |
|---|---|---|
| EMA (today) | climbs to μ(survivors) | self-conditioned set; measured +0.12 to +0.20 above the level |
| mean of survivors | same fixed point, faster | same conditioning |
| median of survivors | still conditioned | p50 of the survivors is above the p50 of all work |
| median of ALL work | 9.8 % joint (measured at p50) | rejects half of all work per dimension; the AND of five is brutal |
| trimmed mean of ALL work | spike-sensitive | not rank-based: an outlier moves it by 1/(n−k) |
| low quantile of ALL work | **40 % joint at p25 (measured)** | rank-based, gentle, and invariant to the top of the distribution |

## 7. What is already right and must be kept

- **Identity**: `dimensionKey` (`scope.ts:79-90`) is the dimension's id **and its criteria**, so a rubric edit
  re-keys exactly that dimension and an unchanged one inherits its bar. This is the scope the owner's F1 needs.
- **The event fold**: `bar.raised`/`bar.contested` are append-only; `raisesFor` ignores a raise from an older
  identity; `barAt` folds by time. No column, no migration.
- **S3's stability sample** (`rubric.sampled`, `sampleFor`): a per-rubric judge-stability record, already used as
  a raise precondition — the natural confirmation input the new rule reuses.
- **One decision site**: `gate()` in `step.ts` calls `compoundDecision`; the scorer, the brief and the refusal all
  read the same fold. Replacing the statistic does not require a second decision path.

## 8. Findings

| # | Finding | Label |
|---|---|---|
| F1 | The ratchet reads only accepted passes and is therefore computed on a self-conditioned set. | SI |
| F2 | The update μ(B) − B is non-negative by construction; with a 5-pass cooldown it climbs without a fixed point. | SI (proof §5) |
| F3 | v6: 36 raises in 6 rounds to 0.7709–0.90; parsimony's bar is +0.12 above its mean and +0.20 above its p25. | SM |
| F4 | 84/132 verdicts are `below`; the mean gate fails only 27 times while the per-dimension gate binds far more often. | SM |
| F5 | A p25 bar over ALL work yields 40.2 % (v6) and 44.0 % (v7) joint pass; p50 yields 9.8 %; p60 yields 5.3 %. | SM |
| F6 | A walk-forward p25 (bar from prior instances only) yields 43.2 % (v6) and 61.4 % (v7) — the estimate is not an artefact of in-sample fitting. | SM |
| F7 | All twelve task documents author `threshold: 0.6` and `floor: 0.6`; the gate seeds from them. | SM + SI |
| F8 | `dimensionKey` already scopes per dimension and its criteria, so the per-dimension redesign needs no new identity. | SI |
| F9 | The S3 stability sample exists and is already a raise precondition; it can be reused for confirmation. | SI |

## 9. Uncertainty

1. The two runs are one task (`research` v6) and one model; the quantile values are properties of this rubric, not
   of all tasks. The rule is distribution-free, but the *numbers* are not.
2. Judge granularity is coarse at the top (grounded: p20 0.91 … p60 0.95), so a bar near 0.91 sits on a
   knife-edge where ±0.01 flips a large fraction of work. The spec answers this by quantizing the bar **down**.
3. Retry weighting: counting verdicts would weight failing work by its retries; the spec counts one observation
   per instance instead (the carried version), which is a design choice, not a measurement.
4. The calibration floor (~0.5) can sit *above* a weak rubric's measured p25. The spec makes the floor a
   provisional admission rule and the seed a measured value, and flags the single transition for the owner.
5. Nothing here is measured for tasks other than `research`, and no improvement in *work quality* is claimed —
   only that the floor stops moving above the level work reaches.

## 10. Handed to the spec

The exact population, window, quantile definition, calibration size and floor, the two-half confirmation, the
monotonic invariant and its schema enforcement, the stability gate reuse, the pure-AND gate, the quantile-down
reporting rule, the proofs, the removed/kept/changed ledger, the minimal change surface, and the remaining
open question for the owner (the calibration-floor transition).
