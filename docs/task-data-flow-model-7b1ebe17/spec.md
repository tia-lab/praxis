# Spec — task-as-data flow model

Task: task-data-flow-model · Hash: 7b1ebe17 · Gate: G2 · Status: draft · Date: 2026-10-29

## Outcome

A task is a versioned JSON document that a flow composes by id; a flow is nodes plus typed
edges (`data`, `join`, `refuse`); an instance pins the exact bytes of the flow document and of
every task it composes at start, so editing a flow or a task afterwards changes nothing about
what a running instance is judged by; and a review artifact must name the digest of the
artifact it judged, with a stale name refused before acceptance. Not included: implementing
any of it, migrating the two committed flow files, flow expansion or nesting, external effects,
and multi-actor identity.

Frozen owner decisions this spec does not reopen: **D1** tasks are separate units that flows
compose by id; **D2** a review binds to the digest of the artifact it judged; **D3** no code
before the plan passes.

What this spec decides, and what each decision rejected:

| Question | Decided by | Rejected alternative |
| --- | --- | --- |
| Q2 — which digest a review carries, and how a stale one is refused | R6 | the digest of an on-disk document (`docs/WORKFLOW.md:89` practice) |
| Q3 — the task as its own document, with its own schema, lifecycle and identity | R1, R3 | tasks inlined in the flow file |
| Q4 — the edge vocabulary beyond `consumes` and `onRefuse` | R7 | branch edges routing on artifact payload; a list-valued review subject |
| Q5 — whether `blocked` is reachable, and what it means | R8 | keep `blocked` as a join or owner-re-pin wait |
| The pinning question — an instance pins the definitions it ran under | R4, R5 | pin digests only, refusing when the library changed |

## Requirements

| Id | Requirement | Failure behaviour | Oracle |
| --- | --- | --- | --- |
| R1 | A task is one strict JSON document `praxis.task/v1`: `id`, `version`, `state`, `goal`, `capabilities`, `produces.schema`, `gate`, optional `requires`, optional `bindsSubject`. An undeclared key or a missing field is refused at load. | `CONFIG_INVALID` naming the path, zero writes; a task id absent from the library is `TASK_NOT_FOUND` at start | load four fixtures (valid, unknown key, missing `id`, unknown capability) and assert the typed code and an unchanged store file |
| R2 | A flow node names a task id and nothing else about the work; the flow owns the wiring. | unresolved id → `TASK_NOT_FOUND` before the instance row exists | start a flow naming `research-v9`; assert the code and `select count(*) from instance` unchanged |
| R3 | A task's identity is `id@version`; `state` is `draft` or `published`; only `published` may be pinned; a published version is never rewritten in place. | pinning a draft → `TASK_NOT_PUBLISHED`, zero writes | start against a draft task → typed code; start against published → succeeds |
| R4 | At start, in the same transaction as the instance row, the engine records one `definition` row per composed task and one for the flow document, each with canonical bytes and a `sha256:` digest. Every later advance reads definitions from the store, never from the library. | a pin row missing → `PIN_MISSING`; no step body runs | start, then mutate the flow and task files; `advance` behaves identically and the pinned digests are unchanged |
| R5 | Every advance recomputes the digest of the pinned bytes it uses; a mismatch is terminal. | `PIN_CORRUPT`, instance `failed`, zero artifact writes | corrupt one byte of a pinned row in a store copy; `advance` → code, status `failed`, no new artifact row |
| R6 | A task declaring `bindsSubject` must produce `subject: sha256:<64 hex>` equal to the digest of the accepted artifact it consumed. The gate compares; the caller does not. | absent `subject` → `SUBJECT_MISSING`; unequal → `SUBJECT_STALE`, artifact stays `pending`, refuse edge followed when declared, else the step stays current | accept `implement` v1, review citing v1 → accepted; accept v2, replay the v1 review → `SUBJECT_STALE`; review citing v2 → accepted |
| R7 | Three edge kinds: `data` (one source, carries that artifact), `join` (two or more earlier sources, carries them in declared order), `refuse` (one source to an earlier node, carries nothing). Every node except the first has exactly one incoming `data` or `join`; `refuse` edges are additional. | unknown kind, `join` with fewer than two sources, forward or self `refuse`, a node with two consumption edges, or a cycle → `CONFIG_INVALID` at load, zero writes | five negative configs asserting each code; one join fixture asserting the handoff lists both refs in declared order |
| R8 | Instance states are `running`, `completed`, `failed`; `blocked` is not a state of this model. | any transition outside the table in §Model, or a stored `blocked` row → `INSTANCE_STATE_INVALID` on load | transition-table test plus a negative load of a `blocked` row |
| R9 | The parent result keeps exactly its six keys; pinned definition digests are not added to it. | a seventh key, or a pin digest exposed to the caller | result assertion on a run whose pin differs from the library |

