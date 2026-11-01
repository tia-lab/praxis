# Review — EMA ratchet (all scopes) — G3

## G3 implementation review — attempt 1 — PASS — 2026-10-30T18:10:07Z
subjects (sha256, first 16):
spec.md 1718bf589f1f91ae
bar.ts 5c23a6c55d975c35
learning.ts 39be804ace1d6f61
bar.test.ts 754e065ba1dd4f2b
README.md e04885a4ce244804
reviewer: lead (session). independence: independent of the author (wB:p22).

verified (commands run this session, not reported-only):
- `npm run check` (tsc --noEmit) → exit 0.
- `npm test` → tests 274, pass 274, fail 0 (was 271; +3 cases; grep confirms none weakened/deleted).
- grep over src/tests/README/.pi: no `praxis.bar/v2`, `BAR_MARGIN_MIN`, `BAR_STDEV_MAX` remain; new id
  `praxis.bar.ema/v3` and constants `BAR_EMA_PERIODS=9`, `BAR_EMA_ALPHA=0.2`, `BAR_MIN_STEP=0.01` present.
- `emaOf` read: `ema=values[0]; ema=α·v+(1-α)·ema` over the WHOLE series, `α=2/(periods+1)`, empty→undefined.
  A genuine EMA (recency-weighted, all history), not a last-9 window.
- `decideRaise` read: ONE rule for every scope — `values=scope.passes`, `ema=emaOf(values)`,
  `margin=ema-current`; gates `meanAttempts<=2`, `margin>=BAR_MIN_STEP`; `step=min(0.05,margin)`;
  `to=round4(min(0.9,max(seed,current+step)))`; `if(!(to>current)) return undefined`. NEVER-LOWER holds:
  a dip gives `margin<0.01` → no raise; `to` is clamped to `[seed,0.9]` and must exceed `current`.
- `BarRaisedSchema.ema` is `.optional()` (comment: pre-EMA records carry none and still parse/fold); `window`
  kept as disclosure. R8 additive/backward-compatible confirmed.
- README `Quality bars and learning`: exact compoundDecision table (refused/flagged/clean, tolerance 0.05,
  PASS = no-refused AND mean>=global) and the exact EMA recurrence; every number matches the code; the gate
  sentence completed this review with the mean-attempts ≤ 2 effort gate (the one accuracy gap the engineer
  flagged).

scope: src/quality/{bar.ts,index.ts}, src/types/learning.ts, tests/quality/{bar,compound}.test.ts, README.md,
docs/ema-ratchet-c6dbbfaf/. No store table, no flow/task document, no new event type or scope. compoundDecision,
seeds, warmup, cooldown, contested and ceiling untouched.

verdict: PASS. The EMA-9 ratchet tracks each scope's smoothed earned level, rises toward it in ≤0.05 steps,
ignores sub-0.01 wobble, and can never lower a bar — the owner's improve-only goal met in code and documented
exactly. Release to commit.
