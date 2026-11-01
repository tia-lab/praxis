# Spec — six ordered slices for a task that judges itself coherently

Task: task-self-improvement · Hash: 17499670 · Gate: G2 · Status: revised draft — lead review before G3 · Date: 2026-10-31
Predecessor: `docs/task-self-improvement-17499670/research.md`. Design only: no code, no dependency, no schema
change, no edit under `src/`, `tests/` or `.pi/`.

Slices: **0** enabler (pi-jev, owned, in progress), **1** criteria-composed scorer, **2** uncertainty signal,
**3** rubric stability before a ratchet, **4** injection screen on recalled exemplars, **5** three-`noul`
explained recall rerank, **6** provisional verdict, plus an **optional** confidence-gated alignment. Slice 1 is
the only one that changes what a score MEANS.

## 1. Outcome

A task judges its artifacts from **one** rubric. The criteria a task declares become the load-bearing definition:
the dimension score is composed from them by code-owned arithmetic, the criterion that decided is recorded, and
the rendered why comes from the same answers. The summary statement stays as a recorded witness, never a gate
input, so a statement that no longer matches its criteria becomes a measurable signal about the RUBRIC.

On top of that, in order: the uncertainty jev reports is recorded and used honestly (a `choice`/`score`
distribution's spread, and a `noul`'s single value — never invented mass); a bar may not ratchet on a rubric
identity nobody has sampled; recall never hands the agent free text it has not judged; the recall ordering
explains itself from three `noul`s instead of one opaque score; and a verdict whose deciding criterion was torn
says so instead of pretending to be certain.

Dependency graph (a slice may not start before its dependencies are accepted):

```text
S0 enabler (pi-jev mass) ──► S2 ──► S6
S1 composed scorer ────────► S2, S3, S4, S5, S6
optional (alignment) ──────► S0 only
```

What this spec does **not** claim: that any of it makes the task better. The measurement is defined (§15),
nothing is measured, and slice 1 changes the scale on which scores live.

## 2. Frozen decisions

- **D1 — The task is the atom.** A rubric is declared by the task document, versioned, published against
  `(path, version)` and immutable (`src/store/definitions.ts:140-160`; `src/types/schema.ts:299`). No flow may
define a task and no slice here moves a rubric into a flow.
- **D2 — A review binds a digest.** Any review step in any flow binds the digest of the artifact it judged
(`docs/task-flow-model-7b1ebe17/`; `src/runner/step.ts:274-360`). Nothing in this design relaxes it: the verdict
records `rubricDigest` and a lesson is scoped to the identity it was judged under (D15).
- **D3 — One load-bearing rubric.** A dimension that declares criteria is scored from them. Presence of criteria
is the declaration; there is no per-task switch. **EntryType is NOT needed**: composition is one `noul` per
criterion in ONE request plus code arithmetic (lead-accepted, gate jev-map).
- **D4 — Composition is code-owned arithmetic.** Per-criterion satisfaction: `noul` → its probability; `score` →
`position / (levels − 1)`; `choice` → `1` iff the answer is the declared clean option. A dimension's score is
the **minimum** over its criteria; the headline stays the **minimum** over dimensions
(`src/quality/evaluate.ts:100-103`). Nested MIN, no weights.
- **D5 — The statement witnesses; it does not gate.** The statement `noul` is asked in the same request, recorded
as `statementScore`, and `divergence` is recorded when it departs from the composed score. It never enters the
score, mean, compound decision, flagged set or bar.
- **D6 — The ruler carries the formula, and identity follows the criteria.** `COMPOSE_FORMULA_ID` is an input to
`rulerDigest` (`src/quality/evaluate.ts:49-51`); a dimension bar identity derives from its criteria when it is
composed and from its statement when it is not (`src/quality/bar.ts:117-119`).
- **D7 — The why is the deciding answers.** The rationale is rendered by code from the answers that produced the
score; the second, explain-only pass is retired. This SUPERSEDES `docs/verdict-rationale-ad85142e/spec.md` D2
and D3, keeping its recorded shape, its rendering bounds and its divergence wording (owner decision O1).
- **D8 — The worker sees what decides.** The step brief carries each dimension's criteria and the aggregation
rule beside the statement it summarises. Disclosure only: `op=check` still scores nothing and writes nothing.
- **D9 — Uncertainty is recorded, never invented.** A `choice`/`score` answer's distribution is read after S0:
its spread, P(clean) and P(top level). A **`noul` returns ONE probability — no distribution, no confidence** — so
its only uncertainty signal is the value's distance from 0.5. No mass is fabricated for a `noul`, ever.
- **D10 — Uncertainty never gates.** `torn` (S2) and `provisional` (S6) are reports: the same scores accept or
refuse identically with and without them. Turning either into a refusal is a later owner decision (O3).
- **D11 — A bar may not ratchet on an unsampled rubric identity.** The first raise of a scope under a new
identity requires a recorded stable sample. Otherwise the raise is HELD — never the step (O4).
- **D12 — Sampling runs outside every transaction.** The ratchet stays synchronous and transaction-local; the
sample is performed by the caller that can await (the `advanceEvaluated` pattern,
`src/quality/evaluate.ts:177-205`) and recorded as an event. A caller that never samples never raises: fail-safe.
- **D13 — repeat-N is the ONLY `noul`-instability signal.** A distribution's spread is uncertainty inside ONE
judgment; stability is agreement ACROSS judgments. For a `noul` there is no mass, so repeat-N is the only
instrument (owner-accepted).
- **D14 — Recall is screened; unscreened free text is withheld.** Lesson text is agent-authored. A case that
fails the screen, or that cannot be screened, keeps its structured record and loses its free text, disclosed per
case (O6).
- **D15 — A lesson belongs to the rubric it was judged under.** A case is not recalled for a dimension whose
current identity key differs from the one its verdict carried.
- **D16 — The recall rerank uses frozen constants.** The three `noul`s are combined by weights that live in code
and are never model-chosen, never task-authored, never tuned per call.
- **D17 — Additive, event-only.** Every new fact is an additive-optional payload field on an existing event or
envelope; no store DDL, no migration, no new store, no new dependency, no new result key, no new refusal code.
- **D18 — The discontinuity is declared.** S1 changes the score's meaning: every bar re-warms to its seed under
the new identity, and pre/post comparison must use attempts and pass rate, never raw scores.

