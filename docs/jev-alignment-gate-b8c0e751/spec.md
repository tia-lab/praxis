# Spec — jev alignment gate

Task: jev-alignment-gate · Hash: b8c0e751 · Gate: G2 · Status: draft · Date: 2026-10-30
Contract: `research.md` §0 in this folder (the hash input). Research: `research.md`.

## Outcome

Before Praxis acts on an order, an independent typed judgment asks whether that order actually
belongs to the task this flow will make the agent run. A mismatch is refused with one typed code,
**before any instance exists or any store row is written**, and the refusal names the order's
digest, the anchor it was judged against, and the judge's reason. An aligned order proceeds
exactly as today.

## Decisions (settled here; D1 is owner-visible)

### D1 — Where the order enters: the `order` argument on `op=start` (RECOMMENDED, contract change)

The order is a **required** string argument of `op=start` in `src/pi/tool.ts`, and the check
runs at the top of `startOperation` **before** `start()` is called (F3). Stated plainly: this is
a tool-contract change — one new argument on the one tool, visible in the host parameters, and
the accepted skill must be updated to teach it (F10).

Why this form:
- it is the only place the order and the pinned anchor are both available before a write;
- **required**, not optional: an optional argument makes the gate advisory and silent when
  omitted, and the worker is exactly the party whose order is being judged;
- the refusal uses the envelope that already exists (`{code, message, detail}`, `failure()`,
  F8), so no new failure path is invented;
- it is testable with the injected seam the codebase already uses for pi-jev (F6).

Rejected alternatives in A1–A3. Known reach: the CLI (`src/cli.ts` → engine `start`) carries no
order and stays outside the gate; this is routing hygiene for the routed tool path only, and it
is stated as a limit, not a claim.

### D2 — The task anchor comes from the pinned flow, never from the order

Exactly these fields, all resolved by `openFlow` before any write (F4/F5):

| Anchor field | Source |
| --- | --- |
| flow identity | `flow.config.flow` |
| flow digest | `flow.flowDigest` (proves which document was judged) |
| first step id | `flow.config.nodes[0].id` — start always begins there (F4/Q3) |
| task goal | that node's task `goal` (`src/types/schema.ts:200`) |
| task role | that task's `role` when declared (`src/types/schema.ts:207`), else absent |
| produced schema | that task's `produces.schema` |

The order contributes **one** thing: the text being judged. It never contributes to the anchor,
and no field of the order is trusted for anything.

### D3 — The jev decision: one typed `choice` question, injected in tests

A new module `src/quality/jev-align.ts` mirroring `src/quality/jev-scorer.ts`'s shape (F6/F7):

- `AlignJudge` port: `(input: { order: string; anchor: Anchor }) => Promise<AlignmentVerdict>`;
- the real adapter builds **one** `ChoiceQuestion` keyed `alignment` with
  `criteria: { aligned: <the anchor's goal, role and flow>, misaligned: "anything else" }` and
  `instructions` carrying the anchor and then the order verbatim, and calls
  `evaluate({ state, questions, model })` — the same `evaluate` import as the scorer;
- the answer is read strictly: not `type: "choice"` or a `choice` outside the two criteria is a
  **throw**, never a guess (the `noulOf` precedent, `src/quality/jev-scorer.ts:27-32`);
- `AlignmentVerdict = { decision: "aligned" | "misaligned"; reason: string; model: string; orderDigest: string }`
  where `orderDigest = digest(order)` (the text itself is never stored or logged);
- **judge-unavailable PROCEEDS WITH A VISIBLE FLAG** (owner decision ii): a throw, a timeout or
  an unreadable answer becomes `decision: "unavailable"` with
  `reason: "judge unavailable: <cause>"`, and the start proceeds as *aligned-but-unchecked*. A
  model outage must not halt every start: alignment is routing hygiene, not a safety gate. Only a
  genuine `misaligned` verdict refuses. The unchecked fact is made visible (D3a), so it is never
  silent;
- tests inject a fake judge (no network), exactly as `evaluateFn` is injected today.

### D3a — Where the "unchecked" flag surfaces (agent and parent, no new result key)

The flag must be visible to both parties and must not add a key to the six-key result:

| Party | Field | Value |
| --- | --- | --- |
| agent | `step.alignment` on the step descriptor — an **additive optional** field (`src/types/pi.ts`) | `{ decision: "unchecked", reason: "judge unavailable: <cause>", orderDigest: "sha256:…" }` |
| parent | the existing `summary` key (a string) gains one clause | `"…; alignment unchecked: judge unavailable: <cause>"` |

