# Research — flow Unit 2: WAIT + TRIGGER (the durable park/resume primitive)

Task: wait-trigger · Hash: f330a0aa · Gate: G1 · Status: draft · Date: 2026-11-01

## 0. Contract

<!-- One physical line per key: this block is the hash input. Never reflow it. -->

task: Design flow Unit 2 (WAIT + TRIGGER): the durable park/resume primitive, the host seam that fires or resumes a flow, and the human node as a wait variant - architecture + G2 spec + G3 plan only.
scope: docs/tasks/wait-trigger-<hash8>/ (design only; no src/, tests/, .pi/ or dependency change)
acceptance: research.md, spec.md and plan.md in the docs/templates shapes with the contract verbatim in section 0 and the computed hash8, every path:line re-verified against the post-b04a04e tree; the spec decides the additive waiting status with its exact transition map, the park and resume as durable events with exact payloads and lazily evaluated timeouts, the engine resume entrypoint with its validation and its no-store-window-across-the-wait discipline, WAIT_TIMEOUT and WAIT_EVENT_INVALID with the drift-checked pi.ts mirror and the exact taxonomy arithmetic, the trigger as a host seam with a config-trust actor and the host-cron form in scope versus the gate-7 scheduler out, the human node as a wait variant, byte-identical behaviour for non-wait flows, and names the gate-6 retention and gate-7 off-process parts as not built in the first slice; the plan orders implementation items each naming its file, requirement id and a runnable check and separates the buildable slice from the gated parts; no file outside the folder is touched.

Recompute:

```sh
canonical() { printf 'task: %s\nscope: %s\nacceptance: %s\n' "$1" "$2" "$3" \
  | sed -E 's/[[:space:]]+$//'; }
canonical "<goal>" "<paths>" "<checks>" | sha256sum | cut -c1-8
```

**Hash check — executed 2026-11-01, before this folder existed** (`executed`):

```text
$ canonical "$T" "$S" "$A" > /tmp/wait-contract.txt
$ wc -l -c /tmp/wait-contract.txt
   3 1348 /tmp/wait-contract.txt
$ sha256sum /tmp/wait-contract.txt | cut -c1-8
f330a0aa
f330a0aa          # repeat-run identical
```

The scope line carries the folder **pattern** with the placeholder literal, so the pre-image does not
depend on its own result; the folder name is derived from the hash. No §0 line was reflowed.

## 1. Question and boundary

**In scope.** What must change, in which order, so an instance can **park** until an outside event
arrives and then **resume** at the same node, with a **host** seam that fires or resumes it, a **human**
node modelled as one of those waits, durable evidence for every transition, and no new table.