## 3. Slice 0 — [enabler · pi-jev, owned] the answer distribution survives the client

**EXISTS:** the client rebuilds each answer from type-specific fields and drops the documented `probabilities`
(`node_modules/pi-jev/dist/src/client.js:69-101`; `types.d.ts:21-35`); the API documents the distribution
(`docs/jev-reference.md` §1). **PROPOSED:** preserve it for `choice`/`score` only. In progress in the pi-jev
repo (wB:p21).

**Change map (pi-jev, not this repo):** `src/types.ts` → `ChoiceAnswer`/`ScoreAnswer` gain `probabilities?`;
`src/client.ts` → `parseResponse` validates and carries it; the pi-jev test suite gains a distribution fixture
and a rejection case. Praxis side: the vendored `Answer` types only.

| Id | Requirement | Failure behaviour | Oracle |
| --- | --- | --- | --- |
| R1 | A `choice` answer carries `probabilities` keyed by the **option keys**, and a `score` answer one entry **per level in authored order**; each sums to 1 within a tolerance. | A distribution with a key outside the criteria set, a wrong length or a sum outside tolerance is REJECTED at the client boundary — never silently dropped. | Fixtures: `{clean: 0.7, other: 0.3}` accepted; `{clean: 0.7, bogus: 0.3}` and `[0.5]` on a 3-level score rejected. |
| R2 | A `noul` answer is unchanged: `{type, noul}` only. | — | A `noul` answer never carries a distribution or a confidence. |
| R3 | Backward compatible: an answer without `probabilities` parses and behaves exactly as today. | An older server response degrades to today behaviour, not an error. | The existing fixtures, unchanged, still pass. |
| R4 | No Praxis runtime behaviour changes from the enabler alone. | — | Praxis `tsc` clean, suite green, and no Praxis source line changes beyond the vendored types. |
| R5 | The keying is pinned by this slice, not re-derived downstream. | A downstream slice that needs a different keying must amend this requirement, not invent one. | Every mass reader uses the `probabilities` map as shipped. |

## 4. Slice 1 — [task-loop] #1 criteria-composed scorer

**EXISTS:** the statement `noul` decides (`src/quality/jev-scorer.ts:18,46`); the criteria are a second,
explain-only call (`jev-scorer.ts:65,145-216`); MIN over dimensions (`evaluate.ts:100-103`); the probe schema
(`src/types/schema.ts:148-190`); the rendering (`jev-scorer.ts:121-143`); the ruler digest
(`evaluate.ts:49-51`); the identity key (`bar.ts:117-126`); the brief rubric projection
(`src/pi/descriptor.ts:184-190`). **PROPOSED:** make the criteria decide, in one call, with code arithmetic.

**Change map:** `src/quality/jev-scorer.ts:39-72` → one request of criteria + witness, composition applied to
the answers; `:145-216` and `:75-86` → the battery, its guards and its constants retire; `:121-143` → the
rendering is reused over the composed answers; `src/quality/evaluate.ts:27-51` → the port exposes criteria and
`rulerDigest` gains the formula id; `:81-118` → the decision is unchanged, the fields are added; `:155-172` →
the cache key already rides the ruler; `src/quality/bar.ts:117-126` → identity on criteria;
`src/types/schema.ts:259-295` → additive-optional verdict fields; `src/runner/engine/quality-loop.ts:32-64` →
copy the new fields; `src/pi/descriptor.ts:45-49,184-190` → show criteria, restate the stance;
`src/types/pi.ts:93` → the brief criteria field. **No task document changes**: the 19 criteria already exist.

