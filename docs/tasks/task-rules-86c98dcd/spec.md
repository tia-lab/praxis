# Spec — the rules atom: file-owned sets, referenced by tasks, expanded at resolve

Task: task-rules · Hash: 86c98dcd · Gate: G2 · Status: draft · Date: 2026-10-31
Depends on: `research.md` (G1) — findings F1–F9, uncertainty U1–U3.

amended 2026-10-31 — §5.3 (two accessors), R9 → R9′, oracle 9, §7 (the identity boundary), §10 (D-B) — owner reversed R9: a statement edit or a version bump must never re-key a dimension or re-warm a bar [A8].
Design only. Nothing in this document authorizes code; the unit runs after the owner's live run.

## 1. Outcome

A **rule-set** is a reusable atom: one JSON file under `.pi/praxis/rules/[path/]name.json` holding a versioned
set of named rules (a one-line **statement** each). A task may **reference** rule-sets — a whole file, or named
ids from a file. At **resolve** time those references expand, in memory only, into (a) the rules the agent is
shown in its step brief, and (b) nothing else, unless the task's author also **cites** a rule from a quality
probe — in which case the rule's statement is composed into that criterion's question and jev judges it.

No rule is enforced. The gate is untouched. The rule text has exactly one owner: the rule-set file.

## 2. The model, and who owns each fact

| Fact | Owner | Not a copy |
| --- | --- | --- |
| What a rule says | the rule-set file (`.pi/praxis/rules/<path>.json`) | the task, the probe, the brief, the store |
| Which rules apply to a task | the task document's `rules` refs | the flow, the instance |
| Which rule a criterion judges | the probe's `rule` citation | the criterion text (which is derived from it) |
| Which rule versions a run used | the instance's `definition` rows, kind `ruleset` | any task or brief field |
| The rubric the judge used | derived in memory; recorded as `quality.verdict.rubricDigest` | nothing else |

`ResolvedNode` (`src/types/schema.ts:461-467`) is **unchanged**: the rules are a property of the task the node
names, resolved through the flow view, not a field of the node.

## 3. The rule-set document

Path: `.pi/praxis/rules/[path/]name.json`, the same folder grammar tasks use (`pathUnder`, one segment rule,
`src/types/schema.ts:24-36`). Identity: the path **and** the `version` declared in the document; the `id`
must equal the **last path segment**, exactly as `loadTask` requires (`src/runner/engine/flow.ts:58-66`).

```ts
// src/types/rules.ts
export const RULE_STATEMENT_MAX = 280;   // one line of guidance, not an essay
export const RULES_PER_SET_MAX  = 32;    // one file, bounded
export const RULE_REFS_PER_TASK_MAX = 8;
export const RULES_PER_TASK_MAX = 16;    // what a brief may carry

export const RuleIdSchema = z.string().regex(KEBAB, "expected a lower-case kebab rule id");
export const RulesetRefSchema = pathUnder("rules");          // "rules/engineering", "rules/core/verification"

export const RuleSchema = z.strictObject({
  id: RuleIdSchema,
  statement: z.string().min(1).max(RULE_STATEMENT_MAX),
});

export const RuleSetSchema = z
  .strictObject({
    id: z.string().regex(KEBAB, "expected a lower-case kebab set id"),   // === last path segment
    version: z.int().min(1),
    rules: z.array(RuleSchema).min(1).max(RULES_PER_SET_MAX),
  })
  .superRefine((set, ctx) => {
    const seen = new Set<string>();
    for (const rule of set.rules) {
      if (seen.has(rule.id)) ctx.addIssue({ code: "custom", path: ["rules", rule.id], message: "duplicate rule id" });
      seen.add(rule.id);
    }
  });
export type RuleSet = z.infer<typeof RuleSetSchema>;
```

A file:

```json
{
  "id": "engineering",
  "version": 2,
  "rules": [
    { "id": "smallest-sufficient", "statement": "Add the smallest mechanism that satisfies the stated acceptance; no speculative surface." },
    { "id": "cite-the-seam", "statement": "Name the file and line each claim rests on; an unverified claim is labelled proposed." }
  ]
}
```

