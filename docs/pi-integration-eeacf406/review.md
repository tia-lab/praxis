# Review — pi-integration

Task: pi-integration · Hash: eeacf406 · Gate: G1-G3 · Append-only. Nobody edits a verdict.

Reviewed at 2026-10-29T12:08:23Z, before this file existed. The tree was untracked
(`docs/pi-integration-eeacf406/`); the digests below are the bytes I read.

## Digests of every reviewed file

```sh
sha256sum docs/pi-integration-eeacf406/research.md \
          docs/pi-integration-eeacf406/spec.md \
          docs/pi-integration-eeacf406/plan.md
924758394a7dd5fdb85fd5a1779526c476a1ca3963df2cc7c626e4ea23f855f7  research.md
75d9c5c46d2aa3fc20d651fc1e923f4aee5f2027833ffc39959583f70e9da318  spec.md
3529431c5c0f90009582d80884b3deb537706a63917536fd4179cf76907032be  plan.md
```

Contract identity reproduced (executed): extracting `research.md:7-9` and applying the
canonical function in `docs/WORKFLOW.md` §1 yields `eeacf406`. The research's extra
`sed` step yields the same 8 hex, so §0 is a faithful hash input.

## Precondition — G0 authority record — FAIL (blocking G4) — 2026-10-29T12:08:23Z

subject: `AGENTS.md` (authorization ledger), `STATUS.md` — not a gate artifact
reviewer: reviewer-1  independence: independent

findings:

- P1 [blocking] `AGENTS.md:19-26` requires a bounded unit's authorization to be recorded
  in the ledger, and `AGENTS.md:17-18` still says no engine, store, adapter or schema is
  built; the ledger `AGENTS.md:27-52` lists no entry for slice-0 or for pi-integration.
  Meanwhile `STATUS.md:3-4` records Slice 0 as owner-accepted and `STATUS.md:19-20` names
  unit C as next. Consequence: G0's pass condition ("owner goal, scope and acceptance
  recorded") has no evidence in the project's own authorization record, and a worker who
  follows the contract must stop before G4 writes `src/pi/*`. Cure: the owner appends the
  pi-integration entry (scope: `src/pi`, `src/types/pi.ts`, `tests/pi`, `docs/pi-integration-eeacf406`;
  acceptance: the G1-G3 verdicts here plus the executed host check) and the missing slice-0
  entry, or records that the Manifold team record is the ledger and points `AGENTS.md` at it.
  Editing the ledger grants no new scope by itself. Evidence: read (grep of `AGENTS.md`,
  read of `STATUS.md`). This finding is not a defect of the three artifacts and does not
  change the G1 artefact verdict below; it blocks entering G4.

## G1 research — attempt 1 — PASS — 2026-10-29T12:08:23Z

subject: `docs/pi-integration-eeacf406/research.md` sha256:924758394a7dd5fdb85fd5a1779526c476a1ca3963df2cc7c626e4ea23f855f7
reviewer: reviewer-1  independence: independent

findings:

- G1-F1 [advisory] `research.md` F3 — the executed probe uses a `z.discriminatedUnion`
  while `spec.md` R2 and `plan.md` use one strict object plus `superRefine`. I re-ran the
  shape the plan actually specifies through `z.toJSONSchema(..., {target:"draft-2020-12"})`
  and the real host `validateToolArguments`: the refinement is dropped from JSON Schema
  (`required:["op"]`), while `additionalProperties:false` and the enum survive. Consequence:
  F3's conclusion still holds (a Zod schema can be the single authority), but its evidence
  does not cover the chosen shape and the model-facing schema is weaker than "start needs
  flow" suggests. Cure: append one sentence to F3 with the object+refinement result, or
  re-probe the shipped schema. Evidence: executed (probe below); source-inspected
  `pi-ai/dist/utils/validation.js:279-320`.
- G1-F2 [advisory] `research.md` F5 — "a tool result requires content and details" is
  accurate, but the host types are sharper than the finding: `content: (TextContent |
  ImageContent)[]` and a required `details: T` (`pi-agent-core/dist/types.d.ts:370-386`).
  Recording only "content and details" lets `spec.md` R8 and `plan.md` declare a JSON
  object as `content` and make `details` optional (see G2-F1, G3-F4). Cure: quote the two
  field types in F5. Evidence: source-inspected.

