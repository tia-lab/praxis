# Research — flow Unit 1: BRANCH (the typed one-of-N router)

Task: branch · Hash: d0472c5f · Gate: G1 · Status: draft · Date: 2026-11-01

## 0. Contract

<!-- One physical line per key: this block is the hash input. Never reflow it. -->

task: Design flow Unit 1 (BRANCH), the typed one-of-N routing primitive: architecture + G2 spec + G3 plan only. The decider reuses the existing jev choice builder behind an injected port and fails closed; flows keep routing, never reasoning.
scope: docs/tasks/branch-<hash8>/ (design only; no src/, tests/, .pi/ or dependency change)
acceptance: research.md, spec.md and plan.md in the docs/templates shapes with the contract verbatim in section 0 and the computed hash8; the spec fixes the schema delta in prose (branch edge kind, node decide block, edge label, the single relaxed fan-out rule, the merge rule the superRefine must apply), defines src/quality/jev-branch.ts, adds ROUTE_UNAVAILABLE and ROUTE_INVALID with the drift-checked pi.ts mirror, records one durable branch.decided event with deterministic replay, leaves non-branch flows byte-identical, and decides all three FLOWS.md section 12 branch questions; the plan orders implementation items each naming its file, requirement id and a runnable check; every cited path:line is grep-verified; no file outside the folder is touched.

Recompute:

```sh
canonical() { printf 'task: %s\nscope: %s\nacceptance: %s\n' "$1" "$2" "$3" \
  | sed -E 's/[[:space:]]+$//'; }
canonical "<goal>" "<paths>" "<checks>" | sha256sum | cut -c1-8
```

**Hash check — executed 2026-11-01, before this folder existed** (`executed`):

```text
$ canonical "$T" "$S" "$A" > /tmp/branch-contract.txt
$ wc -l -c /tmp/branch-contract.txt
   3 1096 /tmp/branch-contract.txt
$ sha256sum /tmp/branch-contract.txt | cut -c1-8
d0472c5f
d0472c5f          # repeat-run identical
```

The scope line carries the folder **pattern** `docs/tasks/branch-<hash8>/` with the placeholder
literal, so the pre-image does not depend on its own result and the folder name is derived from the
hash. This deliberately avoids the defect recorded at
`docs/tasks/flow-selection-d6b6218d/research.md:8-12`, where the folder name carried one hash and the
block hashed to another. No line of §0 was reflowed.

## 1. Question and boundary

**In scope.** What exactly must change, and in which order, for a flow to choose **one of N**
successors by a typed decision: the schema delta, the merge rule, the decider, the durable record,
the replay rule, and the oracles that prove each.

**Out of scope (not researched, not designed here).** Wait/trigger (FLOWS.md §5.2-5.3), nesting
(§5.5), the human node (§5.4), branch arms that converge into a `join`, cross-flow routing, and any
change to the quality gate, the bars, the scorer or the recall ranker. Gates #1 (isolation), #3
(trusted identity), #4/#8 (nesting) are untouched by this unit; the brief states the same at
`docs/FLOWS.md:443-459`.

**Authority.** The lead design brief `docs/FLOWS.md` (467 lines, read in full) specifies the unit in
§5.1 (`:187`), the manifest in §10 (`:396-400`) and the open questions in §12 (`:426-441`). It is a
brief, not an authorization: `docs/FLOWS.md:1-13` and the `AGENTS.md` ledger both require an owner GO
before any `src/` change. This document is design only.

## 2. Sources inspected

