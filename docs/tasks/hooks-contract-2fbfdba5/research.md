# Research — hooks contract

Task: hooks-contract · Hash: 2fbfdba5 · Gate: G1 · Status: draft · Date: 2026-10-30

## 0. Contract

<!-- One physical line per key: this block is the hash input. Never reflow it. -->

task: hooks contract: eight before_/after_ hooks over start, check, submit and note; before_ may veto write-free, after_ is contained, neither runs inside a store transaction; spec-first
scope: docs/<slug>-<hash8>/, later src/types/hooks.ts, src/runner/hooks.ts, src/pi/tool.ts, src/types/errors.ts, src/types/pi.ts, tests/
acceptance: research traces the four op entry points, the commit boundary, the capability ceiling, the refusal path and the injectable seam at path:line; spec settles the hook taxonomy and typed payloads, the registry with ordered dispatch, the veto code and its write-free proof, after_ containment, the no-schema/no-new-key rule, and the composition-not-isolation boundary

Recompute: `printf 'task: %s\nscope: %s\nacceptance: %s\n' "<t>" "<s>" "<a>" | sed -E 's/[[:space:]]+$//' | sha256sum | cut -c1-8` → `2fbfdba5`.

## 1. Question and boundary

**Question.** Praxis has exactly one composition seam that other software can act on: the four
mutating ops of the `praxis` tool. Can a project bind code to those ops — vetting them before they
act and observing them after they commit — without giving that code any way to amplify authority,
and without ever holding a store transaction across it?

