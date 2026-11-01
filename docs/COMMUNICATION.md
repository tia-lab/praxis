# Praxis communication — one node tree for work and organization

> **Status: design brief (design-only). Not authorized to build.** This document proposes unifying
> Manifold's coordination/organization layer *into* Praxis as **one system**, and describes the smallest
> shape that makes it coherent. It authorizes nothing: no code, no schema, no dependency, no `.pi/` change.
> **The unification is under active discussion between the leads and is NOT decided.** Manifold is a separate
> system today, and Praxis's own flow-nesting — the keystone this sketch rests on — is **gated and unbuilt**
> (`docs/FLOWS.md:289-305`; gates #4/#8). Where a claim is about code, it is cited; where it is a proposal,
> it is marked **△ proposed**.

Evidence labels throughout: **[code]** = read in the source at the cited path; **[doc]** = read in a document
at the cited path; **[proposed]** = a design choice, not implemented anywhere.

---

## 0. Purpose and scope

Praxis and Manifold grew the same shape twice. Praxis made **work** a tree of gated steps; Manifold made
**the organization that does the work** a fixed, blueprint-bounded *team*. This brief asks the one design
question that decides whether they can be one system:

> **Can a single recursive NODE be the primitive for both — the unit of work *and* the unit of organization?**

The answer proposed here is yes, with five guardrails that keep "endless" safe. The brief states the model,
the keystone, the guardrails, the unified runtime shape, and what is honestly *not* settled.

**In scope:** the model and the shape, grounded in both repositories' code.
**Out of scope:** any implementation, any migration of an existing Manifold project, any proposal to retire
Manifold today, and any claim that nesting works (it does not).

## 1. What Manifold actually is today (source-cited)

Manifold is not a vibe; it is a specific machine, and every part of it is a decision the tree has to keep or
drop. Five facts, each read from the code at `/home/tia/_DEV/AI/manifold`:

| Fact | Evidence |
| --- | --- |
| **A durable store per (root, project)**, SQLite with WAL *required* | `src/storage/database.ts:60` (`.pi/manifold/state/manifold.sqlite`), `:71-72` (refuses to open unless `journal_mode=wal`), `:76` (metadata pins project + root), `:218` (a project mismatch refuses the store) |
| **A live transport** — NATS, one inbox subject per agent | `src/transport.ts:91` subscribes `manifold.v1.<projectId>.<agentId>.inbox`; `:149` publishes to the recipient's inbox |
| **A durable delivery record** beside the transport | `src/storage/rooms.ts:161` (`INSERT INTO room_deliveries`), `:254` (`processed_at`), `:286` (revision = max rowid) |
| **Launch-injected, non-overridable identity** | `src/types/org.ts:82` rejects any value matching `--manifold-agent`, `--manifold-root` or `--session-dir`; `src/extension.ts:74-75` registers those flags, the root "never selectable by peer messages"; `src/herdr.ts:78-79` injects them at launch |
| **A generation fence on authority** | `src/storage/gate.ts:43` denies with `STALE_POLICY`; `:124-133` re-checks the generation before an external verdict may apply; `:29-31` keeps one message per refusal |

And the part this brief is really about — **the team is a first-class, blueprint-bounded primitive**:

- a blueprint declares the topology and its caps, and a mesh topology is validated against `meshMaxRounds`
  (`src/teams-blueprint.ts:45-77`, `:192`);
- `team.scale` grows or shrinks a team by one member at a time (`src/storage/org/teams.ts:15`, `:34` —
  exactly one of `add`/`remove`);
- a seat is occupied by a live session and cannot be scaled into another team
  (`src/storage/org/teams.ts:58`), and growth spends a seat against a limit (`:63-67`, `src/storage/seats.ts`);
- an assignment walks a **state handshake**: `assigned → reported → finalized → completion_sent →
  completed` — five states, each with exactly one writer in the code (`src/storage/org/assignments.ts:185`
  dispatch writes `assigned`, `:154` report, `:190` finalize, `:202` completion_sent, `:170` completed), the
  four non-terminal ones being ACTIVE (`src/storage/org/core.ts:30`, `src/storage/org/reads.ts:118`,
  `src/storage/org/schema.ts:135`), and only the assigner may finalize
  (`src/storage/org/assignment-reads.ts:30`) — the design notes call this "six-state"; the row has five
  writers, which is the number this brief uses;
- work ownership is enforced by **claims** with a per-assignment cap (`src/storage/org/assignments.ts:37-38`;
  `src/storage/org/schema.ts:76-79`; unreleased claims are counted at `:136`).

**And yet the recursive tree is already latent — on the *assignment* axis.** `assignments` carries a `parent` column (`src/storage/org/assignments.ts:81`), and the parent chain already lets an accountable ancestor read a descendant's phase history (not its transcript). So the node tree this brief proposes is not new machinery: it is **promoting the assignment parent-tree to *be* the org tree, and dissolving the flat `team` into a node** — a view `team` is currently bolted *alongside* rather than built *into*. Both leads, reading the code, agreed this is "promote what is latent," not a rebuild.

**The rigidity is not a bug in any one of those lines; it is the *shape*.** A team is a *type*: it has a
blueprint, a mesh cap, a fixed member set and an occupancy rule. To add a sub-team you must add a *new kind of
thing* — and there is no third kind between "team" and "agent seat". A company does not work like that, and
neither does a large piece of work.

## 2. The one primitive: a node

**△ proposed.** Replace "team" as a first-class type with one recursive primitive:

```text
┌───────────────────────────────────────────────────────────────────────────────┐
│  NODE                                                                        │
│                                                                              │
│  id            one owner of one fact, inside its parent                     │
│  parent?       the node that owns this one (absent = a root)                 │
│  children[]    other nodes this one owns — a node owns nodes, recursively     │
│  kind          what this node IS right now:  task | subflow | org-unit       │
│  ceiling       capabilities = parent ∩ declared (never wider than the parent)│
│  budget        depth, cost, attempts — bounded per expansion                 │
│  identity      the seat/session bound to this node, fenced by generation      │
│  result        a bounded six-key result, upward; never a transcript           │
└───────────────────────────────────────────────────────────────────────────────┘
```

Three consequences follow immediately, and they are the whole point:

1. **Org = a recursive tree.** A node owns child nodes; each child is a node that owns children; no depth is
   special. There is no "team level" and no "division level" — only nodes.
2. **A team is a DERIVED VIEW**, not a stored type: a node whose children happen to be agent **seats**. Ask
   "who is on this team?" and the answer is a query over a subtree, not a row in a `teams` table with a
   blueprint attached.
3. **`team.scale` generalizes to `node.spawn` / `node.retire`** on any node — adding a seat, a sub-unit, or a
   sub-flow is the same operation at a different kind.

## 3. The keystone: one tree, two axes

Praxis already has this tree on the **execution** side. `docs/FLOWS.md` §5.5 describes flow-nesting: a flow
node that is itself a **sub-flow**, run as a child instance whose **six-key result** flows up to the parent —
never its event log or transcript (`docs/FLOWS.md:289-305`). That is gated today (gates #4/#8), and
`NodeSchema` still requires a `task` reference (`src/types/flow.ts:106-115`), so **a node cannot yet be a
sub-flow**.

The keystone is that these are not two trees that need a bridge — **they are the same tree**, with a node
that can take one of three kinds:

```text
                         ONE RECURSIVE NODE TYPE
        ┌──────────────────────────────────────────────────────────────┐
        │                                                              │
        │                        ┌──────────────┐                      │
        │                        │     NODE     │                      │
        │                        └──────┬───────┘                      │
        │              ┌────────────────┼────────────────┐             │
        │              │                │                │             │
        │          ┌───▼────┐      ┌────▼─────┐    ┌─────▼─────┐       │
        │          │  TASK  │      │ SUB-FLOW │    │ ORG UNIT  │       │
        │          │ (leaf) │      │(execution│    │(assignment│       │
        │          │        │      │ subtree) │    │  subtree) │       │
        │          └────────┘      └──────────┘    └───────────┘       │
        │                                                              │
        │   WORK AXIS (how work decomposes)   ORG AXIS (who does it)   │
        │   ─────────────────────────────     ─────────────────────    │
        │   a flow of task atoms              a tree of seats/units    │
        │   a node = a step                   a node = a seat or unit  │
        │   child result feeds the parent     child reports to parent  │
        │                                                              │
        └──────────────────────────────────────────────────────────────┘
             the SAME node, the SAME six-key result, the SAME guardrails
```

The claim, stated once: **a node can be a TASK (leaf work), a SUB-FLOW (execution subtree) or an ORG UNIT
(assignment subtree of seats) — one recursive node type spanning both composition axes.** A flow that needs
a specialist team nests an org-unit node; that unit's work runs as a sub-flow node; both feed **the same
bounded result upward**. There is no seam because there is no second type.

**What is honest here:** the execution half is gated and unbuilt (`docs/FLOWS.md:301-305`; gates #4/#8), and
the org half exists today only inside Manifold's team/assignment model. This is a *keystone*, not a shipped
edge — the brief's job is to show the shape is one shape, not to claim it is built.

## 4. Guardrails: what keeps "endless" safe

Unbounded recursion is only safe if every node is bounded the same way. Five rules, each **per node,
recursively** — and each one already has a precedent in Praxis or Manifold, which is why they are credible
rather than aspirational.

| Guardrail | Rule | Precedent |
| --- | --- | --- |
| **1. Ceiling is an INTERSECTION down the tree** | a child's capabilities ⊆ its parent's; composing never amplifies | Praxis's effective permission is an intersection (project ∩ profile ∩ runtime ∩ flow ∩ step) and its nesting spec says a child never exceeds the parent (`AGENTS.md` product constraints; `docs/FLOWS.md:289-305`) |
| **2. Depth + budget bounds per expansion** | every expansion carries a depth counter and a cost budget; exceeding either fails **closed** | Praxis gate #8 blocks any nested runtime until explicit bounds exist (`ARCHITECTURE.md:584`), with `NEST_DEPTH_EXCEEDED`/`NEST_BUDGET_EXCEEDED` named (`docs/FLOWS.md:409`) |
| **3. One owner per fact, per node** | a fact is owned by exactly one node; a parent reads, never duplicates | Manifold's claims: per-assignment scopes with a cap and a release (`src/storage/org/assignments.ts:37-38`) |
| **4. Identity + fencing per node** | a node acts as exactly one identity, injected at launch, fenced by generation | Manifold: non-overridable flags (`src/types/org.ts:82`), `STALE_POLICY` (`src/storage/gate.ts:43`) |
| **5. Bounded results flow UP** | a parent receives a child's **six-key result**, never its transcript, log or bytes | Praxis's result is exactly six keys (`src/runner/result.ts:16`); the nested-run rule says the same (`docs/FLOWS.md:296-300`) |

The pattern to notice: **four of the five guardrails already exist in one system each.** The unification is
not inventing safety machinery; it is letting every node inherit the rule its own subtree already obeys.

## 5. The message path and the fence

Manifold's message model is two layers, and both survive the unification unchanged in shape: **NATS carries
the live signal, SQLite carries the durable record.** Today the guarantee is: a delivery is written down
(`room_deliveries`), a subscriber is woken on the inbox subject, and `processed_at` is the receipt.

```text
   a peer posts a message
        │
        │  1. durable first            ┌─────────────────────────────────────┐
        └─────────────────────────────►│ SQLITE  (one store per project)     │
                                       │  messages ── room_deliveries        │
                                       │  processed_at = the receipt         │
                                       │  revision   = MAX(rowid)            │
                                       └───────────────┬─────────────────────┘
                                                       │
                                      2. live wake-up  │  publish
                                                       ▼
                              ┌──────────────────────────────────────────────┐
                              │ NATS   manifold.v1.<project>.<agent>.inbox   │
                              └──────────────────────┬───────────────────────┘
                                                     │  3. the agent's session reads
                                                     ▼
                              ┌──────────────────────────────────────────────┐
                              │ SESSION   identity injected at launch        │
                              │  agentId + attemptId + sessionId (binding)   │
                              │  ── act ──►  GATE                            │
                              │             4. generation fence:             │
                              │                basis == active ? act : DENY  │
                              │                (STALE_POLICY)                │
                              └──────────────────────────────────────────────┘
```

In the unified system the fence stops being a Manifold-only concern and becomes **a first-class gate stage**
inside Praxis, in the same ladder as the deterministic gate and the quality gate
(`src/runner/step.ts:320`): *who is acting, under which generation, with which ceiling* — checked before any
write, exactly as the pin check and the capability ceiling already are.

## 6. The recursive tree, drawn plainly

```text
  root (project)
   │
   ├── org-unit "support"                    ← a NODE that owns children
   │    ├── seat  analyst-1                  ← a NODE whose child is a session
   │    ├── seat  analyst-2
   │    └── org-unit "billing"               ← nesting is the SAME operation
   │         └── seat  billing-lead
   │
   ├── sub-flow "inbox-triage"               ← a NODE that is an execution subtree
   │    ├── task "triage"                    ← a leaf: work with a rubric
   │    ├── task "reply"
   │    └── sub-flow "refund-check"          ← an execution subtree inside a subtree
   │         └── task "lookup"
   │
   └── task "quarterly-close"                ← a leaf at the root

  A "TEAM" is a DERIVED VIEW, not a stored type:
     team(support) = { n ∈ subtree(support) : n.kind = seat }
     → analyst-1, analyst-2                       (two nodes, one query)
```

What a "team" stops needing: a `teams` table with a blueprint, a mesh cap and an occupancy rule held *as the
definition of the thing*. What it keeps: a **cap** (budget, rule 2), an **occupancy** check (identity, rule 4)
and a **membership** query (derived, rule 3). The rigidity moves from the *type* to the *bounds* — which is
where every other guardrail already lives.

## 7. The unified shape (△ proposed)

```text
┌────────────────────────────────────────────────────────────────────────────────────┐
│  ONE PRAXIS                                                                       │
│                                                                                   │
│   ┌──────────────────────┐   ┌───────────────────────┐   ┌──────────────────────┐  │
│   │ WORK store (SQLite)  │   │ ORG/MESSAGE store     │   │ NATS (live transport)│  │
│   │ instances, pins,     │   │ nodes, seats, claims, │   │ inbox per node;      │  │
│   │ artifacts, events    │   │ assignments, messages │   │ the durable record   │  │
│   │ (praxis.store/v2)    │   │ (ported from Manifold)│   │ stays in SQLite      │  │
│   └──────────┬───────────┘   └───────────┬───────────┘   └──────────┬───────────┘  │
│              │                           │                          │              │
│              └───────────────┬───────────┴──────────────────────────┘              │
│                              ▼                                                     │
│   ┌────────────────────────────────────────────────────────────────────────────┐   │
│   │ GATES, in order:  identity+fence → ceiling (∩ down) → pins → section gate  │   │
│   │                   → quality gate → budget/depth → bounded result UP            │   │
│   └────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                   │
│   DISPATCH is event-driven, not a state handshake:  a node's completion            │
│   IS the event that readies its dependents (the same way a flow edge already       │
│   readies the next node).  node.spawn / node.retire replace team.scale.            │
└────────────────────────────────────────────────────────────────────────────────────┘
```

Read it as five concrete moves:

1. **Two SQLite stores, one process**: the durable WORK store Praxis already has, and the ORG/MESSAGE store
   ported from Manifold. Two files, two owners of two different facts — not two systems.
2. **NATS stays the live transport**, because a live wake-up and a durable record are different facts.
3. **Identity is ported, closing Praxis gate #3**: the launch-injected, non-overridable binding
   (`agentId, attemptId, sessionId`) becomes the identity source Praxis has been missing.
4. **The fence becomes a gate stage**: `STALE_POLICY` is not an org-layer courtesy; it is checked like every
   other refusal, before any write.
5. **Native dispatch replaces the handshake**: the state handshake exists today to *model* readiness and
   completion over a store that has no event spine (`assigned → reported → finalized → completion_sent →
   completed`, `src/storage/org/assignments.ts:154-202`).
   A node tree with an event log does not need the handshake — a child's completion is the event that readies
   its dependents, and `node.spawn`/`node.retire` replace `team.scale`.

### The shift, drawn

The whole change in one picture — a rigid linear pipeline over a fixed team becomes a recursive, elastic node:

```text
  MANIFOLD TODAY (rigid, linear)      PRAXIS-COM (recursive, elastic)
  ──────────────────────────────     ───────────────────────────────────
  Declare team                        Work arrives
       │                                   │
       ▼                              ┌─ NODE ──────────────────────────┐
  Allocate seats                      │  ├── spawn task (leaf)          │
       │                             │  ├── spawn sub-flow             │
       ▼                              │  ├── spawn specialist node      │
  Assign agents                       │  ├── delegate to existing actor │
       │                             │  └── collect & evaluate results │
       ▼                              └───────────────┬─────────────────┘
  Coordinate messages                         more work needed?
       │                               ├── yes → expand within budget
       ▼                               └── no  → retire unused capacity
  Execute work
       │
       ▼
  Collect results
```

The left is a fixed sequence over a fixed team. The right is **one node deciding**, within its ceiling and budget, how to meet the work — spawn, delegate, evaluate, then expand or retire — and the same node shape repeats at **every level** of the tree.

### Day-one correctness — the load-bearing transfers

The recursive machinery already exists (the assignment parent-tree; project-global, parent-aware fencing), and a second Manifold engineer independently re-derived all six load-bearing claims from source at HEAD `bc17fbd` (read-only) — all confirmed. **The invariant under all four transfers is the transaction shape:** every authority-moving op does read → check → write inside ONE `BEGIN IMMEDIATE` in the mutable org/message DB, and an authority decision is NEVER a projection of the append-only work log (verified: Manifold's `mutate()` runs its effect inside `gateTransaction → BEGIN IMMEDIATE/COMMIT`, and a denial rolls the whole mutation back). That rule is what makes all four *enforcement* rather than convention. Four transfers must then be right from the first commit, or the tree has a hole:

1. **work→org dispatch as a transactional outbox.** The hand-off that crosses the two stores runs on *every* step completion, so it breaks first by **frequency**: a durable intent then an idempotent apply, never a write held across both DBs (the no-transaction-across-an-external-call rule).
2. **a liveness lease + sweeper for crash-reclaim, cascading down the subtree.** This replaces Manifold's per-phase deadline/attempt-release. A dead org-unit node must **re-home** its descendants' work, or one dead node silently strands its whole subtree — the sharpest *new* risk the tree adds.
3. **the generation classifier made subtree-aware.** The fence *mechanism* composes across tree levels AS-IS — one project-wide generation counter (metadata singleton, each rebind `fromGeneration+1`) and per-agent fences (`PRIMARY KEY(generation, agent)`), parent-aware because the classifier diffs the whole agent declaration including `parentId`. But keeping fencing **scoped** on a deep tree still requires this item: the classifier reasons about *direct* membership, so a deep-node change falls back to the safe-but-coarse rule (fence everyone). State it as one truth: the mechanism composes as-is; scoped fencing on depth IS this transfer — the two are only consistent read together.
4. **the intersection ceiling as a running min down the ancestor chain, at every spawn.** Today the cap is a two-level `Math.min`; for arbitrary depth a node's effective cap is `min(own, parent-effective)` enforced at **every** level, or a deep node exceeds an ancestor's ceiling the moment depth > 1. This is guardrail 1, made recursive.
5. **an explicit identity-uniqueness check at load/bind.** Manifold's identity is launch-injected and non-overridable (the schema rejects the identity flags from peer text), and one-live-attempt-per-agent is enforced by a `live_attempt` index — but verification found NO loader rejects a duplicate agent id: today uniqueness is the index *plus convention*, not an explicit dedup. When Praxis-com OWNS identity, add the explicit check at load/bind; do not inherit the index-plus-convention reliance — it is exactly the kind of implicit guarantee that silently weakens on a port.

**Lock and provenance.** Both leads sign this as the joint recommendation. The Manifold / org-assignment axis was independently verified at HEAD `bc17fbd` by a second Manifold engineer (read-only, nothing run); the Praxis flow-execution axis is grounded by the Praxis lead. Each lead grounds their own side; the "one node type across both axes" is the shared goal that joins them, sound as a goal and to be proven per-axis as it is built.

## 8. Built vs proposed — the honest table

| Piece | State today | Evidence |
| --- | --- | --- |
| Praxis WORK store, pins, gate, six-key result | **built** | `src/store/db.ts`, `src/runner/step.ts:320`, `src/runner/result.ts:16` |
| profiles composed into the system prompt | **built** | `src/pi/prompt-hook.ts:103`, `src/runner/engine/prompt.ts:97` |
| flow-nesting (node = sub-flow) | **gated, unbuilt** | `docs/FLOWS.md:289-305`; a node still requires a `task` (`src/types/flow.ts:106-115`) |
| the org tree, seats, claims, assignments | **built — inside Manifold, as a separate system** | `src/storage/org/*`, `src/types/org.ts:82`, `src/storage/gate.ts:43` |
| one node type spanning both axes | **△ proposed** | this brief, §2-§3 |
| identity ported into Praxis (closing gate #3) | **△ proposed** | §7 move 3 |
| native event-driven dispatch replacing the handshake | **△ proposed** | §7 move 5 |
| `node.spawn`/`node.retire` replacing `team.scale` | **△ proposed** | §2 consequence 3 |

## 9. What this brief does NOT claim

- **Not decided.** The unification is under discussion; this brief is an argument, not a plan.
- **Not built.** Flow-nesting is gated (`docs/FLOWS.md:301-305`); nothing here changes that.
- **No isolation, no trusted identity, no exactly-once.** Manifold's identity is launch-injected and fenced,
  which is stronger than Praxis's config-trust today — and still not a proof of *who* an agent is. Gates #1
  and #3 remain open until the owner closes them.
- **No migration.** What happens to a live Manifold project with running attempts, seats and claims is an
  open question (`src/storage/org/schema.ts:135` already counts the active set), not something a diagram
  settles.
- **No new authority.** A node tree does not let an agent grant itself a ceilling: the intersection rule
  (guardrail 1) is what makes the tree safe, and it is checked in code today for the execution axis.

## 10. Open questions for the owner

1. **Where does the org store live** — a second SQLite file beside the work store, or the same file with a
   second schema? (Two files keep two owners; one file keeps one transaction boundary.)
2. **Does a seat own work, or does work own a seat?** Today an assignment names an assignee. In the tree, a
   node is the owner and a seat is a child — which flips the direction of the query.
3. **What is the depth bound**, and who sets it: per project, per root, or per expansion?
4. **Does the fence survive a tree?** A generation pinned at the root must still mean something at depth 7;
   either it is inherited (one rule) or re-derived (two owners).
5. **What replaces the handshake's *audit* value?** The five states are also a readable history; an event log
   is a better one, but the owner should say so explicitly rather than inherit it.
6. **Do we port, or do we re-implement?** Manifold's gate, claims and seats are tested code; the tree may be
   a smaller re-statement of them — a decision about risk, not elegance.

## 11. The one-line summary

> **A node is the primitive; the organization is a recursive tree of nodes; a team is a derived view of a
> subtree; and the execution tree Praxis already sketched and the organization tree Manifold already runs are
> the same tree — bounded at every node by an intersected ceiling, a depth and cost budget, one owner per
> fact, one fenced identity, and a six-key result flowing up.**
