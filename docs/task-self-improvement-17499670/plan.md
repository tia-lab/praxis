# Plan — T1–T3: give the judge the assignment (task intent, the durable order, the composed scorer)

Task: task-self-improvement · Hash: 17499670 · Gate: G3 · Status: draft — lead review before G4 · Date: 2026-10-31

**Predecessor:** [`revised-root-cause.md`](revised-root-cause.md) — the design this plan implements. It supersedes
the priority of `research.md`/`spec.md` (the grader maths), which is retained in
[`plan-grader-slices.md`](plan-grader-slices.md) as the record for **T6**, which is NOT in this unit.

**Scope: T1, T2, T3 only.** T4 (author research v6), T5 (re-measure and re-derive the floor), T6 (grader
maths), T7 (acceptance metrics) follow as separate units with their own GO. Design/planning only — no code is
written by this document.

Measured baseline this plan starts from: `./node_modules/.bin/tsc --noEmit` **clean**; `node --test
'tests/**/*.test.ts'` **341/341 green** (~4 s); `src/types/schema.ts` 545 lines, `src/types/quality.ts` 126,
`src/quality/jev-scorer.ts` 274, `src/quality/evaluate.ts` 250, `src/pi/descriptor.ts` 265,
`src/pi/operations.ts` 532 — all files stay under 600.

## 0. What is additive, and what may not move

| Invariant | How it is kept |
|---|---|
| `praxis.task/v1` stays valid | every new field is **optional**; absent = today's behaviour byte-for-byte; a document that does not declare intent parses to the same digest |
| Store schema unchanged | `praxis.store/v2` untouched; no DDL, no column, no migration. The order rides an **existing** event payload (`instance.created`) |
| Six-key result unchanged | no `ResultSchema` field added; the Pi envelopes gain only additive-optional fields inside `step.brief` |
| Never-lower / compound / Pareto / tolerance / alignment gate | no line of `bar.ts`'s ratchet, `compoundDecision`, `gateBar`, `gate()`'s decision, `jev-align.ts`'s decision or `DIMENSION_TOLERANCE` changes in T1–T3 |
| No new dependency, no new error code, no new event type | the two new config refusals reuse `CONFIG_INVALID`; no `EVENT` entry added |
| `op=check` | untouched: writes nothing, scores nothing, costs no attempt |

---

## 1. T1 — task-document intent (schema + brief)

### 1.1 The exact field shapes (all optional)

```jsonc
// task root — src/types/schema.ts TaskConfigSchema
{
  "id": "research", "version": 6, "state": "published",
  "goal": "establish what is true from sources and the code before anything is designed",
  "rationale": "a design decision made on unverified claims is the expensive failure this stage prevents",
  "scope": "claims about this repository and its shipped code; not the roadmap, not other projects",
  "requires": [
    { "section": "sources",
      "goal": "every source states what it establishes for THIS question",
      "rationale": "an uncited claim cannot be re-checked by the next stage",
      "required": ["source", "location", "establishes"] }
  ],
  "quality": { "dimensions": [
    { "id": "grounded", "statement": "…", "probes": [
      { "id": "every-claim-cited", "type": "noul", "instructions": "…",
        "sections": ["findings", "sources"] }
    ] }
  ] }
}
```

| Element | Type | Bounds | Absent means |
|---|---|---|---|
| `task.rationale` | `string` | 1–1000 | no rationale; the composed goal is `order + goal` |
| `task.scope` | `string` | 1–1000 | no scope |
| `requires[].goal` | `string` | 1–500 | section has no stated purpose |
| `requires[].rationale` | `string` | 1–500 | — |
| `probes[].sections` | `string[]` | 1–6, unique, each kebab-ish `[a-z0-9-]` up to 64 | the criterion judges the **whole artifact** (today) |

`requires[].note` already exists (`src/types/schema.ts:112`) and stays agent-facing only; `goal` is the
**judge-facing** half. Two fields, two audiences — do not merge them.

### 1.2 Ordered edits

1. `src/types/quality.ts:18-64` — `ProbeSchema`: add `sections: z.array(SectionNameSchema).min(1).max(6).optional()`
   after `clean`; extend the existing `.superRefine` to refuse duplicate section ids. `SectionNameSchema` is the
   same kebab rule used for `id` (one owner: reuse it if it already exists, otherwise declare it beside
   `ProbeSchema`).
