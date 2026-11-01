# Spec — pi-integration

Task: pi-integration · Hash: eeacf406 · Gate: G2 · Status: draft · Date: 2026-10-29

Basis: `research.md` F1–F20 in this folder. This is a draft and must not be reviewed before
G1 PASS. If G1 review changes a finding, amend this file before G2 starts.

## Outcome

One Pi tool named `praxis` exposes the accepted Slice 0 runtime inside a Pi session. The tool
starts a flow, submits the current step's artifact through the existing engine, and reads one
recorded artifact. The current step lists its granted capabilities; a step operation the step
does not grant is denied with a typed code before any effect. The parent receives the six-key
result plus a small step descriptor (and, on start, the nonce), never the event log or
transcript. This is routed-call
denial: the tool does not restrict other Pi tools, and makes no isolation claim (F14, F17).

## Requirements

| Id | Requirement | Failure behaviour | Oracle |
| --- | --- | --- | --- |
| R1 | `src/pi/extension.ts` registers exactly one `direct` tool named `praxis`; its `parameters` come from `z.toJSONSchema(PraxisToolArgsSchema)`; it registers no `tool_call`/`tool_result` handler, command or provider. | a second tool, a hand-written schema that drifts from Zod, or a hidden hook | fake-host registration count = 1; schema parity fixture; no `on(` call |
| R2 | One strict argument schema: `op: "start"\|"submit"\|"read"`; `start` needs `flow`,`requestId`; `submit` needs `instance`,`artifact`; `read` needs `instance`,`step`. Unknown keys and unknown ops are refused. | a missing per-op field reaches an engine call, or an unknown key is ignored | valid/invalid fixtures; missing field → `CONFIG_INVALID`; host rejects unknown keys |
| R3 | `start` calls the existing `start` and `inspect` and returns `{result, step, nonce}`. The instance id is the engine's pure function of flow+requestId; a repeat with the same pinned config and actor returns the same instance and writes no new row; a changed payload is `REQUEST_CONFLICT` with no second row. | forking on a repeated request, or returning a nonce that is not the pinned one | two starts, one row, same nonce; changed payload → `REQUEST_CONFLICT` |
| R4 | `submit` calls `advance` exactly once and returns `{result, step}`; it writes no status, artifact or event itself. A's accepted digest is in `result.artifacts`; B's `derivedFrom` must equal it. A wrong nonce or derivation is rejected by the gate, the instance becomes `failed`, and no B artifact is accepted. | the surface advances more than one step, accepts an artifact the gate rejects, or writes outside `advance` | two-step run; wrong `derivedFrom` → `ARTIFACT_INVALID`, failed, B not accepted |
| R5 | `read` loads the instance, opens the flow, requires `flow.configDigest === instance.configDigest`, finds the current step, and applies `grantFor` + `requireGrant(grant, "artifact.read")` before `readStepArtifact`. Without the capability: `CAPABILITY_DENIED`, zero effects. With it: `{artifact, value}` for one recorded artifact; bytes that do not match the digest fail `ARTIFACT_DIGEST_MISMATCH`. | an unguarded read, a read against a changed config, or a read that writes state | read in `draft` → `CAPABILITY_DENIED`, counts unchanged; read A in `derive` returns A; corrupt A → `ARTIFACT_DIGEST_MISMATCH` |
| R6 | `step` is derived `{id, capabilities, ops}` from the pinned flow and instance, never stored. `ops` is `submit` when the grant has `artifact.write` and status is `running`, and `read` when it has `artifact.read`; order is `submit, read` then `read`. | the descriptor disagrees with the pinned flow, lists an op the tool would deny, or hides one it would allow | `draft` → `submit`; `derive` → `submit, read`; completed `derive` → `read`; a step without write/read lists neither |
| R7 | Every call returns the host's required shape: one text `content` part plus a `details` object. Success content is the JSON text of the same success details: `start` details `{result, step, nonce}`, `submit` details `{result, step}`, `read` details `{artifact, value}`. `result` is exactly the six `Result` keys; the envelope adds only the descriptor, nonce or one artifact. No event log, transcript, tool arguments, store path or artifact bytes appear in `result`; `read` is the only op returning the artifact body. The tool does not call `ctx.executeTool`. | a seventh result key, an event/path/body leak beyond `read`, a content/details disagreement, or a nested call that creates a transcript record | key-set assertion; content parses to details; no `executeTool` in the module; store event count absent from the response |
| R8 | Every **operation failure** is an `isError:true` result: `content` is the JSON text of `details`, and `details` is `{code, message, detail?}` with a code from `src/types/errors.ts`. `AppError` passes through; any other value becomes `INTERNAL` via `asAppError`; a Zod parse failure is `CONFIG_INVALID`. A **failed instance state** is not an operation failure: it is reported in a successful six-key result with `status:"failed"` (R13). No string throw, no success-shaped operation failure, and no failed state reported as an error envelope. | a raw throw, an untyped code, a caught operation failure returned as success, or a failed state returned as an error envelope | one negative per expected operation-failure code: `CONFIG_INVALID`, `REQUEST_CONFLICT`, `INSTANCE_NOT_FOUND`, `INSTANCE_STATE_INVALID`, `ARTIFACT_INVALID`, `ARTIFACT_DIGEST_MISMATCH`, `CAPABILITY_DENIED`, `INTERNAL`; a gate rejection returns an operation failure; a later same-session `start` returns a success with `status:"failed"`. (`FLOW_INVALID` is declared but not raised by the current engine; it is carried, not tested.) |
| R9 | The engine, store, gate, canonicaliser, capabilities, result builder, error taxonomy and flow config are reused unchanged: no diff to `src/runner/*`, `src/store/*`, `src/types/schema.ts`, `src/types/errors.ts` or `.pi/praxis/config.json`; no dependency or manifest change. | an engine change needed to make the surface work is a blocker for lead, not an edit | `git diff --stat` limited to declared paths; import scan |
| R10 | The actor is a correlation label, `"pi-session:" + shortDigest(ctx.sessionManager.getSessionId())`, where `shortDigest` is the first 32 hex of sha256 over `"session:" + sessionId`, bounded to `ActorSchema`, obtained from the host context and never from tool arguments. A missing session id is a typed failure with zero state. No authorization decision may rely on this label; gate #3 remains open. | accepting `actor` from args, storing the raw session id, or claiming a trusted identity | schema has no `actor`; fixed fake id → stable label; missing `getSessionId` → typed failure, no instance |
| R11 | The containment claim is routed-call denial only. The tool denies its own step operations by step grant; it does not intercept `bash`, `read`, `grep`, Fabric, MCP, another extension, a shell or a new Pi session, and makes no isolation, sandbox or "cannot touch anything else" claim. A literal Pi-wide denial is out of scope and, if required, a new unit/blocker. | a test or document claiming Pi-wide denial or isolation | limitation probe in the host (`bash` still runs when declared); wording review |
| R12 | Idempotency: `start` with the same request id, config digest and actor returns the same instance; `submit` with the same payload reuses a pending version; a changed payload is `ARTIFACT_VERSION_CONFLICT` and writes nothing; a completed instance returns its completed result on a repeated `submit`; a failed instance refuses `submit` with `INSTANCE_STATE_INVALID`. | a duplicate accepted artifact, a second instance for one request, or a failed instance accepting a write | repeat calls; row counts; version/state assertions |
| R13 | A gate rejection is an **operation failure** (`ARTIFACT_INVALID`) and leaves the instance `failed`, with the gate checks in `details`. A later `start` with the same request id **and the same session/actor** reopens it and returns a **successful** six-key result with `status:"failed"`; a different session/actor with the same request id is `REQUEST_CONFLICT` and writes no row. `submit` on a failed instance is `INSTANCE_STATE_INVALID`; `read` follows the current step grant. No new status-by-instance op is added; the existing CLI `status` remains the headless inspector. | a failed instance silently returning to `running`, a failed state reported as an error envelope, a new session treated as a reopen, or a duplicate status surface | force a gate rejection → `ARTIFACT_INVALID`; same-session/actor `start` → success with `result.status="failed"`; new fake session `start` → `REQUEST_CONFLICT`, one row; `submit` → `INSTANCE_STATE_INVALID`; `read` follows the grant |

