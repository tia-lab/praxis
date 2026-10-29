# Research — pi-integration

Task: pi-integration · Hash: eeacf406 · Gate: G1 · Status: review · Date: 2026-10-29

## 0. Contract

task: Expose the Praxis runtime inside Pi as one tool with step-scoped tool denial
scope: src/, tests/, the pi-integration task folder in docs/
acceptance: an agent inside Pi runs the two-phase flow through a Praxis tool; the current step lists its allowed tools and any other tool call is denied with a typed code before execution; the parent receives the bounded result; the existing engine, store and gate are reused unchanged; every check is executed and its output recorded

```sh
canonical() { printf 'task: %s\nscope: %s\nacceptance: %s\n' "$1" "$2" "$3" \
  | sed -E 's/[[:space:]]+$/ /' | sed -E 's/[[:space:]]+$//'; }
canonical "<task>" "<scope>" "<acceptance>" | sha256sum | cut -c1-8   # eeacf406
```

## 1. Inheritance

Slice 0 is accepted: engine, store, append-only events, canonical artifacts, the gate, the
six-field result and 29 tests in `tests/`. This unit adds the **Pi surface** only. If the spec
concludes the engine must change, that is a blocker reported to lead, not a silent edit.

## 2. What G1 must establish

| # | Question | Why it decides the design |
| --- | --- | --- |
| Q1 | How a Pi extension tool is registered, and how its schema is exposed to the model | the whole surface is one tool or three |
| Q2 | What the parent agent can observe after the call | the bounded-result claim depends on it |
| Q3 | Where a denial can be enforced **before** execution: Praxis tool surface, Pi `tool_call` hook, or a broker | without this, containment is a prompt |
| Q4 | What the honest claim is: routed-call denial, never isolation | gate #1 stays open |
| Q5 | What the two-phase proof becomes inside Pi, and what it cannot prove | the acceptance test |
| Q6 | Whether trusted identity exists yet, or the actor arrives as an untrusted field | gate #3 |

## 3. Constraints the spec may not assume away

- Gate #2 (Pi host seam) and gate #3 (trusted identity) are **open**. If the unit needs either,
  name the blocker instead of assuming a binding that does not exist.
- The broker constrains only calls routed through Praxis. An agent with direct shell or Fabric
  access bypasses it; that must be stated wherever containment is claimed.
- MAN-2: launching a team from a tool call can strand intents. Compose and launch are separated.
- One team slot at a time.

## 4. Findings

Labels: `source-inspected` = read at the cited line; `executed` = command run in this session;
`inference` = follows from the cited facts; `untested` = not run. The installed host is Pi
1.4.0 (`pi --version`). Package paths are relative to
`/home/tia/.bun/install/global/node_modules/`.

### Q1 — how a Pi extension tool is registered and how its schema reaches the model

**Answer.** One extension factory registers one `direct` tool with
`pi.registerTool({name, label, description, parameters, execute})`. `parameters` is a
TypeBox/JSON Schema object; the model receives it while the tool is active. The operation
union lives inside that one schema, so step scoping is a runtime check, not a schema variant.

- F1 [source-inspected] `ExtensionAPI.registerTool` takes a `ToolDefinition`
  (`@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:451-530`, `:1229`);
  the required fields are `name`, `label`, `description`, `parameters` and `execute`.
  The factory receives `ExtensionAPI` (`.../docs/extensions.md:11-25`).
- F2 [source-inspected] The host validates arguments with TypeBox `Compile`
  (`@earendil-works/pi-ai/dist/utils/validation.js:246-320`). `parameters` need not carry
  the TypeBox brand symbol: the branded branch only affects coercion
  (`.../validation.js:296-310`), so a plain JSON Schema object is compiled.
- F3 [executed] Zod 4.6.7 `z.toJSONSchema(schema, {target:"draft-2020-12"})` produced a
  standard union document; TypeBox 1.3.27 `Compile` accepted a valid `start` object and
  rejected an invalid `submit` object. Probe run from the project root with local `zod`
  and the installed `typebox/build/compile/index.mjs`; output `true false`; the temporary
  file was removed. The probe body:

  ```js
  const S = z.discriminatedUnion("op", [
    z.strictObject({ op: z.literal("start"), flow: z.string().min(1), requestId: z.string().min(1) }),
    z.strictObject({ op: z.literal("submit"), instance: z.string().min(1), artifact: z.record(z.string(), z.unknown()) }),
  ]);
  const js = z.toJSONSchema(S, { target: "draft-2020-12" });
  const v = Compile(js);
  console.log(v.Check({ op: "start", flow: "architect", requestId: "r1" }),
              v.Check({ op: "submit", instance: "x" }));
  // true false
  ```

  This lets `src/types/pi.ts` be the single schema authority with no new dependency. It
  was not run through `registerTool`; the plan's host check must confirm that path.
- F4 [source-inspected] The model sees the tool only while it is active/direct;
  `exposure` and the active set are exposure controls (`.../docs/extensions.md:267-277`).
  `--tools praxis` selects the declared set (`.../docs/cli.md:119-135`). A static schema
  cannot vary by step, so the tool must accept the operation union and deny at runtime.