| Source | Location | Establishes | Freshness |
| --- | --- | --- | --- |
| design brief | `docs/FLOWS.md:187-232` | the unit's shape, schema delta, decider, codes, acceptance sketch | current |
| design brief | `docs/FLOWS.md:396-400` | the consolidated manifest row for Branch | current |
| design brief | `docs/FLOWS.md:426-441` | the three branch open questions | current |
| node/edge schema | `src/types/schema.ts:306-320` | `NodeSchema` is a strict 3-key object; `EdgeKindSchema` has 3 values; `EdgeSchema` is strict | current |
| flow schema + rules | `src/types/schema.ts:341-455` | one `superRefine` owns ordering, fan-out, join and consumption | current |
| node key allow-list | `src/types/schema.ts:566-590` | `NODE_KEYS` refuses any 4th node key as `NODE_INVALID` | current |
| status enum | `src/types/schema.ts:477` | three instance states; branch needs none of them changed | current |
| routing | `src/runner/step.ts:83-97` | `successorOf` reads only `data`/`join`, refuses ambiguity with `CONFIG_INVALID` at `:91` | current |
| handoffs | `src/runner/step.ts:118-155` | a handoff requires an **accepted** artifact or throws `ARTIFACT_UNAVAILABLE` (`:124`) | current |
| advance | `src/runner/engine/advance.ts:87-92,131,293` | sources are static from config; the step runs at `:131`; the successor move is `:293` | current |
| flow load/validate | `src/runner/engine/flow.ts:115-183` | `openFlow` -> `parseFlowConfig` (`:131`) -> `validateFlow` (`:154`) | current |
| subject rule | `src/runner/engine/flow.ts:166-181` | a `bindsSubject` node must take exactly one source **and one `data` edge** (`:174`) | current |
| display handoffs | `src/runner/engine/flow.ts:206-219` | already filters sources by accepted refs for the result view | current |
| choice builder | `src/quality/jev-scorer.ts:118-125` | `questionOf` maps a probe to a jev question; the choice literal is `:119-121`; the function is **private** | current |
| aligner (port template) | `src/quality/jev-align.ts:51,60,75,98,175` | injected port, fixed stance, strict `choiceOf`, `judgeOrder` maps every throw to `unavailable` (fail-open) | current |
| two-phase seam | `src/quality/evaluate.ts:326-376` | jev runs after the store is closed (`:330,346-348,365`), then the sync `advance` is called (`:372`) | current |
| choice cardinality | `src/types/quality.ts:79-81` | a `choice` offers 2-8 named options | current |
| taxonomy | `src/types/errors.ts:21-57`, `src/types/pi.ts:422-457`, `tests/types/errors.test.ts:44` | 34 codes; the mirror is compile-checked; `TAXONOMY_SIZE = 34` | current |
| engine options/events | `src/runner/engine/types.ts:9-30,145-151` | one `EVENT` map; `AdvanceOptions` already carries a pre-computed `qualityVerdict` | current |
| tool seam | `src/pi/operations.ts:246,340` | the submit path injects the scorer and awaits `advanceEvaluated` | current |
| cli callers | `src/cli.ts:108,135` | the CLI calls the sync `advance` with no verdict and no scorer | current |
| test fixtures | `tests/testkit.ts:50-54,107-115` | `EdgeFixture.kind` is a 3-value union; `writeFlow` takes an edge list | current |
| shipped flows | `.pi/praxis/flows/engineering/*.json` | no `branch` edge and no `decide` block exists today (grep: zero hits) | current |

## 3. Competing explanations

| Explanation | Supporting evidence | Distinguishing observation | Status |
| --- | --- | --- | --- |
| E1 Branch needs a new edge kind plus a relaxed fan-out rule | `docs/FLOWS.md:187-206`; `src/types/schema.ts:315` (3 kinds), `:416-424` (fan-out refused) | No composition of the three existing kinds yields exactly one active successor | **leading** |
| E2 One-of-N is already expressible with `data`/`join`/`refuse` | the algebra at `docs/FLOWS.md:76-112` | `data` fan-out above 1 is refused (`schema.ts:416-419`), a `join` needs 2+ distinct sources (`:427-430`), a `refuse` must run backwards (`:385-390`), and every composition either runs all arms or none | **eliminated** |
| E3 The router call belongs inside `advance` (engine becomes async) | `docs/FLOWS.md:212-214` says "`advance.ts` calls the router" | `advance` is synchronous, with 3 src call sites (`cli.ts:108,135`, `operations.ts:340`) and 33 test call sites in 5 files; the shipped jev seam deliberately computes outside the store window (`evaluate.ts:330-372`) | **eliminated** |
| E4 The route is computed outside the engine and validated, recorded and followed by the sync engine | the `qualityVerdict` precedent (`engine/types.ts:149-150`, `evaluate.ts:372`) | Same seam, no signature change, zero test-call-site churn, and a router failure becomes write-free | **leading** |
| E5 A branch is a separate node running a classifier task that emits the decision | the node/task split (`docs/FLOWS.md:52-74`) | A node must name a task (`schema.ts:306-311`), so a router node would need a task, a rubric and a gate; the agent would then author its own route, which `operations.ts:78` forbids for gates | **eliminated** |
| E6 Merge needs an explicit `merge` marker | `docs/FLOWS.md:210-214` offers "compute it from the branch structure, or require an explicit `merge` marker" | Exclusivity is derived already: only a deciding node can fan out more than once, so two branch edges share a source exactly when they are one exclusive group. A marker would be a second owner of a fact the edges carry | **leading** (exclusive-merge, no marker) |

