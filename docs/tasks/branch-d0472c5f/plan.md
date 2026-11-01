# Plan — flow Unit 1: BRANCH (the typed one-of-N router)

Task: branch · Hash: d0472c5f · Gate: G3 · Status: draft (awaiting review) · Date: 2026-11-01

Basis: `spec.md` in this folder (R1-R16, D1-D4) and `research.md` (F1-F21, E1-E6). `spec: present` — the unit
changes a schema, a public type surface, a failure taxonomy and the engine's routing, so no §4 waiver applies.
**Design only.** This plan is executed after an owner GO, in ordered slices, each behind its own checks.

## Requirement basis

- R1 branch edge kind + label — oracle: 2-arm flow loads; `data`+label, branch-without-label, non-kebab label all `CONFIG_INVALID`
- R2 `decide` block + bijection + `NODE_KEYS` — oracle: 3-arm loads; mismatched label/criteria, decide+1 arm, decide+data edge fail; unknown key `NODE_INVALID`
- R3 one relaxed fan-out rule — oracle: 2 data targets still refused with today's text; 2 and 8 arms load; 9 refused
- R4 merge slot rule — oracle: 3 arms reconverge and load; two branch sources, branch+data, two deciding nodes into one node all refused
- R5 subject rule follows the slot — oracle: review on one branch arm loads; on two arms refused
- R6 active sources at runtime — oracle: the fired arm's digest is the handoff; unfired arms are never read; a branch-free flow still raises `ARTIFACT_UNAVAILABLE`
- R7 label-aware `successorOf` — oracle: label routes to its target; unknown label `ROUTE_INVALID`; a deciding node never completes the instance
- R8 the `route` input and its pre-write validation — oracle: four negative cases write nothing (`event`, `artifact`, `revision` unchanged)
- R9 `src/quality/jev-branch.ts` fail-closed — oracle: valid fake proceeds; throwing fake `ROUTE_UNAVAILABLE`; undeclared label `ROUTE_INVALID`; exactly one `choice` question in the captured request
- R10 one `branch.decided` event — oracle: exactly one per accepted deciding step; a replay appends zero
- R11 deterministic replay — oracle: the counting fake router sees zero extra calls; a contradicting route is `ROUTE_INVALID`
- R12 branch-free flows byte-identical — oracle: the existing suite unchanged, the five digests unchanged
- R13 two codes, mirror, `TAXONOMY_SIZE` 36 — oracle: `tsc` clean, `tests/types/errors.test.ts` green
- R14 no new state or storage — oracle: `git diff src/store/` empty, an old store still opens
- R15 CLI boundary documented — oracle: a CLI advance on a deciding node is `ROUTE_UNAVAILABLE`
- R16 only this folder is written by this unit — oracle: `git status --porcelain` limited to the folder

## Affected declarations

