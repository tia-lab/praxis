# Where we are

**Unit:** Slice 0 — the minimal working runtime. Two phases, two processes.
**Gate:** G2 spec drafted. Not approved. No plan. No code.
**Waiting on you:** one reload + rebind. Then the engineering team starts.

## Done
- Research programme accepted (dependency map only).
- Manifold blueprint: converger `lead`; `research`, `review` and `eng` templates.
- Slice 0 contract, research, spec written (R1–R13, Zod, typed errors).

## Next
1. `/reload` — ends my binding, so a rebind is allowed.
2. `/manifold rebind {"reason":"add eng template"}` — adopts the new blueprint.
3. `/manifold activate {...}` — rebinds me as lead.
4. I compose the eng team: lead + 2 engineers + 1 reviewer + room.
5. Engineers write the code inside their claimed paths. I assign and verify.
6. Reviewer writes `review.md`. Then you run it.

## Team
- `eng` = lead + engineer-1, engineer-2 + reviewer-1, room required, converger lead.
- `review` = lead + reviewer, for independent review.
- Claims: engineer-1 `src/store`, engineer-2 `src/runner`+`src/cli`, reviewer `docs/slice-0-1947a537/review.md`.

## Blocked / open
- Blueprint change needs the reload + rebind above.
- Host seam (Pi) untested. Not part of Slice 0.
