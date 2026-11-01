# Plan — G3: compose the whole system prompt from the profiles, and retire the two old paths

Task: composed-prompt · Hash: c0c929ff · Design: `design.md` (this folder) · Date: 2026-11-01
**Design + plan only.** Nothing here is implemented now; the lead hands this to an engineer under a separate GO.
Gates #2 (Pi host seam) and #3 (trusted identity) are crossed and stay OPEN (`design.md` §9).

## 1. Scope and invariants

- **I1** One prompt, one document: the agent reads conduct → role → domain? → environment, with Pi's own prompt
  nested last and never first.
- **I2** Conduct and role are fixed for a session; only the domain varies with the current step's node.
- **I3** No profile text is stored: the composed prompt is derived at the boundary; the pin (`kind:"profile"`)
  still owns the bytes a run was composed from.
- **I4** No second copy of a fact: the brief no longer carries the domain; the active-step file is a derived hint,
  the store remains the owner.
- **I5** Fail closed: a missing role or an unreadable state file yields **no composition**, never a partial one.
- **I6** ≤600 lines per file; no new dependency; no store-schema, flow-schema or result-key change.

## 2. Slice order

```
S1 loader(layers) → S2 composer(pure) → S3 active snapshot → S4 hook → S5 removals → S6 acceptance
    no behaviour      no behaviour         engine writes     host reads    brief.domain gone    live probe
```

S5 comes **after** S4 so the domain has a live home before the brief copy is deleted; no slice may land the removal
first.

## 3. S1 — load all three layers

Files: `src/runner/engine/profile.ts`, `tests/runner/profile-layers.test.ts` (new).

1. `loadProfileLayer(profileDir, layer, id): PinnedProfile` — the current body of `loadProfile` (`:34-60`) with
   `DOMAIN_LAYER` replaced by the `layer` argument; the layer check compares against the requested layer.
2. `loadProfile(profileDir, ref)` stays as `loadProfileLayer(dir, "domain", ref)` — every existing caller is
   unchanged (`flow.ts:27`, `profile.ts:149`).
3. A `profileDirOf(options)` helper (beside `rulesDirOf`/`tasksDirOf` in `support.ts`) so the engine and the host
   resolve the directory the same way: option → `PRAXIS_PROFILE_DIR` → `<cwd>/.pi/praxis/profile`.

**Check:** a conduct file, a role file and a domain file each load with the right layer; a file whose `layer` or
`id` disagrees is `PROFILE_INVALID`; a missing file is `PROFILE_NOT_FOUND`; the old `loadProfile` path is
byte-identical. `tsc` clean, suite green.

**Exit:** nothing composes yet; the loader can read all three layers.

## 4. S2 — the composer (pure)

Files: `src/runner/engine/prompt.ts` (new), `tests/runner/prompt-compose.test.ts` (new).

```ts
composeSystemPrompt(input: { conduct: PinnedProfile; role: PinnedProfile; domains: readonly PinnedProfile[];
                            environment: string }) → { text: string; marker: string; digests: {...} }
```

1. Field-wise union of `invariants`/`prefer`/`avoid`/`examples` across the layers in order, duplicates collapsed
   (the same rule as `composeDomains`, `profile.ts:96-115`, lifted to take all layers). `overview` is ordered, one
   per layer; `body` comes from conduct only.
2. Render per `design.md` §7: marker line, `# Conduct`/`# Role`/`# Domain` blocks (a section only when the layer
   declares it), `# Environment` last, the advisory line once at the very end.
3. No I/O, no clock, no store: the function takes values and returns text.

**Check:** a golden test pins the exact bytes for conduct+role+domain and for conduct+role; a duplicate entry
appears once; an empty domain list omits the block; the advisory line appears exactly once at the end; the marker
names every layer with its version and digest.

**Exit:** composition is provable without a host.

## 5. S3 — the active-step snapshot (engine writes, host reads)

Files: `src/runner/engine/active.ts` (new), `src/runner/engine/start.ts`, `src/runner/engine/advance.ts`,
`tests/runner/active-snapshot.test.ts` (new).

1. `writeActiveStep(storeDir, { instance, flow, step, task, status, domains, at })` writes
   `<storeDir>/active.json` atomically (temp + rename), the shape in `design.md` §6.
2. Called at `start` (the first node) and at every `advance` (the new current step); called with
   `status: "closed"` and an empty domain list when the instance completes or fails.
3. The domains come from the pinned flow's node (`resolveDomains`, `flow.ts`), so the snapshot carries the
   composed entries the prompt needs — no second resolution in the host.