### Q2 — what the parent agent can observe after the call

**Answer.** The parent sees the tool's `content` in the transcript and the persisted
`details`; it does not see the store, event log or artifact bytes unless the tool returns
them or the agent uses another tool. Boundedness is the tool's own contract, not a host
guarantee.

- F5 [source-inspected] A tool result requires `content` and `details`; throwing produces
  a failed result, while returning an object is not an error; `isError:true` carries a
  failure with data (`.../docs/extensions.md:247-259`). The host records tool execution
  start/end events with args and result (`.../docs/json.md:105-114`).
- F6 [source-inspected] Nested calls are recorded only when the tool uses
  `ctx.executeTool`; the session keeps a bounded `nestedCalls` record (name, arguments,
  status, duration, error; never results), and the events carry `parentToolCallId`
  (`.../docs/extensions.md:261`; `.../types.d.ts:269-290`, `:931-940`). The `praxis`
  tool will not call `ctx.executeTool`, so it creates no nested-call record.
- F7 [inference] The parent can still read `.pi/praxis/state/` or the artifact files with
  its own `read`/`bash`/Fabric path if those tools are available. "No transcript in the
  result" is a statement about the returned envelope, not containment.

### Q3 — where a denial can be enforced before execution

**Answer.** Three candidates exist; only the first is this unit's boundary. (a) The
`praxis` tool checks the current step's grant before its engine call. (b) Pi's
`tool_call` hook can block any model-issued Pi tool before execution. (c) A broker would
be the same check for routed calls; no separate broker exists. This unit uses (a). (b) is a
future layer, not a containment guarantee.

- F8 [source-inspected] `requireGrant` throws `CAPABILITY_DENIED` before the body runs
  (`src/runner/capabilities.ts:55-79`); `runStep` wraps the artifact read/write in
  `call(...)` (`src/runner/engine.ts:459-488`); `buildHandoff` refuses before dispatch
  when `artifact.read` is absent or the digest is wrong (`.../engine.ts:516-548`).
  `advance` is the only transition (`.../engine.ts:309-406`).
- F9 [source-inspected] `readStepArtifact` performs **no** grant check
  (`src/runner/engine.ts:290-302`); it is the CLI's read surface. A Pi `read` operation
  must therefore pre-check the current step's `artifact.read` against the pinned flow, or
  it becomes an unguarded backdoor.
- F10 [source-inspected] A `tool_call` handler can return `{block:true, reason}`, and the
  call becomes an error result before execution
  (`.../docs/extensions.md:218`, `:375`;
  `.../types.d.ts:1089-1104`;
  `@earendil-works/pi-agent-core/dist/agent-loop.js:498-522`). It sees `toolName`,
  `input`, `toolCallId`, optional `parentToolCallId` and `ctx`
  (`.../types.d.ts:931-984`, `:213-250`). A handler failure blocks the tool (fail-safe).
- F11 [source-inspected] The hook has no step authority to consult. The flow's step owns
  `capabilities` (`src/types/schema.ts:54-60`); the closed registry is
  `artifact.read|artifact.write|emit` (`src/types/schema.ts:21`;
  `src/runner/capabilities.ts:16,39-52`). None of those are Pi tool names. A step-to-Pi-
  tool map has no owner; adding one changes the accepted `FlowConfig` schema. A global
  "only praxis" lockdown is a new Pi-surface policy and is still bypassable. Either is a
  new unit or owner decision, not an unchanged-engine change.
- F12 [source-inspected] `setActiveTools`/`--tools` control what is declared, not what is
  authorized (`.../docs/extensions.md:277`; `.../docs/cli.md:119-135`). An undeclared
  tool fails "not found" in the loop (`.../agent-loop.js:483-493`), but a new session, an
  extension, or a shell can restore the path. Exposure is not enforcement.
- F13 [source-inspected] MCP calls pass through the same pipeline, so a hook would cover
  them (`.../docs/mcp.md:252`); direct Fabric/HTTP/OS calls do not. Extensions run with
  the Pi process's OS permissions (`.../docs/extensions.md:5`;
  `.../docs/security.md:19,33`).

### Q4 — the honest claim

**Answer.** This unit claims **routed-call denial**: a step operation on the `praxis` tool is
denied before effect when the current step does not grant it. It does not claim that
the agent cannot call another Pi tool, a shell, Fabric, MCP, another extension or a new
session, and it does not claim isolation or sandboxing.

- F14 [inference, documented] `docs/vision.md:49-51` states that the actor must come from a
  trusted binding and that broker checks constrain only routed calls; a "cannot touch
  anything else" claim needs a separate integration gate. `AGENTS.md` repeats the same
  limit. Pi has no built-in sandbox; the process keeps the user's OS permissions
  (`.../docs/security.md:1-23`). Gate #1 (isolation) stays open.

### Q5 — what the two-phase proof becomes inside Pi, and what it cannot prove

