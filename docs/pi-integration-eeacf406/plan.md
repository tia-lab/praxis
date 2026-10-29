# Plan — pi-integration

Task: pi-integration · Hash: eeacf406 · Gate: G3 · Status: draft · Date: 2026-10-29

Basis: `spec.md` R1–R13; `review.md` G3 attempt 2 (G3-F10 blocking, G3-F11..F13
advisory), plus the attempt-1 blockers and G2 advisories. This plan is the G3 subject. No
implementation starts before G3 PASS; G4 implementation and G5 review follow that gate.

Every declaration is bound to a requirement (`MIN-004`); no declaration is added for a
hypothetical future (`MIN-006`). The flow, grant, instance, artifact, result and descriptor
keep one owner each (`MIN-005`).

## Ownership split (per file)

Claims are per file, at most two per assignment, never per folder (lead rule; review G3-F3).
This G3 assignment holds `plan.md` only; the reviewer holds `review.md` only. The table below
is the prospective G4 split; it grants no current rights. No folder is claimed, and the earlier
folder claim is retired.

| File | Owner | Claim | Requirement |
| --- | --- | --- | --- |
| `src/types/pi.ts` | engineer-1 | A1 | R1, R2, R5, R6, R7, R8 |
| `src/pi/host.ts` | engineer-1 | A2 | R1, R2, R7, R8, R10 |
| `src/pi/tool.ts` | engineer-2 | B1 | R1–R13 |
| `src/pi/extension.ts` | engineer-2 | B2 | R1, R11 |
| `tests/pi/tool.test.ts` | engineer-3 | C1 | R2–R8, R10, R12, R13 |
| `tests/pi/extension.test.ts` | engineer-3 | C2 | R1, R11 |
| `tests/pi/fixtures.ts` | engineer-4 | D1 | test fixtures |
| `tests/pi/e2e-prompt.md` | engineer-4 | D2 | R11, host check |
| `docs/pi-integration-eeacf406/plan.md` | architect | E1 | G3 |
| `docs/pi-integration-eeacf406/review.md` | reviewer-1 | F1 | G3/G5 |

Each engineer holds at most two files. Read-only for everyone: `src/runner/*`,
`src/store/*`, `src/types/schema.ts`, `src/types/errors.ts`, `src/cli.ts`,
`.pi/praxis/config.json`, `package.json`, `tsconfig.json`, `.pi/settings.json`,
`STATUS.md`, `research.md`, `spec.md`.

## Declarations

| Path | Declaration | Requirement |
| --- | --- | --- |
| `src/types/pi.ts` | `PraxisToolOpSchema` (`z.enum(["start","submit","read"])`) | R2 |
| | `PraxisToolArgsSchema` (strict object + `superRefine` per-op requirements) and `PraxisToolArgs` | R2, R5, R10 |
| | `StepDescriptorSchema` / `StepDescriptor` (`id`, `capabilities`, `ops`) | R6 |
| | `ArtifactSummarySchema` / `ArtifactSummary` (no path) | R5, R7 |
| | `StartEnvelopeSchema`, `StepEnvelopeSchema`, `ReadEnvelopeSchema`; `PraxisToolEnvelope` | R3, R4, R7 |
| | `FailureDetailsSchema` / `FailureDetails` (`code`, `message`, `detail?`) | R8 |
| `src/pi/host.ts` | local **type-only** mirror of the host tool surface; no runtime export and no host import | R1, R7, R8 |
| | `PiSessionContext` (`sessionManager.getSessionId()`, `cwd`) | R10 |
| | `PiTextPart` (`{type:"text"; text:string}`) | R7 |
| | `PiToolResult` (`content: PiTextPart[]`, **required** `details: unknown`, optional `isError`) | R7, R8 |
| | `PiToolDefinition` (`name`, `label`, `description`, `parameters`, `executionMode`, `execute(toolCallId, params, signal, onUpdate, ctx)`) | R1, R2 |
| | `PiHost` (`registerTool(tool: PiToolDefinition): void`) | R1 |
| `src/pi/tool.ts` | `PRAXIS_TOOL_NAME`, `PRAXIS_TOOL_DESCRIPTION` | R1, R11 |
| | `PRAXIS_TOOL_PARAMETERS` = `z.toJSONSchema(PraxisToolArgsSchema, {target:"draft-2020-12"})` | R1 |
| | `engineOptions(ctx)` — `configPath`/`storeDir` from `ctx.cwd`, never `process.cwd()` | R3, R5 |
| | `actorFor(ctx)` — host session id → bounded correlation label | R10 |
| | `stepDescriptor(flow, instance)` — derived, never stored | R6 |
| | `executePraxisTool(args, ctx)` — start / submit / read dispatch | R2–R8, R10, R12, R13 |
| | `createPraxisTool()` — one `PiToolDefinition` whose host `execute` has the five-argument signature and delegates to `executePraxisTool(params, ctx)` | R1, R4 |
| | `ok`, `failure` — validated envelope or typed `isError` result | R7, R8 |
| `src/pi/extension.ts` | default `praxisExtension(pi: PiHost)`; exactly one `pi.registerTool(...)`, no `pi.on(...)` | R1, R11 |
| `tests/pi/fixtures.ts` | temp flow config (draft/derive), valid A, valid B, wrong-`derivedFrom` B, missing-nonce A, fake context, temp store, pending-artifact seed | tests |
| `tests/pi/tool.test.ts` | the 34 named tests below | R2–R8, R10, R12, R13 |
| `tests/pi/extension.test.ts` | one tool, no hook, parameter acceptance/rejection | R1, R11 |
| `tests/pi/e2e-prompt.md` | flow `architect`, request `pi-e2e-1`, draft read attempt, A (schema+nonce), B (schema+nonce+derivedFrom), final report | R11, host check |