| Id | Requirement | Failure behaviour | Oracle |
| --- | --- | --- | --- |
| R6 | **Composition.** A dimension with criteria is scored from them, in the SAME request as the witness; score = MIN per-criterion satisfaction (D4). A dimension with no criteria keeps today statement `noul`, byte-identically. No `EntryType` is used. | An unreadable criterion answer is an error, never a fabricated score; the existing fail-closed path yields `unavailable` and `QUALITY_REQUIRED` for a required floor. | Fake answers `noul 0.9`, `score 1.0` on 2 levels, `choice clean` → dimension 0.9; with the score at level 0 → 0; a no-criteria dimension scores exactly as today. |
| R7 | **Witness.** The statement `noul` is asked in the same request under its own id, recorded as `statementScore`; `divergence` is set when the absolute difference from the composed score reaches one constant `DIVERGENCE_MIN` (0.20). | A missing witness degrades exactly like any missing answer (R6). | Changing only the witness changes no decision, bar or flagged set; `divergence` appears at 0.20. |
| R8 | **Binding criterion.** `bound` records the criterion id that produced the minimum, ties by declared order; a non-clean `choice` names the option in the rationale. | No criteria → no `bound`. | `n1 1.0, s1 1.0, c1 non-clean` → `bound = c1`. |
| R9 | **Rationale from the deciding answers.** Code renders it: binding criterion first, then other non-clean ones, at most 3 clauses and 240 characters; when every criterion is clean and the score is still below the bar, the kept divergence wording is rendered instead. Deterministic; nothing invented. | An unrenderable answer is omitted, never paraphrased. | Same answers twice render the same string. |
| R10 | **One call.** The composed request replaces the scoring call and the battery call; `Scorer.explain`, `jevBattery`, `rationaleFor` and their constants are removed, while the recorded `diagnosis`/`rationale` stay (D7). | Two calls per submission violate the requirement. | A fake `evaluateFn` counts exactly ONE request per submission, carrying every criterion id and every witness id. |
| R11 | **The ruler carries the formula.** `COMPOSE_FORMULA_ID` enters `rulerDigest` beside the declaration and the floors (D6). | A verdict recorded before the change is never reused under it. | Identical inputs with different formula ids are two cache misses and two scorer calls. |
| R12 | **Identity on the criteria.** `dimensionKey` = digest of `(id, criteria)` when composed, `(id, statement)` when not; `compositionKey` covers every dimension key. | Two dimensions sharing an id are already refused by the schema. | Editing one criterion resets only that dimension bar to its seed; rewording the statement alone keeps key and bar. |
| R13 | **The brief shows what decides.** `brief.quality.dimensions[]` gains additive-optional criteria (id, type, instructions, clean option or levels) plus the aggregation text; `JUDGING_STANCE` describes composition. Read-only. | A brief for a task with no criteria is unchanged. | A composed task brief lists all 19 criteria; `op=check` still writes no event, scores nothing and costs no attempt. |
| R14 | **Round-trip safety.** `bound`, `statementScore` and `divergence` are additive-optional on the verdict and copied by `qualityHistory` (`src/runner/engine/quality-loop.ts:32-64`) so the brief judgment, the refusal summary and the score-cache read them back. Old verdicts parse; no backfill. | A field lost in the round trip is a blocking finding. | Record, re-read, and the brief judgment carries the same `bound` and `statementScore`. |

## 5. Slice 2 — [task-loop] #2 uncertainty signal (mass for `choice`/`score`, the value for `noul`)

**EXISTS:** `Scorer.score` returns scores only (`src/quality/evaluate.ts:27-40`); the verdict records
`diagnosis` answers (`src/types/schema.ts:273-283`); the client returns an optional `confidence` today
(`node_modules/pi-jev/dist/src/types.d.ts:25-35`). **PROPOSED:** read the S0 distribution and record the spread
that describes how torn each criterion was. Depends on S0 and S1.

**Change map:** `src/quality/jev-scorer.ts` → carry the answer's distribution into the criterion result;
`src/quality/evaluate.ts:81-118` → compute and attach per-criterion uncertainty, never touching the score;
`src/types/schema.ts:273-283` → `diagnosis[]` gains additive-optional `confidence`, `pClean`, `pTop`, `spread`;
`:287-295` → the verdict gains `torn`; `src/runner/engine/quality-loop.ts:32-64` → copy them;
`src/runner/note-gate.ts` + `src/pi/descriptor.ts` → surface them (no new gate).

