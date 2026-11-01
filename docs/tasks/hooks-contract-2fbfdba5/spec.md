# Spec — hooks contract

Task: hooks-contract · Hash: 2fbfdba5 · Gate: G2 · Status: draft · Date: 2026-10-30
Contract: `research.md` §0 (the hash input). Research: `research.md` (F1–F8).

## Outcome

A project can bind code to the four mutating `praxis` ops: `before_<op>` runs at entry and may
veto an op fail-closed before it writes anything; `after_<op>` runs once the op has produced its
recorded outcome and can only observe — it cannot veto, and a throw from it is contained and
logged. Neither ever runs inside a store transaction. A hook cannot widen authority: it can only
subtract (veto) or watch. With no binding registered, every op behaves byte-identically.

## Decisions

### D1 — The closed taxonomy and the typed payload per hook (`src/types/hooks.ts`)

Eight names, closed, derived from the four ops: `before_start`, `after_start`,
`before_check`, `after_check`, `before_submit`, `after_submit`, `before_note`, `after_note`.
`read`, `issue.template` and `issue.open` are **not** hooked (a query and diagnostics; no
composer acts on them).

| Hook | Payload | Why exactly this |
| --- | --- | --- |
| `before_start` | `{ op: "start", flow, requestId, orderDigest, anchor }` | the decision inputs: what is being started, and the flow-pinned anchor (D2 of Unit 3). The order **text** is not passed — only its digest — the same rule Unit 3 set |
| `after_start` | `{ op: "start", instance, status, step }` | what now exists |
| `before_check` | `{ op: "check", instance, step, artifact, artifactDigest }` | a composer that validates structure needs the bytes |
| `after_check` | `{ op: "check", instance, step, ok, missing[] }` | the dry run's verdict, nothing else |
| `before_submit` | `{ op: "submit", instance, step, artifact, artifactDigest }` | same as `before_check`: the bytes are the thing being vetted |
| `after_submit` | `{ op: "submit", instance, step, decision: "accepted" \| "refused", verdict? }` where `verdict = { score, mean, dimensions[{id,score}], flagged[], refused[], rubricDigest }` | the owner's requirement: **accepted-or-refused plus the verdict**. The verdict is read from the recorded `quality.verdict` event (`inspect(...).qualityHistory`), so no engine signature changes; a task with no floor has no verdict and the field is absent |
| `before_note` | `{ op: "note", instance, step, subjective }` | a policy hook can refuse a reflection it considers inadequate |
| `after_note` | `{ op: "note", instance, step, noteVersion, stub }` | what was recorded, including the stub case |

One payload type per hook, and a name→payload map so a binding is typed against its own name
(`registerHook({ name: "before_submit", … run: (payload: BeforeSubmitPayload) => … })`).

**When `after_` fires.** Exactly when the op produced its outcome: an accepted *or* refused
submit (both write evidence), a check that answered `{ok, missing}` (a dry run, no write), a
start that created or re-opened an instance, a note or stub that was recorded. It does **not**
fire when the op failed before doing anything — argument parse, a `before_` veto, the alignment
refusal, a capability denial, an unknown instance. That rule is what makes the seam predictable;
it is one assertion per case (R7).

### D2 — Registry and ordered dispatch (`src/runner/hooks.ts`)

```ts
registerHook<P>(binding: { name: HookName; id: string; run: (payload: P) => void | Promise<void> }): () => void
resetHooks(): void                     // tests only
dispatchBefore(name, payload): Promise<{ vetoed: false } | { vetoed: true; reason: string; hook: string }>
dispatchAfter(name, payload): Promise<{ failures: { hook: string; reason: string }[] }>
```

- **Order guarantee**: bindings run in **registration order**, sequentially (`await` each), so a
  veto is deterministic and the first veto wins. No parallelism, no reordering, no priority field.
- **Identity**: `id` is unique per hook name; registering a duplicate id throws at *compose* time,
  never at op time.
- **Inside the ceiling**: dispatch receives plain data and returns a verdict; it is given no
  `Grant`, no `Store`, no engine handle, and no way to return capabilities. The tool calls it
  **after** its own authority and grant decisions (F3), so a hook can only subtract.
- **No dependency**: the registry is a module-level list, the same shape as the two injected
  seams the repo already uses (F5), with an explicit `resetHooks()` for tests.

### D3 — `before_` veto: a NEW code `HOOK_VETOED` (recommendation)

**Recommendation: add `HOOK_VETOED`, do not reuse `GATE_REJECTED`.**

- `GATE_REJECTED` already means "the artifact failed the gate" (schema, nonce, sections,
  subject). A hook veto is a different *cause* and a different *remedy*: the artifact may be
  perfectly well-formed, and the agent's next action is to escalate, not to edit bytes.
