# Plan — task-as-data flow model

Task: task-data-flow-model · Hash: 7b1ebe17 · Gate: G3 · Status: draft · Date: 2026-10-29

Basis: `spec.md` in this folder (provisional, frozen 2026-10-29 by owner directive; ids
R1–R9 below) and `docs/templates/plan.md`. No implementation starts before the G3 review in
step 0 passes; the owner's D3 override ("implementation proceeds in ordered slices beside the
plan") permits slices to be prepared but not merged ahead of a PASS.

Every declaration is bound to a requirement (`MIN-004`); nothing is added for a hypothetical
future (`MIN-006`); each fact keeps one owner (`MIN-005`): a task document owns work, a flow
document owns wiring, a definition row owns bytes, a publication row owns "this version was
published", the artifact row owns the accepted digest.

## 0. State of the tree at G3 time

Recorded because a reviewer cannot judge a delta against an assumed baseline.

| Observation | Command | Output |
| --- | --- | --- |
| Eight codes and the `CODES` mirror already exist **uncommitted** in the working tree, plus `tests/types/errors.test.ts` (untracked). This is the codes slice: applied by **engineer-1** under lead's re-issue `05a7cf14-e5bc-4bd2-a67b-2f9dd9542194` (the first issue `4b9c8803` was cancelled and the work reverted, then restored verbatim). It is **unclaimed** — that assignment's claims array is empty because the claim window closed at `reported` — and its state is `completion_sent`, `nextAction: wait`, so **commit / keep / back out is lead's decision, not this plan's and not mine**. My claims are `plan.md` only. | `git status --porcelain`; engineer-1 room posts (sq5 seq 44, 46, 48, 51); reviewer-1 and reviewer-2 room posts (seq 47, 49, 50) | `M src/types/errors.ts`, `M src/types/pi.ts`, `?? tests/types/` |
| The typecheck was **red when this plan was drafted**, then a parallel writer narrowed that one assertion (16:53) and it is green | `npx tsc --noEmit` at 16:52 → `tests/store/store.test.ts(297,46): error TS2339: Property 'section' does not exist…`; at 16:54 → `exit=0` |
| Test baseline | `node --test 'tests/**/*.test.ts'` | `tests 91`, `pass 91`, `fail 0` |
| A **live store already exists** with `config_digest` and possibly `blocked` rows | `ls -la .pi/praxis/state` | `praxis.sqlite` 61440 bytes, `artifacts/` |
| The two committed flow files are byte-identical today | `cmp .pi/praxis/config.json .pi/praxis/flows/research.json` | identical (43 lines each) |
| **The tree moved under this plan, and that path is now attributed.** At 16:53 `tests/store/store.test.ts:294-300` was narrowed (+4/−1) by **engineer-1** under lead's assignment `9ecf3aa9-c965-45b4-868b-a7391ab52945`; it fixes a regression lead introduced in `0eaf129`, which widened `requires` to `Requirement \| Requirement[]` and so broke `step.requires?.section` with TS2339. It cleared the only typecheck error, which is why reviewer-1 and reviewer-2 measured `exit=2` before it and this seat measured `exit=0` after. It is independent of the codes slice; its claims array is empty too, so no live path claim exists over `tests/store` | `git status --porcelain`; `git show --stat 0eaf129`; lead room post (sq5 seq 54); engineer-1 room post (seq 55) | `M src/types/errors.ts`, `M src/types/pi.ts`, `M tests/store/store.test.ts`, `?? tests/types/`, `?? plan.md`; `4 insertions(+), 1 deletion(-)`; `0eaf129` is an ancestor of `HEAD 2f0450a` and touches `src/types/schema.ts`, `src/runner/{engine,requirements}.ts`, `.pi/praxis/flows/delivery.json` |
| Three seats agree on the slice independently | `sha256sum tests/types/errors.test.ts`; `node --test 'tests/**/*.test.ts'`; `grep -c` over the union | `5e79489b3fd54bba26539476cb881a0ec8d5ca97e147d708c678b2c626457c82` (identical to engineer-1's two statements and to reviewer-1's read); 25 codes; 85 lines; `tests 91 / pass 91 / fail 0`; `HEAD 2f0450a` |

Consequence for step 1: the codes slice is not re-authored here; step 1 *verifies* it and the
G4 owner confirms the slice is theirs. If it is reverted, step 1 re-lands it exactly as
`spec.md`'s failure-code section states.

Consequence for C6: the typecheck is green at G3 time. Any diagnostic appearing during steps
2–6 is that step's failure, not an inherited one; step 4's rewrite of the committed-config
assertion keeps the narrowing the parallel writer made. If a later concurrent edit turns C6 red
again, the step that observes it stops and reports rather than absorbing it.

## 1. Readings this plan assumes

The spec is provisional. Where it leaves a question open, the plan names it here and adopts one
reading; none of these edits `spec.md`, and a reading the owner rejects is a spec amendment,
not a plan change.

- **A1 Node order is execution order.** R7 defines `refuse` against "an earlier node" but the
  new shape has no positional predecessor. Reading: `nodes[]` is declared in execution order;
  a `data`/`join` edge must go from a lower index to a higher one, a `refuse` edge from a
  higher index to a lower one. This is what makes "acyclic" checkable without a graph library.
- **A2 Fan-out is refused.** R7 constrains incoming edges only. Reading: a node that sources two
  consumption edges is `CONFIG_INVALID`, because otherwise `advance` has no unique successor
  and the flow is a branch — the alternative R7 already rejects. This is an **addition** to R7's
  stated refusals; if the owner wants fan-out, it needs a spec amendment (and a branch edge).
- **A3 `goal` is required in a task document.** R1 lists the keys and marks only `requires` and
  `bindsSubject` optional, so `goal` is required; today `StepConfigSchema` has it optional
  (`src/types/schema.ts:88`). Every committed step already carries one, so migration is lossless.
- **A4 The library directory is an engine option, the file name is derived.** R1 fixes the path
  `.pi/praxis/tasks/<id>@<version>.json`. Reading: `tasksDir` defaults to
  `<cwd>/.pi/praxis/tasks` exactly as `storeDir` defaults to `<cwd>/.pi/praxis/state`
  (`src/runner/engine.ts:113`); the file name is derived from `id` and `version` and never
  passed in. Spec's own open question allows this ("the runtime resolves a directory").