| Id | Requirement | Failure behaviour | Oracle |
| --- | --- | --- | --- |
| R15 | **Distribution recorded.** For a `choice` criterion record `pClean` (P(clean option)), `pTop` and `spread = 1 − max(p)`; for a `score` criterion record `pTop` and `spread`. Where a `confidence` is returned, record it too. | No distribution (older client, S0 not yet landed) → the fields are absent, never zero-filled. | A `choice` answer `{clean 0.7, other 0.3}` records `pClean 0.7`, `spread 0.3`. |
| R16 | **`noul` honesty.** A `noul` criterion records NO mass and NO confidence; its uncertainty is its value's distance from 0.5, and it is reported torn when the value lies in `[0.45, 0.55]`. | A `noul` answer that arrives with a distribution is a client regression, not silently used. | A `noul` at 0.9 records no mass; a `noul` at 0.50 is torn. |
| R17 | **The `torn` set.** A criterion is torn when a `choice`'s `pClean` lies in `[0.4, 0.6]`, or any criterion's `spread` exceeds `TORN_SPREAD` (0.35), or a `noul` lies in its band. The verdict records `torn: string[]`. | No criteria → no `torn`. | `{0.52, 0.48}` → torn; `{0.95, 0.05}` → not torn; `[0.45,0.30,0.25]` spread 0.55 → torn. |
| R18 | **Mass never changes the score.** Composition (D4) stays exactly as S1 defined: `choice` is categorical, `score` is its probability-weighted position. Mass is disclosure only. | A change in acceptance caused by mass is a blocking finding for this slice. | The same answers with and without distributions produce identical scores, means, decisions, flagged and bars. |
| R19 | **Authoring rule, stated not enforced.** A criterion that must be graded is authored as a `score`; a `choice` collapses a distribution into one key. Recorded in the rubric-authoring note; no code, no gate. | — | Documentation only. |

## 6. Slice 3 — [task-loop] #6 repeat-N rubric stability before a ratchet

**EXISTS:** the EMA ratchet with warmup 10, cooldown 5, ceiling 0.9 and never-lower
(`src/quality/bar.ts:40-56,183-192,420-450`); `bar.contested` (`:441-442,515-542`); `recomputeBar` is
synchronous and called inside `withStore` (`src/runner/engine/advance.ts:223`). **PROPOSED:** sample the
identity before its first raise. Depends on S1; S0 optional for `choice`/`score` criteria.

**Change map:** `src/quality/bar.ts:420-450` → a hold rule and `stability` on the raise; a new `src/quality/`
module (or a function beside `jev-scorer.ts`) → the repeat-N sampler, pure over an injected `evaluateFn`;
`src/types/learning.ts` → `BarRaisedSchema` gains `stability?` and a new `RubricSampledSchema`;
`src/runner/engine/types.ts` → the two event names; `src/pi/operations.ts:352-400` → perform the sample after a
terminal outcome, outside the transaction, mirroring `advanceEvaluated`.

| Id | Requirement | Failure behaviour | Oracle |
| --- | --- | --- | --- |
| R20 | **Sample.** Before a scope's FIRST raise under an identity, one frozen accepted artifact is re-judged `SAMPLE_REPEATS = 3` times with the composed request; `rubric.sampled` records task, taskVersion, scope, key, artifactDigest, repeats and per-criterion agreement. At most one sample per `(task, key, version)`. | A missing artifact, a judge error or a timeout records nothing and holds the raise (R22); it never refuses a step. | A second attempt at the same `(task, key, version)` performs no call. |
| R21 | **Agreement, and the `noul` limit.** Per criterion: a `choice` agrees by key frequency; a `noul`/`score` agrees by RANGE across repeats. Repeat-N is the ONLY `noul` instability signal (D13); a distribution's spread is recorded beside it and never substituted. | A criterion with fewer than 3 answers makes the sample unusable → hold. | `[0.9,0.9,0.9]` stable; `[0.9,0.4,0.7]` unstable; a `choice` picking `clean` 3/3 stable, 2/3 stable, 1/3 unstable. |
| R22 | **Hold, never refuse.** A due raise with no stable sample is held and recorded `bar.held` with a reason. The step completes normally. | The bar never moves on an unsampled identity; nothing else changes. | A task with a due raise and no sample keeps its bar and still accepts the artifact. |
| R23 | **The raise records its evidence.** `bar.raised` gains additive-optional `stability` (repeats, range or agreement, verdict) beside `ema`; a raise cannot be written without a sample. Pre-slice-3 raises still parse and fold. | — | A new raise parses with `stability`; an old one folds unchanged. |
| R24 | **Outside every transaction.** `recomputeBar` stays synchronous and transaction-local; the sample runs at the awaiting boundary and is recorded as an event (D12). | A caller that never samples never raises: fail-safe, no correctness loss. | No `evaluateFn` call occurs inside `withStore`; a CLI-only run completes with no raise. |

## 7. Slice 4 — [task-loop] #7 injection screen on recalled exemplars