The tool's `parameters` is generated from the Zod schema; there is no second hand-written
schema. The target is draft 2020-12, matching the executed probe in `research.md` F3.

## Flow used

The accepted `.pi/praxis/config.json` is reused unchanged:

```
draft  capabilities: artifact.write, emit          produces: praxis.artifact.architecture/v1
derive capabilities: artifact.read, artifact.write, emit  consumes: draft
                                                    produces: praxis.artifact.derive/v1
```

`draft` grants no `artifact.read`; that is the denial fixture. `derive` grants it; that is
the read fixture. No new flow, capability or config key is introduced.

## Steps

### 0. G3 plan review gate — reviewer-1, claim F1

Review this plan against `spec.md` R1–R13 and the G3 findings before any implementation.
G1 and G2 are PASS in `review.md`; this is the remaining gate. **Done when** `review.md` has a
G3 attempt 3 verdict with the `sha256` of this file, findings against R1–R13, and PASS. A FAIL
returns here. No step below starts before PASS.

### Implementation (only after G3 PASS)

1. **Fixtures and local host types** — claims D1, A1, A2 (engineer-4 and engineer-1, disjoint
   files, parallel). Write `tests/pi/fixtures.ts` and `src/types/pi.ts`/`src/pi/host.ts`.
   **Done when** `node --experimental-strip-types --input-type=module -e 'const m = await import("./tests/pi/fixtures.ts"); console.log(Object.keys(m).sort().join(","))'`
   prints `artifacts,config,fakeContext,pendingArtifact,tempStore`; `npx tsc --noEmit` exits 0;
   and `grep -nE "^export (const|function|class)" src/pi/host.ts` is empty (the file is type-only).

2. **Tool schema, actor and descriptor** — claims B1, C1 (engineer-2 and engineer-3, parallel;
   the test owner writes the Step 2 rows first). **Done when**
   `node --test --test-name-pattern "schema|actor|descriptor|missing session" tests/pi/tool.test.ts`
   passes every row marked Step 2 in the named-test table, and the output records one
   `✔ <name>` line per Step 2 row.

3. **Start and submit handlers** — claims B1, C1. **Done when**
   `node --test --test-name-pattern "start returns|repeat start|request conflict|changed config|submit A|submit B|completed submit|submit on failed|failed instance reopens|result has exactly|content parses|typed failure|submit without instance" tests/pi/tool.test.ts`
   passes every row marked Step 3, with one `✔ <name>` line per row.

4. **Read guard, gate detail, version conflict, idempotency and errors** — claims B1, C1.
   **Done when** `node --test --test-name-pattern "read in draft|read A in derive|corrupt A|gate rejection|pending version|submit reuses|read without instance|unexpected error|denied read|engine options|not actor bound" tests/pi/tool.test.ts`
   passes every row marked Step 4, with one `✔ <name>` line per row.

5. **Registration** — claims B2, C2. **Done when** `node --test tests/pi/extension.test.ts`
   passes `one registerTool`, `no tool_call registration`, `parameters accept start`, and
   `parameters reject unknown key`, and the output records four `✔` lines.