2. `src/types/schema.ts:109-124` — `RequirementSchema`: add `goal?: z.string().min(1).max(500)` and
   `rationale?: z.string().min(1).max(500)`. Nothing else changes; `note` stays as it is.
3. `src/types/schema.ts:233-250` — `TaskConfigSchema`: add `rationale?: z.string().min(1).max(1000)` and
   `scope?: z.string().min(1).max(1000)` after `goal`, and append a `.superRefine` that:
   - normalizes `requires` to an array (it is the union `Requirement | Requirement[]`),
   - collects the declared section ids,
   - for every probe that declares `sections`, refuses any id not in that set — code `CONFIG_INVALID` at both
     parse sites (`src/runner/engine/flow.ts:55` for the library, `:186` for the pinned row),
   - leaves a task with no probes or no `sections` untouched (no issue added).
4. `src/pi/descriptor.ts:44-58` — `criterionBrief`: add `...(probe.sections === undefined ? {} : { sections: probe.sections })`.
5. `src/types/pi.ts:141-160` — the brief's criterion schema gains `sections: z.array(z.string().min(1).max(64)).min(1).max(6).optional()`.
   (Section goals need no code: the brief already projects `requires` wholesale at `descriptor.ts:176-183`, so
   `goal`/`rationale` ride along once the schema accepts them.)
6. `tests/types/intent.test.ts` — the six R1–R6 tests below.

### 1.3 Write boundary (T1 owns)

`src/types/quality.ts` · `src/types/schema.ts` (`RequirementSchema`, `TaskConfigSchema` only) ·
`src/pi/descriptor.ts` (`criterionBrief` only) · `src/types/pi.ts` (brief criterion schema only) ·
`tests/types/intent.test.ts`. **No runtime file.** `src/runner/engine/flow.ts` is read-only for the engineer:
the refusal comes from the schema's `superRefine`, not from a new code path there.

### 1.4 Requirements and tests (one per requirement)

| R | Requirement | Test (named) | Oracle |
|---|---|---|---|
| R1 | `rationale` and `scope` are optional and bounded; a document without them parses and digests exactly as before | `a task without intent parses and digests as before` | the same fixture before/after T1 → identical `canonicalBytes` digest and no schema issue |
| R2 | `requires[].goal`/`rationale` are carried into the brief and never machine-graded | `section intent reaches the brief and is never graded` | the brief contains the goal; `missingFor` on a document that omits every field still reports only the `required` gaps |
| R3 | `probes[].sections` parses: 1–6 unique ids, absent allowed | `probe sections parse, are unique and bounded` | 7 ids refused; duplicate ids refused; absent accepted |
| R4 | Every targeted section must be declared in `requires`, else `CONFIG_INVALID` | `a section a criterion targets must exist in requires` | `sections: ['findings']` with no `findings` clause → refuse with `CONFIG_INVALID` and a path-addressable message |
| R5 | The brief exposes each criterion's `sections`; the brief for a task without them is unchanged | `the brief carries criterion sections` | a composed brief with targeting lists `sections`; a brief without targeting is byte-identical to today |
| R6 | The 12 shipped task documents parse unchanged; no republish is forced | `the 12 shipped task documents parse unchanged` | read all `.pi/praxis/tasks/**/*.json`, parse each with the new schema, assert zero issues and 12 files |

**Exit check for T1:** `tsc` clean; 341 + 6 = 347 green; no `src/` behaviour changed (a verdict recorded before
T1 re-parses after it).

---

## 2. T2 — the order becomes durable

### 2.1 The exact field shape

```jsonc
// instance.created payload — additive
{
  "flow": "flows/engineering/feature", "requestId": "base-w02", "actor": "pi-session:…",
  "flowDigest": "sha256:…", "nonce": "eccc…", "storeDir": "/tmp/praxis-rewarm",
  "order": "<the concrete order, clipped to 4000 chars>",
  "orderDigest": "sha256:…"
}
```

`StartOptions.order?: string` (additive). The engine does not interpret it in this step.

### 2.2 Ordered edits

1. `src/runner/engine/types.ts` (`StartOptions`, ~`:88-100`) — add `order?: string` with a comment that it is
   recorded, not yet judged.
2. `src/pi/operations.ts:180-196` — pass `order` (already read at `:180`) into `start({ ...options, flow, requestId, actor, order, roles })`.
3. `src/runner/engine/start.ts:92-99` — the `instance.created` payload gains
   `...(options.order === undefined ? {} : { order: clip(options.order, 4000), orderDigest: digest(options.order) })`.
   Use the existing `digest` (`src/runner/canonical.ts`) over the raw text so the digest is independent of
   `orderDigestOf` in `jev-align.ts` (that one digests a normalized form for the gate; keep both meanings separate
   and name the field `orderDigest` for the raw text).
