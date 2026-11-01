# Spec — flow Unit 2: WAIT + TRIGGER (durable park/resume)

Task: wait-trigger · Hash: f330a0aa · Gate: G2 · Status: draft (awaiting review) · Date: 2026-11-01

Basis: `docs/tasks/wait-trigger-f330a0aa/research.md` (F1-F19, E1-E7) and the lead brief
`docs/FLOWS.md` §5.2 (`:234`), §5.3 (`:259`), §5.4 (`:275`), §10 (`:396-404`), §12 (`:426-441`).
**Design only.** Implementation is a separate owner GO; nothing here authorizes a `src/` edit.

## Outcome

An instance can **park** at a node until an outside event arrives, and a host can **resume** it there.
Parking flips the instance to the additive status `waiting`, records one durable `instance.parked`
intent, and stops: no store transaction is held across the wait, no daemon runs, and no step executes.
A single `resume` call validates the external event against the park's declared predicate, records one
`wait.resumed` receipt, and puts the instance back to `running` **at the same node**, where the ordinary
step, gate and note machinery take over. A declared timeout is evaluated **lazily** at that same call and
fails the instance closed. A trigger is not a flow construct at all: it is a host (or Manifold) seam that
calls `start` or `resume`. A human node is a wait whose event is a human submission. Flows without a
wait are byte-identical.

## Decisions

- **D1 — the wait is a node attribute** on an ordinary task node (`wait: {on, timeoutMs?}`), alongside
  `domains` and `decide` (`src/types/flow.ts:73-82`). Rejected: a task-less control node (it would force
  `NodeSchema.task` optional and touch the gate, the descriptor and `validateFlow` — E2) and a task
  attribute (a wait is flow shape, not work — E3).
- **D2 — park state is an EVENT, never a column** (`instance.parked` + `wait.resumed`), mirroring
  `failedReason`'s derived-from-the-log rule (`schema.ts:299-305`, `quality-loop.ts:76-90`). Rejected: a
  column (DDL + a second owner).
- **D3 — two park sites and one load-time rule.** Parking happens on **arrival**: `start`'s first node and
  the successor move. A `refuse` edge may **not** target a `wait` node (load-time `CONFIG_INVALID`), which
  removes the third site and the "re-park on rework" hang (F17).