- The taxonomy already gives every cause class its own member — `QUALITY_*`, `SUBJECT_*`,
  `PIN_*`, `TASK_*`, `ALIGNMENT_REJECTED` — so a new class is the consistent move, not a
  widening for convenience.
- Cost is the established one: one member in `Code`, one in the `CODES` mirror (which stays
  `as const satisfies readonly Code[]`), and `TAXONOMY_SIZE` 30 → 31.
- Reusing `GATE_REJECTED` would make two very different refusals indistinguishable in the record,
  which contradicts the unit's own "typed, visible, correctable" requirement.

Semantics: a veto throws `fail("HOOK_VETOED", …)` from the handler **before** any engine call, so
it travels through the one refusal path (F4) and is **write-free** (no instance, event, artifact,
pin or publication). Detail: `{ hook: "<name>/<id>", name, reason }`. A `before_` hook that
**throws** is a veto too (`reason: "hook threw: <cause>"`): fail-closed, and its own failure cannot
be mistaken for permission.

### D4 — `after_` containment, and where it is logged

An `after_` hook runs after the op's value exists. It is never awaited for correctness of the
result: each hook is wrapped, a throw is caught, and the op's return value is passed through
unchanged. Failures are collected and **logged to stderr** as one line each:
`[praxis] hook <name>/<id> failed after <op>: <cause>`.

Durability, stated plainly rather than implied: this is **not** a durable record. An instance-less
op has no row to hang one on (`event.instance` is a foreign key to `instance(id)`, F7 — the same
limit Unit 3 recorded), and writing a store row from a hook-failure path would be a store change
this unit excludes. stderr is the honest channel: visible in the session, not persisted. A durable
hook-failure record is an alternative (A3), not a hidden promise.

### D5 — Nothing else changes

No store schema, no flow schema, no new result key, no new dependency, no engine signature change.
With the registry empty, `dispatchBefore` returns `{vetoed: false}` and `dispatchAfter` returns
`{failures: []}` without touching the payload: every existing op envelope stays byte-identical, and
the suite's existing deep-equal envelope assertions are the oracle for that.

### D6 — Boundary

