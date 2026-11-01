# Research — a reusable rules atom: one file-owned set, referenced by tasks, expanded at resolve

Task: task-rules · Hash: 86c98dcd · Gate: G1 · Status: draft · Date: 2026-10-31
Labels: **SI** source-inspected (`path:line`) · **DOC** repo document · **DC** design consequence (reasoned, not run).
No store was measured for this unit: it is a design unit over the code that exists. Every claim about
behaviour below is SI, and every claim about what a change would do is DC and is marked as such.

## 0. Contract

<!-- One physical line per key: this block is the hash input. Never reflow it. -->

task: design a reusable rules atom: rule-set files under .pi/praxis/rules, task references, resolve-time in-memory expansion into the brief and optional jev criteria, pinned per instance (docs only, no code)
scope: docs/task-rules-<hash8>/; later src/types/{paths,rules,schema,quality,pi,errors}.ts, src/runner/engine/{rules,flow,start,types,advance}.ts, src/runner/note-gate.ts, src/pi/{descriptor,operations,feedback}.ts, src/quality/evaluate.ts, src/store/definitions.ts, tests/
acceptance: a rule-set schema with path identity and a version; RuleRef by file and by ids with a typed fail-closed refusal; expansion is a derived in-memory projection, never a stored copy; the brief carries the rules; a cited rule reaches jev through the criterion text with no scorer change; each referenced set is pinned per instance so a later edit cannot change a finished run; no new store, dependency or gate; tsc clean and the suite green

Recompute: `printf 'task: %s\nscope: %s\nacceptance: %s\n' '<t>' '<s>' '<a>' | sed -E 's/[[:space:]]+$//' | sha256sum | cut -c1-8` → `86c98dcd`.

## 1. Question and boundary

The owner froze the WHAT (one mechanism, file-owned sets, path+version pinned, task refs, one expansion
with two consumers, opt-in jev checks, no enforcement, additive). Four things are still open and are the
whole of this research:

1. Can a rule-set be an atom with the same identity and pin treatment as a task **without** a new store
   concept, table, migration or dependency? (§3.2, §4, F1, F2)
2. Where must expansion happen so the **brief** the agent reads and the **rubric** jev judges can never
   disagree? (§3.3, §3.5, F4)
3. Does a probe that cites a rule require a scorer change, or does the existing probe path already carry
   the text? (§3.4, F5)
4. What does a rule **text** change do to bars, verdicts and finished runs? (§3.4, §3.5, F6)

Out of boundary: enforcement (nothing here enforces anything), folder globbing, cross-project rules,
and any change to the gate.

## 2. Sources inspected

| Source | What it establishes |
| --- | --- |
| `src/types/schema.ts:255-295` | `TaskConfigSchema` is a strict object: `id`, `version`, `state`, `goal`, `capabilities`, `produces`, `gate`, `requires?`, `role?`, `quality?`, `bindsSubject?` |
| `src/types/schema.ts:24-36, 302, 325` | the ONE reference grammar (`PATH_SEGMENTS`, `pathUnder`), `TaskRefSchema = pathUnder("tasks")`, `parseTaskRef` |
| `src/types/schema.ts:461-467` | `ResolvedNode` = node + task + sources + refuse: composition, never a copy |
| `src/types/quality.ts:29-80, 92-111, 113-150` | `ProbeSchema` (`instructions` is the question, ≤500), dimensions, the rubric superRefine |
| `src/runner/engine/flow.ts:31-66` | `loadTask`: path → file, `id` must equal the last path segment (58), parse or refuse |
| `src/runner/engine/flow.ts:69-95` | `openFlow`: load the flow, load every named task, validate, digest — the library path |
| `src/runner/engine/flow.ts:167-198` | `loadPinnedFlow`: read the pinned flow and every pinned task, verify each digest on every read |
| `src/runner/engine/start.ts:66-96` | the pin transaction: flow + every task + every publication commit with the instance row |
| `src/store/definitions.ts:28, 81-96, 102-126` | `definition` is `(instance, kind, id)` + bytes + digest; `kind` is a CLOSED enum `flow\|task\|assignment`; read re-verifies the digest |
| `src/runner/engine/types.ts:156-162` | `OpenedFlow` = config + flowDigest + path + tasks |
| `src/pi/descriptor.ts:200-268` | `stepDescriptor` builds `brief` from already-loaded, already-pinned state; it reads nothing and stores nothing |
| `src/types/pi.ts:114-200` | `brief` is a strict object; `quality.dimensions[].criteria[]` already carries each probe's `instructions` |
| `src/quality/jev-scorer.ts:109-115, 117-126` | the question is `probe.instructions` (optionally prefixed by a section target); `questionOf` reads nothing else |
| `src/quality/scope.ts:78-92` | `dimensionKey` hashes `[id, type, instructions, criteria, clean]` — the instruction text IS identity |
| `src/quality/evaluate.ts:106-111, 321-333` | `rulerDigest` hashes the whole quality declaration + bars; the score cache keys on it |
| `src/quality/metrics.ts:1-16` | the read-model is derived from events; `quality.verdict` already carries per-dimension `diagnosis[]` |
| `src/types/errors.ts:21-59`, `src/types/pi.ts:397-431`, `tests/types/errors.test.ts:44` | the closed `Code` union, its mirror, and the frozen taxonomy size (31) |
| `/home/tia/_DEV/AI/tia-mcp-rs/crates/governance/src/{initialize.rs:115-120, resources.rs:352-358, approval.rs:129-132}` | DOC, read-only: the sibling project keeps a named rules resource (`protocols/CODE.yaml`) as path + sha256 and feeds it to the subjects it governs |

