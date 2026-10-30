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

**What each bar tracks.** Bars are engine-computed folds of `bar.raised` events over the
append-only log — never set by the agent. There is one **global** scope (keyed by the rubric's
composition) and one scope **per dimension** (keyed by dimension id + statement). Per **genuine
pass** (an `artifact.accepted` whose verdict at that version was `pass`) each scope records one
value:

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