Deliberately absent: severity, tags, applies-to selectors, enabled flags, enforcement actions, links. Each is a
second way to say something the statement already says, and none is needed by a present requirement.

## 4. The task's reference

```ts
// src/types/rules.ts
export const RuleRefSchema = z.strictObject({
  /** The set file, as a path under `rules/`. */
  set: RulesetRefSchema,
  /** Named ids only; absent means every rule in the file. */
  rules: z.array(RuleIdSchema).min(1).max(RULES_PER_TASK_MAX).optional(),
});

export const TaskRulesSchema = z
  .array(RuleRefSchema)
  .min(1)
  .max(RULE_REFS_PER_TASK_MAX)
  .superRefine((refs, ctx) => {
    const seen = new Set<string>();
    for (const ref of refs) {
      if (seen.has(ref.set)) ctx.addIssue({ code: "custom", message: "set " + JSON.stringify(ref.set) + " is referenced twice" });
      seen.add(ref.set);
    }
  });
```

On the task (`src/types/schema.ts`, inside `TaskConfigSchema`, one field):

```ts
/** Reusable guidance this task follows: file refs, optionally narrowed to ids. Absent means none. */
rules: TaskRulesSchema.optional(),
```

A **file ref** (`{ "set": "rules/engineering" }`) takes every rule in the file. A **specific-id ref** takes only
the named rules. Folder globbing is out of scope; a later additive form, not this unit.

**Order** is fixed and therefore testable: refs in declared order; within one ref, the **rule-set's own
document order**, filtered by the cited ids. An author cannot reorder the brief by reordering ids.

## 5. Resolution — one expansion, in memory

### 5.1 The two loaders

```ts
// src/runner/engine/rules.ts
export interface PinnedRuleSet {
  readonly path: string;        // "rules/engineering"
  readonly doc: RuleSet;
  readonly bytes: Uint8Array;   // the exact bytes read (or pinned)
  readonly digest: string;      // digest(bytes)
}

/** Library read: path -> file, parse, id === last segment. */
export function loadRuleSet(rulesDir: string, ref: string): PinnedRuleSet;

/** Expand a task's refs against the resolved sets. */
export function resolveRules(task: TaskConfig, sets: ReadonlyMap<string, PinnedRuleSet>): ResolvedRule[];

/** The composed rubric: every citing probe's question gains its rule's statement. */
export function withRuleText(quality: Quality | undefined, rules: readonly ResolvedRule[]): Quality | undefined;

/** Identity (§5.3): the authored rubric, unchanged. Bars, dimensionKey, rulerDigest, the note gate. */
export function authoredQuality(flow: OpenedFlow, task: TaskConfig): Quality | undefined;

/** The judge's rubric (§5.3): authored + the cited statements. The scorer request and the brief only. */
export function judgeQuality(flow: OpenedFlow, task: TaskConfig): Quality | undefined;
```

`ResolvedRule` is `{ set, version, setDigest, id, statement }` — a projection, never persisted.

### 5.2 `OpenedFlow` gains one field

```ts
export interface OpenedFlow {
  config; flowDigest; path; tasks;
  /** The sets this flow's tasks reference, resolved at open or read from the pins. */
  rules: ReadonlyMap<string, PinnedRuleSet>;
}
```

`openFlow` (library) loads exactly the sets the flow's tasks reference. `loadPinnedFlow` (instance) reads the
same sets from the instance's `definition` rows, kind `ruleset`, verifying each digest. Both return the same
shape, so `authoredQuality` and `judgeQuality` behave identically on the library and the pinned path.

### 5.3 Two accessors — authored for identity, composed for the judge and the brief

```ts
/** Identity: exactly today's expression — bars, dimensionKey, rulerDigest, the note gate, the brief's gate. */
export function authoredQuality(flow: OpenedFlow, task: TaskConfig): Quality | undefined {
  return task.quality ?? flow.config.quality;
}

/** The judge's rubric: authored + the cited statements. The scorer request and the brief's criteria only. */
export function judgeQuality(flow: OpenedFlow, task: TaskConfig): Quality | undefined {
  return withRuleText(authoredQuality(flow, task), resolveRules(task, flow.rules));
}
```

