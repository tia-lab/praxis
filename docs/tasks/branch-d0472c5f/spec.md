# Spec — flow Unit 1: BRANCH (the typed one-of-N router)

Task: branch · Hash: d0472c5f · Gate: G2 · Status: draft (awaiting review) · Date: 2026-11-01

Basis: `docs/tasks/branch-d0472c5f/research.md` (F1-F21, E1-E6) and the lead brief `docs/FLOWS.md`
§5.1 (`:187`), §10 (`:396-400`), §12 (`:426-441`). Design only: nothing here authorizes a `src/` edit.

## Outcome

A flow may declare that one node's accepted artifact decides which of **two to eight** successors runs
next. The decision is one typed jev `choice`, computed **outside** any store window, validated and
recorded by the synchronous engine as **one** `branch.decided` event, and then followed by ordinary
routing to the single labeled successor. Only that branch's arm runs; the other arms never start. A
replay reuses the recorded label and never asks jev again. A flow with no branch is unaffected in bytes
and behaviour. The boundary: no wait, no trigger, no nesting, no agent-chosen routes, no change to the
quality gate, the bars, the scorer, the recall ranker or the store schema.

## Decisions (the three §12 questions plus the runtime split)

- **D1 — branch shape (Q1).** `decide` is a **node attribute** on a task node, and a **label** lives on
  each outgoing `branch` edge. The node owns *what each option means* (`decide.criteria`); the edges own
  *where each option goes* (`to`). A load-time bijection ties them: the criteria keys must be exactly the
  branch labels leaving that node. Rejected: a decider-carrying edge kind (the same decider would be
  duplicated across N edges, or split into a "decider edge" plus N targets, giving two owners).
- **D2 — merge (Q2).** **Exclusive-merge, derived, no marker.** Every node has at most **one** consumption
  slot, where N branch edges from **one** source count as one slot (see R4). Rejected: `arms-must-terminate`
  (it would forbid the reconvergence that makes a branch useful) and an explicit `merge` marker (a second
  owner of a fact the edges already carry — E6).
- **D3 — artifact (Q3).** A deciding node **is** a task node and emits its normal artifact; the decision
  itself is **an event, never an artifact**. There is no separate "branch node" and no router task.
  Rejected: a router node with its own task (it needs a rubric and a gate, and would let the agent author
  its own route — E5, `operations.ts:78`).
- **D4 — where the router runs.** **Outside** the engine, then passed in — the shipped
  `qualityVerdict` seam (`evaluate.ts:326-376`, `engine/types.ts:149-150`), because `advance` is
  synchronous with 36 call sites (F7) and no jev call may sit inside the store window (F8).

## Requirements