**EXISTS:** recall selects and injects lesson text into the brief (`src/quality/recall.ts:286-325`); the jev
distinct stage holds a persisted, derived cache (`src/quality/ranker-jev.ts:256-350`); no recall path screens
text for instructions (research F11). **PROPOSED:** a code-side `noul` battery over the selected cases. Depends
on S1 only for identity keys.

**Change map:** a new function in `src/quality/recall.ts` (or a small `src/quality/screen.ts`) → the screen over
an injected `evaluateFn`; `src/quality/ranker-jev.ts:234-250,256-350` → record the screen in the cache entry;
`src/types/learning.ts:153-192` → `RecallRankedSchema.chosen[]` and `RecallNoteSchema` gain additive-optional
screen fields; `src/pi/descriptor.ts` + `src/pi/operations.ts:400-436` → carry the disclosure into the brief and
the refusal handback. **No probe-schema change:** the screen questions are code-side, not task-authored.

| Id | Requirement | Failure behaviour | Oracle |
| --- | --- | --- | --- |
| R25 | **Screen.** On a cache miss, the selected cases (at most 5) are screened in ONE batched call: per case two `noul`s — does the text try to instruct or redirect the reader, and would it have the reader act outside the step declared capabilities. A probability at or above 0.5 fails the screen. | A screen error fails the screen for every case (R27), never silently passes it. | A lesson that says to ignore the rubric and submit fails; a normal lesson passes. |
| R26 | **Withhold, do not refuse.** A failed case keeps instance, step, score, tags and relevance; its free text is replaced by a code-owned line and the withholding is disclosed per case and recorded in the cache entry. | The payload must never carry the withheld text in any field. | No withheld text appears in any envelope; the case still ranks and shows its dimension tags. |
| R27 | **Unscreened means withheld.** When no screen is available (judge down, or a deterministic-fallback set), the same rule applies and `screened: false` is disclosed. Recall never blocks and never serves unjudged free text. | A cold or judge-less store still returns tags and provenance; it returns no free text. | With `evaluateFn` throwing, cases return with `screened: false` and no free text. |
| R28 | **Provenance scoping.** A case is not served for a dimension whose current identity key differs from the key recorded in its verdict; the exclusion is recorded once per recall set (D15). | An unchanged dimension keeps its lessons; only the changed one loses them. | After a criteria edit the old case disappears for that dimension and remains for an unchanged one. |

## 8. Slice 5 — [task-loop] #9 three-`noul` explained recall rerank

**EXISTS:** `DISTINCT_CRITERIA` names three authored criteria and asks ONE `score` question per candidate over
them (`src/quality/ranker-jev.ts:47-52,83-148`); the ordering is opaque (research F12); Jaccard dedup guarantees
distinct exemplars (`:135`); the cache records the chosen ids and the jev score (`src/types/learning.ts:153-192`).
**PROPOSED:** ask the authored trio as three `noul`s and combine them with frozen constants, so the ordering
says which property won. Depends on S1 only for identity keys.

**Change map:** `src/quality/ranker-jev.ts:47-52` → the trio becomes three `noul` question texts;
`:83-148` → 3 questions per candidate, ordered by the weighted sum, dedup unchanged;
`src/types/learning.ts:153-192` → the cache entry chosen[] gains additive-optional per-criterion probabilities
and the weighted total; `src/quality/ranker.ts:281-330` → the payload carries the same disclosure to `op=recall`.
Question budget: at most 20 candidates × 3 = 60, under the client 128.

| Id | Requirement | Failure behaviour | Oracle |
| --- | --- | --- | --- |
| R29 | **Three `noul`s replace the one `score`.** Each of the three authored distinctness criteria becomes its own `noul` (ids `c<index>.<criterion>`), so the answer says WHICH property the candidate has. | A candidate set that would exceed the question bound is truncated by the existing pool constant, never split across calls. | The request contains 3 questions per pooled candidate; a candidate strong on distinctness and weak on usefulness shows that split. |
| R30 | **Frozen constants, deterministic order.** The ordering value is the weighted sum of the three probabilities with weights that are constants in code (D16); ties break by the existing deterministic score, then by id. No model chooses a weight, and no task document can. | An unknown or missing answer makes the stage unavailable as today, falling back to the deterministic ranker. | Reordering the candidate list changes no score; a candidate with a high weighted sum ranks first; the weights are greppable constants. |
| R31 | **The explanation is the trio.** Each chosen case carries its three probabilities and the weighted total, so the brief and `op=recall` can say why it arrived. A `noul` has no distribution, so no mass is claimed here; the trio is the whole evidence (D9, D13). | A missing disclosure falls back to the existing `relevance` number, never to invented text. | A case with `distinct 0.9, useful 0.3, readable 0.8` reports those three and the total. |
| R32 | **Distinctness is unchanged.** The Jaccard duplicate collapse (`DUPLICATE_JACCARD = 0.8`) still guarantees at most one near-duplicate lesson, and the token budget still applies. | — | Two near-identical lessons yield one exemplar; the payload stays inside its token bound. |