- **A5 A publication row is global, not per instance.** R3 says one row per `id@version`.
- **A6 Pins hold canonical bytes.** R4 says "canonical bytes"; a whitespace-only edit to a flow
  file therefore does not change a pin, and an advance cannot tell it happened. Stated as a
  limit, not a guarantee.
- **A7 A join node's `derived_from` is `null` and its accepted event carries `sources`.** R7
  says a join "carries them in declared order" but names no record. The smallest observable is
  the ordered `step@version` list on the `artifact.accepted` event, present only for a join, so
  `derivedFrom` (single source) and `sources` (join) never describe the same fact twice.
- **A8 Reopening an instance after `config_digest` retires compares the pinned flow row.** The
  `REQUEST_CONFLICT` test (`start` with the same request id and different config bytes) keeps
  its behaviour; the authority moves from the instance column to the `definition` row.
- **A9 `PIN_MISSING` is non-terminal, `PIN_CORRUPT` is terminal.** R4's oracle says a missing
  row yields `PIN_MISSING` and no artifact; R5's says a mismatch yields `PIN_CORRUPT` **and**
  `failed`. Reading: a missing row is a broken store, a mismatching row is a corrupted pin.
- **A10 Code precedence inside the gate is the order the checks are recorded.** R6 fixes only one
  ordering (the `subject`-vs-`derivedFrom` pair before the retained
  `derivedFromMatches`); the plan makes the whole sequence explicit: object, schema, nonce,
  subject present, subject pair, derivedFrom, sections. The first failing check decides the code.
- **A11 No store migration.** Gate #7 (store migration) is open, so the store identity is bumped
  to `praxis.store/v2` and a v1 store is refused at open by the existing `meta` pin
  (`src/store/db.ts:138`). The live `.pi/praxis/state/praxis.sqlite` becomes unreadable; it is
  moved aside, not converted (Recovery).
- **A12 `src/runner/step.ts` needs a scope extension.** Unit D's recorded scope names
  `src/runner/engine.ts` only; `engine.ts` is 606 lines today and must not grow, so the step
  body moves out. `src/store/definitions.ts` is inside the recorded `src/store/` scope and needs
  no extension. **G4 may not create `src/runner/step.ts` until the owner records it.**

Two citation drifts in the frozen spec, recorded rather than silently followed: the closed union
starts at `src/types/errors.ts:19`, not `:15`; and R6's "retained" check at
`src/runner/engine.ts:595` is retained as a *check*, but the plan widens `gate` in place, so its
line number moves. Neither changes a requirement.

## 2. Requirement basis

| Id | Requirement (from `spec.md`) | Oracle (check below) |
| --- | --- | --- |
| R1 | A task is one strict `praxis.task/v1` JSON unit at `.pi/praxis/tasks/<id>@<version>.json` | C2 seven fixtures |
| R2 | A node is exactly `{id, task}`; `task` is `id@version`; ids kebab and unique | C2, C3 |
| R3 | Identity `id@version`; publication durable; draft not pinnable; rewrite refused | C5 (draft, rewrite, two versions) |
| R4 | Start pins flow + every task version in one transaction; advance reads pins only | C5 (pin, edit-after-start, deleted row) |
| R5 | Every advance recomputes pinned digests; `config_digest` retired; mismatch terminal | C5 (corrupt row, one-owner digest), C4 (v1 store), C10 |
| R6 | A `bindsSubject` task must carry `subject` equal to its own `derivedFrom` | C9 six oracles |
| R7 | Three edge kinds with the stated refusals; join carries sources in order | C3 (the R7 refusals, then the join) and C9 row 6 |
| R8 | `running\|completed\|failed`; `blocked` removed; refusal codes as stated | C4 (two rows) |
| R9 | The parent result keeps exactly six keys; no pin digest inside it | C10 |

## 3. Affected declarations

Every declaration the change touches, private helpers and tests included. "Before" cites the
current line; the command behind each citation is in §7.

