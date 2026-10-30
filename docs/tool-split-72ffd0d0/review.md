# Review — tool.ts split

## G-review (pure move, §4 waived) — attempt 1 — PASS — 2026-10-30T17:17:27Z
subjects (sha256, first 16):
plan.md 76e923c941928eca
tool.ts 19af079e725817e6
operations.ts 27e8b48651272d5d
descriptor.ts 3688ed08b5c7bda3
reviewer: lead (session reviewing wB:p22's authored subject)  independence: independent
verdict basis:
- Sizes checked by read: tool.ts 115, operations.ts 509, descriptor.ts 167 — all < 600; the cap waiver is discharged.
- No import cycle checked by grep: only src/pi/extension.ts imports tool.ts (the Pi entry point, correct); operations.ts -> descriptor.ts + host.ts; descriptor.ts -> no local. One-way.
- Public surface preserved: tool.ts re-exports actorFor/engineOptions/failure/ok/setScorerForTest/setAlignJudgeForTest (from operations.ts) and stepDescriptor (from descriptor.ts), and keeps PRAXIS_TOOL_* + executePraxisTool + createPraxisTool; setRankerForTest is imported by its test from src/quality/ranker.ts, not tool.ts, so it needed no re-export.
- Behaviour unchanged: git diff of tests and src/pi/extension.ts is EMPTY; tsc --noEmit exit 0; 258/258 under the no-network stub with the suite's existing envelope deep-equals (start/check/submit/note/recall) all green — the move preserved every envelope. The empty test diff + clean tsc is the proof the re-exports resolve.
- Purity: the only change to moved code is the keyword `export` on six helpers now called across the new module boundary (within the pi package); no new public surface, no body or signature change.
findings:
- F1 [disclosed, accepted] two new modules instead of one, because surface+handlers together (~640) would re-cross the 600 cap; cohesion split (surface / ops / descriptor) stated in plan.md before the move. Sound.
verdict: PASS. A behaviour-preserving move; all three files under the cap; no test changed; suite and tsc green. Accepted.