## 3. What exists today — SI

### 3.1 The task unit is a file atom with a path identity

`loadTask` resolves `tasks/<path>` to `<tasksDir>/<path>.json`, parses it against `TaskConfigSchema`, and
refuses a document whose `id` is not its last path segment (`flow.ts:58`). The version is declared in
the document, not the path. Nothing in the task document may be a second copy of another fact: `requires`
names sections, `quality` names dimensions and probes, and the sections the probes target are checked against
the `requires` clauses (`schema.ts:276-294`).

### 3.2 The pin is bytes + digest per (instance, kind, id), and `kind` is the only closed part

`insertDefinition` refuses bytes that do not match their digest (`definitions.ts:81-96`); `readDefinition`
recomputes it on every read (`definitions.ts:102-126`). The storage shape was designed for exactly this: a new
`kind` value costs one enum member and no DDL, no new table, no migration, because the column is text and the
uniqueness key is already `(instance, kind, id)` (F2). The pin is written inside the same transaction as the
instance row (`start.ts:66-96`), so a partially pinned instance cannot exist.

Publications (`definitions.ts:55-58`) are a *different* fact: `publication.task` is typed `TaskRefSchema`
(`tasks/<path>`, `definitions.ts:56`), so a rule-set cannot join it without re-typing a store column — a
store-model change this unit must not make (`AGENTS.md` §13 gate 7). Consequence: rule-set identity is
enforced **per instance** by the pin, not across instances (§8, F8).

### 3.3 The brief is a projection, and it already carries the rubric

`stepDescriptor` (`descriptor.ts:200-268`) composes `{id, capabilities, ops, steps, brief}` from the pinned
flow, the pinned task, the handoffs and the learning view — no read, no write, no cache. `brief.quality`
already renders every dimension with its criteria and each criterion's `instructions` (`pi.ts:146-175`). The
brief is therefore the one place a rule's text can reach the agent without a new transport.

### 3.4 A probe's `instructions` IS the question jev is asked

`questionOf` builds the question from `probe.instructions` alone (`jev-scorer.ts:117-126`); the composed form
adds only a section-target prefix (`jev-scorer.ts:109-115`). Two consequences:

- **F5**: citing a rule needs no scorer change at all if the text is appended to `instructions` before the
  rubric is handed to the scorer. The opt-in is real: the author writes the probe and the citation; nothing
  is hardcoded and nothing is auto-gated.
- **F6**: `dimensionKey` hashes `probe.instructions` (`scope.ts:78-86`) and `rulerDigest` hashes the whole
  quality declaration (`evaluate.ts:106-111`). A rule **text** edit therefore re-keys that dimension's bar
  scope (its recorded raises no longer match, so it re-warms from the floor) and invalidates the cached
  verdict. That is the existing rule — "identity is what decides it" — applied consistently, and it must be
  stated as an accepted cost, not discovered later.

### 3.5 Quality is derived in nine places, and every one of them must agree

`task.quality ?? flow.config.quality` appears at:

`advance.ts:122`, `note-gate.ts:176`, `descriptor.ts:117`, `descriptor.ts:209`, `operations.ts:277`,
`operations.ts:309`, `operations.ts:393`, `feedback.ts:37`, `evaluate.ts:321`.

