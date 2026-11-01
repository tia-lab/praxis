# Plan — G3: the rules atom, in five slices

Task: task-rules · Hash: 86c98dcd · Gate: G3 · Status: draft · Date: 2026-10-31
Contract: `research.md` §0 (owner GO recorded by the lead). Spec: `spec.md` (G2), requirements R1–R12.

amended 2026-10-31 — S2 (two accessors + identity), S3, S4 oracle, §7 declarations, §8 frozen list, §9 checks, §11 LOC, §12 risks — owner reversed R9: a statement edit or a version bump must never re-key a dimension or re-warm a bar (spec R9′, A8).
**Design only.** This plan is for a later authorized unit; nothing here is executed now.

## 0. Scope and invariants

Claims (write surface): the files named in §7 only. `docs/task-rules-86c98dcd/` is this unit's write home.

Invariants that hold after every slice:

- **I1** A project with no `rules` refs behaves byte-identically: same descriptor, same envelopes, no pins, no
  reads of a `rules` directory (R12).
- **I2** The rule text is never stored: not in a task, not in a brief, not in an event, not in a definition row
  except the pin of the rule file's own bytes (R3).
- **I3** Nothing is enforced: no gate, bar or decision reads `rules` (R8).
- **I4** Every failure is a typed `AppError` fired before the first write on the start path (R11).
- **I5** ≤ 600 lines per file (`AGENTS.md` §3). `src/types/schema.ts` is 589 today, so the slice S1 move of
  `pathUnder` out of it is **load-bearing**, not cosmetic.
- **I6** **Identity is authored.** No composed rule text ever reaches `dimensionKey`, `rulerDigest`, a bar, the
  gate or a refusal: a statement edit and a version bump are inert to every key (spec R9′). The composed rubric
  has exactly two consumers — the scorer request and the brief.
- **MIN-006** no speculative surface (no severity/tags/globs/lifecycle), **MIN-009** no second owner,
  **MIN-010** no mechanism without a present consumer.

## 1. Slice order

```
S1 types + grammar ──▶ S2 resolve + pin ──▶ S3 brief ──▶ S4 judge end-to-end + honesty ──▶ S5 acceptance
     (no behaviour)      (the only behavioural slice)     (projection)      (proofs)               (evidence)
```

S1 and S2 land in one unit: after S1 alone, a task could declare `rules` that nothing resolves — an inert field
is acceptable only because no shipped task declares one and S2 follows in the same unit. S2 pins and reads in
one slice on purpose: pinning without reading (or the reverse) leaves a window where an instance can be created
and not read back.

## 2. S1 — identity, grammar and types (additive; no behaviour)

Files: `src/types/paths.ts` (new), `src/types/rules.ts` (new), `src/types/schema.ts`, `src/types/quality.ts`,
`src/types/errors.ts`, `src/types/pi.ts`, `tests/types/{paths,rules}.test.ts`, `tests/types/errors.test.ts`.

1. `src/types/paths.ts` — move `KEBAB`, `PATH_SEGMENTS` and `pathUnder` out of `schema.ts` unchanged, and
   admit `"rules"` as a third root. `schema.ts` imports them and re-exports `pathUnder` so no importer moves.
   (`TASKS_ROOT` stays in `schema.ts`: `parseTaskRef` uses it.)
2. `src/types/rules.ts` — `RuleIdSchema`, `RulesetRefSchema = pathUnder("rules")`, `RuleSchema`,
   `RuleSetSchema` (with the duplicate-id refine), `RuleRefSchema`, `TaskRulesSchema` (duplicate-set refine),
   `ResolvedRule` interface, and the five constants (`spec.md` §3).
3. `src/types/schema.ts` — `TaskConfigSchema` gains `rules: TaskRulesSchema.optional()` with its doc comment.
   Net ≈ −11 / +4 lines, still under 600.
4. `src/types/quality.ts` — `ProbeSchema` gains `rule: z.strictObject({ set: RulesetRefSchema, id: RuleIdSchema }).optional()`
   (+ its comment). No other probe rule: the composition is a resolution concern, not a parse concern.
5. `src/types/errors.ts` — `Code` gains `"RULE_NOT_FOUND"` beside `TASK_NOT_FOUND`; `src/types/pi.ts` `CODES`
   gains the same string; `tests/types/errors.test.ts` `TAXONOMY_SIZE` 31 → 32.

**Check:** `npx tsc --noEmit`; `node --test tests/types/` — a valid set parses; id ≠ last segment, duplicate
rule id, empty rules, 33 rules and a 281-char statement each refuse; two refs to one set refuse; `rules` absent
parses; the mirror length matches `TAXONOMY_SIZE`.