## Model

### States and operations

The engine owns the state machine; the tool never sets status directly. The instance row is
the only mutable state, guarded by `revision`; events and artifact versions are append-only.

```
no instance --start--> running(draft) --submit A--> running(derive) --submit B--> completed
                          |                            |
                          |--read (draft) denied       |--read A allowed
                          |--gate reject--> failed     |--gate reject--> failed
```

| State | `start` | `submit` | `read` |
| --- | --- | --- | --- |
| no instance | creates; returns result, step, nonce | `INSTANCE_NOT_FOUND` | `INSTANCE_NOT_FOUND` |
| running | same request + same session/actor reopens; same request + different session/actor `REQUEST_CONFLICT`; a different request creates another instance | `advance` if the step grants `artifact.write` | one artifact if the step grants `artifact.read` |
| completed | same request + same session/actor reopens and returns the completed result; a different session/actor `REQUEST_CONFLICT` | returns the completed result, no effect | one artifact if the step grants `artifact.read` |
| failed | same request + same session/actor reopens and returns a successful result with `status:"failed"`; a different session/actor `REQUEST_CONFLICT` | `INSTANCE_STATE_INVALID` | one artifact if the step grants `artifact.read` |

`start` is not a sticky binding: a different request id creates a second instance. Sticky
binding, concurrency policy and multi-instance limits are out of scope (R9, Exclusions).