`ResultSchema` is unchanged and `src/runner/result.ts` is untouched: the tool composes the
amended summary from the value the result already returns, so the six keys stay exactly six
(a string is being extended, not a key added). When the judge answers `aligned`, neither field is
present and the envelope is exactly what it was before this unit.

### D4 — One new typed Code, mirrored

`ALIGNMENT_REJECTED` is added to the closed `Code` union (`src/types/errors.ts:21-50`) and to
`CODES` (`src/types/pi.ts:185-215`). The mirror is `as const satisfies readonly Code[]`, so a
missing or extra entry is a compile error (F8): the two cannot drift. No other code changes
meaning; a misaligned order is never `CONFIG_INVALID`.

The refusal detail (the refusal **and** its record, F9/Q2):

```json
{ "flow": "flows/engineering/feature", "step": "research",
  "decision": "misaligned", "reason": "<judge reason>", "model": "<model id>",
  "orderDigest": "sha256:…",
  "anchor": { "flow": "flows/engineering/feature", "flowDigest": "sha256:…",
              "step": "research", "goal": "<task goal>", "role": "architect" } }
```

Fail-closed and write-free: the refusal happens before `start()`, so no instance row, no pin,
no event and no artifact exist afterwards. The order text is not stored; its digest is.

### D5 — The boundary, stated in the code and the docs

Routing hygiene, logged and correctable: a wrong reject is visible (code + reason + anchor +
digest in the refusal) and correcting it means correcting the order or the anchor, never
silently retrying. It is **not isolation** (gate #1 open: bash, a direct engine call, or the CLI
bypass every tool check), and **not trusted identity** (gate #3 open: the anchor is trusted only
because the flow is pinned at spawn by the runtime, never because the caller proved who it is).
The judge is a model, so it can be wrong; the gate narrows misrouted work, it does not certify it.

## Requirements

| Id | Requirement | Failure behaviour | Oracle |
| --- | --- | --- | --- |
| R1 | `op=start` requires a non-empty `order` string (1..4000 chars) in addition to `flow` and `requestId`; a missing or empty order is refused at the argument parse. | missing/empty/`op=start` without it → `CONFIG_INVALID` naming the field, zero writes | a start without `order` → `CONFIG_INVALID` and `select count(*) from instance` unchanged |
| R2 | The gate resolves the anchor from the flow document the start would pin — `flow.flowDigest`, the flow id, the first node's id, that task's `goal`, optional `role`, and `produces.schema` — before calling `start()`, so the anchor is the document that would be pinned, not the library re-read later. | a flow that cannot be opened → the existing `FLOW_INVALID` / `TASK_NOT_FOUND` codes, unchanged, zero writes | a test that changes the library between the two reads shows the judged digest equals the pinned digest |
| R3 | The judge is given the order verbatim and the anchor only; it returns one of three verdicts — `aligned`, `misaligned` or `unavailable` — with a reason, a model id and the order digest, and it never sees or is steered by any field of the order other than the text being judged. | an unreadable/absent answer, a throw or a timeout → `unavailable`: the start **proceeds** and the fact is flagged (R9), never silently and never as a refusal | a fake judge asserting its received input contains the anchor fields and the order text and nothing else, and three fakes (aligned / misaligned / throwing) asserting the three outcomes |
| R4 | `misaligned` refuses with `ALIGNMENT_REJECTED` before any instance row, pin row, publication, event or artifact is written, carrying the detail in D4. | `ALIGNMENT_REJECTED`; `instance`, `event`, `artifact`, `definition` and `publication` row counts unchanged | row counts before/after across all five tables, plus a store-file digest comparison |
| R5 | `aligned` proceeds exactly as today: the same six-key result, the same descriptor, the same nonce, no new write and no new event. | n/a (the pass path is unchanged) | the aligned start's envelope deep-equals the pre-unit envelope for the same fixture, with only `order` added to the request |
| R6 | `ALIGNMENT_REJECTED` exists in `Code` and in `CODES`, and the two lists cannot drift. | a drifted mirror → `tsc` error (`as const satisfies readonly Code[]`); a stale count → the taxonomy test fails | `tsc --noEmit` exit 0 and, in the plan, `TAXONOMY_SIZE` raised to 30 at `tests/types/errors.test.ts:56` (`MIRROR.length === TAXONOMY_SIZE`), which is the assertion that already freezes the union |
| R7 | The judgment is logged where a refusal can be seen and acted on: the code, reason, model, order digest and anchor travel in the refusal `detail`. Durable storage of a refusal is explicitly **not** in this unit (no instance exists to hang an event on). | a silent refusal (code without reason/anchor/digest) counts as a failure of this requirement | the refusal's `detail` asserted field by field |
| R8 | No other path changes: the CLI start, the engine `start()` signature, the flow schema, the store schema and the six result keys are untouched. | a change outside `src/quality/jev-align.ts`, `src/pi/tool.ts`, `src/types/errors.ts`, `src/types/pi.ts` and `tests/` → out of scope, stop | `git diff --name-only` limited to the declared paths |
| R9 | An `unavailable` verdict proceeds and is visible to the agent (`step.alignment` = `{decision: "unchecked", reason, orderDigest}`) and to the parent (a clause appended to the existing `summary` string), with **no new result key** and no change to `src/runner/result.ts`. | a silent unchecked start (no descriptor field and no summary clause) is a failure of this requirement; an `aligned` verdict must add neither field | the unavailable path asserts the descriptor field and the summary clause; the aligned path asserts both are absent and the envelope deep-equals the pre-unit shape |

