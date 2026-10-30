# Plan — jev alignment gate

Task: jev-alignment-gate · Hash: b8c0e751 · Gate: G3 · Status: draft · Date: 2026-10-30
Spec: `spec.md` (D1–D5, D3a, R1–R9). §4 waiver applies to this plan only: the spec exists and the
contract change it describes (a new required start argument, one new closed-union code) is what
makes a plan necessary rather than ceremony.

## 1. Affected declarations

| Path | Declaration | Change | Callers / effect | Spec |
| --- | --- | --- | --- | --- |
| `src/types/errors.ts` | `Code` union (:21-50) | + `ALIGNMENT_REJECTED` | every `fail()` call site type-checks; `CODES` mirror below must follow | R6 |
| `src/types/pi.ts` | `CODES` (:185-215) | + `ALIGNMENT_REJECTED` | `as const satisfies readonly Code[]` keeps the mirror honest | R6 |
| `src/types/pi.ts` | `PraxisToolArgsSchema` (:30-44) + refine (:44-52) | + optional `order` field; `op=start` requires it | the generated host parameters grow by one key; every start caller passes it | R1 |
| `src/types/pi.ts` | `StepDescriptorSchema` (:68-110) | + optional `alignment` object | additive; present only on the unavailable path | R9 |
| `src/quality/jev-align.ts` | new module | `AlignmentAnchor`, `AlignmentVerdict`, `AlignJudge`, `jevAlignJudge`, `judgeOrder` | mirrors `jev-scorer.ts`'s port + injected seam | D3 |
| `src/pi/tool.ts` | `startOperation` (:346-362) | anchor from `openFlow`, judge, three outcomes | the gate runs before `start()`; `setAlignJudgeForTest` seam | D1 |
| `src/pi/tool.ts` | `engineOptions` / `PRAXIS_TOOL_DESCRIPTION` | description line for the order and the flag | host-visible text only | R1 |
| `.pi/skills/praxis/SKILL.md` | start section + op table | order required; three outcomes | agents learn the contract from the skill | R8 |
| `tests/types/errors.test.ts` | `TAXONOMY_SIZE` (:56) | 29 → 30 | freezes the union at its new size | R6 |
| `tests/pi/*` | every `op:"start"` call | + `order`; a fake judge installed per file | keeps the suite off the network | R3, R5 |
| `tests/pi/alignment.test.ts` | new | the three-outcome matrix | R3, R4, R5, R9 | — |

## 2. Steps, in dependency order

1. **Code union + mirror** (`errors.ts`, `pi.ts` `CODES`, `TAXONOMY_SIZE`) — the compile-time base
   every later step names. Check: `tsc`, `tests/types/errors.test.ts`.
2. **The judge module** `src/quality/jev-align.ts`: port + real adapter (one `choice` question
   keyed `alignment`, `criteria {aligned, misaligned}`, strict answer read, `evaluateFn`
   injectable) + `judgeOrder` that maps any throw to `unavailable`. Check: a unit test with a
   fake `evaluateFn` for all three verdicts, no network.
3. **Argument + descriptor surface** (`pi.ts`): `order` (1..4000) required for `op=start`;
   `alignment` optional on the descriptor. Check: `tsc` only; behaviour lands in step 4.
4. **The gate** (`tool.ts`): `openFlow` → anchor → `judgeOrder`; `misaligned` →
   `fail(ALIGNMENT_REJECTED, detail)` before `start()`; `aligned` → unchanged; `unavailable` →
   start, then `step.alignment` + a `summary` clause. `setAlignJudgeForTest` for tests. Check:
   the new alignment test file.
5. **Existing callers and the skill**: add `order` to every `tests/pi` start, install the fake
   judge per file, teach the skill. Check: full suite under the no-network stub.
6. **Report** to the lead with the diffs and the evidence.

## 3. Checks

| Check | Command / assertion | Covers |
| --- | --- | --- |
| typescript | `npx tsc --noEmit` exit 0 | all |
| taxonomy | `tests/types/errors.test.ts` — mirror length 30, no duplicates, every `Code` present | R6 |
| judge unit | fake `evaluateFn` → `aligned` / `misaligned` / throw→`unavailable`; the request carries one `choice` question with both criteria | D3 |
| misaligned is write-free | start with a misaligned judge → `ALIGNMENT_REJECTED`; row counts of `instance`, `event`, `artifact`, `definition`, `publication` unchanged; the store file's sha256 unchanged | R4 |
| aligned is unchanged | start with an aligned judge → envelope has exactly `{result, step, nonce}`, no `alignment` field, no summary clause; the nonce and descriptor match a pre-unit fixture | R5 |
| unavailable proceeds + flag | throwing judge → start succeeds, `step.alignment.decision === "unchecked"` with the reason and digest, `result.summary` carries the clause | R9, D3a |
| no silent bypass | `order` missing/empty → `CONFIG_INVALID`, zero writes | R1 |
| judge input | the fake records its input: exactly `{order, anchor}`, anchor = the six D2 fields, order text verbatim | D2, R3 |
| suite | `NODE_OPTIONS='--import file:///tmp/no-network.mjs' node --test "tests/**/*.test.ts"` green, no network attempt | all |

## 4. Recovery

- Every step is additive and compiles on its own; if a step fails its check, revert that step's
  files only (the union and the mirror are the only two files that must move together).
- The gate runs before `start()`, so a bug in it can only refuse or flag a start — it can never
  leave a half-created instance.
- If pi-jev turns out to lack a Choice type, the unit stops before step 2 (it does not: verified
  at `node_modules/pi-jev/src/types.ts:3`, `:9`, and the client's validation at
  `node_modules/pi-jev/src/client.ts:23-24`, `:81-84`).
- A judge that hangs is bounded by the caller's patience, not a timer: the adapter passes no
  signal in this cut, and `unavailable` is the failure mode; a timeout is a follow-up if needed.

## 5. Out of scope

Durable refusal records (A4, its own unit); a dispatcher-side or CLI-side gate; flow-schema
fields; store-schema changes; any change to `src/runner/result.ts`; scoring; a judge timeout
budget; isolation or identity claims; a second question type (fidelity/capability fit).

## 6. LOC budget

| Area | Estimate |
| --- | --- |
| `src/quality/jev-align.ts` (port, adapter, anchor builder, three-way gate) | ~120 |
| `src/pi/tool.ts` (call the gate, seam, flag, description line) | ~18 |
| `src/types/pi.ts` (arg, refine, descriptor field, `CODES`) | ~12 |
| `src/types/errors.ts` | ~1 |
| `tests/` (new file + the `order`/`judge` ripple) | ~230 |
| `.pi/skills/praxis/SKILL.md` | ~20 |
| **total** | **~470**, of which ~150 is `src/`. Every new or touched file stays under 600 **except `src/pi/tool.ts`, which is already 609** (the op=check unit's waiver) and grows to ~627 by this unit's wiring. The gate's orchestration is therefore kept in `src/quality/jev-align.ts`, and the deferred `tool.ts` extraction is now flagged rather than assumed: it is the first follow-up this unit creates. |
amended 2026-10-30 — LOC budget corrected: the gate's orchestration moved into jev-align.ts to keep tool.ts's growth at ~18 lines, and the file's over-600 state is now disclosed as a follow-up rather than covered by a stale waiver.