6. **Host acceptance** — claims D2, C2, architect (after step 5). Run P1–P15 (P1–P6, P13 and
   P14 are recorded in their owning steps; P7–P12 and P15 here); record every command and its
   real output. **Done when** the parser reports at least three `praxis` starts, a final
   `completed` result, at least one denial with every denial `CAPABILITY_DENIED` and
   `details.detail.step === "draft"` (extra attempts recorded as `deniedAttempts`), no
   `nestedCalls`, the CLI status shows six keys and the two accepted artifact rows, and the bash
   probe is recorded as observed or unproven. If the model does not complete the flow, the step
   fails and the failure is recorded, not explained away.

7. **G5 implementation review** — claim F1 (reviewer-1), after G4 evidence. **Done when**
   `review.md` has a G5 verdict with the `sha256` of every reviewed file, findings against
   R1–R13, and PASS/FAIL. G6 owner acceptance is outside this plan.

## Named tests and coverage (P2 evidence)

The table is the count authority: 34 named tests. P2 runs all 34; P12, P13 and P15 run the
rows marked with those checks. A requirement with no row is a carried gap, not an implicit
test.

| # | Named test | Step | Check | Requirement |
| --- | --- | --- | --- | --- |
| 1 | `schema rejects missing start flow` | 2 | P2 | R2 |
| 2 | `schema rejects missing submit instance` | 2 | P2 | R2 |
| 3 | `schema rejects missing read instance` | 2 | P2 | R2 |
| 4 | `schema rejects missing read step` | 2 | P2 | R2 |
| 5 | `schema rejects unknown key` | 2 | P2 | R2 |
| 6 | `actor label is stable per session` | 2 | P2 | R10 |
| 7 | `missing session id is a typed failure` | 2 | P2 | R10 |
| 8 | `descriptor draft lists submit` | 2 | P2 | R6 |
| 9 | `descriptor derive lists submit and read` | 2 | P2 | R6 |
| 10 | `descriptor completed lists read` | 2 | P2 | R6 |
| 11 | `start returns six keys and nonce` | 3 | P2 | R3, R7 |
| 12 | `repeat start returns the same instance and nonce` | 3 | P2 | R3, R12 |
| 13 | `request conflict for a different session` | 3 | P2 | R3, R10, R13 |
| 14 | `changed config payload is REQUEST_CONFLICT` | 3 | P2 | R3, R12 |
| 15 | `submit A advances to derive` | 3 | P2 | R4 |
| 16 | `submit B completes` | 3 | P2 | R4 |
| 17 | `completed submit returns the completed result` | 3 | P2 | R12 |
| 18 | `submit on failed instance is INSTANCE_STATE_INVALID` | 3 | P2 | R12, R13 |
| 19 | `failed instance reopens as a successful six-key result` | 3 | P2 | R13 |
| 20 | `result has exactly six keys` | 3 | P2 | R7 |
| 21 | `content parses to details` | 3 | P2 | R7 |
| 22 | `typed failure envelope` | 3 | P2 | R8 |
| 23 | `submit without instance is INSTANCE_NOT_FOUND` | 3 | P2 | R8 |
| 24 | `read in draft is CAPABILITY_DENIED` | 4 | P2 | R5, R11 |
| 25 | `read A in derive returns A` | 4 | P2 | R5 |
| 26 | `corrupt A is ARTIFACT_DIGEST_MISMATCH` | 4 | P2 | R5 |
| 27 | `gate rejection exposes details.detail.checks` | 4 | P2 | R8, R13 |
| 28 | `pending version conflict` | 4 | P2, P15 | R12 |
| 29 | `submit reuses a pending version` | 4 | P2 | R12 |
| 30 | `read without instance is INSTANCE_NOT_FOUND` | 4 | P2 | R8 |
| 31 | `unexpected error becomes INTERNAL` | 4 | P2 | R8 |
| 32 | `denied read leaves counts unchanged` | 4 | P2, P12 | R5, R11 |
| 33 | `engine options use ctx.cwd` | 4 | P2, P13 | R3, R5 |
| 34 | `submit and read are not actor bound` | 4 | P2 | R10 |

## Checks

