# Where we are

**Unit:** Slice 0 — minimal runtime.
**Gate:** G5 review running, with one correction queued.
**Waiting on you:** nothing yet.

## Correction in flight (owner-directed)
Tests must live in `tests/`, mirroring `src/`. They were co-located under `src/` because the
plan hit the 2-claim cap. That was the wrong call: split the assignment or claim `tests/`,
never co-locate. Rule is now explicit in `WORKFLOW.md` §7.

## Done
- Implementation green: P1 6/6, P2 11/11, P3 pass, P4 3/3, P5 2/2, P8 pass, tsc 0.
- reviewer-1 independently closed F1 and caught the key-count guard.

## Next
1. reviewer-1 finishes `review.md`.
2. Retire the review team. Compose `eng` again.
3. Two engineers move tests: `tests/store/*`, `tests/runner/*`, shared `tests/testkit.ts`.
   No `*.test.ts` remains under `src/`.
4. reviewer-1 re-verifies the moved tree and amends `review.md`.
5. You run it. You accept or reject.

## Open
- Single team slot: `maxTeams: 1`, so the move waits for the review team to retire.
- Layering finding: `src/store` imports `src/runner/canonical.ts`. Decided at P1.
