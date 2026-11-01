# Plan — one coherent build of the six task-loop slices

Task: task-self-improvement · Hash: 17499670 · Gate: G3 · Status: draft — lead review before G4 · Date: 2026-10-31
Predecessors: `research.md`, `spec.md` (same folder). Design/planning only: **no code, no edit under `src/`,
`tests/` or `.pi/`**. The owner greenlit all six slices together and accepted the bar re-warming; the lead
reviews after implementation.

## 1. Pre-flight — is S0 shipped?

**Verdict: YES. S0 is in pi-jev v0.2.3 and Praxis already pins it. No blocker.**

| Claim | Evidence | Label |
| --- | --- | --- |
| Praxis pins `v0.2.3` | `package.json:28` — `pi-jev: github:tia-lab/pi-jev#v0.2.3`; `bun.lock:7` | executed (read) |
| Installed package is 0.2.3 | `node_modules/pi-jev/package.json` — `version: 0.2.3` | executed (read) |
| Choice mass is carried, keyed by criterion name | `node_modules/pi-jev/dist/src/types.d.ts:29-34` — `probabilities?: Record<string, number>`; `dist/src/client.js:61-72` | executed (read) |
| Score mass is carried in level order | `types.d.ts:36-41` — `probabilities?: number[]`; `client.js:74-92` normalizes an array or a level-numbered object to an array | executed (read) |
| Malformed mass is REJECTED, never dropped | `client.js:61-72` (unknown key, non-probability) and `:74-92` (wrong length) throw | executed (read) |
| `noul` unchanged | `types.d.ts:21-27` — `{ type, noul }` only | executed (read) |

### 1.1 Two gaps found in pre-flight (neither blocks)

1. **Sum-to-1 is not enforced by the client.** `parseChoiceProbabilities`/`parseScoreProbabilities` validate
key membership, the `[0,1]` range and the score length, but never the sum (`client.js:61-92`). Our spec R1
assumed a tolerance-enforcing client. **Resolution, Praxis side, in S2:** a mass map whose sum lies outside
`[0.99, 1.01]` is treated as ABSENT (the criterion records no `pClean`/`spread`, and it is not `torn` on
mass); nothing is normalized by guesswork. Recorded as a note for the pi-jev engineer (wB:p21) — tightening
it upstream later needs no Praxis change.
2. **The 0.2.3 `EntryType` widening broke the typecheck in one existing test.** `./node_modules/.bin/tsc
--noEmit` reports exactly 2 errors, both `tests/quality/jev-scorer.test.ts:62`: `instructions` is now
`EntryType` (possibly null), so `.includes(...)` no longer typechecks. Zero `src/` errors. This is S0 fallout,
not a design issue: a test-only narrowing in P1 repairs it.

### 1.2 The baseline the build starts from (measured, not assumed)

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `./node_modules/.bin/tsc --noEmit` | **RED — 2 errors**, both the test above |
| Suite | `node --test 'tests/**/*.test.ts'` (the `package.json` `test` script) | **GREEN — 301/301**, ~3.6s |
| Suite under bun | `bun test` | **NOT VALID** — Bun has no `node:sqlite`, so 42 tests fail/error. Use the Node runner; the bun result is a runner mismatch, not a repo defect. |

### 1.3 What S0 means for the plan

S0 R1-R5 become **assertions on the Praxis side** (P1 commit): a test file proving the vendored types and the
client validation behave as the design assumes, and that Praxis reads the map as shipped. **No Praxis runtime
change** is authorised or needed by S0. `noul` stays a single probability: S2 records its value band, S3
measures it by repeat-N, S5 does not use mass, S6 never presents a `noul` as a distribution.

## 2. Prerequisite commits (before any slice)

| Commit | Change | Why it must land first |
| --- | --- | --- |
| **P1** `test(quality): assert the pi-jev v0.2.3 distribution contract` | New `tests/quality/jev-distribution.test.ts` (5 cases, the S0 assertions R1-R5) + a 2-line narrowing at `tests/quality/jev-scorer.test.ts:62` (read `instructions` through a small `textOf(instruction)` helper in the test). No `src/` change. | Restores the typecheck baseline and pins the enabler contract the slices rely on. |
| **P2** `refactor(types): move the quality rubric schemas into types/quality.ts` | Move `src/types/schema.ts:148-256` (probe, constants, dimension, quality) into a new `src/types/quality.ts`; `schema.ts` imports it for `TaskConfigSchema` and RE-EXPORTS the same names, so every importer is unchanged. **Pure move, no rewrite.** `QualityVerdictSchema` (schema.ts:259-295) stays. | `src/types/schema.ts` is **609 lines today, already over the 600 cap**; S1/S2/S6 add ~25 more. After the move it is ~500. |