4. `src/runner/engine/support.ts` — add `orderOf(store: Store, instance: string): string | undefined`: scan the
   instance's `instance.created` event once, return `payload.order` when it is a string. Pure read, no throw.
   (A convenience wrapper `orderFor(options, instance)` may open a short `withStore` read; it must close before
   any jev call.)
5. `tests/runner/order-durability.test.ts` — the five R7–R11 tests below.

### 2.3 Write boundary (T2 owns)

`src/runner/engine/types.ts` · `src/runner/engine/start.ts` · `src/runner/engine/support.ts` ·
`src/pi/operations.ts` (the `startOperation` block only) · `tests/runner/order-durability.test.ts`.
**`src/quality/**` is untouched in T2** — that is what makes `the order alone changes no verdict` provable.

### 2.4 Requirements and tests

| R | Requirement | Test (named) | Oracle |
|---|---|---|---|
| R7 | op=start persists the order it already requires, with a digest | `start persists the order and its digest on instance.created` | after `op=start` with an order, the created payload's `order` equals the input and `orderDigest` equals `digest(text)` |
| R8 | A start without an order writes no `order` key | `a start without an order writes no order key` | the payload keys are exactly today's set; serialised payload byte-identical to the pre-T2 golden |
| R9 | `orderOf` reads it back and degrades to `undefined` for an old instance | `orderOf reads the order back and returns undefined for an old instance` | a seeded payload with `order` returns it; a payload without it returns `undefined` and does not throw |
| R10 | Recording the order changes no score | `the order alone changes no verdict` | the same fixture submits with and without an order → byte-identical `quality.verdict` payload |
| R11 | The alignment gate is untouched | `the alignment gate refuses exactly as before` | a misaligned order still throws `ALIGNMENT_REJECTED` with the same detail keys and writes nothing |

**Exit check for T2:** `tsc` clean; 347 + 5 = 352 green; no event type added; `praxis.store/v2` unchanged.

---

## 3. T3 — the composed scorer

### 3.1 The scoring plan (what the adapter builds, per submission)

```text
read:   order (from the instance record)
        task.goal / rationale / scope
        requires[] -> section id -> {goal, rationale}
        rubric dimension -> probe -> sections?

ask:    ONE evaluate per submission — exactly today's shape:
          state = { goal: composeGoal(order, task),
                    artifact: the WHOLE artifact,
                    subjectDigest }
          questions[<dim>.<probe>]     = { type, criteria?, instructions: composeQuestion(section, probe) }
          questions[<dim>.__statement] = { type: "noul", instructions: JUDGE + statement }   // verbatim

note:   the section tag lives in the QUESTION text, per question; the subject is never sliced.
        jev honours a per-question instruction, so one request carries differently scoped questions.
```

**`composeGoal(order, task)`** — one string, shared by every question:

```text
<order>                                       // only when an order exists

Task: <task.goal>
Why: <task.rationale>                          // when present
Scope: <task.scope>                            // when present
```

**`composeQuestion(section, probe)`** — per criterion, only when the probe is targeted:

```text
Judge ONLY the <ids joined by +> section(s) (<section.goal>[. Why: <section.rationale>]).
Criterion: <probe.instructions>
```

