# Plan — hooks contract

Task: hooks-contract · Hash: 2fbfdba5 · Gate: G3 · Status: draft · Date: 2026-10-30
Spec: `spec.md` (D1–D6, R1–R11). §4 waiver applies to this plan only: the spec exists and the
contract it fixes (a new type module, a new runtime seam, one new closed-union code) is why a plan
is required rather than ceremony.

## 1. Affected declarations

| Path | Declaration | Change | Effect on callers | Spec |
| --- | --- | --- | --- | --- |
| `src/types/hooks.ts` | new | `HOOK_NAMES` (8, closed), `BEFORE_HOOKS`/`AFTER_HOOKS`, one closed payload per hook, `HookPayloads`, `HookBinding`, `BeforeOutcome`, `AfterOutcome`, `VerdictSummary` | none: types only, and no index signature so an extra payload field is a compile error | R1, R5 |
| `src/runner/hooks.ts` | new | `registerHook` → unregister, `resetHooks`, `hookCount`, `dispatchBefore`, `dispatchAfter`, `beforeOp`, `afterOp`, `HOOK_LOG_PREFIX` | imported by the tool only; imports nothing but `types/errors.ts` and `types/hooks.ts` | R2–R4, R7, R9 |
| `src/pi/tool.ts` | four op handlers | `beforeOp` at entry, `afterOp` at outcome, for start/check/submit/note; `verdictSummaryOf`; note and check became async; dispatcher awaits them | 8 call sites, all inside the existing try/catch | R3, R6–R8 |
| `src/types/errors.ts` | `Code` | + `HOOK_VETOED` | every `fail()` site type-checks | R11 |
| `src/types/pi.ts` | `CODES` | + `HOOK_VETOED` | stays `as const satisfies readonly Code[]` | R11 |
| `tests/types/errors.test.ts` | `TAXONOMY_SIZE` | 30 → 31 | freezes the union at its new size | R11 |
| `tests/pi/hooks.test.ts` | new | 8 cases covering R1–R11 | — | all |

## 2. Steps, in dependency order

1. **Taxonomy** (`src/types/hooks.ts`): names, payloads, the name→payload map, the binding and
   outcome types. Check: `tsc`.
2. **Registry** (`src/runner/hooks.ts`): registration order, sequential dispatch, first veto wins,
   duplicate id at compose time, containment with one stderr line, `beforeOp`/`afterOp`. Check:
   `tsc` (it must compile with no store or engine import — enforced by the module's own import list).
3. **The code** (`errors.ts`, `pi.ts`, `TAXONOMY_SIZE` 31). Check: `tsc`, taxonomy test.
4. **Wire-in** (`src/pi/tool.ts`): `before_start` before the alignment judge; `after_start` once
   the instance exists; `before_check`/`after_check` around the dry run; `before_submit` at
   entry and `after_submit` for an accepted or a quality-refused submit, with the recorded verdict;
   `before_note`/`after_note` around `recordNote`. Check: the new test file.
5. **Tests** (R1–R11). Check: full suite under the no-network stub.
6. **Report** with diffs, the tool.ts line count and the deviations found.

## 3. Checks (the table this unit actually ran)

| Check | Command / assertion | Result |
| --- | --- | --- |
| typescript | `npx tsc --noEmit` | exit 0 |
| taxonomy | `tests/types/errors.test.ts` — mirror length 31, no duplicates, every `Code` present | green |
| suite | `NODE_OPTIONS='--import file:///tmp/no-network.mjs' node --test "tests/**/*.test.ts"` | 250/250, no network attempt |
| veto is write-free | a vetoing `before_` on each of the four ops: `HOOK_VETOED`, five table counts unchanged, and on a fresh project the store file is never created | green |
| veto ordering | `before_start` runs before the alignment judge (recorded sequence `["hook","judge"]`) | green |
| no order text | the payload's keys are exactly `{anchor, flow, op, orderDigest, requestId}` and the order text appears nowhere in it | green |
| containment | two `after_` hooks, the first throwing: the second runs, the envelope deep-equals the no-hook run, one stderr line `[praxis] hook after_check/boom failed after check: …` | green |
| verdict | `after_submit` carries `accepted`/`refused` with score, mean, dimensions, flagged and refused; a floorless task has no verdict field at all | green |
| empty registry | every op envelope deep-equal and stderr empty | green |
| no store/engine reachable | the registry module's `from` clauses are exactly `../types/errors.ts` and `../types/hooks.ts` | green |
| compile-level closure | `@ts-expect-error` proves a ninth hook name and an extra payload field do not compile | green |

## 4. Recovery

- Each step is additive; a failure reverts that step's files only, and the code (`HOOK_VETOED`) plus
  its mirror are the only pair that must move together.
- Every hook dispatch is at the tool boundary, outside every `transact`: a bug in a hook, or in the
  registry, can refuse or ignore an op but can never leave a half-written store.
- If a hook's payload proves insufficient for a real composer, the payload is widened additively;
  a *contract* change (a name, a payload field's meaning) needs a new hash and a new folder.

## 5. Out of scope

Durable hook-failure records (A3); hooks on `read`/`issue.*`; hook priority, parallelism, retry or
payload transformation; any store/flow-schema, result-key or dependency change; any engine
signature change; isolation or identity claims.

## 6. LOC budget (actual)

| Area | Lines |
| --- | --- |
| `src/types/hooks.ts` | 147 (new) |
| `src/runner/hooks.ts` | 140 (new) |
| `src/pi/tool.ts` | 651 → 721 (+70: eight wire-ins, the async conversion of two handlers, the verdict reader) |
| `src/types/errors.ts` + `src/types/pi.ts` | +2 / +2 |
| `tests/pi/hooks.test.ts` | 287 (new, 8 cases) |
| `tests/types/errors.test.ts` | 1 changed line |

`src/pi/tool.ts` is over the 600 cap and stays there under the owner's waiver (the split is
deferred until Praxis is complete); this unit's +70 is the wiring the spec asks for, and the
orchestration itself lives in `src/runner/hooks.ts`.