4. Write failures are swallowed to a warning: a snapshot that cannot be written must never fail a step.

**Check:** after `start` the file names the first step and its domains; after `advance` it names the next; after
completion it is `closed`; a corrupt or absent file is tolerated by the reader; the store's own rows are unchanged
(the file is additive).

**Exit:** the host has a fact to read, and the store is still the owner.

## 6. S4 — the hook

Files: `src/pi/prompt-hook.ts` (new), `src/pi/host.ts`, `src/pi/extension.ts`, `tests/pi/prompt-hook.test.ts` (new).

1. `host.ts` gains the type-only mirror: `on(event, handler)`, `BeforeAgentStartEvent` (`systemPrompt`,
   `systemPromptOptions`, `messageType`) and the result `{ systemPrompt?: string }` — mirroring
   `types.d.ts:717-741, 1125-1129, 1207`.
2. `createPromptHook({ cwd, env, readFile })` returns the handler: resolve role (`PRAXIS_ROLE` → `defaults.role`),
   load conduct+role (cached by path+mtime), read `active.json`, call the composer, return `{ systemPrompt }`.
   It imports no engine module: it reads files and calls the pure composer through a function it is given.
   *(The composer lives in `src/runner/engine/prompt.ts`; the extension may import that one pure module — the
   dependency direction stays host → pure, never host → store/engine.)*
3. Idempotence: if `event.systemPrompt` starts with the marker, return `undefined`.
4. `extension.ts` registers it beside the tool.
5. A trace line (only when `PRAXIS_PROMPT_TRACE` is set): path, bytes, sha256, section order, to stderr.

**Check:** with a fake event, the returned prompt has the four sections in order and the environment block is the
input prompt verbatim; a second call on the returned prompt nests nothing; role unset → `undefined` + one warning;
a `status:"closed"` snapshot → no domain; a malformed snapshot → no domain, no throw; `tsc` clean.

**Exit:** the composed prompt is produced by the host path and is testable without Pi.

## 7. S5 — removals

Files: `src/pi/descriptor.ts`, `src/types/pi.ts`, `tests/pi/brief-domain.test.ts` (delete),
`tests/runner/domain-pin.test.ts`, `docs/FLOWS.md`.

1. Delete the `resolveDomains` call and its throw from `stepDescriptor` (`descriptor.ts:216-224`).
2. Delete the `domain:` spread from `brief` (`descriptor.ts:281-295`) and the field from
   `StepDescriptorSchema.brief` (`pi.ts:126-141`).
3. Delete `tests/pi/brief-domain.test.ts`; repoint `tests/runner/domain-pin.test.ts` at the snapshot rather than
   the brief; update the `docs/FLOWS.md` sentence.
4. **Proof of independence gate**: `grep -rn "brief\.domain\|\.domain\b" src tests` returns only the removed
   sites and the tests being changed before the deletion lands; after it, no engine, store or gate file mentions the
   brief's domain.
5. `AGENTS.md` §Engineering conduct → the three-line pointer. **Owner edit**, not part of the engineer's GO: the
   plan lists it, the owner applies it.

**Check:** the descriptor's key set no longer contains `domain`; every envelope test that pinned the brief key set
is updated in the same commit; `domain-pin` is green against the snapshot; the suite is green.

**Exit:** the old paths are gone and nothing else depended on them.

## 8. S6 — acceptance

1. Live run 1: `PRAXIS_ROLE=architect`, a node with `domains: ["code"]` → the trace line and the live prompt show
   the marker and the four sections in order.
2. Live run 2: a node with no domain → no `# Domain`; conduct and role blocks byte-identical to run 1.
3. Live run 3: `PRAXIS_ROLE` unset → the prompt equals Pi's own, one warning, no partial composition.
4. Probe agent: "state your conduct, your role and your domain" answered from the prompt; the harness asserts its
   tool calls read no file under `.pi/praxis/profile/**` and do not `praxis`-recall them.
5. `docs/vision.md` §13: gate #2 recorded as *exercised, not closed*; gate #3 unchanged (open).
6. Full suite + `tsc`; `wc -l` on every touched file < 600.

## 9. Affected declarations