**Exit:** nothing in `src/` outside `types/` mentions rules; the suite is green and unchanged in behaviour.

## 3. S2 — resolve and pin (the only behavioural slice)

Files: `src/runner/engine/rules.ts` (new), `src/runner/engine/{flow,start,types,support,advance}.ts`,
`src/runner/note-gate.ts`, `src/pi/{descriptor,operations,feedback}.ts`, `src/quality/{evaluate,scope}.ts`,
`src/store/definitions.ts`, `tests/runner/rules.test.ts`, `tests/runner/flow-rules.test.ts`.

1. `support.ts` — `rulesDirOf(options)`: option → `PRAXIS_RULES_DIR` → `<cwd>/.pi/praxis/rules`, mirroring
   `tasksDirOf` (`support.ts:34-36`).
2. `src/runner/engine/rules.ts` — `PinnedRuleSet`, `loadRuleSet` (read, parse, `id` = last segment,
   `RULE_NOT_FOUND` on a missing file, `CONFIG_INVALID` on bad bytes/shape), `resolveRules`,
   `withRuleText` (citation composition + the 500-char guard), and the two accessors `authoredQuality`
   (identity) / `judgeQuality` (the judge's rubric).
3. `engine/types.ts` — `OpenedFlow` gains `rules: ReadonlyMap<string, PinnedRuleSet>` (`types.ts:156-162`).
4. `flow.ts` — `openFlow` collects the referenced sets from `flow.tasks` and loads them; `loadPinnedFlow` reads
   the same sets with `readDefinition(store, instance.id, "ruleset", path)` and verifies the digest;
   `validateFlow` stays untouched (task refs already resolve there).
5. `start.ts` — inside the existing transaction (`start.ts:66-96`), one `insertDefinition` per referenced set,
   from the `PinnedRuleSet` bytes. Nothing else moves.
6. `store/definitions.ts` — `DefinitionKindSchema` gains `"ruleset"` (`definitions.ts:28`). The column is
   text; **no DDL, no migration, no `STORE_SCHEMA` change**.
7. The nine call sites follow the authored/composed map in `spec.md` §5.3 **exactly**: seven become
   `authoredQuality(flow, task)` (a rename — the same value as today), `descriptor.ts:209` becomes
   `judgeQuality(flow, task)`, and `evaluate.ts:321` holds both (`ruler` from `authoredQuality` for bars, digest,
   cache and q50; the scorer's request from `judgeQuality`). `evaluate.ts:321` keeps its `task === undefined`
   branch.
8. `src/quality/scope.ts` — `dimensionKey` appends `probe.rule.set` and `probe.rule.id` **only when the probe
   cites a rule**, so a citation-free probe keeps the exact key it has today and a citation edit re-keys that
   dimension alone. The statement and the version are never part of the basis.
9. `src/quality/evaluate.ts` — `evaluateArtifact` gains one optional option, `identity?: Quality`, used **only**
   for `rulerDigest`; it defaults to the `quality` argument, so existing callers and tests are unchanged.

**Check:** with a fixture `rules/` dir — a task's file ref expands to every rule; an id ref expands to those;
a missing set and an unknown id refuse `start` with `RULE_NOT_FOUND` while the store file's sha256 is unchanged
and zero rows exist; a started instance writes exactly one `kind="ruleset"` row per referenced set whose bytes
equal the file; editing the file afterwards leaves `loadPinnedFlow`'s rules unchanged; deleting the row refuses
`PIN_MISSING`; flipping a byte refuses `PIN_CORRUPT`; a rules-free flow writes no rows and returns an empty map.
**Identity:** for a cited rubric, a statement edit and a version bump leave `dimensionKey` and `rulerDigest`
byte-identical while the composed question changes; changing the citation moves both (spec R9′).

**Exit:** `tsc` clean; the full suite green; the store schema version is unchanged; no `rules` text anywhere in
`src/`.

## 4. S3 — the brief

Files: `src/pi/descriptor.ts`, `src/types/pi.ts`, `tests/pi/brief-rules.test.ts`.

1. `pi.ts` — `StepDescriptorSchema.brief` gains `rules` (optional, as in `spec.md` §6), and
   `brief.quality.dimensions[].criteria[]` gains `rule` (optional `{set, id}`).
2. `descriptor.ts` — `stepDescriptor` computes `const rules = resolveRules(resolved.task, flow.rules)` once,
   emits `brief.rules` in §4 order, and renders the composed quality (via `judgeQuality`, S2) so the brief
   shows the composed `instructions`. Nothing is cached and nothing is written.

**Check:** a two-ref task's brief lists rules in declared order and, inside a ref, the set's document order; a
rules-free task's descriptor deep-equals the pre-unit value; an expansion of 17 rules refuses `CONFIG_INVALID`;
a citing criterion's `instructions` equal the composed text and carry `rule: {set, id}`.

**Exit:** `tsc` clean; suite green; no new field appears on a rules-free task's envelope.

## 5. S4 — the judge, end to end, and the honesty line

Files: `tests/quality/rules-probe.test.ts`, `.pi/skills/praxis/SKILL.md`, `README.md`.

1. A stub `Scorer` test proves the request jev receives: the citing criterion's instructions are
   `instructions + "\nRule <id>: <statement>"` byte-exactly; a rubric with no citation produces the
   **byte-identical** request it produced before this unit. The same test records `dimensionKey(d)` and
   `rulerDigest` around a statement edit and a version bump — both byte-identical, while the composed question
   changed — and around a citation change — both move (spec §12.9).
2. Prove the negative (R8): `perDimensionDecision`, `gate` and the verdict carry no rule input — a rule whose
   statement is nonsense cannot change a score, a bar or a decision.
3. `.pi/skills/praxis/SKILL.md` — one short paragraph: rules appear in `brief.rules`; they are guidance and,
   where a criterion cites one, a judged check — never an enforced invariant. `README.md` — a "Rules" subsection
   stating the same in one paragraph with the file path and the pin guarantee.

**Check:** the two request fixtures (with and without a citation) are pinned in the test; `tsc` clean; suite
green; the skill and README say "guidance", not "enforced".

**Exit:** R6, R7, R8 provable from tests and text alone.

## 6. S5 — acceptance

Run every oracle in `spec.md` §12 as a named test, plus: `npx tsc --noEmit`; the full suite; a re-parse of both
live stores (`/tmp/praxis-exp-v6`, `/tmp/praxis-exp-v7`) to prove old instances open with an empty
`OpenedFlow.rules` and unchanged envelopes; `wc -l` on every touched file (< 600); `git diff` on
`package.json`, `src/store/db.ts` (where `STORE_SCHEMA` lives, line 17) and `ResultSchema` — all empty.

**Exit:** the unit is evidence-complete; the review (G5) writes `review.md`.

## 7. Affected declarations

| Declaration | File:line today | Change |
| --- | --- | --- |
| `KEBAB`, `PATH_SEGMENTS`, `pathUnder` | `src/types/schema.ts:15-36` | moved to `src/types/paths.ts`; `"rules"` root added; re-exported |
| `TaskConfigSchema` | `src/types/schema.ts:255-295` | + `rules?` |
| `ProbeSchema` | `src/types/quality.ts:29-80` | + `rule?` |
| `Code` union | `src/types/errors.ts:21-58` | + `RULE_NOT_FOUND` |
| `CODES` mirror | `src/types/pi.ts:397-431` | + `RULE_NOT_FOUND` |
| `TAXONOMY_SIZE` | `tests/types/errors.test.ts:44` | 31 → 32 |
| `OpenedFlow` | `src/runner/engine/types.ts:156-162` | + `rules` |
| `DefinitionKindSchema` | `src/store/definitions.ts:28` | + `"ruleset"` |
| `openFlow`, `loadPinnedFlow` | `src/runner/engine/flow.ts:69-95, 167-198` | load the referenced sets |
| `start` | `src/runner/engine/start.ts:66-96` | pin the referenced sets |
| `stepsDirOf`/`tasksDirOf` family | `src/runner/engine/support.ts:34-36` | + `rulesDirOf` |
| `authoredQuality` / `judgeQuality` call sites | `spec.md` §5.3 (9) | 7 authored, 1 composed, 1 both |
| `dimensionKey` | `src/quality/scope.ts:78-86` | + the citation `{set, id}` when present |
| `evaluateArtifact` | `src/quality/evaluate.ts:145-160, 240` | + an optional `identity` rubric for `rulerDigest` |
| `stepDescriptor`, `StepDescriptorSchema.brief` | `src/pi/descriptor.ts:200-268`, `src/types/pi.ts:114-200` | + `brief.rules`, `criteria[].rule` |
| `src/runner/engine/rules.ts` | — | new |
| `src/types/rules.ts`, `src/types/paths.ts` | — | new |

## 8. Write surface, and what stays frozen

Written: the files above, `.pi/skills/praxis/SKILL.md`, `README.md`, `tests/**`, this folder.
Frozen (a diff is a blocking finding): `src/quality/jev-scorer.ts`, `src/quality/bar.ts`,
`src/quality/metrics.ts`, `src/runner/step.ts`, the gate, the store schema and every SQL statement,
`package.json`, `src/types/pi.ts`'s `ResultSchema`, `.pi/praxis/tasks/**`, `.pi/praxis/flows/**`.

## 9. Checks

| Slice | Command | Expected |
| --- | --- | --- |
| S1 | `npx tsc --noEmit` + `node --test tests/types/` | 0 errors; new parse tests green; taxonomy 32 |
| S2 | `node --test tests/runner/ tests/store/` | refusals typed; pins written and verified; store schema unchanged |
| S2 | `git diff --stat src/store/db.ts` | empty (no DDL, no schema bump) |
| S3 | `node --test tests/pi/` | brief order/bounds; rules-free descriptor byte-identical |
| S4 | `node --test tests/quality/` | composed question byte-exact; non-citing request byte-identical; identity byte-identical across a statement edit and a version bump, and moved by a citation change |
| S5 | full `node --test` + `tsc` + `wc -l` | suite green; 0 errors; every file < 600 |

## 10. Recovery

- S1 is additive and reverts in one `git revert` (nothing reads the new fields).
- S2 is the only behavioural slice: reverting it restores the nine inline derivations and leaves no orphaned
  pin rows, because no row is read once the reader is gone (the rows are inert data in a per-instance table).
- No migration is ever written, so there is no data recovery path to design: an old store opens with an empty
  `OpenedFlow.rules` and unchanged behaviour (proved in S5).
- A rule file that breaks a start is fixed by editing the file; nothing in a running instance changes.

## 11. LOC budget

| File | Now | Delta |
| --- | --- | --- |
| `src/types/paths.ts` (new) | — | +26 |
| `src/types/rules.ts` (new) | — | +95 |
| `src/types/schema.ts` | 589 | −11 / +4 |
| `src/types/quality.ts` | 165 | +14 |
| `src/types/pi.ts` | 439 | +26 |
| `src/types/errors.ts` | 96 | +2 |
| `src/runner/engine/rules.ts` (new) | — | +140 |
| `src/runner/engine/flow.ts` | 198 | +48 |
| `src/runner/engine/start.ts` | 116 | +14 |
| `src/runner/engine/types.ts` | 198 | +3 |
| `src/runner/engine/support.ts` | 136 | +9 |
| `src/pi/descriptor.ts` | 288 | +12 / −4 |
| 9 call sites | — | +0 (7 one-liners, 2 restructured) |
| `src/quality/scope.ts` | 194 | +3 / −1 |
| `src/quality/evaluate.ts` | 359 | +4 |
| `src/store/definitions.ts` | 163 | +1 |
| tests (6 new files) | — | +380 |

Net ≈ +370 source lines, +380 test lines; no file over 600 (`schema.ts` 582, `flow.ts` 246, `pi.ts` 465).

## 12. Risks

| Id | Risk | Consequence | Mitigation |
| --- | --- | --- | --- |
| K1 | A site reads the wrong accessor (composed where identity is required) | a statement edit would move a bar, or the brief would show an uncomposed question | S2 applies the nine-row map (`spec.md` §5.3) mechanically; a grep gate: `judgeQuality` appears at exactly two sites (the brief and the scorer request) and never beside `quantileBars`, `rulerDigest` or `dimensionKey` |
| K2 | No `publication` row for rule-sets | two instances may pin different bytes under one `rules/<path>@<version>` | stated (`spec.md` §8); the instance pin is the guarantee; a later unit can add a rule publication if the owner wants cross-instance immutability |
| K3 | ~~A statement edit re-keys the dimension and re-warms its bar~~ — **CLOSED by the owner's reversal (A8, R9′)**: identity keys on the reference, so statement edits and version bumps are inert to every key | two rubrics differing only in a statement share a `rulerDigest`, so an audit of *exactly what was asked* reads the pinned set bytes, not the digest | tested in S2/S4 (R9′); the residual is named here rather than hidden |
| K6 | The `dimensionKey` append could change existing keys | every earned bar would re-warm on upgrade | the append is **conditional** on a citation being present, so a citation-free probe's basis is byte-identical; a pinned pre-unit key is part of the S2 check |
| K4 | The 500-char composition guard can bite | a long statement + long question refuses at resolve | `RULE_STATEMENT_MAX` 280 leaves 220 chars of question; the refusal names the probe and both lengths |
| K5 | `RULES_PER_TASK_MAX = 16` may be too small for a large rule set | a file ref of a 20-rule set refuses | the author narrows to ids or the owner raises the constant; the number is one constant, tested |

## 13. Out of scope

Folder/glob refs; flow-level rules; rule severity, tags or applicability selectors; enforcement of any kind;
a rule-set lifecycle (`draft`/`published`); cross-instance publication; a `rules` listing op on the tool; rule
text in recall or in the metrics read-model as a new field; shipped rule content (an owner decision, later);
issue/note ops; any change to the six result keys, the store schema, the scorer, the gate or a dependency.