| # | Command | Evidence / pass condition |
| --- | --- | --- |
| P1 | `npx tsc --noEmit` | exit 0; no diagnostics |
| P2 | `node --test tests/pi/tool.test.ts > /tmp/p2.out; grep -Fc '✔' /tmp/p2.out` | `34` and 0 failures; every table row has a `✔ <name>` line |
| P3 | `node --test tests/pi/extension.test.ts > /tmp/p3.out; grep -Fc '✔' /tmp/p3.out` | `4` and 0 failures; the four Step 5 names |
| P4 | `node --test tests/store/*.test.ts tests/runner/*.test.ts` | 29 tests, 29 pass, 0 fail |
| P5 | `git status --porcelain -- src tests` and `git diff --name-only HEAD -- src/runner src/store src/types/schema.ts src/types/errors.ts src/cli.ts .pi/praxis/config.json package.json tsconfig.json .pi/settings.json STATUS.md` | first lists only claims A1–D2; second is empty. Lead commits the G3 evidence before G4; doc changes do not enter P5 |
| P6a | static import scan below | empty: no runtime import outside `node:`, `zod` and local files |
| P6b | host import scan below | empty: no host import statement; `src/pi/host.ts` is the local type-only mirror |
| P6c | type-only mirror scan below | empty: the mirror has no runtime export |
| P7 | host JSONL parser below | ≥3 `praxis` starts; last successful end carrying `details.result` has `status:"completed"`; ≥1 denial, every denial `CAPABILITY_DENIED` with `details.detail.step === "draft"`; extra denials reported as `deniedAttempts`; any non-denial praxis `isError` fails |
| P8 | instance id + CLI status + store query below | status `completed`; six keys; artifacts `draft` and `derive`; store has two `accepted` rows |
| P9 | P7 parser's denied entries | ≥1 denial; every denial is `CAPABILITY_DENIED`/`draft`; extra attempts recorded as an observation, not a failure |
| P10 | `grep -c '"nestedCalls"' /tmp/praxis-e2e.jsonl` | `0`: the tool never calls `ctx.executeTool` |
| P11 | no-hook test + declared-bash run below | hook absent in P3; a praxis start followed by bash → recorded "observed; Pi-wide denial not claimed"; bash not observed → "unproven", not a pass |
| P12 | `node --test --test-name-pattern "denied read leaves counts unchanged" tests/pi/tool.test.ts > /tmp/p12.out; grep -F "✔ denied read leaves counts unchanged" /tmp/p12.out` | exactly one `✔` line for that name; event and artifact counts unchanged |
| P13 | `node --test --test-name-pattern "engine options use ctx.cwd" tests/pi/tool.test.ts > /tmp/p13.out; grep -F "✔ engine options use ctx.cwd" /tmp/p13.out` | exactly one `✔` line; store/config resolved under the fake cwd |
| P14 | host declaration source check below | host `execute(toolCallId, params, signal, onUpdate, ctx)` and required `details` match the local mirror; mismatch blocks |
| P15 | `node --test --test-name-pattern "pending version conflict" tests/pi/tool.test.ts > /tmp/p15.out; grep -F "✔ pending version conflict" /tmp/p15.out` | exactly one `✔` line; `ARTIFACT_VERSION_CONFLICT` with no write |

Every check is executed and its real output recorded. A check that did not run is reported as
not run. A name-pattern command that matches nothing can exit 0 and report a file line; it has
no `✔ <name>` line and is therefore a failed check, not a pass (G3-F13). The JSONL and the
store are kept under `/tmp` or the disposable `.pi/praxis/state/`; they are not committed.

### Static check commands

P6a/P6b/P6c — expect empty output:

```sh
grep -rnE "^import " src/pi src/types/pi.ts | grep -vE 'import type |from "(node:|zod|./|../)'
grep -rnE "^import .*@earendil-works/pi-coding-agent" src/pi src/types/pi.ts
grep -nE "^export (const|function|class)" src/pi/host.ts
```

### Host-check commands

P7/P9 — parse the JSONL, accepting model retries:

