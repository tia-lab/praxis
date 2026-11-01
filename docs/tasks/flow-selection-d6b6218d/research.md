# Research — flow selection

Task: flow-selection · Hash: 73c73898 · Gate: G1 · Status: draft · Date: 2026-10-29

## 0. Contract

<!-- One physical line per key: this block is the hash input. Never reflow it. -->

task: Resolve a flows/<path> selector under .pi/praxis/flows/ so the shipped delivery flow can actually be run, and refuse a selector that disagrees with the document's flow key.
scope: src/runner/engine.ts, src/pi/tool.ts, src/cli.ts, tests/runner, docs/flow-selection-73c73898/
acceptance: praxis run flows/delivery starts the shipped delivery flow from a fresh store; a selector that disagrees with the document flow key is FLOW_INVALID before any write; the shipped flows and .pi/praxis/config.json stay byte-identical; tsc clean; suite green.

Recompute:

```sh
canonical() { printf 'task: %s\nscope: %s\nacceptance: %s\n' "$1" "$2" "$3" \
  | sed -E 's/[[:space:]]+$//'; }
canonical "<goal>" "<paths>" "<checks>" | sha256sum | cut -c1-8
```

**Hash check — executed 2026-10-29, HEAD `9e9de7e`, clean tree.** The three lines above
hash to `d6b6218d`, not `73c73898`. The ledger (`AGENTS.md:64-72`) and the folder name
carry `73c73898` from the dispatch text; that input is not in the repository. Every
framing tried — the whole task body, its first three and first five lines, no trailing
newline, backticked and unbackticked phrasings — reproduced `d6b6218d` or something
else, never `73c73898`. The same procedure does reproduce `7b1ebe17` from
`docs/task-data-flow-model-7b1ebe17/research.md:9-11`, so the method is sound and the
input is not. This is recorded as F12 and is **blocking for G0**, not for this document's
content: the lead supplies the exact canonical block, or accepts `d6b6218d` and a rename.
The folder is not renamed here — the ledger and the assignment both name it.

## 1. Question and boundary

**Question.** How does a caller name a flow document so that the shipped delivery flow can
be run, and what must hold for a selector that disagrees with the document's `flow` key to
be refused with `FLOW_INVALID` before any write?

**In scope.** (a) every site that decides the flow document path today and which default
wins; (b) what `delivery.json` would have to satisfy that `workflow.json` already does;
(c) the selector grammar: path under the flows directory versus absolute path versus bare
name, where `.json` is added or refused, and how a path/key disagreement is detected;
(d) the blast radius on the Pi tool, the CLI and the tests if the default path moves.

**Out of scope.** No spec, no plan, no code, no test or flow edit. No decision on how flows
are authored or edited. No claim about isolation, trusted identity or exactly-once
execution — none of the gates those would need is closed.

## 2. Sources inspected

| Source | Location | Establishes | Freshness |
| --- | --- | --- | --- |
| Flow loader | `src/runner/engine.ts:179-183` | the only default chain: `configPath` → `PRAXIS_CONFIG` → `process.cwd()/.pi/praxis/flows/workflow.json`, then `resolve()` | HEAD `9e9de7e` |
| Engine option | `src/runner/engine.ts:59-60` | `configPath` is documented as a path, not a selector | same |
| Start agreement check | `src/runner/engine.ts:276-283` | caller-supplied `flow` identity is compared to the document's `flow` key; mismatch throws `CONFIG_INVALID` | same |
| Pi options | `src/pi/tool.ts:106-121` | a second, independent default chain, resolved under `ctx.cwd`, comment says the selector is the environment, never a tool argument | same |
| Pi issue op | `src/pi/tool.ts:298` | `openFlow(engineOptions(ctx))` — the second caller of the loader | same |
| CLI flags | `src/cli.ts:44-52` | `--config` sets `configPath` verbatim | same |
| CLI run | `src/cli.ts:84-89` | the positional is the flow *identity*; it is forwarded as `start.flow` | same |
| Path grammar | `src/types/schema.ts:24,29-38` | one segment rule `([a-z][a-z0-9-]{0,63}/)*[a-z][a-z0-9-]{0,63}`; `FlowNameSchema = ^flows/<path>$` | same |
| Flow schema | `src/types/schema.ts:161-166` | `schema` is the literal `praxis.flow/v2`; `nodes`/`edges` are required and the object is strict | same |
| Parse refusal | `src/types/schema.ts:387-399` | a document that fails the schema is `CONFIG_INVALID`, not `FLOW_INVALID` | same |
| Shipped v2 flow | `.pi/praxis/flows/workflow.json:1-3` | `praxis.flow/v2`, `flow: flows/workflow`, five nodes, one `refuse` edge | same |
| Frozen delivery flow | `.pi/praxis/flows/delivery.json:1-2` | `praxis.config/v1`, `flow: delivery` (bare), `steps[]` | same |
| Frozen config | `.pi/praxis/config.json:2` | `praxis.config/v1`, `flow: research` (bare), `steps[]` | same |
| Test fixture comment | `tests/runner/delivery-gate.test.ts:8-16` | the suite already treats `delivery.json` as "no longer loadable" and rebuilds a delivery flow by rewriting `workflow.json`'s `flow` key | same |
| Path test | `tests/runner/paths.test.ts:128-146` | a bare flow name is `CONFIG_INVALID`; an absent file is `FLOW_INVALID` carrying the path | same |
| Tool default test | `tests/pi/config-path.test.ts:9-22` | asserts the default string and that `PRAXIS_CONFIG` is used as a path, absolute or cwd-relative | same |
| Ledger entry | `AGENTS.md:64-72` | owner GO, scope, acceptance, hash8, and what is not authorized | same |
| Workflow procedure | `docs/WORKFLOW.md:25-70` | hash rule, gate order, "no code before G3 PASS" | same |

