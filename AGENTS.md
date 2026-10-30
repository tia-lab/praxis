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
- **2026-10-29 — flow selection (real unit, G1 dispatched).** Owner GO in words: the
  rebuilt team must run a real unit through the delivery workflow. Scope:
  `src/runner/engine.ts`, `src/pi/tool.ts`, `src/cli.ts`, `tests/runner/`,
  `docs/flow-selection-d6b6218d/`; contract hash8 `d6b6218d` — recomputed over the §0 block
  as written, superseding the `73c73898` first recorded here, which hashed a placeholder scope
  line instead of the one in the task body (feature `flow-selection`, task
  `f902d382`, assignment `1cc69177` to architect-1). Acceptance: `praxis run flows/delivery`
  starts the shipped delivery flow from a fresh store; a selector that disagrees with the
  document's flow key is `FLOW_INVALID` before any write; `workflow.json`, `research.json`
  and `.pi/praxis/config.json` stay byte-identical, while `delivery.json` may be rewritten from
  the legacy `praxis.config/v1` steps form to `praxis.flow/v2` because the loader has no legacy
  branch and the two requirements were otherwise contradictory; `tsc` clean; suite green. Not authorized: flow
  document schema changes, store schema changes, nested-execution budgets, or any isolation,
  identity or exactly-once claim.
- **2026-10-29 — path identity for tasks and flows.** Owner GO in words, after a
  plan-plus-review round on the same change was rejected as ceremony. Scope:
  `src/types/schema.ts`, `src/runner/engine.ts`, `src/store/definitions.ts`,
  `.pi/praxis/flows/workflow.json`, `.pi/praxis/tasks/*`, the affected tests, and the R1–R4
  amendment in `docs/task-data-flow-model-7b1ebe17/`. Acceptance: `tasks/<path>` and
  `flows/<path>` share one segment rule; a document's `id` is its last path segment; a
  publication is keyed by (path, version); flat and nested references both resolve; `tsc`
  clean and 139/139 tests; `.pi/praxis/config.json` and the accepted `research` and
  `delivery` flows byte-identical. Not authorized: selector resolution under
  `.pi/praxis/flows/`, flow selection from the Pi tool (its path stays hardcoded), and any
  isolation, identity or exactly-once claim — gates #1/#2/#3 stay open.
- **2026-10-29 — delivery flow (praxis runs praxis).** Owner GO in words: the team uses
  Praxis directly with issue reporting open, accepting a slower start. Scope:
  `.pi/praxis/flows/delivery.json` (new), `.pi/praxis/flows/research.json` (snapshot of the
  accepted flow), `.pi/manifold/profiles/tester.json` and the `test` pointer in
  `.pi/manifold/config.json` (team side), plus this entry. Acceptance: the five stages
  `research → spec → plan → implement → review` parse as `praxis.config/v1` and mirror the
  gates in `docs/WORKFLOW.md`; the committed `.pi/praxis/config.json` and the accepted
  Slice 0 flow (`web → evidence → code → prepare`) stay byte-identical; a stage gate
  refuses a document missing its required section. Not authorized: engine, store or tool
  code changes; flow selection from the Pi tool (its path is hardcoded) is a separate
  unit; `"active"` in `.pi/manifold/config.json` stays `research`.
- **2026-10-29 — task-data-flow-model (G0)** · `docs/task-data-flow-model-7b1ebe17/` ·
  hash8 `7b1ebe17` · design unit for tasks-as-data, flows composing them, control flow
  as edges. Goal "tasks as JSON units, flows compose them, logic as edges"; scope
  "docs/<slug>-<hash8>/, later src/types/schema.ts, src/runner/engine.ts"; acceptance
  "state machine table, four properties each with a test, review bound to subject digest,
  flows reuse tasks across feature/bugfix/refactor". Procedure: `docs/WORKFLOW.md` gates
  in markdown until Praxis can hold the design loop itself.