The boundary is frozen **[A8]**: `withRuleText` output feeds **only** the scorer request and the brief. It never
reaches `dimensionKey`, `rulerDigest`, a bar or the gate. A shared rule edited once must not cascade bar resets
across every task that cites it, so identity keys on **the reference** (`{set, id}`), never on the statement and
never on the version. This supersedes `research.md` F6 (which described the opposite consequence) and the single-accessor row of
its §4 seam table; both are unamended there by the owner's instruction, and this section is the ruling.

The nine sites, each mapped (a site that reads the wrong accessor is a defect):

| # | Site | Accessor | What it feeds |
| --- | --- | --- | --- |
| 1 | `advance.ts:122` | **authored** | `quantileBars(store, node.task, …)` (line 125) and the gate's `floors` block — bars are identity |
| 2 | `note-gate.ts:176` | **authored** | `pendingNote` returns `{quality, rubric}`: dimension ids and `maxAttempts`, no probe text |
| 3 | `descriptor.ts:117` (`learningView`) | **authored** | the gate, the earned bars and the recorded judgment |
| 4 | `descriptor.ts:209` (`stepDescriptor`) | **composed** | the brief shows the question the judge is asked, statement included |
| 5 | `operations.ts:277` | **authored** | `perDimensionDecision(verdict.dimensions, quantileBarsFor(…, quality))` — bars |
| 6 | `operations.ts:309` | **authored** | the sampling gate's policy; no probe text |
| 7 | `operations.ts:393` | **authored** | the refusal's recall need text, built from dimension statements |
| 8 | `feedback.ts:37` | **authored** | the refusal detail: dimension statements and the measured bars |
| 9 | `evaluate.ts:321` | **both** | `ruler`, `floorBars`, `quantileBarsFor`, the q50 `dimensionKey` loop and the cache key use **authored**; the scorer request uses **composed** |

Seven of the nine keep today's expression verbatim (`authoredQuality` is a rename), one switches to the composed
rubric, and one holds both values at once:

```ts
const authored = authoredQuality(view.flow, task);
const ruler   = { ...authored, threshold: ABSOLUTE_MIN };                    // bars, digest, cache, q50
const judged  = { ...judgeQuality(view.flow, task), threshold: ABSOLUTE_MIN }; // the scorer's request only
const verdict = await evaluateArtifact(options.scorer, judged, request, bars, {
  perDimension: measuredBars.perDimension, q50, ...(authored === undefined ? {} : { identity: authored }),
});
```

`evaluateArtifact` gains ONE optional option, `identity?: Quality`, used **only** for `rulerDigest`
(`evaluate.ts:155`). It defaults to the `quality` argument, so every existing caller and test is unchanged, and
the recorded `rubricDigest` is the authored one.

**Identity inputs, exactly.** `dimensionKey` (`src/quality/scope.ts:78-86`) hashes `[id, type, instructions,
criteria, clean]` and now appends `probe.rule.set` and `probe.rule.id` **only when a citation is present** — so
a probe without a citation keeps the key it has today, and a citation edit re-keys that dimension and nothing
else. The citation contributes the set path and the id; never the statement, the version or the set digest.

A task with no `rules` yields `rules.rules.length === 0`, so `withRuleText` returns its input **unchanged**
(identity, not a copy): `authored` and `judged` are the same object and a rules-free task is byte-identical on
both paths. The verdict cache cannot go stale from a statement edit either — within an instance the rule-set is
pinned, and across instances the cache is not consulted at all (`view.qualityHistory` is the instance's own
history).

### 5.4 Failure matrix (all typed, all fail closed)

| Condition | Code | Detail | Fires at |
| --- | --- | --- | --- |
| rule-set file absent | `RULE_NOT_FOUND` | `reason: "set-missing"`, `set`, `path` | `openFlow` / `loadRuleSet`, before any write |
| not JSON, or the document is invalid, or `id` ≠ last segment, or duplicate rule id | `CONFIG_INVALID` | `set`, `path`, issue | same |
| a ref selects an id the set does not declare | `RULE_NOT_FOUND` | `reason: "rule-missing"`, `set`, `rule` | same |
| the same set is referenced twice | `CONFIG_INVALID` | parse of the task document | task parse |
| expansion exceeds `RULES_PER_TASK_MAX` | `CONFIG_INVALID` | `count`, `max` | resolution |
| a probe cites a (set, id) its task does not reference | `RULE_NOT_FOUND` | `reason: "citation-not-referenced"` | resolution |
| composed instruction exceeds 500 characters | `CONFIG_INVALID` | `probe`, `length`, `max` | resolution |
| pinned rule row absent | `PIN_MISSING` | existing shape | `loadPinnedFlow` |
| pinned bytes ≠ digest | `PIN_CORRUPT` | existing shape | `loadPinnedFlow` |