| Path | Declaration | Before | Effect | Requirement | Callers |
| --- | --- | --- | --- | --- | --- |
| `src/types/errors.ts` | `Code` (`:19`) | 17 names, union closes at `INTERNAL` | **extend by 8** — `NODE_INVALID`, `TASK_NOT_FOUND`, `TASK_NOT_PUBLISHED`, `TASK_VERSION_CONFLICT`, `PIN_MISSING`, `PIN_CORRUPT`, `SUBJECT_MISSING`, `SUBJECT_STALE` (present, uncommitted) | W4 | `src/types/pi.ts:106` mirror; every `fail()` site |
| `src/types/pi.ts` | `CODES` (`:106`) | 17 names, `as const satisfies readonly Code[]` | extend by the same 8 in the same order (present, uncommitted) | U5 | `FailureCodeSchema` (`:134`) → `FailureDetailsSchema` (`:138`) → `failure()` in `src/pi/tool.ts:208` |
| `src/types/schema.ts` | `StepConfigSchema` / `StepConfig` (`:75`, `:92`) | id, capabilities, produces, consumes?, gate, goal?, `requires?: Requirement \| Requirement[]` (the union and its `equals` clause arrived in `0eaf129`), onRefuse? | **replace** by `TaskConfigSchema` / `TaskConfig`: id, version, state, goal, capabilities, produces, gate, `requires?` (same union, unchanged), bindsSubject? | R1 | engine `:29`, `:425`, `:540`; tool `:24`, `:145` |
| | `TaskStateSchema`, `TaskRefSchema`, `parseTaskRef` (new) | — | create: `draft\|published`; `^<kebab>@[1-9][0-9]*$`; `{id, version}` or `CONFIG_INVALID` | R1, R2, R3 | `FlowConfigSchema`, engine `openFlow` |
| | `NodeSchema` (new) | — | create: strict `{id, task}`, a third key is a parse failure | R2 | `FlowConfigSchema` |
| | `EdgeSchema` (new) | — | create: strict `{kind: data\|join\|refuse, from, to}` | R7 | `FlowConfigSchema` |
| | `FlowConfigSchema` (`:99`) | `steps: StepConfigSchema[1..16]` + superRefine over indices | **replace**: `nodes: NodeSchema[1..16]`, `edges: EdgeSchema[0..32]`, superRefine over A1/A2/R7 | R2, R7 | `parseFlowConfig` (`:228`) → engine `:148`; `tests/store/store.test.ts:293` |
| | `ResolvedNode` (new type) | — | create: `{node, task, sources, refuse?}` — composition, never a second copy of a task field | R2, R7 | engine `advance`, tool `currentStepOf` |
| | `InstanceStatusSchema` (`:143`) | `running, blocked, completed, failed` | **replace**: `running, completed, failed` | R8 | `src/store/instance.ts:35`, `:115`, `:141`; `src/runner/result.ts` |
| | `InstanceSchema` (`:151`) | carries `configDigest` (`:155`) | **remove the field**; the flow digest lives in its `definition` row | R5 | `src/store/instance.ts:86`, `:111`, `:128`; `buildResult` |
| | `ArtifactSchema` (`:172`) | `derivedFrom: DigestSchema.nullable()` (`:180`) | **unchanged** — this is the field R6 compares | R6 | `src/store/artifacts.ts` |
| | `ResultSchema` (`:195`) | exactly six keys | **unchanged** | R9 | `result.ts:52`, `pi.ts:78`, `:85` |
| | `parseFlowConfig` (`:228`) | every issue → `CONFIG_INVALID` | classify: a node's unrecognized key → `NODE_INVALID`, everything else → `CONFIG_INVALID` | R2 | engine `:148`; `tests/store/store.test.ts:293-316` |
| `src/store/db.ts` | `STORE_SCHEMA` (`:17`) | `praxis.store/v1` | replace with `v2` so a v1 file fails closed at `:138` | R4, R5 | `openStore` (`:108`), inserted at `:136` |
| | `SCHEMA_STATEMENTS` (`:19-61`) | `meta`, `instance` (with `config_digest` `:28`), `event`, `artifact` | replace: drop `config_digest`; add `definition(instance, kind, id, digest, bytes BLOB)` and `publication(task, version, digest, at)` | R3, R4, R5 | `openStore` (`:135`) — sole user of the private const |
| | `openStore` (`:108`) | — | unchanged | R3, R4 | engine `:122` (only caller) |
| `src/store/instance.ts` | `InstanceRowSchema` (`:30`) | includes `config_digest` (`:34`) | remove the key; a stored `blocked` row now fails here → `STORE_INVALID` (`:78`) | R5, R8 | `toInstance` (`:78`) |
| | `SELECT_ROW`, `INSERT_ROW` (`:52`, `:55`) | select/insert `config_digest` | remove the column from both | R5 | `loadInstance` (`:97`), `createInstance` (`:107`) |
| | `CreateInstanceInput` (`:64`) | carries `configDigest` | remove it; the pin set is passed separately | R4 | engine `:248` |
| | `createInstance` (`:107`) | opens a transaction, inserts one row | reimplemented over `insertInstance`; behaviour and `REQUEST_CONFLICT` unchanged | R4 | engine `:248`; `tests/store/store.test.ts:12` |
| | `insertInstance` (new) | — | create: transaction-free insert, used only inside a caller-owned transaction | R4 | engine `start`, `createInstance` |
| | `TRANSITIONS` (`:44-49`) | `running:[blocked,completed,failed]`, `blocked:[running,failed]` | replace: `running:[completed,failed]`, `completed:[]`, `failed:[]`; the guard at `:156` is unchanged | R8 | `setStatus` (`:139`) |
| `src/store/definitions.ts` (new) | `DefinitionSeed`, `DefinitionRowSchema`, `insertDefinition`, `readDefinition`, `PublicationRowSchema`, `publicationOf`, `insertPublication` | — | create: the two pin tables' only owner; `readDefinition` verifies `digest(bytes)` and raises `PIN_MISSING`/`PIN_CORRUPT`; the two `insert*` are transaction-free by contract | R3, R4, R5 | engine `start`, `loadPinnedFlow` |
| `src/runner/engine.ts` | `Handoff` (`:48`) | four fields | **move** to `step.ts` | R7 | `advance` (`:344`) |
| | `EngineOptions` (`:55`) | `storeDir`, `configPath`, `now`, `actor` | + `tasksDir?`; `tasksDirOf` added beside `storeDirOf` (`:113`) | R1 | tool `:104`; `cli.ts` keeps the default (untouched) |
| | `OpenedFlow` (`:85`) | `{config, configDigest, path}` | replace: `{config, flowDigest, path, tasks}` | R1, R4 | engine `:218`, tool `:145`, `:161` |
| | `Inspection` (`:97`) | `{instance, result}` | + `flow` (the pinned flow) so the tool never re-opens the library | R5 | tool `:245`, `:262` |
| | `GateSubject` (`:102`) | loose `{schema, nonce, derivedFrom?}` | + typed `subject?: string` (the object stays loose) | R6 | `gate` (`:583`) |
| | `openFlow` (`:131`) | reads, parses, validates one file | + resolve every task reference from the library; digest the canonical document | R1, R2 | engine `:218`; tool `:29`, `:256`, `:262`, `:290` |
| | `validateFlow` (`:153`) | duplicate ids, `consumes` precedes | **replace**: A1/A2 plus R7's refusals; gains the task map for "bindsSubject over a join" | R7 | `openFlow` (`:148`) — sole caller |
| | `loadPinnedFlow` (new) | — | create: definition rows → verified bytes → `FlowConfig` + task map + digest | R4, R5 | `advance`, `inspect` |
| | `start` (`:217`) | pins `configDigest` on the instance row | pin flow + tasks + first publications in one transaction; reopen compares the pinned flow digest + actor | R3, R4 | tool `:239`; `cli.ts:98` |
| | `advance` (`:311`) | `openFlow` (`:312`) then compares `configDigest` (`:326-333`) | `loadPinnedFlow`; `PIN_CORRUPT` → `failed` then throw; sources/refuse/successor from edges | R4, R5, R7, R8 | tool `:249`; `cli.ts:102`, `:129` |
| | `gate` (`:583`) + `Verdict` (`:575`) | object, schema, nonce, `derivedFromMatches` (`:595`), sections | + `subjectPresent`, `subjectMatchesDerived`; `Verdict.code` carries `SUBJECT_MISSING`/`SUBJECT_STALE`/`ARTIFACT_INVALID` per A10; the `:595` check is retained | R6 | `advance` (`:355`) |
| | `runStep` (`:444`), `refused` (`:510`), `parseStored` (`:517`), `probeArtifact` (`:526`), `buildHandoff` (`:540`), `RunStepArgs` (`:421`), `StepArtifact` (`:432`) | in `engine.ts` | **move** to `step.ts`; `buildHandoff` becomes `buildHandoffs` returning an ordered array; `derivedFrom` is the single digest or `null` for a join | R7 | `advance` (`:344`, `:345`) |
| `src/runner/step.ts` (new) | the seven declarations above | — | create by moving, not by rewriting | R7 | `advance` |
| `src/pi/tool.ts` | `engineOptions` (`:104`) | `configPath`, `storeDir` from `ctx.cwd` | + `tasksDir` from `ctx.cwd` | R1 | `:232`, `:248`, `:261`, `:290`; `tests/pi/config-path.test.ts` |
| | `currentStepOf` (`:145`) | returns `StepConfig` | returns `ResolvedNode`; the grant is built as `{id: node.id, capabilities: node.task.capabilities}` because `capabilities.ts` is out of scope and must not change | R2 | `:162`, `:273` |
| | `stepDescriptor` (`:161`) | `(flow, instance)` | same shape, reads the pinned flow | R5, R6 | `:242`, `:256` |
| | `startOperation` (`:232`) | uses `started.flow` (`:242`) | uses `inspect().flow` | R4 | `executePraxisTool` |
| | `submitOperation` (`:248`) | re-opens the library (`:256`) | uses `advance`'s pinned flow | R4, R5 | `executePraxisTool` |
| | `readOperation` (`:261`) | opens the library (`:262`) and compares digests (`:264-269`) | **semantic re-point**: the definition row is read and verified inside `inspect`, so `PIN_CORRUPT` is raised there and no library read remains on the read path | R5 | `executePraxisTool` |
| | `issueOperation` (`:290`) | opens the library | **unchanged** — the `issue` block is project configuration, not a pinned definition | — | `executePraxisTool` |
| `tests/testkit.ts` | `Workspace`, `writeFlow`, `StepFixture`, `MAIN_STEPS` | one config file, `steps[]` | `Workspace.tasks`; `writeFlow(ws, flow, nodes, edges?)` writes task documents under `ws.root/.pi/praxis/tasks`; `MAIN_STEPS` → `MAIN_TASKS` | tests | every runner test |
| `tests/store/store.test.ts` | the blocked transition (`:109-111`), `configDigest` (`:45`, `:93`), the committed-config parse (`:293-316`) | asserts `blocked` | replace: transition outside the table → `INSTANCE_STATE_INVALID`; a `blocked` row → `STORE_INVALID`; node/edge negatives; the `store.test.ts:297` type error is removed with the rewrite | R8, R2, R5 | — |
| `tests/runner/handoff.test.ts:148` | `config_digest` comparison | instance column | compare the `definition` row's digest instead | R5 | — |
| `tests/runner/result.test.ts:83` | instance fixture | carries `configDigest` | remove; add the six-key-with-divergent-pin row | R9 | — |
| `tests/pi/fixtures.ts:122` | fixture `configDigest` | `digestOf(config)` | remove; fixtures write task documents | R4 | — |
| `tests/runner/negative.test.ts`, `retry.test.ts`, `rework.test.ts`, `delivery-gate.test.ts`, `tests/pi/tool.test.ts` | their flow fixtures and `onRefuse` cases | `steps[]` + `onRefuse` | `writeFlow` with a `refuse` edge; `delivery-gate` also copies the five delivery task documents | R7 | — |
| `tests/runner/task-document.test.ts`, `task-library.test.ts`, `edges.test.ts`, `pin.test.ts`, `subject.test.ts` (new) | the 38 named rows in §7 | — | create | R1–R9 | — |