## Model

Each element has one owner, and its absence has a named consequence.

| Element | Owner | Valid states | Invariants | Requirement | Failure if absent |
| --- | --- | --- | --- | --- | --- |
| Task document | project file `.pi/praxis/tasks/<id>.json` | `draft`, `published` | identified by `id@version`; strict keys; only `published` is pinnable | R1, R3 | no stage definition: `TASK_NOT_FOUND` before any write |
| Task version | the document's `version` field | immutable per version | different bytes require a new version, never an in-place edit | R3 | two definitions share one identity, so a review cannot say what it judged |
| Flow document | project file `.pi/praxis/flows/<name>.json` | loadable or refused | nodes name task ids; edges typed; validated before any write | R2, R7 | the run starts on an unchecked graph |
| Edge | the flow document | `data`, `join`, `refuse` | acyclic; sources precede targets; one consumption edge per node | R7 | composition beyond a chain is inexpressible (research F2, F6) |
| Definition pin | the store, `definition(instance, kind, id, digest, bytes)` | `pinned` (immutable) | one row per composed unit plus the flow; digest over canonical bytes; written with the instance row | R4, R5 | a flow edit silently changes a live instance |
| Instance | `instance` row (`src/store/db.ts:24`) | `running`, `completed`, `failed` | `config_digest` is the flow digest; `current_step` names a node; terminal states never leave | R8 | no durable position to resume from |
| Artifact | `artifact` row (`src/store/db.ts:44`) | `pending`, `accepted` (`src/types/schema.ts:169`) | an accepted version is never rewritten; `derived_from` names the consumed digest (`src/types/schema.ts:180`) | R6 | a review has no bytes to bind to |
| Review subject | the review artifact's `subject` field | present and current, or stale | equals the digest of the judged artifact; checked by the gate before acceptance | R6 | a review could judge anything and still pass |

Instance state machine (writers named; the current table is `src/store/instance.ts:44-49` and
declares `blocked`, which this model removes):

| From | Event | To | Writer |
| --- | --- | --- | --- |
| `running` | last node's artifact accepted | `completed` | `advance` (`src/runner/engine.ts:408`) |
| `running` | pinned digest mismatch | `failed` | `advance`, R5 |
| `completed` | — | — | terminal |
| `failed` | — | — | terminal |

`blocked` has no writer in this model: joins read artifacts that are already accepted before the
node becomes current, pins are content-addressed so no re-pin wait exists, and the closed
capability registry (`src/types/schema.ts:22`) produces no external effect that could be pending.
The state is removed rather than left unreachable.

## Exclusions

- No implementation, no plan, no code (D3): this document fixes the model only.
- No migration of `.pi/praxis/flows/{delivery,research}.json` to the node/edge shape — plan work.
- No flow expansion, nesting, budgets or background maintenance.
- No external effects or adapters, which is why no wait state exists (see `blocked`, above).
- No multi-actor identity or reviewer independence; the review binding is to a digest, not a person.
- No new capability names: the registry stays closed at `artifact.read`, `artifact.write`, `emit`.
- No retention or migration promise for stores holding `blocked` rows; only `tests/store/store.test.ts:109` writes one today.

## Alternatives

| Alternative | Rejected because |
| --- | --- |
| Tasks inlined in the flow file (the current `steps[]`) | D1 freezes separate units; a task copied into N flows is N facts that can drift, and the current schema has nowhere to reuse one (`src/types/schema.ts:103`) |
| Review bound to the digest of an on-disk document, as `docs/WORKFLOW.md:89` describes | the runtime has no authority to read the working tree, and G1 F5 showed such prose digests are never checked; the artifact is the only bytes the runtime can verify |
| Branch edges routing on an artifact's payload (e.g. `verdict`) | needs an expression language and lets an artifact choose its own gate path; the `refuse` edge already carries the FAIL path, and a gate is a predicate, not a router (`MIN-006`) |
| Pin digests only, with `blocked` while the owner re-pins after a library edit | introduces a wait state and an owner action for a guarantee that content pinning gives with no state at all |
| Keep `blocked` as a join wait | join sources precede the node and are accepted before it becomes current, so the wait never occurs; a state with no writer is a defect |
| Let `bindsSubject` judge a list (a review over a join) | expands the gate to an order-sensitive digest list with no observed need; R7 validates `bindsSubject` nodes to exactly one `data` source |

## Open questions

None blocking. These were not established and do not change the design:

- whether the owner wants one review over several artifacts — the model refuses that shape today (R6, R7), and widening it later is a new requirement, not an open door;
- whether tasks belong in `.pi/praxis/tasks/` rather than beside the flow files — the runtime resolves a directory, so the location is not a fact it depends on;
- how the two committed flow files and the `blocked` transition test migrate — plan work, deliberately not specified here.
