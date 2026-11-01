# Design — one composed system prompt, conduct → role → domain → environment

Task: composed-prompt · Hash: c0c929ff · Gate: design (research + spec in one doc, per the unit) · Date: 2026-11-01
**Design only.** No runtime code, no schema, no store, no flow change. Plan: `plan.md` (this folder).
Gates crossed: **#2 Pi host seam** and **#3 trusted identity** — both flagged in §9, neither closed here.

## 0. Contract

<!-- One physical line per key: this block is the hash input. Never reflow it. -->

task: replace the agent's whole system prompt at every run boundary with one composed prompt — conduct, role, optional domain, then Pi's own prompt nested as environment — from the authored profiles via before_agent_start
scope: docs/<slug>-<hash8>/; later src/pi/{extension.ts,host.ts}, src/runner/engine/profile.ts, src/types/profile.ts, src/pi/descriptor.ts, src/types/pi.ts, src/runner/engine/start.ts, tests/
acceptance: a freshly launched agent receives conduct->role->domain?->environment as ONE system prompt, provable from the live prompt and not from the files; conduct and role are fixed across tasks while the domain follows the current task's node; the legacy static conduct addendum and the tool-brief domain are removed; existing tests are adjusted; gates #2 and #3 stay open and are flagged

Recompute: `printf 'task: %s\nscope: %s\nacceptance: %s\n' '<t>' '<s>' '<a>' | sed -E 's/[[:space:]]+$//' | sha256sum | cut -c1-8` → `c0c929ff`.

## 1. Outcome

At **every run boundary** the agent's whole system prompt is replaced by one composed prompt, in this order:

```text
conduct       profile/conduct/occam.json      FIXED      leads
role          profile/role/<role>.json        FIXED      one seat per session
domain?       profile/domain/<id>.json        DYNAMIC    the CURRENT step's node declares it
environment   Pi's own current system prompt              nested LAST, never first
```

Conduct and role are identical on every boundary. The domain is recomputed for the current step. The environment
re-wraps whatever Pi would have used. Within a run the composed text is the standing prompt on every turn.

There is no addendum and there is no second prompt: the host prompt is **nested inside** ours, so the agent reads
one document.

## 2. What the host actually exposes — source-inspected

| Claim | Source |
| --- | --- |
| `before_agent_start` fires before a run, with the message it was started by | `docs/extensions.md:216`; `dist/core/extensions/types.d.ts:717-741` |
| the event carries the **current rendered prompt** as a readonly string | `types.d.ts:720` (`readonly systemPrompt: string`) |
| and the mutable sections it was rendered from | `types.d.ts:722-723` (`systemPromptOptions`) |
| returning `systemPrompt` **replaces the whole prompt for that run**; later handlers observe the override | `types.d.ts:1125-1129`; `docs/extensions.md:216` |
| `forceSystemPrompt` is the equivalent lever on the options object | `dist/core/system-prompt.d.ts:6-9`; `docs/extensions.md:216` |
| the registration call | `types.d.ts:1207` `on("before_agent_start", handler)` |
| `getCurrentSystemPrompt(context.messages)` is the **provider-side** reader of transcript system messages | `docs/custom-provider.md:176` — not the hook's API |
| today the Praxis extension registers **no** hook | `src/pi/extension.ts:16-18` (only `registerTool(withFooter(...))`) |
| the domain layer is loaded and pinned today, but only reaches the **tool brief** | `src/runner/engine/flow.ts:78-95, 148-149`; `src/runner/engine/start.ts:94`; `src/pi/descriptor.ts:216-224, 281-295`; `src/types/pi.ts:126-141` |
| the loader is domain-only by construction | `src/runner/engine/profile.ts:8-10, 26, 35, 55-57` |
| the layer enum already names all three | `src/types/profile.ts:15` |
| `AGENTS.md` is injected as project context (part of the live prompt) | `docs/configuration.md:18` |

## 3. Seam 1 — the hook

`src/pi/extension.ts` gains one registration beside the tool:

```ts
pi.on("before_agent_start", async (event) => {
  const composed = await composeForRun(event.systemPrompt);   // undefined when it must not compose
  return composed === undefined ? undefined : { systemPrompt: composed };
});
```