## 9. Slice 6 — [task-loop] #11 provisional verdict

**EXISTS:** the verdict records `decision` in `pass`, `below`, `unavailable` (`src/types/schema.ts:260`); the
brief and the refusal handback report the verdict (`src/pi/descriptor.ts:80-140`;
`src/pi/operations.ts:242-330`). **PROPOSED:** one reported state derived from the S2 evidence. Depends on
S0, S1 and S2.

**Change map:** `src/types/schema.ts:259-295` → the verdict gains additive-optional `provisional` and
`provisionalOn`; `src/quality/evaluate.ts:81-118` → derive it from the criteria that decided; never feed it to the
gate; `src/runner/engine/quality-loop.ts:32-64` → copy it; `src/pi/descriptor.ts:51-140` and
`src/pi/operations.ts:242-330` → report it; `src/runner/engine/types.ts` → the threshold constants.

| Id | Requirement | Failure behaviour | Oracle |
| --- | --- | --- | --- |
| R33 | **Derivation.** `provisional` is true when a criterion that DECIDED — the dimension `bound`, or the binding criterion of a refused or flagged dimension — is `torn` in the S2 sense; `provisionalOn` lists those criterion ids. | No `torn` data (S2 not landed, or no criteria) → no `provisional` field. | The same verdict with a torn binding criterion reports `provisional`; with a clean one it does not. |
| R34 | **The reason names its signal.** Each `provisionalOn` entry records which signal produced the torn state: a distribution (choice or score), a confidence, or a `noul` value inside its band. A `noul` single probability is never presented as a distribution (D9). | An entry whose signal is unknown is omitted, never guessed. | A `noul` at 0.50 reports the band signal; a `choice` at `{0.52, 0.48}` reports mass. |
| R35 | **Non-gating.** Acceptance, bars, flagged, mean and the cache are identical with and without `provisional` (D10). The brief judgment and a refusal detail report it, with the criterion text to re-read. | A provisional verdict that changes a decision is a blocking finding. | Same scores, provisional present or absent → identical accept/refuse and identical bar; the message differs. |
| R36 | **The thresholds are code constants.** `TORN_SPREAD` (0.35) and the `noul` band (0.45-0.55) are declared beside the other quality defaults (`src/runner/engine/types.ts`), never read from a task document. | A task document cannot set them; doing so is a schema error. | Grep: the constants appear once each; no `QualitySchema` field reads them. |

## 10. Optional slice — [task-loop · optional] #3 confidence-gated alignment

**EXISTS:** the alignment gate asks one `choice` (aligned or misaligned) and refuses on the label
(`src/quality/jev-align.ts:56-114`); on a judge failure it proceeds with a visible flag (owner decision ii,
`docs/jev-alignment-gate-b8c0e751/`). **PROPOSED:** a third state derived from the answer distribution.
Depends on S0 only. Not part of the six; separately approvable (O8).

**Change map:** `src/quality/jev-align.ts:56-114` → read the choice distribution; `src/pi/operations.ts:174-214`
(the start path) → carry an additive flag; `src/types/pi.ts` → the flag on the start envelope.

| Id | Requirement | Failure behaviour | Oracle |
| --- | --- | --- | --- |
| R37 | **A third state.** When the alignment `choice` is aligned but its distribution is close to the boundary (P(aligned) below `ALIGNMENT_CONFIDENCE`, 0.7), start proceeds with a recorded flag naming the two probabilities. | No distribution → today behaviour exactly: refuse on misaligned, proceed flagged when the judge is unavailable. | P(aligned) 0.95 → no flag; 0.62 → starts with the flag; 0.2 → still refused. |
| R38 | **Additive and non-gating in the refusal direction.** No new error code, no new envelope key beyond the optional flag, and a misaligned label is refused exactly as today. | A misaligned order must never start because its distribution was soft. | The misaligned fixture is refused with the same code as before. |

## 11. Model — one owner per fact