- **2026-10-29 — task/flow model implementation (unit D).** Owner GO: **yes**, and it does not
  proceed unless G2 spec and G3 plan pass first. Three frozen owner decisions: (D1) tasks are
  **separate units** — atoms — and flows compose them — molecules; a task is never defined inside
  the flow that uses it. (D2) a review binds to the **digest of the artifact it judged**, not to a
  digest of reviewed files on disk. (D3) implementation starts only after the plan passes. Scope:
  `src/types/schema.ts`, `src/types/org.ts`, `src/types/errors.ts`, `src/runner/engine.ts`,
  `src/store/`, `tests/`, `.pi/praxis/tasks/`, `.pi/praxis/flows/`. Three paths were added to this
  scope on 2026-10-29 by G2 review, each because the spec cannot be implemented without it:
  `src/types/errors.ts` (the closed `Code` union the failure taxonomy extends), `src/types/pi.ts`
  (the `CODES` mirror of that union, which must not drift), and `src/pi/tool.ts` (the read-path
  `configDigest` comparison that must be re-pointed at the pinned flow definition row, not merely
  compile-fixed). Every other exclusion stands unchanged. Acceptance: a flow references task units by id; a
  review whose subject digest is not the current accepted version is refused; `onRefuse` plus one
  join or branch edge evaluate correctly; an instance pins the task definitions it ran under; every
  existing test stays green. Not authorized: changing the gates in `docs/WORKFLOW.md`, deleting the
  accepted research flow, or any identity, isolation or exactly-once claim.
- **2026-10-29 — owner: stop full reviews, go to plan and code.** Owner directive: the full-document
  review loop is stopped; `spec.md` is **frozen as provisional** (unpassed, 33 amendments, its open
  contradictions to be found by the plan and the code). Reviews from this point are **incremental**:
  a reviewer receives the changed lines, the previous verdict and the subject digest, and judges only
  the delta and what cites it — never the whole document again. Implementation proceeds in ordered
  slices beside the plan rather than after a dual PASS, which is an explicit owner override of D3.
  Still binding: D1, D2, and the unit D scope/exclusions. This directive grants no new paths.
- **2026-10-29 — lead ruling: the default flow path moves (option a).** The spec replaces
  `FlowConfigSchema` with a nodes/edges document while `.pi/praxis/config.json` remains a `steps[]`
  file, so leaving the default path at `config.json` would make the accepted Slice 0 flow unrunnable
  whenever `PRAXIS_CONFIG` is unset. Ruling: step 3 emits a new nodes/edges flow document and the
  default path points at it; `config.json`, `flows/research.json` and `flows/delivery.json` keep their
  exact bytes, and C12 asserts that no-change. `PRAXIS_CONFIG` still overrides. A legacy `steps`
  branch (`LegacyFlowConfigSchema`/`normalizeLegacy`) is **not** authorized: it contradicts spec R2/R7
  and is an owner-level decision. This ruling is the lead's, is owner-overridable, and is reversible
  in one line if the owner prefers rewriting `config.json` instead.
- **2026-10-29 — lead scope record: `src/runner/step.ts`.** Added to unit D by the lead because the
  plan's item 4 requires it and `AGENTS.md` §3 caps files at 600 lines: `src/runner/engine.ts` is
  606 today and the plan moves `runStep`, `refused`, `parseStored`, `probeArtifact`,
  `buildHandoff`, `RunStepArgs`, `StepArtifact` and `Handoff` into the new file as a move, not a
  rewrite. Recorded rather than assumed so the engineer is not asked to work around a cap that is
  the lead's to lift. Owner-overridable; if the owner prefers engine.ts above 600, this line is the
  reversal and the file is not created.

- **2026-10-29 — unit E authorized: P5 artifact templates (solo).** Owner GO in words:
  full scope, implemented alone, exact plan first. Docs: `docs/p5-artifact-templates-99d43024/`.
  Allowed paths: `src/types/schema.ts`, `src/runner/requirements.ts`, `src/types/pi.ts`,
  `src/runner/engine.ts` (may pass the 600 cap; a refactor follows), `src/pi/tool.ts`,
  `.pi/praxis/tasks/**` (data), `tests/`. Acceptance: the task `requires` vocabulary gains
  opt-in `type`, `note`, `strict`, `minLength`/`maxLength`, `pattern`, `enum` and `references`,
  enforced deterministically by the existing `section-requirements` gate with no new gate
  value and no dependency; the step `brief` additionally carries `consumes` (accepted
  predecessor refs), `derivedFrom` (one data source) and `subject` (when the step binds one),
  so a consuming step passes on first submit; every existing test stays green and `tsc` is
  clean. Not authorized: a template registry (the task's `requires` is the one owner of that
  fact — no `.pi/praxis/templates/`), a model-in-the-loop gate, YAML/Markdown rendering,
  store-schema changes, a field-scoped read tool, and any identity, isolation or exactly-once
  claim — gates #1/#3 stay open.
