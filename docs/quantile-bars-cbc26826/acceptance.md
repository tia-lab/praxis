# Acceptance — quantile bars (S7)

Task: quantile-bars · Hash: cbc26826 · Date: **2026-10-31**
Measured by the engineer on the replay stores under `/tmp`. Nothing here is projected from a model.

## Commands

```bash
./node_modules/.bin/tsc --noEmit                       # exit 0
node --test 'tests/**/*.test.ts'                       # 375/375 pass

node tests/manual/replay-bars.mjs /tmp/praxis-exp-v6/praxis.sqlite
node tests/manual/replay-bars.mjs /tmp/praxis-exp-v7/praxis.sqlite

grep -rnE 'emaOf|gateBar|compoundDecision|genuinePasses|GLOBAL_SCOPE|DIMENSION_TOLERANCE|barsFromQuality|DEFAULT_PARETO_THRESHOLD|BAR_EMA_|BAR_MAX_STEP|BAR_CEILING' src tests | wc -l   # 0
```

`replay-bars.mjs` rebuilds the CARRIED population per dimension (one observation per instance: the score
of the version the instance carried), applies `p25` with the `0.5` floor, and reports the joint pass (every
dimension at or above `max(0.5, bar)`) plus the Q50 learning-flag rate among the passing verdicts.

## Measured

| Store | Carried instances | Joint pass | Q50 flag among passing |
| - | - | - | - |
| **v6** `/tmp/praxis-exp-v6/praxis.sqlite` | 63 | **39.7 %** (25/63) | **68.0 %** (17/25) |
| **v7** `/tmp/praxis-exp-v7/praxis.sqlite` | 64 | **51.6 %** (33/64) | **66.7 %** (22/33) |

Targets: v6 ~40.6 %, v7 ~45.3 % (±5), Q50 flag 62–69 % of passing verdicts.

- **v6 39.7 % — inside** the band (35.6–45.6). **Q50 flag 68.0 % — inside.**
- **v7 51.6 % — OUTSIDE the band by 1.3 points** (upper bound 50.3). **Q50 flag 66.7 % — inside.**

## Finding (recorded, not hidden): v7 is 6.3 points above the projected 45.3 %

The gap is measured, not adjusted. The likely cause is the estimator a finished store lets you reproduce:
the replay applies ONE `p25` over the whole carried population, while the live ratchet re-measures on the
latest window and adopts the LOWER of two halves, holding every raise until the K3 confirmation. On a
population whose latest work scores better than its history, the static `p25` sits BELOW the windowed
steady rule, so the replay's pass rate is an UPPER bound on the live one — consistent with v7 measuring
higher here than in the live rig. Reproducing the live number exactly needs a replay that re-walks the
window after every observation with the confirmation rule; that is a measurement refinement, not a change
to the bar.

Bars the replay derived (p25, floored at 0.5):

```text
v6  alignment=0.90  covers-question=0.74  grounded=0.92  honest-uncertainty=0.90  parsimony=0.64
```

## Proofs (green in the suite)

| Requirement | Test | Result |
| - | - | - |
| T1 outlier immunity | `tests/quality/quantile-proofs.test.ts` — a spike is never adopted and the candidate IS the rank value; a low value moves it at most one rank | pass |
| T2 hybrid floor | same file — an all-0.4 population adopts no bar, every dimension under 0.5 refuses, every threshold in force is ≥ 0.5 | pass |
| Monotone | `tests/quality/monotone.test.ts` — `to < from` fails to parse; the fold is the maximum and never below 0.5 | pass |
| Compatibility | `tests/quality/compat.test.ts` — a legacy verdict (mean/flagged), a legacy task pin (threshold/floor/paretoThreshold) and a legacy raise (window/ema) all still parse | pass |

## What is NOT claimed

No improvement in work quality, no savings, no isolation, no exactly-once execution. The Q50 flag rate is
a trigger rate, not a learning measure. The store schema is unchanged (`praxis.store/v2`, no migration);
old records parse because every removed field is still declared (DEPRECATE-NOT-DELETE).
