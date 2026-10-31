# Plan — G3: a quantile bar per dimension, a pure-AND gate, a Q50 learning flag

Task: quantile-bars · Hash: cbc26826 · Gate: G3 · Status: draft — lead review before G4 · Date: 2026-10-31
**Predecessor:** [`spec.md`](spec.md) (amended to the owner's seven FINAL decisions A1–A7) and [`research.md`](research.md).
Every reference below is to a declaration, not a stale line number: the tree moves.

## 0. Scope and invariants

**In scope:** the seven slices below. **Frozen (no touching):**

| Frozen | Why |
|---|---|
| `praxis.store/v2` (no DDL, no column, no migration) | the bar is an event fold; gate #6 stays open |
| The six-key `ResultSchema` | no result change in this unit |
| `src/quality/jev-align.ts` (the alignment gate) | unrelated decision; untouched |
| The artifact contract, hooks, and the recall/note **model** | the lesson source changes (Q50 flag), not the model |
| The task-document shape beyond one optional field | `quantileGate` is the only task-schema addition |
| Never-lower, `gate()` as the single decision site | F6 and one-owner discipline |
| No new event kind, no new dependency, no new error code | additive-only; the ratchet writes only `bar.raised`/`bar.held`/`bar.contested` |
| The rubric criteria themselves | that is the separate semantic-anchor unit |

**Stored fields are DEPRECATE-NOT-DELETE** (`threshold`, `floor`, `paretoThreshold`, `mean`, `flagged`, `window`,
`ema`): they are parsed and ignored, never written by the new path. Deleting them would make every existing pin and
verdict fail to parse (`PIN_CORRUPT`/`STORE_INVALID`) — a migration this unit does not authorise.

## 1. Slice order

```text
S1 quantile machinery (additive)  →  S2 gate cutover (pure AND)
                                        ├→ S3 Q50 learning flag
                                        ├→ S4 quantileGate + deprecation
                                        │     └→ S5 task-document cleanup
                                        └→ S6 dead-code removal (after S2/S3)
S7 acceptance (last)
```

Every slice must leave `./node_modules/.bin/tsc --noEmit` clean and `node --test 'tests/**/*.test.ts'` green
(**never `bun test`**: it has no `node:sqlite` and misreports). Baseline now: tsc clean, **341/341** green.

---

## 2. S1 — quantile machinery, additive

**Files:** `src/runner/engine/types.ts`, `src/types/learning.ts`, `src/quality/scope.ts`, `src/quality/bar.ts`,
`tests/quality/quantile.test.ts` (new).

**Exact change**

1. `engine/types.ts` — add the constants: `ABSOLUTE_MIN = 0.5`, `CALIBRATION_MIN = 20`, `BAR_WINDOW = 40`,
   `HALF_WINDOW = 20`, `RAISE_STEP = 0.02`, `DEFAULT_QUANTILE = 25`, `FIRST_HALF = 4`,
   `FIRST_RAISE_MIN = CALIBRATION_MIN + 2 * FIRST_HALF /* = 28 */`, `BAR_FORMULA_ID = "praxis.bar.quantile/v1"`.
   (The last two are consumed only by S2's first-raise path; if S1 is already committed without them, they may land in
   S2's commit instead — they are additive and unused until then.)
2. `types/learning.ts` — `BarRaisedSchema`: add `.refine(r => r.to >= r.from)`; make `window` **optional** (legacy);
   add optional `percentile: z.int().min(1).max(99)` and `n: z.int().min(1)`; keep `ema` optional (legacy). No new event.
3. `scope.ts` — `barAt(raises, seed)` becomes a **max fold floored at `ABSOLUTE_MIN`** (`bar = max(bar, raise.to)`);
   new `effectiveBars(store, task, quality)` returning `{ perDimension: Map<id, number>, keys }` where every value is
   `≥ ABSOLUTE_MIN`; keep `raisesFor`, `scanEvents`, `ofTask`, `dimensionKey`, `compositionKey`. Leave
   `barsFromQuality`, `GLOBAL_SCOPE`, `DIMENSION_TOLERANCE` in place (S6 removes them).
4. `bar.ts` — add three pure functions beside `recomputeBar`: `carriedPopulation(store, task, dimensionId, key)`
   (one observation per instance: the carried version's score, from `quality.verdict` + `artifact.accepted`),
   `quantileOf(sortedValues, percentile)` (lower definition) and `raiseCandidate(population, percentile, floor)`.
   Nothing calls them yet.
5. `tests/quality/quantile.test.ts` — the quantile definition, the carried population, the floor and the max fold.

**Gate:** `tsc` clean; **341 + new** green; zero change to any existing assertion.
**Exit:** the new functions are covered and no existing behaviour moved; `grep` shows no production caller yet.

---

## 3. S2 — gate cutover to the pure AND

**Files:** `src/quality/bar.ts`, `src/quality/evaluate.ts`, `src/runner/step.ts`, `src/runner/engine/advance.ts`,
`src/runner/engine/quality-loop.ts`, `tests/testkit.ts`, and the tests that encode the old gate
(`tests/quality/{bar,compound,pareto,lifecycle}.test.ts`, `tests/runner/{quality,quality-loop,delivery-gate}.test.ts`).

**Exact change**

1. `bar.ts` — add `perDimensionDecision(dimensions, bars)` → `{ pass, refused: string[] }`, where
   `pass_d ⟺ score_d ≥ max(ABSOLUTE_MIN, bars.perDimension.get(id) ?? ABSOLUTE_MIN)`. No tolerance, no mean, no Pareto.
2. `bar.ts` — **the raise rule (spec §3.6), first raise included.** While no raise exists for the identity, the
   **first raise** is evaluated at `n ≥ FIRST_RAISE_MIN = 28`: estimate `E = obs[n−28..n−9]` (20), confirmation halves
   `H1 = obs[n−8..n−5]` and `H2 = obs[n−4..n−1]` (4 + 4), `c = max(0.5, quantizeDown(Q_gate(E)))`, and each half must
   satisfy `|{x < c}| ≤ floor(p·4/100)` (p=25 → at least 3 of 4 at or above `c`). Once a bar above the floor exists,
   the **steady** rule applies at `n ≥ 40`: `c = max(0.5, quantizeDown(min(Q_gate(A), Q_gate(Bw))))` over two
   20-halves. A raise needs `c ≥ current + 0.02` **and** a stable S3 sample; an unstable sample writes `bar.held`; a
   full 40-window at the bar with zero dimension-passes writes `bar.contested`; no path lowers.
3. `evaluate.ts` — the verdict's `decision` comes from `perDimensionDecision` (not `compoundDecision`); **stop writing
   `mean`**; `score` (MIN) stays as the reported headline.
4. `step.ts` — the quality block keeps ONE check, `qualityPerDimension = refused.length === 0`; drop `qualityMean`;
   `QUALITY_BELOW_THRESHOLD` unchanged.
5. `advance.ts` — `gatedVerdict` and the gate call use the per-dimension bars from `effectiveBars`; the
   `recomputeBar` call site is unchanged.
6. `quality-loop.ts` — the failure message names each refused dimension with score and bar; `stalled` becomes
   `refusedCount(now) >= refusedCount(previous)` (the vector, not the MIN headline).
7. `tests/testkit.ts` — add `raiseBar(store, task, dimension, to, key?)` writing a minimal `bar.raised`, and a
   `population(store, task, dimension, values)` helper that seeds N carried observations, so a gate test can set a bar
   in one line instead of relying on an authored threshold.
8. The old-gate tests are **rewritten in this commit** (they encode a contract this slice replaces); the first-raise
   guard gets its own test here (an easy 20 + 8 weak observations writes nothing; 8 at-or-above writes one).

**Gate:** `tsc` clean; suite green after the rewrite; the rewritten tests assert the new contract.
**Exit:** `grep -rn 'compoundDecision\|gateBar\|qualityMean' src/runner src/quality/evaluate.ts` shows no *decision*
use; a verdict passes iff every dimension clears `max(0.5, bar)`; the first raise requires the 20 + 4 + 4 confirmation
and no test relies on an authored `threshold` as a bar.

---

## 4. S3 — the Q50 learning flag

**Files:** `src/quality/evaluate.ts`, `src/types/schema.ts` (doc only), `src/pi/descriptor.ts`,
`src/runner/note-gate.ts` (consumes the set; no logic change), `tests/pi/learning.test.ts`,
`tests/runner/note-gate.test.ts`.

**Exact change**

1. `evaluate.ts` — after the decision, derive `flagged` = dimension ids where the dimension **passed** and its score is
   below its own `Q50` of the carried population (same read as the bar; nothing stored).
2. `descriptor.ts` — the brief's judgment shows the flagged dimensions and their Q50 gap.
3. `note-gate.ts` — unchanged code: `flagged` now arrives from the new source, so a lesson is required per flagged
   dimension. Unknown/absent population → no flag.

**Gate:** `tsc` clean; suite green.
**Exit:** on the v6/v7 replay, 62–69 % of passing verdicts carry ≥ 1 flag; flipping the flag changes no decision.

---

## 5. S4 — `quantileGate`, and the authored fields deprecated

**Files:** `src/types/quality.ts`, `src/quality/bar.ts`, `src/pi/descriptor.ts`,
`tests/quality/quantile-gate.test.ts` (new).

**Exact change**

1. `types/quality.ts` — `QualityDimensionSchema` gains
   `quantileGate: z.int().min(1).max(99).optional()` with the comment: *selects a RANK of the population, never a value*.
2. The same file — `threshold`, `dimensions[].floor`, `paretoThreshold` are marked `@deprecated` in doc comments only
   (no schema removal: R17).
3. `bar.ts` — the candidate for a dimension uses `dimension.quantileGate ?? DEFAULT_QUANTILE`; the percentile is
   recorded on the raise (`percentile`, `n`).
4. `descriptor.ts` — the brief shows each dimension's percentile beside its bar.

**Gate:** `tsc` clean; suite green.
**Exit:** Q40 and Q25 of the same population give different bars; a task declaring `threshold: 0.9` produces the same
bar as one declaring nothing; an out-of-range `quantileGate` is `CONFIG_INVALID`.

---

## 6. S5 — task-document cleanup (data)

**Files:** the 12 documents under `.pi/praxis/tasks/**/*.json`.

**Exact change**

1. Remove `quality.threshold`, `quality.dimensions[].floor` and `quality.paretoThreshold` from every document.
2. Bump `version`: `discovery/research` **v7 → v8**; the other eleven **v3 → v4** (publication identity is
   `(path, version)`, so existing stores pinned to the old version keep loading their own row).
3. Nothing else in the documents changes: no statement, no criteria, no section requirement.

**Gate:** `tsc` clean; suite green (the suite uses fixtures, not these documents — verify with
`grep -rn 'praxis/tasks' tests/` and re-base any test that reads them).
**Exit:** `grep -rn 'threshold\|paretoThreshold\|"floor"' .pi/praxis/tasks` returns **0**; all 12 parse; the flow
documents are byte-identical.

---

## 7. S6 — legacy and dead-code removal

**Files:** `src/quality/bar.ts`, `src/quality/scope.ts`, `src/quality/index.ts`, `src/runner/engine/types.ts`,
`src/pi/{descriptor,feedback,operations}.ts`; delete `tests/quality/compound.test.ts`, `tests/quality/pareto.test.ts`,
and the EMA/global cases of `tests/quality/bar.test.ts` and `tests/quality/learning-chain.test.ts`.

**Delete (only after S2/S3 left nothing referencing them)**

1. `emaOf`, `BAR_EMA_PERIODS`, `BAR_EMA_ALPHA` — the survivorship statistic.
2. `gateBar`, `DEFAULT_PARETO_THRESHOLD`, `pareto` from `Bars` — F1.
3. `compoundDecision` (replaced by `perDimensionDecision`) and its `mean` computation.
4. `genuinePasses` — the survivor set; `decideContest` reads the carried population instead.
5. `GLOBAL_SCOPE`, `DIMENSION_TOLERANCE`, `barsFromQuality`, the global branch of `effectiveBars`.
6. `BAR_MAX_STEP`, `BAR_CEILING`, `BAR_MIN_STEP`, `BAR_MEAN_ATTEMPTS_MAX`, `BAR_WINDOW = 5`, `WARMUP_MIN`.
7. `stdev`, `lowerQuartile` if nothing reads them.
8. Every `threshold`/`global` branch in `descriptor.ts`, `feedback.ts`, `operations.ts`.

**Keep** (legacy records must still parse): `BarWindowSchema` and the optional `window`/`ema` fields on
`BarRaisedSchema`; the deprecated task fields; `mean`/`flagged` on the verdict.

**Gate:** `tsc` clean; suite green.
**Exit:** `grep -rn 'emaOf\|gateBar\|compoundDecision\|genuinePasses\|GLOBAL_SCOPE\|DIMENSION_TOLERANCE\|barsFromQuality\|DEFAULT_PARETO_THRESHOLD\|BAR_EMA_\|BAR_MAX_STEP\|BAR_CEILING' src tests` returns **0**; every file is under 600 lines.

---

## 8. S7 — acceptance

**Files:** `tests/manual/replay-bars.mjs` (new; NOT matched by the `tests/**/*.test.ts` glob),
`tests/quality/{quantile-proofs,monotone,compat}.test.ts` (new), `docs/quantile-bars-cbc26826/acceptance.md` (new).

**Exact change**

1. `replay-bars.mjs <store>` — reads `quality.verdict` + `artifact.accepted`, builds the carried-per-instance population
   per dimension, applies the p25 rule with the 0.5 floor, and prints the joint pass and the Q50 flag rate. Run by hand
   for acceptance; not part of the suite (it reads `/tmp`).
2. `quantile-proofs.test.ts` — T1 (append 0.99 → candidate unchanged; append 0.0 → at most one order statistic) and
   the hybrid (a population entirely at 0.4 yields no raise and refuses everything; every threshold ≥ 0.5).
3. `monotone.test.ts` — a `bar.raised` with `to < from` fails to parse; a folded sequence equals the maximum `to`.
4. `compat.test.ts` — a legacy verdict payload (with `mean`/`flagged`) and a legacy task pin (with
   `threshold`/`floor`/`paretoThreshold`) still parse.
5. `acceptance.md` — the commands, the two numbers and their date.

**Gate:** `tsc` clean; suite green; the manual replay run recorded.
**Exit:** replay prints **40.6 % (v6)** and **45.3 % (v7)** joint pass — the owner's ~41 %/~47 %, within **±5** — and a
Q50 flag rate of 62–69 % of passing verdicts; the four test files are green; the v6/v7 stores re-parse through the
compat path.

---

## 9. Affected declarations

| File | Declaration | Slice |
|---|---|---|
| `src/runner/engine/types.ts` | the new quantile constants; `DEFAULT_PARETO_THRESHOLD` deleted | S1 / S6 |
| `src/types/learning.ts` | `BarRaisedSchema`: `to ≥ from` refine, `window` optional, `percentile`/`n` | S1 |
| `src/quality/scope.ts` | `barAt` (max fold from `ABSOLUTE_MIN`), `effectiveBars` (per dimension) | S1 |
| `src/quality/bar.ts` | `carriedPopulation`, `quantileOf`, `raiseCandidate` | S1 |
| `src/quality/bar.ts` | `perDimensionDecision`; `recomputeBar`/`decideRaise` rewritten to first-raise + two halves | S2 |
| `src/quality/evaluate.ts` | decision from `perDimensionDecision`; `mean` no longer written | S2 |
| `src/runner/step.ts` | pure-AND quality check (one check, no mean) | S2 |
| `src/runner/engine/advance.ts` | per-dimension bars threaded; `gatedVerdict` | S2 |
| `src/runner/engine/quality-loop.ts` | failure wording; `stalled` by refused count | S2 |
| `src/pi/descriptor.ts`, `feedback.ts`, `operations.ts` | per-dimension display and refusal detail | S2 |
| `tests/testkit.ts` | `raiseBar`, `population` helpers | S2 |
| `src/quality/evaluate.ts`, `src/pi/descriptor.ts`, `src/runner/note-gate.ts` (input) | the Q50 `flagged` set | S3 |
| `src/types/quality.ts` | `quantileGate`; deprecated authored fields | S4 |
| `.pi/praxis/tasks/**/*.json` (12) | remove the three fields; bump versions | S5 |
| the files listed in §7 | delete the legacy paths | S6 |
| `tests/manual/replay-bars.mjs`, the three new test files, `acceptance.md` | acceptance | S7 |

## 10. Write surface, and what stays frozen

**Source files touched:** `quality/{bar,scope,evaluate,index}.ts`, `runner/step.ts`,
`runner/engine/{advance,quality-loop,types}.ts`, `types/{quality,schema,learning}.ts`,
`pi/{descriptor,feedback,operations}.ts` — 13 files. **Data:** 12 task documents. **Tests:** 8 rewritten, 6 new.

**Frozen:** `src/quality/jev-scorer.ts`, `jev-align.ts`, `recall.ts`, `ranker*.ts`, `screen.ts`, `sample.ts`;
`src/runner/{note-gate,step}.ts` *logic* (only the flag input and the gate check change); every store module; the
artifact/result/flow schemas; the hooks; the alignment gate; the six-key result.

## 11. Checks

| Slice | Check | Oracle |
|---|---|---|
| S1 | unit | `quantileOf` lower definition; carried population = 64 per dimension on v6; fold floors at 0.5 and takes the max |
| S2 | gate + ratchet | a verdict passes iff every dimension clears `max(0.5, bar)`; a rewritten refusal names each refused dimension; an easy 20 + 8 weak observations writes **no** first raise, 8 at-or-above (≥3 of 4 per half) writes one, and 2 below `c` in either half writes none |
| S3 | flag | a passing dimension below its Q50 is flagged; the note gate demands a tag; the flag changes no decision; measured 62–69 % of passing verdicts |
| S4 | selector | Q40 ≠ Q25 on the same population; `threshold: 0.9` changes nothing; `quantileGate: 0` and `100` are `CONFIG_INVALID` |
| S5 | data | 12 documents parse; no authored field remains; the flows are byte-identical |
| S6 | dead code | the grep in §7 returns 0; every file < 600 lines |
| S7 | acceptance | 40.6 % / 45.3 % (±5); T1, T2/hybrid, monotone and compat tests green |

## 12. Recovery

- Every slice is one commit; `git revert <sha>` reverts it.
- **Order matters for a revert:** S6 removed the EMA, so reverting S2 alone after S6 requires reverting S6 first.
- **Parsing is safe both ways** while `window`/`ema`/`percentile`/`n` stay optional: pre-S1 code reads post-S1 records
  because the new fields are additive-optional, and post-S1 code reads old records because the removed fields are still
  declared. A revert that also strips those fields would make post-change stores unreadable — flagged in K7.
- **S5 is data-only:** restoring the three fields is harmless (they are deprecated and ignored), and stores pinned to a
  pre-bump version keep loading their own publication row.

## 13. LOC budget

`bar.ts` −140/+110 · `scope.ts` −35/+25 · `evaluate.ts` −15/+45 · `step.ts` −12/+10 · `quality-loop.ts` −10/+14 ·
`quality.ts` +4 · `learning.ts` ±6 · `engine/types.ts` −10/+12 · `descriptor/feedback/operations` −25/+30 ·
12 task docs −40 · tests −250 rewritten/+450 new · `replay-bars.mjs` +90. Net source ≈ **−90** lines.

## 14. Risks

| # | Risk | Consequence | Mitigation |
|---|---|---|---|
| K1 | Shared files across slices (`bar.ts` S1/S2/S6; `scope.ts` S1/S6; `evaluate.ts` S2/S3; `descriptor.ts` S2/S3/S4/S6) | a rebase drops a field | strict order, one engineer, one commit per slice |
| K2 | The cutover flips the pass rate; tests written against an authored `threshold` no longer mean the same | a green suite that asserts the wrong thing | S2 rewrites those tests **in the same commit** and adds `raiseBar`/`population` helpers so a bar is explicit, never implied |
| K3 | ~~The first raise uses one window~~ — **CLOSED by the owner's guard**: the first raise is confirmed on evidence the estimate never saw (20-observation estimate + two 4-observation halves, each ≥3 of 4 at or above `c`; spec T5) | an easy batch can only *propose* a candidate; it cannot carry the confirmation | implemented in S2 (constants in S1); residual **by design**: a *sustained* shift confirms and raises, which is the intent. A lucky 8 that confirms an already-easy 20 has probability 0.545 when the true share at `c` is 0.75 and 0.098 at 0.5 — so a batch-easy patch alone rarely locks a bar, and `bar.contested` remains the loud signal |
| K4 | A rubric edit re-keys `dimensionKey`, so the new identity has no raises and starts at 0.5 | strictness resets on every rubric edit | intended (F1/F3): a stale bar must never follow a changed rubric |
| K5 | The Q50 flag demands a lesson on ~62–69 % of passing verdicts (the tolerance band was mostly swallowed) | more note refusals and retries | `maxNoteAttempts` (10) plus the bounded stub already absorb it; a spike in note refusals is a finding, not a reason to weaken the flag |
| K6 | `quantileGate` misused (e.g. 99 on a tight distribution ≈ the max) | a self-inflicted strangle | doc “strictness knob, recommend ≤ 50”; the percentile is recorded on every raise so the setting is visible |
| K7 | Forward-only payload: records written by the new code carry `percentile`/`n`; pre-change code would reject them (`strictObject`) | a revert after raises were written needs care | keep the fields optional and revert the logic, not the schema; stated in §12 |
| K8 | Someone adds a metrics table later | a second owner for the same fact | **[A5]**: every quantile is a query over `quality.verdict`; a table would be a new owner decision |

## 15. Out of scope

No store migration, no new dependency, no new event kind, no change to the artifact contract, the alignment gate, the
hooks, the six-key result, the recall/note model, or the rubric criteria. No dashboard and no stored metrics. No claim
that work quality improves: the unit makes the floor truthful, reachable and monotone.
