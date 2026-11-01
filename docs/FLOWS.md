# Flows in Praxis

> **Status: design explainer.** This document describes the flow engine that exists today
> (`praxis.flow/v2`) and the controls that are _proposed_ to complete it. Proposed controls are
> marked **△ proposed** and are **not authorized to build** — they are design, surfaced for the owner.
> See [vision.md](vision.md) §12–§13 for sequencing and the open gates, and [AGENTS.md](../AGENTS.md)
> for what is authorized.

---

## 1. What a flow is, in one sentence

> **A task is a unit of work with a _dynamic goal_. A flow is a _fixed control-flow shape_ over
> task invocations. The flow never reasons — it routes. When a route must be chosen, the flow
> asks a _decider_ and records the answer.**

The single most important distinction:

|               | **task**                                   | **flow**                       |
| ------------- | ------------------------------------------ | ------------------------------ |
| answers       | **“what” + “how good”**                    | **“in what order”**            |
| nature        | open, domain-specific, **refined forever** | finite, closed, **built once** |
| carries       | goal, rubric, gate, scoring                | nodes + edges                  |
| the hard part | _judging_ the work                         | _routing_ the work             |
| analogy       | atom                                       | molecule                       |

One `delivery` flow runs ten thousand different goals through the **same** preserved, gated, durable
execution. The goal is injected per instance; the shape is reused. That reuse is the whole leverage of
tasks-as-atoms and flows-as-shape.

---

## 2. How tasks are integrated into a flow

A task is **never defined inside the flow that uses it** (decision D1). A flow references task atoms by
identity and wires them:

```jsonc
// praxis.flow/v2 (simplified)
{
  "schema": "praxis.flow/v2",
  "flow": "flows/delivery",
  "nodes": [ { "id": "architect", "task": "tasks/design/spec" }, ... ],  // 1..16, a node is JUST a reference
  "edges": [ { "kind": "data", "from": "architect", "to": "plan" }, ... ], // 0..32
  "result": "..."
}
```

- **A node owns nothing but a reference** — `{ id, task }`. The _task_ owns the work, the statement, the
  rubric and the gate. The _flow_ owns the wiring. There is no `onRefuse` or `consumes` on a task; the
  **edges carry those facts**.
- **An instance pins the task definitions it ran under** (decision: publication keyed by `(path, version)`).
  A later rubric edit does not retroactively change a finished run.
- **A review binds to the digest of the artifact it judged** (D2), not to files on disk.

So integration is by _reference + version pin_: the flow composes atoms it does not own, and every run
records exactly which atom versions it executed.

---

## 3. The control-flow algebra — six primitives

Everything a flow can express reduces to six primitives. **Three exist today; three are proposed.**

| #   | primitive                                | meaning                                                          | status     |
| --- | ---------------------------------------- | ---------------------------------------------------------------- | ---------- |
| 1   | **sequence** (`data` edge)               | do A, then B with A’s output                                     | ✅ exists  |
| 2   | **join** (`join` edges)                  | B waits for A₁…Aₙ, consumes all (fan-in)                         | ✅ exists  |
| 3   | **loop** (`refuse` edge + gate, bounded) | a higher node sends work _back_; repeat until the gate passes    | ✅ exists  |
| 4   | **branch**                               | a typed decision picks _one_ of N successors                     | △ proposed |
| 5   | **wait**                                 | park until an external event (email, timer, reply, another flow) | △ proposed |
| 6   | **human node**                           | an interactive turn that emits a gated artifact                  | △ proposed |

### What exists today (`praxis.flow/v2`)

The engine declares nodes in execution order and supports three edge kinds:

- **`data`** — a hand-off from a lower node to a higher one (sequence).
- **`join`** — two or more sources into one node, one consumption carrying several inputs (fan-in).
- **`refuse`** — from a higher node _back_ to a lower one. A refusal is **evidence, not instance death**:
  it returns work to the subject node, bounded by a declared `onFailure` policy (`escalate` / `continue`).

**The review loop already works.** “Review, pass only when approved” is a `refuse` edge from the reviewer
back to the subject, and **the quality gate is the “only-when-approved” decider** (per-dimension bar,
pure-AND). That is the loop we run for architecture, plan and code today.

---

## 3a. Domain — the dynamic, system-level conduct lens