If rule text is composed anywhere other than one shared accessor, the brief could show one question while
jev answers another — a silent split exactly of the kind `AGENTS.md` forbids ("one authoritative owner per
fact"). **F4**: the composition must be owned by ONE function and every one of the nine sites must call it.

## 4. Where a rule can enter, and the constraint each seam imposes

| Seam | What it sees | What it cannot do |
| --- | --- | --- |
| `openFlow` (library) | the flow, every task file, the filesystem | it must refuse **before** the start transaction writes (`start.ts:40-50`) |
| `start` (pin) | the resolved sets and their bytes | it must pin the RAW rule bytes, never the expanded task (else the pin stores a second copy) |
| `loadPinnedFlow` (read) | the pinned flow, tasks and (new) rule rows | it must verify every digest, exactly as it does for tasks |
| `stepDescriptor` (brief) | pinned state only | it must stay read-only and derive no new fact |
| `effectiveQuality` → scorer | the rubric the judge sees | it may not change the gate, the bars or the score |

The load-bearing observation: the **pin must describe the task document as written**, while the **judge must
see the composed rubric**. Those are two different values of the same fact, so the expansion must live in
memory between them and nowhere else (F3, F4).

## 5. The sibling concept — DOC, read-only

`tia-mcp-rs` keeps a named rules resource as a path plus a sha256, and hands it to the subjects it governs
(`governance/src/initialize.rs:115-120`; `resources.rs:352-358` refuses a rules file whose digest moved;
`approval.rs:129-132` lists the rules among the things an approval is over). What is ported is the
**concept**: rules are an owned, digest-checked resource that the work references. What is not ported is the
code, the YAML format, the approval machinery, or any enforcement — none of it is a Praxis dependency
(`AGENTS.md` housekeeping note; no dependency is added).

## 6. Competing designs

| # | Design | Verdict |
| --- | --- | --- |
| D-A | Rule text is composed into the citing probe's `instructions` at resolve time, in one accessor | **Chosen.** No scorer change (F5); identity follows the existing rule (F6); one owner for the text; nothing stored |
| D-B | A separate `ruleText` field beside `instructions`, passed out of band | Rejected: a second text path through the scorer and the brief, and `dimensionKey` would no longer see what decides the dimension |
| D-C | The author copies the rule text into the task document | Rejected: violates one owner per fact (the frozen decisions) and drifts on the first edit |
| D-D | The expanded task is stored (a new row or a materialised copy) | Rejected: a second persisted copy of the rule text; a store-model change; the pin would describe the wrong bytes |
| D-E | A `ruleset` table of its own | Rejected: DDL + migration for a fact the `definition` table already holds (F2) |

## 7. Findings

- **F1** A rule-set can reuse the task atom exactly: same path grammar, same "id equals the last segment"
  check, same version-in-document rule, same pin. No new store concept is required.
- **F2** Pinning a rule-set needs one new `definition` `kind` value and no DDL, no table, no migration.
- **F3** Expansion must be a pure function from (task document, resolved sets) to (rules shown, composed
  rubric) because the pin must keep the task document as written.
- **F4** The nine `quality ?? flow.quality` sites must be reduced to one accessor, or brief and judge can
  disagree.
- **F5** The scorer needs no change: the question it asks is `probe.instructions`.
- **F6** A rule statement edit changes `dimensionKey` and `rulerDigest`: the dimension's bar re-warms and its
  cached verdict misses. Accepted, and to be tested.
- **F7** Per-criterion answers are already recorded (`quality.verdict.dimensions[].diagnosis[]`), so a cited
  rule is measurable by probe id with no new storage and no new metric.
- **F8** Nothing enforces a rule: the deterministic gate reads `requires` and the schema (`step.ts` gate), and
  the quality gate reads dimension scores. `rules` never reaches either. The wording must say so.
- **F9** A rule-set cannot join the `publication` table without re-typing a store column, so cross-instance
  immutability of `(path, version)` is NOT provided by this unit; the instance pin is (accepted, §8, K2).

## 8. Uncertainty

- **U1** Whether the composed instruction should carry the rule text at all, or the author should write the
  whole question and cite the rule only for provenance. Chosen: carry it, because otherwise "jev checks the
  rule" would be a claim the code does not support (owner decision 8).
- **U2** Whether a rule edit *should* re-warm a bar. It does, by the identity rule that already exists; the
  alternative (D-B) buys bar stability at the price of a second text path. Named for the owner.
- **U3** No cross-instance publication (F9): two instances may pin different bytes under the same
  `rules/<path>@<version>`. Detected inside an instance, not across instances.

## 9. Handed to the spec

The exact rule-set document, the ref and citation shapes, the one accessor and its nine call sites, the
composition string and its length guard, the pin rows and their verification, the failure matrix, the
explicit non-goals, and the acceptance oracles — including the F6 consequence and the F8 honesty line.