Not touched, and proved not touched by C8: `src/cli.ts`, `src/types/org.ts` (unused by this
unit), `src/types/issue.ts`, `src/runner/{canonical,capabilities,requirements,result,task,issues}.ts`,
`src/store/{artifacts,events}.ts`, `src/pi/{host,extension}.ts`, `package.json`,
`tsconfig.json`, `.pi/settings.json`.

## 4. Budget

| Path | Current LOC | After LOC | Split owner boundary if >600 |
| --- | --- | --- | --- |
| `src/types/schema.ts` | 232 | 310 | — |
| `src/types/errors.ts` | 77 | 77 | — (codes already written) |
| `src/types/pi.ts` | 142 | 142 | — (mirror already written) |
| `src/store/db.ts` | 155 | 185 | — |
| `src/store/instance.ts` | 175 | 160 | — |
| `src/store/definitions.ts` | 0 | 135 | — |
| `src/runner/engine.ts` | **606** | **520** | **The split is `src/runner/step.ts`** (`:421-573` move out), which is why engine drops. Contingency if it still exceeds 600 after step 5: `gate`/`GateSubject`/`Verdict` (`:575-606`) move to a second new file `src/runner/gate.ts` — a second scope extension, not a compression. |
| `src/runner/step.ts` | 0 | 185 | — |
| `src/pi/tool.ts` | 351 | 335 | — |
| `tests/testkit.ts` | 210 | 255 | — |
| `tests/store/store.test.ts` | 338 | 355 | — |
| `tests/runner/handoff.test.ts` | 168 | 172 | — |
| `tests/runner/result.test.ts` | 103 | 105 | — |
| `tests/runner/negative.test.ts` | 154 | 160 | — |
| `tests/runner/retry.test.ts` | 182 | 190 | — |
| `tests/runner/rework.test.ts` | 90 | 95 | — |
| `tests/runner/delivery-gate.test.ts` | 70 | 80 | — |
| `tests/pi/fixtures.ts` | 133 | 150 | — |
| `tests/pi/tool.test.ts` | 398 | 410 | — |
| `tests/runner/task-document.test.ts` | 0 | 90 | — |
| `tests/runner/task-library.test.ts` | 0 | 165 | — |
| `tests/runner/edges.test.ts` | 0 | 150 | — |
| `tests/runner/pin.test.ts` | 0 | 140 | — |
| `tests/runner/subject.test.ts` | 0 | 150 | — |