- **Read**: `event.systemPrompt` — the prompt as Pi rendered it for this run, including `AGENTS.md`, skills and
  cwd context. It is nested **verbatim** as the `environment` section. We do not call
  `getCurrentSystemPrompt`: that is the provider-side reader for transcript messages
  (`custom-provider.md:176`), not the hook's API.
- **Write**: return `{ systemPrompt }`. We deliberately do **not** set
  `event.systemPromptOptions.forceSystemPrompt`: the options object is mutable and shared (`extensions.md:208`),
  so a value written there can be observed by later handlers and re-rendered on the next run — the exact way to
  double-nest. The return value is documented as per-turn (`types.d.ts:1127`).
- **Idempotence**: the composed text begins with `<!-- praxis:system-prompt v1 ... -->`; if
  `event.systemPrompt` already starts with that marker the handler returns `undefined` and nests nothing.
- **Frequency**: once per run — session start, and again after every task closes (each new run re-enters the
  hook). Not per turn; the returned text stands for the run.
- **Cost**: two small file reads plus one tiny state file. Conduct and role are cached by path+mtime+digest for
  the process lifetime; a boundary therefore costs at most one `stat` per layer. No network, no store, no engine.
- **Host type**: `src/pi/host.ts` is the type-only mirror (`src/pi/host.ts:1-10`); it gains `on`,
  `BeforeAgentStartEvent` and the result shape, mirroring the installed declarations above. Nothing is imported
  at runtime.

## 4. Seam 2 — loading all three layers

`src/runner/engine/profile.ts` today hard-codes the domain layer: `DOMAIN_LAYER = "domain"` (:26), the path join
(:35) and the layer check (:55-57). Change:

```ts
/** Read one profile of any layer: <profileDir>/<layer>/<id>.json, parsed, id == file, layer == folder. */
export function loadProfileLayer(profileDir: string, layer: ProfileLayer, id: string): PinnedProfile;
/** The domain layer keeps its exact current behaviour. */
export function loadProfile(profileDir: string, ref: string): PinnedProfile;   // = loadProfileLayer(dir, "domain", ref)
```

`src/types/profile.ts` already carries `PROFILE_LAYERS = ["conduct","role","domain"]` (:15) and the locked
schema; nothing there changes.

Composition (one new pure module, `src/runner/engine/prompt.ts`):

```ts
composeSystemPrompt({ conduct, role, domains, environment }) → { text, sections, digests }
```

- `overview`: conduct, then role, then each domain, in that order.
- `body`: conduct's only (roles and domains normally have none).
- `invariants` / `prefer` / `avoid`: **field-wise union** across the three layers, declaration order,
  duplicates collapsed — the same rule the domain composer already implements
  (`src/runner/engine/profile.ts:96-115`), lifted to take all layers.
- `examples`: union across layers, if any declare them.
- The advisory line is appended **once**, at the end of the conduct block (it is a property of the whole
  composition, per the locked schema).

## 5. Seam 3 — where the role comes from

**`PRAXIS_ROLE`** (environment), falling back to `.pi/praxis/config.json` `defaults.role` — one additive optional
field on the existing `ProjectDefaultsSchema` (`src/types/project.ts:12`), read through the existing
`projectConfig()` (`src/runner/engine/support.ts:39-63`).

- The value is a role id: `architect`, `engineer`, `researcher`, `reviewer`, `debugger`, `lead`,
  `project-manager` — it must resolve to `profile/role/<id>.json` or it is a typed refusal.
- Why env: every agent gets its own process; the launcher (Manifold profile, a shell wrapper, a tab) already
  controls the environment, and the alternative — a launch flag through Pi — would need a host change this unit
  cannot make.
- **This is config-trust, stated plainly**: an agent can set `PRAXIS_ROLE=architect` and receive architect text.
  That is acceptable because the profile is *advisory text*, never a permission — the effective permissions are
  the intersection computed in code before any profile is read (`AGENTS.md` product constraints). Trusted
  identity is **gate #3 and stays OPEN**; nothing here authenticates the seat, and no verdict may cite this as
  identity.
- Missing role: **no composition at all** (fail closed to Pi's own prompt) plus one visible warning line. The
  system never emits conduct-without-role, and never an empty prompt.

## 6. Seam 4 — the domain at the boundary

The hook must learn the **current step's** node domains. The domain is declared on the **flow node** (the task
invocation), never in `task.json` (`src/types/schema.ts:567`), and it is already resolved and pinned by the
engine (`flow.ts:148-149`, `start.ts:94`).

