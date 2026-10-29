# Plan — pi-integration

Task: pi-integration · Hash: eeacf406 · Gate: G3 · Status: draft · Date: 2026-10-29

Basis: `spec.md` R1–R13 in this folder. This is a draft; G4 may not start before G3 PASS.
Every declaration below is bound to a requirement (`MIN-004`); no declaration is added for a
hypothetical future (`MIN-006`). The step grant and the flow remain the single owner of
capabilities (`MIN-005`).

## Ownership split (write claims)

Exactly one writer per path. A needed change outside your claim is a blocker for lead, never an
edit. Each engineer holds two claims. Nobody edits the Slice 0 paths or the flow config.

| Claim | Owner | Paths |
| --- | --- | --- |
| A | engineer-1 | `src/types/pi.ts`, `src/pi/host.ts` |
| B | engineer-1 | `src/pi/tool.ts`, `src/pi/extension.ts` |
| C | engineer-2 | `tests/pi/tool.test.ts`, `tests/pi/extension.test.ts` |
| D | engineer-2 | `tests/pi/fixtures.ts`, `tests/pi/e2e-prompt.md` |
| E | architect | `docs/pi-integration-eeacf406/` (research, spec, plan) |
| F | reviewer-1 | `docs/pi-integration-eeacf406/review.md` (append-only) |

Read-only for everyone: `src/runner/*`, `src/store/*`, `src/types/schema.ts`,
`src/types/errors.ts`, `src/cli.ts`, `.pi/praxis/config.json`, `package.json`,
`tsconfig.json`, `.pi/settings.json`.

## Declarations

| Path | Declaration | Requirement |
| --- | --- | --- |
| `src/types/pi.ts` | `PraxisToolOpSchema` (`z.enum(["start","submit","read"])`) | R2 |
| | `PraxisToolArgsSchema` (strict object + `superRefine` per-op requirements) and `PraxisToolArgs` | R2, R5, R10 |
| | `StepDescriptorSchema` / `StepDescriptor` (`id`, `capabilities`, `ops`) | R6 |
| | `ArtifactSummarySchema` / `ArtifactSummary` (no path) | R5, R7 |
| | `StartEnvelopeSchema`, `StepEnvelopeSchema`, `ReadEnvelopeSchema`; `PraxisToolEnvelope` | R3, R4, R7 |
| `src/pi/host.ts` | `PiSessionContext` (`sessionManager.getSessionId()`, `cwd`) | R10 |
| | `PiToolResult` (`content`, optional `details`, optional `isError`) | R7, R8 |
| | `PiToolDefinition` (`name`, `label`, `description`, `parameters`, `executionMode`, `execute`) | R1, R2 |
| | `PiHost` (`registerTool`) | R1 |
| `src/pi/tool.ts` | `PRAXIS_TOOL_NAME`, `PRAXIS_TOOL_DESCRIPTION` | R1, R11 |
| | `PRAXIS_TOOL_PARAMETERS` = `z.toJSONSchema(PraxisToolArgsSchema, {target:"draft-2020-12"})` | R1 |
| | `actorFor(ctx)` — host session id → bounded correlation label | R10 |
| | `stepDescriptor(flow, instance)` — derived, never stored | R6 |
| | `executePraxisTool(args, ctx)` — start / submit / read dispatch | R2–R8, R12, R13 |
| | `createPraxisTool()` — one `PiToolDefinition`, `executionMode: "sequential"` | R1, R4 |
| | `ok`, `failure` — validated envelope or typed `isError` result | R7, R8 |
| `src/pi/extension.ts` | default `praxisExtension(pi: PiHost)`; exactly one `pi.registerTool(...)`, no `pi.on(...)` | R1, R11 |
| `tests/pi/fixtures.ts` | temporary flow config (draft/derive), artifacts, fake context, temp store helper | tests |
| `tests/pi/tool.test.ts` | start/submit/read, descriptor, denial, gate rejection, idempotency, envelope, typed errors | R3–R8, R12, R13 |
| `tests/pi/extension.test.ts` | fake host: one tool, no hook, parameter shape | R1, R11 |
| `tests/pi/e2e-prompt.md` | exact host prompt and expected observations | R11, host check |

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

## Steps (ordered by dependency)

1. **Types and host interface** (claim A). Write `src/types/pi.ts` and `src/pi/host.ts`.
   Done when `npx tsc --noEmit` passes and the valid/invalid argument fixtures parse with
   the expected failures.
2. **Tool schema, actor and descriptor** (claim B, depends 1). Generate the parameters from
   Zod; implement `actorFor` and `stepDescriptor`. Done when the parameter fixture matches
   and the descriptor fixtures for draft, derive and completed are exact.
3. **Start, submit and read handlers** (claim B, depends 2). Dispatch to `start`+`inspect`,
   `advance`, and `readStepArtifact`; build and validate the envelopes; map `AppError` to
   a typed `isError` result. Done when the in-process two-phase run completes and the result
   has exactly six keys.