- **2026-10-29 — unit F authorized: instance ownership check (solo).** Owner GO in words:
  "ok do that now", after estimating the work. Fixes a real authority gap — ownership was
  enforced only at `start` (`engine.ts` actor conflict), never on `submit`/`read`/`inspect`,
  so any actor knowing an instance id could operate another agent's task. Allowed paths:
  `src/runner/engine.ts`, `src/pi/tool.ts`, `src/types/errors.ts`, `src/types/pi.ts`,
  `tests/pi/ownership.test.ts`. Acceptance: `submit`/`read`/`inspect` refuse an instance whose
  `actor` is not the caller's with a typed `INSTANCE_FORBIDDEN`; the closed `Code` union and its
  `pi.ts` mirror both gain it without drift; a test proves actor-B is refused actor-A's instance
  on both `submit` and `read` while the owner passes; every existing test stays green and `tsc`
  is clean. Explicitly NOT in scope (restated frozen design direction): no tool is restricted —
  Fabric/bash/web/edit stay fully usable (tools are the free means, the record is what Praxis
  protects); the store is not yet protected from direct `bash`/`sqlite` access (that is the
  host-seam / store-driver unit, design-first, later — the store stays behind one driver seam so
  local SQLite ↔ remote Turso/D1 is an env change with a host-only credential); no store swap,
  dependency, flow or schema change; SQLite as-is. Gates #1/#3 stay open; this is routed-path
  authority only, not isolation.
