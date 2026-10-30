# Research — jev alignment gate

Task: jev-alignment-gate · Hash: b8c0e751 · Gate: G1 · Status: draft · Date: 2026-10-30

## 0. Contract

<!-- One physical line per key: this block is the hash input. Never reflow it. -->

task: jev alignment gate: before Praxis acts on an order, judge it against the flow-pinned task and reject a misaligned one, spec-first
scope: docs/<slug>-<hash8>/, later src/quality/jev-align.ts, src/pi/tool.ts, src/types/errors.ts, src/types/pi.ts, tests/
acceptance: research traces the flow pin, role anchor, pi-jev seam and Code union at path:line; spec settles order entry, task anchor, the jev decision, one new typed Code with its pi.ts mirror, and the routing-not-isolation boundary

Recompute:

```sh
canonical() { printf 'task: %s\nscope: %s\nacceptance: %s\n' "$1" "$2" "$3" | sed -E 's/[[:space:]]+$//'; }
canonical "<task>" "<scope>" "<acceptance>" | sha256sum | cut -c1-8   # -> b8c0e751
```

## 1. Question and boundary

**Question.** Praxis has no notion of an *order*: a caller names a flow and a request id, and
the flow it runs is chosen by the environment (F1). If an agent is dispatched with instructions
that do not match the task the flow will make it run, nothing notices. Can Praxis judge that
mismatch before it acts, using a typed model decision over the incoming order and the task the
**pinned flow** already fixes?

**Boundary.** This is routing hygiene: a semantic judgment, typed, logged and correctable. It is
**not** isolation (gate #1 stays open — a bash call or a direct engine call bypasses every tool
check) and **not** trusted identity (gate #3 stays open — the anchor is trustworthy only because
the flow is pinned at spawn, not because the caller is authenticated). No claim beyond that.

## 2. Sources inspected

| Path | What was read | How |
| --- | --- | --- |
| `src/pi/tool.ts` | op=start path, flow resolution, failure envelope, descriptor | read in full |
| `src/types/pi.ts` | tool args, op enum, envelopes, `CODES` mirror | read in full |
| `src/types/errors.ts` | the closed `Code` union | read in full |
| `src/runner/engine/start.ts` | instance creation, pinning, the first write | read in full |
| `src/runner/identity.ts`, `src/runner/engine/authority.ts` | role assignment seam, step-actor check | read in full |
| `src/types/schema.ts` | `RoleNameSchema`, `RoleAssignmentSchema`, `TaskConfig.role`, `.goal` | read |
| `src/quality/jev-scorer.ts` | the existing pi-jev call pattern and its injected seam | read in full |
| `node_modules/pi-jev/src/types.ts`, `index.ts` | `ChoiceQuestion`, `ChoiceAnswer`, `JevRequest`, `evaluate` | read |
| `docs/extras-roadmap-ad609563/PLAN.md` | Unit 3's goal, model, scope, acceptance | read |

## 3. Competing explanations

- **E1: the order should be checked where it is produced** (dispatcher / Manifold). Attractive
  because the worker never touches the order's text. Rejected as the *only* option because the
  dispatcher is not built (Manifold is pinned but inactive) and a check nothing in Praxis calls
  is not enforcement of anything Praxis does; it stays a live alternative (spec A2).
- **E2: the flow document should declare the task's scope and the gate should compare text to
  it.** Rejected: a flow document is a contract about *how* work proceeds, and adding free text
  for a semantic comparison invites editing the contract to pass the gate.
- **E3: the task anchor is the pinned task's `goal` + `role` + the flow id** (chosen shape,
  F4/F5). The order never contributes to the anchor; it is only ever the thing judged.

## 4. Findings

- **F1 [source-inspected]** There is no per-call flow choice: the flow *document* is selected by
  `process.env.PRAXIS_CONFIG` with a fixed default (`src/pi/tool.ts:123`, `src/pi/tool.ts:127-130`),
  and the `flow` argument must merely *agree* with the document's own identity
  (`src/runner/engine/start.ts:19-26`: a mismatch is `CONFIG_INVALID`). — limitation: `--config`
  on the CLI selects the document too (`src/cli.ts`), so "environment" here means the host's
  configured flow, not a field the worker controls.
- **F2 [source-inspected]** `op=start` today takes exactly `flow` and `requestId` (plus optional
  `roles`): `src/types/pi.ts:34`, `:35`, `:41`, required by the refine at `src/types/pi.ts:44-52`;
  the op list is `src/types/pi.ts:21` and the handler is `src/pi/tool.ts:346-362`. There is **no
  `order` argument anywhere** — a grep for `order` in `src/` returns only prose about edge order.
- **F3 [source-inspected]** The first store write of a start is inside `withStore` →
  `transact` (`src/runner/engine/start.ts:32`, `:50-88`); the `instance.created` event follows
  outside it (`src/runner/engine/start.ts:91-101`). Anything that must refute *before any
  mutation* has to run before `start()` is called, or inside it above `:50`.
- **F4 [source-inspected]** The task anchor the flow already fixes, all available without an
  instance via `openFlow` (`src/runner/engine/start.ts:19`): the flow's identity
  `flow.config.flow`, its digest `flow.flowDigest`, the first node's id, and that node's task
  document — whose `goal` is `src/types/schema.ts:200`, optional `role` is
  `src/types/schema.ts:207`, and `capabilities`/`produces` sit beside them. `op=start` already
  resolves all of this before writing.