Options weighed:

| Option | Verdict |
| --- | --- |
| A. The hook opens the Praxis SQLite store and reads the instance row + pinned flow | Rejected: puts engine reasoning in the host, duplicates the pinned-flow parse, and races the store's write lock on every run boundary |
| B. The hook reads a small **active-step snapshot** the engine writes | **Chosen** |
| C. The hook calls the `praxis` tool to ask | Rejected: the hook cannot call tools, and a run boundary must not start work |

**B in detail.** The tool handler already knows the flow, the current node and its resolved domains at start and
at every advance. It writes `.pi/praxis/state/active.json`:

```json
{ "v": 1, "instance": "i…", "flow": "flows/…", "step": "…", "task": "…",
  "status": "running", "domains": [{ "id": "code", "version": 1, "digest": "…", "overview": "…",
  "invariants": [], "prefer": [], "avoid": [] }], "at": "2026-11-01T…Z" }
```

The hook reads it, takes `domains` when `status === "running"`, and otherwise composes conduct+role+environment.

- The file is a **derived hint**, never an authority: the store owns the instance, the pinned definition rows own
  the bytes, and the file is rewritten on every call and marked `closed` on completion or failure.
- Any read/parse/shape failure, or `status !== "running"`: **no domain** (conduct+role only). Never a guess.
- It is written by the engine, not the extension, so the extension stays free of engine imports (`src/pi/*`
  never imports `src/runner/engine/*` today — the footer proves the pattern).
- **This is the gate #2 seam**: the Pi host now reads a Praxis-written file to learn task context. It is a
  coupling, not an isolation boundary, and it must be recorded as such (§9).

## 7. The composed text

```text
<!-- praxis:system-prompt v1 | conduct=occam@1 role=architect@1 domain=code@1 | sha256:<16> -->

# Conduct — occam v1
<overview>
<body>
## Invariants
- …
## Prefer
- …
## Avoid
- …

# Role — architect v1
<overview>
## Invariants
- …
## Prefer
- …
## Avoid
- …

# Domain — code v1
<overview>
## Invariants
- …

# Environment
<event.systemPrompt verbatim>

This composition guides behavior. It does not enforce gates, prove truth, install hooks, or grant any permission.
```

- The marker line is the idempotence check and the audit handle: it names the three layers with their versions and
  digests, so a probe can report what it received without reading any file.
- Sections appear **only when a layer declares that field**, so a conduct-only run has no empty headings.
- The advisory line appears **once**, at the very end, after the environment block — the whole prompt is the
  composed thing, not the conduct alone.