## 4. Findings

- **F1 [source-inspected]** `EdgeKindSchema` is a closed 3-value enum (`src/types/schema.ts:315`) and
  `EdgeSchema` is a strict object of exactly `{kind, from, to}` (`:318`), so an edge cannot carry a
  label today and a `branch` edge is a parse error. — Limitation: none; parsing is the first thing every
  instance does (`flow.ts:131`).
- **F2 [source-inspected]** Fan-out is an **active refusal**, not an absence: the loops at
  `src/types/schema.ts:416-424` refuse a source that feeds more than one distinct `data` target or more
  than one `join` group, so a 3-way branch cannot load today. This is the rule the unit relaxes.
- **F3 [source-inspected]** The consumption invariant is a **second, later** rule over the same maps:
  `src/types/schema.ts:441-455` counts incoming `data` edges plus one join group per node and refuses
  above 1 at `:454` (and 0 at `:452`). A branch design must change this count, not only the fan-out
  check: a reconvergence node sees N incoming edges of which **one** is active.
- **F4 [source-inspected]** A **second, narrower** consumption check sits outside the schema:
  `src/runner/engine/flow.ts:154-181` requires a `bindsSubject` node to have exactly one incoming source
  **and exactly one `data` edge** (`:174`). A review node fed by a `branch` edge is refused there even
  after F3 is relaxed. The brief's manifest (`docs/FLOWS.md:400`) does not name this site.
- **F5 [source-inspected]** Routing is `successorOf` (`src/runner/step.ts:83-97`): it filters only
  `data`/`join`, refuses an ambiguous set as `CONFIG_INVALID` (`:91`), and returns the earliest target
  by node index. A `branch` edge is invisible to it, so a deciding node's successor is `undefined` and
  `advance` takes the no-successor path at `src/runner/engine/advance.ts:293-299`, which **completes the
  instance early**. Branch therefore cannot be approximated by adding edges alone.
- **F6 [source-inspected]** `advance` derives `sources` **statically** from the config
  (`advance.ts:87-91`), and `buildHandoffs` requires an accepted artifact per source
  (`step.ts:118-155`; `ARTIFACT_UNAVAILABLE` at `:124`). At a reconvergence node the static list names
  arms that never ran, so the refusal would fire **after** the deciding node already accepted. The
  shipped `currentHandoffs` (`flow.ts:206-219`) already does the needed filtering for the result view;
  the runtime path does not use it.
- **F7 [source-inspected]** `advance` is synchronous: 3 call sites in `src/` (`cli.ts:108`,
  `cli.ts:135`, `operations.ts:340`) and 33 call sites across 5 test files (`grep -rn "advance(" tests |
  wc -l` gives 33; `grep -rln` gives 5). Making it async is a contract change with a large test blast
  radius; keeping it sync means the decision must arrive as data.
- **F8 [source-inspected]** The shipped pattern for a jev decision is **compute-outside, pass-in**:
  `advanceEvaluated` (`src/quality/evaluate.ts:326-376`) reads through `inspect` (`:330`), closes the
  store, awaits the scorer (`:365`), then calls the synchronous `advance` with the verdict (`:372`).
  `AdvanceOptions.qualityVerdict` (`engine/types.ts:149-150`) is the precedent for the route input.
- **F9 [source-inspected]** `questionOf` is **private** (`src/quality/jev-scorer.ts:118`; no `export`).
  The choice literal it builds is `{ type: "choice", instructions, criteria }` (`:119-121`). Reuse
  therefore needs one small extraction plus export, not a copy: a copy would be a second owner of the
  request shape. The brief's "reuses the existing question-builder" (`docs/FLOWS.md:128-145`) is
  achievable but is not free.
- **F10 [source-inspected]** The `choice` cardinality bound already exists: 2-8 named options
  (`src/types/quality.ts:79-81`). The branch arm count inherits it instead of inventing a new bound.
- **F11 [source-inspected]** `jev-align.ts` is the port template: `AlignJudge` (`:51`), a fixed `STANCE`
  (`:60`), a strict `choiceOf` (`:75`), `jevAlignJudge` with an injected `evaluateFn` (`:98`), and
  `judgeOrder` (`:175`) which maps **any** throw to `unavailable` so the caller may proceed. A branch
  copies the port and the strict reader and **inverts the tail**: no route means no advance.
- **F12 [source-inspected]** The taxonomy holds **34** codes (`src/types/errors.ts:21-57`), the mirror is
  compile-checked by `as const satisfies readonly Code[]` (`src/types/pi.ts:457`), and
  `tests/types/errors.test.ts:44` asserts `TAXONOMY_SIZE = 34`. `docs/FLOWS.md:404` says "grows from
  37": that count is **stale** — the arithmetic for this unit is 34 -> 36.