| Declaration | File:line today | Change |
| --- | --- | --- |
| `loadProfile`, `DOMAIN_LAYER` | `src/runner/engine/profile.ts:26, 34-60` | + `loadProfileLayer`; `loadProfile` delegates |
| `profileDirOf` | `src/runner/engine/support.ts:33-45` | new, beside `rulesDirOf`/`tasksDirOf` |
| `composeSystemPrompt` | — | new, `src/runner/engine/prompt.ts` |
| `writeActiveStep` | — | new, `src/runner/engine/active.ts`; called from `start.ts` / `advance.ts` |
| `PiHost` | `src/pi/host.ts:1-10` | + `on`, the event and result types (type-only) |
| `praxisExtension` | `src/pi/extension.ts:16-18` | register the prompt hook beside the tool |
| `createPromptHook` | — | new, `src/pi/prompt-hook.ts` |
| `stepDescriptor` brief | `src/pi/descriptor.ts:216-224, 281-295` | remove the domain block |
| `StepDescriptorSchema.brief.domain` | `src/types/pi.ts:126-141` | remove the field |
| `ProjectDefaultsSchema` | `src/types/project.ts:12` | + optional `role` (§12 Q3) |
| `AGENTS.md` §Engineering conduct | `AGENTS.md:945-963` | pointer only (**owner**) |

Frozen (a diff is a blocking finding): `src/quality/**`, the gate, the store schema and every SQL statement, the
six-key `ResultSchema`, `.pi/praxis/tasks/**`, `.pi/praxis/flows/**`, `package.json`.

## 10. Checks

| Slice | Command | Expected |
| --- | --- | --- |
| S1 | `node --test tests/runner/profile-layers.test.ts` + `tsc` | three layers load; wrong layer/id refuse; old path unchanged |
| S2 | `node --test tests/runner/prompt-compose.test.ts` | golden bytes; one advisory line; union dedupes |
| S3 | `node --test tests/runner/active-snapshot.test.ts` | written at start/advance; closed at the end; corrupt tolerated |
| S4 | `node --test tests/pi/prompt-hook.test.ts` | four sections in order; env verbatim; no double nesting; no role → undefined |
| S5 | `grep` gate + `node --test tests/pi tests/runner` | no `brief.domain` anywhere; suite green |
| S6 | full `node --test` + `tsc` + the three live runs + the probe | acceptance oracles 1–8 of `design.md` §10 |

## 11. Recovery

Every slice is independently revertible except S5, which is a deletion: revert it by restoring the two descriptor
sites and the schema field (one commit). The snapshot file is additive and safe to delete; a stale one yields no
domain, never a wrong one. No migration is written, so no data recovery is needed.

## 12. Risks

| Id | Risk | Consequence | Mitigation |
| --- | --- | --- | --- |
| R1 | The hook nests Pi's prompt inside a prompt that already contains it | double environment, prompt bloat | marker guard + a test with two consecutive runs |
| R2 | A stale `active.json` injects the wrong domain | the agent receives another task's lens | `status:"running"` only, cleared on close, shape-validated, fail closed |
| R3 | The prompt grows by ~6 KB per run | slower first token, more context | conduct+role cached per process; size measured in S6, not estimated |
| R4 | The hook fires for custom messages too | a run started by `pi.sendMessage` also gets the prompt | compose for both: the prompt is a property of the session, not the message |
| R5 | `AGENTS.md` trim is not applied | conduct text stays duplicated and drifted | S5 item 5 is the owner's; the design names the exact lines |
| R6 | `PRAXIS_ROLE` is spoofable | any agent can claim any seat's text | accepted: advisory text only, never a permission; gate #3 stays open (§9) |
| R7 | The host now reads a Praxis-written file | gate #2 coupling, undocumented | recorded in `design.md` §6/§9 and in the vision gate note (S6.5) |

## 13. LOC budget

| File | Delta |
| --- | --- |
| `src/runner/engine/profile.ts` | +18 / −6 |
| `src/runner/engine/prompt.ts` (new) | +120 |
| `src/runner/engine/active.ts` (new) | +70 |
| `src/runner/engine/support.ts` | +10 |
| `src/runner/engine/start.ts` / `advance.ts` | +6 each |
| `src/pi/prompt-hook.ts` (new) | +110 |
| `src/pi/host.ts` | +25 |
| `src/pi/extension.ts` | +2 |
| `src/pi/descriptor.ts` | −18 |
| `src/types/pi.ts` | −16 |
| `src/types/project.ts` | +2 |
| tests | +320 / −140 |

≈ +380 source lines net; every file stays well under 600.

## 14. Out of scope

Manifold issuing the role (gate #3), the jev selector, per-step role switching, prompt caching, compaction changes,
any store-schema change, any result-key change, any isolation claim.