### Ownership — one owner per fact

| Fact | Owner | Note |
| --- | --- | --- |
| flow, step ids, step capabilities, gate name | `.pi/praxis/config.json` via `FlowConfig` | unchanged |
| instance status, current step, revision, nonce | `instance` row + engine | engine transitions only |
| event history | `event` table | append-only |
| artifact bytes, digest, state, derivation | `artifact` table + artifact files | engine write/accept only |
| six-key parent result | `src/runner/result.ts` | unchanged |
| step grant decision | `src/runner/capabilities.ts` | unchanged |
| tool argument and envelope schemas | `src/types/pi.ts` (Zod) → `z.toJSONSchema` | one authority; no hand-written second schema |
| step descriptor | `src/pi/tool.ts` | derived per call; never stored |
| bounded envelope construction | `src/pi/tool.ts` | content text = JSON of details; validated by the strict envelope schemas |
| actor label | host session id → short hash | correlation only, not authority |
| typed failure | `src/types/errors.ts` + the failure schema in `src/types/pi.ts` | reused codes; no new code |

### Envelopes

The host requires `content: (TextContent | ImageContent)[]` and a `details` value
(`@earendil-works/pi-agent-core/dist/types.d.ts:370-386`; `docs/extensions.md:247-259`).
The tool returns one text part plus the structured envelope. The content is the JSON text of
the same `details`; the model reads the content, and the renderer or state reads `details`.
They are one envelope in two channels, not two authorities.

```
Success details:
start:  { result: Result, step: StepDescriptor, nonce: Nonce }
submit: { result: Result, step: StepDescriptor }
read:   { artifact: ArtifactSummary, value: unknown }

Failure details (isError:true):
{ code: Code, message: string, detail?: unknown }

Result = { instanceId, flow, status, artifacts, summary, nextAction }   // exactly six
StepDescriptor = { id, capabilities: Capability[], ops: ("submit"|"read")[] }
ArtifactSummary = { step, version, digest, schema, state }              // no path
```

`artifact` in `read` is the summary, not the store row: no path and no artifact bytes in
`result`. The `value` is the parsed artifact body the caller explicitly asked for. A failed
instance state is returned in the success details as `result.status = "failed"`; an operation
failure is returned with `isError: true` and the failure details above. The two are never
mixed.

### Denial points

1. **Host schema validation** — shape only: `op` present, unknown keys rejected. The host
   schema generated from `superRefine` requires only `op`; per-op required fields are
   enforced by the handler's Zod parse and become `CONFIG_INVALID`. This is not a capability
   check (F4; review G2-F3).
2. **Tool handler, before the engine call** — per-op Zod parse, actor derivation, pinned
   config digest, and the `read` grant check (F9). A failure here returns a typed
   `isError` result and writes nothing.
3. **Engine, inside `advance`** — status, pinned digest, step lookup, `grantFor`,
   `buildHandoff`, artifact write/read and gate (F8). The engine is authoritative for
   `submit`; the tool must not duplicate or bypass it.

