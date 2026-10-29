# Praxis — agent contract

## Read and scope

Read [README.md](README.md) and [docs/vision.md](docs/vision.md) before affected
work. Re-read the current files after resuming; do not rely on conversation
summaries alone. Follow actual owner instructions and preserve unrelated edits.

Praxis is a composable, persistent, out-of-context work runtime inside Pi,
specified in [docs/vision.md](docs/vision.md). Layer split:
**Manifold assigns · Occam reasons · Praxis executes and preserves work · Jung
synthesizes.**

**Status: design and bootstrap.** `docs/vision.md` is design-only; it does NOT
authorize implementation. No flow engine, durable store, adapter or schema is built
yet. Writing runtime code, adding dependencies, creating the store, or enabling any
flow requires explicit, direct owner authorization for a bounded unit. Record such
authorization here when given; updating this file grants no new scope by itself. A
worker that believes an instruction exceeds the recorded scope must stop and
reconcile with the owner rather than proceed.

**Authorization ledger.** Nothing was recorded before 2026-10-29: `src/` is empty,
there is no `tests/` or `scripts/` directory, and `README.md` is a one-line
placeholder. When a bounded unit is granted, record its scope, allowed paths and
acceptance here before building.

- **2026-10-29 — setup docs only.** Scope: `docs/WORKFLOW.md`,
  `docs/templates/{research,spec,plan,review}.md`, the `AGENTS.md` working-procedure
  section and ledger entries. Acceptance: the files exist and state the agreed
  gates without contradicting this contract. No code, dependency, schema, store,
  flow, adapter, Manifold configuration or `src/` file is authorized.
- **2026-10-29 — workflow skill only.** Scope: `.pi/skills/praxis-workflow/SKILL.md`
  and this entry. Acceptance: a router that states no rule absent from
  `docs/WORKFLOW.md`, layers the Occam principles as conduct, and states that
  Manifold is inactive. No code, dependency or schema.
- **2026-10-29 — research squad config.** `docs/squad-config-e2e176dd/` documents the
  unit; `.pi/manifold/config.json` is the declaration. Owner GO: define it now,
  activate later. Activation, compose and launch remain separate owner actions.
- **2026-10-29 — research squad config (pointer form).**
  `docs/squad-config-c38e8551/` · `.pi/manifold/config.json` (pointer) +
  `.pi/manifold/profiles/research.json` (clone profile). Supersedes
  `squad-config-e2e176dd` after owner correction to the author's own layout.
- **2026-10-29 — minimality skill.** Scope: `.pi/skills/praxis-minimality/SKILL.md`,
  the `praxis-workflow` pointer trim, and this entry. Acceptance: the canon is
  linked with pinned digests, drift fails loudly, and no canon text is duplicated.
- **2026-10-29 — alignment skill.** Scope: `.pi/skills/praxis-alignment/SKILL.md`,
  the `praxis-workflow` shared-core line, and this entry. Acceptance: the skill
  records alignment as a written artifact with frozen/open separation and a
  stated stop condition. No code or schema.
- **2026-10-29 — manifold defect report.** Owner-directed write outside this repo:
  `/home/tia/_DEV/AI/manifold/.dev/ISSUES.md` gains MAN-1 (hub converger cannot
  finalize). Documentation only — no manifold code, config, database or service was
  touched.
- **2026-10-29 — unit C authorized: Pi integration.** Owner authorized directly; lead
  records and verifies. Scope: `src/types/pi.ts`, `src/pi/`, `tests/pi/`,
  `docs/pi-integration-eeacf406/`. Acceptance: one Pi tool `praxis` starts, submits and
  reads through the accepted Slice 0 engine; a capability the current step does not grant
  is denied before dispatch with a typed code; the parent receives the six-key result plus
  a step descriptor and never the event log or transcript; `src/runner`, `src/store`,
  `src/types/schema.ts`, `src/types/errors.ts`, `src/cli.ts` and `.pi/praxis/config.json`
  are unchanged. Not authorized: Pi-wide tool denial, OS sandbox, isolation or trusted
  identity claims — gates #1, #2 and #3 stay open and the recorded claim is routed-call
  denial only.

