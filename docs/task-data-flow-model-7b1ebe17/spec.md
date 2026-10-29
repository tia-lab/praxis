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
| R1 | A task is one strict JSON document `praxis.task/v1`: `id`, `version`, `state`, `goal`, `capabilities`, `produces.schema`, `gate`, optional `requires`, optional `bindsSubject`. `id` matches the existing `StepIdSchema` regex (`src/types/schema.ts:15`), so the library path is exactly `.pi/praxis/tasks/<id>.json`; `version` is an integer ≥ 1. An undeclared key or a missing field is refused at load. | `CONFIG_INVALID` naming the path, zero writes; a task id absent from the library is `TASK_NOT_FOUND` at start | five fixtures (valid, unknown key, missing `id`, unknown capability, id `Research`) asserting the typed code and an unchanged store file |
| R2 | A flow node is a strict object with exactly two keys, `id` and `task`; the flow owns the wiring, so a third key is refused. Node ids match the existing `StepIdSchema` regex (`src/types/schema.ts:15`) and are unique within the flow. The `task` field is an `id@version` reference, never a bare id. | a third key → `NODE_INVALID`; a non-kebab or duplicate node id → `CONFIG_INVALID`; a bare or malformed task reference (no `@version`) → `CONFIG_INVALID`; a well-formed reference to an absent version → `TASK_NOT_FOUND`, all before the instance row exists | a node carrying `consumes` → `NODE_INVALID`; node id `Plan` → `CONFIG_INVALID`; two nodes named `plan` → `CONFIG_INVALID`; a node naming `research-v9` → `CONFIG_INVALID` as a malformed reference; a node naming `research@9` with no such version → `TASK_NOT_FOUND`; with `research@1` and `research@2` both published, each is reachable only by its own reference and neither is ambiguous; `select count(*) from instance` unchanged |
| R3 | A task's identity is `id@version`; a flow node names it that way, and a bare id is `CONFIG_INVALID` (R2); `state` is `draft` or `published`; only `published` may be pinned. Publication is durable: on a version's first pin the engine writes `publication(task, version, digest)`, and every later pin of the same `id@version` compares against that row. | pinning a draft → `TASK_NOT_PUBLISHED`, zero writes; same `id@version` with different bytes after its first publication → `TASK_VERSION_CONFLICT`, zero writes, no pin or publication touched | pin `x@1`, change its bytes without changing `version`, start again → `TASK_VERSION_CONFLICT` with the first pin and publication digest unchanged; a version never pinned before is taken on first use, so a rewrite in that window is not observable and is stated as a limit, not checked |
| R4 | At start, in the same transaction as the instance row, the engine records one `definition` row per referenced `id@version` and one for the flow document (`kind: "flow"`), each with canonical bytes and a `sha256:` digest. For each task version pinned for the first time it also writes `publication(task, version, digest)` in the same transaction. The flow document's digest is owned by that row alone. Every later advance reads definitions from the store, never from the library. | a pin row missing → `PIN_MISSING`; no step body runs | start, then mutate the flow and task files; `advance` behaves identically and the pinned digests are unchanged |
| R5 | Every advance recomputes the digest of the pinned bytes it uses, the flow document included; `config_digest` is retired, so the flow digest has exactly one owner; its retirement sites are `src/types/schema.ts:155`, `src/store/db.ts:28`, `src/store/instance.ts:34,52,55,64,86,111,128`, `src/runner/engine.ts:87,149,234,240,241,252,264,326,329,330` and `src/pi/tool.ts:264,267,268`, plus the tests `tests/runner/handoff.test.ts:148`, `tests/runner/result.test.ts:83`, `tests/store/store.test.ts:45,93` and `tests/pi/fixtures.ts:122` — all plan work. `src/pi/tool.ts:264` is a semantic re-point at the pinned flow definition row, not a compile fix. A mismatch is terminal. | `PIN_CORRUPT`, instance `failed`, zero artifact writes | corrupt one byte of a pinned flow row in a store copy; `advance` → `PIN_CORRUPT`, status `failed`, no new artifact row |
| R6 | A task declaring `bindsSubject` must produce `subject: sha256:<64 hex>` equal to the payload's own `derivedFrom`. The gate compares that payload field with the artifact row's `derived_from` (`src/types/schema.ts:180`, recorded from the handoff digest), and the `subject`-vs-`derivedFrom` pair check precedes the existing `derivedFromMatches` comparison at `src/runner/engine.ts:595`, which is retained. On disagreement the artifact is refused; `subject` decides nothing. The retained check's mismatch is `SUBJECT_STALE` for a `bindsSubject` node and `ARTIFACT_INVALID` for any other node. | absent `subject` → `SUBJECT_MISSING`, pending, refuse edge followed when declared, else the step stays current; `subject` ≠ payload `derivedFrom` → `ARTIFACT_INVALID` (a self-contradicting review), same pending/refuse behaviour; payload `derivedFrom` ≠ the currently accepted digest → `SUBJECT_STALE`, same pending/refuse behaviour | accepted `implement` v1 then a review citing v1 → accepted; accept v2 and replay the v1 review → `SUBJECT_STALE`, no accepted row; a review with no `subject` → `SUBJECT_MISSING`; a review whose `subject` contradicts its own `derivedFrom` → `ARTIFACT_INVALID`; a review citing v2 → accepted |
| R7 | Three edge kinds: `data` (one source, carries that artifact), `join` (two or more earlier sources, carries them in declared order), `refuse` (one source to an earlier node, carries nothing). Every node except the first has exactly one incoming `data` or `join`; `refuse` edges are additional; a node whose task declares `bindsSubject` must take exactly one `data` source and may not sit over a `join`. | unknown kind, `join` with fewer than two sources, forward or self `refuse`, a node with two consumption edges or none, a `bindsSubject` node over a `join`, or a cycle → `CONFIG_INVALID` at load, zero writes | six negative configs (unknown kind; one-source `join`; forward `refuse`; two consumption edges; zero consumption on a non-first node; `bindsSubject` over a `join`) asserting each code, plus one join fixture asserting the handoff lists both refs in declared order |
| R8 | Instance states are `running`, `completed`, `failed`; `blocked` is removed from the enum at `src/types/schema.ts:143` and from the transition table at `src/store/instance.ts:44-49`. `tests/store/store.test.ts:109-111` asserts the removed transition and must be edited: that is plan work, not spec work. | a transition outside the table → `INSTANCE_STATE_INVALID` from the guard at `src/store/instance.ts:156-162`; the same code is also emitted at `src/runner/engine.ts:319-324`, `src/store/instance.ts:115,117,141,142` and `src/cli.ts:116`; a stored `blocked` row fails `InstanceRowSchema` and surfaces as `STORE_INVALID` (`src/store/instance.ts:78`) — no new mapping is introduced | transition-table test; a negative load of a `blocked` row asserting `STORE_INVALID`; and a schema-level negative load of a status outside the three-value enum (`src/types/schema.ts:143`) asserting the same `STORE_INVALID` from the same parser |
| R9 | The parent result keeps exactly its six keys; pinned definition digests are not added to it. | a seventh key, or a pin digest exposed to the caller | result assertion on a run whose pin differs from the library |