## 3. Competing explanations

| Explanation | Supporting evidence | Distinguishing observation | Status |
| --- | --- | --- | --- |
| E1 The path is decided in one place; only a flows-directory selector is missing | `src/runner/engine.ts:179-183` holds the whole default chain | a second chain exists at `src/pi/tool.ts:106-121`, and it uses `ctx.cwd` where the engine uses `process.cwd()`; a third entry point (`src/cli.ts:44-52`) bypasses both | eliminated — there are three decision sites and two cwd sources |
| E2 The shipped delivery flow is already runnable and only resolution blocks it | it is called "the shipped delivery flow" in the acceptance | `PRAXIS_CONFIG=.pi/praxis/flows/delivery.json` returns five schema violations, not a resolution failure (F5) | eliminated |
| E3 The CLI positional already is the selector | `praxis run flows/delivery` reads like one | `src/cli.ts:84-89` forwards it as the identity; `engine.ts:276-283` compares it to the default document's key, so the positional can never change which file is read (F4) | leading |
| E4 The flow identity is the file path and needs no separate selector concept | `workflow.json` sits at `flows/workflow.json` with key `flows/workflow` | the agreement is convention, not a rule: `openFlow` never compares key to path (F10) | leading — but it is what makes a path-derived check cheap |
| E5 The dispatch hash is reproducible from the task body | `AGENTS.md:64-72` records `73c73898` | the three body lines hash to `d6b6218d`; the procedure is validated against an accepted document (F12) | eliminated as a hypothesis — the hash input is simply not in the repo |

## 4. Findings

**F1 [source-inspected]** The default flow path is decided by one three-step chain and a
`resolve()`: `options.configPath ?? process.env.PRAXIS_CONFIG ?? join(process.cwd(),
".pi/praxis/flows/workflow.json")` — `src/runner/engine.ts:179-183`. Precedence is
option > environment > cwd default. Limitation: `resolve()` is applied to the result
unconditionally, so a relative `PRAXIS_CONFIG` is cwd-relative, while a relative
`--config` is also cwd-relative.

**F2 [source-inspected]** The Pi tool resolves the same facts independently:
`PRAXIS_CONFIG` resolved under `ctx.cwd`, else `ctx.cwd/.pi/praxis/flows/workflow.json` —
`src/pi/tool.ts:106-121`. Two defaults, two cwd sources. Limitation: for the CLI the two
agree only because `process.cwd()` is the shell cwd.

**F3 [source-inspected]** The CLI positional is an identity, not a path: `const flow =
positionals[1]` is forwarded as `start.flow` (`src/cli.ts:84-89`) and compared to the
document's key (`src/runner/engine.ts:276-283`). Limitation: nothing in the CLI can
change which file is opened except `--config`.

**F4 [executed]** `node src/cli.ts run flows/delivery --request r2` on a fresh store (HEAD
`9e9de7e`) returns `{"error":{"code":"CONFIG_INVALID","message":"config declares flow
\"flows/workflow\"","detail":{"requested":"flows/delivery","declared":"flows/workflow",
"path":"…/.pi/praxis/flows/workflow.json"}}}`. So the acceptance's command fails today,
and fails with `CONFIG_INVALID` rather than the required `FLOW_INVALID`. Limitation: it
demonstrates the default document, not selector resolution.

**F5 [executed]** `PRAXIS_CONFIG=.pi/praxis/flows/delivery.json` with the same command
returns `CONFIG_INVALID "flow config is invalid"` with five issues: `schema` expected
`praxis.flow/v2`; `flow` expected `flows/<path>`; `nodes` expected array; `edges` expected
array; `Unrecognized key: "steps"`. Limitation: proves only that the frozen document does
not parse as the current schema.

