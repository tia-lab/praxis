# Praxis

Praxis is a composable, persistent, out-of-context **work runtime** inside Pi. An authorized
agent invokes a named **flow**; Praxis creates a durable work instance, gates it through
validated steps, judges each step's artifact against a learning quality standard, records the
experience, and returns a bounded result to the caller. One local SQLite database owns the
durable state, and one native `praxis` tool is the whole agent surface.

Praxis is the **Molecule** in a four-layer split: **Manifold assigns · Occam reasons · Praxis
executes and preserves work · Jung synthesizes.** It deliberately does not reason, manage teams,
or hold federated memory.

> **Status: design and bootstrap.** The durable engine, step runner, artifact validation, the
> Pi tool, the flow/task library and the quality-and-learning engine are built and tested; the
> isolation, trusted-identity, flow-expansion, retention/migration, maintenance and
> nested-budget gates in [`docs/vision.md` §13](docs/vision.md) are open. See
> [Current limits](#current-limits).

## Index

- [What This Is](#what-this-is)
- [What This Is Not](#what-this-is-not)
- [Core Conventions](#core-conventions)
- [The praxis tool](#the-praxis-tool)
- [Flows and tasks](#flows-and-tasks)
- [Quality bars and learning](#quality-bars-and-learning)
- [Configuration](#configuration)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Current limits](#current-limits)
- [What not to infer](#what-not-to-infer)
- [Development commands](#development-commands)
- [Further reading](#further-reading)

## What This Is

Praxis provides:

- a durable **instance state machine** over an append-only SQLite event log: a flow instance
  survives turns, compaction and restarts, and resuming re-opens the same instance;
- a native `praxis` tool with five flow operations (`start`, `check`, `submit`, `note`, `read`)
  and optional issue reporting, over one JSON argument surface;
- **tasks as atoms and flows as molecules**: a task is one gated artifact with a typed section
  contract; a flow composes tasks with `data`, `join` and `refuse` edges; a review binds the
  digest of the artifact it judged;
- **structured step artifacts** validated against per-task schemas before a step can advance, with
  canonical digests and provenance (`consumes`, `derivedFrom`, `subject`) carried in the brief;
- a **quality ratchet that learns**: per-dimension and global-mean bars that rise with proven
  competence, a compound acceptance gate, warmup, flagged near-misses, learning notes and recall
  steering (see [Quality bars and learning](#quality-bars-and-learning));
- a **jev alignment gate** on `op=start`: a typed judgment of whether the incoming order belongs
  to the task the flow will run — routing hygiene that refuses a misaligned order and proceeds
  (flagged) when the judge is unavailable;
- a **compact parent result**: the caller sees six keys — instance id, flow, status, accepted
  artifacts, a summary and the next action — never the internal event log or transcript.

## What This Is Not

Praxis is not an OS sandbox, an authenticated multi-user service, a reasoning engine, a team
manager, or a federated-memory authority. It does not claim exactly-once external execution or
sandbox isolation. Its tool checks constrain only calls **routed through the tool**: an agent
with direct shell or Fabric access bypasses them. The quality judge is a model and can be wrong;
the gate narrows and ratchets work, it does not certify it. A passing test suite is evidence, not
owner acceptance.

## Core Conventions

- **SQLite owns durable state.** The store is an append-only event log; historical evidence is
  immutable and a new interpretation is a new record, never an edit.
- **One authoritative owner per fact.** The Praxis store is separate from Manifold's assignment
  authority and Occam's cognitive traces; it never keeps a competing copy of either.
- **Every call carries an explicit `op`; reads never mutate.** `check` is a free dry run that
  records nothing; `submit` advances exactly one step or refuses.
- **Idempotent entry.** `start` with the same flow and request id re-opens the same instance;
  a different session using that request id is refused. Re-calling `start` is how you resume.
- **Durable intent → external op → observed result → durable receipt.** A store write transaction
  is never held across an external call.
- **Fail closed with a typed reason.** Unknown names are invalid; unauthorized known names are
  denied; missing, stale or unauthorized state fails closed with a code from a single closed
  taxonomy mirrored into the tool surface so the two cannot drift.
- **Completion is acceptance, not a green build.** A schema-valid artifact is not a complete
  task; the owner accepts the artifact against the task statement.

## The praxis tool

One tool, `praxis`, one JSON argument object per call:

| op       | requires                     | returns                                                                                        |
| -------- | ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `start`  | `flow`, `requestId`, `order` | the six-key result, the current step descriptor, and the nonce; opens or re-opens the instance |
| `check`  | `instance`, `artifact`       | `{ ok, missing[], step }` — a dry run against the section contract; records nothing            |
| `submit` | `instance`, `artifact`       | advances exactly one step, or refuses with a typed code and detail                             |
| `note`   | `instance`, `subjective`     | records the step's learning note and closes the step                                           |
| `read`   | `instance`, `step`           | one recorded artifact, only when the step grants the read                                      |

Optional `issue.template` / `issue.open` file a structured report about Praxis itself when the
project enables issue reporting. The step descriptor carries where the agent is (`steps`), the
work (`brief`: goal, produced schema, section contract, provenance) and the judging standard and
recall (`brief.quality`). The whole agent-facing loop is taught by the runtime-injected
[`praxis` skill](.pi/skills/praxis/SKILL.md); an agent needs no source to run a step.

## Flows and tasks

Tasks live under `.pi/praxis/tasks/` as atoms grouped by phase, and flows compose them under
`.pi/praxis/flows/`:

```
tasks/  discovery/ research reproduce assess   design/ spec plan plan-lite
        build/     implement patch refactor    verify/ verify review review-lite
flows/engineering/
  feature    research → spec → plan → implement → verify → review   (refuse: review → plan)
  bugfix     reproduce → spec → plan → patch → verify → review        (refuse: review → plan)
  fix        reproduce → plan-lite → patch → review-lite               (refuse: review → plan)
  refactor   assess → plan-lite → refactor → review                    (refuse: review → plan)
```

Weight scales with the work: `feature` chains six atoms with the full `plan` and `review`; `fix`
chains four with the lite variants. Every flow loops a failed review back to planning. Each
`review` binds its subject and consumes exactly one predecessor, so the judged digest is
well-defined.

## Quality bars and learning

Every step's artifact is scored on the task's rubric **dimensions** (e.g. `grounded`,
`covers-question`, `honest-uncertainty`), each in `[0, 1]`. Acceptance combines those scores
against learned **bars** by one rule in one place (`compoundDecision`, `src/quality/bar.ts`), so
the scorer, the gate and the audit cannot drift.

**The acceptance test — exact.** Let `score_d` be a dimension's score, `bar_d` its bar (its own
per-dimension bar, or the global bar if it has none yet), `global` the global bar, `mean` the
arithmetic mean of all the dimension scores, and `paretoThreshold` the task's Pareto point (the
code default is `0.8`). The gate compares against the **capped effective bar**,
`effBar_d = min(bar_d, paretoThreshold)`, and the capped global bar, `min(global, paretoThreshold)`.
With `DIMENSION_TOLERANCE = 0.05`:

| dimension outcome | condition |
| --- | --- |
| **refused** (hard fail) | `score_d < effBar_d − 0.05` |
| **flagged** (passes, owes a lesson) | `effBar_d − 0.05 ≤ score_d < effBar_d` |
| **clean** | `score_d ≥ effBar_d` |

```
PASS  ⇺  (no dimension refused)  AND  (mean ≥ min(global, paretoThreshold))
```

So **each dimension is gated against its own (capped) bar within a 5% band**, *and* the **mean must
clear the (capped) global bar with no tolerance**. Above the Pareto point the gate stops tightening:
a learned bar may sit higher than `paretoThreshold` and the run is still accepted, so a good run is
never refused merely because the ratchet climbed. The reported headline score is the MIN dimension;
it is not part of the pass rule.

**A criterion that must be graded is authored as a `score` criterion.** A `score` has ordered levels,
so its answer keeps the position on that scale; a `choice` collapses the judge's distribution into
one key and cannot express a degree. This is an authoring rule, not a code rule: nothing forbids a
`choice` criterion, and no schema field can grade one. Praxis does record the distribution it was
given — `pClean`, `pTop` and `spread` per criterion, the `torn` set when a judgment sat near the
judge's own boundary — but that is **disclosure only**: it never enters the score, the mean, the
decision or a bar.

**What each bar tracks.** Bars are engine-computed folds of `bar.raised` events over the
append-only log — never set by the agent. There is one **global** scope (keyed by the rubric's
composition) and one scope **per dimension** (keyed by the dimension id plus its **criteria** when
the dimension is composed from criteria, or plus its statement when it is not: editing a criterion
re-warms that dimension's bar, while rewording the prose of a composed dimension changes nothing).
Per **genuine pass** (an `artifact.accepted` whose verdict at that version was `pass`) each scope
records one value:

- **global** ← the **mean** of that pass's dimension scores;
- **a dimension** ← **that dimension's own** score.

Seeds: the global bar starts at the task's `quality.threshold`, each dimension at its
`dimension.floor`, and the gate's cap at the task's `quality.paretoThreshold` (**default `0.8`**) —
the Pareto / good-enough point. Once the mean reaches it and every dimension is inside its (capped)
band, the run is accepted even though the EMA ratchet may have climbed the bar higher; the ratchet
still **records** the true level (option A), only the gate is capped.

**The ratchet — exact (9-period EMA of the earned level, every scope).** For each scope, over its
genuine-pass values in log order, with `N = 9` and `α = 2/(N+1) = 0.2`:

```
ema₁ = v₁
emaₜ = 0.2·vₜ + 0.8·emaₜ₋₁
to   = round4( min(0.9, current + min(0.05, max(0, ema − current))) )
```

A raise is recorded only when `to > current` **and** `ema − current ≥ 0.01`. Equivalently the
effective bar is **`max(current, EMA)`**, approached in steps of at most **0.05** and ignored when
the gap is under **0.01**. A dip (`ema < current`) records nothing — the bar **never auto-lowers**.
A raise is still gated by **warmup** (≥ 10 observations of the scope), **cooldown** (≥ 5 genuine
passes since that scope's last raise), an **effort gate** (mean attempts ≤ 2) and the **ceiling**
`0.9`; each raise records the EMA that
decided it under formula id `praxis.bar.ema/v3`, so replaying the log yields the same bars.

So each dimension's bar tracks the **smoothed mean level of that dimension's own passing scores**
(gated ±5%), and the global bar tracks the smoothed mean of the dimension means — standards
tighten per dimension as a task's history grows, adding a rubric dimension warms only it, and
rewording one resets only that dimension.

**Learning.** When a step passes, the agent owes a **learning note**, and the gate requires a
lesson for every flagged dimension. The next instance's **recall** surfaces the weak set and the
prior lessons, so a shortfall on one run steers the next. This is Praxis's execution experience
(P7), not Occam's cognition: it judges whether work meets the standard and records the lesson, it
does not reason.

**Recall — exact (two stages, one cached jev call).** `op=recall` and the refusal feedback rank
this project's solved cases in two stages. **Stage 1** is deterministic and unchanged: the cases
are ordered by the brief's own relevance scorer and cut to **20 candidates** (`JEV_POOL`). **Stage
2** is ONE pi-jev `evaluate` call over those candidates — one `score` question each, fields clipped
to **240 characters** (`JEV_CLIP`) — asking how much *new* guidance each case adds; the result is
ordered by that score (deterministic relevance as the tie-break) and near-duplicates are collapsed
at **Jaccard ≥ 0.8** (`DUPLICATE_JACCARD`), so the agent gets N different exemplars rather than N
echoes of the same lesson. Counts come from the caller: **5** at a start, **3** on a refusal.

The jev answer is **persisted as a derived cache**, not a fact: a `recall.ranked` event in the same
append-only log, keyed by the **evidence state** — task, task version, the cover (dimension ids) and
a **watermark** = how many solved cases the task had — and folded like the adaptive bars. A recall
whose watermark still matches is served from that entry with **zero jev calls**; a new solved case,
a different cover or a new task version misses once, computes once and persists once. In one
process concurrent misses share a single call; across processes the others wait briefly
(`SINGLE_FLIGHT_WAIT_MS = 250`) for the publisher's entry. If jev is unavailable the deterministic
ranker answers that call and **nothing is cached**, so the next jev-up recall recomputes. The
envelope is unchanged — same `{need, count, truncated, cases}` — and a jev-ranked set is recorded
with its model and token spend; like the alignment judgment it is recorded, not reproducible.

**The why on a verdict — the probe battery.** A score alone does not say *why*. Each rubric dimension
may therefore declare a **battery** of jev probes in the task document (`quality.dimensions[].probes`):
typed `choice` / `noul` / `score` questions, at most **6 per dimension** and **48 per rubric**
(`PROBES_PER_DIMENSION`, `PROBES_TOTAL`), refused at parse beyond that. The probes are **calibrated
jev judgments, never model prose**: pi-jev answers in labels, probabilities and levels only.

**The score is unchanged.** The battery is a SECOND, explain-only `evaluate` call whose request
carries every dimension's probes keyed `<dimension>.<probe>` and — deliberately — **no scores**; the
scoring call itself is byte-for-byte what it always was, so there is **zero score drift**. The battery
never feeds the gate, the bars or the decision: if it throws, times out or answers unreadably, the
verdict is byte-identical and simply carries no why.

The answers are stored on the recorded `quality.verdict` as per-dimension `diagnosis` (the structured
evidence) and `rationale` (the line rendered from it: at most **3 clauses**, clipped to **240
characters**, built only from the authored option and level text — nothing invented). They appear in
three places: the **refusal handback** (`detail.quality.dimensions[].rationale`, beside the recalled
exemplars), the **brief before `op=note`** (`brief.quality.judgment`, read from the record, so the
note is evidence-backed), and **recall** (the relevant dimension's line only, by reference from the
verdict and counted in the token budget).

One signal is worth naming: when a dimension scores **below its bar while every probe is clean**, the
rendered line says so — `/ the score is below the bar but every probe is clean: the dimension statement
may be too vague`. That makes a vague rubric statement directly verifiable from the record; it changes
no score and no bar.

## Configuration

Flows and tasks are plain JSON under `.pi/praxis/`. The active flow is selected by the
`PRAXIS_CONFIG` environment variable (an absolute or project-relative path to a flow document);
with none set, the default is `.pi/praxis/flows/engineering/feature.json`. The durable store
root defaults to `<cwd>/.pi/praxis/state`, overridable by `PRAXIS_STORE_DIR` or a project
config; the SQLite file and its WAL/SHM are git-ignored. Malformed flows, tasks or artifacts
fail closed with a typed code.

## Installation

Load this Pi package normally (`pi install`). There is no build step: Pi loads the TypeScript
extension (`./src/pi/extension.ts`) directly, with the installed Pi SDK as a local peer. The
quality judge uses `pi-jev`, whose TypeSafe credential is read by `pi-jev` itself and never by
Praxis.

## Quick Start

```sh
# run the default feature flow
pi --extension ./src/pi/extension.ts

# select another flow and a store location
PRAXIS_CONFIG=.pi/praxis/flows/engineering/fix.json \
PRAXIS_STORE_DIR=/tmp/praxis-run \
  pi --extension ./src/pi/extension.ts
```

Inside the session the agent drives one step at a time through the `praxis` tool, guided by the
injected skill: `start` → read the brief and recall → do the work → `check` until clean →
`submit` → improve on a refusal → `note` to close the step.

## Current limits

- **Open design gates block the work they govern** ([`docs/vision.md` §13](docs/vision.md)):
  isolation, trusted identity, flow expansion, store retention/migration/backup, off-process
  maintenance, and nested-execution depth and budgets. Each is surfaced, not silently settled.
- **Tool checks are not isolation.** They constrain only calls routed through the `praxis` tool;
  `bash`, Fabric, a direct engine call and the CLI bypass them. The alignment gate is routing
  hygiene on the routed path, and a judge outage lets a start proceed flagged, not blocked.
- **No trusted identity.** The actor and role are trusted because the flow is pinned at spawn,
  not because a caller proved who it is; Praxis makes no authenticated-identity claim.
- **Bounded live evidence, not acceptance.** The engine has run clean at 16× concurrency on one
  store (24 instances, per-scope bar ratchets, flagged near-misses and compound refusals all
  observed); this is evidence of behavior, not an owner feature acceptance or a scale guarantee.
- **The first slice is read-only architect-style work.** Mutations, nested runtimes, flow
  expansion and the background maintenance flow stay disabled until an accepted unit enables each.
- **Sibling maturity as observed:** Manifold is the working authority layer; Occam is to be
  redone; Jung does not exist. No adapter assumes an Occam or Jung interface not observed today.

## What not to infer

- Do not infer that a routed tool check is a filesystem or process sandbox.
- Do not infer that a self-selected flow, request id or `order` is an authenticated identity.
- Do not infer that a schema-valid or accepted artifact is a correct or owner-accepted result.
- Do not infer that a passing suite or a clean live run is behavioral or owner acceptance.
- Do not infer exactly-once external execution from a recorded receipt.

## Development commands

```sh
npm run check   # strict TypeScript (tsc --noEmit); files are capped at 600 lines
npm test        # node --test over tests/**; run under a no-network import to prove offline
```

The suite is deterministic and injects fakes for the quality and alignment judges, so it reaches
no model; running it under a network-blocking `--import` proves no test calls out. Praxis runs no
git and publishes to no registry; the package is `private`.

## Further reading

- [docs/vision.md](docs/vision.md) — the north star, the layer split, the implementation
  workstream (§12) and the open design gates (§13), with the build-status reconciliation (§13a).
- [AGENTS.md](AGENTS.md) — the agent contract, product/security constraints and the
  authorization ledger.
- [docs/WORKFLOW.md](docs/WORKFLOW.md) — task identity and hashing, the research → spec → plan
  → implement → review gates, document shapes and the review verdict contract.
- [.pi/skills/praxis/SKILL.md](.pi/skills/praxis/SKILL.md) — the runtime-injected skill that
  teaches an agent to drive the one tool.
- [STATUS.md](STATUS.md) — where the build currently stands.