Hooks are a **composition seam inside the capability ceiling**: they are registered by the host
(a project, an extension, a test), run in-process at the tool boundary, can only veto or observe,
and grant nothing. This is **not isolation** (gate #1: bash and direct engine calls bypass every
hook) and **not trusted identity** (gate #3: a hook does not authenticate anyone). A veto is
visible and correctable, like every other typed refusal.

## Requirements

| Id | Requirement | Failure behaviour | Oracle |
| --- | --- | --- | --- |
| R1 | `src/types/hooks.ts` declares exactly the eight names of D1 and one payload type per hook, with a name→payload map so each binding is typed against its own name. | a ninth name or a payload without its declared fields → compile error | `tsc --noEmit`; a type-level test that a wrong payload for a name does not compile |
| R2 | `registerHook` appends to a per-name ordered list and returns an idempotent unregister; `resetHooks` clears every list; a duplicate `id` under one name throws at registration. | duplicate id → throw at compose time, no op affected; unregister twice → no error | unit test: register A, B; dispatch order is A then B; unregister A; dispatch is B only; duplicate id throws |
| R3 | `before_<op>` runs at op **entry**, before the op's first write and before any external call it makes on the op's behalf (for `start`: before the alignment judge), in registration order, and the first veto wins. | a veto refuses the op with `HOOK_VETOED` (D3), detail `{hook, name, reason}`, and the op performs **no** write | for each of the four ops: a vetoing `before_` hook → `HOOK_VETOED`; the five row counts (instance, event, artifact, definition, publication) unchanged and, in a fresh project, no store file created |
| R4 | A `before_` hook that throws is a veto (fail-closed) with `reason: "hook threw: <cause>"`, not a pass. | as a veto: `HOOK_VETOED`, write-free | a throwing hook on each op → `HOOK_VETOED` naming the throw |
| R5 | Hooks receive exactly their declared payload and nothing more; `before_start` never receives the order text, only its digest and the anchor. | an extra field on a payload → compile error (closed object types, no index signature) | the payloads recorded by fake hooks asserted field by field; the order text absent from `before_start`'s payload |
| R6 | `after_<op>` runs only after the op produced its recorded outcome (D1's rule), in registration order; it cannot veto, and its return value is ignored. | an `after_` hook that returns a veto shape changes nothing in the result | for each op: the hook ran, the envelope deep-equals the no-hook envelope |
| R7 | A throwing `after_` hook is contained: the op's result is unchanged, the failure is collected and logged to stderr, and no other hook's execution is skipped. | a throw from hook 1 of 2 → hook 2 still runs; the op succeeds; stderr carries one line naming hook 1 | two `after_` hooks, the first throwing: both recorded, the envelope identical, the stderr line asserted |
| R8 | `after_submit` carries `decision: "accepted" | "refused"` and, when the step has a quality floor, the recorded verdict (score, mean, dimensions, flagged, refused, rubricDigest). | a task without a floor → the verdict field is absent, not fabricated | two submits (one accepted, one refused) assert the decision and the verdict fields; a floorless task asserts absence |
| R9 | Neither hook runs inside a store transaction, and no hook may be given a `Store`, `Grant` or engine handle. | a hook implementation that reaches for one → compile error (the payload type is the only input) | the dispatch signatures take only `(name, payload)`; a review of the module's imports (no `store/`, no engine import) |
| R10 | With no hooks registered, every op is byte-identical to the pre-unit behaviour: same envelopes, same events, no stderr. | any observable difference with an empty registry is a defect | the suite's existing envelope deep-equals, plus one case per op asserting the envelope and the stderr channel are unchanged |
| R11 | `HOOK_VETOED` joins the `Code` union and the `CODES` mirror; the mirror keeps `as const satisfies readonly Code[]`; `TAXONOMY_SIZE` becomes 31. | a drift → compile error or a failing taxonomy test | `tsc --noEmit` plus `tests/types/errors.test.ts` |

## Failure codes

One addition, no repurposing: **`HOOK_VETOED`** (`src/types/errors.ts` + the `CODES` mirror in
`src/types/pi.ts`), emitted only by a `before_` veto (including a throwing `before_` hook).
An `after_` failure emits **no code**: it is contained, logged to stderr, and invisible to the
result by design.

## Model

```
op=<one of start|check|submit|note>(args)
  -> parse (CONFIG_INVALID)                                (unchanged)
  -> [start only] openFlow + anchor                        (read-only, F2)
  -> dispatchBefore("before_<op>", payload)                (D2: ordered, inside the ceiling)
       veto | throw  -> fail(HOOK_VETOED, {hook,name,reason})   NO write at all (R3, R4)
  -> [start only] alignment judge                          (Unit 3, a built-in before_start veto)
  -> the op runs; its store writes commit in their own transactions (F2, never around a hook)
  -> dispatchAfter("after_<op>", payload)                  (only when the op produced its outcome)
       hook throws -> caught, collected, one stderr line, result unchanged (D4)
  -> the op's envelope, unchanged by any hook
```

## Exclusions

- No isolation and no identity claim (gates #1 and #3 stay open): hooks are in-process composition.
- No hook signature over `read`/`issue.*` (the owner's scope).
- No durable hook-failure record (F7 / A3): stderr only, stated as a limit.
- No store-schema, flow-schema, result-key or dependency change; no engine signature change; no
  hook access to `Store`, `Grant` or the engine.
- No hook priority, parallelism, retry or transformation: a hook may stop an op or watch it, and
  that is the whole contract.

## Alternatives

- **A1 — hooks in the engine at the store boundary.** Rejected (E1): the engine is synchronous
  inside `withStore`; a hook there would run inside the transaction or force the engine async.
- **A2 — hooks in the Pi extension host.** Rejected (E2): Praxis could then not guarantee order,
  veto-before-write or that the ceiling bounds them.
- **A3 — a durable hook-failure record.** Needs a store change (F7); named, not done.
- **A4 — reuse `GATE_REJECTED` for a veto.** Rejected in D3: indistinguishable from an artifact
  rejection, and the remedy differs.
- **A5 — a hook that may transform the payload (e.g. rewrite the artifact).** Rejected: it would
  turn an observation seam into a second author of the artifact, and the digest/gate would no
  longer describe what the caller sent.

## Open questions

- **Q4.** Whether `before_check` should be allowed to see the recorded requirement set as well as
  the artifact (useful for a linter that reports in the same shape as `missing[]`). Deferred: the
  payload can be widened additively later without breaking a binding.
- **Q5.** Whether the eight names should also cover a future `resume`-style op; the taxonomy is
  derived from the ops, so a new op adds two names in its own unit.

amended 2026-10-30 — D1's "when after_ fires" now says a check produced its {ok, missing} answer rather than a verdict (a dry run records nothing, so it has no verdict) — the earlier wording would have implied a recorded judgement the op does not make.
amended 2026-10-30 — D1's note corrected: the after_submit verdict for an ACCEPTED submit is read with an explicit qualityHistory(store, instance, step) for the judged step, not inspect's currentStep (which has already advanced past it); R8 is unchanged.

## §4 note — not waivable

This unit introduces a **new type contract** (`src/types/hooks.ts`), a **new runtime seam**
(`src/runner/hooks.ts`) and one new member of the closed **`Code` union**, so the §4 waiver does
not apply: G2 must pass before any code, and the plan is required.
