# Research — every place a pass/refuse is decided against a bar

Task: pareto-gate · Hash: db0288ed · Gate: G1 · Date: 2026-10-30 · Method: read every caller of the
compound gate and every place a score is compared to a bar. Claims cite `path:line`.

## 1. The gate is one function, and the engine really flows through it

`compoundDecision` — `src/quality/bar.ts:314-327`, documented at `:299-305` as "the compound
acceptance test, in ONE place so the scorer path, the gate and the audit cannot drift":

```
dimension bar  b_d = perDimension.get(id) ?? global
refuse if      score_d <  b_d - DIMENSION_TOLERANCE      (0.05)
flag   if      b_d - DIMENSION_TOLERANCE <= score_d < b_d
pass   = refused.length === 0 AND mean >= global
```

Call sites (all five, verified by grep):

| Site | What it is | Decides? |
| --- | --- | --- |
| `src/quality/evaluate.ts:71` | `advanceEvaluated` turns the scorer's raw scores into the recorded verdict: `decision = compound.pass ? "pass" : "below"` (`:72`) | **yes** — the verdict the gate later checks |
| `src/runner/step.ts:368-376` | the deterministic gate: `checks.qualityPerDimension`, `checks.qualityMean`, `checks.qualityFloor` → `decide(!checks.qualityFloor, "QUALITY_BELOW_THRESHOLD")` (`:375`) | **yes** — this throws the refusal |
| `src/runner/engine/advance.ts:36` | `gatedVerdict`: a `pass` computed against an older bar is downgraded to `below` when the current bars no longer support it | **yes** — fail-closed re-check |
| `src/runner/engine/advance.ts:180`, `:281` | the `compound` field inside a refusal's `fail(...)` detail | message only |
| `src/pi/operations.ts:332` | `verdictSummaryOf` → the hook summary / `VerdictSummary` | message only |

So the engine's accept/refuse **does** flow through `compoundDecision`, at three decision sites and
two message sites — and they all pass a `Bars` (or an explicit `{global, perDimension}`) value.

## 2. Does the quality loop make a SEPARATE floor decision on raw bars?

`src/runner/engine/quality-loop.ts`:

- `:109` `const below = args.verdict.dimensions.filter(... barOf(id) - DIMENSION_TOLERANCE)`
- `:119` `const meanFailed = mean < args.bars.global;`

Both live inside `failureMessage` (`:88-121`), whose return type is `string`: they build the **text**
of the message recorded when the loop gives up ("below its bar: …", "under the global …"). They do
**not** decide anything: the loop's own decision is `qualityRefusal(verdict)` (`:131-134`, "was the
first failing check the quality floor?") plus the attempt budget, both of which read the recorded
verdict produced at `step.ts:368`/`evaluate.ts:71`. So: message-only, and it must be capped for
honesty, which is a two-line change in the same function.

`src/runner/engine/advance.ts:265-283` is the other place a refusal is built from a verdict; the
decision there is `verdict.decision` (already produced by the gate), and `:281` only attaches the
compound diagnostic.

## 3. Where the bars come from (so the cap can travel with them)

`barsFromQuality` (`bar.ts:137-150`) builds the `Bars` record: `global` = `quality.threshold`,
`perDimension` = each `dimension.floor ?? threshold`, plus `keys` and `composition`.
`effectiveBars` (`:181-189`) folds the `bar.raised` events and spreads the seeds, so anything added to
`barsFromQuality`'s result survives into every effective `Bars`. `advance.ts:124` computes those bars
once per advance and hands `{threshold: bars.global, floors: bars.perDimension}` to `gate`
(`advance.ts:143-148`) — the one constructed-from-parts call site, which is where a new field must be
threaded explicitly.

**Conclusion: the cap can be confined.** It belongs inside `compoundDecision` (one implementation), it
reaches four of the five call sites for free by riding on `Bars`, the fifth (`step.ts`) needs the field
threaded through `advance.ts:143-148`, and three *expressions that mirror the gate's result* must use
the same capped value so a message never contradicts the decision:

- `step.ts:373` `checks.qualityMean = compound.mean >= expected.quality.threshold` — a second
  expression of the mean gate;
- `quality-loop.ts:109,119` — the failure message;
- `src/pi/operations.ts:243-299` `qualityFeedback` — `detail.quality.threshold` and each
  `belowThreshold` flag, read from `effectiveBarsFor(...).global`.

No STOP condition: there is one formula, one shape, and no site that decides from a bar without either
a `Bars` value or the two parts that make one.

## 4. What must not move (option A)

`decideRaise` (`bar.ts:416-...`) and the EMA recurrence (`emaOf`, `:270-...`) are untouched: bars keep
rising toward the earned level and recording it in `bar.raised`, even above the pareto point. The cap
is an ACCEPTANCE concept applied when a score is compared to a bar, never when a bar is computed.

`src/quality/evaluate.ts:30` digests the ruler as `{ ruler: quality, floors }`, so a task that declares
`paretoThreshold` gets a different `rubricDigest` and a different pin — correct, because it changes the
gate. A task that does not declare it digests exactly as before (the field is absent, not defaulted).

## 5. Unknowns

- **Not measured**: how often a ratcheted bar sits above 0.8 in a real project; the tests below
  construct the state rather than observe it.
- **Display**: the step brief shows `brief.quality.threshold` from the effective bars
  (`src/pi/descriptor.ts`), i.e. the EARNED bar, not the capped gate. Deliberate: the descriptor reports
  the ratchet's record, and changing that shape is an envelope change this unit does not make. Flagged
  as a follow-up, not a defect of the cap (a brief that shows a higher standard than the gate can refuse
  nothing).
