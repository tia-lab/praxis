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

## G2 spec — attempt 2 — PASS — 2026-10-29T12:17:58Z

subject: `docs/pi-integration-eeacf406/spec.md` sha256:1ffe942c0e9ba800ac5eff16db6a4ab9da70c9a9b1927f2e2998d62de890da10
reviewer: reviewer-1  independence: independent

Rework basis: `git diff` against the attempt-1 subject (+42/−15 lines). `research.md`
(9247583…) and `plan.md` (3529431c…) are unchanged, so this section reviews the spec text
and its consistency with the rest of the spec and with the accepted engine, not a stale plan.

findings:

- G2-F7 [advisory] `spec.md:29` R8 — the "expected operation-failure code" list omits
  `ARTIFACT_VERSION_CONFLICT`, which R12 (`spec.md:33`) states as surface behaviour and the
  engine raises at `engine.ts:441`. It is reachable through the tool: a killed attempt leaves
  a pending version for the step (`runStep` reuses `probeArtifact`, `engine.ts:431-447`), a
  later `submit` with different content on the same instance conflicts, and `submit` is not
  actor-bound (G2-F9). Consequence: a promised failure mode has no negative in R8's oracle
  and R12's "changed payload" oracle does not say how the pending version is created. Cure:
  add `ARTIFACT_VERSION_CONFLICT` to R8's list and state in R12 that the pending version is
  seeded by an aborted attempt or a store-level fixture. Evidence: source-inspected.
- G2-F8 [advisory] `spec.md:34` R13 — "with the gate checks in `details`" is one level
  short: R8 fixes failure details as `{code, message, detail?}`, and the engine's
  `AppError.detail` for a gate rejection is `{instance, step, checks}` (`engine.ts:363-371`),
  so the checks sit at `details.detail.checks`. Consequence: an oracle written to
  `details.checks` fails; a reader may assume a flat shape. Cure: say "in
  `details.detail.checks`" and assert that path. Evidence: source-inspected.
- G2-F9 [advisory] `spec.md:29,34` R8/R13 vs `spec.md:39` R10 — the rework qualifies
  `start`'s reopen/conflict by session/actor, but `submit` and `read` take only an instance
  id and the engine compares no actor there (`engine.ts:290-302,309-321`). That is right for
  a correlation label ("no authorization decision may rely on it"), but the asymmetry is
  unstated: the same label gates `start` and not the writes. Consequence: an implementer may
  add an actor check to `submit` (a new authority decision) or assume cross-session submit is
  impossible. Cure: one clause — "the actor condition is `start`'s reopen/conflict key only;
  `submit` and `read` are bound by the instance id and the step grant". Evidence:
  source-inspected.

verdict basis: every changed line checked against its neighbours and the engine.