```sh
node -e '
const fs = require("fs");
const lines = fs.readFileSync("/tmp/praxis-e2e.jsonl", "utf8").trim().split("\n").map(JSON.parse);
const starts = lines.filter((e) => e.type === "tool_execution_start" && e.toolName === "praxis");
const ends = lines.filter((e) => e.type === "tool_execution_end" && e.toolName === "praxis");
const denied = ends.filter((e) => e.isError && e.result?.details?.code === "CAPABILITY_DENIED");
const unexpected = ends.filter((e) => e.isError && e.result?.details?.code !== "CAPABILITY_DENIED");
const withResult = ends.filter((e) => !e.isError && e.result?.details?.result);
const final = withResult.at(-1);
if (starts.length < 3) throw new Error("expected at least 3 praxis starts; got " + starts.length);
if (!final) throw new Error("no successful praxis tool_execution_end carrying details.result");
if (final.result?.details?.result?.status !== "completed") throw new Error("final status " + JSON.stringify(final.result?.details?.result?.status));
if (denied.length < 1) throw new Error("expected at least one CAPABILITY_DENIED; got " + denied.length);
if (denied.some((e) => e.result?.details?.detail?.step !== "draft")) throw new Error("a denial did not name step draft");
if (unexpected.length) throw new Error("unexpected praxis failure: " + JSON.stringify(unexpected.map((e) => e.result?.details?.code)));
console.log(JSON.stringify({ starts: starts.length, ends: ends.length, deniedAttempts: denied.length, status: final.result.details.result.status }));
'
```

P8 — same instance id and store root as the host run:

```sh
ID=$(node --experimental-strip-types --input-type=module -e 'import { instanceIdFor } from "./src/runner/engine.ts"; console.log(instanceIdFor("architect","pi-e2e-1"))')
node --experimental-strip-types src/cli.ts status "$ID" > /tmp/p8-status.json
node -e '
const fs = require("fs");
const r = JSON.parse(fs.readFileSync("/tmp/p8-status.json", "utf8"));
if (r.status !== "completed") throw new Error("status " + r.status);
if (Object.keys(r).length !== 6) throw new Error("keys " + Object.keys(r).join(","));
const steps = r.artifacts.map((a) => a.step).sort().join(",");
if (steps !== "derive,draft") throw new Error("artifacts " + steps);
console.log(JSON.stringify(r));
'
node -e '
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(".pi/praxis/state/praxis.sqlite");
const rows = db.prepare("select step, state from artifact where instance = ?").all(process.argv[1]);
if (rows.length !== 2 || rows.some((r) => r.state !== "accepted")) throw new Error(JSON.stringify(rows));
console.log(JSON.stringify(rows));
' "$ID"
```

P11 — declared-bash run; record the observation:

```sh
node --test --test-name-pattern "no tool_call registration" tests/pi/extension.test.ts > /tmp/p11-hook.out
grep -F "✔ no tool_call registration" /tmp/p11-hook.out
pi --mode json --extension ./src/pi/extension.ts --tools praxis,bash --print "Use praxis op=start with flow=architect and requestId=pi-bash-probe. After it returns, call bash with echo praxis-probe. Then report the exact tool results." > /tmp/praxis-bash.jsonl
node -e '
const fs = require("fs");
const ev = fs.readFileSync("/tmp/praxis-bash.jsonl", "utf8").trim().split("\n").map(JSON.parse);
const p = ev.findIndex((e) => e.type === "tool_execution_start" && e.toolName === "praxis");
const b = ev.findIndex((e) => e.type === "tool_execution_start" && e.toolName === "bash");
console.log(JSON.stringify({ praxisStart: p, bashStart: b, ordered: p >= 0 && b > p }));
'
```

P14 — source-check the local mirror against the installed host declarations:

```sh
grep -n "execute(toolCallId" /home/tia/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts
grep -n "interface AgentToolResult" -A 12 /home/tia/.bun/install/global/node_modules/@earendil-works/pi-agent-core/dist/types.d.ts
```

## Recovery

- Delete `.pi/praxis/state/` and rerun. No migration or repair path: the store is disposable,
  as in Slice 0.
- `start` with the same request id, config digest and actor reopens the instance and returns
  its nonce. `submit` with the same payload reuses a pending version; a different payload is
  `ARTIFACT_VERSION_CONFLICT` and writes nothing.
- A failed gate is an operation failure (`ARTIFACT_INVALID`); the instance is `failed`.
  `start` with the same request id and same session/actor reopens it and returns a successful
  six-key result with `status:"failed"`; a different session/actor is `REQUEST_CONFLICT`.
  Do not delete the store before recording the failed evidence.
- If the host run fails, keep `/tmp/praxis-e2e.jsonl` and the store; record the failure. A
  failed model run is a failed check, not a reason to fabricate a pass. Model retries of the
  denied read are allowed; they are recorded as `deniedAttempts`.
- If G3 review FAILs, revise this plan and re-enter at step 0; no implementation step runs.

## Working notes

- **Claim rule.** Per file, at most two per assignment, never per folder. This G3 assignment
  holds `plan.md`; the reviewer holds `review.md`. The earlier folder claim is retired; the
  table above is prospective G4 ownership, not a current grant.