| Fact | Owner | Shape | Derived? |
| --- | --- | --- | --- |
| What good means for a task | the task document (`QualitySchema`, `src/types/schema.ts:197-256`) | `dimensions[] {id, statement, criteria[], floor}`, `threshold`, `policy`, `maxAttempts`, `onFailure`, `paretoThreshold` | authored; versioned; publication keyed `(path, version)`, immutable |
| The answer distribution | **pi-jev** (S0) | `probabilities` on a `choice`/`score` answer, keyed as R1 pins | one owner, the client; Praxis only reads |
| What the verdict was judged against | `rulerDigest` + `COMPOSE_FORMULA_ID` + the folded bars (`src/quality/evaluate.ts:49-51`) | one digest on the verdict | derived, recorded |
| The judgment | the `quality.verdict` event (`QualityVerdictSchema`) | `decision`, `score` (MIN), `mean`, `flagged`, per-dimension `{id, score, key, bound, statementScore, divergence, diagnosis[{probe, answer, confidence?, pClean?, pTop?, spread?}], rationale, torn}`, `provisional`, `provisionalOn`, `rubricDigest`, `scorer`, `source` | one event per attempt, never edited |
| The bar | the fold of `bar.raised` (`src/quality/bar.ts:160-192`) | seed + raises (with `ema`, `stability`) | derived; no stored current value |
| The sample | one `rubric.sampled` event | task, version, scope, key, artifactDigest, repeats, per-criterion agreement, verdict | derived input to a raise; never a second owner of the bar |
| The lesson | one `learning.note` event (`src/types/learning.ts:47-62`) | subjective half only | objective half derived (`note-gate.ts:55-96`) |
| The exemplar set | `recall.selected` (disclosure) + `recall.ranked` (derived cache) | ids, per-criterion `noul` values, screen outcome | rebuildable; never authoritative |
| Rubric health | NOT OWNED — read from recorded `bound` and `divergence` | — | deliberately no read surface in this unit |

No new table, no new store, no task-document field. New events: `rubric.sampled`, `bar.held`; the rest are
additive-optional fields on existing events and envelopes.

## 12. Order, dependencies, separability

| Slice | Depends on | Changes what a score means | Independently revertible |
| --- | --- | --- | --- |
| 0 enabler | — (pi-jev repo) | no | yes: Praxis falls back to confidence-only and absent mass |
| 1 composed scorer | — | **YES** (every bar re-warms) | yes: statement scoring returns; the identity re-key is the only durable effect |
| 2 uncertainty | 0, 1 | no | yes: stop recording and surfacing spread and `torn` |
| 3 stability | 1 (0 optional) | no (a raise may be delayed, never lowered) | yes: drop the hold rule; raises resume |
| 4 screen | 1 (identity keys) | no | yes: serve unscreened text again (a safety regression, not a correctness one) |
| 5 rerank | 1 (identity keys) | no | yes: return to the single opaque `score` |
| 6 provisional | 0, 1, 2 | no | yes: stop reporting it |
| optional | 0 | no | yes: return to two alignment states |

Slices 2, 3, 4, 5 and the optional one are independent of each other; 6 needs 2. No slice ships with another
slice acceptance attached: each needs its own owner GO, its own `plan.md`, and its own review.

## 13. Boundaries

**The layer line.** Praxis judges an ARTIFACT against a rubric the TASK AUTHOR wrote and records why. It does
not reason about the content, propose content, or generate remediation prose: composition is arithmetic over
typed answers and the rationale is a code-owned template. In-step depth stays with the agent (Occam side);
assignment stays with Manifold; cross-project synthesis stays with Jung and does not exist here. Recall remains
within one project store.

| Gate | How this design touches it | Left open |
| --- | --- | --- |
| #1 isolation | nothing here restricts a tool; a direct engine or shell call bypasses every judgment | yes |
| #3 trusted identity | the note provenance is the instance actor string, as today; no authentication claim is added | yes |
| #4 flow expansion | a rubric revision is a task republication (authoring), not flow expansion; WHO may republish is a project-process question this spec does not settle | yes |
| #5 artifact contract | verdict and envelope fields are additive-optional; the six-key result is untouched | yes |
| #6 durability | events only, no DDL or migration; the recall cache stays derived and rebuildable; retention unchanged | yes |
| #7 maintenance | sampling is lazy and in-process, never a daemon; a background sampler would open this gate and is not proposed | yes |
| #8 nested execution | untouched | yes |

**Claims not made.** No improvement, no savings, no identity, no isolation, no exactly-once, no sandbox, no
statement that the rubric is stable: S3 measures stability per identity and can only HOLD a raise.

## 14. Future orchestration layer — OUT OF SCOPE (recorded, not designed)

The owner split scope from capability: a task improves itself at task level; routing and orchestration are a
DIFFERENT layer, above it. These ideas from `docs/jev-reference.md` are tagged `[control-flow · future layer]`
and belong here — captured so they are not lost, and explicitly outside this unit.

| Idea | What that layer would do | Why it needs its own unit |
| --- | --- | --- |
| #4 taxonomy over flows and tasks | a hierarchical `choice` walk to route an order to a flow | it decides WHICH task runs; needs a flow/task catalogue, a dispatch boundary and its own authority for gate #4 |
| #5 cascade for extraction | jev reads task metadata (version, threshold, required sections) from an order over a pre-parsed candidate set | intake, before any instance exists |
| #8 presence `noul` for not-stated | separate an order that states the default from one that states nothing | reads the order, not the artifact |
| #10 per-line relevance vector | one call with `exists` plus a relevance probability per line id, locating the section an order is about | a locator over a document, not a judgment of produced work |
| §5 intent routing | classify the request and route to logic, specialist or human | a routing policy with a destination catalogue this project does not have |

