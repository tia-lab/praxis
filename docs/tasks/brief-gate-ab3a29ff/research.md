# Research — what the step brief discloses about the standard

Task: brief-gate · Hash: ab3a29ff · Gate: G1 (research-light) · Date: 2026-10-30
Method: read the descriptor projection, the envelope schema and the source of the bar it prints.

## Where the brief's quality block is built

`src/pi/descriptor.ts:93-152` `stepDescriptor` projects `brief.quality` (`:130-142`) from the
effective quality (`resolved.task.quality ?? flow.config.quality`, `:102`):

```
dimensions: quality.dimensions            // the AUTHORED rubric: id, statement, optional floor (the seed)
threshold:  learning?.bar ?? quality.threshold
policy:     quality.policy
aggregation: "min"
judging:    JUDGING_STANCE
recall:     learning.recall                // optional
```

`learning` is the `LearningView` built by `learningView` (`:61-86`): `bar` comes from `recall?.bar`,
and `recall` is `briefRecall(...)` — whose `bar` is `effectiveBars(store, task, quality).global`
(`src/quality/recall.ts:294`). So **`brief.quality.threshold` is the EARNED global bar** (or the
authored threshold when there is no history), and the per-dimension entries show only the authored
`floor`, never the effective per-dimension bar.

That is the flagged gap: since `pareto-gate` the GATE compares against `gateBar(earned, pareto) =
min(earned, paretoThreshold)` (`src/quality/bar.ts`, `gateBar`), so a brief printing an earned 0.87
tells the agent to beat 0.87 when the gate only applies 0.80.

## The envelope shape

`src/types/pi.ts:113-141` `StepDescriptorSchema.brief.quality` is a `strictObject`:
`dimensions[]`, `threshold`, `policy`, `aggregation`, `judging`, `recall?`. Being strict, a new key must
be declared there — added as **optional**, so every existing descriptor (and every consumer that
ignores it) is untouched.

## What must not move

The decision is `compoundDecision` (`bar.ts`), already capped; this unit only reports the value it
uses. No store read beyond the bars `effectiveBarsFor` already performs for the brief, no ratchet, no
ranker, no flow/task document. Below the Pareto point `gateBar(bar, pareto) === bar`, so the new field
is an exact duplicate of the earned value — a display change only at and above the cap.