**F6 [source-inspected]** `delivery.json` is `praxis.config/v1` with `steps[]` and
`flow: "delivery"` (`.pi/praxis/flows/delivery.json:1-2`), and there is no legacy branch:
`FlowConfigSchema` is strict on `praxis.flow/v2` (`src/types/schema.ts:161-166`) and
`parseFlowConfig` refuses everything else with `CONFIG_INVALID`
(`src/types/schema.ts:387-399`). Limitation: this is the same finding the earlier default-path
ruling produced; it is restated because the acceptance depends on it.

**F7 [source-inspected]** The delivery *pipeline* already exists in v2 form, but not in
`delivery.json`: `.pi/praxis/flows/workflow.json:4-13` wires nodes whose tasks are
`tasks/research|spec|plan|implement|review`, and those five units exist as published
documents under `.pi/praxis/tasks/` (plus `core/research.json` as the nested example). The
five `delivery.json` stage goals match the five task goals verbatim. Limitation: whether
the lead means "the delivery pipeline" or "the file `delivery.json`" decides the whole
acceptance — see §6 Q2.

**F8 [executed]** Both failing probes left no store directory: after the F4 and F5 runs,
`ls /tmp/praxis-write-probe*` reported `absent`. Sampling is consistent with the code —
`start` calls `openFlow` at `src/runner/engine.ts:276` and only then enters `withStore` at
`:293`. Limitation: "before any write" is shown for these two failure modes only.

**F9 [source-inspected]** One grammar already covers both roots: `PATH_SEGMENTS`,
`pathUnder("flows")` and `pathUnder("tasks")` (`src/types/schema.ts:24,29-38,124`). A
selector written `flows/<path>` is therefore the document key by construction, and a bare
`delivery` is `CONFIG_INVALID` (`tests/runner/paths.test.ts:130-133`). Limitation: the
grammar forbids `.json`, so where the suffix is added is an open decision (Q3).

**F10 [source-inspected]** Nothing compares a document's `flow` key to the file it was read
from: `openFlow` returns `{config, flowDigest, path, tasks}` (`src/runner/engine.ts:203`)
without a path/key check, and only `start` compares the key to the *caller's* identity
(`:276-283`). A file named `delivery.json` containing `flow: "flows/workflow"` loads today.
Limitation: a path/key rule is therefore new behaviour, not an existing one.

**F11 [executed]** Baseline at HEAD `9e9de7e`: `node_modules/.bin/tsc --noEmit` exits 0;
`node --test 'tests/**/*.test.ts'` reports `tests 139 · pass 139 · fail 0`. Limitation:
this is the pre-change baseline, nothing about the selector.

**F12 [executed]** The contract hash does not reproduce: `d6b6218d` from the three §0 lines,
`73c73898` in `AGENTS.md:64-72` and the folder name. Limitation: the lead's original input
text is unavailable, so this cannot be resolved from the repository.

**F13 [source-inspected]** The suite already records the delivery document as frozen:
`tests/runner/delivery-gate.test.ts:8-16` reads `workflow.json`, rewrites `flow` to
`flows/delivery` and copies the task library — the comment says the frozen `delivery.json`
"is no longer loadable after the default-path ruling". Limitation: it proves the team's
current reading, not the owner's intent.

**F14 [untested]** Whether a fresh-store run of a v2 delivery document would complete all
five nodes: no such document exists to run, and this stage may not create one.

## 5. Affected owners and callers

| Path | Declaration | Callers | Effect |
| --- | --- | --- | --- |
| `src/runner/engine.ts:179` | `openFlow` | `engine.ts:276` (start), `src/pi/tool.ts:298` (issue ops) | where a selector becomes a file path, the derived identity is checked, and `FLOW_INVALID` is raised |
| `src/runner/engine.ts:60` | `EngineOptions.configPath` | `src/cli.ts:50`, `src/pi/tool.ts:115` | a selector needs either a flows root or a resolver in place of a raw path |
| `src/runner/engine.ts:276-283` | start's key agreement check | CLI `run`, Pi `start` | the mismatch must move to `FLOW_INVALID` and compare the *path-derived* identity |
| `src/pi/tool.ts:106-121` | `engineOptions` | `tool.ts` start/submit/read/issue (incl. `:298`) | second default chain; must agree with the engine's precedence |
| `src/cli.ts:44-52` | `optionsOf` | `src/cli.ts:86` | `--config` stays a path; selector semantics land on the positional |
| `src/cli.ts:84-89` | `run <flow>` | operators | the only entry point the acceptance's command exercises |
| `tests/pi/config-path.test.ts:9-22` | default + env assertions | `node --test` | breaks if the default string or `PRAXIS_CONFIG` semantics change |
| `tests/runner/paths.test.ts:128-146` | flow identity grammar, absent-file refusal | `node --test` | the natural home for selector and disagreement cases |
| `tests/runner/delivery-gate.test.ts:13`, `tests/runner/subject.test.ts:315`, `tests/store/store.test.ts:325` | read `workflow.json` as a fixture source | `node --test` | unaffected while the file keeps its bytes; affected if it is renamed or moved |
| `.pi/praxis/flows/delivery.json` | frozen `praxis.config/v1` steps | none — unloadable | cannot satisfy the acceptance while byte-identical (Q2) |
| `.pi/praxis/config.json` | frozen `praxis.config/v1`, `flow: research` | none — unused by default | must stay byte-identical; cannot be a v2 default |