verdict basis: Q1-Q6 each answered with a stated answer, not a restatement of the question;
F1-F20 labelled source-inspected/executed/inference/untested; competing explanations argue
against the unit's own convenience; affected owners and callers name unchanged vs new
surfaces; the uncertainty block separates what was executed from what was not. I re-verified
the load-bearing citations: F8/F9/F10/F11/F12/F13/F15/F18 against `src/runner/*`,
`src/types/schema.ts`, `docs/extensions.md:240-290`, `docs/cli.md:110-140`,
`docs/json.md:100-118`, `docs/mcp.md:245-258`, `agent-loop.js:484-522`,
`types.d.ts:1089-1104`, `session-manager.d.ts:178,246`, `docs/vision.md:45-55`. F1-F20 are
present, sourced and consistent with the installed Pi 1.4.0. No finding exceeds what was
read or run, except the F3 shape caveat above (advisory).

## G2 spec — attempt 1 — FAIL — 2026-10-29T12:08:23Z

subject: `docs/pi-integration-eeacf406/spec.md` sha256:75d9c5c46d2aa3fc20d651fc1e923f4aee5f2027833ffc39959583f70e9da318
reviewer: reviewer-1  independence: independent

findings:

- G2-F1 [blocking] `spec.md:29` R8 — "every failure is an `isError:true` result whose
  **content** is `{code, message, detail?}`" is not implementable against the host:
  `AgentToolResult.content` is `(TextContent | ImageContent)[]` and `details` is required
  (`pi-agent-core/dist/types.d.ts:370-386`; `docs/extensions.md:247-259`). `spec.md:28` R7
  likewise fixes the success envelope (`{result, step, nonce}`) without saying whether it
  lives in `content` or `details`. Consequence: the implementer must invent the delivery
  shape, P1 rejects the literal reading, and R8's "one negative per surface code" may assert
  on a field the model never sees. Cure: fix the envelope in `details` and `content` as a
  text part, e.g. success `{content:[{type:"text",text:"<status>: <summary>"}], details:{result,step,nonce}}`
  and failure `{content:[{type:"text",text:"<code>: <message>"}], details:{code,message,detail?}, isError:true}`,
  add the matching Zod schemas/owners, and keep the code list. Evidence: source-inspected.