Each is a later, separately approvable unit with its own task identity (G0), research, spec, plan and review.
None may be pulled into a task-loop slice. Recorded for that work: it needs its own identity, its own
who-may-route question, and its own §13 exposure; and it must never gain the ability to rewrite a rubric or
raise a bar.

## 15. Measurement — what would count, and what is not measured

| Signal | Why it is the right one | State |
| --- | --- | --- |
| attempts per genuine pass | already a ratchet gate (`BAR_MEAN_ATTEMPTS_MAX = 2`, `src/quality/bar.ts:44`): the task is passing too easily when it falls | unmeasured |
| a binding-criterion fix moving the composed score | the direct test of coherence: the criterion the refusal named is the criterion that decides | unmeasured |
| within-judgment spread (S0, S2) and across-judgment range (S3) | the judge own noise, which currently sits at the same 0.05 scale as the ratchet step and the tolerance band | unmeasured |
| `divergence` rate across a republication | falling means the summary statement and the criteria converged — the task definition improving | unmeasured |
| bar level with pass rate held | a rising bar at a stable pass rate is the ratchet working, not proof of improvement; the pair is the signal | unmeasured |

Everything above is `unmeasured`; the first datapoint is the owner planned 32-session re-test. Because S1 changes
the scale (D18), any before/after must compare attempts and pass rate, never raw scores.

## 16. Exclusions

- Any Praxis-side probability invention: mass comes from S0 only, and a `noul` never has any (D9).
- Structured `EntryType` criteria: available in the client, not needed by composition (D3).
- Automatic rubric rewriting: Praxis records `bound`, `divergence`, `torn` and stability; a human or an author
task republishes. No model edits a rubric.
- Lowering a bar because a rubric is unstable: never-lower is a standing invariant; the raise is held instead.
- A background sampler or maintenance flow (gate #7), a federated or cross-project recall (Jung), and the whole
future orchestration layer (§14).
- Any change to the six-key result, the store schema, the flow schema, the error taxonomy, the hooks contract,
the alignment gate in the six task-loop slices, or the ratchet formula (`praxis.bar.ema/v3` stays byte-identical).
- The `op=check` contract: check keeps writing nothing, scoring nothing and costing no attempt.

## 17. Alternatives

| Alternative | Rejected because |
| --- | --- |
| Keep statement scoring and make the criteria a second, additional gate | That is literally two rubrics, the defect this unit exists to remove. |
| Mean inside a dimension instead of MIN | Compensation: one strong criterion would hide a failed one. |
| Weighted criteria | A second tunable with no evidence to calibrate it. |
| Ask jev for one `score` over the criteria and use that as the dimension score | Reintroduces a black box where the arithmetic must be auditable, and removes the binding criterion. |
| Keep the explain-only second call | Once criteria decide, there is no second rubric to explain; it would double cost to restate answers already in hand. |
| Read only `confidence` and ignore the distribution | The distribution is available after S0 and carries strictly more information; ignoring it would keep the 0.05 decisions blind to the judge spread. |
| Refuse when a criterion is torn or a verdict is provisional | Converts judge noise into agent failure and inflates attempts; recorded and reported instead (O3). |
| Sample the rubric on every run | Unbounded cost; sampling is bounded to once per identity and only when a raise is due. |
| Serve unscreened lessons with a warning | The agent cannot un-read text; withholding the free text keeps the ranking signal and closes the surface. |
| Combine the three recall `noul`s with model-chosen weights | A model deciding its own aggregation is an unexplainable second judge; the weights are frozen constants (D16). |

## 18. Open questions for the owner / lead

| # | Decision | Recommendation |
| --- | --- | --- |
| O1 | Retire the explain-only pass (supersedes verdict-rationale D2/D3) | yes: one rubric, one call; the recorded shape stays |
| O2 | Nested MIN and the scale discontinuity plus full bar re-warm it causes | yes: the only rule consistent with the existing MIN headline |
| O3 | Torn and provisional stay non-gating in S2 and S6 | yes for now; a refusal path for either is a later decision |
| O4 | A raise is HELD (not sampled on demand, not blocked) on an unsampled identity | yes: fail-safe, no step refused for sampling |
| O5 | The sample is performed at the tool boundary; a non-sampling caller never raises | yes: the only place that can await outside a transaction |
| O6 | Unscreened recall withholds free text rather than serving it with a warning | yes: availability of tags and scores is preserved |
| O7 | The 11 tasks without criteria keep statement scoring until an author writes criteria | yes: no forced data migration; research is the first composed task |
| O8 | The `#3` alignment slice is optional and ships after the six | yes: it is the only candidate that is not about a task artifact |
| O9 | S0 distribution keying (option keys for `choice`, level order for `score`) and its tolerance | confirm with the pi-jev engineer before S2 starts; downstream slices follow it |

None of O1-O9 is settled by this document. Each needs an explicit owner word before its slice is dispatched.