- **G3-F10 coverage.** The named-test table has 34 rows; every row names its step, check and
  requirement. Step 2 has 10, Step 3 has 13, Step 4 has 11. P2 runs all 34; P12/P13/P15 run
  their specific rows. A requirement without a row is carried, not implicit. The added rows
  cover R13's failed-state reopen, R12's start/submit idempotency, R8's missing-instance and
  INTERNAL negatives, R10's missing session, and R2's submit/read missing fields.
- **G3-F11 retries.** P7/P9 accept ≥1 denial, require every denial to be
  `CAPABILITY_DENIED`/`draft`, and record extra attempts as `deniedAttempts`. A non-denial
  praxis failure still fails the check.
- **G3-F12 baseline.** The lead commits the G3 evidence (`spec.md`, `plan.md`,
  `review.md`) before G4. P5 scopes to `git status --porcelain -- src tests` and the explicit
  no-change list including `package.json`, `tsconfig.json`, `.pi/settings.json` and
  `STATUS.md`; doc-only changes do not fail P5.
- **G3-F13 name evidence.** A name-pattern command that matches nothing can exit 0 and print a
  file line. Every check records a `✔ <name>` line per named test; P2 needs 34, P3 needs 4,
  P12/P13/P15 need exactly 1 each. A missing `✔` is a failed check.
- **G2-F7.** R8's expected-code list omits `ARTIFACT_VERSION_CONFLICT`. P15 seeds a pending
  artifact through `recordArtifact` in a temp instance and asserts the conflict with no write;
  the next spec touch adds the code to R8.
- **G2-F8.** The gate checks are at `details.detail.checks` (`AppError.detail` is
  `{instance, step, checks}`); the named test asserts that path. Spec R13's "in details" is
  interpreted one level deeper and should be made literal at the next spec touch.
- **G2-F9.** The actor label is `start`'s reopen/conflict key only. `submit` and `read` are
  bound by the instance id and the step grant; no actor check is added. The named test
  `submit and read are not actor bound` records the asymmetry.
- **G3-F6.** `engineOptions(ctx)` binds `configPath`/`storeDir` to `ctx.cwd`; P13 proves it
  with a temp cwd. The P8 CLI status runs from the same project root.
- **G3-F8.** `STATUS.md` names `praxis.run` while spec R1 fixes `praxis`; the lead updates
  `STATUS.md` when G2 settles. This plan does not edit it.
- **Host types.** The host package is not resolvable by `npx tsc` (executed probe: TS2307),
  and R9 forbids a new dependency or tsconfig path. `src/pi/host.ts` is therefore a local
  **type-only** mirror with the host's five-argument `execute` and required `details`; P6b
  proves no host import, P1 type-checks the local interface, and P14 checks the mirror against
  the installed host declarations. If the host becomes resolvable, an `import type` is a plan
  amendment, not a silent change.

## Out of scope

Pi-wide tool denial and the `tool_call` hook · OS sandbox or isolation · trusted identity or
profile authorization · Manifold assignment binding · nested runtimes · Fabric/MCP/Occam
adapters · external effects · a model inside the runtime · flow expansion · sticky binding,
concurrency policy or multi-instance limits · multi-actor · a new `status`/`inspect` op ·
artifact rendering · migration or retention · `package.json`/`tsconfig`/`.pi/settings`
changes · any Slice 0 source, test, flow-config, `STATUS.md`, `research.md`, `spec.md` or
`review.md` change.

## LOC budget

| Path | Cap |
| --- | --- |
| `src/types/pi.ts` | 140 |
| `src/pi/host.ts` | 100 |
| `src/pi/tool.ts` | 300 |
| `src/pi/extension.ts` | 30 |
| `tests/pi/tool.test.ts` | 450 |
| `tests/pi/fixtures.ts` | 150 |
| `tests/pi/extension.test.ts` | 100 |
| `tests/pi/e2e-prompt.md` | 80 |

No file reaches 600 lines. The caps are estimates; exceeding one needs a recorded reason, not
compression.

amended 2026-10-29 — first G3 draft after G2 draft — G3 not yet reviewed
amended 2026-10-29 — G3 attempt 2: G3 gate first, per-file claims, local host-type mirror, executable checks, G2 F7-F9 carry — G3 re-review pending
amended 2026-10-29 — G3 attempt 3: 34 named tests with step/check mapping, retry-tolerant P7/P9, explicit P5 baseline, non-vacuous name evidence — G3 re-review pending