- Estimated size: conduct ≈ 2.5 KB (body 2.1 KB + entries) + role ≈ 2–3 KB + domain ≈ 1.5 KB + environment
  (Pi's own, unchanged). A boundary adds ~6 KB of conduct text per run; the design accepts it and measures it in
  the plan's checks rather than guessing.

## 8. Removal — what goes, and what proves nothing else depends on it

### 8.1 The live static conduct addendum

**Finding.** There is **no** configured `--append-system-prompt` in this repository or in `~/.pi` settings
(`docs/cli.md:224, 231` documents the flag; no project file uses it; `.pi/settings.json` holds packages only;
the Manifold launch profiles `.pi/manifold/profiles/{research,tester}.json` declare roles but no prompt text).
The live static conduct text is **`AGENTS.md` §Engineering conduct (lines 945-963) plus the guiding sentence
(line 989)**, which Pi injects as project context on every run (`docs/configuration.md:18`). It is hand-written,
is **not** generated from `profile/conduct/occam.json`, and has drifted from it: seven numbered project rules
versus the profile's nine invariants and five avoidances.

**Plan.** Once the composed prompt is live, replace that section with a three-line pointer:

```md
## Engineering conduct
Conduct is composed into the system prompt from `.pi/praxis/profile/conduct/occam.json`
(see `docs/composed-prompt-c0c929ff/design.md`). This file is not a second copy of it.
```

The product constraints, security boundaries and the guiding sentence stay — they are the project contract, not
conduct. **This edit is the owner's**: `AGENTS.md` is the contract file, and the unit must not trim it silently.

### 8.2 The tool-brief domain (superseded)

| Declaration | File:line | Action |
| --- | --- | --- |
| `resolveDomains(...)` call + `PROFILE_NOT_FOUND` throw in the descriptor | `src/pi/descriptor.ts:216-224` | **delete** |
| the `domain:` spread in `brief` | `src/pi/descriptor.ts:281-295` | **delete** |
| `StepDescriptorSchema.brief.domain` | `src/types/pi.ts:126-141` | **delete the field** |
| brief-domain tests | `tests/pi/brief-domain.test.ts` | **delete**, replaced by `tests/pi/prompt-compose.test.ts` |
| domain pin tests | `tests/runner/domain-pin.test.ts` | **keep** (pinning is unchanged); repoint any `brief.domain` assertion at the snapshot |
| flows documentation | `docs/FLOWS.md` (the sentence naming `brief.domain`) | **update** |

**Not removed** — they now feed the prompt instead of the brief: `Node.domains` / `FlowConfig.domains`
(`src/types/schema.ts:567`), `loadProfile` + `resolveDomains` + `composeDomains` (`src/runner/engine/profile.ts`),
`flow.profiles` (`src/runner/engine/flow.ts:148-149`), the `kind:"profile"` pin (`src/runner/engine/start.ts:94`).

**Proof of independence**: before deleting, `grep -rn "brief\.domain\|\.domain\b" src tests` must show only the
declaration, its descriptor builder, and the tests listed above; no engine, store or gate file reads it. The
deletion is then behaviour-neutral for every consumer except the two tests.

## 9. Gates — stated, not buried

- **Gate #2 (Pi host seam).** This unit makes the extension a system-prompt composer: it reads `event.systemPrompt`,
  reads Praxis-written state, and replaces the prompt via the host hook. The host is now inside the prompt trust
  path. No isolation, sandbox or "the agent cannot escape" claim follows; the seam is documented here and must be
  recorded in the vision's §13 gate table as *exercised, not closed*.
- **Gate #3 (trusted identity).** The role arrives from an environment variable or the project config. Anyone who
  can set the env can claim any seat. That is config-trust; it is not authentication, not authorization, and not
  evidence that the agent *is* the architect. Remains **OPEN**.

## 10. Acceptance oracles

1. **The prompt itself.** With `PRAXIS_ROLE=architect` and a node declaring `domains: ["code"]`, the hook writes a
   trace line (path, byte length, sha256, section order) and the live prompt contains the marker plus the four
   sections in order — provable from the trace and from the prompt, never from the files.
2. **Conduct and role fixed.** Two consecutive tasks in one session: the `# Conduct` and `# Role` blocks are
   byte-identical; only `# Domain` differs.
3. **Domain follows the task.** A node with no `domains` (and a flow with no default) produces a prompt with no
   `# Domain` block; the next step that declares one shows it, without a restart.
4. **No composition without a role.** `PRAXIS_ROLE` unset and no `defaults.role` → the returned value is
   `undefined`, the prompt equals Pi's own, and one warning is emitted.
5. **No double nesting.** Two runs in a row never contain two `# Environment` blocks (the marker guard).
6. **Removal.** No envelope contains `domain` in the brief; `tests/pi/brief-domain.test.ts` is gone;
   `tests/runner/domain-pin.test.ts` is green against the snapshot.
7. **Probe, no file reads.** A freshly launched agent asked "state your conduct, your role and your domain" answers
   from the prompt alone; the harness asserts its tool calls contain no read of `.pi/praxis/profile/**` and no
   `praxis` recall of those files. Any such read voids the probe.
8. **Gate record.** `docs/vision.md` §13 gains the #2 note ("exercise it, do not claim it closed").

## 11. Out of scope

Manifold issuing the role (gate #3), the jev selector (§8 of the profile design), per-step role changes within one
session, prompt caching or partial re-rendering, compaction behaviour, any store-schema change, any change to the
six-key result, and any claim of isolation.

## 12. Open questions for the lead

- **Q1.** §8.1 names `AGENTS.md` as the live static conduct text. If you meant a different file (a host-side
  `--append-system-prompt`, or a launcher wrapper outside this repo), name it and the removal slice changes only
  its path.
- **Q2.** The advisory line moves to the end of the whole prompt (§7). If you prefer it after the conduct block
  (before role), say so — it is a rendering choice, not a model change.
- **Q3.** Should `defaults.role` exist at all, or is `PRAXIS_ROLE` alone enough? One config field is one more
  place a role can be claimed.