> **Status: authorized, building (2026-11-01).** Implemented as a 1:1 mirror of the shipped task-rules
> path. Conduct and role (the agent's fixed identity) are NOT part of it — see Path A.

A profile has three layers — `conduct` (occam), `role` (e.g. engineer), `domain` (e.g. code, quant,
data). The first two are the agent's **fixed identity**, loaded once at system level. The **domain** is
the one dynamic layer:

```jsonc
// a node gains an optional, flow-relative domain list
{ "id": "build", "task": "tasks/build/implement", "domains": ["code", "data"] }
// a flow may set a default the nodes inherit
{ "schema": "praxis.flow/v2", "flow": "flows/delivery", "domains": ["code"], "nodes": [ /* … */ ] }
```

- **Declared on the flow node, never on the task atom.** The task stays domain-agnostic so it is reusable;
  the node says which lens this _use_ of it runs under. A node's `domains` overrides the flow default.
- **Resolved at `op=start`, union-composed, pinned.** Each listed domain profile is read, their
  `invariants`/`prefer`/`avoid` are unioned into one block, and the exact bytes + digest are pinned to the
  instance as `profile` definition rows — a later edit never changes a finished or running step.
- **Injected at system level into the step brief (`the composed system prompt`), beside the agent's occam + role identity.**
  No domains ⇒ no `the composed system prompt` ⇒ existing flows behave byte-identically.
- **Fail closed.** An unknown or invalid domain ref is a typed `PROFILE_NOT_FOUND` / `PROFILE_INVALID`
  before any write.

**Path A (locked):** Praxis injects the **domain** only; `conduct` + `role` are the agent's identity
(Occam/Manifold). Praxis composing conduct + role per step would need a per-step role source (gate #2) and
is out of scope.

---

## 4. How Jev is used — small typed decisions _inside_ the complex pieces

Praxis does not make a complex judgment in one fuzzy step. **A complex judgment is a lattice of small,
crisp, typed questions — each one Jev call — composed by code, never by more generation.**

Three Jev answer types are the atoms of decision:

```
noul   -> its probability           (how true / yes-no)
score  -> position / (levels - 1)   (which level)
choice -> 1 iff the clean option    (which category)
```

### The quality gate is already built this way (`src/quality/jev-scorer.ts`)

> _“A dimension that declares criteria is COMPOSED from them: one question per criterion, in the same
> request.”_

- Each **criterion** the task author wrote is **one small typed Jev question**.
- Code — not generation — composes them: a dimension’s score is the **MIN** over its criteria; the gate is
  the **AND** over dimensions; the bar is the learned threshold on that number.
- _“No domain logic lives in this file beyond the reading and the arithmetic.”_ **Jev makes the judgment;
  Praxis owns the composition and the record.**

### The alignment gate is the same shape at one question (`src/quality/jev-align.ts`)

One `choice` keyed `alignment` (aligned / misaligned) over the incoming order and the pinned task anchor.
A proposed **branch** node (primitive #4) is the identical mechanism: one `choice`, and Praxis records
which edge it selected.

### The same pattern at three scales

| complex piece                                 | small Jevs encoded inside            | composed by          | status     |
| --------------------------------------------- | ------------------------------------ | -------------------- | ---------- |
| “is this work good?” (task gate)              | one typed question **per criterion** | MIN → AND → bar      | ✅ exists  |
| “does this order belong to the task?”         | one `choice`                         | pass / soft / refuse | ✅ exists  |
| “answer \| delete \| escalate?” (flow branch) | one `choice`                         | picks the edge       | △ proposed |

### Four responsibilities, never smeared together

- **Generation (the LLM agent)** does the _work_ — writes the spec, the code.
- **Typed Jev** does the _judging and routing_ — scores a criterion, picks a branch.
- **Code** does the _composing_ — MIN, AND, the bar, the edge selection.
- **Praxis** does the _preserving_ — records every decision durably, fails closed.

The task author’s real craft is **writing good small questions** (the probes/criteria). That is where
domain complexity lives; the composition above it is trivial arithmetic.

---

## 5. What is missing as controls

Three primitives complete the “endless construction” of flows. They differ sharply in cost.

### △ #4 Branch — choose one successor by a typed decision

- **What:** after node A, a decider selects exactly one of `{B, C, D}`. The decider is a **Jev `choice`**
  over A’s output (or a gate verdict, or an external signal).
- **Cost:** low — the Jev adapter and the one-`choice` pattern already exist (`jev-align.ts`).
- **Must:** the chosen edge is recorded as a **durable event**; an unavailable Jev yields a **named
  blocker, never a guessed edge** (fail-closed).
- **Open shape question:** a new **edge kind** (`choice`, naming its decider) vs a **node attribute**
  (“this node branches by this decision”).

### △ #5 Wait — park until an external event

- **What:** the flow suspends until something outside happens — an email arrives, a timer fires, a human
  replies, another flow signals.
- **Cost:** **high.** This needs _durable parking_ plus a _resume trigger_ (poller? webhook? manual
  resume?). It is exactly the vision’s open **“off-process trigger / external events” gate** (§13) and the
  **nested-execution / long-lived-suspension** concerns. **A real design decision with real cost — not
  free, and not authorized.**

### △ #6 Human node — an interactive turn that emits a gated artifact

- **What:** the “iterative me-and-you definition” step — a node whose actor is a human, producing an
  artifact (the aligned definition) that gates like any other.
- **Open question:** is the human turn **inside** the flow (captured as a gated artifact) or **outside** it,
  upstream of the flow? Identity of the human actor comes from a **Pi/Manifold binding, never a request
  field** (vision boundary).

---

## 6. Two worked examples

### Delivery — what we run now (sequence + loop)

```text
[△define] --data--> architect <--refuse(gate)--> review
                      |
                    data
                      v
                     plan   <--refuse(gate)--> review
                      |
                    data
                      v
                     code   <--refuse(gate)--> review --data--> close
```

- **Dynamic goal, fixed shape:** the goal differs every instance; the wiring never does.
- `define` is the △ human node (iterative owner + assistant). Everything else exists today: `data`
  sequence + `refuse` loops, each loop gated by the per-dimension quality bar.

### Inbox — a completely different shape (branch + wait)

```text
[△wait: email arrives] --data--> classify --△choice--> { answer | delete | escalate }
                                                          |
                                              answer --△wait: external reply--> ...
```

- `classify` is one **Jev `choice`**; Praxis records the chosen edge.
- `wait` nodes (arrival, reply) are the hard, build-once suspension primitive.

**A small catalogue of shapes × an open set of goals = unbounded real work, with the same durable,
gated, preserved spine every time.**

---

## 7. Nesting — and the ceiling

A flow node may reference a **sub-flow** instead of a task. Composition then bottoms out in task atoms,
and a logical unit of work can be **decomposed into a tree of flows** — e.g. `implement` expanding into
`code → test → review`.

### It reuses everything — no new concept

Sub-flows invent **no new primitive, no new edge kind, no new store, no new control-flow idea**:

- the edges (`data` / `join` / `refuse`) are unchanged;
- the leaves are still task atoms;
- the engine already starts and advances instances — a sub-flow is just *another instance*, so nesting is
  **the engine calling itself** with a child;
- the **bounded-result contract** is the same one the Pi integration already uses — a child returns its
  six-key result up to the parent node, **never its event log or transcript**.

### What it adds — minimal and additive

Today a node is strictly a task reference (`NodeSchema = { id, task }`). Sub-flows need only:

1. **a node may reference a flow, not only a task** — a small schema union (`task` *or* `flow`);
2. **a nested-run path** — the engine runs that reference as a child instance and feeds its bounded
   result into the parent’s outgoing edge;
3. **a depth + budget bound** — the one genuinely new decision.

### It is gated, not free

Nested execution is two of the open gates in [vision.md](vision.md) §13 — **flow-expansion authority** and
**nested-execution depth + budgets**. Recursive flows stay **disabled** until an authorized unit enables
them **with explicit depth and cost bounds**, failing closed when exceeded. The composition is free; the
*limit* is the thing you must decide, because a tree is otherwise infinite. **△ proposed / gated / not authorized.**

### Nesting is the ceiling — Praxis does not scale higher

**This is the top of Praxis’s control-flow composition. There is no layer above flows inside Praxis, and
there is never a “super-flow” that coordinates independent flows.** The three shapes, and where each lives:

| shape | what it is | whose job |
|---|---|---|
| inside one flow | a bounded **DAG** (`data` + `join` + `refuse`) | **Praxis** ✅ |
| a flow of sub-flows | a **tree**, bottoming in task atoms | **Praxis** △ gated |
| many independent flows | **not a flow** — an assignment graph + shared durable facts | **Manifold** (assign) + **Jung** (synthesize) |

Coordinating *independent* units of work is **assignment + shared facts**, never a bigger control-flow graph:

- **assign** independent flows to agents → **Manifold**;
- **relate** their outcomes → through **bounded results + references in the store** (a parent reads a
  child’s result, never its transcript);
- **synthesize** across projects → **Jung** (does not exist yet — a *named blocker*, never faked).

The moment a “bigger order” starts assigning work to agents, it has **rebuilt Manifold inside Praxis** and
made Praxis a *team manager* — which [vision.md](vision.md) explicitly forbids (*“Praxis MUST NOT become a
reasoning engine, team manager, or federated memory authority”*). So: **compose downward into sub-flows
(gated); never grow a coordinator upward.**

---

## 8. The boundaries that keep flows honest

- **Flows route; they never reason.** The moment a flow “thinks,” the hard problem has smeared across the
  easy one. All intelligence lives in the task’s agent and in the deciders (gate / Jev / event / human).
- **One authoritative owner per fact.** Praxis records _which_ decision fired; Jev owns the _judgment_;
  the task owns _what good means_. No competing copies.
- **Fail closed.** An unavailable decider, a missing answer, a stale pin → a typed, named blocker — never a
  fabricated score or a guessed edge.
- **Jev is an optional adapter behind the broker**, never the durability authority. The durable store is
  the Praxis spine.
- **Completion is acceptance, not a green call.** A schema-valid artifact is not a done task; the gate
  and the owner decide.

---

## 9. The one-line summary

> **Flow complexity is finite and lives in the runtime (pay once). Task complexity is open-ended and
> lives in the judgment (pay forever).** Flows wire task atoms with six primitives; small typed Jev
> decisions are encoded inside the complex pieces; code composes them; Praxis preserves everything.
