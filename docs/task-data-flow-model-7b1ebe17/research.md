# Research — task-as-data flow model

Task: task-data-flow-model · Hash: 7b1ebe17 · Gate: G1 · Status: draft · Date: 2026-10-29

## 0. Contract

<!-- One physical line per key: this block is the hash input. Never reflow it. -->

task: task-as-data flow model: tasks as JSON units, flows compose them, logic as edges
scope: docs/<slug>-<hash8>/, later src/types/schema.ts, src/runner/engine.ts
acceptance: state machine table, four properties each with a test, review bound to subject digest, flows reuse tasks across feature/bugfix/refactor

The three lines above hash to `7b1ebe17` (sha256, first 8 hex, trailing whitespace stripped).
The folder name carried `96c9af7d` because the lead's own hash input said `<hash>` in the scope
line instead of `<hash8>`. That was a drafting error in the lead's contract, not a change to
this one. Resolved 2026-10-29: the folder is `docs/task-data-flow-model-7b1ebe17/` and the
three lines above are authoritative. See Q1.

Recompute:

```sh
canonical() { printf 'task: %s\nscope: %s\nacceptance: %s\n' "$1" "$2" "$3" \
  | sed -E 's/[[:space:]]+$//'; }
canonical "<goal>" "<paths>" "<checks>" | sha256sum | cut -c1-8
```

## 1. Question and boundary

Q: what does the current engine already carry toward a **task-as-data** model — tasks
as JSON units, flows that compose them, control flow as edges, review bound to a
subject digest — and what can it not express at all?

In boundary: the flow/step schema, the step engine, the store tables, the two
committed flow files, the Pi tool's config resolution, and `docs/WORKFLOW.md` §3.
Out of boundary: whether the model *should* change (spec work), TanStack/JSON-graph
libraries, Occam or Manifold interfaces, and any recommendation about store choice.
This document reads code; it proposes no edit to `src/`.

## 2. Sources inspected

| Source | Location | Establishes | Freshness |
| --- | --- | --- | --- |
| Step schema | `src/types/schema.ts:79` | `consumes: StepIdSchema.optional(),` — a step names **one** predecessor; there is no array and no edge object | read 2026-10-29 |
| Refusal edge | `src/types/schema.ts:85-90` | `Where a refusal sends the work. Declared as an earlier stage id … onRefuse: StepIdSchema.optional(),` — the only non-linear edge kind | read 2026-10-29 |
| Flow unit | `src/types/schema.ts:99-103` | `steps: z.array(StepConfigSchema).min(1).max(16),` — the flow is one flat, bounded list; no sub-flow field | read 2026-10-29 |
| Gate vocabulary | `src/types/schema.ts:26` | `z.enum(["schema-valid-and-nonce", "section-requirements"])` — two deterministic gates, no model check | read 2026-10-29 |
| Artifact derivation | `src/types/schema.ts:180` | `derivedFrom: DigestSchema.nullable(),` — one predecessor digest per recorded artifact | read 2026-10-29 |
| Flow validation | `src/runner/engine.ts:161-174` | `consumes a step that does not precede it` — a forward or self edge is a `CONFIG_INVALID` refusal | read 2026-10-29 |
| Advance | `src/runner/engine.ts:406-407` | `const next = flow.config.steps[index + 1];` / `const finished = next === undefined;` — the successor is positional | read 2026-10-29 |
| Refusal dispatch | `src/runner/engine.ts:369-375` | `if (step.onRefuse !== undefined) { setStatus(… { status: "running", currentStep: step.onRefuse } …` — the back-edge is taken only on a gate reject | read 2026-10-29 |
| Gate checks | `src/runner/engine.ts:589-596` | `schemaMatches`, `noncePresent`, `derivedFromMatches` — content is compared by name and digest, never by schema | read 2026-10-29 |
| Task identity helper | `src/runner/task.ts:25-31` | `hash8(...)` and `taskFolder(...)` compute the folder name; the file has **one** importer, `tests/runner/task.test.ts:3` | read 2026-10-29 |
| Store schema | `src/store/db.ts:19-61` | four tables — `meta`, `instance`, `event`, `artifact` — and an append-only `event` trigger; no task, flow or edge table | read 2026-10-29 |
| Flow selection | `src/pi/tool.ts:110-118` | `The selector is the environment, never a tool argument … : resolve(ctx.cwd, ".pi/praxis/config.json")` — one config path per run | read 2026-10-29 |
| Delivery flow | `.pi/praxis/flows/delivery.json:258` | `"onRefuse": "plan"` — the repository's only non-linear edge, review → plan | read 2026-10-29 |
| Review subject | `docs/WORKFLOW.md:89` | `subject: docs/<slug>-<hash8>/spec.md sha256:<64 hex>` — a review names the reviewed file's digest, in prose | read 2026-10-29 |

