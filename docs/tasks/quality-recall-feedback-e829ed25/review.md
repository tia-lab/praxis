# Review — refusal-recall (quality-recall-feedback) — G

## G implementation review — attempt 1 — PASS — 2026-10-30T18:32:31Z
subjects (sha256, first 16):
plan.md 07fa2b5d57326e8e
operations.ts f1fab0b02daec4b6
recall-feedback.test.ts e97c42ac14c28b99
SKILL.md 658a3280a3e29d59
reviewer: lead (session). independence: independent of the author (wB:p22).

verified (commands run this session, not reported-only):
- `npm run check` (tsc --noEmit) → exit 0.
- `npm test` → tests 277, pass 277, fail 0 (274 + 3 new; existing refusal/quality/ranker tests still green).
- `recallFeedback` read in full: returns the error UNCHANGED when there is no recorded verdict, when the task
  has no quality, when no rubric tag survives, or when recall returns zero cases (cold store → no field, not an
  empty object); on success `fail(error.code, error.message, {...detail, recall})` preserves the typed code,
  the message and the existing detail (compound/quality/checks/lesson) and adds `recall`. The ENTIRE body is
  wrapped in try/catch returning the original error, so a typed refusal can never be lost to an enrichment
  fault. tags = refused ∩ rubric ids, fallback to all step dims on a mean-only refusal; max 3; need clipped 500.
- The catch change is one line in the QUALITY_CODES branch (`throw recallFeedback(...)`); the non-quality
  `throw reviewed` (line 380) and the afterOp hook are untouched → ARTIFACT_INVALID and ALIGNMENT_REJECTED are
  byte-identical.
- `git diff --stat`: only `src/pi/operations.ts` (+45,-1) and `.pi/skills/praxis/SKILL.md` (+10) changed, plus
  the new test and the docs. No gate, compoundDecision, ratchet, ranker, engine, store or schema change; the
  detail stays under `z.unknown` so no envelope change; no store write (read-only inspect + recallExperience,
  which itself asserts the submitting session is an observer).
- Test read: warm store asserts `QUALITY_BELOW_THRESHOLD`, `compound.refused == ["solves"]`, `detail.recall`
  with the exact op=recall key set, count 1..3, `need` matching /solves/, each case `outcome=="pass"` with a
  lesson on the refused dimension and sha256 provenance; cold store asserts NO recall key with the rest of the
  detail intact; ARTIFACT_INVALID on a warm store asserts no recall key.

verdict: PASS. The failed gate now hands the agent the best passing examples for exactly the dimensions that
failed, read-only, bounded to three, preserving the typed refusal, with the agent told it can pull more — the
owner's ask met with no reach into the gate or the ranker. Release to commit.
