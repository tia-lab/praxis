# Flows in Praxis

> **Status: living design — updated 2026-11-01 to match the shipped code.** This document describes the
> flow engine and the controls that complete it. **branch** and **wait + trigger** are now **BUILT and
> committed** (branch `b04a04e`; wait+trigger Slice A `a61a279`), and the **human node** ships as a wait
> variant. What remains **△ proposed / not built** is **nesting** (§5.5/§7, gated #4/#8) and wait's gated
> operational parts (retention #6, an off-process scheduler #7, a Pi-tool `op=resume`, the `sweep` verb).
> A built item is marked **✅ built** with its commit; an unbuilt one stays **△ proposed**. As-built
> contracts live in `docs/tasks/branch-d0472c5f/` and `docs/tasks/wait-trigger-f330a0aa/` — where this
> document and those specs differ, **the spec is the source of truth**.
>
> **Handoff path:** lead writes this brief → **architect** produces architecture + spec + plan per
> [docs/WORKFLOW.md](WORKFLOW.md) → submitted to the **lead for approval** → each buildable primitive
> is its own bounded unit that still needs an explicit **owner GO** before any `src/` change.
> See [vision.md](vision.md) §12–§13 for sequencing and the open gates, and [AGENTS.md](../AGENTS.md)
> for the authorization ledger. Nothing in this file authorizes code.

---

## 0. Purpose and scope of this brief

The flow engine today expresses **three** of six control-flow primitives. This brief fixes the design of
the remaining three (**branch, wait, nesting**), the **trigger** seam that fires a flow, and the
**external-effect** discipline the action side needs — precisely enough that the architect can produce a
formal spec and plan without re-deriving the mechanics.

**The single most important finding, stated up front:** the flow engine needs **exactly one new jev
decider — the branch router**. Every other new control (wait, trigger, nesting) is deterministic routing
or a host seam; when they need intelligence, that intelligence is a _task's_ jev, never the primitive's.
The branch router, moreover, is authored as **JSON** and run by the **question-builder that already
exists** (`src/quality/jev-scorer.ts`). So completing the engine is mostly schema + routing + durable
state, not new judgment machinery.

---

## 1. What a flow is, in one sentence

> **A task is a unit of work with a _dynamic goal_. A flow is a _fixed control-flow shape_ over task
> invocations. The flow never reasons — it routes. When a route must be chosen, the flow asks a
> _decider_ and records the answer.**

|               | **task**                                   | **flow**                       |
| ------------- | ------------------------------------------ | ------------------------------ |
| answers       | **“what” + “how good”**                    | **“in what order”**            |
| nature        | open, domain-specific, **refined forever** | finite, closed, **built once** |
| carries       | goal, rubric, gate, scoring                | nodes + edges                  |
| the hard part | _judging_ the work                         | _routing_ the work             |
| analogy       | atom                                       | molecule                       |

One flow runs ten thousand different goals through the **same** preserved, gated, durable execution. The
goal is injected per instance; the shape is reused. That reuse is the whole leverage of tasks-as-atoms
and flows-as-shape.

---

## 2. How tasks are integrated into a flow

A task is **never defined inside the flow that uses it** (D1). A flow references task atoms by identity
and wires them (`praxis.flow/v2`):

```jsonc
{
  "schema": "praxis.flow/v2",
  "flow": "flows/engineering/feature",
  "nodes": [ { "id": "spec", "task": "tasks/design/spec" }, ... ],   // 1..16, a node is JUST a reference
  "edges": [ { "kind": "data", "from": "spec", "to": "plan" }, ... ], // 0..32, three kinds today
  "result": "<schema name>"
}
```

- **A node owns nothing but a reference** — `NodeSchema = z.strictObject({ id, task, domains? })`
  (`src/types/schema.ts:306`). The _task_ owns the work, the statement, the rubric and the gate; the
  _flow_ owns the wiring. A third node key is refused (`NODE_INVALID`).
- **An instance pins the task definitions it ran under** (publication keyed by `(path, version)`). A
  later rubric edit never changes a finished or running run.
- **A review binds to the digest of the artifact it judged** (D2), not to files on disk.

---

## 3. The control-flow algebra — six primitives

| #   | primitive                                | meaning                                                          | status      |
| --- | ---------------------------------------- | ---------------------------------------------------------------- | ----------- |
| 1   | **sequence** (`data` edge)               | do A, then B with A’s output                                     | ✅ built    |
| 2   | **join** (`join` edges)                  | B waits for A₁…Aₙ, consumes all (fan-in)                         | ✅ built    |
| 3   | **loop** (`refuse` edge + gate, bounded) | a higher node sends work _back_; repeat until the gate passes    | ✅ built    |
| 4   | **branch**                               | a typed decision picks _one_ of N successors                     | ✅ built `b04a04e` |
| 5   | **wait**                                 | park until an external event (email, timer, reply, another flow) | ✅ built (Slice A) `a61a279` |
| 6   | **human node**                           | an interactive turn that emits a gated artifact                  | ✅ built (wait variant) |

### What exists today (`praxis.flow/v2`) — source-cited

`EdgeKindSchema = z.enum(["data", "join", "refuse"])` (`schema.ts:315`). The flow is validated by one
`FlowConfigSchema.superRefine` (`schema.ts:341`), which makes “acyclic” checkable without a graph library
by declaring nodes in execution order:

- **`data`** — a hand-off from a lower-index node to a higher one (sequence).
- **`join`** — two-or-more sources into one node, one consumption carrying several inputs (fan-in); a join
  needs ≥ 2 distinct sources.
- **`refuse`** — from a higher node _back_ to a lower one; at most one per node. A refusal is **evidence,
  not instance death**: it returns work to the subject node, bounded by the task's `onFailure` policy
  (`escalate` / `continue`) and `quality.maxAttempts`.
- **Fan-out is forbidden today:** a node may feed **one** `data` successor and **one** join group, never
  two of either (`schema.ts:416-419`, `fan-out: node X feeds N data targets`). **This is the exact rule
  that makes branch impossible today — not an absence, an active refusal.**
- **Consumption invariant:** every node after the first consumes **exactly one** artifact
  (`more than one consumption edge into X`, `schema.ts:454`).
- Routing at runtime is `successorOf(config, nodeId)` (`src/runner/step.ts:83`), which returns the single
  `data` successor (the fan-out rule guarantees ≤ 1); `advance.ts` routes a refusal back to
  `resolved.refuse` and completes the instance when `successorOf` is `undefined`.

**The review loop already works.** “Review, pass only when approved” is a `refuse` edge from the reviewer
back to the subject, and **the quality gate is the decider** (per-dimension quantile bar, pure-AND). That
is the loop we run for spec, plan and code today.

---

## 3a. Domain — the dynamic, system-level conduct lens (context only)

> **Status: authorized, building (2026-11-01).** Not part of this brief; summarized so the branch/wait
> design does not collide with it.

A profile has three layers — `conduct` (occam), `role` (e.g. engineer), `domain` (e.g. code, quant). The
first two are the agent's **fixed identity** (composed into the system prompt). The **domain** is the one
dynamic layer, declared on the flow **node** (never the task atom), resolved and pinned at `op=start`,
union-composed, injected into the composed system prompt, fail-closed (`PROFILE_NOT_FOUND` /
`PROFILE_INVALID`). A node's `domains` override a flow-level default. The branch/wait primitives add no
domain surface and must leave this path byte-identical when unused.

---

## 4. How Jev is used — small typed decisions _inside_ the complex pieces

Praxis does not make a complex judgment in one fuzzy step. **A complex judgment is a lattice of small,
crisp, typed questions — each one Jev call — composed by code, never by more generation.** Three Jev answer
types are the atoms of decision:

```
noul   -> its probability           (how true / yes-no)
score  -> position / (levels - 1)   (which level)
choice -> 1 iff the clean option    (which category)
```

**The decider is authored as data and run by one generic builder.** `src/quality/jev-scorer.ts:119-125`
maps an authored probe `{ type, instructions, criteria }` **directly** to a jev question, with no
per-task code:

```
choice -> { type:"choice", instructions, criteria }   // criteria = a label->meaning map
score  -> { type:"score",  instructions, criteria }   // criteria = ordered level descriptions
noul   -> { type:"noul",   instructions }
```

The answer is read **strictly** (`choiceOf`/`noulOf` throw on an unexpected shape, never guess). The
alignment gate (`src/quality/jev-align.ts`) is the same pattern at one `choice` question, with an
injected port (`AlignJudge`, fakeable in tests) and a typed three-outcome verdict mirrored in
`src/types/pi.ts`. **This is the template every new decider copies.**

### 4a. The complete jev-decision map (where jev is needed — and only there)

| # | decision point                          | decider                         | status            | authored where                    |
| - | --------------------------------------- | ------------------------------- | ----------------- | --------------------------------- |
| 1 | **alignment** at `op=start`             | jev `choice`                    | ✅ built           | anchor from flow + the order      |
| 2 | **quality gate** at each gated node     | jev `score/noul/choice` battery | ✅ built           | `task.quality` probes (JSON)      |
| 3 | **loop** (refuse edge)                  | the gate verdict, no new call   | ✅ built           | deterministic                     |
| 4 | **sequence / join** (data/join)         | none — fan-in waits for all     | ✅ built           | deterministic                     |
| 5 | **branch** — which of N successors      | jev `choice` **router**         | ✅ built `b04a04e` | flow node `decide` block (JSON)   |
| 6 | **wait** — resume vs stay parked        | event-match / timeout           | ✅ built (Slice A) `a61a279` | deterministic; timeout LAZY (no scheduler — gate #7) |
| 7 | **trigger** — fire the flow             | external kick                   | ✅ built (host seam) | no jev                            |
| 8 | **nesting** — expand to a sub-flow      | declared, gated                 | △ TO BUILD        | static data; no jev in v1         |
| 9 | **completion**                          | final gate + bounded result     | ✅ built           | no separate jev                   |

**Conclusion:** the one new jev decider in the whole flow engine is the **branch router** (row 5), and it
reuses the existing builder. Everything else is schema, routing, durable state, or a host seam.

### Four responsibilities, never smeared together

- **Generation (the LLM agent)** does the _work_.
- **Typed Jev** does the _judging and routing_ — scores a criterion, picks a branch.
- **Code** does the _composing_ — MIN → AND → bar for the gate; strict label read + record for a branch.
- **Praxis** does the _preserving_ — records every decision durably, fails closed.

---

## 5. The controls that complete the engine — precise design

Each sub-section states: what it is, the schema delta, the runtime delta, the decider (if any), the
fail-closed codes, the open questions, and an acceptance sketch. **Build status (2026-11-01):** §5.1
Branch, §5.2 Wait and §5.3 Trigger are **✅ BUILT** (commits `b04a04e`, `a61a279`); §5.4 Human node ships
as a wait variant; **§5.5 Nesting stays △ proposed** (gated #4/#8), as do wait's gated parts. The as-built
contracts in `docs/tasks/branch-d0472c5f/` and `docs/tasks/wait-trigger-f330a0aa/` are authoritative where
they differ from the sketches below.

### 5.1 Branch — ✅ BUILT (`b04a04e`) — choose one successor by a typed decision

**What.** After node A completes and its artifact is accepted, a decider selects **exactly one** of
`{B, C, D}` and the instance advances down that one edge. The unchosen paths never run.

**Schema delta (`src/types/schema.ts`).**
- `EdgeKindSchema` gains `"branch"`.
- A branch node carries an authored decider. Recommended shape (architect confirms): a node attribute
  `decide?: { instructions, criteria }` where **`criteria` keys are the branch edge labels** (a closed
  set), reusing the `questionOf` `choice` shape verbatim. `EdgeSchema` gains an optional `label` on
  `branch` edges that must match a `decide.criteria` key.
- **Relax exactly one superRefine rule:** allow **multiple `branch` out-edges from one node** (the single
  place fan-out > 1 becomes legal). `data` and `join` keep single-fan-out. Keep the low→high index
  ordering so the graph stays an acyclic DAG; a branch picks one **forward** successor.

**The genuine hard design point — merge / reconvergence.** Today the invariant is “exactly one consumption
edge into each non-first node” (`schema.ts:454`). With branch, a reconvergence node Z may have N incoming
edges from the branch's mutually-exclusive targets, yet **exactly one fires per run**. The superRefine
must treat incoming edges whose sources are **branch-exclusive** as a **single** consumption slot at Z,
or reject reconvergence and force each branch arm to terminate. The architect must formalize branch
exclusivity (e.g. compute it from the branch structure, or require an explicit `merge` marker) — this is
the one part that is not a mechanical copy.

**Decider (`src/quality/jev-branch.ts`, new).** A near-copy of `jev-align.ts`: an injected `BranchRouter`
port (fakeable in tests), one `choice` question built by the existing `questionOf`, inputs (the accepted
artifact / flow position) carried in `state`, a strict reader over the `criteria` label keys. **One
deliberate difference from alignment:** alignment _proceeds with a flag_ on `unavailable`; a branch
**must pick**, so it **fails closed to a typed blocker** (`ROUTE_UNAVAILABLE` / `ROUTE_INVALID`), never a
guessed edge.

**Runtime delta.** `successorOf` (`step.ts:83`) becomes branch-aware; `advance.ts` calls the router when
the completed node is a branch, appends the chosen label as **one authoritative durable event**, then
routes to that single edge. Determinism of replay: the decision is recorded, so re-advance reuses the
recorded label, never re-calls jev.

**Codes.** `ROUTE_UNAVAILABLE`, `ROUTE_INVALID` added to the `Code` union (`src/types/errors.ts`) and its
drift-checked mirror (`src/types/pi.ts`).

**Open questions for the architect.** (a) node-attribute `decide` vs a decider-carrying edge kind;
(b) merge semantics (exclusive-merge vs arms-must-terminate); (c) whether a branch node also produces an
artifact (classify) or is a pure router over a predecessor's artifact.

**Acceptance sketch.** A flow with a 3-way branch advances to exactly one successor chosen by the
(faked) router; the choice is one durable event; re-advance is deterministic; an unavailable/invalid
router yields a typed blocker with no write and no advance; a non-branch flow is byte-identical;
`tsc` clean; suite green.

### 5.2 Wait — ✅ BUILT, Slice A (`a61a279`) — park until an external event

**What.** The instance suspends until something outside happens (an email arrives, a timer fires, a human
replies, another flow signals), then resumes at the waiting node.

**Why it is more than routing.** `InstanceStatusSchema = z.enum(["running","completed","failed"])`
(`schema.ts:477`) — **there is no parked state.** Wait requires:
- `InstanceStatusSchema` gains `"waiting"` (additive);
- a durable **park record** (an event carrying the event-match predicate and an optional timeout);
- a **resume entrypoint** on the engine that an external event (or a timeout sweep) calls, validates the
  event against the park predicate, and sets the instance back to `running` at the waiting node;
- the event-match is **deterministic** (a declared predicate over the event's typed fields). The
  _classification_ of a fuzzy external signal (“is this email pertinent?”) is a **jev task downstream of
  the wait**, not the wait primitive.

**Durability discipline.** The park is a durable intent; the external event is observed; the resume is a
durable receipt — the engine never holds a store write transaction across the wait. This is the vision's
open **durability gate (#6)** and touches the **off-process trigger gate (#7)**.

**Codes.** `WAIT_TIMEOUT`, `WAIT_EVENT_INVALID`.

**Open questions.** (a) event source model (webhook vs poller vs manual resume); (b) timeout semantics
(resume-with-timeout-branch vs fail); (c) how many instances may be parked and for how long
(retention — gate #6); (d) interaction of a parked instance with the note-closure gate.

### 5.3 Trigger — ✅ BUILT (host seam, Slice A) — fire or resume a flow

**What.** The thing that _starts_ a flow instance on a schedule or an event — the hourly cron, the inbound
webhook, another flow's completion.

**Design.** This is a **host / Manifold seam** that calls the existing `op=start` (or the wait resume
entrypoint), not an edge or node. It carries an **actor identity**, which today is **config-trust**
(`PRAXIS_ROLE`, gate #3 open) — it must be stated as config-trust, never claimed as authenticated. The
off-process trigger itself is **gate #7 (maintenance / off-process)**; a plain host cron calling `start`
is the minimal form until that gate is opened.

**Codes.** reuse existing `start` codes; a trigger that names an unknown flow/actor fails closed as today.

**Open questions.** (a) cron ownership (host OS cron vs a Praxis-side scheduler — the latter is gate #7);
(b) actor binding for a triggered run; (c) idempotency of a repeated trigger (no exactly-once claim).

### 5.4 Human node — ✅ BUILT (folds into wait)

A human turn that emits a gated artifact is a **wait for a human event** plus a normal gated node. It is
**not a separate mechanism**: model it as a wait whose event is “the human submitted an artifact,” then
the standard gate applies. The human actor's identity comes from a **Pi/Manifold binding, never a request
field** (vision boundary; gate #3). No new primitive beyond wait + the existing gate.

### 5.5 △ Nesting — a flow of sub-flows (gated; the ceiling)

**What.** A node references a **sub-flow** instead of a task; a logical unit decomposes into a tree of
flows, bottoming in task atoms.

**Schema / runtime delta (minimal, additive).**
1. a node may reference a **flow or a task** — a small `task`-or-`flow` union on `NodeSchema`;
2. a **nested-run path** — the engine runs that reference as a **child instance** (the engine calling
   itself) and feeds the child's **six-key bounded result** (`src/runner/result.ts`) into the parent's
   outgoing edge — **never its event log or transcript**;
3. a **depth + cost budget** — the one genuinely new decision, **fail-closed when exceeded**.

**Gated.** Nested execution is **gate #4 (flow-expansion authority)** and **gate #8 (nested-execution
depth + budgets)**. It stays **disabled** until an authorized unit enables it with explicit bounds. No jev
in v1 — expansion is declared, not decided.

**Codes.** `NEST_DEPTH_EXCEEDED`, `NEST_BUDGET_EXCEEDED`.

---

## 6. Worked examples

### Delivery — what we run now (sequence + loop)

```text
[define] --data--> spec <--refuse(gate)--> review
                     |
                   data
                     v
                    plan  <--refuse(gate)--> review
                     |
                   data
                     v
                    code  <--refuse(gate)--> review --data--> close
```

Everything here is built today: `data` sequence + `refuse` loops (each gated by the per-dimension
quantile bar), and `define` is a human node — a wait variant (§5.4, built).

### Inbox — a different shape (trigger + wait + branch), and the external-effect edge

```text
(cron hourly — §5.3 trigger) --start--> [wait: new email event]
      --data--> classify (a TASK: jev choice — pertinent? spam? action?)
      --branch--> { answer | archive | escalate }
            answer --data--> draft-reply (TASK, gated)
                   --data--> send-reply (external effect, §9) --> close
```

- the **trigger** is the host cron (§5.3), not a flow edge;
- the **wait** parks until the email event (§5.2); the classification is a **task's** jev `choice`, not the
  wait primitive;
- the **branch** is the one new router (§5.1): one `choice`, one recorded edge;
- **send-reply** is an **external effect** (§9): durable intent → send → receipt, no exactly-once.

The same spine covers a trading loop: trigger → wait for a market/event signal → task classifies → branch
(act / hold / escalate) → task places the order as an external effect under the same intent→receipt rule.

**A small catalogue of shapes × an open set of goals = unbounded real work, with the same durable, gated,
preserved spine every time.**

---

## 7. Nesting and the ceiling

**This is the top of Praxis's control-flow composition. There is no layer above flows inside Praxis, and
there is never a “super-flow” that coordinates independent flows.**

| shape                   | what it is                                            | whose job                              |
| ----------------------- | ----------------------------------------------------- | -------------------------------------- |
| inside one flow         | a bounded **DAG** (`data` + `join` + `refuse` + branch) | **Praxis** ✅             |
| a flow of sub-flows     | a **tree**, bottoming in task atoms                   | **Praxis** △ gated (#4/#8)             |
| many independent flows  | **not a flow** — an assignment graph + shared facts   | **Manifold** (assign) + **Jung** (synthesize) |

Coordinating _independent_ units of work is **assignment + shared facts**, never a bigger control-flow
graph: assign independent flows → **Manifold**; relate their outcomes → **bounded results + references in
the store** (a parent reads a child's result, never its transcript); synthesize across projects →
**Jung** (does not exist — a _named blocker_, never faked). The moment a “bigger order” starts assigning
work to agents, it has **rebuilt Manifold inside Praxis** and made Praxis a team manager, which the
vision forbids. **Compose downward into sub-flows (gated); never grow a coordinator upward.**

---

## 8. The boundaries that keep flows honest

- **Flows route; they never reason.** All intelligence lives in the task's agent and in the deciders
  (gate / jev / event / human).
- **One authoritative owner per fact.** Praxis records _which_ decision fired; jev owns the _judgment_;
  the task owns _what good means_. No competing copies.
- **Fail closed.** An unavailable decider, a missing answer, a stale pin → a typed, named blocker, never a
  fabricated score or a guessed edge.
- **Jev is an optional adapter behind the broker**, never the durability authority. The durable store is
  the Praxis spine.
- **Completion is acceptance, not a green call.** A schema-valid artifact is not a done task; the gate and
  the owner decide.

---

## 9. External effects (the action side — email send, order placement)

The work a flow routes often ends in an effect outside Praxis (send a reply, place a trade). Praxis does
not own the effect; a **task performs it with its own tools**, and Praxis records it under the vision's
durability discipline:

> **durable intent → external op → observed result → durable receipt.** Never hold a store write
> transaction across the external call. An uncertain external effect **blocks blind re-execution**. **No
> exactly-once claim is ever made.**

For trading specifically this is load-bearing: a placed order whose receipt is uncertain must not be
blindly re-sent; it blocks for guidance. This is a discipline on the **task**, not a flow primitive, but
the flow design must leave room for it (the wait/resume and the bounded result carry the receipt).

---

## 10. What must be added — consolidated manifest (for the architect's plan)

| unit             | `schema.ts`                                                                 | new module                      | engine                                   | codes (`errors.ts` + `pi.ts` mirror)     | state/store                     |
| ---------------- | --------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------- | ---------------------------------------- | ------------------------------- |
| **1 Branch**     | `EdgeKindSchema += "branch"`; node `decide`; edge `label`; relax fan-out; merge rule | `src/quality/jev-branch.ts`     | `successorOf` branch-aware; `advance.ts` records + routes | `ROUTE_UNAVAILABLE`, `ROUTE_INVALID`     | one `branch.decided` event      |
| **2 Wait+Trigger** | `InstanceStatusSchema += "waiting"`; a wait node + event-match predicate   | resume entrypoint; trigger seam | park/resume; timeout sweep               | `WAIT_TIMEOUT`, `WAIT_EVENT_INVALID`     | durable park + resume events    |
| **3 Nesting**    | node `task`-or-`flow` union; depth/budget fields                            | nested-run path                 | engine-calls-itself child; budget guard  | `NEST_DEPTH_EXCEEDED`, `NEST_BUDGET_EXCEEDED` | child result → parent edge  |

Every code is drift-checked against its `pi.ts` mirror; the taxonomy grows from 37 by the codes above.
Every file stays < 600 lines; `tsc` clean; the suite stays green with **no network** in any unit test
(the jev router is tested behind a fake port, like the scorer and the aligner).

---

## 11. Build order and units

**Order: Branch → Wait+Trigger → Nesting.** The human node folds into Wait.

- **Unit 1 — Branch** is the natural first: self-contained, reuses the proven jev `choice` pattern, and
  its only hard part (merge semantics) is bounded. It unlocks real decision flows (triage, routing).
- **Unit 2 — Wait + Trigger** is larger: it introduces durable parking and an external seam, and it
  leans on open gates #6 (durability retention) and #7 (off-process trigger).
- **Unit 3 — Nesting** is gated by #4 and #8 and must ship with explicit depth + cost bounds.

Each unit is a separate [docs/WORKFLOW.md](WORKFLOW.md) gated unit (research → spec → plan → implement →
review) and **each needs its own explicit owner GO** before any `src/` change. This brief authorizes none
of them; it is the input to the architect's architecture + spec + plan.

---

## 12. Open questions for the architect (consolidated)

1. **Branch shape** — node-attribute `decide` vs a decider-carrying edge kind; where the `label`→successor
   mapping lives.
2. **Branch merge** — exclusive-merge (incoming branch-exclusive edges count as one consumption) vs
   arms-must-terminate. This is the one non-mechanical schema change.
3. **Branch artifact** — does a branch node also emit an artifact, or is it a pure router over a
   predecessor's artifact?
4. **Wait event source** — webhook vs poller vs manual resume; timeout semantics; retention of parked
   instances (gate #6).
5. **Trigger** — host cron vs a Praxis scheduler (gate #7); actor binding (gate #3); repeated-trigger
   idempotency (no exactly-once).
6. **Nesting** — depth and cost budget shape; parent/child result threading; fail-closed on exceed
   (gates #4/#8).

---

## 13. Gates this work crosses (stated, not settled)

- **#1 isolation** — branch/wait add routing, not a sandbox; agents keep direct tool access. No isolation
  claim.
- **#2 Pi host seam** — the trigger/resume entrypoints extend the host seam already exercised by the
  prompt hook.
- **#3 trusted identity** — a trigger's/human's actor is **config-trust**, never authenticated here.
- **#4 flow expansion** and **#8 nested budgets** — gate Nesting; it stays disabled until each is opened
  with explicit bounds.
- **#6 durability (retention/migration)** — parking introduces long-lived instances; retention is its
  open question.
- **#7 off-process trigger (P8)** — a scheduled or event trigger is this gate; a plain host cron is the
  minimal pre-gate form.

None of these gates is closed by this brief. Surfacing them is the point; settling them is the owner's.

---

## 14. The one-line summary

> **Flow complexity is finite and lives in the runtime (pay once); task complexity is open-ended and
> lives in the judgment (pay forever).** Flows wire task atoms with six primitives; the one new jev
> decider is the branch router, authored as JSON and run by the builder that already exists; waits,
> triggers and nesting are durable state and host seams, not new judgment; code composes them; Praxis
> preserves everything and fails closed.