- **D4 — the timeout is lazy.** Evaluated in `resume`, never by a sweep. Rejected: a scheduler (gate #7) and
  a resumable timeout branch (E5/E6); a timeout **fails** the instance closed with a typed reason.
- **D5 — the trigger is a seam.** No edge, no node, no schema; `start` fires, `resume` continues, and the
  actor is **config-trust** (gate #3 stated, never claimed).
- **D6 — the matcher is deterministic.** Exact equality over declared fields; no jev, no regex, no subset
  matching. Classifying a fuzzy signal is a downstream *task*, not the wait (`docs/FLOWS.md:244-246`).

## Requirements

| Id | Requirement | Failure behaviour | Oracle |
| --- | --- | --- | --- |
| R1 | `InstanceStatusSchema` (`schema.ts:282`) gains `"waiting"` (additive, three states unchanged) and `TRANSITIONS` (`instance.ts:42-46`) gains `running->waiting`, `waiting->running`, `waiting->failed`. | `INSTANCE_STATE_INVALID` for any other move (`:180`) or an undeclared status (`:165`) | park flips running->waiting; resume flips waiting->running at the **same** step; `waiting->completed` is refused; `advance` on a waiting instance is `INSTANCE_STATE_INVALID` and writes nothing |
| R2 | `NodeSchema` (`flow.ts:73`) gains optional `wait: {on: {type: <event-type grammar>, match?: 1-8 key -> string\|number\|boolean}, timeoutMs?: int 1000..2592000000}`; `NODE_KEYS` (`:319`) gains `wait`. `superRefine`: a `refuse` edge may not target a `wait` node; nothing else is constrained (a wait node may be first and may also carry `decide`). | `CONFIG_INVALID` at parse (`parseFlowConfig`, `:332`); an unknown 5th node key stays `NODE_INVALID` (`:335-346`) | a wait node loads; 9 match keys, a bad field type and `timeoutMs: 0` are refused; a `refuse` edge into a wait node is refused; `wait` + `decide` on one node loads |
| R3 | **Arrival parks.** `arriveAt(store, instance, flow, targetNode, at)`: when the target declares `wait` and no receipt exists for the park in force, append `instance.parked` (if none is pending) and move the instance to `waiting`; otherwise move it to `running` at that node exactly as today. Called by `start` (first node, `start.ts:59-70`) and by the successor move (`advance.ts:381-388`). | none — arrival always resolves to parked or running | `A -> W(wait) -> B`: accepting A leaves the instance `waiting` at W with exactly one park event; a repeated arrival appends no second park; a flow without `wait` produces no park event and the same status as before |
| R4 | **The park record.** `EVENT.instanceParked = "instance.parked"`, payload `{step, eventType, match?, deadline?}`; the event's own `seq` is the park id a receipt names. `deadline` is ISO-8601 computed from the **injected** clock (`at + timeoutMs`) and absent when no timeout is declared. No column, no table, no DDL. | none (the park is written before the status moves, so a crash between them is repaired by the next arrival) | exactly one `instance.parked` per arrival; its payload carries the declared type and, with a timeout, the deadline computed from `options.now`; `git diff src/store/db.ts` is empty |
| R5 | **The resume entrypoint.** `resume(options: EngineOptions & {instance, event: {type, ...fields}, actor?})` returns `{instance, result, flow, handoffs}`. Order: `assertObserver` (`authority.ts:36-40`) -> status must be `waiting` -> the park in force must exist -> deadline check (R8) -> match (R9) -> receipt dedupe (R7) -> append `wait.resumed` + set `running` at the parked step. | `INSTANCE_STATE_INVALID` (not waiting / no park), `WAIT_TIMEOUT` (R8), `WAIT_EVENT_INVALID` (R9), `INSTANCE_FORBIDDEN` (authority) | a matching event flips waiting->running at the same step with one receipt; a non-matching event is `WAIT_EVENT_INVALID` with **zero** writes (event count and status unchanged); a stranger is `INSTANCE_FORBIDDEN`; no store write is held across the wait (each call is a short transaction) |
| R6 | **The receipt.** `EVENT.waitResumed = "wait.resumed"`, payload `{step, parkSeq, eventType, eventDigest, matched?}` where `eventDigest = digest(canonicalBytes({type, fields}))` and `matched` holds only the declared keys. The external event's body is never stored. | none | one receipt per resume; the digest is stable for identical events; the payload carries no undeclared field |
| R7 | **Idempotent resume.** A second resume carrying the same `(parkSeq, eventDigest)` returns the current state and appends nothing; a resume while the instance is `running` is `INSTANCE_STATE_INVALID`. | as stated | two identical resumes produce one receipt and one status change; a resume after the instance is running again is `INSTANCE_STATE_INVALID` |
| R8 | **Lazy timeout.** The deadline is evaluated only inside `resume`; when `now > deadline` the instance appends `instance.failed` `{step, reason, code: "WAIT_TIMEOUT"}` (`quality-loop.ts:234-237` shape), moves `waiting->failed`, and no receipt is written. Nothing sweeps; a parked instance past its deadline stays parked until a resume call. | `WAIT_TIMEOUT` | with `now` beyond the deadline the resume fails, `status` is `failed`, `failedReason` derives from the event, no receipt exists; no timer/daemon exists in `src/` |
| R9 | **The matcher.** Match iff `event.type === wait.on.type` **and** every declared key equals the event's value by strict equality (no coercion, no regex, no subset). Undeclared extra event fields are ignored; a declared field absent from the event is a mismatch. | `WAIT_EVENT_INVALID` | exact match resumes; a missing declared field, a wrong value and a wrong type all refuse with zero writes; an extra undeclared field still resumes |
| R10 | **The parked result.** The six-key result for a waiting instance reads `status: "waiting"`, `summary: "waiting at <step>: N artifact(s) accepted"`, `nextAction: "wait: <eventType>"` (bounded). No new key, no envelope change (`ResultSchema`, `schema.ts:339`). | `RESULT_INVALID` if a value breaks the schema | a parked instance's result has those three values; a completed instance's result is byte-identical to today |
| R11 | **The trigger is a host seam.** No edge kind, no node kind, no schema: firing is `start` (existing, idempotent per request id) and continuing is `resume`. The actor is **config-trust** — `start`'s `options.actor ?? PRAXIS_ACTOR ?? "cli"` (`start.ts:37`) and the same rule for `resume`; stated as config-trust, gate #3 open. | a start/resume naming an unknown flow, instance or actor fails as today (`FLOW_INVALID`, `INSTANCE_NOT_FOUND`, `CONFIG_INVALID`) | grep shows no `trigger` node/edge kind; a resume records exactly the actor it was given; no authentication is claimed anywhere |
| R12 | **Repeated triggers are idempotent, not exactly-once.** A repeated `start` with the same request id re-opens the same instance (`instanceIdFor`, `flow.ts:188-191`; `REQUEST_CONFLICT` on a different payload, `start.ts:45-57`); a repeated resume with the same event is a no-op (R7). A stale event after a resume finds no park and is refused. **No exactly-once claim** is made about the external effect that produced the event. | `WAIT_EVENT_INVALID` (stale event) | two starts with one request id produce one instance; two identical resumes produce one receipt; the spec text contains no exactly-once claim |
| R13 | **The human node is a wait variant.** A human node is a `wait` node whose `on.type` names a submission (e.g. `human.submitted`), followed by the node's ordinary gate: park -> resume -> the artifact arrives through the ordinary `submit` and is judged by the ordinary gate. Identity comes from a Pi/Manifold binding, never a request field (config-trust today). | the ordinary gate's codes | a flow with a human wait runs park -> resume -> submit -> gate, and the gate decides (a below-bar artifact is refused) |
| R14 | **Non-wait flows are byte-identical.** A flow with no `wait` node keeps today's events, codes, six-key results and digests; the five shipped documents keep theirs (research F16); the store's DDL is untouched. | drift is a blocking defect | the existing suite is green unchanged; the five digests match; `git diff src/store/db.ts` empty and `git diff src/store/instance.ts` is the `TRANSITIONS` map only |
| R15 | **Codes and mirror.** `WAIT_TIMEOUT`, `WAIT_EVENT_INVALID` added to `Code` (`errors.ts:21-60`), the `pi.ts` mirror and `TAXONOMY_SIZE` 36 -> 38. | a compile error from `satisfies readonly Code[]` on drift | `tsc` clean; `tests/types/errors.test.ts` green with 38 |
| R16 | **Scope.** This unit writes only `docs/tasks/wait-trigger-f330a0aa/`; every `src/` path above is named for the later, separately authorized build. | a write outside the folder voids the unit | `git status --porcelain docs/tasks/wait-trigger-f330a0aa` lists exactly three documents and nothing else changes because of this unit |

## Model

| Element | Owner | Valid states | Invariants | Requirement | Failure if absent |
| --- | --- | --- | --- | --- | --- |
| `waiting` status | `InstanceStatusSchema` (`schema.ts:282`) + `TRANSITIONS` (`instance.ts:42`); the row owns it | running, waiting, completed, failed | only the four declared moves exist; `waiting` is reachable only through a park and leaves only through a resume or a timeout | R1 | `setStatus` refuses (`INSTANCE_STATE_INVALID`) |
| `wait` declaration | the **node** in the flow document (`flow.ts:73`) | absent, present | `on.type` follows the event-type grammar; `match` has at most 8 strictly typed fields; `timeoutMs` is bounded; a `refuse` edge may not target the node | R2 | `CONFIG_INVALID` at load; an arrival could not know it must park |
| park intent | the **`instance.parked` event** — the sole record | none, one in force, resumed | one per arrival; carries the predicate and an optional deadline; its `seq` is the park id; never rewritten | R4, R5 | `INSTANCE_STATE_INVALID` on a resume with no park — a waiting instance without a park is corrupt |
| resume receipt | the **`wait.resumed` event** | none, one per park | names the park `seq`; carries the event digest and only declared fields; append-only; a second resume with the same pair writes nothing | R6, R7 | the resume is not evidence; a duplicate delivery would be indistinguishable |
| matcher | deterministic code in `src/runner/engine/wait.ts` | match, no-match | equality only over declared fields; `type` must equal exactly; no jev, no regex, no coercion | R9 | `WAIT_EVENT_INVALID` |
| deadline | derived from the park event, evaluated lazily | absent, future, past | computed from the injected clock at park time; evaluated only in `resume`; past = fail closed | R8 | `WAIT_TIMEOUT` |
| resume entrypoint | `src/runner/engine/wait.ts`, exported through `engine/index.ts` | one call, one transition | authority checked first; every refusal happens before any write; no transaction spans the wait | R5 | nothing can unpark an instance |
| trigger seam | **host / Manifold**, outside Praxis | fires (`start`), continues (`resume`), or does neither | never a node or an edge; the actor is config-trust; a repeated fire cannot fork | R11, R12 | no flow ever starts or continues — a host responsibility, not a missing primitive |
| parked result | `src/runner/result.ts` | six keys, unchanged shape | `status: waiting`, `nextAction: "wait: <type>"`; no new key | R10 | the parent would be told to resume something that cannot advance |

**Data flow (one line).** arrival at a `wait` node -> `instance.parked` {predicate, deadline?} -> status
`waiting` -> (external event) -> `resume` {event} -> validate + match + deadline -> `wait.resumed` receipt ->
status `running` at the same step -> the ordinary step, gate and note.

## Gated parts (named, NOT built in the first slice)

| Part | Gate | Why it is out | What the first slice does instead |
| --- | --- | --- | --- |
| retention / purge / cap of long-lived parked instances | **#6 (store durability, retention)** | an unbounded parked population is a retention policy, which is the owner's to set | parked instances accumulate; the gate is surfaced, not settled |
| an off-process scheduler or timeout sweeper | **#7 (off-process maintenance)** | a daemon is the gate itself | timeouts are evaluated **lazily** at the next `resume`; a host cron calling `start`/`resume` is the pre-gate form |
| a Pi-tool `op=resume` | tool contract + `operations.ts` at 589/600 | a new op is a contract change and there is no line budget | the CLI `resume --event` is the host surface (F11) |
| the matched event enriching the step brief | descriptor + envelope change | not needed to prove park/resume | the event is evidence only (Q7) |
| a timeout *branch* (resume-with-timeout) | — | a second routing surface (E6) | the timeout fails the instance closed (R8) |
| nesting, isolation, trusted identity, exactly-once | #4/#8, #1, #3 | separate units / open gates | stated, never claimed |

## Exclusions

- **No scheduler, no daemon, no timer** (gate #7) and **no retention policy** (gate #6) — see above.
- **No wait in any shipped flow or task document**: the four flows and the task library stay byte-identical
  (R14); a wait is added to a flow only by an owner who edits that flow.
- **No new table, column, DDL or store-schema bump**: park and receipt are events (D2, R4, R6).
- **No jev in the wait**: matching is deterministic (D6). Classifying a fuzzy signal is a downstream task.
- **No identity claim**: the trigger's actor is config-trust, and `assertObserver` is routing hygiene, not
  authentication (gate #3 open).
- **No exactly-once claim** for the external effect that produced an event (R12).
- **No change** to the quality gate, bars, scorer, recall ranker, branch router, task documents, or the
  `pi` tool envelope; no `src/`, `tests/` or `.pi/` edit **by this unit** (R16).

## Alternatives

| Alternative | Rejected because |
| --- | --- |
| A task-less "control node" for the wait | Forces `NodeSchema.task` optional and touches the gate, the step descriptor, `validateFlow` and every `node.task` read (`advance.ts:88` casts it) — for no capability a node attribute does not already give |
| A `wait` field on the **task** document | A task owns "what work and how good"; a wait is the flow's shape. It would also put a park in a reusable atom, so every flow using the task would park |
| A `parked` column on the instance row | DDL (the store gate) and a second owner of a fact the log already records — the `failedReason` precedent (`schema.ts:299-305`) shows the cheaper path |
| An eager timeout sweeper | Needs gate #7 (off-process) and gate #6 (retention); a lazy check at resume is deterministic and needs no clock in the engine |
| A timeout that resumes down a branch | A second routing surface; the branch unit already exists for what happens after a resume |
| Making the trigger an edge or node | An edge cannot fire outside a running instance, and a node would need a task; the brief states it is a seam (`docs/FLOWS.md:261-267`) |
| Resuming on **any** event (no predicate) | An unrelated event would unpark the wrong instance/step; the predicate is the one check that makes the resume a decision rather than a race |
| Storing the external event body in the receipt | Unbounded foreign payload in the durable log; the digest plus declared fields is enough evidence to dedupe and audit |

## Open questions

- **OQ1 — retention (#6).** How long may an instance stay parked, and is there a cap? The owner settles it;
  this slice accumulates without limit and says so.
- **OQ2 — the Pi-tool surface.** `op=resume` plus brief enrichment (Q7) is a later unit with its own
  contract change and a `operations.ts` split.
- **OQ3 — a resumable timeout.** Today a timeout is terminal (`waiting -> failed`). If a flow later needs
  "timed out, do X instead", that is a branch on a resumed signal, not a new wait semantic.
