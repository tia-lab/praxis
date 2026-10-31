# Research — the task-level self-improvement loop: one rubric, judged coherently

Task: task-self-improvement · Hash: 17499670 · Gate: G1 · Status: revised draft — lead review before G2 · Date: 2026-10-31
Method: read the shipped quality/learning path, the task/flow documents, the installed `pi-jev` client and
`docs/jev-reference.md`; count what the documents actually contain. Every claim cites `path:line`. Nothing here
is executed evidence: no score, bar, sampling spread, distribution or improvement has been measured, and every
number is a count of code or JSON, labelled `counted`.

## 0. Contract

<!-- One physical line per key: this block is the hash input. Never reflow it. -->

task: task self-improvement loop: a versioned task declares one criteria rubric that both judges its artifacts and explains that judgment, and the loop (score, explain, calibrate, remember, feed back) measurably improves its own execution across runs; design only
scope: docs/<slug>-<hash8>/ design now; later, one slice at a time and each under its own owner GO, src/types/schema.ts, src/types/learning.ts, src/quality/{evaluate,jev-scorer,bar,recall,ranker-jev}.ts, src/pi/{descriptor,operations}.ts, src/runner/{step,note-gate}.ts, src/runner/engine/*, tests/
acceptance: research and spec ground every loop stage at path:line with EXISTS or PROPOSED, the criteria-composed scorer is slice 1 of an ordered separable slice list with per-slice acceptance, the smallest data model (declared rubric, recorded verdict, calibration, memory) has one owner per fact, D1/D2 and the task-as-atom hold, and the boundaries name the Occam/Manifold/Jung line and every section 13 gate touched without settling it

Recompute: `printf 'task: %s\nscope: %s\nacceptance: %s\n' '<t>' '<s>' '<a>' | sed -E 's/[[:space:]]+$//' | sha256sum | cut -c1-8` → `17499670`.

amended 2026-10-31 — the loop is decomposed into SIX ordered task-loop slices (lead GO at gate jev-map) instead of four — the owner fixed the layer classification of `docs/jev-reference.md` §8, and the task-loop ideas are #1, #2, #6, #7, #9, #11.
amended 2026-10-31 — a PREREQUISITE enabler slice 0 is added and probability mass is treated as AVAILABLE — pi-jev is an owned client being extended to preserve the `choice`/`score` distribution; the earlier note that probabilities do not survive the client is a temporary client state, not a boundary (`docs/jev-reference.md` §8 item 2, corrected in place). A `noul` still has no distribution.

## 1. Question and boundary

**Question.** The task loop is shipped end to end (§3): a task declares a rubric, jev judges the artifact, a
bar ratchets from genuine passes, a lesson is recorded, recall steers the next run. The open question is not
whether Praxis has a task loop, but: **does a task judge itself coherently, and can the loop therefore make the
task measurably better rather than merely stricter?**

**Answer in one line.** It does not, yet. A task is judged twice by two different rubrics: only the vaguer one
decides (`src/quality/jev-scorer.ts:18,46`), and the concrete one — the criteria, where improvement would be
measured — is decorative (`src/quality/jev-scorer.ts:65,145-186`; `src/quality/evaluate.ts:58-70,118-121`).

**Boundary.** One task, as a versioned atom (D1), inside one flow step. Not routing, not flow-level
intelligence, not a system brain: those are the future orchestration layer, recorded and deliberately NOT
designed here (§11). Not in-step reasoning (Occam), not assignment (Manifold), not cross-project synthesis
(Jung). Design only: no code, no dependency, no schema change, no edits under `src/`, `tests/` or `.pi/`.

## 2. Sources inspected

| Path | What was read | How |
| --- | --- | --- |
| `src/quality/jev-scorer.ts` | the scoring request, the probe battery, the rendering, the protocol guards | read in full |
| `src/quality/evaluate.ts` | the `Scorer` port, `rulerDigest`, the decision, the score-cache, `advanceEvaluated` | read in full |
| `src/quality/bar.ts` | scopes, seeds, identity keys, genuine passes, EMA, `gateBar`, `compoundDecision`, `recomputeBar`, `decideRaise` | read in full (key ranges) |
| `src/quality/recall.ts`, `ranker.ts`, `ranker-jev.ts` | weights, weak-set, MMR, exemplar, the ranker port, the jev distinct stage (one `score` per candidate), its cache | read (recall full; ranker/ranker-jev key ranges) |
| `src/types/schema.ts` | `ProbeSchema`, `QualityDimensionSchema`, `QualitySchema`, `QualityVerdictSchema` | read (140-320) |
| `src/types/learning.ts`, `src/types/pi.ts` | note, bar raise/contest, recall set, `recall.ranked`, `RecallNote`, `RecallCase` | read |
| `src/runner/step.ts` | `runStep`, handoffs, the deterministic gate and its quality block | read in full |
| `src/runner/engine/{advance,quality-loop,types}.ts` | the advance path, `qualityHistory`, `failureOutcome`, event names, defaults | read in full |
| `src/runner/note-gate.ts` | the derived objective half, the adequate-note gate, the closure transition | read (20-160) |
| `src/pi/descriptor.ts`, `src/pi/operations.ts` | the brief quality block, `JUDGING_STANCE`, submit, refusal handback | read (descriptor full; operations 352-437) |
| `node_modules/pi-jev/dist/src/{types.d.ts,client.js}` | the wire types, the client response validation and rebuilding | read |
| `docs/jev-reference.md` | primitives, distributions and confidence, batching, cookbooks, §8 with its layer tags | read in full |
| `.pi/praxis/tasks/**/*.json`, `.pi/praxis/flows/engineering/feature.json` | which rubrics exist and what they declare | read / counted |
| `docs/verdict-rationale-ad85142e/spec.md`, `docs/ema-ratchet-c6dbbfaf/research.md`, `docs/pareto-gate-db0288ed/spec.md` | the decisions this unit keeps or supersedes | read |

## 3. The loop as shipped

### 3.1 Stages

| Stage | What actually happens | Evidence |
| --- | --- | --- |
| execute | one node runs under its grant; the artifact is canonicalised, digested, versioned and written `pending`; a consumer gets `(artifactRef, digest, path, schema)` and the bytes are re-verified before use | `src/runner/step.ts:154-222`, `:103-152` |
| evaluate | `advanceEvaluated` computes a verdict OUTSIDE any store transaction, then the synchronous engine records and enforces it; one `noul` per dimension, instructions `JUDGE + statement` | `src/quality/evaluate.ts:177-205`, `:81-118`; `src/quality/jev-scorer.ts:18,43-49` |
| explain | a second, explain-only `evaluate` call over the probes, after the verdict, whose throw is swallowed; answers + a rendered line are stored on the verdict | `src/quality/jev-scorer.ts:65,145-216`; `src/quality/evaluate.ts:58-70,118-130` |
| calibrate | per-scope EMA ratchet over genuine passes (warmup 10, cooldown 5, ceiling 0.9, never lower), re-evaluated after every terminal outcome; `bar.contested` on a full window with no pass | `src/quality/bar.ts:303-313,420-450`; `src/runner/engine/advance.ts:223`; `src/runner/engine/quality-loop.ts:224,252` |
| remember | an adequate note is required at every terminal outcome (objective half DERIVED from events); recall selects at most five lessons by five frozen weights + MMR + one exemplar, jev-ranked (one `score` per candidate) and cached as a derived event; a bounded experience query exists behind a port | `src/runner/note-gate.ts:55-96,101-135,212-266`; `src/quality/recall.ts:22-30,244-302`; `src/quality/ranker-jev.ts:83-148,256-350` |
| feed back | the brief discloses rubric, earned bar, capped gate, stance, pending judgment and recall; a below-bar refusal carries up to three ranked passing cases for the refused dimensions | `src/pi/descriptor.ts:45-49,80-206`; `src/pi/operations.ts:400-436`; `src/quality/recall.ts:338-353` |

**Consequence.** This is a refinement unit. Nothing below adds a stage; each proposed change makes an existing
fact load-bearing, records one that is discarded, or explains one that is opaque.
### 3.2 Mechanism inventory (26 EXISTS / 20 PROPOSED)

| # | Stage | Mechanism | State | Slice | Evidence |
| --- | --- | --- | --- | --- | --- |
| E1 | execute | canonical bytes, digest, artifact versioning, pending→accepted | EXISTS | kept | `src/runner/step.ts:154-222` |
| E2 | execute | handoff by `(version, digest)` with an integrity re-read | EXISTS | kept | `src/runner/step.ts:103-152,200-215` |
| E3 | evaluate | the injected `Scorer` port (the jev seam) | EXISTS | extended | `src/quality/evaluate.ts:27-47` |
| E4 | evaluate | one `noul` per dimension over `JUDGE + statement` | EXISTS | replaced in S1 | `src/quality/jev-scorer.ts:18,43-49` |
| E5 | evaluate | MIN over dimensions as the headline score | EXISTS | kept | `src/quality/evaluate.ts:100-103` |
| E6 | evaluate | compound accept: every dimension within `bar ± 0.05` AND the hard MEAN bar | EXISTS | kept | `src/quality/bar.ts:336-350`; `src/runner/step.ts:365-380` |
| E7 | evaluate | the Pareto cap on the GATE only, the ratchet uncapped | EXISTS | kept | `src/quality/bar.ts:315-321` |
| E8 | evaluate | the digest score-cache (same bytes + same ruler never re-judged) | EXISTS | keyed by S1 | `src/quality/evaluate.ts:155-172,190-203` |
| E9 | evaluate | fail-closed degraded verdict (`unavailable`) | EXISTS | kept | `src/quality/evaluate.ts:72-79,88-98` |
| E10 | evaluate | the recorded `quality.verdict` event carrying `rubricDigest` | EXISTS | extended | `src/runner/engine/advance.ts:195-210` |
| E11 | explain | probe schema bounded at parse (6/dimension, 48/rubric) | EXISTS | becomes the rubric | `src/types/schema.ts:148-190,192-256` |
| E12 | explain | ONE explain-only call over every probe | EXISTS | retired in S1 | `src/quality/jev-scorer.ts:145-216` |
| E13 | explain | code-owned, bounded rendering of the answers | EXISTS | reused in S1 | `src/quality/jev-scorer.ts:121-143` |
| E14 | explain | the divergence clause (below bar, probes clean) | EXISTS | re-pointed in S1 | `src/quality/jev-scorer.ts:79-81` |
| E15 | calibrate | one EMA rule for every scope | EXISTS | kept | `src/quality/bar.ts:303-313,420-450` |
| E16 | calibrate | warmup, cooldown, ceiling, never-lower fold | EXISTS | kept | `src/quality/bar.ts:40-56,183-192` |
| E17 | calibrate | `bar.contested`, never an auto-lower | EXISTS | kept | `src/quality/bar.ts:441-442,515-542` |
| E18 | calibrate | bar identity keyed by dimension identity / rubric composition | EXISTS | re-keyed in S1 | `src/quality/bar.ts:117-126,143-158` |
| E19 | remember | the note gate: derived objective half + adequate subjective half + bounded stub | EXISTS | kept | `src/runner/note-gate.ts:55-96,101-135,247-266` |
| E20 | remember | recall selection: five frozen weights, MMR, one guaranteed exemplar, token budget | EXISTS | kept | `src/quality/recall.ts:22-32,244-302` |
| E21 | remember | jev distinct ranking (one `score` per candidate, Jaccard dedup) behind a lazy, derived, watermark cache | EXISTS | re-shaped in S5 | `src/quality/ranker-jev.ts:47-52,83-148,256-350` |
| E22 | remember | bounded experience query behind a pure ranker port | EXISTS | reader of S4/S5 | `src/quality/ranker.ts:74-76,331-353` |
| E23 | feed back | brief disclosure: rubric, earned bar, capped gate, stance, judgment, recall | EXISTS | extended in S1/S2/S6 | `src/pi/descriptor.ts:45-49,143-206` |
| E24 | feed back | refusal handback with ranked passing cases | EXISTS | extended in S4/S6 | `src/pi/operations.ts:400-436` |
| E25 | feed back | the targeted escalation lesson for the weakest dimension | EXISTS | kept | `src/quality/recall.ts:338-353` |
| E26 | all | the task is a versioned atom; a publication is keyed `(path, version)` and immutable | EXISTS | kept (D1) | `src/store/definitions.ts:74-75,140-160`; `src/types/schema.ts:299` |
| P1 | enabler | pi-jev preserves the `choice`/`score` probability distribution; a `noul` keeps none | PROPOSED | **S0** | `docs/jev-reference.md` §8 item 2; §6 below |
| P2 | evaluate | criteria are LOAD-BEARING: composed dimension score, nested MIN, no EntryType | PROPOSED | S1 | §4 |
| P3 | evaluate | the composition formula is part of the ruler digest | PROPOSED | S1 | §4 |
| P4 | evaluate | dimension identity follows the load-bearing rubric | PROPOSED | S1 | §4 |
| P5 | evaluate | the binding criterion is recorded (`bound`) | PROPOSED | S1 | §4 |
| P6 | evaluate | the statement survives as a recorded WITNESS, never a gate input | PROPOSED | S1 | §4 |
| P7 | explain | the rationale is rendered from the answers that decided; the second pass is retired | PROPOSED | S1 | §4 |
| P8 | feed back | the brief shows the criteria, not only the summary sentence | PROPOSED | S1 | §4 |
| P9 | evaluate | the distribution SPREAD recorded per `choice`/`score` criterion | PROPOSED | S2 | `docs/jev-reference.md` §1 |
| P10 | evaluate | a `torn` set, explained and never gating | PROPOSED | S2 | — |
| P11 | calibrate | bounded repeat-N sample of a rubric identity | PROPOSED | S3 | `docs/jev-reference.md` §4 |
| P12 | calibrate | the raise is HELD until sampled; the raise records its `stability` | PROPOSED | S3 | — |
| P13 | calibrate | the sample runs outside every store transaction (two-phase ratchet) | PROPOSED | S3 | — |
| P14 | remember | an injection / out-of-capability screen on the selected exemplars | PROPOSED | S4 | §8 item 7 |
| P15 | remember | free text is WITHHELD when it cannot be screened, and disclosed | PROPOSED | S4 | — |
| P16 | remember | a lesson is not recalled for a dimension whose criteria identity changed | PROPOSED | S4 | — |
| P17 | remember | the recall ordering is k `noul`s per candidate combined by FROZEN constants | PROPOSED | S5 | §8 item 9 |
| P18 | remember | each served case discloses `covers` + the relevant dimension rationale | PROPOSED | S5 | — |
| P19 | evaluate | a verdict-level `provisional` state from the deciding criteria uncertainty | PROPOSED | S6 | §8 item 11 |
| P20 | evaluate | confidence-gated alignment (a third, honest alignment state) | PROPOSED | optional | §8 item 3 |

## 4. The defect: one task, two rubrics

### 4.1 What decides, what explains

- The gate semantic input is one `noul` per dimension whose instructions are a fixed stance plus the dimension
**statement** (`src/quality/jev-scorer.ts:18,46`). Its answers become `dimensions[].score`, the MIN headline, the
compound decision and — through genuine passes — the bar.
- The **criteria** (probes) are asked in a second request, after the verdict is decided
(`src/quality/jev-scorer.ts:65`; `src/quality/evaluate.ts:118-130`), with a `state` that excludes the scores
(`src/quality/jev-scorer.ts:190-200`). A throw there is swallowed; the verdict stays byte-identical
(`src/quality/evaluate.ts:58-70`).
- The probe schema is the concrete, graded definition: typed, bounded, with a per-option meaning and a declared
clean answer (`src/types/schema.ts:148-190`).

So one task document holds two descriptions of good per dimension: a sentence that decides and a battery that
describes. Same author, same file, free to disagree without consequence.

### 4.2 Counted facts

- **12 task documents** under `.pi/praxis/tasks/**`; **1** declares probes: `discovery/research.json` (v5,
5 dimensions, **19** probes). `counted`.
- The other **11** declare a rubric with no probes. For those the explain pass assembles zero questions and
returns an empty list (`src/quality/jev-scorer.ts:203`), so **no rationale is ever recorded**: their explain
stage is absent, not weak. `counted` + `source-inspected`.
- The brief does not show the criteria even where they exist: it projects `{id, statement, floor}` only, with the
comment that it shows the rubric and not the judge battery (`src/pi/descriptor.ts:184-190`). `source-inspected`.

### 4.3 Four consequences, each traceable

1. **Calibration is on the wrong scale.** A raised bar is a claim about the probability that a vague sentence is
fully satisfied (`src/quality/bar.ts:420-450` over `jev-scorer.ts:46`), not about every criterion being met.
2. **A correct fix need not register.** The agent fixes what the rationale names; the gate re-scores the sentence.
Nothing forces the two to move together, so the attempt budget (`src/types/schema.ts:221`) can be spent on fixes
the gate cannot see, ending in `continue` or `escalate` (`src/runner/engine/quality-loop.ts:174-273`).
3. **The identity key is inverted.** A bar belongs to `digest(id + statement)`
(`src/quality/bar.ts:117-119,143-158`): editing criteria never resets it, rewording the sentence does.
4. **The divergence signal has no consumer.** The design already detects the two-rubric condition — the score is
below the bar while every probe is clean, so the dimension statement may be too vague
(`src/quality/jev-scorer.ts:79-81`) — and nothing acts on it.

## 5. Competing explanations

| # | Explanation | What it predicts | What would distinguish it |
| --- | --- | --- | --- |
| a | **Two rubrics** (this unit) | fixing the named criteria moves the score only weakly; statement judgement and criteria disagree on some artifacts | compare the statement `noul` against a MIN over the same criteria per artifact: disagreement is direct evidence |
| b | **Judge noise** | identical bytes score within ±noise; the 0.05 ratchet step and the 0.05 tolerance sit inside it | two instruments now exist: the within-judgment distribution (S0 + S2) and repeat-N across judgments (S3) |
| c | **Gate miscalibration** | refusals track the Pareto cap or the tolerance band, not the work | already falsifiable: the cap only relaxes (`src/quality/bar.ts:315-321`), so removing it cannot cause refusals |
| d | **The worker cannot target the rubric** | agents rework what the sentence says, never what the criteria say | the recorded note tags and the refusal text: do they name criteria that were never shown? |

Honest state: **(a) and (b) are not separated today.** Two constants the same size as plausible judge noise
decide acceptance (`BAR_MAX_STEP = 0.05`, `src/quality/bar.ts:46`; `DIMENSION_TOLERANCE = 0.05`, `bar.ts:58`).
S0 and S3 are the instruments that make (b) measurable: a distribution spread is uncertainty inside ONE judgment,
repeat-N is instability ACROSS judgments. Neither has been measured. `reasoning, not measured`.

**Evidence worth taking before accepting slice 1**, with no production code: repeat the CURRENT scoring call N=5
on one frozen accepted artifact per task and record the spread. Otherwise a post-slice-1 score change cannot be
attributed to coherence rather than noise.

## 6. jev's surface: primitives, distributions, and the `noul` limit

| Capability | State | Consequence for this design |
| --- | --- | --- |
| `noul` answer | `{ type, noul }`: ONE probability, **no distribution, no confidence** (`node_modules/pi-jev/dist/src/types.d.ts:21-24`) | no mass to read: a `noul` criterion uncertainty is its value distance from 0.5 (S2) and its instability is repeat-N only (S3). Never treat 0.51 as a fact (jev-reference §1). |
| `choice` / `score` answers | today an optional `confidence` (`types.d.ts:25-35`); **S0** makes pi-jev preserve the documented `probabilities` (`docs/jev-reference.md` §1) | S2, S5, S6 may read the mass for a `choice`/`score` criterion: spread, P(clean), P(top level). A `score` point answer is already the probability-weighted level position, so mass does not change the score — it explains it. |
| batching | one request, at most 128 questions and 262 144 bytes (`node_modules/pi-jev/dist/src/client.js:5,33-48`); a 62-question example exists (jev-reference §3) | 8 dimensions × (6 criteria + 1 witness) = 56 fits; one composed call replaces two. |
| structured `EntryType` | typed in the client (`types.d.ts:2-5`), not exposed by `ProbeSchema` (`src/types/schema.ts:148-190`) | **not needed**: composition is one `noul` per criterion plus code arithmetic (lead-accepted). Adopting it would widen a schema for no loop gain. |
| calibration | a `noul` is calibrated across groups, not per answer (jev-reference §1) | compose and threshold in code; never read one probability as a verdict. |
| cost | input-only, $0.042 per Mtok (jev-reference §10); Praxis has measured none | the extra calls in this design are bounded by construction; no saving is claimed. |

## 7. Affected owners and callers

| Path | Declares | Effect |
| --- | --- | --- |
| `pi-jev` (owned, separate repo) | answer types and the client response validation | **S0**: preserve `probabilities` for `choice`/`score`, reject a malformed distribution, leave `noul` unchanged |
| `src/types/schema.ts:148-256` | probe, dimension, quality schemas | unchanged fields; the verdict gains additive-optional per-criterion uncertainty |
| `src/types/schema.ts:259-295` | `QualityVerdictSchema` | additive-optional `bound`, `statementScore`, `divergence`, `torn`, `provisional`; old verdicts parse |
| `src/types/pi.ts:93` | `StepDescriptorSchema` | the brief gains additive-optional criteria and uncertainty; the six-key result is untouched |
| `src/quality/evaluate.ts:27-51` | the port and `rulerDigest` | the port must expose criteria; the ruler must carry the composition formula |
| `src/quality/jev-scorer.ts:18-72,145-216` | the two requests | one composed request; the battery is retired (supersedes verdict-rationale D2/D3) |
| `src/quality/bar.ts:117-126` | dimension / composition identity | must key on the load-bearing rubric |
| `src/quality/bar.ts:420-450` | `recomputeBar` | gains a hold rule; it is SYNCHRONOUS and runs inside `withStore` (`advance.ts:223`), so a jev sample cannot live there |
| `src/quality/ranker-jev.ts:47-52,83-148` | `DISTINCT_CRITERIA` and one `score` per candidate | the authored trio becomes three `noul`s with frozen constant weights |
| `src/quality/recall.ts:286-325` | the brief `RecallSet` | served cases gain disclosure fields; selection weights unchanged |
| `src/runner/step.ts:298-380` | the gate | unchanged: it keeps enforcing the recorded decision and adds no state |
| `src/runner/engine/quality-loop.ts:32-64` | `qualityHistory` | copies a FIXED field list, so every new verdict field must be added here or it vanishes on re-read |
| `src/runner/note-gate.ts:55-96` | the derived objective | `weakest` now means the weakest COMPOSED dimension: same rule, different input |
| `src/pi/descriptor.ts:45-49,184-190` | `JUDGING_STANCE`, the brief rubric | both describe statement-scoring today |
| `src/pi/operations.ts:400-436` | the refusal handback | wording gains the torn and provisional cases; the recall payload shape is unchanged |
| `.pi/praxis/tasks/**/*.json` | the 12 rubrics | DATA: 11 keep working unchanged until an author adds criteria |

## 8. Findings

| # | Finding | Label |
| --- | --- | --- |
| F1 | The statement `noul` is the only semantic gate input. | source-inspected |
| F2 | The probe battery runs after the verdict, never gates, and its failure is swallowed. | source-inspected |
| F3 | 12 tasks, 1 with probes (19); the other 11 record no rationale at all. | counted |
| F4 | The brief hides the criteria from the worker it judges. | source-inspected |
| F5 | The bar identity is `id + statement`, so a criteria edit never resets it. | source-inspected |
| F6 | The ruler digest carries the declaration and the floors, no behavioural identity. | source-inspected |
| F7 | `qualityHistory` reconstructs a verdict from a fixed field list; new fields vanish on re-read. | source-inspected |
| F8 | The ratchet is synchronous and runs inside `withStore`; no external call may join it. | source-inspected |
| F9 | pi-jev 0.2.2 drops `probabilities` and a `noul` has neither mass nor confidence; the client is OURS and S0 restores the `choice`/`score` mass. | documented + source-inspected |
| F10 | No stability of the judge, and no improvement of any loop stage, has been measured. | unmeasured |
| F11 | No recall path screens lesson text for instructions to the reader. | source-inspected |
| F12 | The recall rerank asks ONE opaque `score` per candidate over three authored criteria, so the ordering says nothing about which property won. | source-inspected (`src/quality/ranker-jev.ts:83-148`) |
| F13 | The ratchet step and the gate tolerance are both 0.05, the same order as plausible judge noise. | reasoning, not measured |

## 9. Uncertainty

1. **Judge noise is unknown** until the distribution (S0) and repeat-N (S3) are read.
2. **The composed scale is unknown.** Composing criteria shifts scores relative to today statement scale;
authored seeds may need re-tuning after the first observations.
3. **Nested MIN may be harsh.** A six-criterion dimension has six chances to be dragged to its weakest one.
4. **The enabler key shape must be pinned by S0**: for a `choice`, key the distribution by the option keys;
for a `score`, by level index in the authored order. If S0 ships a different keying, every slice that reads mass
follows it rather than deriving its own.
5. **Sampling cost is unknown.** R=3 extra judgments per new dimension identity is bounded but unmeasured.
6. **The witness may be redundant** if the statement and the composed score track each other closely.

## 10. The design's slices (enabler + six + optional)

| Slice | Idea | Layer tag | Depends on | Changes what a score means |
| --- | --- | --- | --- | --- |
| 0 | pi-jev preserves the `choice`/`score` probability distribution | **[enabler · pi-jev, owned]** | — | no |
| 1 | criteria-composed scorer: one `noul` per criterion, ONE request, code arithmetic, NO EntryType | [task-loop] | — | **YES** |
| 2 | confidence / mass-spread uncertainty signal, a `torn` set recorded, non-gating | [task-loop] | 0, 1 | no |
| 3 | repeat-N rubric stability before a statement may ratchet | [task-loop] | 1 (0 optional) | no |
| 4 | injection screen on recalled exemplars: code-side `noul`s, no schema change | [task-loop] | 1 (identity keys) | no |
| 5 | three-`noul` explained recall rerank with frozen constants | [task-loop] | 1 (identity keys) | no |
| 6 | provisional verdict from the deciding criteria uncertainty | [task-loop] | 0, 1, 2 | no |
| optional | confidence-gated alignment | [task-loop · optional] | 0 | no |

## 11. Future orchestration layer — OUT OF SCOPE (recorded, not designed)

The owner split scope from capability: **a task improves itself at task level; routing and orchestration are a
different layer, above it.** Four ideas from `docs/jev-reference.md` §8 plus the §5 intent-routing pattern
belong to that layer. Each is a later, separately approvable unit with its own task identity; none is designed
here, none may be pulled into a task-loop slice, and this unit supplies them no requirements, no model and no
acceptance.

| # | Idea (`docs/jev-reference.md`) | What the layer would do | Why it is not this unit |
| --- | --- | --- | --- |
| 4 | taxonomy over flows and tasks | a hierarchical `choice` walk to route an order to a flow | it decides WHICH task runs, not whether a task judges itself well; it needs a flow/task catalogue and a dispatch boundary |
| 5 | cascade for extraction | jev reads task metadata (version, threshold, required sections) from an order over a pre-parsed candidate set | intake of an order, before any instance exists |
| 8 | presence `noul` for not-stated | distinguish the order stating the default from the order stating nothing, for an optional field | reads the order, not the artifact |
| 10 | per-line relevance vector | one call returning `exists` plus a relevance probability per line id, to locate the section an order is about | a locator over a document, not a judgment of produced work |
| §5 | intent routing | classify the request and route to logic, specialist or human | routing policy, and it needs a destination catalogue this project does not have |

Recorded for that future work, so nothing is guessed later: it needs its own identity (it decides where work
goes), its own authority question (who may route), and its own §13 exposure (the dispatch boundary and gate #4
flow expansion). It must never gain the ability to rewrite a rubric or raise a bar.