## 3. Competing explanations

| Explanation | Supporting evidence | Distinguishing observation | Status |
| --- | --- | --- | --- |
| E1 — the engine already models flows as graphs; only rendering looks linear | `consumes` and `onRefuse` read like edges; guard tests pass | A second edge of the same kind cannot be written: two `onRefuse` targets, or a step consuming two artifacts, is rejected by `z.strictObject` (`schema.ts:75-91`) and by `validateFlow` (`engine.ts:161-174`). One predecessor, one back-edge, positional order. | eliminated |
| E2 — review is already bound to the reviewed subject's digest | artifacts carry `derivedFrom`; the gate checks `derivedFromMatches` (`engine.ts:595`) | `derivedFrom` is the digest of the *immediately consumed stage artifact*, not of the reviewed file. `docs/WORKFLOW.md:89`'s `subject:` line is parsed nowhere in `src/` (grep `subject` in `src/` matches only the local gate parse, `src/runner/engine.ts:588-595`). A review artifact can cite any `sha256:` and pass. | eliminated as stated; true only as stage-to-stage chaining |
| E3 — the unit of composition is the flow file, and reuse is copying it | `tool.ts:115-118` selects one config path; `delivery.json` restates the `docs/WORKFLOW.md` gate clauses as five steps | No flow references another flow, and `.pi/praxis/flows/` holds two independent files serving different feature shapes. Reuse across feature/bugfix/refactor has no expression other than a new or copied file. | leading |
| E4 — task identity is carried by the run through the instance id | `instanceIdFor(flow, requestId)` makes ids deterministic (`engine.ts:180`) | `InstanceSchema` (`schema.ts:151-162`) has `flow`, `actor`, `configDigest` and no task field; `src/runner/task.ts` is imported by tests only. Nothing in a run knows which task it serves. | eliminated |

## 4. Findings