| Id | Requirement | Failure behaviour | Oracle |
| --- | --- | --- | --- |
| R1 | `EdgeKindSchema` gains `"branch"`; `EdgeSchema` gains an optional `label` (lower-case kebab, 1-64). `label` is present **iff** `kind === "branch"`. | `CONFIG_INVALID` from `parseFlowConfig` (`schema.ts:590`) with the edge path | a labelled 2-arm branch flow loads; a `data` edge with `label`, a `branch` edge without one, and a non-kebab label each fail with `CONFIG_INVALID` |
| R2 | `NodeSchema` gains optional `decide: {instructions (1-500), criteria (2-8 label -> meaning)}` and `NODE_KEYS` (`schema.ts:568`) gains `decide`. A node with `decide` emits **2-8 `branch` edges and no `data`/`join` edges**, and its branch labels equal its criteria keys exactly. A node without `decide` emits no `branch` edge. `refuse` out-edges are unaffected (still at most one). | `CONFIG_INVALID`; an unknown 4th key stays `NODE_INVALID` (`:587`) | 3-arm node loads; decide + 1 arm, a label with no criteria key (and the reverse), decide + a `data` out-edge each fail; decide + `refuse` loads; a fifth node key yields `NODE_INVALID` |
| R3 | **The one relaxed rule.** Distinct `data` targets per source stays 1 and distinct join groups stays 1 (messages unchanged, `schema.ts:418,423`); `branch` out-edges are exempt from both counts and are governed by R2 instead. | `CONFIG_INVALID` with today's fan-out text | two `data` targets are still refused; 2 and 8 branch arms load; a 9th arm (or 9 criteria) is refused |
| R4 | **Merge = one slot.** For every node Z: `slots(Z) = (incoming data edges) + (join groups into Z) + (distinct sources of incoming branch edges)`. Non-first nodes require exactly 1, the first node exactly 0. Two branch edges into Z **from one source** count once. A branch edge never joins a join group. | `CONFIG_INVALID`; the existing "more than one consumption edge into Z" text is kept for the above-1 case (`schema.ts:454`) | 3 arms reconverging on one node load; two branch sources into one node, a branch edge beside a `data` edge, and a branch edge from each of two deciding nodes all fail |
| R5 | **Subject rule follows the slot.** `validateFlow` (`flow.ts:154-181`) accepts exactly one incoming source for a `bindsSubject` node, and that source may be a `data` **or** `branch` edge; a `join` into a subject-binding node stays refused. | `CONFIG_INVALID` (existing text kept for the join case) | a review node consuming one branch arm loads; a review consuming two arms fails; today's data case is unchanged |
| R6 | **Active sources at runtime.** When the current node has at least one incoming `branch` edge, `advance` keeps only those incoming sources that have an **accepted artifact in this instance** (one read, hoisted above `runStep`, F19); exactly one must remain. A node with **no** incoming `branch` edge keeps today's static expression, so a missing accepted source still raises `ARTIFACT_UNAVAILABLE` (`step.ts:124`). | `ROUTE_INVALID` when zero remain (branch case only) | reconvergence hands off exactly the fired arm's digest; the unfired arms are never read; a branch-free flow with a deleted accepted source still fails `ARTIFACT_UNAVAILABLE` |
| R7 | **Label-aware successor.** `successorOf(config, nodeId, label?)`: for a node with `decide`, the label is required and the successor is the `to` of that labeled branch edge; missing or unmatched label is `ROUTE_INVALID`; a deciding node never returns `undefined` and so can never complete the instance. Nodes without `decide` behave exactly as today, including the `CONFIG_INVALID` ambiguity refusal (`step.ts:91`). | `ROUTE_INVALID` (new) / unchanged codes otherwise | label "b" routes to B; an unknown label is `ROUTE_INVALID`; a deciding node with no label leaves the instance `running` at that node with no `instance.completed` event |
| R8 | **The route input.** `AdvanceOptions` gains `route?: {label, router, model?, reason?, digest}`. In `advance`: (i) `decide` node with neither a supplied nor a recorded decision -> `ROUTE_UNAVAILABLE`; (ii) `label` not among the node's branch labels -> `ROUTE_INVALID`; (iii) `digest` different from the artifact being recorded -> `ROUTE_INVALID`; (iv) a route supplied to a node without `decide` -> `ROUTE_INVALID`. Cases (i)-(iv) are decided **before any write**. | the two codes, zero writes | each of (i)-(iv) leaves `select count(*) from event`, `artifact` row count and `instance.revision` unchanged; the valid case advances |
| R9 | **The decider module.** New `src/quality/jev-branch.ts`: `RouteRouter` (injected port), `jevRouteRouter(opts)` (one `choice` question built by the **shared** builder extracted from `jev-scorer.ts:118-125`, criteria = `decide.criteria`, the artifact and its digest in `state`), a strict label reader, and `routeOf`: any throw or timeout -> `ROUTE_UNAVAILABLE`; an answer that is not a declared label -> `ROUTE_INVALID`. The aligner's fail-open tail (`jev-align.ts:175-192`) is **not** copied. | typed, fail-closed, no guessed edge | fake router with a valid label proceeds; a throwing fake yields `ROUTE_UNAVAILABLE` and no write; a fake returning an undeclared label yields `ROUTE_INVALID` and no write; a captured request carries exactly one `choice` question whose criteria equal the node's |
| R10 | **One durable record.** `EVENT.branchDecided = "branch.decided"`, appended **after** acceptance and **before** the step moves: `{step, version, artifactDigest, label, router, model?, reason?, at}`. At most one per (instance, step, artifactDigest). | none (absence on a routed deciding step is a defect the invariant test catches) | after one accepted branch step exactly one `branch.decided` exists with that payload; a second advance appends zero |
| R11 | **Deterministic replay.** When a `branch.decided` already exists for (instance, step, artifactDigest), advance routes on the **recorded** label, ignores any supplied route, appends no event, and the seam does not call the router. A supplied route contradicting the record is `ROUTE_INVALID`. | `ROUTE_INVALID` on contradiction | a counting fake router sees **zero** extra calls across a replay, the successor is unchanged, and the event count is unchanged; a contradicting route is refused; new bytes produce a new decision |
| R12 | **Branch-free flows are byte-identical.** No branch and no `decide` means the same codes, events, envelopes and digests as today; the five shipped documents keep their recorded digests (research F14). | any behavioural drift is a blocking defect | the existing suite is green unchanged; the five SHA-256 digests match; `git diff` over `src/store/` is empty |
| R13 | **Codes and mirror.** `ROUTE_UNAVAILABLE`, `ROUTE_INVALID` added to `Code` (`errors.ts:21-57`), the `pi.ts` mirror (`:422-457`) and `TAXONOMY_SIZE` 34 -> 36. | a compile error from `satisfies readonly Code[]` (`pi.ts:457`) on drift | `tsc` is clean; `tests/types/errors.test.ts` passes with 36 |
| R14 | **No new state, no new storage.** `InstanceStatusSchema` unchanged, no table, no column, no DDL, no store-schema bump; the decision is an event only. | a schema change is out of contract | `git diff src/store/` is empty; a store created before the change still opens |
| R15 | **Documented CLI boundary.** `cli.ts:108,135` supplies no route and no verdict (F17), so a branch flow advanced through the CLI refuses `ROUTE_UNAVAILABLE`. This is recorded, not fixed: the CLI already cannot run a quality-gated submit. | `ROUTE_UNAVAILABLE` | an executed CLI advance on a deciding node yields `ROUTE_UNAVAILABLE` and leaves the instance running at that node |
| R16 | **Scope of this unit.** Only `docs/tasks/branch-d0472c5f/` is written. Every `src/`, `tests/` and `.pi/` path in this spec is **named** for the later, separately authorized build. | a write outside the folder voids the unit | `git status --porcelain docs/tasks/branch-d0472c5f` lists exactly its three documents, and no other path changes because of this unit (`docs/FLOWS.md` was already modified by another writer before this unit started and is left untouched) |