One new code only: `RULE_NOT_FOUND` (`src/types/errors.ts`, the `Code` union) with its mirror in
`src/types/pi.ts` `CODES` and `TAXONOMY_SIZE` 31 → 32 (`tests/types/errors.test.ts:44`). `PIN_*`,
`CONFIG_INVALID` and `TASK_*` are reused where they already mean this.

## 6. The brief

`stepDescriptor` already renders the current task for the agent (`src/pi/descriptor.ts:200-268`). It gains one
derived field, and one additive field on criteria:

```ts
brief: {
  /* ...goal, produces, requires, consumes, quality: all unchanged... */
  rules: z.array(z.strictObject({
    set: z.string().min(1).max(128),      // "rules/engineering"
    version: z.int().min(1),
    digest: DigestSchema,                  // the set's digest, so the brief names the bytes it came from
    id: z.string().min(1).max(64),
    statement: z.string().min(1).max(RULE_STATEMENT_MAX),
  })).max(RULES_PER_TASK_MAX).optional(),
}
```

and, inside `brief.quality.dimensions[].criteria[]` (which already carries `instructions`):

```ts
/** Present when this criterion judges a named rule; the rule text is already inside `instructions`. */
rule: z.strictObject({ set: z.string().min(1).max(128), id: z.string().min(1).max(64) }).optional(),
```

- Absent when the task declares no rules → the descriptor is **byte-identical** to today.
- Ordered by §4. Bounded by `RULES_PER_TASK_MAX` (16) × 280 chars ≈ 4.5 KB.
- The instruction shown for a citing criterion is the **composed** text (§7), i.e. what jev is asked — the
  brief never shows a question the judge does not receive.

Duplication inside one envelope is accepted and harmless: a cited rule appears in `rules` and inside the
criterion's composed `instructions`. Both are projections of one file; neither is stored.

## 7. Jev: the opt-in criterion

```ts
// src/types/quality.ts — one additive field on ProbeSchema
/** When present, this criterion judges a named rule: its statement is composed into the question. */
rule: z.strictObject({ set: RulesetRefSchema, id: RuleIdSchema }).optional(),
```

Composition (in `withRuleText`, code-owned, deterministic, no clipping):

```text
composed = instructions + "\nRule " + rule.id + ": " + rule.statement
```

The composed value **replaces** `instructions` on the derived rubric before it reaches the scorer, so
`questionOf` (`src/quality/jev-scorer.ts:117-126`) and `composeQuestion` (`:109-115`) are **unchanged**: the
question already is `instructions`. Nothing is hardcoded, nothing is auto-gated; a criterion exists only
because an author wrote a probe and cited a rule.

**The composed rubric goes nowhere else [A8].** It is the scorer's request and the brief's rendering — never an
input to `dimensionKey`, `rulerDigest`, a bar, the gate or a refusal. The rule's *text* therefore changes what the
judge is asked without changing what the run is measured against (R9′).

Guards: `composed.length ≤ 500` (the `ProbeSchema.instructions` bound) or `CONFIG_INVALID`; the rule must be
covered by the task's refs (§5.4) or `RULE_NOT_FOUND`. No truncation ever — a clipped rule would be a
different rule.

## 8. Pinning

At `start`, inside the existing pin transaction (`src/runner/engine/start.ts:66-96`), for every set the flow's
tasks reference, **the raw file bytes** are pinned:

```ts
insertDefinition(store, { instance: id, kind: "ruleset", id: set.path, digest: set.digest, bytes: set.bytes });
```