- F1 [source-inspected] The flow is data; the **task is not** a unit at all. `FlowConfigSchema` is the only JSON work unit (`schema.ts:99-103`), and the store has no task table (`db.ts:19-61`). — evidence: both citations — limitation: does not prove a task unit is needed, only that none exists.
- F2 [source-inspected] Order is positional, not an edge set. The successor is `steps[index + 1]` (`engine.ts:406`); `consumes` only names a single earlier step (`schema.ts:79`, `engine.ts:161-174`). — limitation: a strictly increasing step list is a graph, but only a path.
- F3 [source-inspected] Exactly one non-linear edge exists, and only as a refusal back-edge: `onRefuse` must name an earlier stage (`schema.ts:121`) and is consulted only when the gate rejects (`engine.ts:369-375`). — limitation: read, not exhausted against future gate kinds.
- F4 [source-inspected] The gate is deterministic and content-blind about the subject: it checks object-ness, schema **name** equality, nonce, predecessor digest (`engine.ts:589-596`) and section presence (`engine.ts:597-601`); the payload is never parsed by a schema registered under `SchemaName`. — limitation: `GateSubject` is `z.looseObject`, so extra keys pass, which is why a subject digest could be carried but would not be checked.
- F5 [source-inspected] Review-to-subject binding is prose, not runtime. `docs/WORKFLOW.md:89` requires `subject: <path> sha256:<64 hex>` and `WORKFLOW.md:96` voids a verdict without it, but no `src/` module reads that line. — limitation: grep-level evidence; a tool could still write it.
- F6 [source-inspected] Flows do not compose: one flat list of 1..16 steps (`schema.ts:103`), no flow reference, and artifact "types" are names compared as strings (`engine.ts:591`). — limitation: composition could exist outside the config; none was found in `src/pi/`.
- F7 [executed] `node --test 'tests/runner/*.test.ts'` → 31 tests, 31 pass, including `a refused review sends the work back to the stage it names` and `a stage without onRefuse keeps itself current`. The back-edge and the path-less refusal are behaviour. — limitation: proves only the exercised flows.
- F8 [source-inspected] Task identity exists only as a helper: `hash8`/`taskFolder` (`task.ts:25-31`) are imported solely by `tests/runner/task.test.ts:3`; no engine, store or Pi surface uses them. — limitation: `grep -rn 'runner/task' src tests` covers this repo only.
- F9 [source-inspected] One flow per run: the config path is `.pi/praxis/config.json` unless `PRAXIS_CONFIG` overrides it (`tool.ts:110-118`), so "two flows" means two whole files, not two units in one. — limitation: the env override is a selector, not a composition.
- F10 [source-inspected] A refusal is retryable but not typed as a rework: the instance stays `running` at the named step (`engine.ts:373-374`) and the caller gets `ARTIFACT_INVALID` with `reworkTo`; there is no distinct state for "returned for amendment". — limitation: `InstanceStatusSchema` (`schema.ts:143`) offers `running`, `blocked`, `completed`, `failed`; `blocked` was not observed in use.

## 5. Affected owners and callers

| Path | Declaration | Callers | Effect |
| --- | --- | --- | --- |
| `src/types/schema.ts` | `StepConfigSchema`, `FlowConfigSchema` (`:75`, `:99`) | `engine.ts` `openFlow`/`parseFlowConfig`; `tests/runner/*` | Any task-unit or edge vocabulary changes the config format here first; strict objects make it a breaking change |
| `src/runner/engine.ts` | `advance` (`:311`), `openFlow` (`:131`), `validateFlow` (`:153`), `gate` (`:583`) | `advance` → `src/pi/tool.ts:249`, `src/cli.ts:102,129`, `tests/runner/*`; `openFlow` → `src/pi/tool.ts:290`, `engine.ts:218,312`; `validateFlow` → `openFlow` (`engine.ts:148`); `gate` → `advance` (`engine.ts:351`) | Holds the linear successor and the single predecessor handoff; a graph would be rewritten here |
| `src/runner/task.ts` | `canonicalBlock`, `hash8`, `taskFolder` (`:15`, `:25`, `:30`) | `tests/runner/task.test.ts:3` only | Unused identity helper: the natural seam for a task unit, or to be replaced |
| `src/store/db.ts` | `SCHEMA_STATEMENTS` (`:19-61`), private const | `openStore` (`db.ts:108`), called from `engine.ts:122`; the const is used once, at `db.ts:135`; `store/instance.ts`, `store/artifacts.ts` and `store/events.ts` import `Store`, `storeCall` and `transact`, never this const. | Four tables, no task/edge; a task-as-data store decision starts here |
| `src/pi/tool.ts` | `engineOptions` (`:104-120`) | `engineOptions` call sites `:232`, `:248`, `:261`, `:290`; `advance` call site `:249` | Fixes one flow per run; flow selection or composition must pass through it |
| `.pi/praxis/flows/delivery.json` | five `steps`, `onRefuse: "plan"` (`:258`) | `tool.ts` via `PRAXIS_CONFIG` | Re-states `docs/WORKFLOW.md` gates by duplication; a reused task unit would replace the copy |
| `docs/WORKFLOW.md:89` | review `subject:` line | human authors; `review.md` files | The only place a review is bound to a subject digest; unenforced by code |