No file reaches 600 lines. The projections are estimates; exceeding one needs a recorded reason,
never compression (`docs/WORKFLOW.md` §7 rule 1). C11 verifies the only number that is a rule.

## 5. Steps

Ordered by dependency: model, load-bearing behaviour, integration, remaining approved behaviour.
Steps 2–3 are deliberately *not* individually green — a flow document that has become
`nodes[]+edges[]` cannot coexist with an engine that still reads `steps[]` without two owners
for the same fact, which R5 forbids. Each step's own check is executable at the moment the step
completes; the tree is whole at the end of step 5. That is stated here, not hidden.

```
0 gate ─ 1 codes ─ 2 task document ─ 3 flow graph + data ─ 4 store pins ─ 5 engine+tool
                                                                   └ 6 subject ─ 7 verify ─ 8 G5
```

### 0. G3 plan review — reviewer, `review.md` only

Review this plan against `spec.md` R1–R9 and the readings in §1. **Done when** `review.md` has
a `## G3 plan — attempt 1` section carrying the `sha256` of this file, findings against
requirement ids, and PASS. A FAIL returns here. No step below starts before a PASS, and none is
allowed to start at all until the owner records the scope extension in A12.

### 1. Failure taxonomy and its mirror — `src/types/{errors,pi}.ts`, `tests/types/errors.test.ts`

Already on disk uncommitted (§0), applied by engineer-1 under `05a7cf14` and awaiting lead. Step 1
does not commit it, does not re-author it and does not claim its paths; it verifies it, and if the
lead backs it out, step 1 re-lands it exactly as `spec.md`'s failure-code section states.
**Done when** C1 passes: the union has 25 names, the mirror has
the same 25 in the same order, an unknown name is refused by `FailureDetailsSchema`, and every
new code round-trips through the error shape. Requirement: failure-code section (R3, R4, R5, R6,
R1, R2).

### 2. Task document — `src/types/schema.ts`, `tests/runner/task-document.test.ts`

Add `TaskStateSchema`, `TaskConfigSchema`, `TaskConfig`; keep `StepIdSchema` untouched as the id
rule. **Done when** C2 passes: the seven R1 fixtures assert the typed code and that the task
library on disk is unchanged. Requirement: R1 (and A3).

### 3. Flow graph and the committed data — `src/types/schema.ts`, `.pi/praxis/tasks/`, `.pi/praxis/flows/`, `tests/testkit.ts`, `tests/runner/edges.test.ts`

Add `NodeSchema`, `EdgeSchema`, `TaskRefSchema`, `parseTaskRef`, `ResolvedNode`; replace
`FlowConfigSchema`; classify a node's unrecognized key as `NODE_INVALID` in `parseFlowConfig`.
Migrate the committed documents — `.pi/praxis/tasks/{web,evidence,code,prepare}@1.json` from the
current `config.json` steps and `.pi/praxis/tasks/{research,spec,plan,implement,review}@1.json`
from `delivery.json`, whose `requires` clauses (including the review gate's `verdict: PASS`
`equals` clause) move into the task documents unchanged — and rewrite `.pi/praxis/config.json`, `.pi/praxis/flows/research.json` and
`.pi/praxis/flows/delivery.json` as node/edge documents, the `review → plan`
`"onRefuse"` (`.pi/praxis/flows/delivery.json:258`) becoming a `refuse` edge. `config.json` and
`flows/research.json` stay byte-identical to each other (C12); this supersedes the earlier
"stay byte-identical" promise recorded for the delivery flow, which the G2 spec already made plan
work. The migrated `review@1.json` alone declares `bindsSubject: true`, so the shipped delivery
flow exercises R6 rather than only the test fixtures; no other migrated task declares it. The
behaviour consequence is stated rather than left to G4: a delivery review artifact that omits
`subject` is refused `SUBJECT_MISSING`, stays pending and follows the `refuse` edge back to
`plan` — a real change to the shipped flow, and the change this unit exists for. The
docs-contract helpers in `src/runner/task.ts` keep their meaning and are not renamed.
**Done when** C3 passes (ten schema-level negatives) and C12 confirms all three committed
documents parse and the two research files are identical to each other. Requirement: R2, R7, R3 (identity).

### 4. Pins in the store — `src/store/{db,instance,definitions}.ts`, `tests/store/store.test.ts`

Bump `STORE_SCHEMA` to v2; drop `instance.config_digest`; add the `definition` and
`publication` tables behind `definitions.ts`; add `insertInstance`; remove `blocked` from the
enum's consumer (`TRANSITIONS`) and `config_digest` from the row schema, the two SQL statements
and `CreateInstanceInput`. **Done when** C4 passes: 14 `✔` including a stored `blocked` row
surfacing as `STORE_INVALID` through `InstanceRowSchema`, a transition outside the table
refused as `INSTANCE_STATE_INVALID`, and a v1 store refused at open. Requirement: R3, R4, R5, R8.

### 5. Engine integration — `src/runner/{engine,step}.ts`, `src/pi/tool.ts`, fixtures, `tests/runner/{task-library,edges,pin}.test.ts`

The one step that cannot be split further: `start` must pin and `advance` must read pins in the
same change, or the flow digest has two owners in a shipped state (R5). Contents: `tasksDirOf`
and `EngineOptions.tasksDir`; `openFlow` resolving tasks; `validateFlow` over nodes/edges;
`loadPinnedFlow`; pin writes inside `start`'s single transaction with the publication conflict
check; `advance` reading pins, executing `data`/`join`/`refuse`, and setting `failed` on
`PIN_CORRUPT`; the move of `:421-573` into `step.ts` with `buildHandoffs`; `inspect` returning
the pinned flow; the tool's `tasksDir`, `currentStepOf`, `stepDescriptor` and the three
operation paths. **Done when** C5 (12 `✔`), C6 (`npx tsc --noEmit` exit 0, green at G3 time and left green),
C3 rows 12 and 19 (absent version, join order) and C11 (`engine.ts ≤ 600`) all pass. Requirement: R4, R5, R7, R8.