### Failure codes

The union in `src/types/errors.ts` is closed (`Code`, `:15-32`). This spec extends it with eight
codes and repurposes none: `NODE_INVALID`, `PIN_MISSING`, `PIN_CORRUPT`, `SUBJECT_MISSING`,
`SUBJECT_STALE`, `TASK_NOT_FOUND`, `TASK_NOT_PUBLISHED`, `TASK_VERSION_CONFLICT`.
`ARTIFACT_INVALID`, already in the union, carries a review whose `subject` contradicts its own
`derivedFrom`. Widening the union is plan work and puts `src/types/errors.ts` in unit D's scope, and the `CODES` mirror in `src/types/pi.ts:106-124` must be widened with it.

## Model

Each element has one owner, and its absence has a named consequence.

| Element | Owner | Valid states | Invariants | Requirement | Failure if absent |
| --- | --- | --- | --- | --- | --- |
| Task document | project file `.pi/praxis/tasks/<id>.json` | `draft`, `published` | identified by `id@version`; strict keys; only `published` is pinnable | R1, R3 | no stage definition: `TASK_NOT_FOUND` before any write |
| Task version | the document's `version` field | none — an identity, not a state | immutable per version: different bytes require a new version, never an in-place edit | R3 | two definitions share one identity, so a review cannot say what it judged |
| Flow document | project file `.pi/praxis/flows/<name>.json` | loadable or refused | nodes name task ids; edges typed; validated before any write | R2, R7 | the run starts on an unchecked graph |
| Node | the flow document | none (static) | exactly `id` and `task`; a third key → `NODE_INVALID`; non-kebab or duplicate ids → `CONFIG_INVALID`; no capability, gate or schema is restated here | R2 | the wiring and the work blur, so the graph cannot be validated before a run |
| Edge | the flow document | `data`, `join`, `refuse` | acyclic; sources precede targets; one consumption edge per node | R7 | composition beyond a chain is inexpressible (research F2, F6) |
| Definition pin | the store, `definition(instance, kind, id, digest, bytes)` | `pinned` (immutable) | one row per composed unit plus the flow; digest over canonical bytes; written with the instance row | R4, R5 | a flow edit silently changes a live instance |
| Publication | the store, `publication(task, version, digest)` | `published` (immutable) | one row per `id@version`, written at first pin, never rewritten; it holds the digest of the published bytes and no bytes — the pins hold bytes, it holds a digest; only it can prove that a version was ever published, and therefore refuse a rewrite once no live pin remains; while a live pin exists, that pin independently holds the bytes and proves their digest | R3 | a rewritten version is undetectable after first use |
| Instance | `instance` row (`src/store/db.ts:24`) | `running`, `completed`, `failed` | the flow digest lives in its `definition` row, not on the instance (`config_digest` retired); `current_step` names a node; terminal states never leave | R8 | no durable position to resume from |
| Artifact | `artifact` row (`src/store/db.ts:44`) | `pending`, `accepted` (`src/types/schema.ts:169`) | an accepted version is never rewritten; `derived_from` names the consumed digest (`src/types/schema.ts:180`) | R6 | a review has no bytes to bind to |
| Review subject | the review artifact's `subject` field | present and current, or stale | equals the digest of the judged artifact; checked by the gate before acceptance; a mismatch at `src/runner/engine.ts:595` is `SUBJECT_STALE` for `bindsSubject` nodes and `ARTIFACT_INVALID` otherwise | R6 | a review could judge anything and still pass |