## 6. Uncertainty and open questions

- Q1 [RESOLVED 2026-10-29 by the lead] The folder carries the reproducible hash `7b1ebe17`. The assignment value `96c9af7d` came from a hash input whose scope line read `<hash>` rather than `<hash8>`; the three §0 lines were never in dispute and are the hash input.
- Q2 "Review bound to subject digest" has two readings: the predecessor artifact digest (already enforced, `engine.ts:595`) or a digest of reviewed files on disk or of the reviewed document (not read anywhere). — resolved by: a G2 decision naming which digest a review must carry.
- Q3 Whether a task is a stored entity, a JSON unit inside a flow file, or a config-level document referenced by id; each forces a different store and schema change. — resolved by: G2 model.
- Q4 No test exercises a join, a branch or more than one back-edge, because the config cannot express one; the four property tests the acceptance names have no current subject beyond F2/F3/F7. — resolved by: the spec's state machine table fixing the states first.
- Q5 `blocked` is a declared instance status (`schema.ts:143`) with no observed writer in `src/runner/`; whether it is reachable at all is unverified. — resolved by: `grep -rn '"blocked"' src` at spec time.

## 7. Handoff

Decisions this research forces on the spec:

1. **Unit boundary.** Is a task a JSON unit the engine loads (and where stored), or is it only the canonical contract block `src/runner/task.ts` already computes? F1/F8 say neither exists today.
2. **Edge vocabulary.** Keep `consumes` + `onRefuse` as the whole vocabulary, or introduce typed edges (branch, join, fan-out)? F2/F3/F6 say the current two kinds cannot express composition or reuse.
3. **Review subject.** Bind a review to the consumed artifact digest only (F5's runtime behaviour), or extend the gate to compare a declared subject digest. The second needs a new checked field, not a loose key (F4).
4. **Reuse mechanism.** Flow composition (a flow referencing tasks), or a task library copied into flows (E3, leading). The two differ in what the store owns.
5. **State machine source.** The table must enumerate the states the code actually has: instance `running|blocked|completed|failed` (`schema.ts:143`) and artifact `pending|accepted` (`schema.ts:169`), plus the refuse/rework transition F10 describes but does not name.

Stays unknown: whether the four acceptance properties (state machine, per-property test, subject-bound review, cross-shape reuse) are one unit or four; and whether `blocked` is reachable.

amended 2026-10-29 — folder renamed 96c9af7d -> 7b1ebe17, §0 and Q1 record the resolution — the folder must follow the contract text, not a mis-typed scope line
amended 2026-10-29 — line 3 now reads Hash: 7b1ebe17; the superseded value survives only as provenance in §0 and Q1 — G1-R1: header disagreed with the folder and with §0
amended 2026-10-29 — §7 no longer lists Q1 as unknown and drops "No spec decision below can be settled until Q1 is answered" — G1-R2: Q1 is resolved
amended 2026-10-29 — F4 cites the section check at engine.ts:597-601 in addition to 589-596 — G1-R4: the old range stopped before section presence
amended 2026-10-29 — SCHEMA_STATEMENTS is cited as db.ts:19-61 in §2 and F1 — G1-R5: the declaration runs from line 19 to line 61
amended 2026-10-29 — the db.ts row names openStore/db.ts:135 as the only user of the private const — G1-B1: store modules call openStore, not SCHEMA_STATEMENTS
amended 2026-10-29 — the engine.ts row separates advance's callers (tool.ts:249, cli.ts:102,129) from openFlow/validateFlow/gate's internal callers — G1-B2: validateFlow and gate have no tool.ts or cli.ts caller
amended 2026-10-29 — the db.ts row now states that openStore (db.ts:108) is called only from engine.ts:122 and that the store modules import Store, storeCall and transact, not this const — G1-F5: the row claimed the store modules call openStore, which `grep -rn openStore src` contradicts
