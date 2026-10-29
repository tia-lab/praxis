# Where we are

**Unit:** Slice 0 — **ACCEPTED** at G6 by the owner.
**Gate:** none open. Nothing running.

## What was delivered
- A headless two-phase runtime: data-declared flow, append-only events, canonical JSON
  artifacts, a closed capability registry per step, two separate processes for the handoff,
  a bounded six-field result.
- Independent review PASS at HEAD `ea2369f`; eleven advisory findings, all recorded.
- Owner acceptance run: three processes (831948 create, 832175 A, 832706 B) -> completed.
- 29 tests in `tests/`, mirroring `src/`; `tsc` clean; Zod the only dependency.

## Carried into the next units (open, not accepted as proven)
- F7 store imports `src/runner/canonical.ts` - decide at P1 where the canonicaliser lives.
- F8 events vs instance row: which is the recovery authority.
- F9 `--actor` is caller-supplied; trusted identity is gate #3.
- F3 duplicate-key text, R7 arbitrary step code, R12 manifest residue.
- Untested: power loss, concurrent resume, the plan kill window.
- MAN-1 fixed; MAN-2 filed (blocking launch). Blueprint: `eng` should accept `review`
  tasks; `lead` needs project-scope routing.

## Next unit - owner chooses
A. **P1 authority**: trusted actor binding + the five-way ceiling intersection.
B. **Durability hardening**: crash windows, concurrent resume, retention.
C. **Pi integration**: run the same flow from inside Pi with a bounded parent result.