(1) R8/R13/state table/envelopes are consistent on the failure split. R8 defines an
**operation failure** as the `isError:true` envelope with `content` = JSON text of
`{code,message,detail?}`, adds the Zod-parse → `CONFIG_INVALID` mapping, and explicitly
excludes failed-instance state; R13 makes the gate rejection an operation failure
(`ARTIFACT_INVALID`) and a later same-session `start` a **successful** six-key result with
`status:"failed"`; the state table's `failed` row (`spec.md:55`) and the Envelopes section
(`spec.md:90-101`, "the two are never mixed") repeat it; R4/R12's failed columns name only
operation-failure codes. No place still returns a failed state as an error envelope. The
R8/R13 contradiction the lead ruled on is closed; attempt 1 did not record it.
(2) R13 is qualified by session/actor and all three state-table rows repeat the
qualification, including `completed`. The `REQUEST_CONFLICT` oracle is real: `start`
compares `configDigest` and `actor` and throws before `createInstance` (`engine.ts:224-243`),
so a different fake session id gives `REQUEST_CONFLICT` with the one existing row and no
second row; the same-session repeat returns the stored instance and its nonce, and
`inspect` builds the six-key result with `status:"failed"` (`engine.ts:282-289`,
`result.ts:46-52`).
(3) The claim rule is recorded verbatim in a dedicated section (`spec.md:145-151`): per file,
at most two per assignment, never per folder; `review.md` reviewer-only, `plan.md`
unclaimed, and the G3 folder-claim cure deferred to the next plan assignment. I confirm the
text and my own per-file claim (this assignment holds `review.md`); I cannot audit another
assignment's claim rows from `scope:"self"`.
(4) Prior G2 findings are resolved in this text: G2-F1 (content/details shape) — R7/R8 and
Envelopes now fix one text part plus `details`; G2-F2 (unqualified reopen) — R13 and the
state table; G2-F3 (host schema requires only `op`) — Denial points 1; G2-F4 (three-tool
alternative) — Alternatives D; G2-F5 ("artifact bytes") — R7 now says "artifact body";
G2-F6 (`FLOW_INVALID`) — R8 carries it, and I verified the claim: `FLOW_INVALID` is declared
at `src/types/errors.ts:17` and raised nowhere in `src/`; the loader raises `CONFIG_INVALID`
(`engine.ts:141,148,158-175`).
G2 attempt 2 is **PASS** with three advisories (G2-F7..F9). No blocking finding remains in
the spec.

## G3 plan — unchanged — FAIL (no review this round)

`plan.md` is byte-identical to the attempt-1 subject (sha256:3529431c…). G3 stays **FAIL**
on the attempt-1 findings G3-F1..G3-F5 — including the folder claim E, the implementation-
before-review step order, the fixture dependency in steps 1-5, the untested host seam and
the vacuous P7/P9/P10/P12 checks. No G3 verdict is appended and no plan text was reviewed
this round; G2 PASS does not unblock implementation.

## What else changed since attempt 1