## Model

The smallest sufficient model. One owner per fact; absence has a named failure.

| Element | Owner | Valid states | Invariants | Requirement | Failure if absent |
| --- | --- | --- | --- | --- | --- |
| `decide` block | the **node** (`NodeSchema`), authored as JSON | absent, present | 2-8 criteria; labels bijective with the node's branch edges; no `data`/`join` out-edges; `refuse` still at most one | R2 | a node with branch edges and no `decide` is `CONFIG_INVALID` — nothing can name a route |
| branch `label` | the **edge** (`EdgeSchema`) | one kebab token per branch edge | present iff kind is `branch`; unique among one source's branch edges (bijection with criteria) | R1, R2 | `CONFIG_INVALID` at load; a route could not be named |
| consumption slot | the **superRefine** (derived, no storage) | 0 (first node) or 1 | `data` + join-group + distinct-branch-source counts sum to the slot count; branch edges from one source are one slot | R4 | `CONFIG_INVALID`: a reconvergence would silently multiply consumptions |
| active source set | the **store**, derived from `artifact.accepted` events (no second copy) | exactly one for a non-join node | only the arm that actually fired is a source; a non-branch node keeps the static rule | R6 | `ROUTE_INVALID` (branch) / `ARTIFACT_UNAVAILABLE` (unchanged, non-branch) |
| route decision | the **`branch.decided` event** — the sole record | absent, recorded | one per (instance, step, artifactDigest), append-only, never rewritten; the recorded label beats any caller input | R10, R11 | `ROUTE_UNAVAILABLE` on a deciding node with no decision — never a guess, never `undefined` (which would complete the instance) |
| router port | `src/quality/jev-branch.ts` | available, unavailable, invalid | one jev `choice` question; the answer is read strictly; every failure is typed and refuses | R9 | `ROUTE_UNAVAILABLE` / `ROUTE_INVALID`; no write happens |
| successor | `successorOf` (`step.ts`) | one node, or `undefined` for a non-deciding last node | a deciding node always resolves to exactly one target; a no-`decide` node keeps today's rule | R7 | `ROUTE_INVALID`; the instance stays `running` at the deciding node |