| Path | Declaration | Before | Effect | Requirement | Callers |
| --- | --- | --- | --- | --- | --- |
| `src/types/flow.ts` | `NodeSchema`, `EdgeKindSchema`, `EdgeSchema`, `FlowConfigSchema`, `FlowConfig`, `ResolvedNode`, `NODE_KEYS`, `parseFlowConfig` | absent | **create** (moved verbatim out of `schema.ts`, then extended) | R1-R4, R16 | `schema.ts` re-exports; `flow.ts:131` |
| `src/types/schema.ts` | the same names, now re-exported | owned here | **replace** bodies with re-exports (pattern at `:140-150`) | R1-R4 | every existing importer, unchanged |
| `src/runner/step.ts` | `successorOf` (`:83`) | `(config, nodeId)` | **replace**: `(config, nodeId, label?)`, `ROUTE_INVALID` for a deciding node with a missing/unmatched label | R7 | `advance.ts:12,293` |
| `src/runner/engine/advance.ts` | the `sources` computation (`:87`), the successor move (`:293`) | static sources; `successorOf` | **replace**: hoisted accepted-ref read, active-source filter, route validation before `runStep`, one event append, label routing | R6, R8, R10, R11 | `cli.ts:108,135`; `operations.ts:340`; 33 test sites |
| `src/runner/engine/flow.ts` | `validateFlow` (`:154`), `currentHandoffs` (`:207`) | data-only subject source | **replace**: accept one `data` **or** `branch` source; the display filter includes branch edges | R5, R6 | `openFlow` (`:115`), `advance` |
| `src/runner/engine/types.ts` | `EVENT` (`:9`), `AdvanceOptions` (`:145`) | 20 event names, `qualityVerdict` | **create** `branchDecided`; **create** `RouteDecision` + `route?` | R8, R10 | all callers |
| `src/runner/engine/support.ts` | `orderOf`/`orderFor` (`:117-125`) | order pair | **create** the same pair for a recorded route (`branchDecisionFor`) | R11 | the submit seam |
| `src/quality/jev-scorer.ts` | `questionOf` (`:118`, private) | private dispatcher | **replace**: the `choice` literal extracted as exported `choiceQuestion`; `questionOf` delegates | R9 | `evaluateArtifact` (`:277,281`) |
| `src/quality/jev-branch.ts` | `RouteRouter`, `jevRouteRouter`, `routeOf`, `STANCE` | absent | **create** | R9 | the submit seam |
| `src/quality/index.ts` | the barrel | — | **replace**: re-export the router | R9 | `operations.ts:27` |
| `src/types/errors.ts` | `Code` (`:21-57`) | 34 codes | **replace**: +2 | R13 | every module |
| `src/types/pi.ts` | `CODES` (`:422-457`) | 34 names | **replace**: +2, `satisfies` keeps it honest | R13 | envelopes |
| `src/pi/operations.ts` | `submitOperation`, `setScorerForTest` (`:246`) | awaits `advanceEvaluated` | **replace**: compute the route first (minimal iff the step declares `decide` and no decision is recorded); **create** `setRouterForTest` | R9, R11 | `tool.ts:30` |
| `tests/testkit.ts` | `EdgeFixture` (`:50-54`), `writeFlow` (`:107`) | 3-kind union | **replace**: `branch` + optional `label`; a `decide` fixture field | R1-R4 | every runner test |
| `tests/types/errors.test.ts` | `TAXONOMY_SIZE` (`:44`) | 34 | **replace**: 36 | R13 | — |
| `tests/runner/branch.test.ts` | new | absent | **create**: R1-R8, R10-R12 oracles | R1-R12 | — |
| `tests/quality/jev-branch.test.ts` | new | absent | **create**: R9 oracles | R9 | — |
| `tests/pi/branch-submit.test.ts` | new | absent | **create**: the tool-path oracles (R8, R10, R11, R15) | R8, R10, R11, R15 | — |

## Budget

| Path | Current LOC | After LOC | Split owner boundary if >600 |
| --- | --- | --- | --- |
| `src/types/schema.ts` | 594 | ~400 | must shrink first: the delta cannot fit, so S1 moves the flow-document block (`:296-475`, `:566-592`) to `src/types/flow.ts` |
| `src/types/flow.ts` | — | ~285 | under the cap; owns the flow document |
| `src/runner/step.ts` | 385 | ~400 | under |
| `src/runner/engine/advance.ts` | 306 | ~355 | under |
| `src/runner/engine/flow.ts` | 290 | ~305 | under |
| `src/runner/engine/types.ts` | 216 | ~230 | under |
| `src/runner/engine/support.ts` | 145 | ~175 | under |
| `src/quality/jev-scorer.ts` | 342 | ~350 | under |
| `src/quality/jev-branch.ts` | — | ~140 | new, under |
| `src/pi/operations.ts` | 544 | ~560 | under, but the tightest file: the seam must be a thin call, not a second router |
| `src/types/errors.ts` / `pi.ts` | 90 / 467 | 94 / 469 | under |

## Steps

Ordered by dependency. Each runs only after the previous slice is green; **nothing here is authorized by
this document** — an owner GO starts S1. Slices S1 and S2 are schema, S3-S5 are the model's behaviour,
S6-S8 wire the engine, S9 proves it, S10 is the review this plan schedules for itself.