`AGENTS.md:54-63` now records the unit C authorization (owner authorized directly; scope
`src/types/pi.ts`, `src/pi/`, `tests/pi/`, `docs/pi-integration-eeacf406/`; acceptance and
open gates #1-#3 named). The attempt-1 P1 authority finding is closed by that owner action;
this note is not a re-review of it.

## Limits of this attempt

- I reviewed the spec diff and the files it cites; I executed no oracle (no implementation
  exists), and I did not run the engine against the described cases.
- I did not audit architect-1's Manifold claim rows (self scope only) and did not read the
  rework assignment beyond the spec.
- G3 and the plan remain failed and unreviewed; nothing here authorizes implementation.
- Digests are of the working tree at 2026-10-29T12:17:58Z; `spec.md` is uncommitted relative
  to HEAD, the other files match it.

## G3 plan — attempt 2 — FAIL — 2026-10-29T12:28:47Z

subject: `docs/pi-integration-eeacf406/plan.md` sha256:d1902d78da93035c30b7023fd0af0ccc3f6ae12665b0b434cfc6daebe2732881
reviewer: reviewer-1  independence: independent

Basis: `git diff` against the attempt-1 subject (3529431c…, +244/−73 lines); `spec.md`
1ffe942c… (G2 attempt 2 PASS) and `research.md` 9247583… unchanged; contract still eeacf406.

### Blocker check (attempt-1 findings G3-F1..F5)

| Blocker | Verdict | Evidence |
| --- | --- | --- |
| G3-F1 step order | **resolved** | `plan.md:4-6,86-93,95`: step 0 is the G3 review gate, "No step below starts before PASS", and the implementation section is headed "(only after G3 PASS)". |
| G3-F2 falsifiable done-when | **resolved** | `plan.md:95-137`: every step has a concrete command, named-test set or parser condition; step 0 requires a verdict with the file's sha256. |
| G3-F3 claims | **resolved** | `plan.md:13-36`: one file per claim (A1-D2, E1=plan.md, F1=review.md), at most two per engineer, no folder; "the earlier folder claim is retired" at 17-19 and 275-277. |
| G3-F4 host seam | **resolved** | `plan.md:43-50,300-306`: `PiToolResult` has required `details` and `PiTextPart[]` content, `PiToolDefinition.execute(toolCallId, params, signal, onUpdate, ctx)`, and host.ts is a type-only mirror; P6a/P6b/P6c plus P14 check it. I verified the host package is not resolvable from the project (`MODULE_NOT_FOUND`), so the mirror is the only option under R9's no-dependency rule. |
| G3-F5 observable checks | **resolved** | P7/P9 parse the JSONL for ≥3 starts, final `status:"completed"`, one denial with `details.detail.step`, no `nestedCalls`; P10 has a command; P11 records observed/unproven; P12/P13/P15 name tests; step 6 says a failed host run is recorded, not explained away (`plan.md:126-133`). |

### Findings

- **G3-F10 [blocking]** `plan.md:139-153` — the named tests are declared the P2 evidence and
  "a missing name is a missing requirement", but the list leaves these requirements without a
  named test: R13's centrepiece (a later same-session `start` returns a **successful** six-key
  result with `status:"failed"`), R12's idempotency cases (repeat `start` returns the same
  instance/nonce; `submit` reuses a pending version; completed `submit` returns its result;
  failed `submit` is `INSTANCE_STATE_INVALID`), R8's remaining negatives
  (`INSTANCE_NOT_FOUND`, `INTERNAL`), R10's missing-session typed failure, and R2's
  submit/read missing-field cases (only start is tested). Consequence: G5 would find
  R8/R10/R12/R13 partially unproven, and the lead's R8-vs-R13 ruling would ship without a test
  while the plan's own rule says that is a missing requirement. Cure: add named tests
  `failed instance reopens as a successful six-key result`,
  `submit on failed instance is INSTANCE_STATE_INVALID`,
  `repeat start returns the same instance and nonce`, `submit reuses a pending version`,
  `completed submit returns the completed result`,
  `submit without instance is INSTANCE_NOT_FOUND`, `unexpected error becomes INTERNAL`,
  `missing session id is a typed failure`, `schema rejects missing submit instance`, map
  them in steps 3/4 and P2, and keep the count of named tests equal to the covered behaviours.
  Evidence: read (full plan); executed `grep` shows no occurrence of `INSTANCE_NOT_FOUND`,
  `INSTANCE_STATE_INVALID`, `INTERNAL` or a repeat/completed-submit test name.
- **G3-F11 [advisory]** `plan.md:167-175` — P7/P9 require **exactly one**
  `CAPABILITY_DENIED` and fail on any other praxis `isError`. A model that retries the denied
  read or makes one stray call fails a legitimate run; research F16 already says tool-call
  behaviour is not deterministic. Consequence: a false negative that tempts re-prompting
  instead of recording. Cure: accept ≥1 denial, assert every denial is
  `CAPABILITY_DENIED`/`details.detail.step === "draft"`, record extra attempts as an
  observation, and keep "unexpected non-denial failure fails".
- **G3-F12 [advisory]** `plan.md:163` — P5 compares the working tree against an implicit
  committed baseline and its no-change list omits `package.json`, `tsconfig.json`,
  `.pi/settings.json` and `STATUS.md`. The G3 evidence (`spec.md`, `plan.md`,
  `review.md`) is currently uncommitted, and G5 writes `review.md`. Consequence: P5 fails on
  legitimate doc changes, or misses a manifest change that R9 forbids. Cure: state that the
  lead commits the G3 evidence before G4; scope P5 to
  `git status --porcelain -- src tests` plus
  `git diff --name-only HEAD -- src/runner src/store src/types/schema.ts src/types/errors.ts src/cli.ts .pi/praxis/config.json package.json tsconfig.json .pi/settings.json STATUS.md`.