- **2026-10-29 — unit G authorized: team relay (per-step roles + SoD, Manifold-free).** Owner GO
  in words: "proceed please implement it", after sizing it as a medium unit that crosses into
  the store. Lets different actors own different steps of one instance. Allowed paths:
  `src/types/schema.ts`, `src/store/definitions.ts`, `src/runner/identity.ts` (new seam),
  `src/runner/engine.ts`, `src/types/pi.ts`, `src/pi/tool.ts`, `tests/testkit.ts`,
  `tests/runner/relay.test.ts`. Acceptance: a task may declare a `role`; `start` accepts a
  role→actor map pinned immutably in the instance's own `definition` row (kind `assignment`,
  no DDL change); the holder of a step's role may submit it and no one else; a subject-binding
  step refuses the author of what it judges (separation of duties) when roles are pinned; a
  solo instance (no roles) keeps the shipped behaviour and reviews its own work; observe
  (inspect/read) is open to the creator and every assigned actor, closed to a stranger;
  `tsc` clean and the full suite green. Design seam recorded: `roleAssignment()` in
  `identity.ts` is the ONLY reader of the role→actor source, so a Manifold-backed build swaps
  that one body (static pinned map → live Manifold assignment) and the identity stays an
  opaque actor string the engine compares, never a `pi-session:` assumption — Manifold becomes
  a one-module swap, like SQLite→Turso for the store. Not authorized / still open: Manifold
  wiring itself (gate #3), the host-seam / remote store that makes this real under
  non-cooperating agents (local SQLite + bash still bypasses it), dynamic claim reassignment,
  and any isolation or exactly-once claim. The role map is a trusted start-time input from the
  instance creator; an agent assigning roles can only do so for an instance it creates and SoD
  still blocks self-review, so a bad assignment cannot manufacture a self-approved review.

- **2026-10-30 — manifest identity: praxis, not manifold.** Owner direction in words: the
  `package.json` description did not match what Praxis is. Scope: `package.json` (name
  `pi-praxis`, a description stating this project, the manifold skill pointers dropped) and this
  entry. Acceptance: name and description describe Praxis; no script, dependency, `pi` extension
  entry or ignore rule changes. Still not authorized: settling `scripts`, `dependencies`,
  `peerDependencies`, `files`, `.husky/`, `commitlint.config.cjs` or `.gitignore` — that full
  manifest/dependency housekeeping remains the separate unit named above.
- **2026-10-29 — quality-eval unit (owner-authorized, core implemented).** Owner GO in words:
  "proceed with implementation", plus "scope jev inside a folder". Plan: `docs/task-flow-quality-eval/PLAN.md`.
  Delivers an optional per-task **quality floor**: a task may declare `quality { dimensions, threshold,
  policy: required|advisory }`; a typed verdict is scored by an injected `Scorer` (fabric `jev.evaluate`
  shape) **outside any store transaction** and enforced synchronously by the gate. Paths changed:
  `src/types/schema.ts` (Quality/QualityVerdict schemas, `TaskConfig.quality`, capability `"evaluate"`),
  `src/types/errors.ts` + `src/types/pi.ts` (`QUALITY_REQUIRED`, `QUALITY_BELOW_THRESHOLD`, mirror kept
  in sync), `src/runner/step.ts` (`gate()` enforces the floor; `Verdict.quality`), `src/runner/engine.ts`
  (`AdvanceOptions.qualityVerdict`, `EVENT.qualityVerdict`, forwards + records), new `src/quality/`
  (`evaluate.ts` = `Scorer` port + `evaluateArtifact` + `advanceEvaluated`; `index.ts` barrel),
  `tests/testkit.ts` (quality passthrough), `tests/runner/quality.test.ts` (6 tests, fake scorer),
  `tests/types/errors.test.ts` (frozen taxonomy 26→28). Acceptance met: a task with no `quality` block is
  byte-identical behaviour (full suite 159/159 green); below-threshold required → `QUALITY_BELOW_THRESHOLD`;
  required + no scorer (or missing `evaluate` capability) → fail-closed `QUALITY_REQUIRED`; advisory below →
  recorded and passes; every verdict records score/dimensions/rubricDigest/scorer/source; `tsc` clean.
  Aggregation is the **minimum** dimension (no weighted scoring, MIN-011). **Deferred / still open:** the
  live `--evaluate` CLI driver and how a driver obtains the real fabric `jev` port without nested calls
  (P10) — the core is proven behind a **fake** scorer; no live Jev call is wired yet, and no learning
  layer is in scope. The Occam `jev`/`self-eval` contract was used as **read-only reference** only; no
  Occam code was imported (it is being rewritten).
- **2026-10-29 — quality-eval (a)+(b) landed (owner-authorized).** Owner GO: "implement both".
  (b) flow-level default: `FlowConfigSchema.quality?` + effective = `task.quality ?? flow.quality` in
  `advance` and `advanceEvaluated`; `tests/testkit.ts` `writeFlow` gains a `flowQuality` arg; two tests
  added (default applies; task overrides). (a) all 12 `.pi/praxis/tasks/*.json` gain a per-task `quality`
  block (rubric dimensions + `threshold` 0.6 + `policy: "advisory"`), the `evaluate` capability, and
  `version` bumped 1→2 (publication immutability). Verified: `tsc` clean, full suite 161/161. **Advisory on
  purpose:** the blocks stay non-blocking, and the Pi-tool submit path still calls `advance` (not
  `advanceEvaluated`) with no scorer, so **no scoring runs in real agent runs yet** — the blocks are inert
  until the live scorer/driver is wired and the policy flipped to `required`. That wiring (resolve a real
  `Scorer` from `TYPESAFE_API_KEY` and route submit through `advanceEvaluated`) remains the deferred unit,
  to be done and tested with the owner on real agents after approval.
- **2026-10-30 — live quality scorer + policy flip (owner GO).** Owner authorized directly; lead
  records and verifies. Scope: `package.json` (add git dep `pi-jev` `#v0.2.1`),
  `src/quality/jev-scorer.ts` (new adapter implementing the existing `Scorer` port via pi-jev
  `evaluate`, one `noul` question per rubric dimension), `src/quality/index.ts`, `src/pi/tool.ts`
  (`submitOperation` routes through `advanceEvaluated` with an injectable jev scorer; becomes async),
  `tests/quality/jev-scorer.test.ts` (new), and the 12 `.pi/praxis/tasks/**/*.json`
  (`quality.policy` `advisory`→`required`). Acceptance: `tsc` clean; full suite green with NO network
  in any unit test; submit computes a verdict via the pi-jev-backed Scorer (overall = MIN dimension)
  and the engine enforces the floor (`QUALITY_BELOW_THRESHOLD` / `QUALITY_REQUIRED`); all 12 tasks
  read `"required"`; the adapter imports only from `"pi-jev"`. Not authorized: engine/store/schema
  changes, new error codes, flow selection from the tool, OS sandbox / trusted-identity / exactly-once
  claims; the real TypeSafe call stays opt-in and is not asserted in the suite. pi-jev itself
  (`github:tia-lab/pi-jev`) is an owner-published external dependency, built and reviewed as its own
  repo; no `pi-fabric` or Occam code is imported.
- **2026-10-30 — quality rework loop, Units 1+2 (owner GO).** Owner authorized directly after plan
  review (`docs/quality-loop/PLAN.md`); lead records and verifies. Scope: `src/types/pi.ts`
  (`StepDescriptorSchema.brief.quality` + `CODES` gains `QUALITY_BLOCKED`), `src/types/errors.ts` (the
  `Code` union gains `QUALITY_BLOCKED`), `src/types/schema.ts` (`InstanceStatusSchema` gains
  `"blocked"`; `QualitySchema` gains optional `maxAttempts`; the instance row carries a
  `blockedReason`), `src/pi/tool.ts` (populate `brief.quality`; refusal `detail` carries the
  per-dimension verdict), `src/runner/engine.ts` (refusal detail includes `verdict.quality`; on a
  quality refusal derive attempt-count + previous score from `listEvents`, and on budget-exhaust or
  no-progress append `instance.blocked`, `setStatus("blocked")`, throw `QUALITY_BLOCKED`),
  `src/quality/evaluate.ts` (`advanceEvaluated` digest score-cache via `listEvents`),
  `src/runner/result.ts` (surface `blocked`), and the affected tests. Resolved decisions: `maxAttempts`
  default 3, declared per-task on `QualitySchema`, inheritable from the flow-level quality default;
  Units 1+2 ship as ONE unit. Acceptance: agent brief carries the rubric; a below-threshold refusal
  names the failing dimensions with scores; a step blocks after `maxAttempts` or on no-progress with a
  durable `instance.blocked` event; an identical-digest resubmit does NOT call the scorer; `tsc` clean;
  full suite green with NO network in any unit test. Not authorized: Unit 3 (the six-key `Result` R11
  change) and Unit 4 (flow-outcome scorer) — separate units; new store columns (attempt data is derived
  from events); flow-document schema beyond `maxAttempts`; any identity, isolation or exactly-once
  claim.
- **2026-10-30 — onFailure policy + engine refactor (owner GO).** Owner authorized after the
  escalation-design discussion; two SEQUENTIAL units for `wB:p22` with a lead review checkpoint between.
  **Unit A (onFailure policy).** Scope: `src/types/schema.ts` (`QualitySchema` gains
  `onFailure: "escalate" | "continue"`, default `continue`; the terminal escalate state from Units 1+2
  is consolidated from status `"blocked"` to `"failed"` + `failedReason` — lead decision, owner prefers
  “failed”), `src/runner/engine.ts` (on budget exhaustion: `escalate` → status `failed` + emit a
  `needs-guidance` event + throw `QUALITY_BLOCKED`; `continue` → record the FAILED verdict/event and
  advance carrying the last/best-scoring artifact version marked failed), `src/pi/tool.ts`,
  `src/runner/result.ts`, and the affected tests (update Units 1+2 `blocked`→`failed` assertions; add
  `escalate` and `continue` cases). Acceptance: both policies behave per brief; `continue` advances with
  a durable FAILED record; `escalate` halts + emits `needs-guidance`; `tsc` clean; full suite green with
  the no-network stub. **Unit B (engine refactor).** Scope: convert `src/runner/engine.ts` into
  `src/runner/engine/` with `index.ts` **export-only** + cohesion-scoped files (types, start, advance,
  inspect, quality-loop), **every file < 600 lines**; update all importers
  `"../runner/engine.ts"` → `"../runner/engine/index.ts"`. Behavior-identical pure move; `tsc` clean;
  suite count green and unchanged; no logic change. Not authorized: Unit 3 (the six-key `Result` R11
  change), Unit 4 (flow-outcome scorer), Manifold routing of `needs-guidance` (that is Manifold's job,
  documented in `MANIFOLD_INTEGRATION.md` — only `continue` is operational until Manifold is plugged in),
  new store columns (derive from events), and any identity, isolation or exactly-once claim. Lead
  decisions (owner-overridable): default `continue`; terminal status `failed` not `blocked`; `continue`
  advances the best-scoring version. Lead scope record: `src/runner/step.ts` (+40/-4) is added to Unit A scope — because `continue` may accept a non-newest version, `buildHandoffs` resolves the highest ACCEPTED version and `runStep` re-reads the exact handed-off version (digest check intact); found via test failures and disclosed by the engineer.

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