- **F5 [source-inspected]** Roles are a real, trusted anchor: `RoleNameSchema` and
  `RoleAssignmentSchema` (`src/types/schema.ts:65-70`), pinned immutably at creation
  (`src/runner/engine/start.ts:83-85` under `ROLE_DEFINITION_ID`, `src/runner/identity.ts:19`),
  read through the single seam `roleAssignment` (`src/runner/identity.ts:25-35`) and enforced on
  submit (`src/runner/engine/authority.ts:48-56`). The role map is supplied by the *creator* at
  start, never by the caller's own claim — which is what makes it usable as an anchor field.
- **F6 [source-inspected]** The pi-jev seam is a single adapter with an injectable call:
  `import { evaluate } from "pi-jev"` (`src/quality/jev-scorer.ts:12-13`), the injection point
  `JevScorerOptions.evaluateFn` (`:19-24`), the request built as
  `{ state, questions, model }` with one question per rubric id (`:41-49`), and a strict answer
  assertion `noulOf` (`:27-32`) that throws rather than fabricate. A test injects a fake there
  and no network is touched — the same pattern an alignment judge should reuse.
- **F7 [source-inspected]** pi-jev's typed surface already has the shape this needs:
  `ChoiceQuestion { type: "choice"; instructions; criteria: Record<string,string> }`
  (`node_modules/pi-jev/src/types.ts:3`), `ChoiceAnswer { type: "choice"; choice; confidence? }`
  (`:9`), `JevRequest` (`:13`), and `evaluate` exported from
  `node_modules/pi-jev/src/index.ts:2`.
- **F8 [source-inspected]** The error taxonomy is a closed union of 29 codes
  (`src/types/errors.ts:21-50`) mirrored at runtime by `CODES`
  (`src/types/pi.ts:185-215`), which is `as const satisfies readonly Code[]` so a drift is a
  compile error. A refusal reaches the agent as `{ code, message, detail }` through
  `failure()` (`src/pi/tool.ts:324-343`) and `failure` never throws
  (`src/pi/tool.ts:574-583`).
- **F9 [source-inspected]** A rejected start cannot be recorded as an event: `event.instance`
  is a foreign key to `instance(id)` and the event log is append-only, so an event needs an
  instance that a refusal deliberately does not create (`src/store/db.ts` schema;
  `src/runner/engine/start.ts:91-101`). "Logged" therefore has two candidate homes: the refusal
  `detail` (visible to the caller, in the session transcript) or a new durable record that
  would have to sit outside the instance scope.
- **F10 [source-inspected]** The accepted skill states `op=start` as `{ flow, requestId }`
  (`.pi/skills/praxis/SKILL.md`, section 1 and the op table), so a new required start argument
  is a *documentation* dependency of this unit as well as a tool-contract change.

## 5. Affected owners and callers

| Owner | Effect |
| --- | --- |
| `src/pi/tool.ts` (`startOperation`) | the check runs here, before `start()`; the refusal envelope is already the tool's |
| `src/types/pi.ts` | one new optional/required arg key on `PraxisToolArgsSchema`; `CODES` gains the new code |
| `src/types/errors.ts` | the closed union gains one member |
| `src/quality/` (new module) | the judge, mirroring `jev-scorer.ts`'s adapter shape and its injected seam |
| `tests/` | a fake judge through the injected seam; an aligned order proceeds, a misaligned one is refused with zero writes |
| `.pi/skills/praxis/SKILL.md` | must teach the new argument (doc dependency, F10) |
| `src/cli.ts` / engine `start()` | **untouched**: the CLI carries no order and stays outside the gate |

## 6. Uncertainty and open questions

- **Q1 (the owner's decision 1).** Where the order enters: a tool argument on `op=start`
  (required or optional?) or a dispatcher-side check. The trade-off is in spec D1; it decides the
  whole shape, and it is owner-visible because it changes the tool contract.
- **Q2.** Whether "logged" must be durable. A refusal has no instance (F9), so durability would
  need a new record outside the instance scope — a store change this unit's scope does not
  cover. The recommendation keeps the record in the refusal detail and states the limit.
- **Q3.** Whether the judge should also see the *step* the flow would run first, rather than the
  flow's first task only. Checked: `op=start` always begins at the first node
  (`src/runner/engine/start.ts:30`, `:56`), so the first task *is* the step.
- **Q4.** Model cost and latency on every start: one extra typed call, bounded by a single
  question; no retry, fail-closed. Acceptable for a start, which happens once per unit of work.

## 7. Handoff

Spec: `spec.md` in this folder, which settles D1–D5 and carries the requirement table, the
failure code, the model, exclusions and alternatives. No code until the spec passes (G2).

amended 2026-10-30 — F2's refine citation corrected from `src/types/pi.ts:47-50` to `:44-52` after re-reading the block — the original range pointed one function too far down.
amended 2026-10-30 — F10 added after the review pass: the accepted skill states `op=start` as `{ flow, requestId }`, so the new argument is a documentation dependency as well as a tool-contract change.