`DefinitionKindSchema` (`src/store/definitions.ts:28`) gains `"ruleset"`: the column is text and the key is
already `(instance, kind, id)`, so this is **no DDL, no table, no migration, no `STORE_SCHEMA` bump**.

Consequences, stated plainly:

- The pinned bytes are the rule file as written — **never** the expanded task, so the rule text is never
  stored twice (§2).
- `loadPinnedFlow` re-verifies every rule-set digest on every read, exactly as it does for tasks: a finished
  run's brief and rubric cannot change when the file on disk changes.
- **No publication row** for rule-sets. `publication.task` is typed `TaskRefSchema` (`definitions.ts:56`);
  giving rule-sets the same cross-instance record would re-type a store column (a store-model change this
  unit excludes). Detected inside an instance, not across instances. Named as a cost, not hidden (K2).

## 9. Requirements

| Id | Requirement | Failure behaviour | Oracle |
| --- | --- | --- | --- |
| **R1** | A rule-set is one JSON document with path identity: `id` equals the last path segment, `version` ≥ 1, 1–32 rules, unique ids, statements 1–280 chars | `CONFIG_INVALID` naming the set and the issue | a valid file parses; `id` mismatch, duplicate id, empty set, 33 rules and a 281-char statement each refuse |
| **R2** | A task may declare `rules`: 1–8 refs, each a set plus optional ids (1–16); a set is referenced once | `CONFIG_INVALID` at parse; `RULE_NOT_FOUND` for an absent set or an unknown id | a file ref takes every rule; an id ref takes exactly those; a missing set / unknown id refuses with `RULE_NOT_FOUND` |
| **R3** | Expansion is derived: the resolved rules and the composed rubric exist in memory only; no event, column, table or task/brief field stores rule text | — | the store's digest and row counts are unchanged across start/advance; the task file on disk is unchanged; the pinned bytes equal the file's bytes |
| **R4** | `brief.rules` carries set, version, set digest, id and statement, in §4 order, ≤ 16; absent when the task declares none | `CONFIG_INVALID` when the expansion exceeds 16 | a task with two refs shows both in declared order; a rules-free task's descriptor is byte-identical to today's |
| **R5** | `start` pins every referenced set (kind `ruleset`) in the instance transaction; reads verify the digest | `PIN_MISSING` / `PIN_CORRUPT` | start writes exactly one row per referenced set; editing the file after start leaves the run's brief and rubric unchanged; a removed row refuses the read |
| **R6** | A probe citing a rule gets `instructions\nRule <id>: <statement>`; the scorer is unchanged | `RULE_NOT_FOUND` (unreferenced citation), `CONFIG_INVALID` (> 500 chars) | a stub scorer receives the composed text byte-exactly; a non-citing rubric's request is byte-identical to today's |
| **R7** | One owner per fact (§2): the file owns the text, the task references, the probe cites, the pin owns the version | — | the same rule text appears in exactly one file; grep finds no statement text in `src/`, `.pi/praxis/tasks/` or the store |
| **R8** | Nothing is enforced and the wording says so: no gate, bar or refusal reads `rules` | — | the deterministic gate and `perDimensionDecision` take no rule input (type + test); the brief/doc text says "guidance, not an enforced invariant" |
| **R9′** | **Identity keys on the reference, never the text.** `dimensionKey` and `rulerDigest` come from the *authored* rubric plus the citation's `{set, id}` — never the statement, never the set version. A statement edit or a version bump changes the judge's composed question and leaves every `dimensionKey`, every bar and every `rubricDigest` unchanged; editing **which** rule id a probe cites re-keys that dimension, and only that dimension | a citation that no longer resolves refuses at resolve (`RULE_NOT_FOUND`); no new runtime failure | §12.9: a statement edit and a version bump leave `dimensionKey`/`rulerDigest` byte-identical while the composed question changes; a citation change moves both; a citation-free probe keeps its pre-unit key |
| **R10** | No new store, table, DDL, `STORE_SCHEMA` bump, event type, dependency or gate; the six result keys are unchanged | — | the store schema version is unchanged; `package.json` dependencies unchanged; `ResultSchema` unchanged; the suite's dependency-free run stays green |
| **R11** | Every rule failure at open/start happens **before** any write | `RULE_NOT_FOUND` / `CONFIG_INVALID` with the store file digest unchanged | a broken ref refuses `start` with zero instance and zero definition rows |
| **R12** | A rules-free project is untouched: no rules dir, no pinned rows, no brief field, byte-identical envelopes | — | the full suite without a `.pi/praxis/rules` directory is green and the descriptor deep-equals the pre-unit value |