### Failure codes

One addition, no repurposing: **`ALIGNMENT_REJECTED`** (`src/types/errors.ts`), mirrored in
`src/types/pi.ts`. It is emitted **only for a genuine `misaligned` verdict** — an unavailable
judge emits no code at all, it proceeds with the D3a flag. Everything else the start path can
already say keeps its meaning.

## Model

```
op=start { flow, requestId, order }
  -> engineOptions(ctx)                     (unchanged: the flow document is env-pinned, F1)
  -> openFlow(options)                      (read-only; the anchor source, F4)
  -> anchor = { flowId, flowDigest, step, goal, role?, produces }   (D2: never from the order)
  -> judge({ order, anchor })               (one typed choice question, injected in tests, D3)
       misaligned   -> fail(ALIGNMENT_REJECTED, …, detail)                (no write at all)
       unavailable  -> start(…) then flag: step.alignment + a summary clause   (D3a, R9)
       aligned      -> start({ flow, requestId, actor, roles })            (unchanged path)
```

## Exclusions

- No isolation, no sandbox, no blocked alternate path (gate #1): `bash`, Fabric, direct engine
  calls and the CLI are outside this gate, and the spec says so rather than implying otherwise.
- No trusted-identity claim (gate #3): the anchor is trusted because the flow is pinned, not
  because the caller is authenticated.
- No durable record of a refusal (F9/Q2): that needs a store-scoped record and its own unit.
- No new dependency, no flow-schema field, no store schema change, no change to the six result
  keys, no scoring change.
- No prompt-side enforcement: the skill teaches the argument; only the code refuses.

## Alternatives

- **A1 — dispatcher-side check.** The order is judged where it is produced (Manifold/lead) and
  the worker never sees the gate. Cleanest separation, but nothing in Praxis enforces it, the
  dispatcher is not built, and it cannot be tested through the routed tool. Recorded as the
  preferred *long-term* complement, not a substitute.
- **A2 — optional `order`.** No break for existing callers, but the gate then runs only when the
  judged party chooses to submit to it; rejected for that reason.
- **A3 — anchor from the flow document's prose or a new `scope` field.** Rejected (E2): a
  contract field written to be compared invites editing it to pass.
- **A4 — durable refusal record** (a new store table or an instance-less event). Out of scope
  here; named so the gap is explicit.

## Open questions

- **Q5.** Whether the judge should also receive the *capabilities* the first step grants (for a
  sharper "does this order need more authority than the task has" signal). Deferred: the first
  cut judges fit-to-task, and every extra field is one more thing to keep out of the order.
- **Q6.** Model choice and budget for the judge: one call, no retry, a fixed default model with
  an override, mirroring `JevScorerOptions.model` (`src/quality/jev-scorer.ts:22-23`).

## §4 note — not waivable

This unit changes a **tool contract** (a new required argument on the one tool) and the
**closed `Code` union** with its runtime mirror. Both are contract-bearing, so the §4 waiver
applies only to the plan's ceremony, never to the spec: G2 must pass before any code, and the
skill update is part of the same acceptance.

amended 2026-10-30 — R6's oracle now names `TAXONOMY_SIZE` at `tests/types/errors.test.ts:56` instead of "the existing taxonomy test" — the concrete assertion is what makes the oracle checkable.
amended 2026-10-30 — judge-unavailable now proceeds with a visible flag (owner decision ii), not a refusal — why: a model outage must not halt all starts; alignment is routing hygiene, not a safety gate. D3, D3a, R3, R9, the failure-codes note and the Model carry the change; R1 (order required) and R4 (misaligned is write-free) are untouched.