- **F13 [source-inspected]** `NodeSchema` is strict with exactly `id`, `task`, `domains`
  (`schema.ts:306-311`), and a **second** allow-list `NODE_KEYS` (`schema.ts:566-568`) refuses any other
  key as `NODE_INVALID` before the schema runs (`:579-590`). A `decide` block must be added in **both**
  places or every deciding node is refused. `domains` is the precedent that this is an additive
  two-place change.
- **F14 [source-inspected]** No shipped flow can exercise branch: a grep for `branch` and `decide` over
  `.pi/praxis/flows/engineering/*.json` returns no match, so "byte-identical for branch-free flows" is
  checkable by digest of the five documents
  (`feature 0163fdf8...`, `bugfix ce95757c...`, `fix 9c877b0a...`, `refactor 26bde853...`,
  `.pi/praxis/config.json 1ba739d8...`).
- **F15 [source-inspected]** Durability needs no schema change: `EVENT` is one const map
  (`engine/types.ts:9-30`), events are appended with `appendEvent` and read with `listEvents`, and
  derived facts are already recomputed from the log this way (`flow.ts:210-219` rebuilds accepted refs;
  `support.ts:117-122` reads `instance.created` for the order). A `branch.decided` event has the shape
  of facts already present: no table, no column, no store-schema bump.