## 6. Uncertainty and open questions

- **Q1** Which canonical block produced `73c73898`? — resolved by: the lead supplying the
  text, or accepting `d6b6218d` and a rename (F12).
- **Q2** May `.pi/praxis/flows/delivery.json` be migrated to `praxis.flow/v2`, or does
  "the shipped flows stay byte-identical" include it? As it stands the acceptance is
  unsatisfiable: `praxis run flows/delivery` cannot start a `praxis.config/v1` document
  (F5, F6) and the file may not change. — resolved by: an owner/lead statement naming
  which reading holds. This is the one question G2 cannot start without.
- **Q3** Selector surface: only `flows/<path>`, or also a bare name, an absolute path, or a
  `…​.json` suffix? — resolved by: the spec, informed by `src/types/schema.ts:24-38` (one
  grammar, no dots, no leading slash, no suffix).
- **Q4** Does `PRAXIS_CONFIG` keep path semantics (as `tests/pi/config-path.test.ts:14-21`
  asserts) while a new selector surface is added, or does it become a selector? — resolved
  by: the spec; the smallest change keeps the env a path and gives the CLI positional the
  selector role.
- **Q5** May the Pi tool's `flow` argument (model-supplied, `src/pi/tool.ts:249`) name a
  file? Today it is an identity and the comment at `src/pi/tool.ts:110-112` says the
  selector is the environment "never a tool argument: an agent may not choose its own
  gates". — resolved by: confirming that rule still binds; if it does, selectors are
  CLI/env only.
- **Q6** Where does the flows root come from once a selector exists? No `flowsDir` option
  exists today; the only implicit root is `<cwd>/.pi/praxis/flows` inside two defaults
  (F1, F2). — resolved by: the spec naming one owner for the root.
- **Q7** Is `FLOW_INVALID` also the right code when the selector resolves to no file
  (today `FLOW_INVALID`, `tests/runner/paths.test.ts:139-146`) while a *malformed* document
  stays `CONFIG_INVALID` (`src/types/schema.ts:398`)? — resolved by: the spec stating both
  codes and their oracles.

## 7. Handoff

**What the spec must decide.** (1) the selector grammar and its single resolution rule,
including where `.json` is appended and that the path may not escape the flows root;
(2) the derived identity and the `FLOW_INVALID` refusal when it disagrees with the
document's `flow` key, with the no-write property stated as a check;
(3) which input carries the selector — CLI positional, `PRAXIS_CONFIG`, or both — under the
"agent may not choose its own gates" rule (Q5); (4) whether the default document path moves
at all, given that `workflow.json` is already the accepted v2 flow and `.pi/praxis/config.json`
is frozen v1; (5) the fate of `delivery.json` (Q2).

**What must change, from the evidence.** `openFlow` must accept a selector and derive an
identity (`src/runner/engine.ts:179-183`); the two default chains must collapse into one
(`:181`, `src/pi/tool.ts:115-118`); the mismatch refusal must move to `FLOW_INVALID` and
compare the derived identity (`:276-283`); the CLI positional must stop being a bare
identity (`src/cli.ts:84-89`) or a second flag must carry the selector.

**What breaks.** `tests/pi/config-path.test.ts:10` asserts the default string and `:17-21`
asserts `PRAXIS_CONFIG` is used as a path — both change if the default or the env's meaning
changes. `tests/runner/paths.test.ts:139-146` pins `FLOW_INVALID` for an absent file, which
the selector path must keep. `tests/runner/edges.test.ts:209`,
`tests/runner/paths.test.ts:122` and `tests/runner/subject.test.ts:306` pass `configPath`
directly, so they keep working only if a raw path remains an accepted input. Nothing else
in `src/` or `tests/` names `workflow.json` except as a fixture source
(`tests/runner/delivery-gate.test.ts:13`, `tests/runner/subject.test.ts:315`,
`tests/store/store.test.ts:325`, `tests/pi/fixtures.ts:91`), and those keep passing while
the file keeps its bytes.

**What stays unknown.** Q1 (hash provenance), Q2 (whether `delivery.json` may change) and
F14 (whether a v2 delivery run completes) — none can be settled from this repository, and
Q2 blocks G2.