**Boundary.** A composition seam **inside** the capability ceiling. Not isolation (gate #1 stays
open), not identity (gate #3 stays open). A hook may subtract (veto) or observe; it may never add.

## 2. Sources inspected

| Path | What was read | How |
| --- | --- | --- |
| `src/pi/tool.ts` | all op handlers, the dispatcher, the two existing injection seams, `failure()` | read in full |
| `src/runner/engine/start.ts` | the instance transaction and the event after it | read in full |
| `src/runner/engine/advance.ts` | the advance path, where an acceptance commits | read |
| `src/runner/note-gate.ts` | the note lifecycle, its store handle and its writes | read |
| `src/runner/capabilities.ts`, `src/runner/engine/authority.ts` | the ceiling and the authority checks | read |
| `src/types/errors.ts`, `src/types/pi.ts` | the closed `Code` union and its `CODES` mirror | read |
| `docs/jev-alignment-gate-b8c0e751/` | Unit 3's gate, its flag and its F9 finding | read |

## 3. Competing explanations

- **E1: hooks belong in the engine, at the store boundary.** Rejected as the primary seam: the
  engine is synchronous inside `withStore`, and a hook there would either run inside the
  transaction (forbidden) or force the engine to become async. The tool boundary is already async
  and already owns the refusal envelope.
- **E2: hooks belong in the extension host (Pi), not in Praxis.** Rejected: then Praxis could not
  guarantee ordering, veto-before-write, or that the ceiling bounds them; the contract would be
  someone else's.
- **E3: hooks are a registry bound by the host, dispatched by the tool, before and after each op**
  (chosen shape). It reuses the pattern the repo already uses for injected dependencies.

## 4. Findings

- **F1 [source-inspected]** Four mutating ops have one entry point each in the tool:
  `startOperation` (`src/pi/tool.ts:365`), `submitOperation` (`:494`), `noteOperation`
  (`:521`), `checkOperation` (`:550`); `readOperation` (`:560`) and `issueOperation`
  (`:585`) are not hooked. The dispatcher is `executePraxisTool` (`:614`), which routes at
  `:622-626` and wraps everything in one try/catch that turns any throw into the typed
  `failure()` envelope — so a before-hook veto can simply throw `fail(...)` and be delivered like
  every other refusal.
- **F2 [source-inspected]** The durable commit boundary for a start is `withStore`
  (`src/runner/engine/start.ts:32`) around `transact` (`:50-88`), with the `instance.created`
  event appended after that transaction (`:91-101`). For an advance it is `withStore`
  (`src/runner/engine/advance.ts:46`) with acceptance events written inside it; for a note,
  `withStore` (`src/runner/note-gate.ts:297`, `:362`). Every one of these is **synchronous** and
  self-contained, so a hook must run outside them: `before_` before the call, `after_` after the
  returned value exists. Nothing in the engine needs to change.
- **F3 [source-inspected]** The ceiling is `Grant` with `grantFor`/`requireGrant`/`call`
  (`src/runner/capabilities.ts:25`, `:39`, `:55`, `:76`) plus the authority checks
  `assertObserver`/`assertStepActor` (`src/runner/engine/authority.ts:36`, `:48`). Authority is
  decided **before** any artifact or instance is touched, so a hook dispatched after those checks
  runs inside an already-decided ceiling: it can refuse, and it has no API by which to widen a
  grant.
- **F4 [source-inspected]** A refusal is one path: `fail(code, message, detail)`
  (`src/types/errors.ts:67`) producing an `AppError` whose `code` is a member of the closed
  `Code` union (`:21-52`), mirrored by `CODES` in `src/types/pi.ts` and delivered by
  `failure()` (`src/pi/tool.ts:325`) as `{code, message, detail}`.
- **F5 [source-inspected]** The repo already has the injection pattern hooks would need, twice:
  `setAlignJudgeForTest` (`src/pi/tool.ts:351-356`) and `setScorerForTest` (`:409-414`), both a
  module-level override with a documented default. That is a *test* seam, not a registry: there is
  no ordering, no multiple bindings, no lifecycle. Hooks therefore need a small registry module,
  built the same way (a module-level list with an explicit reset), rather than a new dependency.
- **F6 [source-inspected]** Unit 3's alignment gate is already a `before_start` veto in all but
  name: it runs at the top of `startOperation` (`src/pi/tool.ts:365-380`), before any write,
  reads its anchor from the flow document, and refuses with a typed code. It is the proof that the
  seam this unit specifies is real, and it fixes the ordering question: registered `before_start`
  hooks run first (no external call, deterministic), then the built-in alignment gate (spec D1).
- **F7 [source-inspected]** A post-commit failure has no durable home when no instance exists:
  `event.instance` is a foreign key to `instance(id)` and the log is append-only
  (`src/store/db.ts` schema, `src/runner/engine/start.ts:91-101`). Unit 3 hit the same limit (its
  F9). Containment logging therefore cannot be a store write without a store change, which this
  unit's scope excludes.
- **F8 [source-inspected]** The tool is the only async layer: `advanceEvaluated` is awaited inside
  `submitOperation` (`src/pi/tool.ts:494-519`), `startOperation` became async in Unit 3
  (`:365`), while `noteOperation` and `checkOperation` are synchronous. A `dispatch` that
  returns a promise is callable from all four without changing any engine signature.

## 5. Affected owners and callers

| Owner | Effect |
| --- | --- |
| `src/types/hooks.ts` (new) | the closed hook-name taxonomy and one typed payload per hook |
| `src/runner/hooks.ts` (new) | the registry, ordered dispatch, veto and containment |
| `src/pi/tool.ts` | eight call sites: four at entry, four after the op produced its outcome |
| `src/types/errors.ts` + `src/types/pi.ts` | one code for a veto, in the union and the mirror |
| `tests/` | order, veto-before-write, containment, no-binding-is-a-no-op |
| `.pi/skills/praxis/SKILL.md` | nothing: hooks are host-side composition, not agent conduct |

## 6. Uncertainty and open questions

- **Q1 (decision 3).** The veto code: reuse `GATE_REJECTED` or add `HOOK_VETOED`. Argued in
  spec D3; the recommendation is a new code, because the taxonomy already gives each cause class
  its own member and an agent must be able to tell "my artifact was wrong" from "a composition
  policy refused this".
- **Q2.** Whether `after_submit` should fire on a refusal as well as an acceptance. Argued in
  spec D1: a refusal that *recorded* a verdict is an outcome a composer wants to see, so yes;
  an op that failed before recording anything is not.
- **Q3.** Whether hooks should see the raw artifact. Proposed yes for `before_check` and
  `before_submit` (that is what a linter-style composer needs) and never the order text (only its
  digest), consistent with Unit 3.

## 7. Handoff

Spec: `spec.md` in this folder (D1–D6, requirements, failure behaviour, oracles). No code until
the spec passes (G2).