**Answer.** It becomes three calls in one Pi session: `start`, `submit` A, `submit` B.
A's digest is in `result.artifacts[0].digest`; B's `derivedFrom` must equal it; the nonce
comes from `start`. The engine, store and gate are unchanged. The proof is a
surface-and-gate proof, not an out-of-context proof.

- F15 [source-inspected] The gate checks `schema`, `nonce` and, for a consuming step,
  `derivedFrom` (`src/runner/engine.ts:556-573`); `advance` records
  `artifact.accepted` with the digest and `derivedFrom` (`.../engine.ts:373-385`) and
  completes after the last step (`.../engine.ts:393-403`). The result is the six-key
  `buildResult` (`src/runner/result.ts:16-52`).
- F16 [inference] It proves: the Pi tool drives the accepted engine; the gate rejects a
  wrong nonce or derivation; a disallowed step operation is denied with a typed code and
  no effect; the parent receives the bounded result. It cannot prove: a fresh phase that
  did not author A (one agent wrote both, and A remains in its context); two processes or
  restart in Pi; Pi-wide tool denial; trusted identity; exactly-once effects; isolation.
  The CLI's two-process proof (`docs/slice-0-1947a537/spec.md`, Process interface)
  remains the stronger containment evidence.
- F17 [inference] The acceptance phrase "any other tool call is denied" is ambiguous. This
  unit reads it as "any other operation on the `praxis` tool". A literal Pi-wide reading
  is blocked: it needs a step-to-Pi-tool owner (engine schema change) or a global lockdown
  policy, and even then it is not isolation. This is surfaced to lead as a decision; the
  spec states the routed reading explicitly.

### Q6 — whether a trusted identity exists

**Answer.** There is no trusted actor yet. The engine accepts an actor from an option,
environment variable or the CLI; Pi supplies a host session ID, not an authenticated
identity. Gate #3 is open.

- F18 [source-inspected] `start` pins
  `options.actor ?? process.env.PRAXIS_ACTOR ?? "cli"`
  (`src/runner/engine.ts:224`); the CLI accepts `--actor`
  (`src/cli.ts:47-53`). This is an untrusted request or environment value.
- F19 [source-inspected] `ExtensionContext` exposes `cwd` and
  `sessionManager.getSessionId()` (`.../types.d.ts:213-250`;
  `.../core/session-manager.d.ts:178,246`); it exposes no authenticated actor. A session
  ID is host-generated correlation, not authority; a new session has a new one. Manifold
  assignments are a separate authority and are not consulted by this engine.
- F20 [inference] The spec pins `actor = "pi-session:" + shortDigest(sessionId)` as a
  correlation label only; no authorization decision may rely on it. A trusted
  Pi/Manifold binding is a separate owner decision.

### Competing explanations

- "One active tool is containment." Rejected: `--tools`/`setActiveTools` is exposure
  (F12); a new session or another extension restores the path; shell/Fabric bypass.
- "The `tool_call` hook can deny everything, so the agent is contained." Partially true
  for model-issued calls in the same pipeline (F10, F13), but there is no step owner for
  Pi tool names (F11), and direct OS/Fabric paths bypass it. It would be a new layer with
  its own gate, not evidence for this unit.
- "The engine already denies `submit`, so the Pi surface needs no checks." True for
  `submit` (F8); false for `read` (F9). The surface must add the `read` pre-check.
- "The nonce must stay secret to prove provenance." Rejected: `start` returns it, and a
  step with `artifact.read` can read it from A. The gate is a consistency check, not a
  secrecy boundary.

### Affected owners and callers

- Unchanged: `src/runner/*` (engine, capabilities, canonical, result), `src/store/*`,
  `src/types/schema.ts`, `src/types/errors.ts`, `.pi/praxis/config.json`. The CLI
  remains the headless caller.
- New caller: the Pi extension loader and the model's `praxis` tool calls; the parent
  transcript is the observer.
- Pi host: `registerTool`, `ExtensionContext.sessionManager`, and the `tool_call`
  pipeline (not used in this unit).
- Owner decisions: gate #1 (isolation), gate #2 (host seam), gate #3 (trusted identity),
  and a future step-to-Pi-tool owner if literal Pi-wide denial is required.

### Uncertainty

- F3 was executed outside `registerTool`; the host check must confirm the generated schema
  is accepted and the model calls it. If not, the fallback is a literal TypeBox-shaped
  parameters object; that is a plan change, not a silent edit.
- The host run uses a real model; its tool-call behavior is not deterministic. A failed run
  is a failed check, recorded as such.
- The `tool_call` hook's parallel and nested-session behavior is documented but not
  executed here; this unit does not use it.
- SQLite `synchronous=FULL` under power loss remains untested (Slice 0 uncertainty).
- Pi 1.4.0 is the installed host; a host upgrade may change the virtual modules or the
  tool contract.

### Handoff

`spec.md` fixes the surface (R1-R13), the model and the exclusions; `plan.md` fixes the
declarations, the ownership split, the steps, the checks and recovery. G1 review is the
next gate. The spec and plan are drafts and must not be reviewed before G1 PASS.

amended 2026-10-29 — Q1–Q6 findings recorded — G1 authoring complete

