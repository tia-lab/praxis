# Plan — tool.ts split

Task: tool-split · Hash: 72ffd0d0 · Gate: G3 · Status: draft · Date: 2026-10-30
§4-waivable unit: a pure move, no model, contract, schema, store or flow change, reversible by
reverting three files. No spec exists for it and this plan is the whole record.

## 1. Why three files and not two

`src/pi/tool.ts` is 739 lines. Everything the handlers and the surface need together is ~640 lines
once the surface's own ~70 and the dispatcher's ~40 are set aside, so moving the handlers into ONE
sibling would leave `operations.ts` over the same 600 cap this unit exists to satisfy. The split is
therefore by cohesion:

| File | Owns | Declarations | Est. |
| --- | --- | --- | --- |
| `src/pi/tool.ts` (**stays**: the surface Pi loads) | the tool identity, the host argument schema, the dispatcher, the definition | `PRAXIS_TOOL_NAME`, `PRAXIS_TOOL_DESCRIPTION`, `PraxisOpSchema`, `PraxisHostArgsSchema`, `PRAXIS_TOOL_PARAMETERS`, `executePraxisTool`, `createPraxisTool` + the re-exports below | 739 → ~215 |
| `src/pi/operations.ts` (**new**: the ops) | every op handler plus the plumbing only they use | `IssueOpSchema`, `IssueOpArgsSchema`, `IssueOpArgs`, the two issue envelope schemas, `engineOptions`, `shortDigest`, `actorFor`, `ok`, `failure`, `required`, `clipText`, `alignJudgeOverride`/`setAlignJudgeForTest`, `scorerOverride`/`setScorerForTest`, `QUALITY_CODES`, `qualityFeedback`, `verdictSummaryOf`, and the seven handlers (`start`, `submit`, `note`, `check`, `recall`, `read`, `issue`) | new, ~530 |
| `src/pi/descriptor.ts` (**new**: what a step looks like to an agent) | the descriptor and its view helpers | `currentStepOf`, `JUDGING_STANCE`, `LearningView`, `learningView`, `stepDescriptor`, `artifactSummary` | new, ~150 |

## 2. The re-exports (so no test import path changes)

Tests and `src/pi/extension.ts` import from `src/pi/tool.ts`:

| Name | Imported by | After the move |
| --- | --- | --- |
| `executePraxisTool` | 8 test files | stays (the dispatcher) |
| `engineOptions` | `tests/runner/project-config.test.ts`, `tests/runner/store-dir.test.ts`, `tests/pi/config-path.test.ts`, `tests/pi/tool.test.ts` | re-exported from `operations.ts` |
| `actorFor` | `tests/pi/fixtures.ts`, `tests/pi/tool.test.ts` | re-exported from `operations.ts` |
| `failure` | `tests/types/errors.test.ts` | re-exported from `operations.ts` |
| `setScorerForTest` | 4 test files | re-exported from `operations.ts` |
| `setAlignJudgeForTest` | 4 test files + `fixtures.ts` | re-exported from `operations.ts` |
| `PRAXIS_TOOL_NAME`, `PRAXIS_TOOL_PARAMETERS` | `tests/pi/extension.test.ts` | stay |
| `createPraxisTool` | `src/pi/extension.ts` | stays |
| `stepDescriptor`, `ok` | no test imports them, but they are exported today | re-exported from `descriptor.ts` / `operations.ts` so the surface keeps its shape |

**Cycles**: `tool.ts → operations.ts → descriptor.ts` and nothing back. `descriptor.ts` imports only
engine/quality/type modules; `operations.ts` imports `descriptor.ts`; `tool.ts` imports
`operations.ts` and re-exports. No module imports `tool.ts`.

## 3. Declarations that move together with their bodies, verbatim

Nothing is rewritten: each block is sliced from `tool.ts` with its leading doc comment and pasted
into its new module unchanged. The only new text is each file's header comment and import list, plus
the re-export block in `tool.ts`.

## 4. Steps

1. Slice `tool.ts` into blocks (declaration + its leading comment) and assign each to a target file.
2. Write `src/pi/descriptor.ts` and `src/pi/operations.ts` with header + imports + their blocks.
3. Rewrite `src/pi/tool.ts` with its remaining blocks + imports + the re-export list.
4. `tsc --noEmit` until clean (imports are the only expected fallout).
5. Verify: line counts, the full suite under the no-network stub, the byte-identity check below.

## 5. Checks

| Check | Assertion |
| --- | --- |
| sizes | `tool.ts`, `operations.ts`, `descriptor.ts` each < 600 |
| typescript | `npx tsc --noEmit` exit 0 |
| behaviour | `NODE_OPTIONS='--import file:///tmp/no-network.mjs' node --test "tests/**/*.test.ts"` → 258/258, the SAME count |
| envelopes | the suite's existing deep-equals (start/step/note/check/recall envelopes) are the byte-identity proof; no test edited |
| exports | every name in the table above still resolves from `src/pi/tool.ts`; no test file's import statement changes |
| no cycle | `tool.ts → operations.ts → descriptor.ts`, verified by reading each module's imports (and by tsc, which would still compile a cycle but the review names it) |
| purity of the move | the concatenation of the moved blocks equals the original text of those blocks; the only added lines are file headers, imports and re-exports |

## 6. Out of scope

Any behaviour, schema, contract, envelope, result-key or ordering change. No handler is rewritten,
no helper is renamed, no signature changes. The engine, store, quality modules and tests are
untouched. tsconfig and package.json are untouched.

## 7. LOC before/after

| File | Before | After |
| --- | --- | --- |
| `src/pi/tool.ts` | 739 | ~215 |
| `src/pi/operations.ts` | — | ~530 |
| `src/pi/descriptor.ts` | — | ~150 |
