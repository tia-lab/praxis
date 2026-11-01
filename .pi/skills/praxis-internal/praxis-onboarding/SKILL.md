---
name: praxis-onboarding
description: Onboard on the Praxis repo as built — one composed system prompt, flows of task atoms, one praxis tool, the quality gate, the store, the three open gates, the ledger discipline and the verification set. Use when a lead starts or resumes work on Praxis and needs the system as-built before directing anything.
---

# Praxis — onboarding on the system as built

Read this once, then follow the pointers. It states the shape; it does not restate
scope, procedure or design.

**Authorities, not summaries:**

| Fact | Owner |
| --- | --- |
| Scope, authority, dependency policy, product constraints | `AGENTS.md` |
| How work is sequenced, gated and reviewed | `docs/WORKFLOW.md` |
| Product design, north star, open gates | `docs/vision.md` |
| How to launch a real agent against a real flow | `docs/LIVE-TEST.md` |
| The tool's operations and step loop | `.pi/skills/praxis/` |

Repo root: `/home/tia/_DEV/AI/praxis` (may resolve through
`/media/Development/AI/praxis`). Resolve the real path before running anything; if a
tool denies it, correct host rooting — never bypass the denial.

## What Praxis is

**Manifold assigns. Occam reasons. Praxis executes and preserves work. Jung
synthesizes.**

Praxis is a composable, persistent, out-of-context work runtime inside Pi. It owns
the boundaries and continuity of work; the agent owns the choices inside them.
Praxis is not a reasoning engine, not a team manager and not a memory authority.

## The as-built architecture

### One composed system prompt per run

At every `before_agent_start` the hook (`src/pi/prompt-hook.ts`, wired in
`src/pi/extension.ts`) **replaces** the agent's whole system prompt with a single
document, composed by the pure module `src/runner/engine/prompt.ts`:

```
# Conduct      occam@1 — fixed, lead-owned, always present
# Role         engineer / architect / … — fixed for the session, set at spawn
# Domain       OPTIONAL — declared by the flow NODE, absent when none is declared
# Environment  Pi's own prompt, nested verbatim, LAST
```

- Layers load through `src/runner/engine/profile.ts` from
  `.pi/praxis/profile/{conduct,role,domain}/*.json`; the active step's layers are
  snapshotted to `active.json` (`src/runner/engine/active.ts`), so the prompt and
  the pin cannot disagree.
- **role** comes from the spawn environment (`PRAXIS_ROLE`, else the project's
  `defaults.role`). **No role → no composition**: Pi's own prompt passes through and
  one warning is logged.
- **domain is never on the task.** It is declared by the flow node that invokes a
  task, injected only when present, and a `task.json` stays domain-agnostic and
  reusable.

### Flows of task atoms

- `.pi/praxis/tasks/**` — reusable **atoms** (`task.json`): goal, section contract,
  rubric, capabilities, optional rules.
- `.pi/praxis/flows/**` — `praxis.flow/v2` **molecules**: `nodes` + `edges` over task
  ids. Control flow is edges (`onRefuse`, `join`, `branch`), not prose in a step.
- `.pi/praxis/profile/{conduct,role,domain}` — conduct layers. `.pi/praxis/rules/` —
  task-referenced rule sets (guidance, never a gate input).

### The one tool and the step loop

A single `praxis` tool drives one step at a time:
`start` → `check` → `submit` → `note`, plus `read` and `recall`. Details live in
`.pi/skills/praxis/SKILL.md`; do not restate them.

**Gates are enforced in code.** Skills guide conduct and enforce nothing.

### The quality gate

`src/quality/` judges a submitted artifact with jev against per-dimension
**quantile bars** (Q25 default), a pure-AND gate, a K3 first-raise guard and a Q50
learning flag. Recall surfaces prior solved cases from **this project's store
only**. Valid: schema-valid is not task-complete — acceptance is the gate's.

### The store

SQLite, `praxis.store/v2`, behind one driver seam. Instances pin the definitions
they ran under; the event log and the artifact record are the durable truth.

## Built, and what is still open

**Built and exercised:** P0 contracts · authority-intersection checks · durable
engine · step runner · artifacts · Pi integration (the one `praxis` tool) ·
flows, tasks, profiles and rules · the quality gate · the composed system-prompt
injector (including domain injection).

**Three gates stay OPEN — never claim them closed (they are §13 in
`docs/vision.md`, and §13a is the reconciliation to read):**

1. **#1 Isolation.** Routed-call denial only. An agent with direct shell or Fabric
   access bypasses it. Broker checks are **not** a sandbox.
2. **#2 Domain at the boundary.** The domain reaches the agent through the hook, so
   the host is inside the prompt trust path. Exercised — not closed.
3. **#3 Trusted role identity.** The role comes from the spawn environment or the
   project config. It is **config trust, not an authenticated binding**.

Never claim isolation, trusted identity, or exactly-once external execution.

## The ledger — how work is authorized

`AGENTS.md` §0 **Authorization ledger** is the source of truth for scope. Nothing
proceeds beyond a recorded bounded unit.

- A unit is granted by the **owner** in words; the ledger records scope, allowed
  paths and acceptance, and nothing else grants scope. Reading or editing this file
  grants no new scope.
- No new path, dependency, store or schema because a task seemed to need it — that
  is a stop-and-report, not an improvisation.
- **The lead does not commit; the engineer commits.** The lead records, verifies and
  reports.
- Parallel agents do not gain overlapping write permission by having separate panes.

## How to verify work

Run these yourself; do not accept a claim without them.

```sh
cd <repo> && ./node_modules/.bin/tsc --noEmit            # must exit 0
node --test 'tests/**/*.test.ts' | grep '^ℹ (tests|pass|fail)'
```

- **Unit evidence** — the narrow test file for the change, then the whole suite.
  A build alone is not behavioural acceptance.
- **Grep proofs** — when a unit claims a field or path is gone, prove it:
  `grep -rn '<symbol>' src tests` must return nothing. Deletions need the *before*
  grep too, showing who read it.
- **Frozen-set diff** — `git diff --stat <base>..HEAD -- <frozen paths>` should be
  empty when the unit says those files are untouched.
- **Live probe** — the proof no unit test can give (`docs/LIVE-TEST.md` for the
  launch line). Launch a **fresh** agent on a real flow, then ask it what its
  conduct, role and domain are. It must answer **from the injected prompt**, without
  opening anything under `.pi/praxis/profile/**`. A trace line on stderr confirms the
  composition:

  ```
  praxis-prompt {"bytes":…,"sha256":…,"sections":["conduct","role","domain","environment"],"role":…}
  ```

  An answer that reads the profile files instead of the prompt proves nothing; an
  absent `# Domain` for a node that declares none is the correct result, not a bug.

Label every claim `documented | source-inspected | executed | untested | proposed`.
A passing check proves only what it exercised.

## Never guess

The single most expensive failure mode here is a confident invention — a field that
is not in the brief, a gate called closed that is open, a test result nobody ran, a
scope assumed rather than recorded.

When the objective, the scope, the authority or a material fact is unclear: **ask**.
When what you read contradicts what you were told: **stop and say so**, with the
path and line. A question costs a minute; a wrong assumption costs a unit.