1. **S1 — move the flow document, change no byte of behaviour** — files: `src/types/flow.ts` (new),
   `src/types/schema.ts` — move `NodeSchema`, `EdgeKindSchema`, `EdgeSchema`, `FlowConfigSchema`,
   `FlowConfig`, `ResolvedNode` and `NODE_KEYS`/`nodeExtraKey`/`parseFlowConfig` verbatim and re-export
   the same names from `schema.ts` (the pattern at `:140-150`). Done when: identical suite result, both
   files under 600, no importer changed. Requirement: R16 (prepares R1-R4), R12.
2. **S2 — the schema delta** — files: `src/types/flow.ts` — `EdgeKindSchema` += `"branch"`; `EdgeSchema`
   label; `NodeSchema.decide`; `NODE_KEYS` += `decide`; `superRefine`: label-iff-branch, the decide rules,
   the fan-out exemption, and the slot rule replacing the above-1 refusal (`:454`). Done when: every R1-R4
   oracle passes and every existing schema test is unchanged. Requirements: R1-R4.
3. **S3 — the subject rule** — files: `src/runner/engine/flow.ts` — `validateFlow` accepts one `data`
   **or** `branch` source for a `bindsSubject` node; a join is still refused. Done when: R5's three cases
   pass. Requirement: R5.
4. **S4 — label-aware routing** — files: `src/runner/step.ts` — `successorOf(config, nodeId, label?)`.
   Done when: R7's oracles pass and the existing edge tests are unchanged. Requirement: R7.
5. **S5 — the decider** — files: `src/quality/jev-scorer.ts` (extract `choiceQuestion`),
   `src/quality/jev-branch.ts` (new), `src/quality/index.ts` — one `choice` question, a strict label read,
   `routeOf` mapping throw -> `ROUTE_UNAVAILABLE` and an undeclared label -> `ROUTE_INVALID`, with an
   injected `evaluateFn` and a fakeable port. Done when: R9's oracles pass and the scorer's own request is
   unchanged by the extraction (a golden-request test). Requirement: R9.
6. **S6 — the codes** — files: `src/types/errors.ts`, `src/types/pi.ts`, `tests/types/errors.test.ts` —
   two codes, the mirror, `TAXONOMY_SIZE = 36`. Done when: `tsc` is clean and the taxonomy test is green.
   Requirement: R13.
7. **S7 — the engine** — files: `src/runner/engine/types.ts`, `src/runner/engine/support.ts`,
   `src/runner/engine/advance.ts` — `EVENT.branchDecided`, `AdvanceOptions.route`, the recorded-decision
   reader, the hoisted accepted-ref read, the active-source filter, the pre-write route validation, the one
   event append, and the labeled successor move. Done when: R6, R8, R10, R11 oracles pass; a branch-free
   flow's event sequence is byte-identical. Requirements: R6, R8, R10, R11.
8. **S8 — the seam** — files: `src/pi/operations.ts`, `src/pi/tool.ts` (one re-export) — before
   `advanceEvaluated`, when the current step declares `decide` and no decision is recorded for the
   submitted digest, compute the route through `scorerOverride`-style injection (`setRouterForTest`), then
   pass `route` down. Done when: R11's zero-call replay oracle passes through the tool path.
   Requirements: R9, R11.
9. **S9 — proofs and the byte-identical regression** — files: `tests/testkit.ts`,
   `tests/runner/branch.test.ts`, `tests/quality/jev-branch.test.ts`, `tests/pi/branch-submit.test.ts` —
   every oracle R1-R15 as a runnable test, plus the five flow digests and the `src/store` diff guard.
   Done when: the whole suite is green with **no network** (fakes only) and the digests match.
   Requirements: R1-R15.
10. **S10 — the review this plan schedules** — `review.md` is written by a **reviewer**, not the author, one
    section per gate attempt (docs/WORKFLOW.md §3), with the subject digest and findings ranked by consequence.
    Done when: a verdict exists naming R1-R16 and the minimality challenge. **This plan assumes no approval**:
    G4 does not start until G3 passes, and G6 (acceptance) is the owner's statement, not this plan's.

## Checks

Each command can fail; the expected output is the pass condition.