**Out of scope.** A Praxis-side scheduler (gate #7), retention or purging of long-lived parked instances
(gate #6), nesting (gate #4/#8), a Pi-tool `op=resume` (see F11), any isolation/identity/exactly-once
claim, and any change to the quality gate, the bars, the scorer, the recall ranker or the branch router.

**Authority.** The lead brief `docs/FLOWS.md` (467 lines, read in full): §5.2 (`:234`), §5.3 (`:259`),
§5.4 (`:275`), the manifest row (`:396-400`), the open questions (`:426-441`) and the gates (`:443-459`).
`docs/FLOWS.md:1-13` and the `AGENTS.md` ledger both require an owner GO before any `src/` change; this
unit is design only and stops at a reviewed spec plus plan.

**Tree note.** The branch unit landed at commit `b04a04e` and moved the flow-document types to
`src/types/flow.ts` while editing `advance.ts`, `flow.ts` and `step.ts`. Every line below was
re-verified with grep against that tree; the brief's own citations were re-checked and two are stale
(F1, F15).

## 2. Sources inspected

| Source | Location | Establishes | Freshness |
| --- | --- | --- | --- |
| design brief | `docs/FLOWS.md:234-257` | the wait primitive: no parked state today, park record, resume entrypoint, deterministic match, codes, four open questions | current |
| design brief | `docs/FLOWS.md:259-273` | the trigger as a host/Manifold seam, config-trust actor, gate #7 | current |
| design brief | `docs/FLOWS.md:275-280` | the human node folds into wait, identity from a binding | current |
| design brief | `docs/FLOWS.md:396-404` | the Wait+Trigger manifest row and the (stale) taxonomy claim | current |
| design brief | `docs/FLOWS.md:426-441,443-459` | the open questions and the gates this work crosses | current |
| status enum | `src/types/schema.ts:282` | `InstanceStatusSchema = z.enum(["running","completed","failed"])` | current (brief cites `:477`, stale — F1) |
| instance value | `src/types/schema.ts:290-305` | a strict instance value; `failedReason` is derived, never a column | current |
| result schema | `src/types/schema.ts:339-346` | `status` uses the status enum; `nextAction` is a free 1-1024 string | current |
| event type contract | `src/types/schema.ts:350-356` and `:51` | events are `(instance, seq, type, payload, at)`; `type` is a regex, not an enum | current |
| transition map | `src/store/instance.ts:42-46` | `Record<InstanceStatus, readonly InstanceStatus[]>`: running->completed/failed only | current |
| status writer | `src/store/instance.ts:163-190` | `setStatus` parses the target against the enum (`:165`), refuses an undeclared move (`:180`), stamps `new Date()` (`:187`) | current |
| advance guards | `src/runner/engine/advance.ts:54,60` | `completed` returns the result; every other non-running status is `INSTANCE_STATE_INVALID` | current |
| arrival sites | `advance.ts:242,343,381-388`, `start.ts:59-70` | the three places a node becomes current: the successor move, the two refuse moves, and `start` | current |
| durable-decision pattern | `advance.ts:363-380` | one event appended after acceptance and before the move, reused on replay | current |
| start | `start.ts:45-57,59-70,112-138` | a repeated request re-opens the same instance (`REQUEST_CONFLICT` on a different payload); the row starts `running`; `instance.created` carries the actor | current |
| idempotent id | `src/runner/engine/flow.ts:188-191` | `instanceIdFor` is a pure function of (flow, requestId) | current |
| derived failure | `src/runner/engine/quality-loop.ts:76-90,234-237` | `failedReason` is rebuilt from `instance.failed`; the failure payload carries `reason` | current |
| note gate | `src/runner/note-gate.ts:171-177,268-278` | a step with an accepted artifact and no note is pending; completion requires `running` | current |
| read path | `src/runner/engine/inspect.ts:19-33` | `inspect` builds the six-key result from the row plus derived facts | current |
| result builders | `src/runner/result.ts:38-52` | `nextActionFor` and `summaryFor`; every non-terminal status says "resume" | current |
| engine surface | `src/runner/engine/index.ts:1-24` | export-only barrel; `start`, `advance`, `inspect` are the entrypoints | current |
| authority | `src/runner/engine/authority.ts:36-40` | `assertObserver`: creator or an assigned actor | current |
| store transaction | `src/store/db.ts:103-120`, `src/store/events.ts:33-58` | `transact` is explicit; `appendEvent` owns its own transaction; `listEvents` reads in seq order | current |
| choice precedent | `src/quality/jev-branch.ts` (141 lines) | the branch router is a *jev* port; a wait match must not be one (F10) | current |
| tool surface size | `src/pi/operations.ts` (589 lines), `src/cli.ts:112-137` | no room for a new tool op; the CLI is the minimal host surface | current |
| taxonomy | `src/types/errors.ts:21-60`, `tests/types/errors.test.ts:46` | 36 codes, `TAXONOMY_SIZE = 36` | current (brief says 37 — F15) |
| shipped data | `.pi/praxis/flows/**`, `.pi/praxis/tasks/**` | no `wait`, `timeout` or `trigger` declaration exists (grep: no match) | current |

## 3. Competing explanations

| Explanation | Supporting evidence | Distinguishing observation | Status |
| --- | --- | --- | --- |
| E1 A wait is a **node attribute** on an ordinary task node; the instance parks on arrival and the node runs after the resume | `NodeSchema` already carries two optional attributes (`domains`, `decide`, `flow.ts:73-82`), so a third is additive; the note gate, the gate and the brief machinery keep a task to work with | It preserves every invariant the runtime already enforces and needs no new node kind | **leading** |
| E2 A wait is a node **without a task** (a pure control node) | the brief says "a wait node" (`docs/FLOWS.md:398`) | `NodeSchema.task` is required (`flow.ts:73-82`), `advance` casts `flow.tasks.get(node.task)` (`advance.ts:88`), and the step descriptor needs a task — making `task` optional would touch the gate, the descriptor, `validateFlow` and every `node.task` read for no extra capability | **eliminated** |
| E3 A wait is a **task** attribute | tasks own "what work" | A task without a producible artifact breaks `produces`/gate/note semantics, and the wait is a property of the flow's shape, not of the work | **eliminated** |
| E4 Park state lives in an **event**, not a column | `failedReason` already follows exactly this rule (`schema.ts:299-305`, `quality-loop.ts:76-90`) | A column would need DDL (the store gate) and would become a second owner of the same fact; the event log is already the record of what happened | **leading** |
| E5 The timeout is **scheduled** by a sweep | `docs/FLOWS.md:249-252` names gate #7 for off-process work | A sweeper is an off-process daemon: it needs gate #7 plus a retention policy (gate #6). Evaluating the deadline lazily at the next `resume` call is deterministic, needs no clock in the engine and no daemon | **leading** (lazy); the sweep is **eliminated for this slice** |
| E6 A timeout resumes the flow down a timeout **branch** | the branch unit can route | A timeout branch would be a second routing surface on top of the wait; the branch already exists for whatever should happen *after* a resumed wait, and failing closed is the smaller claim | **eliminated** for this slice |
| E7 The trigger is a flow construct (edge/node) | none in the brief | `docs/FLOWS.md:261-267` states it is a host seam calling `start`/resume; an edge cannot fire outside a running instance | **eliminated** |

## 4. Findings

- **F1 [source-inspected]** `InstanceStatusSchema` is at `src/types/schema.ts:282`, not at `schema.ts:477`
  as `docs/FLOWS.md:239` states: the branch unit moved the flow-document block to `src/types/flow.ts`
  and `schema.ts` is now 357 lines, so `:477` does not exist. The enum still has exactly the three
  values the brief names (`grep -rn InstanceStatusSchema src/types`).
- **F2 [source-inspected]** `TRANSITIONS` is typed `Record<InstanceStatus, readonly InstanceStatus[]>`
  (`src/store/instance.ts:42-46`) and today allows only `running -> completed/failed`. Adding a status to
  the enum is therefore a **compile error** until the map carries it — the map cannot silently miss
  `waiting`. `setStatus` parses the target against the enum (`:165`) and refuses an undeclared move
  (`:180`) with `INSTANCE_STATE_INVALID`.
- **F3 [source-inspected]** `advance` passes `completed` through (`advance.ts:54`) and refuses every other
  non-running status (`:60`, `INSTANCE_STATE_INVALID`) — so a parked instance is already protected from
  being advanced, with no new code and no new refusal code.
- **F4 [source-inspected]** Praxis already derives a per-instance fact from the log instead of storing it:
  `failedReason` is rebuilt from `instance.failed` on read (`quality-loop.ts:76-90`) and the instance value
  stays strict with no such column (`schema.ts:290-305`). A park predicate and deadline can follow the
  same rule, so this unit needs **no table, column, DDL or store-schema bump**.
- **F5 [source-inspected]** Exactly three moves place an instance on a node: `start` for the first node
  (`start.ts:59-70`), the successor move (`advance.ts:381-388`) and the two refuse moves
  (`:242`, `:343`). Parking is therefore an "arrival" rule with a small number of call sites, not a scan.
- **F6 [source-inspected]** `setStatus` stamps `new Date().toISOString()` (`instance.ts:187`) instead of the
  engine's injected `stamp(options)` (`advance.ts:52`). That is an existing ambient-clock leak: a deadline
  must be computed from the injected clock in the park/resume code, and no check may assume `updated_at`
  moved by the injected time.
- **F7 [source-inspected]** `nextActionFor` (`result.ts:38-44`) returns `"resume"` for any status that is
  not `completed` or `failed`, so a parked instance would tell its parent to do the one thing `advance`
  refuses. `nextAction` is a free 1-1024 string (`schema.ts:345`), so a `waiting` arm needs no schema change.
- **F8 [source-inspected]** Event types are **not** an enum: `EventTypeSchema` is a regex
  (`schema.ts:51`), so new names need no schema edit; `appendEvent` owns its own transaction
  (`events.ts:33-58`) and `listEvents` returns rows in sequence order — the park/resume record needs no new
  store API.
- **F9 [source-inspected]** `inspect` (`inspect.ts:19-33`) builds the six-key result plus the current flow,
  handoffs and quality history from durable state alone, so a parked instance is readable with no new read
  path and no new envelope.
- **F10 [source-inspected]** The branch unit's durable-decision shape is one event appended after acceptance
  and before the move, with a reader so a replay reuses the record (`advance.ts:363-380`). Wait mirrors the
  *shape* but not the *decider*: its match is a declared equality predicate over typed fields
  (`docs/FLOWS.md:244-246`), so there is no port and no jev call — `src/quality/jev-branch.ts` is the
  contrast, not the template.
- **F11 [source-inspected]** `src/pi/operations.ts` is 589 lines against the binding 600 cap, so a new Pi-tool
  `op=resume` cannot be added there without a split, and the op enum is a tool-contract change. `src/cli.ts`
  is 183 lines and already owns the `resume` verb, so the **CLI is the minimal host surface** for this slice.
- **F12 [source-inspected]** `start` is already idempotent per request id: `instanceIdFor` is a pure function
  of (flow, requestId) (`flow.ts:188-191`) and a repeat re-opens the same instance, refusing a different
  payload with `REQUEST_CONFLICT` (`start.ts:45-57`). A repeated trigger cannot fork — that is idempotency,
  not exactly-once.
- **F13 [source-inspected]** The CLI's `resume` today means "advance the running instance"
  (`cli.ts:112-137`). A new `--event` flag must therefore select the wait path only when present, and a plain
  resume of a parked instance must fail as it does today (`INSTANCE_STATE_INVALID`) with a hint, never
  silently unpark.
- **F14 [source-inspected]** `finishInstance` refuses unless the instance is `running`
  (`note-gate.ts:268-272`), and the note obligation is checked at the start of `advance`
  (`note-gate.ts:171-177`). A park therefore cannot skip a note: the obligation survives the park and is
  enforced on the first advance after the resume.
- **F15 [source-inspected]** The taxonomy is **36** codes (`errors.ts:21-60`, `TAXONOMY_SIZE = 36` at
  `tests/types/errors.test.ts:46`). `docs/FLOWS.md:404` still says "grows from 37" — stale for the second
  unit running; the arithmetic here is 36 -> 38.
- **F16 [source-inspected]** No shipped flow or task declares a wait: a grep for `wait`, `timeout` and
  `trigger` across `.pi/praxis/flows/**` and `.pi/praxis/tasks/**` returns no match, so "byte-identical for
  non-wait flows" is checkable by digest of the same five documents the branch unit pinned.
- **F17 [proposed]** Two park sites (start's first node, the successor move) plus one load-time rule are
  smaller than parking on all three moves: a `refuse` edge may not target a `wait` node, because re-parking
  on rework would discard the resume receipt and hang the run.
- **F18 [source-inspected]** `assertObserver` (`authority.ts:36-40`) is the existing read/observe rule
  (creator or an assigned actor). `resume` uses the same rule so a stranger cannot unpark another actor's
  instance; it is routing hygiene, not identity (`gate #3` stays open).
- **F19 [untested]** Nothing in this unit has run: no wait flow has ever been created, no park event has ever
  been written, and every claim about behaviour is a design claim until the plan's checks are executed.

## 5. Affected owners and callers

| Path | Declaration | Callers | Effect |
| --- | --- | --- | --- |
| `src/types/schema.ts` | `InstanceStatusSchema` (`:282`), `ResultSchema` (`:339`) | `store/instance.ts`, `result.ts`, every envelope | `+= "waiting"` (additive); the result's status follows automatically |
| `src/types/flow.ts` | `NodeSchema` (`:73`), `NODE_KEYS` (`:319`), `FlowConfigSchema.superRefine` (`:139`) | `parseFlowConfig` (`:332`), `openFlow` | `+= wait` (a strict `{on:{type,match?}, timeoutMs?}`), the key allow-list, and the refuse-target rule |
| `src/types/errors.ts` / `src/types/pi.ts` | `Code` (`:21-60`) / `CODES` mirror | every module / envelopes | `+= WAIT_TIMEOUT, WAIT_EVENT_INVALID` (36 -> 38) |
| `src/store/instance.ts` | `TRANSITIONS` (`:42`) | `setStatus` | running->waiting, waiting->running, waiting->failed |
| `src/runner/engine/types.ts` | `EVENT` (`:9-32`) | `advance`, `start`, the new module | `+= instanceParked, waitResumed`; `+= ResumeOptions, Resumed` |
| `src/runner/engine/wait.ts` (new) | `arriveAt`, `resume`, the event matcher | `start`, `advance`, `cli.ts` | the park intent, the resume receipt, the lazy deadline, the match |
| `src/runner/engine/advance.ts` | the successor move (`:381-388`) | `cli.ts`, `operations.ts`, 33 test sites | route the move through `arriveAt` |
| `src/runner/engine/start.ts` | the created path (`:59-70`) | `cli.ts`, `operations.ts` | park when the first node waits |
| `src/runner/engine/index.ts` | the barrel | importers | re-export `resume` and its types |
| `src/runner/result.ts` | `nextActionFor` (`:38`) | `buildResult` | a `waiting` arm: `wait: <event type>` |
| `src/cli.ts` | the `resume` verb (`:112-137`) | the operator / a host cron | `--event <file>` selects the wait path |
| `tests/testkit.ts` | `writeFlow` | every runner test | a `wait` node fixture |

## 6. Uncertainty and open questions

- **Q1 — where the wait is declared.** Settled in favour of a node attribute (E1); a task attribute would
  put shape in the wrong owner and a task-less node would break the gate, the descriptor and `validateFlow`.
- **Q2 — what a park event must carry.** A predicate (type + bounded equality fields), an optional deadline,
  the step, and its own sequence number (which the receipt names). Whether the *payload to the resumed step*
  should also carry the matched event is decided in the spec: the resumed step's brief is unchanged in this
  slice, so the event is evidence, not a handoff.
- **Q3 — repeated resumes.** Dedupe on (parkSeq, event digest) is the smallest rule that makes a duplicate
  delivery a no-op; anything else needs a second record. Decided in the spec.
- **Q4 — retention (gate #6).** Parked instances accumulate with no cap or purge. Deliberately not settled
  here; named as the gate it is.
- **Q5 — the scheduler (gate #7).** Not built. The lazy deadline is the pre-gate form; a sweeper needs #7.
- **Q6 — a Pi-tool `op=resume`.** Deferred (F11). The host seam is the CLI in this slice.
- **Q7 — what the resumed step sees.** Nothing new is injected into the step in this slice; whether the
  matched event should enrich the brief is a later unit (it would touch the descriptor and the envelope).

## 7. Handoff

The spec must settle, with oracles: (a) `waiting` plus its three transitions; (b) two events
(`instance.parked`, `wait.resumed`) with exact payloads, the match predicate shape and **lazy** timeout
semantics; (c) the engine `resume` entrypoint with its authority, its refusals and the statement that no
store write is held across the wait; (d) `WAIT_TIMEOUT`/`WAIT_EVENT_INVALID` and 36 -> 38 with the mirror;
(e) the trigger as a host seam (config-trust actor, host cron in scope, scheduler out, no exactly-once);
(f) the human node as a wait variant; (g) non-wait flows byte-identical; and (h) an explicit split between
the buildable slice and the parts gated by #6/#7.