### Containment limit

The check in (2) and (3) constrains calls **routed through `praxis`**. Pi's `tool_call`
hook could block other Pi tools, but the flow has no owner for Pi tool names and a global
lockdown is a new policy (F11, F12). The extension therefore does not claim that `bash`,
`read`, Fabric, MCP, another extension, a shell or a new session is blocked. Pi runs
extensions with the user's OS permissions and has no built-in sandbox (F13, F14). Gate #1
stays open.

## Alternatives considered

| Option | Why not this unit |
| --- | --- |
| A. Tool-surface denial (chosen) | Reuses the accepted engine and gate; every operation is gated by the pinned step; the claim is honestly bounded to routed calls. |
| B. Pi `tool_call` hook with a one-tool lockdown | The hook can block a model-issued call before execution, but it has no step-to-Pi-tool owner, the flow schema owns only capabilities, and a global "only praxis" rule is a new authority that is still bypassable. It would need its own gate and tests. |
| C. Add `tools: string[]` to each flow step and gate Pi tools through the hook | Satisfies a literal Pi-wide reading but changes the accepted `FlowConfig` schema, engine validation and the pinned config digest; that is a blocker for lead, not a surface change. |
| D. Three tools (`praxis_start`, `praxis_submit`, `praxis_read`) | Each op gets an exact host schema and no `superRefine`; the cost is three registrations, three model-facing descriptions and three exposure surfaces, and the step gate must be shared or duplicated. Rejected because the contract is one tool and the one-tool schema plus handler split is smaller (`MIN-006`). |
| E. OS sandbox / broker | The only route to a real "cannot touch anything else" claim; gate #1 is open and a sandbox is a separate integration, not this slice. |

## Exclusions

No Pi-wide tool denial · no `tool_call`/`tool_result` hook · no OS sandbox or isolation claim ·
no trusted identity or profile authorization · no Manifold assignment binding · no nested
runtimes · no Fabric/MCP/Occam adapters · no external effects · no model or LLM inside the
runtime · no flow expansion · no sticky binding or concurrency policy · no multi-actor ·
no new `status`/`inspect` op · no artifact rendering · no migration or retention · no
package.json/tsconfig/.pi/settings change · no change to Slice 0 source or flow config.

## Claim rule (working note)

Claims are per file, at most two per assignment, never per folder. This assignment claims
`docs/pi-integration-eeacf406/spec.md` and `.../research.md`; `review.md` is reviewer-only
and `plan.md` is unclaimed. The requested G3 claim-split note therefore belongs to the next
assignment that claims `plan.md`; it is not written here. For that round, the reviewer's
G3-F3 cure is to replace the folder claim with the three explicit files and keep
`review.md` with the reviewer.

## Open questions and blockers

1. **Literal Pi-wide denial.** If lead requires "any other Pi tool call is denied" in the
   Pi host, the unit is blocked on a step-to-Pi-tool owner (option C) or a global lockdown
   (option B); neither is an unchanged-engine change. Decision needed before G3 approval.
2. **Trusted identity (gate #3).** The actor is a host session correlation label, not an
   authenticated identity. Any authorization based on it is out of scope.
3. **Pi host seam (gate #2).** `registerTool` and `sessionManager.getSessionId()` are
   documented, but out-of-context invocation, cancellation and restart behavior are not
   designed here; this unit runs in-process only.
4. **Schema path.** The Zod→JSON Schema probe was executed outside `registerTool` (F3).
   The host check must confirm Pi accepts the generated parameters; otherwise the fallback
   is a literal TypeBox-shaped object, recorded as a plan amendment.
5. **`read` size.** `read` returns one artifact body with no cap. It is an explicit
   inspection, not the bounded result; a cap or pagination is a later decision.
6. **Status by instance id.** Without a request id, the parent cannot re-open an instance.
   The CLI `status` remains the headless inspector; a Pi status op is not added (R13).

amended 2026-10-29 — first G2 draft after G1 findings — G2 not yet reviewed
amended 2026-10-29 — G2 attempt 2: split operation failure from failed-instance state, fixed delivery shape, qualified start by session/actor, added claim rule — G2 re-review pending