### 6. Subject binding — `src/runner/engine.ts`, `tests/runner/subject.test.ts`

Widen `GateSubject` and `gate`; carry the deciding code on `Verdict`; make `advance` raise it.
The retained comparison at `:595` keeps its meaning and now sits after the pair check (A10).
**Done when** C9 passes: six `✔` covering accept, stale, missing, self-contradicting, the
non-`bindsSubject` case, and `bindsSubject` over a join refused as `CONFIG_INVALID`.
Requirement: R6, R7.

### 7. Verification — nothing written

**Done when** C7 (full suite, 0 fail, ≥132 tests), C8 (the untouched-file diff is empty), C10
(six keys with a divergent pin), C11, C12 and the recorded evidence in §7 all pass in one run
and the outputs are pasted into the report. Requirement: R9 and every requirement's oracle
re-executed together.

### 8. G5 implementation review — reviewer, `review.md` only

**Done when** C13 passes: `review.md` has a G5 section with the `sha256` of every changed file, findings
against requirement ids, a minimality challenge (`MIN-006`, `MIN-009`, `MIN-010`) and a
verdict. G6 owner acceptance is outside this plan.

## 6. Checks

| # | Command | Scope | Expects |
| --- | --- | --- | --- |
| C0 | `grep -n "## G3 plan — attempt 1" docs/task-data-flow-model-7b1ebe17/review.md` | gate | one line; the section names this file's `sha256` and PASS |
| C1 | `node --test tests/types/errors.test.ts` | narrow | `fail 0`; the union and the mirror each name 25 codes; `NODE_INVALID` refused for an empty message |
| C2 | `node --test tests/runner/task-document.test.ts` | narrow | `7 ✔`, `fail 0`; each row names its typed code |
| C3 | `node --test tests/runner/edges.test.ts > /tmp/c3.out; grep -Fc '✔' /tmp/c3.out` | narrow | `10` at step 3, `12` after step 5; `fail 0` |
| C4 | `node --test tests/store/store.test.ts > /tmp/c4.out; grep -Fc '✔' /tmp/c4.out` | narrow | `14`, `fail 0` |
| C5 | `node --test tests/runner/task-library.test.ts tests/runner/pin.test.ts > /tmp/c5.out; grep -Fc '✔' /tmp/c5.out` | narrow | `12` (7 + 5), `fail 0` |
| C6 | `npx tsc --noEmit; echo exit=$?` | full | `exit=0` and no diagnostic lines. Green at G3 time (§0); a new diagnostic is the failing step's defect |
| C7 | `node --test 'tests/**/*.test.ts' > /tmp/c7.out; tail -8 /tmp/c7.out` | full | `fail 0`, `tests` ≥ 132 (91 baseline + 41 new) |
| C8 | `git diff --name-only HEAD -- src/cli.ts src/runner/capabilities.ts src/runner/requirements.ts src/runner/canonical.ts src/runner/result.ts src/runner/task.ts src/runner/issues.ts src/store/artifacts.ts src/store/events.ts src/pi/host.ts src/pi/extension.ts src/types/issue.ts package.json tsconfig.json .pi/settings.json` | full | empty output |
| C9 | `node --test tests/runner/subject.test.ts > /tmp/c9.out; grep -Fc '✔' /tmp/c9.out` | narrow | `6`, `fail 0` |
| C10 | `node --test --test-name-pattern "six keys when the pin differs" tests/runner/result.test.ts > /tmp/c10.out; grep -F "✔ the result keeps exactly six keys when the pin differs from the library" /tmp/c10.out` | narrow | exactly one `✔` line; a name-pattern run with no `✔` is a failed check, not a pass |
| C11 | `wc -l src/runner/engine.ts src/runner/step.ts src/types/schema.ts` | full | `engine.ts` ≤ `600`; every other file ≤ 600 |
| C12 | `node --experimental-strip-types -e 'const {parseFlowConfig}=await import("./src/types/schema.ts"); const fs=await import("node:fs"); for (const p of [".pi/praxis/config.json",".pi/praxis/flows/research.json",".pi/praxis/flows/delivery.json"]) parseFlowConfig(JSON.parse(fs.readFileSync(p,"utf8"))); const t=JSON.parse(fs.readFileSync(".pi/praxis/tasks/review@1.json","utf8")); if (t.bindsSubject !== true) throw new Error("the review task must bind a subject"); console.log("ok")'` and `cmp .pi/praxis/config.json .pi/praxis/flows/research.json` | full | `ok`, `identical`, and the review task carries `bindsSubject: true` |
| C13 | `grep -n "## G5" docs/task-data-flow-model-7b1ebe17/review.md` plus `sha256sum` of every changed file | gate | one G5 section naming every `sha256` and a verdict; a verdict without a digest is void (`docs/WORKFLOW.md` §3) |

Every check is executed and its real output recorded; a check that did not run is reported as not
run (`docs/WORKFLOW.md` §8). Nothing is written outside `/tmp` and the disposable store.

## 7. Named tests and citations

The 41 new rows, by requirement. A requirement with no row is a carried gap, not an implicit test.