Both are behaviour-free: `tsc` clean, 301/301, no test import changes.

## 3. Ordered build

Dependency order (spec §1, §12): **S1 first** (it alone re-keys identity and re-warms bars); then **S2, S3, S4,
S5** (mutually independent); **S6 after S2**; **the optional #3 last and skippable**. Every commit leaves the
tree green: `tsc` clean, the whole suite green, its own R-tests added.

One branch, one engineer, strictly in this order. No parallel pane works the same file (AGENTS.md §4); the
collision table in §4 is the merge order.

### 3.1 S1 — criteria-composed scorer (spec §4, R6-R14)

**Intent.** One rubric, one request: compose each dimension from its declared criteria; record the binding
criterion, keep the statement as a witness; render the why from the same answers; retire the second call.

**Ordered edits.**

1. `src/quality/jev-scorer.ts:39-72` — replace the request builder: one `noul` per criterion
   (`<dim>.<criterion>`) plus one witness (`<dim>.__statement`), ONE `evaluate`; remove the `explain:` wiring
   at `:65`. Compose each dimension from the answers (nested MIN, spec D4) and return
   `{score, bound, statementScore, rationale}` per dimension.
2. `src/quality/jev-scorer.ts:145-216,218` — delete `jevBattery` and `isRecordWith`; keep the strict answer
   reading, moved into the composition reader. Keep `isClean` (`:92`) and `clauseOf` (`:104`) for the renderer.