- **F16 [source-inspected]** `InstanceStatusSchema` has three states (`schema.ts:477`). Branch needs no
  fourth: when the route cannot be obtained the submit refuses **before** any write (F8's placement), so
  there is no half-advanced instance to park. The quality escalation must park only because its refusal
  happens after the artifact exists.
- **F17 [source-inspected]** The CLI wires **no** decider: `cli.ts:108,135` call `advance` with no verdict
  and no scorer, while `operations.ts:340` awaits `advanceEvaluated`. The CLI therefore already cannot
  run a quality-gated submit, and a branch flow on the CLI path will refuse `ROUTE_UNAVAILABLE` for the
  same reason. This asymmetry is pre-existing and is recorded as an accepted boundary, not fixed here.
- **F18 [source-inspected]** The testkit's `EdgeFixture.kind` is a hard-coded 3-value union
  (`tests/testkit.ts:50-54`), so branch tests need that union extended; `writeFlow` already accepts an
  arbitrary edge list (`:107-115`) and needs no structural change.
- **F19 [source-inspected]** `advance` reads accepted refs **after** `runStep` (`advance.ts:131` then
  `:133`). Moving that read earlier is safe: `runStep` writes artifact rows only, and the
  `artifact.accepted` event is appended later by `recordAcceptance`
  (`src/runner/engine/quality-loop.ts:282-305`), so the value is identical before and after the step.
  That is what lets the runtime pick **active** sources without a second store read.
- **F20 [source-inspected]** `successorOf` has exactly one caller (`advance.ts:293`: definition at
  `step.ts:83`, import at `advance.ts:12`), so making it label-aware is an additive parameter with no
  other churn.
- **F21 [proposed]** The `decide` block belongs on the node whose artifact is classified (the
  accept-and-route node), with labels on that node's outgoing edges: one owner for "what each option
  means" (the node) and one for "where each option goes" (the edges), the same split the flow already
  uses for `refuse` (edge) versus `onFailure` (task).

## 5. Affected owners and callers

| Path | Declaration | Callers | Effect |
| --- | --- | --- | --- |
| `src/types/schema.ts` | `NodeSchema` (`:306`), `EdgeKindSchema` (`:315`), `EdgeSchema` (`:318`), `FlowConfigSchema` (`:341`) with its `superRefine` (`:354`), `NODE_KEYS` (`:568`), `parseFlowConfig` (`:579`) | `flow.ts:131` (`openFlow`), `loadPinnedFlow` (`flow.ts:230`), `tests/testkit.ts`, `tests/runner/edges.test.ts` | gains `branch`, `label`, `decide`; fan-out and consumption gain the branch cases |
| `src/types/flow.ts` (new) | the flow-document types moved out of `schema.ts` | `schema.ts` re-exports (pattern at `schema.ts:140-150`) | keeps both files under the 600-line cap when the delta lands |
| `src/runner/step.ts` | `successorOf` (`:83`), `buildHandoffs` (`:118`) | `advance.ts:12,293` | the successor becomes label-aware; the handoff path is untouched |
| `src/runner/engine/advance.ts` | `advance` (`:46`), the `sources` computation (`:87`), the successor move (`:293`) | `cli.ts:108,135`; `operations.ts:340`; 33 test sites | active-source selection, route validation, one `branch.decided` event, routing on the label |
| `src/runner/engine/flow.ts` | `validateFlow` (`:154`), `currentHandoffs` (`:207`) | `openFlow` (`:115`), `advance` | the subject rule accepts one `branch` source; the display filter learns the new kind |
| `src/runner/engine/types.ts` | `EVENT` (`:9`), `AdvanceOptions` (`:145`) | `advance`, `cli.ts`, `operations.ts` | one event name, one optional `route` input |
| `src/runner/engine/support.ts` | the store-read helpers, `orderOf`/`orderFor` (`:117-125`) | `evaluate.ts:348` | the same pair for a recorded route, so the seam can skip the jev call |
| `src/quality/jev-scorer.ts` | `questionOf` (`:118`, private) | `evaluateArtifact` (`:277,281`) | the choice literal is extracted behind one exported builder |
| `src/quality/jev-branch.ts` (new) | `RouteRouter` port, `jevRouteRouter`, `routeOf` | the submit seam in `operations.ts` | one `choice` question, strict label read, fail-closed to the route codes |
| `src/quality/index.ts` | the quality barrel | `operations.ts:27` | re-exports the router |
| `src/types/errors.ts` | `Code` (`:21-57`) | every module | +2 codes, 34 -> 36 |
| `src/types/pi.ts` | `CODES` (`:422-457`), `FailureCodeSchema` (`:459`) | tool envelopes | +2 mirrored names, drift-checked |
| `src/pi/operations.ts` | `submitOperation`, `setScorerForTest` (`:246`) | `tool.ts:30` re-export | computes the route before `advanceEvaluated`; adds a fakeable setter |
| `tests/testkit.ts` | `EdgeFixture` (`:50-54`) | every runner test | the kind union gains `branch` (+ `label`) |

## 6. Uncertainty and open questions

- **Q1 — where the seam sits.** Two homes are defensible: extend `advanceEvaluated` (`evaluate.ts:326`)
  or add a sibling step in `operations.ts`. The spec must pick one and the plan must name the exact
  function; the deciding constraint is that the existing function already owns "compute outside, then
  advance", so a second entry point would create two owners of one sequencing rule.
- **Q2 — the artifact a decision is bound to.** The seam can only digest the payload it was given
  (`evaluate.ts:345` does exactly that). The spec must state that a route is recorded only when the
  artifact is accepted, and that its digest must equal the accepted artifact's digest.
- **Q3 — CLI parity.** F17: the CLI cannot supply a route. Whether that is accepted or fixed is a scope
  question for the lead. Recorded position: accepted, documented, not fixed here, because the CLI cannot
  run a scored submit either.
- **Q4 — a branch arm that reconverges into a `join`.** Not covered: the slot rule would need a
  join-aware branch group. The schema refuses the combination rather than leaving it ambiguous.
- **Q5 — `decide` on the first node.** The first node has no consumed artifact, so a decision there
  classifies its own artifact, which the uniform rule already expresses. An oracle should confirm that
  the first node may decide and that `nodes[0]` still cannot consume.
- **Q6 — what a replay must prove.** "jev is never re-called" needs an observable: a fake router that
  counts calls across a replay. That is a check-table item, not prose.
- **Q7 — untested.** Nothing here was executed beyond the greps, the digest computation and the hash
  check quoted above. No branch flow has ever loaded, because the schema refuses it today (F2).

## 7. Handoff

The spec must settle, in prose and with oracles:

1. the branch shape — node `decide` plus edge `label` (E1/F21), with the criteria-key to edge-label
   bijection as one load-time rule;
2. the merge rule (F3/E6) — one consumption **slot** per node, where N branch edges from **one** source
   count as one slot: an exact count the `superRefine` can compute, replacing the above-1 refusal at
   `schema.ts:454` and mirrored in `validateFlow` (F4);
3. whether a deciding node emits an artifact (it is a task node by construction; the **decision** is an
   event, never an artifact);
4. the runtime split — compute outside (F8), validate/record/route inside, one `branch.decided` event
   (F15), replay from the record with no jev call;
5. the two codes (F12) and the exact drift-checked arithmetic 34 -> 36;
6. the byte-identical guarantee for branch-free flows (F14), including the unchanged
   `ARTIFACT_UNAVAILABLE` behaviour on the non-branch source path (F6/F19).
