# Review — brief capped-gate display (brief-gate) — G

## G implementation review — attempt 1 — PASS — 2026-10-30T19:12:13Z
subjects (sha256, first 16):
spec.md 389effa793c42e4a
descriptor.ts 558673e39e901cc8
pi.ts becb67119fbcb263
brief-gate.test.ts 511a22b7c0afd5bb
reviewer: lead (session). independence: independent of the author (wB:p22).

verified (commands run this session):
- `npm run check` (tsc) → exit 0; `npm test` → 284 pass / 0 fail (281 + 3 new).
- DISPLAY-ONLY confirmed: `git diff --stat` over src/quality, src/runner and src/store is EMPTY. The only
  source changes are src/pi/descriptor.ts and src/types/pi.ts. compoundDecision, decideRaise/emaOf, the
  ranker, the store and all flow/task documents are untouched; the acceptance DECISION is unchanged.
- `brief.quality.gate` is `.optional()` on the StepDescriptor quality schema (additive — existing descriptors
  validate unchanged), documented as the gate actually applied.
- descriptor.ts computes `gate` from `effectiveBarsFor(...)` + the exported `gateBar(bar, bars.pareto)` — the
  SAME formula the gate uses — so the brief cannot disagree with the gate. Shown beside the earned `threshold`
  and the authored `floor`, both unchanged; projected only when the task has quality.
- Tests: above-pareto (earned 0.87 shown, gate.threshold 0.8, gate.dimensions.solves 0.8, authored floor still
  0.9), below-pareto (gate == earned, identical display), and a real 30-pass ratchet (bar 0.85 beside gate 0.8
  — the exact follow-up case). The one re-pinned existing test (quality-loop key set + gate no-op below the
  cap) is legitimate.

verdict: PASS. The agent now sees both the aspiration (earned bar) and the standard the gate actually enforces
(capped), derived through the one shared gateBar so the two can never drift — with zero reach into the decision
path. Release to commit.