3. `src/quality/jev-scorer.ts:75-81` — keep `RATIONALE_MAX`, `RATIONALE_MAX_CLAUSES`, `RATIONALE_DIVERGENCE`
   (R9's bounds); only their consumer changes.
4. `src/quality/evaluate.ts:15-21,27-47` — delete `ExplainedDimension` and the optional `explain` port; widen
   `Scorer.score` input to carry `probes?`.
5. `src/quality/evaluate.ts:58-70` — delete `explainQuietly`.
6. `src/quality/evaluate.ts:49-51` — add `COMPOSE_FORMULA_ID = praxis.compose/min/v1` to `rulerDigest`.
7. `src/quality/evaluate.ts:81-118` — take the composed dimensions, clamp, MIN, compound decision (unchanged),
   attach `bound`/`statementScore`/`divergence`, render the rationale. Decision logic byte-identical.
8. `src/types/schema.ts:259-295` — `QualityVerdictSchema.dimensions[]` gains additive-optional `bound`,
   `statementScore`, `divergence` (`DIVERGENCE_MIN = 0.20` lives beside the scorer).
9. `src/quality/bar.ts:117-126` — `dimensionKey` = digest of `(id, criteria)` when a dimension has criteria,
   `(id, statement)` when it does not; `compositionKey` keeps covering every dimension key.
10. `src/runner/engine/quality-loop.ts:32-64` — copy the three new fields in `qualityHistory` (F7: a missed copy
    silently erases them on re-read).
11. `src/pi/descriptor.ts:45-49` — `JUDGING_STANCE` describes composition; `:184-190` — the brief's dimension
    projection carries `criteria` (id, type, instructions, clean option or levels) and the aggregation rule;
    `src/types/pi.ts:93` — the additive-optional field on `StepDescriptorSchema`.
12. Re-pin the tests whose fixtures assume statement scoring: `tests/quality/jev-scorer.test.ts`,
    `tests/quality/verdict-rationale.test.ts`, `tests/quality/bar.test.ts` (identity keys shift).

**Write boundary (S1 owns these regions):** `src/quality/jev-scorer.ts`, `src/quality/evaluate.ts`,
`src/quality/bar.ts` (identity block only), `src/runner/engine/quality-loop.ts` (`qualityHistory` only),
`src/pi/descriptor.ts`, `src/types/pi.ts` (brief), `src/types/schema.ts` (verdict), the tests above.
**Exit:** `tsc` clean; suite green; a composed task's verdict carries `bound`; a no-criteria task's verdict is
byte-identical to today.

### 3.2 S2 — uncertainty signal (spec §5, R15-R19)

**Intent.** Record what jev actually reports about its own certainty: a `choice`/`score` distribution's spread,
and a `noul`'s value band. Nothing gates on it.

**Ordered edits.**

1. `src/quality/jev-scorer.ts:39-72` — carry each answer's `probabilities`/`confidence` into the per-criterion
   result; apply the §1.1 sum rule (a map summing outside `[0.99, 1.01]` is treated as absent).
2. `src/quality/evaluate.ts:81-118` — compute `pClean` (choice), `pTop`, `spread = 1 − max(p)` and `torn` per
   criterion (spec R17); attach to `diagnosis[]`. The score is untouched (spec R18).
3. `src/types/schema.ts:273-283` — `diagnosis[]` entries gain additive-optional `confidence`, `pClean`, `pTop`,
   `spread`; the verdict gains `torn: string[]`.
4. `src/runner/engine/quality-loop.ts:32-64` — copy `torn` and the diagnosis fields.
5. `src/pi/descriptor.ts:51-140` — `NoteJudgment.dimensions[]` carries `torn` and its uncertainty (additive).

**Exit:** the same artifact scores identically with and without distributions; a torn criterion is recorded and
nothing refuses.

### 3.3 S3 — stability before a ratchet (spec §6, R20-R24)

**Intent.** No bar rises on a rubric identity nobody has sampled. Sampling is bounded, recorded, and runs
outside every transaction.

**Ordered edits.**

1. New `src/quality/sample.ts` (~90 lines) — `sampleRubric({ evaluateFn, task, key, artifactDigest, artifact,
   repeats: 3 })`: builds the SAME composed request, runs R=3, returns per-criterion agreement (choice key
   frequency; `noul`/`score` range). Pure over the injected call.
2. `src/types/learning.ts:84-110` — `BarRaisedSchema` gains additive-optional `stability`; a new
   `RubricSampledSchema` (~25 lines) beside it.
3. `src/runner/engine/types.ts:6-21` — `EVENT.rubricSampled`, `EVENT.barHeld`; the sample constants
   (`SAMPLE_REPEATS`, the stability bounds) beside the existing quality defaults (`:23-52`).
4. `src/quality/bar.ts:420-450` — read `rubric.sampled` for the scope key: no stable sample → append `bar.held`
   and return held BEFORE `decideRaise`; a stable sample → include `stability` on the raise. `emaOf`,
   `decideRaise` and `BAR_FORMULA_ID` stay BYTE-IDENTICAL (global acceptance item G5).
5. `src/pi/operations.ts:352-400` — after `advanceEvaluated`, if any decision is held for an unsampled
   identity, run `sampleRubric` outside the transaction and append `rubric.sampled` (the `advanceEvaluated`
   pattern). Thin: the logic lives in `sample.ts`.
6. `tests/quality/bar.test.ts` — a fixture helper that seeds a stable sample for the identities a raise test
   uses; new hold tests prove the old behaviour is intact when a sample exists.

**Exit:** a due raise without a sample holds and the step still accepts; with a stable sample the raise lands
with its `stability`; a CLI-only run raises nothing and still completes.

### 3.4 S4 — screen recalled exemplars (spec §7, R25-R28)

**Intent.** No unjudged agent-authored text reaches the brief; an unscreenable case keeps its structure and
loses its free text.

**Ordered edits.**

1. New `src/quality/screen.ts` (~80 lines) — `screenCases({ evaluateFn, cases })`: ONE batched call, two
   `noul`s per case (`instructs-the-reader`, `outside-the-ceiling`); returns per-case probabilities.
2. `src/quality/ranker-jev.ts:256-350` — on a cache miss, screen the chosen set and persist the outcome in the
   `recall.ranked` entry (a second, tiny call; the rank call is unchanged here).
3. `src/types/learning.ts:153-192` — `RecallRankedSchema.chosen[]` gains additive-optional `screen`;
   `RecallNoteSchema` (`:130`) gains `screened`, and the served copy may blank the free text.
4. `src/quality/recall.ts:286-325` — carry the screen into the served set; withhold free text for a failed or
   unscreened case with a code-owned line.
5. `src/quality/recall.ts` / `src/quality/ranker.ts:281-330` — the deterministic fallback path marks
   `screened: false` and applies the same withholding.
6. `src/pi/descriptor.ts` (recall block) + `src/pi/operations.ts:400-436` — disclose per case in the brief and
   in the refusal handback.

**Exit:** a lesson that tries to instruct fails the screen and its text never appears in any envelope; with the
judge down, cases return with tags, provenance and no free text.

### 3.5 S5 — three-`noul` explained rerank (spec §8, R29-R32)

**Intent.** The recall ordering explains itself: three `noul`s per candidate, combined by frozen constants.

**Ordered edits.**

1. `src/quality/ranker-jev.ts:47-52` — the three authored `DISTINCT_CRITERIA` become three `noul` question
   texts; three `WEIGHT_*` constants (sum 1) go beside them.
2. `src/quality/ranker-jev.ts:83-148` — three questions per pooled candidate (`c<i>.<criterion>`), ordering by
   the weighted sum, ties by the existing deterministic score then id; the Jaccard collapse is unchanged.
3. `src/types/learning.ts:153-192` — `chosen[]` gains additive-optional `nouls` and `total`.
4. `src/quality/ranker.ts:281-330` — the `op=recall` payload carries the trio and the total.
5. Re-pin `tests/quality/jev-ranker.test.ts` (request shape) and `tests/quality/ranker.test.ts` if its fake
   answer shape assumed one score per candidate.

**Exit:** the request has 3 `noul`s per pooled candidate (≤60 questions at the 20-candidate pool); a candidate
strong on distinctness and weak on usefulness reports exactly that split; no mass is claimed for a `noul`.

### 3.6 S6 — provisional verdict (spec §9, R33-R36)

**Intent.** A verdict whose deciding criterion was torn says so, with the signal named — and still decides
exactly as before.

**Ordered edits.**

1. `src/quality/evaluate.ts:81-118` — derive `provisional` and `provisionalOn` from the DECIDING criteria's torn
   state (S2's data); never feed it to the decision.
2. `src/types/schema.ts:259-295` — the verdict gains additive-optional `provisional`, `provisionalOn`.
3. `src/runner/engine/types.ts:23-52` — `TORN_SPREAD` and the `noul` band as code constants.
4. `src/runner/engine/quality-loop.ts:32-64` — copy the two fields.
5. `src/pi/descriptor.ts:80-140` and `src/pi/operations.ts:242-330` — report it in the brief judgment and the
   refusal detail; no new Code, no new envelope.

**Exit:** identical accept/refuse with and without `provisional`; the reason names `mass`, `confidence` or
`noul-band`; a `noul` value is never presented as a distribution.

### 3.7 Optional O1 — confidence-gated alignment (spec §10, R37-R38), skippable

**Edits:** `src/quality/jev-align.ts:56-114` (read the choice distribution), `src/pi/operations.ts:174-214`
(carry the flag), `src/types/pi.ts:203` (the additive-optional flag on the start envelope).
**Exit:** 0.95 starts clean, 0.62 starts with the flag, 0.2 and every misaligned label are refused exactly as
today. Ships only if the lead wants it; nothing else depends on it.

## 4. Shared files, write boundaries and merge order

| File | Slices that touch it | Merge order (strict) | How they must not collide |
| --- | --- | --- | --- |
| `src/types/schema.ts` | P2, S1, S2, S6 | P2 → S1 → S2 → S6 | P2 moves the rubric block out; S1/S2/S6 only ADD fields to `QualityVerdictSchema` — no reordering, no reformatting |
| `src/types/quality.ts` (new) | P2 | P2 only | Closed after P2; no slice edits it |
| `src/types/learning.ts` | S3, S4, S5 | S3 → S4 → S5 | Distinct schemas: S3 `RubricSampled` + `BarRaised.stability`; S4 `RecallRanked.chosen.screen` + `RecallNote.screened`; S5 `chosen.nouls/total` |
| `src/types/pi.ts` | S1, S6, O1 | S1 → S6 → O1 | S1 the brief criteria; S6 the judgment provisional; O1 the start flag |
| `src/quality/jev-scorer.ts` | S1, S2 | S1 → S2 | S1 rewrites the request and the composition; S2 only threads the distribution through the criterion result |
| `src/quality/evaluate.ts` | S1, S2, S6 | S1 → S2 → S6 | One function region (`evaluateArtifact`); each slice appends its own fields, none rewrites the decision |
| `src/quality/bar.ts` | S1, S3 | S1 → S3 | S1 the identity helpers only; S3 the hold in `recomputeBar`; `emaOf`/`decideRaise` untouchable |
| `src/runner/engine/quality-loop.ts` | S1, S2, S6 | S1 → S2 → S6 | `qualityHistory` only — one added field list per slice, appended |
| `src/runner/engine/types.ts` | S3, S6 | S3 → S6 | S3 the event names and sample constants; S6 the thresholds |
| `src/quality/ranker-jev.ts` | S4, S5 | S4 → S5 | S4 adds the screen call after the chosen set; S5 changes the question shape before it |
| `src/quality/ranker.ts` | S4, S5 | S4 → S5 | S4 the screen disclosure; S5 the trio disclosure |
| `src/quality/recall.ts` | S4 | S4 only | Withholding lives here; S5 does not touch it |
| `src/pi/descriptor.ts` | S1, S2, S4, S6 | S1 → S2 → S4 → S6 | Different sub-objects: brief dimensions, judgment uncertainty, recall disclosure, judgment provisional |
| `src/pi/operations.ts` | S3, S4, S6, O1 | S3 → S4 → S6 → O1 | S3 the sample call in submit; S4 the handback disclosure; S6 the failure wording; O1 the start flag |
| `src/quality/sample.ts`, `src/quality/screen.ts` (new) | S3, S4 | one owner each | New files, never shared |

**Rule.** Slices are developed sequentially on one branch by one engineer; each commit rebases onto the
previous. No two panes edit the same file, and no slice reformats a file another slice owns.

## 5. Checks — one test per requirement, with its oracle

Every row is a named test. New files are created in the slice named; existing files are re-pinned in S1 or as
noted. The oracle is the observable the test asserts, taken from the spec.

**S0 assertions (P1 commit) — `tests/quality/jev-distribution.test.ts`**

| R | Test name | Oracle |
| --- | --- | --- |
| R1 | `S0-R1 choice mass is keyed by option keys and score mass is in level order` | a fixture with both shapes parses; a wrong key or wrong length throws |
| R2 | `S0-R2 malformed mass is rejected, never dropped` | unknown key, non-probability and wrong length all throw |
| R3 | `S0-R3 a noul answer carries no mass and no confidence` | the parsed answer holds `{type, noul}` only |
| R4 | `S0-R4 a response without mass behaves exactly as today` | existing fixtures parse; the scorer path is unchanged |
| R5 | `S0-R5 Praxis reads the map as shipped` | the adapter passes `probabilities` through untouched |

**S1 — `compose.test.ts`, `compose-rationale.test.ts`, `compose-request.test.ts`, `compose-ruler.test.ts`, `compose-identity.test.ts`, `compose-roundtrip.test.ts`, `tests/pi/brief-criteria.test.ts`**

| R | Test name | Oracle |
| --- | --- | --- |
| R6 | `composes a dimension as the minimum of its criteria` | `noul .9`, `score 1.0` on 2 levels, `choice clean` → 0.9; score at level 0 → 0; a no-criteria dimension scores as today |
| R7 | `the witness is recorded and never changes a decision` | `statementScore` present; changing it alone changes no decision, bar or flagged set; `divergence` appears at 0.20 |
| R8 | `bound names the criterion that produced the minimum` | `n1 1.0, s1 1.0, c1 non-clean` → `bound: c1` |
| R9 | `renders the binding criterion first within the bounds` | at most 3 clauses and 240 chars; the divergence line when clean but below |
| R10 | `one evaluate per submission carrying every criterion id` | fake call count is 1; the request holds all criterion ids and every witness id |
| R11 | `a formula change is a cache miss` | two evaluations with different `COMPOSE_FORMULA_ID` produce two scorer calls |
| R12 | `editing a criterion resets only that bar` | a new key for the edited dimension; rewording the statement alone keeps key and bar |
| R13 | `the brief lists every criterion and check writes nothing` | 19 criteria in the composed task brief; `op=check` leaves the store unchanged |
| R14 | `bound and statementScore survive qualityHistory` | record, re-read, and the brief judgment carries both |

**S2 — `tests/quality/uncertainty.test.ts`, `tests/quality/torn.test.ts`**

| R | Test name | Oracle |
| --- | --- | --- |
| R15 | `records pClean, pTop and spread per criterion` | `{clean .7, other .3}` → `pClean .7`, `spread .3` |
| R16 | `a noul records no mass and is torn inside its band` | 0.9 records no mass; 0.50 is torn |
| R17 | `torn when pClean is near the boundary or the spread is wide` | `{.52,.48}` torn; `{.95,.05}` not; `[.45,.30,.25]` torn |
| R18 | `mass never changes the score` | identical scores, means, decisions, flagged and bars with and without mass |
| R19 | `no schema knob can grade a choice criterion` | `QualityDimensionSchema` is strict: an unknown grading field is refused; the authoring rule is documentary |

**S3 — `tests/quality/stability-sample.test.ts`, `tests/quality/bar-hold.test.ts`**

| R | Test name | Oracle |
| --- | --- | --- |
| R20 | `samples once per task, key and version` | `rubric.sampled` written once; a second attempt performs no call |
| R21 | `agreement is per criterion, and repeat-N is the only noul signal` | `[.9,.9,.9]` stable; `[.9,.4,.7]` unstable; a 3/3 choice agreement stable |
| R22 | `a due raise without a sample is held and the step still accepts` | `bar.held` recorded; the artifact accepted; the bar unchanged |
| R23 | `a raise records its stability and old raises still fold` | `bar.raised.stability` present; a pre-S3 raise parses and folds |
| R24 | `no evaluate call happens inside withStore` | the fake records zero calls while a transaction is open; a CLI-only run raises nothing |

**S4 — `tests/quality/recall-screen.test.ts`, `tests/runner/recall-provenance.test.ts`**

| R | Test name | Oracle |
| --- | --- | --- |
| R25 | `screens the chosen cases in one batched call` | two `noul`s per case in one call; at or above 0.5 fails |
| R26 | `a failed case keeps structure, loses free text, and says so` | no withheld text in any envelope; tags and score intact; disclosure present |
| R27 | `unscreened means withheld` | judge down → `screened: false`, no free text, cases still returned |
| R28 | `a lesson is not recalled for a changed identity` | after a criteria edit the case disappears for that dimension and stays for an unchanged one |

**S5 — `tests/quality/rerank-nouls.test.ts`**

| R | Test name | Oracle |
| --- | --- | --- |
| R29 | `three nouls per pooled candidate` | 3 questions per candidate; at most 60 at the 20-candidate pool |
| R30 | `the order is the weighted sum of frozen constants` | reordering the input changes no score; ties are deterministic; the weights are constants |
| R31 | `each chosen case reports its trio and total` | `distinct .9, useful .3, readable .8` reported; no mass claimed |
| R32 | `the Jaccard collapse and the token budget still hold` | near-duplicates yield one exemplar; the payload stays bounded |

**S6 — `tests/quality/provisional.test.ts`**

| R | Test name | Oracle |
| --- | --- | --- |
| R33 | `provisional when a deciding criterion was torn` | a torn binding criterion → `provisional`; a clean one → absent |
| R34 | `the reason names its signal` | a `noul` band reports `noul-band`; a `choice` at `{.52,.48}` reports `mass` |
| R35 | `provisional never changes a decision` | identical accept/refuse and identical bar with and without it |
| R36 | `the thresholds are code constants, not task fields` | the constants appear once; no schema field reads them |

**Optional — `tests/pi/align-confidence.test.ts`**

| R | Test name | Oracle |
| --- | --- | --- |
| R37 | `a soft aligned answer starts with a flag` | 0.95 clean; 0.62 flagged; 0.2 refused |
| R38 | `a misaligned answer is refused exactly as before` | the existing code is returned |

Total: 38 new cases (S0 5, S1 9, S2 5, S3 5, S4 4, S5 4, S6 4, optional 2), one per requirement, on top of
the 301 existing tests.

## 6. Global acceptance (every commit, and the build as a whole)

| # | Check | How it is proved |
| --- | --- | --- |
| G1 | Typecheck clean | `./node_modules/.bin/tsc --noEmit` exits 0. The baseline is RED today (2 test errors); **P1 must make it green before S1 starts.** |
| G2 | Full suite green | `node --test 'tests/**/*.test.ts'` — the `package.json` script. **Never `bun test`** (no `node:sqlite`; it misreports). Baseline 301; the build ends at 301 + 38 = 339 cases, all passing. |
| G3 | Every R-oracle covered | The 38 cases in §5 exist by name, one per requirement R1-R38, and each asserts the oracle column. |
| G4 | Additive only | `STORE_SCHEMA` stays `praxis.store/v2` (no DDL, no migration); `package.json` dependencies unchanged (`pi-jev` already at v0.2.3); the six-key `ResultSchema` unchanged; `CODES`/`TAXONOMY_SIZE` unchanged (31, no new error code); exactly TWO new event names (`rubric.sampled`, `bar.held`) and no other. |
| G5 | The ratchet is byte-identical | `diff` of `src/quality/bar.ts` shows only the hold branch and the `stability` field: `BAR_FORMULA_ID` (`:38`), `emaOf` (`:303-313`) and `decideRaise` (`:420` onward) have zero changed lines. |
| G6 | `op=check` untouched | Its test asserts the store bytes, five row counts, the absence of any event and the unchanged attempt history across a check; no slice edits the check handler (`src/pi/operations.ts:474-491`). |
| G7 | Six-key result untouched | `grep` for `ResultSchema` changes is empty; the Pi envelopes gain only additive-optional fields inside `step.brief` / `step.result.artifacts`. |
| G8 | File cap | Every file under 600 lines. `schema.ts` is fixed by P2; `operations.ts` (561 today) is watched (see §8). |
| G9 | No network in unit tests | Every new test injects `evaluateFn`; the suite runs with no `TYPESAFE_API_KEY` and no fetch. |
| G10 | Task data untouched | `.pi/praxis/**` byte-identical (`git diff --stat .pi` empty). Slices change code, never a rubric. |

## 7. Commit structure

One conventional commit per slice, in dependency order, by the **engineer** — the lead never commits.

| Order | Commit | Scope |
| --- | --- | --- |
| 1 | `test(quality): assert the pi-jev v0.2.3 distribution contract` | P1: the 5 S0 assertions + the test-only `EntryType` narrowing |
| 2 | `refactor(types): move the quality rubric schemas into types/quality.ts` | P2: pure move + re-export |
| 3 | `feat(quality): score a dimension from its own criteria` | S1, R6-R14: composition, witness, bound, one call, formula id, identity, brief |
| 4 | `feat(quality): record the judge's uncertainty per criterion` | S2, R15-R19: mass spread, noul band, torn set |
| 5 | `feat(quality): require a stable rubric sample before a bar raises` | S3, R20-R24: `rubric.sampled`, `bar.held`, boundary sampler |
| 6 | `feat(quality): screen recalled exemplars before they reach the agent` | S4, R25-R28: screen, withhold, disclose, provenance |
| 7 | `feat(quality): explain the recall ordering with three nouls` | S5, R29-R32: three-noul rerank, frozen weights |
| 8 | `feat(quality): report a provisional verdict` | S6, R33-R36: provisional state, reason signal, constants |
| 9 (optional) | `feat(quality): gate alignment on the answer distribution` | O1, R37-R38 — skip if the lead defers it |

Rules for the commit itself:

- **Author the engineer's own git identity.** Set `user.name`/`user.email` for this repository to the engineer
  (the tree currently carries a shared `tia-lab <tia@eki.studio>`); do not commit as another person.
- **No trailers of any kind**: no `Co-Authored-By`, no `Generated-By`, no assistant attribution in the message
  body. The message is a conventional subject plus a short body naming the R ids and the exit check.
- Each commit is self-contained: `tsc` clean, suite green, its own tests added. No WIP commits, no squash
  afterwards, no force-push.
- Nothing is pushed or deployed by this unit; the lead reviews the eight or nine commits as one change set.

## 8. File cap, LOC budget, and where a split is needed

The lead asked about `engine.ts` and `step.ts`: **neither is near the cap.** `src/runner/engine/` is already
split (`index.ts` is 27 lines); `src/runner/step.ts` is 389. The files that actually need watching are
`src/types/schema.ts` (**609 today, already over the cap**) and `src/pi/operations.ts` (561).

| File | Now | After | Plan |
| --- | --- | --- | --- |
| `src/types/schema.ts` | 609 | ~525 | P2 moves 148-256 into `types/quality.ts`; S1/S2/S6 append verdict fields |
| `src/types/quality.ts` (new) | — | ~115 | closed after P2 |
| `src/pi/operations.ts` | 561 | ~600 | S3's sampler and S4's screen live in their own modules; if it still exceeds 600, extract the failure/refusal formatter (`:242-330`) into `src/pi/feedback.ts` as a MOVE in that slice's commit — named here so it is not an unplanned declaration |
| `src/quality/bar.ts` | 543 | ~575 | hold branch only |
| `src/quality/ranker-jev.ts` | 363 | ~435 | screen call (S4), noul trio (S5) |
| `src/quality/jev-scorer.ts` | 220 | ~190 | the battery is deleted, the composition replaces it |
| `src/quality/evaluate.ts` | 205 | ~265 | S2 uncertainty, S6 provisional |
| `src/quality/sample.ts`, `screen.ts` (new) | — | ~90, ~80 | one owner each |
| `src/pi/descriptor.ts` | 224 | ~260 | brief criteria, judgment uncertainty, recall disclosure, provisional |

Any further split is a MOVE, recorded as its own bullet in the slice it belongs to — never a rewrite, and never
to reach a number.

## 9. Risks

| # | Risk | Consequence | Mitigation (in the plan) |
| --- | --- | --- | --- |
| K1 | **Shared-file collisions** (`evaluate.ts`, `schema.ts`, `quality-loop.ts`, `descriptor.ts`, `operations.ts`, `ranker-jev.ts`, `ranker.ts`, `learning.ts`) | a rebase that silently drops a field, or two slices editing one function | The §4 merge order is strict; one branch, one engineer, no parallel panes; each commit adds only its own region; `qualityHistory` is re-checked in every slice that adds a verdict field (F7) |
| K2 | **The re-warm discontinuity (D18)** | every dimension identity changes in S1, so every bar resets to its seed and needs 10 observations before a raise; the score scale moves too | Declared and owner-accepted. The gate still caps at `paretoThreshold` 0.8, so good work is not refused while bars warm. **Measurement must use attempts and pass rate, never raw scores** (spec §15) |
| K3 | A lost field on re-read (the fixed list in `qualityHistory`) | the brief, the cache and the note gate silently lose `bound`/`torn`/`provisional` | R14 and R35 test the round trip; each slice appends its fields in the same commit |
| K4 | Calling jev inside `withStore` for the S3 sample | violates the no-external-call-in-a-transaction rule; a slow judge would hold the write lock | The hold exists for this: `recomputeBar` stays sync and only records `bar.held`; the sample runs at the boundary (R24) |
| K5 | A non-sampling caller (CLI) never raises a bar | bars freeze for CLI-only use | Accepted, fail-safe, and stated: no correctness loss, only a missed raise; the Pi path is the primary surface |
| K6 | S4 doubles the jev calls on a cold recall (rank then screen) | cost and latency on a cache miss only | Screens at most 5 cases in one call; the result is cached with the ranking; a judge failure withholds rather than retries |
| K7 | S5 request growth (3 questions per candidate) | a larger request; a pool of 20 gives 60 questions | Under the 128-question and byte caps; the pool constant already bounds it; a missing answer makes the stage unavailable and the deterministic fallback runs |
| K8 | S2 mass that does not sum to 1 | an over- or under-stated spread | Praxis-side sum guard `[0.99, 1.01]`, else mass treated as absent; noted for the pi-jev engineer |
| K9 | S6 shipped without S2 | provisional would have no evidence and would need a second rule | The dependency is hard: S6 lands after S2 or not at all |
| K10 | The optional #3 is pulled forward | it is the one slice that is not about a task artifact | It stays last and skippable; nothing depends on it |

### 9.1 What is still unconfirmed (O1-O9)

| O | State | Effect on the build |
| --- | --- | --- |
| O1 retire the explain pass | recommended, not yet answered | S1 cannot start without it; it is the slice core |
| O2 nested MIN + re-warm | **owner accepted** (all slices greenlit together, re-warm accepted) | confirmed |
| O3 torn and provisional non-gating | recommended | S2/S6 assume yes; a gating variant would be a new owner decision |
| O4 hold the raise | recommended | S3 assumes yes |
| O5 sample at the boundary | recommended | S3 assumes yes (it is also forced by K4) |
| O6 withhold unscreened text | recommended | S4 assumes yes |
| O7 the 11 criteria-less tasks keep statement scoring | recommended | no migration; research is the first composed task |
| O8 #3 optional, last | **confirmed** by the lead order for this gate | scheduled last |
| O9 S0 keying and tolerance | **keying CONFIRMED** by v0.2.3 (option keys, level-order array); **sum tolerance NOT enforced** | S2 carries the Praxis-side guard (K8); no blocker, upstream note only |

If O1, O3, O4, O5, O6 or O7 is answered differently, the affected slice is re-scoped BEFORE its commit — not
patched afterwards.

## 10. LOC budget and what this plan does not do

Estimated net source change: **~+520 / −140 lines** across 11 existing files plus 3 new modules
(`types/quality.ts`, `quality/sample.ts`, `quality/screen.ts`), and **~+700 test lines** across 16 files. No new
dependency, no new store, no DDL, no task-document edit.

Out of scope, unchanged from the spec: the future orchestration layer (#4, #5, #8, #10, §5 intent routing);
never-stored probability invention for a `noul`; automatic rubric rewriting; a background sampler (gate #7);
federated recall (Jung); any identity, isolation or exactly-once claim; any live-measurement claim — the
32-session re-test remains the first datapoint.