**Data flow (one line).** accepted artifact -> digest -> router (outside the store) -> validated route ->
one `branch.decided` event -> `successorOf(..., label)` -> `setStatus(currentStep = target)`.

## Exclusions

- **Wait, trigger, human node, nesting** (`docs/FLOWS.md` §5.2-5.5): separate units, each with its own
  gates (#4/#6/#7/#8) and its own owner GO. Branch must not pre-build them.
- **A branch arm that reconverges into a `join`**: the slot rule cannot decide whether a join is one
  consumption or several. Refused at load rather than left ambiguous (Q4 of the research).
- **More than 8 arms**: the shared `choice` shape allows 2-8 options (`quality.ts:79-81`); a wider
  router would be a different decider, not this one.
- **Agent-chosen routes**: the route is never a tool argument. The agent authors the artifact; the
  router classifies; the engine records. A tool-level route argument would let a caller pick its own
  successor (`operations.ts:78` forbids the same for gates).
- **CLI routing** (R15): recorded, not built.
- **A `merge` marker, a route table, a persisted decision column**: the event is the record (F15).
- **Any change to the quality gate, bars, scorer, recall ranker, store schema, flow documents or
  `src/` in this unit.** The shipped flows stay byte-identical (F14).

## Alternatives

| Alternative | Rejected because |
| --- | --- |
| Decider carried by the edge kind (`EdgeSchema` becomes a union) | The same decider would be duplicated across N mutually exclusive edges, or split into a "decider edge" plus N targets: two owners for one decision, and every edge consumer (`successorOf`, the join/fan-out counts, `currentHandoffs`) would have to branch on shape |
| A separate router node with its own task and artifact | Needs a task, a rubric and a gate (F13/R2), so the agent would author the route; it also puts a second owner on "which arm ran" (an artifact row and an event) |
| Make `advance` async and call jev inside | 36 call sites (3 src, 33 test) churn, and a network call inside the store window violates the durability discipline the quality seam already respects (F7/F8) |
| Explicit `merge` marker on reconvergence | A second owner for exclusivity that the edges already express; more surface, no new fact |
| `arms-must-terminate` (no reconvergence) | Makes a 3-way triage unusable: each arm would have to duplicate the rest of the flow |
| Record the decision as an artifact row | Needs a task, a schema and a gate; an artifact is *work*, a decision is *routing* — and the event log already holds derived facts (F15) |
| Fail open like the alignment gate | A branch that guesses an arm runs the wrong work silently; the brief requires fail-closed (`docs/FLOWS.md:206-216`), and a missing route is recoverable by a retry while a wrong arm is not |

## Open questions

- **OQ1 — CLI parity (R15).** Whether the CLI should gain a router is the lead's call, not this spec's.
  Until then the boundary is documented and asserted.
- **OQ2 — a deciding node that also binds a subject.** The rules allow it (one source slot, one route).
  No oracle is specified for it because no plausible flow uses it yet; if one appears, it is a new
  oracle, not a new rule.
