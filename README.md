# Praxis

Praxis is a composable, persistent, out-of-context **work runtime** inside Pi. An authorized
agent invokes a named **flow**; Praxis creates a durable work instance, gates it through
validated steps, judges each step's artifact against a learning quality standard, records the
experience, and returns a bounded result to the caller. One local SQLite database owns the
durable state, and one native `praxis` tool is the whole agent surface.

Praxis is the **Molecule** in a four-layer split: **Manifold assigns · Occam reasons · Praxis
executes and preserves work · Jung synthesizes.** It deliberately does not reason, manage teams,
or hold federated memory.

> **Status: built, gates open.** The durable engine, step runner, artifact validation, the Pi
> tool, the flow/task library, the composed system prompt and the quantile-bars quality engine are
> built and tested; the
> isolation, trusted-identity, flow-expansion, retention/migration, maintenance and
> nested-budget gates in [`docs/vision.md` §13](docs/vision.md) are open. See
> [Current limits](#current-limits).

## Index

- [What This Is](#what-this-is)
- [What This Is Not](#what-this-is-not)
- [Core Conventions](#core-conventions)
- [The praxis tool](#the-praxis-tool)
- [Flows and tasks](#flows-and-tasks)
- [Agent profile — the composed system prompt](#agent-profile--the-composed-system-prompt)
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
- a native `praxis` tool with six flow operations (`start`, `check`, `submit`, `note`, `read`,
  `recall`) and optional issue reporting, over one JSON argument surface;
- **tasks as atoms and flows as molecules**: a task is one gated artifact with a typed section
  contract; a flow composes tasks with `data`, `join` and `refuse` edges; a review binds the
  digest of the artifact it judged;
- **structured step artifacts** validated against per-task schemas before a step can advance, with
  canonical digests and provenance (`consumes`, `derivedFrom`, `subject`) carried in the brief;
- a **quality ratchet that learns**: one per-dimension quantile bar that rises only on evidence the
  work itself produced, a pure-AND acceptance gate, a Q50 learning flag, learning notes and recall
  steering (see [Quality bars and learning](#quality-bars-and-learning));
- a **jev alignment gate** on `op=start`: a typed judgment of whether the incoming order belongs
  to the task the flow will run — routing hygiene that refuses a misaligned order and proceeds
  (flagged) when the judge is unavailable;
- a **compact parent result**: the caller sees six keys — instance id, flow, status, accepted
  artifacts, a summary and the next action — never the internal event log or transcript.

## Rules

A **rule-set** is one JSON file under `.pi/praxis/rules/[path/]name.json` holding named one-line rules. A
task references rule-sets (`rules: [{ "set": "rules/engineering" }]`), the step brief lists them in
`brief.rules` in declared order, and a quality criterion may **cite** one (`rule: { set, id }`) - in which
case the rule's statement is composed into that criterion's question and the judge answers it. Rules are
**guidance, not an enforced invariant**: no gate, bar or verdict reads a rule, and editing a cited rule
changes what the judge is asked, never a dimension's identity or its bar. The file owns what a rule says;
`start` pins each referenced set's raw bytes, so a finished run keeps the rules it ran under.
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
| `recall` | `instance`, `need` (+`tags?`, `max?`) | ranked solved cases from **this project's** store with provenance; read-only and bounded |

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

## Agent profile — the composed system prompt

At every run boundary — Pi's `before_agent_start` — the hook (`src/pi/prompt-hook.ts`, wired in
`src/pi/extension.ts`) **replaces the agent's whole system prompt** with one composed document, built
by the pure composer in `src/runner/engine/prompt.ts` and the loader in
`src/runner/engine/profile.ts`:

```
# Conduct      occam — fixed, lead-owned, always present
# Role         engineer / architect / … — fixed for the session, set at spawn
# Domain       OPTIONAL — declared by the flow NODE, absent when none is declared
# Environment  Pi's own prompt, nested verbatim, LAST
```

- **Layers** are JSON files under `.pi/praxis/profile/{conduct,role,domain}/`, each the same locked
  profile shape — nine required fields (`id`, `version`, `layer`, `name`, `description`, `overview`,
  `invariants`, `prefer`, `avoid`) and two optional (`examples`, `body`) — and a strict object, so a
  profile can state obligations but can never name a permission. The loader refuses a file whose
  `id` is not its filename or whose `layer` is not the folder it was read from.
- **Conduct** is `conduct/occam.json`: the base layer, the same text every agent receives.
- **Role** is selected at spawn by `PRAXIS_ROLE`, else the project config's `defaults.role`. **No
  role means no composition at all** — Pi's own prompt passes through and one warning is logged,
  never a partial prompt; a role that resolves to no profile is refused the same way.
- **Domain** is the one dynamic layer. It is declared by the flow **node** that invokes a task
  (`nodes[].domains`, or the flow-level default) and is **never stored in `task.json`**, so the same
  task atom runs under any domain, or none, in another flow. The instance pins the profile bytes it
  ran under, and the active step's layers are snapshotted to `.pi/praxis/state/active.json` — so the
  prompt the agent received and the pin cannot disagree.
- **Idempotence**: a prompt that already carries the composed marker is left alone, so Pi's
  environment is never nested inside itself.
- **Trace**: with `PRAXIS_PROMPT_TRACE` set, the hook writes one line per composition to stderr —
  bytes, sha256, the section order and the role, e.g.
  `praxis-prompt {"bytes":8953,"sha256":"sha256:…","sections":["conduct","role","domain","environment"],"role":"architect"}`.

This layer is identity and guidance, not authority: it grants no capability and widens no ceiling.
The domain reaches the agent through the host (gate #2) and the role comes from spawn config
(gate #3) — both open, see [Current limits](#current-limits).

## Quality bars and learning

Every step's artifact is scored on the task's rubric **dimensions** (e.g. `grounded`,
`covers-question`, `honest-uncertainty`), each in `[0, 1]`. Each dimension carries **its own bar**,
and those bars are **quantiles of the work this task has actually carried**. There is no mean, no
global bar, no tolerance band and no Pareto cap.

**The acceptance test — exact.** A run passes iff **every** dimension's score is at or above its own
bar:

```
PASS  ⇔  ∀ d:  score_d ≥ max(0.5, bar_d)
```

`0.5` is `ABSOLUTE_MIN`: no bar can sit below the floor, so every bar is reachable by good work. The
reported headline score remains the **MIN** dimension — disclosure, not the rule.

**What a bar is.** `flooredBar` = the **maximum** of the raises recorded for that dimension, floored
at `0.5`. Raises come only from the ratchet below. The population is never materialised: every bar is folded
on demand from the append-only log, and only a **raise** is written down — as an event, never as a
column, and never the quantile itself. A bar is **monotone** — the fold takes the greatest raise, so
nothing lowers it, and a legacy decreasing record cannot either.

**The population, one value per instance.** A dimension's observations are one per **instance**, not
per attempt: the score of the version the instance *carried* (the accepted version; the best-scoring
version when a carried failure was accepted). A `continue` policy that carries a failed attempt
forward therefore cannot weight the bar by its retries, and a verdict with no score (judge
unavailable or erroring) is not an observation at all.

**Calibration and the first raise — the K3 guard.** A bar sits at the floor until the ratchet has
enough evidence twice over:

- a scope needs `CALIBRATION_MIN = 20` observations before a measured level exists at all;
- the **first raise** is eligible only at **n ≥ 28**, which is a 20-observation estimate plus **two
  confirmation halves of 4** (`FIRST_RAISE_MIN = CALIBRATION_MIN + 2 × FIRST_HALF`). The estimate is
taken from the 20 observations the halves never saw, and each half must independently support the
  candidate: at most `⌊p·|half|/100⌋` of its values may sit below it — at `p = 25` that is **one of
  four**, so three of four must be at or above. A lucky batch cannot set a standard by itself;
- **after a raise** the steady rule reads two halves of 20 (`QUANTILE_WINDOW = 40`,
  `HALF_WINDOW = 20`) and takes the **lower** half's quantile, so the newest batch cannot carry the
  bar alone either.

**The quantile — exact.** The candidate is the value at rank `⌊p/100 × (n − 1)⌋` of the **sorted**
population — the lower definition, so a quantile never overstates the work — quantized **down** to two
decimals and floored at `0.5`. `p` is the dimension's `quantileGate` when it declares one, and
`DEFAULT_QUANTILE = 25` (**Q25**) otherwise. `quantileGate` selects a **rank** — a percentile, an
integer 1–99 — never a value: a task cannot author the level its bar must reach, only how strictly
its own history is read. Strictness is therefore the only knob, and evidence is the only input.

**Step-limited.** A raise is recorded only when the candidate is at least `RAISE_STEP = 0.02` above
the bar in force; anything smaller changes nothing and writes nothing. Every raise records its
percentile, `n`, its identity key and the formula id `praxis.bar.quantile/v1`, so replaying the log
yields the same bars.

**Identity — what re-keys a bar.** A dimension's bars are keyed by its identity, never by task
version: a republished task with unchanged dimensions inherits its earned bars; editing a
*composed* dimension's criteria resets only that dimension, while rewording prose that decides
nothing leaves the key in place; adding a dimension warms only itself.

**Two signals that never decide.** A raise on an identity no **stable rubric sample** vouches for is
**held** — recorded as `bar.held` (`rubric.sampled`, S3), never applied. And a full 40-observation
window under a raised bar in which nothing passes emits `bar.contested`: that is a finding for the
owner, who may lower a contested bar; the code never does.

**The Q50 learning flag.** A dimension that **passed** but sits **below its own median** of the same
carried population is flagged. It is the "cleared the bar, not good enough to leave alone" signal —
derived on demand, no gate effect, no storage — and it is what replaced the old tolerance band. The
note gate requires a lesson for every flagged dimension, so a near-miss is where the next lesson
comes from.

**Learning.** When a step passes, the agent owes a **learning note**, and the gate requires a lesson
for every flagged dimension. The next instance's **recall** surfaces the weak set and the prior
lessons, so a shortfall on one run steers the next. This is Praxis's execution experience (P7), not
Occam's cognition: it judges whether work meets the standard and records the lesson, it does not
reason.

**A criterion that must be graded is authored as a `score` criterion.** A `score` has ordered levels,
so its answer keeps the position on that scale; a `choice` collapses the judge's distribution into
one key and cannot express a degree. This is an authoring rule, not a code rule: nothing forbids a
`choice` criterion, and no schema field can grade one. Praxis does record the distribution it was
given — `pClean`, `pTop` and `spread` per criterion, the `torn` set when a judgment sat near the
judge's own boundary — but that is **disclosure only**: it never enters the score, a bar or the
acceptance decision.

**Recall — exact (two stages, one cached jev call).** `op=recall` and the refusal feedback rank this
project's solved cases in two stages. **Stage 1** is deterministic: the cases are ordered by the
brief's own relevance scorer and cut to **20 candidates** (`JEV_POOL`). **Stage 2** is ONE pi-jev
`evaluate` call over those candidates — one `score` question each, fields clipped to **240
characters** (`JEV_CLIP`) — asking how much *new* guidance each case adds; the result is ordered by
that score (deterministic relevance as the tie-break) and near-duplicates are collapsed at
**Jaccard ≥ 0.8** (`DUPLICATE_JACCARD`), so the agent gets N different exemplars rather than N
echoes of the same lesson. Counts come from the caller: **5** at a start, **3** on a refusal.

The jev answer is **persisted as a derived cache**, not a fact: a `recall.ranked` event in the same
append-only log, keyed by the **evidence state** — task, task version, the cover (dimension ids) and
a **watermark** = how many solved cases the task had — and folded like the bars. A recall whose
watermark still matches is served from that entry with **zero jev calls**; a new solved case, a
different cover or a new task version misses once, computes once and persists once. In one process
concurrent misses share a single call; across processes the others wait briefly
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
never feeds the gate or a bar: if it throws, times out or answers unreadably, the verdict is
byte-identical and simply carries no why.

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
with none set, the loader's default is `.pi/praxis/flows/engineering/feature.json` — the same
default the Pi tool uses. The durable store root defaults to `<cwd>/.pi/praxis/state`,
overridable by `PRAXIS_STORE_DIR` or a project config; the SQLite file and its WAL/SHM are
git-ignored. Malformed flows, tasks or artifacts fail closed with a typed code.

| Variable | Effect |
| --- | --- |
| `PRAXIS_CONFIG` | the flow document to open; default `.pi/praxis/flows/engineering/feature.json` |
| `PRAXIS_STORE_DIR` | the SQLite store directory; default `<cwd>/.pi/praxis/state` |
| `PRAXIS_ROLE` | the **role layer of the composed prompt**, e.g. `engineer`; unset falls back to the project config's `defaults.role`, and with neither there is no composition at all |
| `PRAXIS_PROMPT_TRACE` | set, and the hook writes one `praxis-prompt` line per composition (bytes, sha256, sections, role) |
| `PRAXIS_ACTOR` | the actor recorded on an instance when the host supplies none; default `cli` |

The library roots default beside the store and override the same way: `PRAXIS_PROFILE_DIR`
(`.pi/praxis/profile`), `PRAXIS_TASKS_DIR` (`.pi/praxis/tasks`) and `PRAXIS_RULES_DIR`
(`.pi/praxis/rules`).

## Installation

Load this Pi package normally (`pi install`). There is no build step: Pi loads the TypeScript
extension (`./src/pi/extension.ts`) directly, with the installed Pi SDK as a local peer. The
quality judge uses `pi-jev`, whose TypeSafe credential is read by `pi-jev` itself and never by
Praxis.

## Quick Start

```sh
# run the default feature flow
pi --extension ./src/pi/extension.ts

# select another flow, a store location, and the role layer of the composed prompt
PRAXIS_CONFIG=.pi/praxis/flows/engineering/fix.json \
PRAXIS_STORE_DIR=/tmp/praxis-run \
PRAXIS_ROLE=engineer \
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
  store (24 instances, per-dimension quantile bars, Q50 flags and pure-AND refusals all observed); this is evidence of behavior, not an owner feature acceptance or a scale guarantee.
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