| # | File | Named test | Step | Requirement |
| --- | --- | --- | --- | --- |
| 1 | task-document | `a task document with the declared keys loads` | 2 | R1 |
| 2 | task-document | `an undeclared task key is CONFIG_INVALID` | 2 | R1 |
| 3 | task-document | `a task without an id is CONFIG_INVALID` | 2 | R1 |
| 4 | task-document | `an unknown capability is CONFIG_INVALID` | 2 | R1 |
| 5 | task-document | `an upper-case task id is CONFIG_INVALID` | 2 | R1 |
| 6 | task-document | `version 0 is CONFIG_INVALID` | 2 | R1 |
| 7 | task-document | `a string version is CONFIG_INVALID` | 2 | R1 |
| 8 | edges | `a node with a third key is NODE_INVALID` | 3 | R2 |
| 9 | edges | `a duplicate node id is CONFIG_INVALID` | 3 | R2 |
| 10 | edges | `a bare task reference is CONFIG_INVALID` | 3 | R2 |
| 11 | edges | `a node naming a malformed reference is CONFIG_INVALID` | 3 | R2 |
| 12 | edges | `a well-formed reference to an absent version is TASK_NOT_FOUND` | 5 | R2 |
| 13 | edges | `an unknown edge kind is CONFIG_INVALID` | 3 | R7 |
| 14 | edges | `a join with one source is CONFIG_INVALID` | 3 | R7 |
| 15 | edges | `a forward refuse edge is CONFIG_INVALID` | 3 | R7 |
| 16 | edges | `two consumption edges into one node is CONFIG_INVALID` | 3 | R7 |
| 17 | edges | `a non-first node with no consumption edge is CONFIG_INVALID` | 3 | R7 |
| 18 | edges | `a fan-out from one node is CONFIG_INVALID` | 3 | R7 (A2) |
| 19 | edges | `a join hands off both sources in declared order` | 5 | R7 |
| 20 | task-library | `pinning a draft task is TASK_NOT_PUBLISHED` | 5 | R3 |
| 21 | task-library | `a rewritten published version is TASK_VERSION_CONFLICT` | 5 | R3 |
| 22 | task-library | `a version never published before is taken on first use` | 5 | R3 |
| 23 | task-library | `two published versions are reachable only by their own reference` | 5 | R2, R3 |
| 24 | task-library | `three flows reuse one published task` | 5 | R1, R3 (acceptance) |
| 25 | task-library | `a re-opened request with different flow bytes is REQUEST_CONFLICT` | 5 | R4 (A8) |
| 26 | task-library | `an instance pins the task versions it ran under` | 5 | R4 |
| 27 | pin | `start pins the flow and every task version` | 5 | R4 |
| 28 | pin | `editing the flow and task files after start changes nothing on advance` | 5 | R4 |
| 29 | pin | `a deleted pin row is PIN_MISSING` | 5 | R4 |
| 30 | pin | `one corrupted pinned byte is PIN_CORRUPT and fails the instance` | 5 | R5 |
| 31 | pin | `the flow digest has one owner: the definition row` | 5 | R5 |
| 32 | store | `a v1 store is refused as STORE_INVALID` | 4 | R5 (A11) |
| 33 | subject | `a review citing the accepted version is accepted` | 6 | R6 |
| 34 | subject | `a review citing a superseded version is SUBJECT_STALE` | 6 | R6 |
| 35 | subject | `a review without a subject is SUBJECT_MISSING` | 6 | R6 |
| 36 | subject | `a subject that contradicts its own derivedFrom is ARTIFACT_INVALID` | 6 | R6 |
| 37 | subject | `a non-bindsSubject node with a stale derivedFrom is ARTIFACT_INVALID` | 6 | R6 |
| 38 | subject | `a bindsSubject node over a join is CONFIG_INVALID` | 6 | R6, R7 |
| 39 | store | `blocked is not a declared instance status` | 4 | R8 |
| 40 | store | `a transition outside the table is INSTANCE_STATE_INVALID` | 4 | R8 |
| 41 | result | `the result keeps exactly six keys when the pin differs from the library` | 7 | R9 |

Row 32 extends `store.test.ts` rather than the pin suite because the v1 refusal is proved at
`openStore` (`src/store/db.ts:138`), not through a run. Five new files; `store.test.ts` goes
from 11 rows to 14 (rows 32, 39, 40).

### Citations, with the commands pasted

```
$ grep -rn "config_digest\|configDigest" src/ tests/
src/runner/engine.ts:87,149,234,240,241,252,264,326,329,330
src/store/instance.ts:34,52,55,64,86,111,128
src/store/db.ts:28            src/types/schema.ts:155
src/pi/tool.ts:264,267,268
tests/runner/handoff.test.ts:148   tests/runner/result.test.ts:83
tests/store/store.test.ts:45,93    tests/pi/fixtures.ts:122
(27 sites, matching spec R5's list exactly)

$ grep -rn "advance(" src/ tests/
src/runner/engine.ts:311 (definition)
src/cli.ts:102   src/cli.ts:129   src/pi/tool.ts:249

$ grep -rn openFlow src/ tests/
src/runner/engine.ts:131 (definition) :218 :312
src/pi/tool.ts:29 (import) :256 :262 :290

$ grep -rn "blocked" src/ tests/
src/store/instance.ts:45,46        src/types/schema.ts:143
tests/store/store.test.ts:109-111
src/cli.ts:115 (a comment)         src/pi/tool.ts:43 (prose)

$ grep -n "^export function\|^function\|^interface\|^export interface" src/runner/engine.ts
48 Handoff · 55 EngineOptions · 85 OpenedFlow · 97 Inspection · 102 GateSubject
113 storeDirOf · 131 openFlow · 153 validateFlow · 201 acceptedRefs · 217 start
284 inspect · 292 readStepArtifact · 311 advance · 421 RunStepArgs · 432 StepArtifact
444 runStep · 510 refused · 517 parseStored · 526 probeArtifact · 540 buildHandoff
575 Verdict · 583 gate

$ grep -n "export const StepConfigSchema\|export const FlowConfigSchema\|export const InstanceStatusSchema\|export const InstanceSchema\|export const ArtifactSchema\|derivedFrom: DigestSchema\|export const ResultSchema\|export function parseFlowConfig" src/types/schema.ts
75 StepConfigSchema · 99 FlowConfigSchema · 143 InstanceStatusSchema · 151 InstanceSchema
172 ArtifactSchema · 180 derivedFrom · 195 ResultSchema · 228 parseFlowConfig

$ grep -n "SCHEMA_STATEMENTS\|STORE_SCHEMA\|CREATE TABLE IF NOT EXISTS" src/store/db.ts
17 STORE_SCHEMA · 19 SCHEMA_STATEMENTS · 20 meta · 24 instance · 28 config_digest
36 event · 44 artifact · 108 openStore · 135 the const's only use

$ grep -n "const TRANSITIONS\|^export function\|InstanceRowSchema\|if (status !== current.status" src/store/instance.ts
30 InstanceRowSchema · 44 TRANSITIONS · 78 the STORE_INVALID parse · 97 loadInstance
107 createInstance · 139 setStatus · 156 the transition guard

$ wc -l src/runner/engine.ts
606

$ npx tsc --noEmit
tests/store/store.test.ts(297,46): error TS2339: Property 'section' does not exist …

$ node --test 'tests/**/*.test.ts'
tests 91 · pass 91 · fail 0

$ cmp .pi/praxis/config.json .pi/praxis/flows/research.json
identical

$ grep -n '"id"\|"onRefuse"' .pi/praxis/flows/delivery.json
6 research · 73 spec · 128 plan · 192 implement · 232 review · 258 "onRefuse": "plan"
```