- **G3-F13 [advisory]** `plan.md:101-124,172-175` — the name-pattern commands cannot
  distinguish a missing test from a passing one: executed
  `node --test --test-name-pattern "no such test name" tests/store/canonical.test.ts` exits 0
  and reports "1 pass" (the file line), while a matching run reports the `✔ <name>` line.
  Consequence: a renamed or absent named test satisfies both the command and P12/P13/P15's
  "1 pass" while proving nothing. Cure: require the recorded output to show a
  `✔ <name>` line per name, or assert the count (e.g. `--test-reporter=tap | grep -c '^ok'`).

### Verdict basis

The five attempt-1 blockers are resolved. R9 holds: the read-only list (`plan.md:32-36`)
covers `src/runner`, `src/store`, `src/types/schema.ts`, `src/types/errors.ts`, `src/cli.ts`
and the flow config, no declaration touches them, and all new files are inside the authorized
scope (`AGENTS.md:54-63`); G3-F12 is the one gap in P5's expression of it. The G2 attempt-2
advisories are carried: G2-F7 → P15 seeds a pending artifact and asserts
`ARTIFACT_VERSION_CONFLICT` with no write, with the code to be added to R8 at the next spec
touch; G2-F8 → named test `gate rejection exposes details.detail.checks`; G2-F9 → named test
`submit and read are not actor bound`. G3-F6 is closed by `engineOptions(ctx)` + P13; G3-F8
is noted as the lead's `STATUS.md` edit. Baseline executed here: P1 `npx tsc --noEmit` exits
0 and P4 reports 29/29 pass. The plan is consistent with the G2 attempt-2 spec it cites.

G3 attempt 2 is **FAIL** on G3-F10 (coverage), not on the five blockers. One short plan
amendment — named tests plus their step/P2 mapping — closes it; no structural change is needed.

### Limits of this attempt

- No implementation exists; commands that need `src/pi` or `tests/pi` are planned evidence,
  not run. I ran P1 and P4, the host-resolution probe (`MODULE_NOT_FOUND`), the store
  API/column read (`recordArtifact` exported; artifact columns `instance, step, state`), and
  the name-pattern probe.
- I did not audit the architect's Manifold claim rows (self scope only) and did not review
  implementation or the spec.
- Digests are of the working tree at 2026-10-29T12:28:47Z; `plan.md`, `spec.md` and `review.md` are
  uncommitted relative to HEAD.

## G3 plan — attempt 3 — PASS — 2026-10-29T12:33:09Z

subject: `docs/pi-integration-eeacf406/plan.md` sha256:a4b89928fad4ec6fda2edb7067050ace87a64d887f920895c7a9d5e28afc33fb
reviewer: reviewer-1  independence: independent

Basis: full plan re-read against attempt-2 findings G3-F10..F13; attempt-1 blockers and the
R9 list re-checked; `spec.md` 1ffe942c… and `research.md` 9247583… unchanged; contract
eeacf406.

findings:

