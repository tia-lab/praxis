# Spec — paretoThreshold: the gate stops tightening at the good-enough point

Task: pareto-gate · Hash: db0288ed · Gate: G2 · Date: 2026-10-30 · Owner-directed option A.

## Outcome

A task may declare `paretoThreshold` (default `0.8`): the acceptance gate compares every dimension and
the mean against **`min(bar, paretoThreshold)`**, so a run that is good enough is never refused merely
because the EMA ratchet climbed the bar above the good-enough point. The ratchet is unchanged — bars
keep rising and recording the earned level, including above the pareto point; only acceptance stops
tightening. Below the pareto point the gate is byte-identical to today.

## Requirements

| Id | Requirement | Failure behaviour | Oracle |
| --- | --- | --- | --- |
| R1 | **The cap.** For every dimension: `effBar_d = min(bar_d, P)`; refuse when `score_d < effBar_d - DIMENSION_TOLERANCE`, flag when `effBar_d - DIMENSION_TOLERANCE <= score_d < effBar_d`. The mean gate becomes `mean >= min(global, P)`. `P = paretoThreshold ?? DEFAULT_PARETO_THRESHOLD` (0.8). MIN stays the headline score, untouched. | A missing/absent threshold uses 0.8; `P` outside `[0,1]` cannot occur (schema min/max), and a value below a seed simply caps lower. | A run with mean 0.82 and every dimension 0.82 against a 0.87 global bar and a 0.90 dimension bar PASSES; the same run with the bars at 0.70/0.75 passes identically to today. |
| R2 | **One implementation.** The cap lives in `compoundDecision` behind a `gateBar(bar, pareto)` helper; every decision site (`evaluate.ts:71`, `step.ts:368`, `advance.ts:36`) uses it through the `Bars` value (or the parts threaded at `advance.ts:143`), so no site can drift. | — | Grep: no site compares a score to a bar except through `compoundDecision`/`gateBar`. |
| R3 | **Message honesty.** `step.ts:373`'s mean flag, the quality-loop failure message (`below`, `meanFailed`) and `qualityFeedback`'s `detail.quality.threshold`/`belowThreshold` report the CAPPED bar, so no message claims a standard the gate did not apply. | — | A refusal at a ratcheted 0.87 bar reports 0.80 in `detail.quality.threshold`; the failure message says "under the global 0.80". |
| R4 | **The ratchet is untouched (option A).** `decideRaise` and `emaOf` are byte-identical; `bar.raised` still records `to` above the pareto point. | — | A scope reaches `to = 0.85` in the log while a 0.82 mean submits and is accepted; `effectiveBarsFor(...).global === 0.85` afterwards. |
| R5 | **Declaration.** `QualitySchema` gains `paretoThreshold?: number` in `[0,1]`, documented as the Pareto / good-enough point; `DEFAULT_PARETO_THRESHOLD = 0.8` sits with the other quality defaults (`src/runner/engine/types.ts`, beside `DEFAULT_MAX_ATTEMPTS`/`DEFAULT_ON_FAILURE`) and is the only default read. | A task or flow that does not declare it digests exactly as before (the field is absent, never defaulted into the document). | `barsFromQuality({...}).pareto === 0.8` when absent; a task declaring `paretoThreshold: 0.9` yields `0.9` and a stricter gate. |
| R6 | **Override.** A task-level `paretoThreshold` replaces the default for its gate; a flow-level `quality` block carries it the same way (the effective quality is `task.quality ?? flow.quality`). | An override above 1 or below 0 is refused by the schema at parse (`CONFIG_INVALID`), as every other quality field is. | The same run passes at the default 0.8 and is refused with an override of 0.9. |
| R7 | **No new decision, no new state.** No store write, no event, no envelope or flow-schema change; `Bars` gains one field (`pareto`) that is derived, never persisted. | — | `git diff` shows no change under `src/store`, `.pi/praxis` or the envelope schemas. |

## Model

| Element | Owner | Valid states | Invariants | Requirement | Failure if absent |
| --- | --- | --- | --- | --- | --- |
| `Quality.paretoThreshold` | `src/types/schema.ts` `QualitySchema` | absent (default) or `[0,1]` | never written to a record; only read | R5 | The gate keeps tightening with the ratchet, the exact behaviour this unit corrects. |
| `DEFAULT_PARETO_THRESHOLD = 0.8` | `src/runner/engine/types.ts` | one constant | the only default | R1, R5 | The default would be a literal in `compoundDecision`, untunable and ungreppable. |
| `Bars.pareto` | `src/quality/bar.ts` `barsFromQuality` | `[0,1]` | derived from the quality; survives `effectiveBars`'s spread | R1, R2 | Every call site would have to thread the threshold by hand. |
| `gateBar(bar, pareto)` | `src/quality/bar.ts` | `min(bar, pareto ?? 0.8)` | pure, monotone | R1-R3 | The cap would be re-written at each site and drift. |

## Exclusions

- Changing `decideRaise`, `emaOf`, the `bar.raised` payload or the ratchet's ceiling — option A is
  explicit: bars keep rising.
- Capping what the ratchet RECORDS, or what `brief.quality.threshold` displays (an envelope change; the
  descriptor reports the earned bar).
- A global/per-project pareto setting, a flow-schema field, or any new event.
- Scoring, ranking, recall and the refusal-recall feedback: untouched.

## Alternatives

| Alternative | Rejected because |
| --- | --- |
| Cap the RATCHET (freeze raising at 0.8) rather than the gate | That is option B, not chosen: it would lose the record of the level actually reached, and a later authorised change could not tell "the work got better" from "the bar stopped". |
| Cap only the global bar, leaving dimensions tightening | A dimension bar above the pareto point can refuse a good run just as easily (`step.ts:368` both halves), so the "stop refusing good runs" goal would be half-met. |
| A hard `0.8` literal inside `compoundDecision` | Not per-task, not tunable, and a third place to change. |
| Apply the cap only at `step.ts` (the throwing site) | `evaluate.ts:71` decides the recorded verdict and `advance.ts:36` re-checks a replay: a pass recorded while uncapped would be downgraded, so the cap must be in the shared formula, not in one caller. |

## Open questions

None blocking. One noted follow-up (research §5): the step brief displays the EARNED bar rather than the
capped gate; showing both would be an envelope change and is deliberately out of scope.