## 10. Alternatives rejected

See `research.md` §6 for the full table. **D-B** (a separate `ruleText` field) was rejected there because it
put a second text path through the scorer. The owner has since adopted D-B's *identity* consequence in a smaller
form **[A8]**: identity keys on the reference (`{set, id}`), not on the composed text — and no second field is
needed, because the composed rubric exists only as the scorer's request and the brief's rendering (§5.3).
**D-C** (copy the text into the task) is a second owner; **D-D** (store the expanded task) makes the pin describe
the wrong bytes; **D-E** (a `ruleset` table) is DDL for a fact the `definition` table already holds.

## 11. What this spec does NOT do

- No folder globbing, no wildcards, no computed refs — file + ids only.
- No flow-level `rules` field (a task declares; additive later).
- No enforcement, no gate, no new failure that stops work — a rule can only guide and be judged.
- No rule-set draft/published lifecycle, no `TASK_NOT_PUBLISHED` analogue.
- No cross-instance publication (K2), no same-version edit detection across instances.
- No change to `ResolvedNode`, the six result keys, the store schema, the scorer, the bars, the gate, recall,
  the metrics read-model, or any dependency.
- No shipped rule-set file: the data slice is a separate, later owner decision (a rule set is content, and its
  wording is the owner's).

## 12. Acceptance oracles

1. **R1** the four invalid documents refuse with the named code and no write.
2. **R2/R11** an absent set and an unknown id refuse `start` with `RULE_NOT_FOUND` and the store file digest is
   unchanged (zero instances, zero definitions).
3. **R3** start + advance leave the store row counts and the task file byte-identical; the pinned `ruleset`
   bytes equal the file's bytes.
4. **R4** a two-ref task shows rules in declared order, the set's order inside each ref, ≤ 16; a rules-free
   task's `stepDescriptor` deep-equals the pre-unit descriptor.
5. **R5** editing a rule file after `start` leaves that instance's brief statement and `rubricDigest`
   unchanged; deleting the pin row refuses with `PIN_MISSING`; flipping a byte refuses with `PIN_CORRUPT`.
6. **R6** with a stub scorer, the citing probe's question is exactly `instructions + "\nRule <id>: <statement>"`;
   a non-citing rubric's scoring request is byte-identical to the pre-unit request.
7. **R7** no rule statement text exists under `src/`, `.pi/praxis/tasks/` or any store column in a fixture.
8. **R8** `perDimensionDecision`, `gate`, `compoundDecision` compile and run with no rule argument; the brief and
   the skill say "guidance, not an enforced invariant".
9. **R9′** with a cited rubric: (a) editing the statement leaves `dimensionKey(d)` and `rulerDigest`
   byte-identical while the composed question changes; (b) bumping the set `version` does the same; (c) changing
   the citation's `{set, id}` moves both the dimension key and the ruler digest; (d) a probe with no citation
   keeps exactly the key recorded before this unit (a pinned fixture).
10. **R10/R12** `STORE_SCHEMA`, `package.json`, `ResultSchema` unchanged; the full suite is green with and
    without a `rules` directory.

## 13. Convergence — why this needs no new measurement machinery

A rule that is worth checking is expressed as a probe, and probes are already first-class in the quality
pipeline: the verdict records every criterion's answer in `dimensions[].diagnosis[]` (`src/types/schema.ts:190-210`),
the rubric digest records the exact text that was judged, and the metrics read-model
(`src/quality/metrics.ts`) aggregates those verdicts per task and dimension with no store of its own. A
citing criterion is therefore measurable by probe id, A/B-testable against a rubric without it, and visible in
the existing bottleneck / Q50 readouts — **zero new storage, zero new metric, zero new validation machinery**.
This is the reason the frozen decision says "one expansion, two consumers" and not "a second rule engine".