- **G3-F10 [resolved]** `plan.md:132-173` — the 34-row table now carries all nine requested
  names: `schema rejects missing submit instance` (#2), `missing session id is a typed
  failure` (#7), `repeat start returns the same instance and nonce` (#12),
  `completed submit returns the completed result` (#17),
  `submit on failed instance is INSTANCE_STATE_INVALID` (#18),
  `failed instance reopens as a successful six-key result` (#19),
  `submit without instance is INSTANCE_NOT_FOUND` (#23),
  `submit reuses a pending version` (#29), `unexpected error becomes INTERNAL` (#31), plus
  `read without instance is INSTANCE_NOT_FOUND` (#30) and the read-field rows (#3, #4).
  Step mapping is complete and consistent: 10 rows for step 2 (#1-10), 13 for step 3
  (#11-23), 11 for step 4 (#24-34) = 34 (`plan.md:302-306`); P2 runs all 34
  (`plan.md:180`), and #28/#32/#33 are tagged P15/P12/P13 (`plan.md:192-195`). I audited
  R1-R13 against the table: every requirement has a named row or an explicit check (R1/R11 via
  the extension tests and P11; R9 via P5), and all nine R8 codes are covered — CONFIG_INVALID
  #1-5, REQUEST_CONFLICT #13/#14, INSTANCE_NOT_FOUND #23/#30, INSTANCE_STATE_INVALID #18,
  ARTIFACT_INVALID #27, ARTIFACT_DIGEST_MISMATCH #26, CAPABILITY_DENIED #24/#32, INTERNAL #31,
  ARTIFACT_VERSION_CONFLICT #28/#29. Evidence: read.
- **G3-F11 [resolved]** `plan.md:187,189,306-309` — P7 requires ≥1 denial, every denial to be
  `CAPABILITY_DENIED` with `details.detail.step === "draft"`, and reports extra attempts as
  `deniedAttempts`; a non-denial praxis failure still fails. Recovery (`plan.md:281-289`)
  states model retries are allowed and recorded. The check no longer depends on the model
  attempting the read exactly once. Evidence: read.
- **G3-F12 [resolved]** `plan.md:183,310-313` — P5 is scoped to `git status --porcelain -- src
  tests` plus `git diff --name-only HEAD --` an explicit no-change list that includes
  `package.json`, `tsconfig.json`, `.pi/settings.json` and `STATUS.md`; the lead commits
  the G3 evidence before G4 and "doc changes do not enter P5". The baseline is now stated
  instead of implied. Evidence: read.
- **G3-F13 [resolved]** `plan.md:119-125,180-195,314-317` — every named check requires a
  recorded `✔ <name>` line (P2 = 34, P3 = 4, P12/P13/P15 exactly one for their name), and a
  name-pattern command that matches nothing is declared a failed check, not a pass. I executed
  the mechanism: `node --test tests/store/canonical.test.ts` (6 tests) prints exactly 6 `✔`
  lines and no file line, while a no-match pattern prints only the file line — so
  `grep -F "✔ <name>"` fails as the plan requires. Evidence: executed.

The five attempt-1 blockers are untouched and still hold: step 0 gate (`plan.md:4-6,86-93`),
falsifiable done-whens, per-file claims (`plan.md:13-36`), host seam (`plan.md:23,48` plus
P6a/P6b/P6c and P14), and observable host checks. The R9 read-only list (`plan.md:33-36`) and
the out-of-scope list (`plan.md:337-345`) are unchanged, and no declaration adds a change
outside them.

verdict basis: row-by-row pattern audit — step 2's pattern selects #1-10, step 3's selects
#11-23 (it also selects #7, which is green by then), step 4's selects #24-34. Executed here:
P1 `npx tsc --noEmit` exits 0; P4 reports 29/29; the host package is unresolvable
(`MODULE_NOT_FOUND`) so the type-only mirror remains the only option under R9; the `✔`-count
probe above. The plan is consistent with the G2 attempt-2 spec and carries G2-F7 (P15),
G2-F8 (`details.detail.checks` test) and G2-F9 (actor-asymmetry test), plus G3-F6
(`engineOptions(ctx)` + P13) and G3-F8 (STATUS.md noted, not edited).

G3 attempt 3 is **PASS**.

Observation, not a finding: step 2's pattern contains the bare word `actor`, which would also
select row 34 if the whole file existed at step 2; the plan says the test owner writes the
step 2 rows first, so it is harmless as written. Tightening it to `actor label` would remove
the coupling.

### Limits of this attempt

- No implementation exists; P2/P3 and P7-P15 are planned evidence, not run. I ran P1, P4, the
  host-resolution probe and the `✔`-count probe.
- I could not run the step patterns against a test file (none exists); the pattern audit is by
  test name.
- I did not audit the architect's Manifold claim rows (self scope only) and did not review
  implementation or the spec.
- Digests are of the working tree at 2026-10-29T12:33:09Z; `plan.md`, `spec.md` and
  `review.md` are uncommitted relative to HEAD.