| # | Command | Scope | Expects |
| --- | --- | --- | --- |
| 1 | `npm run check` | whole repo | no output, exit 0 |
| 2 | `npm test` | whole suite | all pass, no network, no skipped branch oracle |
| 3 | `wc -l src/types/flow.ts src/types/schema.ts src/runner/step.ts src/runner/engine/advance.ts src/quality/jev-branch.ts src/pi/operations.ts \| awk '$1>600{bad=1} END{exit bad}'` | the cap | exit 0, no line printed |
| 4 | `sha256sum .pi/praxis/flows/engineering/*.json .pi/praxis/config.json` | byte-identical flows | the five digests from research F14 |
| 5 | `git status --porcelain src/store .pi/praxis/flows .pi/praxis/tasks` | no store, flow or task change | empty |
| 6 | `node --test tests/runner/branch.test.ts` | R1-R8, R10-R12 | pass; the reconvergence spec names one handoff digest |
| 7 | `node --test tests/quality/jev-branch.test.ts` | R9 | pass; the captured request has exactly one `choice` question |
| 8 | `node --test tests/pi/branch-submit.test.ts` | R8, R10, R11, R15 | pass; the counting router reports 1 call on submit and 0 on replay |
| 9 | `sqlite3 <store>/praxis.sqlite "select count(*) from event"` before and after a `ROUTE_UNAVAILABLE` submit | zero-write refusal | identical counts |
| 10 | `sqlite3 <store>/praxis.sqlite "select count(*) from artifact"` before and after the same submit | zero-write refusal | identical counts |
| 11 | `grep -rn "branch" src/store` | R14 | no output |
| 12 | `node --test tests/types/errors.test.ts` | R13 | pass with `TAXONOMY_SIZE = 36` |
| 13 | `bun src/cli.ts resume <instance> --store <tmp>` on a deciding step | R15 | a `ROUTE_UNAVAILABLE` failure envelope and the instance still `running` at that node |
| 14 | `git status --porcelain docs/tasks/branch-d0472c5f` | R16 | exactly this folder's three documents (before G4) |

## Recovery

- **A slice fails a check.** Stop that slice; do not start the next. The affected artifact is the slice's
  own diff, so reverting it restores the previous green state; nothing later depends on a red slice.
- **A digest in check 4 changes.** The flow documents were edited unintentionally. Evidence invalidated:
  R12's byte-identical claim and any verdict citing it. Restore the document, re-run check 4.
- **A branch decision is recorded twice** (two `branch.decided` events for one (step, digest)). Evidence
  invalidated: R10 and every replay claim. The invariant is checked in check 6; the cure is to reject the
  duplicate in the engine, never to delete an event (the log is append-only).
- **A replay calls the router** (check 8 sees a non-zero second call). Evidence invalidated: R11. Cure: read
  the recorded decision **before** the seam decides, and assert the zero-call property in the test.
- **A partial change lands** (S2 green, S7 red). The schema additions are inert without the engine path: a
  `branch` flow loads but refuses `ROUTE_UNAVAILABLE` at advance, which is fail-closed and harmless; the
  next slice resumes from S7. Nothing is silently half-routed.
- **A crash lands between the acceptance and the `branch.decided` append.** The artifact is accepted, no
  decision is recorded and the step is still current, so the next advance re-derives the route — and, with no
  record to reuse, calls the router again. That window is no wider than the pre-existing one between
  acceptance and `setStatus`; it is a retry, not a lost decision, and nothing is silently mis-routed.
- **The store is older than the change.** No migration exists or is needed: events are read by type and an
  old store simply has no `branch.decided` rows (R14).

## Out of scope

Wait, trigger, human node and nesting (`docs/FLOWS.md` §5.2-5.5); branch arms into a `join`; more than 8
arms; CLI routing (R15); agent-supplied routes; a `merge` marker or a route table; any change to the
quality gate, bars, scorer, recall ranker, store schema, task documents, shipped flows, `AGENTS.md` or the
`pi` tool envelope; and any `src/`, `tests/` or `.pi/` edit **by this unit** (R16).
