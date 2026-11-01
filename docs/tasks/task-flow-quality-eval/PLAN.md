# Quality evaluation for tasks & flows — implementation plan

Status: draft for discussion. No code yet.

## Goal
Add an optional **quality floor** to a task gate (and to a flow's final step), scored by a typed
Jev judgment over the produced artifact. Below the floor → the step is refused and the agent must
redo it. Structure stays as-is; this adds *substance*, not just shape.

## Non-goals
- No learning layer (lessons/patterns) — that stays in Occam/Jung.
- No cross-run analytics, no new store, no flow-eval subsystem.
- No Jev inside the interactive Pi tool (it makes no nested calls). Jev runs from a driver.

## Key constraints (why the design is shaped this way)
- `advance()` is **synchronous**; Jev is async. So we **compute the score first, then pass it
  into the sync gate** — the async call stays outside the store transaction.
- A task with **no** `quality` block behaves exactly as today (existing tests untouched).
- `engine.ts` is already 699 lines (>600 cap), so enforcement goes in `step.ts`/`quality.ts`,
  not piled into `engine.ts`.

## What we implement

1. **schema.ts** — add `quality?` to a task: `{ dimensions[], threshold, policy: required|advisory }`;
   add `QualityVerdict` type; add `"evaluate"` to the capability enum.
2. **errors.ts (+ pi.ts mirror)** — two codes: `QUALITY_REQUIRED`, `QUALITY_BELOW_THRESHOLD`.
3. **quality.ts (new)** — injected Jev port + `evaluateArtifact()` (map artifact+rubric → Jev
   question → typed verdict, fail-closed, records score/rubricDigest/scorer/source) +
   `advanceEvaluated()` async wrapper (score, then call `advance`).
4. **step.ts** — `gate()` takes the pre-computed verdict and factors it into the decision.
5. **engine.ts** — `advance` forwards the verdict, records a `quality.verdict` event, and refuses
   below threshold (honoring the existing `refuse` edge for rework). Minimal delta.
6. **cli.ts** — small `--evaluate` driver that supplies the real Jev port (tests use a fake).
7. **tests/runner/quality.test.ts** — fake evaluator: below→refused, advisory→recorded+passes,
   required+absent→fail-closed, verdict recorded, and no-`quality`-block = identical to today.

## Behaviour rules
- Coarse floor, not a fine ranker (reject garbage; don't split 0.69 vs 0.71).
- `required` + no scorer → **fail closed**. `advisory` → record, don't block.
- A passing score blocks bad work from advancing — it is **not** owner acceptance.
- Flow-level eval = just put a `quality` block on the terminal `review` node. One mechanism.

## Reuse
Adapt the degradation/provenance contract and verdict shape from Occam's `jev`/`self-eval`
(read-only reference; Occam is being rewritten). Bind to **fabric's `jev.evaluate`** directly,
not Occam's code. Write the artifact→question mapper fresh.

## Estimate
~250–350 production LOC + ~160 test LOC. ~1–1.5 days. The deterministic core (steps 1–5, 7) is
fully testable now with a fake evaluator; only the live Jev wiring (step 6) waits on how the
driver gets the port.

## Open question for discussion
How the driver obtains the fabric `jev` port (codemode vs CLI) — the only thing blocking the
*live* score; everything else builds behind the fake.