## 8. Recovery

- **Step boundaries are the resume points.** `git status --porcelain -- src tests .pi/praxis`
  must list only the files step N names. Anything else is a stop condition
  (`docs/WORKFLOW.md` §9), not a merge.
- **The store is disposable, the live one is not migrated.** Before step 4, move
  `.pi/praxis/state/` aside (`mv .pi/praxis/state .pi/praxis/state.v1`). A v1 file opened by a
  v2 runtime fails closed as `STORE_INVALID` (A11); there is no repair path and none is claimed.
  A *partial* step-4 change is detected by C4's `v1 store` row, which asserts that refusal.
- **Evidence invalidation.** Once step 3 lands, every earlier artifact digest in a store was
  computed over the old `steps[]` document and the old `config_digest` column; nothing from a
  pre-step-3 store is reusable, and C5's `editing the flow and task files after start changes
  nothing` is the proof that this is a *pin* property, not a cache property. Once step 5 lands,
  a `definition` row's bytes are the only record of what an instance ran under: deleting one is
  `PIN_MISSING`, corrupting one is `PIN_CORRUPT` + `failed`, and neither is repairable by
  editing the library.
- **A killed step.** `advance` already reuses a `pending` artifact whose bytes match
  (`engine.ts:444-508`); the new pin reads happen before that, so a killed run re-reads the same
  pinned bytes and reaches the same verdict. C5's corrupt-row row proves the failure path writes
  no artifact.
- **If the subject check refuses.** The instance stays current and the refuse edge is followed
  when declared, exactly as a gate rejection does today (`engine.ts:369-376`); no new recovery
  path is introduced.
- **If the review FAILs** at step 0 or 8, this plan is amended and re-entered; no implementation
  merges on a FAIL.

## 9. Out of scope

- **No store migration, no retention, no GC.** Gate #7 stays open. A v1 store is refused, not
  converted, and a stored `blocked` row is `STORE_INVALID` with no repair path.
- **No flow expansion, nesting, budgets, background maintenance or a second flow per run.**
  Flow selection stays `PRAXIS_CONFIG` (`src/pi/tool.ts:110-118`); no tool argument selects a
  flow, and no new tool op exists.
- **No `src/cli.ts` change.** Consequence, stated as a limit: the CLI has no `--tasks` flag, so a
  CLI run resolves the library as `<cwd>/.pi/praxis/tasks` only, while the tool and engine accept
  `tasksDir`. Making the CLI selectable is a separate unit.
- **No change** to `src/runner/{canonical,capabilities,requirements,result,task,issues}.ts`,
  `src/store/{artifacts,events}.ts`, `src/pi/{host,extension}.ts`, `src/types/issue.ts`,
  `src/types/org.ts`, `package.json`, `tsconfig.json`, `.pi/settings.json` (C8).
- **No new capability name**, no identity, isolation, sandbox or exactly-once claim; gates #1–#3
  stay open and the only containment claim is routed-call denial. The review binding is to a
  digest, not a person.
- **No multi-actor reviewer independence**, no branch edge routing on an artifact payload
  (`spec.md` Alternatives), and no review over a join (refused as `CONFIG_INVALID`).
- **Join-edge evaluation is NOT excluded, and the judgement is recorded.** R7's oracle names a
  join fixture and a `bindsSubject`-over-join refusal, so join execution is part of R7 and cannot
  be separated from step 5 without leaving a requirement with no implementation. What *is*
  excluded is anything beyond the three declared edge kinds: fan-out (A2), branch routing, and a
  list-valued review subject.
- **Nothing under `tests/live/**`, nothing under `.dev/`**, and no `docs/WORKFLOW.md` gate
  change. `spec.md`, `research.md` and `review.md` are not edited by this plan; the two citation
  drifts in §1 are recorded here and owed to the next authorized spec touch.

## 10. Claims

This G3 assignment holds `plan.md` only; the reviewer holds `review.md` only. The prospective
G4 split, one writer per task folder, is: author — `src/types/schema.ts`, `src/store/**`,
`src/runner/{engine,step}.ts`, `src/pi/tool.ts`, `.pi/praxis/**`, `tests/**`; reviewer —
`review.md`. Claims are per file, at most two per assignment, never per folder, and they grant
no current rights. G4 may not start until the owner records `src/runner/step.ts` in unit D's
scope (A12).

amended 2026-10-29 — first G3 draft (attempt 1): model/edges/pins split, the `step.ts` scope
extension named as a precondition, the pre-existing red typecheck and the live v1 store recorded
as baseline — G3 not yet reviewed
amended 2026-10-29 — §0 now attributes the codes slice to engineer-1 / `05a7cf14` and separates it
from the unattributed `store.test.ts` narrowing, and records the three-seat agreement on the
digest and the 91/91 suite; step 1 states it verifies rather than commits that slice — the
provenance was vague ("another writer") and a reviewer could not check it, while the room posts
give ids, digests and times
amended 2026-10-29 — the `store.test.ts` narrowing is no longer described as unattributed: it is
engineer-1's `9ecf3aa9` fixing lead's `0eaf129` regression; `StepConfig.requires` is recorded as
the `Requirement | Requirement[]` union that commit introduced, the migration is stated to carry
the `verdict: PASS` `equals` clause into `review@1.json`, that task alone declares
`bindsSubject: true` so the shipped flow exercises R6, and C12 checks it — the earlier text
asserted an unattributable write and left the shipped review unbound to a subject
amended 2026-10-29 — step 3 states the delivery consequence of that binding: a review artifact
without `subject` is `SUBJECT_MISSING` and follows the `refuse` edge back to `plan` — a shipped
behaviour change that G4 must not discover on its own
