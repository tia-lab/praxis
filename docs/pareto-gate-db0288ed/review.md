# Review — paretoThreshold gate-cap (pareto-gate) — G

## G implementation review — attempt 1 — PASS — 2026-10-30T19:03:09Z
subjects (sha256, first 16):
spec.md 85f33289266da209
bar.ts b6a42982e54939cd
schema.ts da4ab2f09dba4fbe
pareto.test.ts 62beb43f983bedaa
README.md 5f950324c688189c
reviewer: lead (session). independence: independent of the author (wB:p22).

verified (commands run this session, not reported-only):
- `npm run check` (tsc --noEmit) → exit 0; `npm test` → 281 pass / 0 fail (277 + 4 new).
- `gateBar(bar, pareto) = Math.min(bar, pareto ?? DEFAULT_PARETO_THRESHOLD)`; `compoundDecision` caps BOTH the
  per-dimension bar (`gateBar(perDimension[id] ?? global, pareto)`) and the mean gate (`mean >= gateBar(global,
  pareto)`). Matches the agreed formula; MIN headline untouched.
- EMA ratchet BYTE-IDENTICAL: `git diff src/quality/bar.ts` grep for emaOf/decideRaise/alpha/margin/
  BAR_MIN_STEP → empty. Option A upheld: bars still ratchet and record above the Pareto point; only the gate
  is capped. Confirmed by pareto.test.ts case 4 (global walks to 0.85 while gate accepts a 0.82 run and the
  bar is not lowered).
- Digest safety: `paretoThreshold` is `.optional()` in QualitySchema; the default is resolved at READ time
  (`barsFromQuality: quality.paretoThreshold ?? DEFAULT_PARETO_THRESHOLD`, bar.ts:155), NOT written into the
  task, so an existing task's rubric digest is unchanged — pins and recall do not drift.
- Single gate confirmed: evaluate.ts, step.ts (qualityFloor = compound.pass) and advance.ts read
  `compound.pass`; capping compoundDecision caps every decision. The message sites (quality-loop
  failureMessage, operations.ts qualityFeedback.threshold/belowThreshold, step.ts mean flag) were also capped
  through gateBar so a refusal message cannot assert a standard the gate did not apply.
- Below-pareto byte-identical: bar.test.ts and compound.test.ts pass UNCHANGED. The only re-derived existing
  case (learning-chain) had asserted a flag band ABOVE 0.8 (floor 0.85 / score 0.80), which the cap removes by
  design; it was moved to a band under the cap (floor 0.75 / scores 0.72/0.68) with a header explaining why —
  the flag→note→steer chain is unchanged. Legitimate, not a weakening.
- README acceptance section: effBar table, `PASS <=> no refused AND mean >= min(global, paretoThreshold)`, the
  'gate stops tightening above the Pareto point' sentence, and paretoThreshold (default 0.8) in the seeds —
  numbers checked against the code.

findings:
- F1 [out of scope, owner's call] the step brief still displays the EARNED bar as its threshold, not the
  capped gate value. Display-only; nothing is refused because of it (the shown standard is >= the gate's). A
  capped companion field would need an envelope change — left to the owner.

verdict: PASS. A per-task good-enough cap that stops refusing genuinely good runs, applied at the one gate and
mirrored honestly in every message, with the EMA ratchet and existing below-pareto behaviour untouched and the
rubric digest preserved. Release to commit.
