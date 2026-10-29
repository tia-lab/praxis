# Where we are

**Unit:** Slice 0.
**Gate:** G5 — review pending on the moved tree.
**Waiting on you:** your run, after review.

## Done
- Implementation green and committed.
- **Tests relocated**: `tests/store/*`, `tests/runner/*`, `tests/testkit.ts`. No test or helper under `src/`.
- Suite 29/29 from the new paths, `tsc` exit 0.

## How the move happened
MAN-2 (blocking launch) left the engineer's session dead and every relaunch is the crash
path, so the lead performed the move directly. Attribution says `lead`, not `engineer-2`.
The reviewer verifies the result.

## Next
1. Independent review of the moved tree → `docs/slice-0-1947a537/review.md`.
2. You run the slice in a second terminal.
3. Accept or reject.

## Open
- MAN-2 filed (blocking launch strands intents). MAN-1 fixed.
- Blueprint: `eng` should accept `review` tasks; `lead` needs project-scope routing.