Instance state machine (writers named; the current table is `src/store/instance.ts:44-49` and
declares `blocked`, which this model removes):

| From | Event | To | Writer |
| --- | --- | --- | --- |
| `running` | last node's artifact accepted | `completed` | `advance` (`src/runner/engine.ts:406-412`) |
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

- whether the owner wants one review over several artifacts — the model refuses that shape today (R7: `CONFIG_INVALID`), and widening it later is a new requirement, not an open door;
- whether tasks belong in `.pi/praxis/tasks/` rather than beside the flow files — the runtime resolves a directory, so the location is not a fact it depends on;
- how the two committed flow files and the `blocked` transition test migrate — plan work, deliberately not specified here.

amended 2026-10-29 — R8 names `src/types/schema.ts:143` and `src/store/instance.ts:44-49` as removal sites, and the oracle gains an enum-level negative load — C1: the removal sites and the schema negative were unnamed
amended 2026-10-29 — R3 gains `TASK_VERSION_CONFLICT` and an oracle for a rewritten `id@version` — C2: the in-place-rewrite clause had no code and no check
amended 2026-10-29 — R2 names the two-key node shape and gains `NODE_INVALID`; the Model gains a Node row — C3: node shape and extra-key refusal were undefined
amended 2026-10-29 — R6 gives `SUBJECT_MISSING` the same pending/refuse behaviour as a stale subject, with an oracle case — C4: the missing-subject path had no behaviour and no test
amended 2026-10-29 — R7 forbids a `bindsSubject` node over a `join` with `CONFIG_INVALID`, and the Open-questions bullet names that code — C5: R6/R7 and the Alternatives row disagreed about review over a join
amended 2026-10-29 — the flow digest has one owner, its `definition` row; `config_digest` is retired from R4, R5 and the Instance row — C6: two owners for one fact
amended 2026-10-29 — R6 binds `subject` to the artifact row's `derived_from`, with `derived_from` itself checked against the judged digest — C7: the spec did not say which of the two wins
amended 2026-10-29 — the Task version row's Valid states cell now reads "none — an identity, not a state" — C8: a property had been written in a state column
amended 2026-10-29 — the completed transition cites `src/runner/engine.ts:406-412` — C9: the cited line stopped at `setStatus`
amended 2026-10-29 — R7 adds the zero-consumption node to its refusals and the oracle now lists six negatives — C10: a node with no incoming consumption was unlisted
amended 2026-10-29 — R8 records that `tests/store/store.test.ts:109-111` asserts `blocked` and must be edited as plan work — C11: the affected test was unnamed
amended 2026-10-29 — R6 now assigns `SUBJECT_STALE` to a payload `derivedFrom` that differs from the currently accepted digest, the path its oracle exercises — W1: the code sat on the wrong condition
amended 2026-10-29 — R8 maps a stored `blocked` row to `STORE_INVALID` through `InstanceRowSchema` at `src/store/instance.ts:78` and reserves `INSTANCE_STATE_INVALID` for transitions at `src/runner/engine.ts:319-324` — W2: the load path does not map to `INSTANCE_STATE_INVALID`
amended 2026-10-29 — R3 publication is durable through a `publication(task, version, digest)` row written at first pin, and the pre-first-pin window is stated as unobservable — W3: immutability had no durable record
amended 2026-10-29 — the eight new codes are declared and `src/types/errors.ts` (:15-32) is named as the union they extend, with unit D scope — W4: the spec used codes the closed union does not contain
amended 2026-10-29 — the Node row's invariants name `CONFIG_INVALID` and `NODE_INVALID` — A1: invariants without codes
amended 2026-10-29 — R6 names the compared fields (payload `derivedFrom` against artifact-row `derived_from`) and orders the pair check before `src/runner/engine.ts:595` — A2: the compared field and the order were unstated
amended 2026-10-29 — R5 names the `config_digest` retirement sites as plan work — A3: the sites were unnamed
amended 2026-10-29 — R5 lists all 27 `config_digest`/`configDigest` sites from `grep -rn`, and states that `src/pi/tool.ts:264` is a semantic re-point at the pinned flow definition row — U1 (M7): the retirement list was incomplete and the tool site was misread as a compile fix
amended 2026-10-29 — the Publication row no longer claims to hold the published bytes; it holds a digest, the pins hold bytes, and only it can prove a version was ever published — U2 (M9): the row overstated what it stores
amended 2026-10-29 — R2 requires node ids to match `StepIdSchema` (`src/types/schema.ts:15`) and be unique per flow, with `CONFIG_INVALID` and two oracle cases; the Node row cites the same schema — U3 (F3): the Node clause had no requirement or oracle
amended 2026-10-29 — R8 cites the transition guard at `src/store/instance.ts:156-162` and names every other `INSTANCE_STATE_INVALID` emitter (`engine.ts:319-324`, `instance.ts:115,117,141,142`, `cli.ts:116`) — U4 (F4): R8 cited the advance-time check, not the guard that refuses the transition
amended 2026-10-29 — the failure-code section names the `CODES` mirror at `src/types/pi.ts:106-124` as plan work beside `src/types/errors.ts` — U5: the mirror was unnamed
amended 2026-10-29 — a node's task reference is `id@version` in R2, R3 and R4; a bare id is `CONFIG_INVALID`; the `research-v9` oracle became a malformed-reference case, and a two-version oracle proves neither published version is reachable without its version — P1: an id-only reference had no resolution rule
amended 2026-10-29 — R1 fixes the task `id` format to `StepIdSchema` (`src/types/schema.ts:15`), states `version` is an integer ≥ 1, and derives the library path from the id, with a `Research` oracle case — P2: the id format and path were unstated
amended 2026-10-29 — the Publication row scopes 'only it can prove' to the no-live-pin case and says that a live pin independently proves the bytes' digest — P3: the claim was unscoped
amended 2026-10-29 — `src/runner/engine.ts:595` is retained and its mismatch reclassified: `SUBJECT_STALE` for `bindsSubject` nodes, `ARTIFACT_INVALID` otherwise; R6 and the Review subject row agree — P4: retention versus replacement was unstated