- G2-F2 [blocking] `spec.md:34` R13 and `spec.md:64-73` (state table) — "start with the same
  request id reopens it" is stated unconditionally, but `start` reopens only when the pinned
  actor also matches (`src/runner/engine.ts:229-243`), and R10 derives the actor from the
  host session id. A later Pi session with the same request id is therefore `REQUEST_CONFLICT`,
  not a reopen; `spec.md:25` R3 already carries the actor condition, so R13 contradicts R3.
  Consequence: a same-session oracle passes while the normal restart case fails, and the
  parent cannot resume across sessions; the failure behaviour "a failed instance silently
  returning to running" misses the real hazard (a caller assuming reopen). Cure: qualify
  R13 and the table with "in the same session/actor" and add one oracle for a new fake
  session id asserting `REQUEST_CONFLICT` with no second row, or reopen the actor-label
  decision (owner decision, gate #3 stays open). Evidence: source-inspected
  `engine.ts:177-180,224-243`, `spec.md:25,34`.
- G2-F3 [advisory] `spec.md:23` R2 — the chosen argument schema (strict object plus
  `superRefine`) yields a host schema that requires only `op`; per-op fields are enforced
  only by the handler's second parse. The oracle says "host rejects unknown keys" but not
  "host accepts `{op:"start"}`", so a reader can believe the host enforces more than it
  does. Cure: state the split ("host: shape and unknown keys; handler: per-op requirements"),
  or adopt the union F3 probed. Evidence: executed (probe below).
- G2-F4 [advisory] `spec.md:110-117` Alternatives — Q1 itself says "the whole surface is one
  tool or three", yet the table rejects only the `tool_call` hook, the flow-schema change
  and the sandbox. A three-tool split (`praxis_start`/`praxis_submit`/`praxis_read`) is a
  credible complete alternative: each op gets an exact host schema with no `superRefine`,
  one shared grant check stays, and the cost is tool count/exposure text. `MIN-010` requires
  comparing it. Cure: add the row with the per-dimension comparison (schema exactness vs
  tool count and description surface) and the reason for rejecting or adopting it.
- G2-F5 [advisory] `spec.md:28` R7 — "read is the only op returning artifact bytes" is
  inaccurate: `read` returns the parsed `value` plus an artifact summary, not bytes
  (`src/runner/engine.ts:290-302`). Cure: say "artifact body". `MIN-005`.
- G2-F6 [advisory] `spec.md:29` R8 — the "one negative per surface code" list omits
  `FLOW_INVALID`, which any op can raise through a malformed config
  (`engine.ts:129-151`), while the requirement allows any code from `errors.ts`. Cure: add
  `FLOW_INVALID` to the negative list or state that the list is the expected set and other
  typed codes pass through untested.

verdict basis: R1's registration contract checked against `docs/extensions.md:11-25` and
`types.d.ts:451-530,1229`; R2's host behaviour executed through `validateToolArguments`
(unknown key rejected, non-object artifact rejected, valid start accepted); R3's instance-id
and conflict rules read at `engine.ts:177-180,224-243`; R4's single transition read at
`engine.ts:309-404` (advance is the only `setStatus` caller); R5's unguarded
`readStepArtifact` read at `engine.ts:290-302`, so the required pre-check is real; R6's
descriptor derives from `openFlow` + `instance`, no new owner; R7's six keys match
`src/runner/result.ts:16-52`; R8's taxonomy exists in `src/types/errors.ts`; R9 is feasible
with the exported `start`/`inspect`/`advance`/`readStepArtifact`/`openFlow`/`grantFor`/
`requireGrant` and the unchanged config; R10's schema excludes `actor`; R11 is backed by
F14/F17 and `docs/vision.md:49-53`; R12's repeat/conflict behaviour read at
`engine.ts:229-243,431-455`; R13's failed-state handling read at `engine.ts:349-370`.
Ownership has one owner per fact except the G2-F1 envelope shape; exclusions, open
questions and blockers are stated and none is silently assumed.

## G3 plan — attempt 1 — FAIL — 2026-10-29T12:08:23Z

subject: `docs/pi-integration-eeacf406/plan.md` sha256:3529431c5c0f90009582d80884b3deb537706a63917536fd4179cf76907032be
reviewer: reviewer-1  independence: independent

G3 review started after G2 FAIL; the plan's own hard rule forbids that. The findings below
are recorded for the next attempt, not as a valid G3 attempt.

findings:

- G3-F1 [blocking] `plan.md:70-94` Steps — steps 1-6 write and test the implementation;
  G3 review is step 7. This contradicts `docs/WORKFLOW.md` §2 ("No code before G3 PASS")
  and the lead's instruction that the review of G1-G3 precedes implementation. Consequence:
  engineers can start before the plan passes, and the plan's own step 7 becomes a review of
  code written against an unreviewed plan. Cure: make the G1-G3 review the first step (its
  independence and output already fixed by this file) and number implementation after it.
- G3-F2 [blocking] `plan.md:72-88` Steps 1, 2 and 4 — each "Done when" clause needs
  `tests/pi/fixtures.ts` ("fixtures parse", "parameter fixture", "descriptor fixtures",
  denial/corruption cases), but that file is claim D, written by engineer-2 in step 6
  (`plan.md:89-91`). Consequence: steps 1-5 cannot meet their own completion criteria in
  order; an engineer either blocks or writes tests inside claim B. Cure: move
  `tests/pi/fixtures.ts` (claim D) to step 1, or restate steps 1-5 as manual probes whose
  output is recorded, with the fixture-based tests in step 6.
- G3-F3 [blocking] `plan.md:21-22` ownership — claim E's path is
  `docs/pi-integration-eeacf406/`, which includes `review.md`, the only path claim F may
  write. The parenthetical "(research, spec, plan)" narrows the intent but not the granted
  path. Consequence: the plan still implies two writers on `review.md` even though the lead
  reports E released when the architect completed; a claim check shows overlap, and the
  next engineer reading the table cannot tell which grant wins. Cure: write E as the three
  explicit files and add "E released at assignment 3a32fcd2; F valid" to the note.
- G3-F4 [blocking] `plan.md:38-39,105` — `PiToolResult`/`PiToolDefinition` plus P6. P6
  forbids every host import, including `import type`, so nothing type-checks the tool
  against Pi's real `ToolDefinition`; `PiToolDefinition` does not pin `execute`'s host
  signature `(toolCallId, params, signal, onUpdate, ctx)` (`types.d.ts:525-535`), while
  `executePraxisTool(args, ctx)` reads as a two-argument execute. Consequence: a tool
  registered with the wrong arity compiles and only fails inside the live run (P7), where a
  model run is the most expensive and least deterministic check; `details` is also declared
  optional although the host requires it (F5). Cure: allow `import type` from
  `@earendil-works/pi-coding-agent` (erased at runtime; make P6 filter `^import type`),
  type `PiHost`/`PiToolDefinition` against `registerTool`/`ToolDefinition`, and let P1 do
  the check.
- G3-F5 [blocking] `plan.md:106-111` checks — P7 asserts "no `extension_error`", but that
  event is documented as RPC-only (`docs/json.md:184-195`), so under `--mode json` the
  assertion is vacuous and cannot catch a throwing extension handler. P9 (grep for the
  draft-read attempt), P10 (grep for `nestedCalls`) and P12 (count event/artifact rows)
  state no command, and P11 is conditional ("if the model calls bash"). Consequence: "every
  check is executed and its real output recorded" cannot be established for R7, R11 and the
  zero-effect claim; three checks can be marked done without evidence. Cure: run the host
  check in `--mode rpc` (where `extension_error` exists) or replace the assertion with
  `tool_execution_end` `isError`/`details.code`; give P9/P10/P12 exact commands (`node -e`
  with `node:sqlite` against the temp store, `jq`/grep scoped to praxis results); make P11
  record "bash not observed → unproven" rather than pass, and rely on P3's no-`on`
  registration plus a declared-bash run for R11.
- G3-F6 [advisory] `plan.md:36-47` — no declaration binds the flow-config path and store
  root: `PiSessionContext.cwd` is declared but unused, and the engine defaults to
  `process.cwd()` (`engine.ts:111-116`). Consequence: the tool and P8's CLI share a store
  only when Pi's cwd is the project root; a different cwd silently uses another store.
  Cure: declare `engineOptions(ctx)` (ctx.cwd → `configPath`/`storeDir`) and bind it in
  R3/R5.
- G3-F7 [advisory] `plan.md:38` — `details` optional in `PiToolResult` vs required by the
  host; folded into G3-F4.
- G3-F8 [advisory] `STATUS.md:20` (outside the reviewed folder) — names the tool
  `praxis.run`, while `spec.md` R1 fixes `praxis`. Consequence: the owner-facing status
  page and the spec disagree on the public surface. Cure: lead updates `STATUS.md` when G2
  settles. `MIN-005`.

verdict basis: affected declarations exist for every module and are bound to requirement
ids; `MIN-006` is respected (no speculative op or config); `MIN-005` holds for the flow,
grant, instance, artifact, result and descriptor; `MIN-004` holds for each declaration
except the missing path/engine-options binding (G3-F6). P1 and P4 were executed here: P1
`npx tsc --noEmit` exits 0 and the tsconfig includes `src/**/*.ts` and `tests/**/*.ts`;
P4 `node --test tests/store/*.test.ts tests/runner/*.test.ts` reports 29 tests, 29 pass,
0 fail. P2, P3, P5, P6 have concrete commands and are runnable as written. P7-P12 are not
yet executable as written (G3-F5). Recovery covers store deletion, repeat start/submit,
failed instances and a failed host run, and does not fabricate a pass.

## What was executed

| # | Command (cwd `/media/Development/AI/praxis`) | Outcome |
| --- | --- | --- |
| E1 | `pi --version` | 1.4.0 |
| E2 | contract hash from `research.md:7-9` via `docs/WORKFLOW.md` canonical | `eeacf406` |
| E3 | `npx tsc --noEmit` | exit 0, no diagnostics |
| E4 | `node --test tests/store/*.test.ts tests/runner/*.test.ts` | 29 tests, 29 pass, 0 fail |
| E5 | `validateToolArguments` (Pi 1.4.0) on the planned Zod→JSON Schema | valid start accepted; unknown key rejected (`schema is false`); non-object artifact rejected (`must be object`) |
| E6 | `z.toJSONSchema` + TypeBox 1.3.27 `Compile` on strict object + `superRefine` | `required:["op"]`, `additionalProperties:false`; refinement absent; valid/invalid enum handled |
| E7 | `sha256sum` of the three reviewed files | digests above |

E5/E6 ran from temporary files under `.dev/` and under `/tmp`; the `.dev/` probes were
removed after the run, so no probe artifact remains. No reviewed file was edited.

## Limits

- I did not run P7, P8 or P11: they need a live model/host run. My statements about them are
  from the installed Pi 1.4.0 docs/types and are labelled as such.
- I did not review implementation; none exists. Findings about `src/pi/*` are about the
  planned declarations, not bytes.
- I read the installed Pi 1.4.0 package only. A host upgrade may change the tool contract.
- I did not run the Manifold team configuration or verify the lead's design acceptance;
  that is outside the artifacts.
- The three files are untracked in Git, so "unchanged" means unchanged against the digests
  above during this review, not against `HEAD`.
- Independence: I am `reviewer-1`, a different session from the author (`architect-1`),
  and I did not write research.md, spec.md or plan.md. This verdict is therefore
  `independent` in the `docs/WORKFLOW.md` §3 sense; it is not owner acceptance.