Untargeted probe → `probe.instructions` **verbatim** (today's text). Witness → `JUDGE + statement`
**verbatim** (`jev-scorer.ts:31`). Bounded: the prefix adds at most ~1.4 KB per targeted question, so a
48-criterion rubric stays well inside pi-jev's 262 144-byte request cap (the existing guards stay).

The section goals and rationales come from `context.sections` — an INPUT to `score()`, never `state` — so
`state` keeps exactly its three keys and an untargeted, order-less call serialises byte-identically to today.

### 3.2 Ordered edits

1. `src/quality/evaluate.ts:27-40` — `Scorer.score` input gains
   `context?: { order?: string; task?: { rationale?: string; scope?: string };
   sections?: readonly { id: string; goal?: string; rationale?: string }[] }`. `goal` stays required, so every
   existing caller compiles unchanged.
2. `src/quality/evaluate.ts:226-247` — `advanceEvaluated` reads the order (see T2's `orderFor`) and passes
   `context` built from the pinned task's `rationale`/`scope` and its `requires` (normalized to an array).
   No other line of `advanceEvaluated` changes.
3. `src/quality/evaluate.ts:155-172` — the score-cache (`cachedVerdict`) additionally keys on the anchor:
   `cacheKey = digestOf({ ruler: rulerDigest(ruler, bars), anchor: orderDigest ?? null })`, so a resubmit under a
   different order cannot reuse a verdict judged against another one. `rulerDigest` itself is untouched.
4. `src/quality/jev-scorer.ts:69-78` — beside `questionOf`, add `composeQuestion(sectionIntent, probe)` and
   `composeGoal(order, task)`; keep both pure and bounded (goal 1000 + scope 1000 + goal 1000, clipped).
5. `src/quality/jev-scorer.ts:206-224` — keep the ONE request. Extend the question builder only: a probe with
   `sections` uses `composeQuestion(sectionIntent, probe)` (its section intents resolved from `context.sections`),
   a probe without uses `questionOf(probe)` verbatim, and every witness keeps `JUDGE + statement` verbatim.
   `state` becomes `{ goal: composeGoal(context.order, context.task), artifact, subjectDigest }` — three keys,
   unchanged, with only the composed `goal` differing when an order or intent exists.
6. `src/quality/jev-scorer.ts:226-274` — the per-dimension composition is untouched (`readAnswer`,
   `satisfactionOf`, `bound`, `statementScore`, `rationaleFrom`); each criterion answer additionally records its
   `sections`, and the verdict records `anchored: context?.order !== undefined`. A throw propagates (fail-closed,
   unchanged); a missing answer throws (`readAnswer`, unchanged).
7. `src/types/schema.ts:154-...` — `QualityVerdictSchema` gains `anchored: z.boolean().optional()` and each
   `diagnosis[]` entry gains `sections: z.array(SectionNameSchema).min(1).max(6).optional()`.
8. `src/runner/engine/quality-loop.ts:32-64` — `qualityHistory` copies `anchored` and the diagnosis `sections`
   (the F7 pattern: a field not copied here vanishes on re-read for the brief, the refusal and the cache).
9. `tests/quality/composed-scorer.test.ts`, `tests/quality/composed-request-golden.test.ts`,
   `tests/quality/fixtures/scoring-request.v5.json` — the nine R12–R20 tests below; the golden fixture is
   captured from the pre-T3 code with research v5, no order, no targeting.

### 3.3 Write boundary (T3 owns)

`src/quality/jev-scorer.ts` · `src/quality/evaluate.ts` · `src/types/schema.ts` (`QualityVerdictSchema` only,
line 154+) · `src/runner/engine/quality-loop.ts` (`qualityHistory` only) · the three test files + fixture.
**T3 does not touch** `src/pi/descriptor.ts`, `src/types/pi.ts`, `src/runner/engine/{types,start,support}.ts`,
`src/pi/operations.ts`, or any bar/gate file.

### 3.4 Requirements and tests

| R | Requirement | Test (named) | Oracle |
|---|---|---|---|
| R12 | The composed goal carries the order, then the task goal, rationale and scope | `the composed goal carries the order, the rationale and the scope` | a fake `evaluateFn` captures `state.goal`: it starts with the order text and contains `Task:`, `Why:`, `Scope:` when those fields exist |
| R13 | A targeted criterion's QUESTION names only its sections | `a targeted criterion's question names only its sections` | the captured instruction for a probe with `sections: ["findings","sources"]` names `findings` and `sources` and no other section id, and carries the section goal (and its rationale when declared) |
| R14′ | ONE request per submission; every targeted question names its section ids | `one request per submission, every targeted question names its sections` | the fake `evaluateFn` is called **exactly once**; a targeted question's instruction contains its section ids; an untargeted question's instruction is byte-identical to today; `state` has exactly `{goal, artifact, subjectDigest}` |
| R15 | The witness is asked once per composed dimension, in the same request, and never gates | `the witness is asked once per composed dimension` | exactly one `<dim>.__statement` question per composed dimension; `statementScore` recorded; altering it changes no decision |
| R16 | A failing request degrades the verdict, never fabricates | `a failing request degrades the verdict, never fabricates` | `evaluateFn` throws → the verdict is `source: error` (existing fail-closed path); no dimension score is invented |
| R17 | The verdict records the plan and the anchor | `the verdict records the plan and the anchor` | `anchored: true` with an order; each targeted criterion's `diagnosis` entry carries its `sections` |
| R18 | The score-cache cannot reuse a verdict judged against another order | `the score-cache is keyed by the anchor` | same artifact + same ruler + two different orders → two scorer calls (cache miss), not one |
| R19 | No order, no targeting → the request and verdict are exactly today's | `v5 without order or sections sends the byte-identical request` | the captured request JSON equals `fixtures/scoring-request.v5.json` byte for byte |
| R20 | `op=check` still writes nothing and scores nothing | `op=check writes nothing and scores nothing` | store digest + row counts unchanged across a check; zero `evaluateFn` calls |

**Exit check for T3:** `tsc` clean; 352 + 9 = 361 green; research v5's request provably unchanged (R19);
no bar, gate or result file touched.

---

## 4. Shared files, write boundary and merge order

| File | Steps that touch it | Strict order | How they must not collide |
|---|---|---|---|
| `src/types/schema.ts` | T1 (`RequirementSchema`, `TaskConfigSchema`), T3 (`QualityVerdictSchema`) | **T1 → T3** | disjoint regions; T3 only appends verdict fields |
| `src/types/quality.ts` | T1 only | T1 | `ProbeSchema` only |
| `src/types/pi.ts` | T1 only | T1 | the brief criterion schema only |
| `src/pi/descriptor.ts` | T1 only | T1 | `criterionBrief` only |
| `src/runner/engine/types.ts`, `start.ts`, `support.ts`, `src/pi/operations.ts` | T2 only | T2 | the start path only |
| `src/quality/evaluate.ts`, `jev-scorer.ts` | T3 only | T3 | the scorer path only |
| `src/runner/engine/quality-loop.ts` | T3 only | T3 | `qualityHistory` only |

One branch, one engineer, T1 → T2 → T3. No parallel pane on the same file, and no step reformats a file another
step owns.

---

## 5. Backward compatibility, stated explicitly

1. **A task with no intent and no targeting behaves exactly as today.** Every new field is optional; the
task's canonical bytes are unchanged when they are absent, so its publication digest and every pin still match.
2. **A probe with no `sections` judges the whole artifact, as now.** Its instruction is `probe.instructions`
verbatim and the shared `state` is `{ goal, artifact, subjectDigest }` — today's exact shape.
3. **No order falls back to `task.goal`.** `composeGoal` returns `task.goal` alone, so the state and therefore
the request are unchanged (R19 pins this against a captured golden).
4. **The 11 probe-less tasks are untouched**: a dimension with no criteria still asks the statement `noul`
(`jev-scorer.ts:214-217`), with the witness unchanged.
5. **Every existing test stays green with zero edits.** If a test must change, the change is out of scope and
the step is wrong — stop and report (WORKFLOW §9).
6. **A pre-T2 instance** has no `order` field: `orderOf` returns `undefined`, `anchored` is false (or absent)
and the scorer falls back to `task.goal`. No migration, no backfill.

---

## 6. Global acceptance

| # | Check | Proof |
|---|---|---|
| G1 | Typecheck clean | `./node_modules/.bin/tsc --noEmit` exits 0 |
| G2 | Full suite green | `node --test 'tests/**/*.test.ts'` — **never `bun test`** (no `node:sqlite`; it misreports). Baseline 341; after this unit **361** (T1 6 + T2 5 + T3 9, recounted after the T3 amendment) |
| G3 | Every requirement has a test | 20 named tests in §1.4, §2.4, §3.4 — one per R1–R20 |
| G4 | Additive-only | `praxis.task/v1` still valid (R6); `praxis.store/v2` untouched (`git diff src/store` empty); six-key `ResultSchema` untouched; no new `EVENT`, no new `Code`/`TAXONOMY_SIZE`, no new dependency |
| G5 | The untouched spine | `git diff --stat src/quality/bar.ts src/runner/step.ts src/quality/jev-align.ts` **empty**: the never-lower fold, `compoundDecision`, `gate()`, the Pareto cap, the tolerance band and the alignment decision are byte-identical |
| G6 | `op=check` | writes nothing, scores nothing, costs no attempt (R20) |
| G7 | No network in unit tests | every test injects `evaluateFn`; the suite runs with no `TYPESAFE_API_KEY` |
| G8 | File cap | every file under 600 lines (`schema.ts` 545 → ~557; `jev-scorer.ts` 274 → ~350) |

---

## 7. Commit structure

| Order | Commit | Contents |
|---|---|---|
| 1 | `feat(task): declare task, section and criterion intent` | T1: schema fields, cross-field validation, brief projection, 6 tests |
| 2 | `feat(engine): record the order on the instance` | T2: `StartOptions.order`, created payload, `orderOf`, 5 tests |
| 3 | `feat(quality): judge each criterion against the order and its sections` | T3: composed goal, grouped targeted requests, verdict fields, cache key, 9 tests + golden fixture |

- The **engineer** commits, under **their own git identity** (`git config user.name`/`user.email` for this
  repo; the tree currently carries a shared `tia-lab <tia@eki.studio>`).
- **No trailers of any kind** — no `Co-Authored-By`, no `Generated-By`, no assistant attribution in the subject
  or body.
- Each commit is self-contained: `tsc` clean, suite green, its own tests added. No WIP, no squash, no force-push.
- Nothing is pushed or deployed; the lead reviews the three commits as one change set.

---

## 8. Risks

| # | Risk | Consequence | Mitigation in this plan |
|---|---|---|---|
| K1 | **Shared `src/types/schema.ts`** (T1 requirements/task, T3 verdict) | a rebase drops a field or reformats a region | strict T1 → T3; disjoint line regions; T3 appends only |
| K2 | **The section tag is advisory** — it lives in the question text, so a judge that ignores it still sees the whole artifact | a targeted criterion is judged less sharply than intended, silently | the instruction is explicit (`Judge ONLY the … section(s)`), the tag is recorded on the verdict (`diagnosis[].sections`), and the anchor is recorded (`anchored`); R19 proves the untargeted path is byte-identical; T5 measures whether tagging moves scores |
| K3 | **Longer instructions per targeted question** | the question text grows by the section tag (≤ ~1.4 KB each) | still **ONE `evaluate` per submission, exactly today** — no added calls; the existing 128-question / 262 144-byte guards still bind; no cost or saving is claimed |
| K4 | **Order plumbing** | a jev call inside a write transaction would hold the store lock | `orderOf` is a pure read; `orderFor` opens and closes `withStore` **before** the scorer runs (`advanceEvaluated` shape already does this) |
| K5 | **Cache staleness across orders** | a resubmit under a new order reuses an old verdict | R18 keys the cache on the anchor digest; `rulerDigest` untouched |
| K6 | **`requestId` dedupe ignores the order** (`start.ts:33-45` compares flowDigest + actor) | a second start with the same requestId and a different order replays the first instance; the new order is silently ignored | unchanged behaviour, now *visible* on the record; flagged for the owner, not fixed here (a dedupe change is a contract change) |
| K7 | `anchored` / `sections` lost on re-read | the brief and the refusal lose the anchor | copied in `qualityHistory` in the same commit (R17), the F7 pattern |
| K8 | **Making targeting mandatory later** | would refuse all 12 task documents → `praxis.task/v2` + republishes | not in this unit; flagged for the owner (§9) |
| K9 | T4 data quality (research v6 authored badly) | targeting exists but the sections are vague | T4 is a separate unit with its own review; the anchor flag makes an untargeted task visible |

### 8.1 Anything that turns out breaking — flag, do not improvise

- If the owner wants **`probes[].sections` required** for any task with probes → that is `praxis.task/v2` and a
  six-task republish; **stop and ask**.
- If the owner wants the **order in a column** on `instance` → that is a store migration (gate #6); **stop and
  ask**.
- If a test must be **edited** to pass, the step broke compatibility; **stop and report** (WORKFLOW §9).

---

## 9. LOC budget and out of scope

Estimated: `types/schema.ts` +12, `types/quality.ts` +3, `types/pi.ts` +1, `pi/descriptor.ts` +2,
`engine/types.ts` +1, `engine/start.ts` +3, `engine/support.ts` +12, `engine/quality-loop.ts` +4,
`pi/operations.ts` +1, `quality/evaluate.ts` +25, `quality/jev-scorer.ts` +90/−10 → **~+150 / −10 source
lines**, plus **~480 test lines** across three files and one golden fixture.

**Out of scope (later units):** authoring research v6 (T4); re-measuring and re-deriving the floor (T5); the
grader maths — choice credit, mean within a dimension, floor rescale, no-progress on the dimension vector,
criterion-level recall/notes, the trimmed-mean ratchet (T6, recorded in `plan-grader-slices.md`); the teaching
metrics (T7). No bar is lowered and the never-lower invariant is not touched anywhere in this unit.