Repository root is `/home/tia/_DEV/AI/praxis` (currently resolving to
`/media/Development/AI/praxis`). Resolve the actual target before commands; if a
tool denies it, stop and correct host rooting rather than bypass the denial.

**Housekeeping (inherited bootstrap residue).** The repo still carries
`pi-manifold`'s identity and tooling: `package.json` (name, description, `pi`
extension/skill entries, `check`/`test`/`bench`/`release` scripts pointing at
files that do not exist, and `@nats-io/transport-node` plus `zod`),
`commitlint.config.cjs`, `.husky/` (its `commit-msg` hook rewrites messages to
`[N] …` and shells out to `bunx commitlint`), and `.gitignore` entries for
`.pi/manifold/*` and `tests/live/**`. None of it is praxis behaviour: do not
repair, run or rely on those scripts and hooks as if they were ours, do not import
NATS merely because it is installed, and settle praxis's own name, manifest,
dependency set and ignore rules as one authorized unit before packaging or release
work.

## Workspace setup

Global Pi supplies four packages (`pi-fabric`, `pi-claude-subscription-connector`,
`pi-web-access`, `context-mode`). `.pi/settings.json` adds `npm:pi-apply-patch`
plus git/ssh pinned `jev-fabric` v0.8.1, `pi-fovea` v0.33.0, `pi-contour` v0.5.0
and `manifold` v0.1.0. The full inventory and restore commands live in
`~/.pi/agent/EXTENSIONS-INVENTORY.md`; `pi list` inside the project shows what
actually loads. `jev-fabric` is an OPTIONAL execution/observation and
typed-decision adapter candidate behind the broker, never the durability authority.

`.dev/` is untracked, gitignored local evidence: `fabric-research/*.md` notes and
unpacked `jev/jev-fabric-main` and `jev/jev-search-main` sources. Treat it as
read-only reference; nothing under it is a praxis dependency, and none of it may be
copied into `src/` without the dependency-inspection rule below.

## Product constraints (from the vision)

- Praxis owns the boundaries and continuity of work; the agent owns choices within
  them. Praxis MUST NOT become a reasoning engine, team manager, or federated
  memory authority. Manifold owns assignments; Occam owns cognition; Jung owns
  cross-project synthesis.
- One authoritative owner per fact. The Praxis durable store is separate from
  Manifold assignment authority and Occam cognitive traces; never create competing
  copies of the same fact across stores, UI, or summaries.
- Effective permissions are an intersection
  (project ∩ profile ∩ parent runtime ∩ flow ∩ step). Wildcards, nesting, memory and
  dynamic composition can never amplify a ceiling. Unknown names are invalid;
  unauthorized known names are denied; missing/stale/unauthorized state fails closed
  with a typed reason.
- Enforce authority, identity, capability ceilings and resource bounds in code.
  Skills and prompts guide conduct; they do not enforce permissions or prove
  compliance. A trusted actor identity comes from a Pi/Manifold binding, never an
  untrusted request field.
- Broker-only tool checks constrain only calls routed through Praxis. They are NOT
  isolation: an agent with direct shell/Fabric access bypasses them. Any "cannot
  touch anything else" guarantee needs a separate OS-sandbox or blocked-alternate-
  path integration gate, never a prompt instruction.
- Durable by design: steps, intents and receipts are recorded; retries are
  idempotent where possible; uncertain external effects block blind re-execution.
  Use durable intent → external op → observed result → durable receipt; never hold a
  store write transaction across an external call. Do not claim exactly-once
  external execution.
- Completion requires task/artifact acceptance, not merely successful tool calls.
  Schema-valid is not task-complete. Historical evidence is immutable; memory
  interpretations may evolve only with versioning and provenance.
- The parent context receives bounded results and references, not internal
  transcript replay.
- Stack: TypeScript, with host/platform facilities (Pi tools, Fabric, SQLite)
  preferred over new abstractions, dependencies or a second authoritative store.
  SQLite is the vision's proposed store default. The TypeScript-only choice and the
  no-Rust / no-TIA-runtime stance are owner decisions recorded in this contract,
  not vision text.