4. **Read guard and pinned digest** (claim B, depends 3). Before `readStepArtifact`, verify
   the pinned config digest, find the current step, apply `grantFor`+`requireGrant("artifact.read")`.
   Done when a `draft` read is `CAPABILITY_DENIED` with zero state change, a `derive` read
   returns A, and a corrupted A file is `ARTIFACT_DIGEST_MISMATCH`.
5. **Registration** (claim B, depends 3). Add the default extension factory with exactly one
   `registerTool`. Done when the fake-host test sees one tool named `praxis` and no `on`
   registration.
6. **Acceptance checks** (claims C/D, depends 3–5). Write the tests and the host prompt; run
   P1–P12 below; record every command and its real output. Done when all checks have a
   recorded result and the host run completes the two-phase flow.
7. **Review** (claim F). G3 review against R1–R13; then G4. Done when the verdict has a
   `sha256` of every reviewed file and states `independence: self` unless a separate
   reviewer session actually produced it.

## Checks

| # | Command | Expects |
| --- | --- | --- |
| P1 | `npx tsc --noEmit` | clean |
| P2 | `node --test tests/pi/tool.test.ts` | start/submit/read, six-key result, descriptor, denial, gate rejection, idempotency, typed errors |
| P3 | `node --test tests/pi/extension.test.ts` | exactly one `registerTool`; no `on`; parameters match the fixture |
| P4 | `node --test tests/store/*.test.ts tests/runner/*.test.ts` | all 29 Slice 0 tests still pass |
| P5 | `git diff --stat` and `git status --porcelain` | only claims A–F; no engine/store/schema/errors/config change |
| P6 | `grep -rnE "^import .* from " src/pi src/types/pi.ts \| grep -vE 'node:\|zod\|\./\|\.\./'` | empty: no host runtime import; type-only local interfaces |
| P7 | `pi --mode json --extension ./src/pi/extension.ts --tools praxis --print "$(cat tests/pi/e2e-prompt.md)" > /tmp/praxis-e2e.jsonl` | at least three `"toolName":"praxis"` starts; no `extension_error`; the final result is `completed` |
| P8 | parse the first praxis result's `instanceId`; `node --experimental-strip-types src/cli.ts status <instanceId>` | status `completed`; result artifacts include `draft` and `derive`; store rows for both are `accepted`; result has exactly six keys |
| P9 | grep the JSONL for the draft-read attempt and for `CAPABILITY_DENIED` | the host run observed the typed denial; if the model did not attempt the read, run the explicit denial prompt and record it |
| P10 | grep the JSONL for `nestedCalls` on praxis results | absent: the tool never calls `ctx.executeTool` |
| P11 | limitation probe: `pi --mode json --extension ./src/pi/extension.ts --tools praxis,bash --print "<start then call bash>"` | if the model calls bash, it runs; the unit does not block it. This is evidence for R11, not a failure |
| P12 | count `event` and `artifact` rows in the store for the instance before/after the denied read | unchanged: the denial leaves zero effects |

Every check is executed and its real output recorded. A check that did not run is reported as
not run. The JSONL and the store are kept under `/tmp` or the disposable
`.pi/praxis/state/`; they are not committed.

## Recovery

- Delete `.pi/praxis/state/` and rerun. No migration or repair path: the store is disposable,
  as in Slice 0.
- `start` with the same request id, config digest and actor reopens the instance and returns
  its nonce. `submit` with the same payload reuses a pending version; a different payload is
  `ARTIFACT_VERSION_CONFLICT` and writes nothing.
- A failed gate leaves the instance `failed`; `start` reopens it and returns the failed
  result. Do not delete the store before recording the failed evidence.
- If the host run fails, keep `/tmp/praxis-e2e.jsonl` and the store; record the failure. A
  failed model run is a failed check, not a reason to fabricate a pass.

## Out of scope

Pi-wide tool denial and the `tool_call` hook · OS sandbox or isolation · trusted identity or
profile authorization · Manifold assignment binding · nested runtimes · Fabric/MCP/Occam
adapters · external effects · a model inside the runtime · flow expansion · sticky binding,
concurrency policy or multi-instance limits · multi-actor · a new `status`/`inspect` op ·
artifact rendering · migration or retention · `package.json`/`tsconfig`/`.pi/settings`
changes · any Slice 0 source, test or flow-config change.

## LOC budget

| Path | Cap |
| --- | --- |
| `src/types/pi.ts` | 120 |
| `src/pi/host.ts` | 80 |
| `src/pi/tool.ts` | 260 |
| `src/pi/extension.ts` | 30 |
| `tests/pi/*.ts` | 450 |
| `tests/pi/e2e-prompt.md` | 60 |

No file reaches 600 lines. The caps are estimates; exceeding one needs a recorded reason, not
compression.

amended 2026-10-29 — first G3 draft after G2 draft — G3 not yet reviewed