## Implementation sequencing (from the vision)

`docs/vision.md` §12 fixes the order of work; new work may not skip ahead of an
unaccepted predecessor.

- P0 contracts → P1 authority → P2 durable engine → P3 step runner → P5 artifacts
  → P6 Pi integration; P4 adapters only as the broker stabilizes; P7/P8 after
  evidence storage; P9 last.
- The first slice is a **read-only architect flow**. Mutations, nested runtimes,
  flow expansion and the background maintenance flow stay disabled until an
  accepted unit enables each explicitly.
- Open gates in §13 block the code they govern: isolation model, Pi host seam,
  trusted identity source, flow-expansion authority, artifact contract, store
  durability/migration/retention, off-process maintenance trigger, and
  nested-execution depth and budgets. Surface these to the owner; do not settle
  them silently inside implementation.
- Sibling maturity as observed: Manifold is the only working authority layer
  (pinned v0.1.0), Occam is to be redone, Jung does not exist. No adapter may
  assume an Occam or Jung interface that is not observed today; an unavailable
  runtime yields a named blocker, never a fabricated result.

## Working procedure

Work follows [`docs/WORKFLOW.md`](docs/WORKFLOW.md): task identity and hashing, the
research → spec → plan → implement → review gates, document shapes and the review
verdict contract. This file does not restate them. Two consequences bind here: no
gate starts before its predecessor's review passes, and the owner's acceptance —
not a passing build — completes a task.

## Engineering conduct

1. Start from the required outcome, smallest sufficient data model, ownership and
   failure boundaries. Reuse existing code and platform facilities before adding
   abstractions, dependencies, configuration or another store.
2. Trace relevant callers and effects before editing. Prefer semantic modules,
   explicit valid states and small complete changes over scaffolding.
3. Dedicated Zod/types modules, types separate from runtime; at most 600 lines per
   file; measure critical paths. Task documents and acceptance coverage live under
   `docs/<slug>-<hash>/` as `docs/WORKFLOW.md` defines.
4. Keep implementation write boundaries explicit; parallel agents do not gain
   permission to edit overlapping paths merely by having separate panes.
5. Add the smallest meaningful regression check, including failure/recovery paths.
   Test narrowly first; a build alone is not behavioral acceptance.
6. Label documented, source-inspected, proposed, executed and untested evidence.
   Record actual commands, outcomes and limitations; do not invent test results,
   owner approval, identity authentication, savings, learning, sandbox guarantees
   or exactly-once execution.
7. Stop affected work on stale ownership, unknown external effects, conflicting
   edits, failed checks or material scope change. Reconcile before retrying.

## Security and operational boundaries

- Do not read or print credentials, environment-secret files, browser profiles,
  tokens, or private account configuration. Redact connection diagnostics; never
  persist a credential-bearing URL.
- Keep runtime databases, WAL/SHM files and transient execution material out of Git.
  `.gitignore` currently carries manifold's paths (`.pi/manifold/*`, `tests/live/**`)
  and no praxis store path: add the authorized store root as part of that unit
  rather than assuming it is already covered.
- A root `.env` exists and is gitignored. Do not read, print, copy or persist it or
  any credential it names.
- Treat the referenced sibling projects (Occam at `/home/tia/_DEV/AI/occam/`,
  Manifold at `/home/tia/_DEV/AI/manifold/`, and `tia-mcp-rs`) as read-only
  evidence, not dependencies or authority. Do not run their launchers, mutate their
  databases or restart their services.
- Do not commit, push, deploy, or activate a different project without explicit
  permission. New dependencies or reuse of external source require explicit
  inspection of purpose, version, license and operational impact. No external
  repository's lifecycle, model routing, licensing or deployment rules are imported
  implicitly.
- Do not weaken an adopted project's own contracts; a Praxis assignment is not
  permission to bypass another project's approvals, safety rules or acceptance.

**Guiding sentence: Manifold assigns. Occam reasons. Praxis executes and preserves
work. Jung reorganizes collective experience.**
