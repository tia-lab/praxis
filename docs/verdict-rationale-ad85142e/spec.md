# Spec — the verdict's structured why: a per-dimension jev battery (supersedes the label design)

Task: verdict-rationale · Hash: ad85142e · Gate: G2 · Status: REVISED draft — lead review before G3.
Predecessor: `docs/verdict-rationale-ad85142e/research.md`. The earlier single-label design is superseded: it
made a model narrate its own number. Here jev JUDGES by decomposition and Praxis renders the pattern.

## Outcome

Each rubric dimension may declare a **battery** of jev probes (choice/noul/score) that diagnose WHY it
passes or fails. One explain-only `evaluate` call asks every dimension's probes in parallel; the pattern of
calibrated answers is the **structured rationale**, rendered by a code-owned template into a bounded,
actionable line. It is stored on the existing `quality.verdict` event and surfaced in three places: the
refusal handback (beside the recalled exemplars), the brief before `op=note`, and each recalled exemplar
(the relevant dimension only, by reference, budgeted).

**The dimension's SCORE is untouched**: the scoring call stays byte-for-byte what it is today (D2), so there
is zero drift; the battery never feeds the gate; a battery failure leaves the verdict byte-identical.

## Frozen decisions

- **D1 — The battery lives on the dimension.** `QualityDimensionSchema` (`src/types/schema.ts:142-151`) gains
  an OPTIONAL `probes` array. Probes are per-dimension and composable: every task composes its own for its
  own criteria (`parsimony` on research is not `ran-evidence` on implement). A dimension without probes
  simply has no structured why — graceful, and every existing task parses unchanged.
- **D2 — ZERO SCORE DRIFT, by construction.** The scoring request is identical to today's: same ids (the
  dimension ids), same `noul` questions, same instructions, same `state`, same model (`jev-scorer.ts:42-49`).
  The battery does NOT recompute the score and is never merged into it.
- **D3 — The battery is a separate, explain-only call.** ONE `evaluate` request per evaluation, after the
  scoring call, outside any store transaction, carrying only the probes. It is evidence: it never feeds the
  gate, the bars, the compound decision or the flagged set, and a throw/timeout/unreadable answer leaves the
  verdict **byte-identical** (unlike a scorer failure, which stays fail-closed, `evaluate.ts:35-37`).
- **D4 — Probe schema, bounded at parse.** One probe is
  `{ id: string(1-64, `[a-z0-9-]`), type: "choice" | "noul" | "score", instructions: string(1-500),
  criteria?: Record<string,string> (2-8 named options, required for choice) | string[2-10] (ordered levels,
  required for score) }`; ids unique within the dimension; **at most `PROBES_PER_DIMENSION = 6` and at most
  `PROBES_TOTAL = 48` across the rubric** (≤ 8 dimensions × 6). A rubric that exceeds either bound is
  `CONFIG_INVALID` at parse, so a VALID task can never overflow pi-jev's `MAX_QUESTIONS = 128` or
  `MAX_REQUEST_BYTES = 262_144` (`node_modules/pi-jev/src/client.ts:5,34`). A second runtime guard skips the
  explain call (rationale absent, verdict intact) if the assembled request would still exceed either limit.
- **D5 — One explain request, independent of the score.** Questions are keyed `<dimensionId>.<probeId>`, all
  of them in ONE call, with `state = { goal, artifact, subjectDigest }` — **deliberately NOT including the
  scores**, so the battery is an independent judgment and the divergence signal (D11) means something.
- **D6 — Structured evidence + rendered line, both stored.** Each judged dimension records
  `diagnosis: [{ probe, answer }]` (the structured answers, `answer` = the chosen label or the number) and
  `rationale: string` (the rendered sentence). Both are OPTIONAL and additive. The rendered line is stored
  because the log must record **what the agent was shown**; the structured answers are what a later reader
  (or a re-render) reasons from. One owner per fact: the answers are the evidence, the line is their display.
- **D7 — Rendering is code, bounded, deterministic.** A code-owned template maps (dimension, probe answers)
  to at most `RATIONALE_MAX_CLAUSES = 3` clauses, clipped to `RATIONALE_MAX = 240` characters: prefix = the
  dimension id, then one clause per non-clean probe (a probe is clean when its choice is the declared
  satisfied/yes option, its noul ≥ 0.5, or its score is the top level), then — when every probe is clean but
  the dimension is below its bar — the divergence clause of D11. Same answers always render the same string;
  a probe whose answer is absent or unknown is OMITTED, never invented.
- **D8 — Store: additive optional fields on the existing payload.** `QualityVerdictSchema.dimensions[]`
  (`schema.ts:184-191`) gains `diagnosis?` and `rationale?`. No table, no migration, no `STORE_SCHEMA` change,
  no new event; verdicts recorded before this unit parse unchanged and are never backfilled.
- **D9 — Probes are in the digest, the rationale is not.** `rulerDigest = digestOf({ ruler: quality, floors })`
  (`evaluate.ts:29-31`) already covers the whole Quality declaration, so adding probes changes it — CORRECT:
  probes are part of what the dimension means, and a changed ruler must not reuse cached verdicts
  (`evaluate.ts:99-111`). The verdict's `diagnosis`/`rationale` are OUTPUTS and never enter the digest.
- **D10 — Version and bars, stated plainly.** Adding probes bumps the task version (`src/store/definitions.ts:6-10,63-75`).
  It does NOT re-warm the earned bars: bar identity is the dimension's (id, statement) pair (`bar.ts:117-119`,
  composition at `:121-125`), and the raise fold never consults `taskVersion` (`raisesFor`, `:160-172`) — so on
  a task that keeps its dimension ids and statements, the bars INHERIT across the bump.
- **D11 — The divergence signal is stated, never scored.** When a dimension is below its bar (or flagged) and
  every one of its probes is clean, the rendered line ends with: `/ the score is below the bar but every probe
  is clean: the dimension statement may be too vague`. That makes the parsimony-statement hypothesis directly
  verifiable from the record. It changes no score, bar or decision, and it is a template branch, not a field.
- **D12 — Three surfaces (unchanged in intent).** (a) refusal handback `detail.quality.dimensions[].rationale`
  (+ `diagnosis`) beside `detail.recall` (`operations.ts:264-269`); (b) `brief.quality.judgment` for the
  note-owed step, read from the recorded verdict via `qualityHistory` (`quality-loop.ts:32`); (c) recall — the
  RELEVANT dimension's rendered line only, by reference from the verdict at assembly (`ranker.ts:171-184`),
  counted into `lessonTokens` (`:77-84`) so `applyBounds`' ~1200-token budget (`:263-286`) stays exact.
- **D13 — Cost.** One extra `evaluate` call per UNCACHED evaluation (the artifact is re-sent; output is a few
  labels); a repeated submit of identical bytes costs NONE, because the score cache reuses the recorded
  verdict including its diagnosis/rationale (`evaluate.ts:99-111`).

## Requirements

| Id | Requirement | Failure behaviour | Oracle |
| --- | --- | --- | --- |
| R1 | **Probe declarations**: `probes` parses per D4 (typed, unique ids per dimension, option/level counts), with the per-dimension and total caps enforced at parse. | Exceeding a cap, an unknown probe type, an empty criteria map or a duplicated probe id is `CONFIG_INVALID` at parse — never a runtime surprise. | A task with 6 probes on 8 dimensions parses; 7 on one dimension, 49 total, a duplicate id and a `choice` probe without criteria are each refused with a typed code. |
| R2 | **Zero score drift**: the scoring request is identical to today's and no score is touched by the battery. | — | The existing question-map test (`tests/quality/jev-scorer.test.ts:53-70`) passes UNCHANGED, and a new test deep-equals the captured scoring request against a golden (ids, `noul`, instructions, state keys, model). |
| R3 | **One explain request** with every dimension's probes keyed `<dimension>.<probe>`, `state` WITHOUT the scores (D5), one call. | A rubric with no probes at all makes NO explain call. | A fake `evaluateFn` records exactly one explain request whose question ids are the full probe set, and whose state has no `score`/`scores` key. |
| R4 | **All-or-nothing answers**: a missing, mistyped or out-of-vocabulary answer makes the whole explain unavailable (no partial diagnosis). | The explain result is dropped entirely; the verdict is byte-identical to the no-explain run. | With a fake returning one bad answer per variant (missing id, wrong type, unknown choice), the verdict has no `diagnosis`, and its score/decision/mean/flagged are unchanged. |
| R5 | **Rendering** (D7): ≤3 clauses, ≤240 chars, deterministic, clean probes omitted, unknown answers omitted. | Nothing to say → `rationale` absent (not an empty string). | A two-fault pattern renders exactly those two clauses plus the dimension prefix; the same answers render the same string twice; a 400-char template output clips at 240 with an ellipsis. |
| R6 | **The verdict carries `diagnosis` + `rationale`**, optional and additive; old verdicts parse. | A pre-unit verdict (no fields) behaves exactly as before. | An old payload round-trips; a new one validates; `rulerDigest` is identical with and without the verdict's diagnosis, and DIFFERENT when probes are added to the rubric. |
| R7 | **Never a gate input**: decision, score, mean, flagged, compound and bars are identical with the battery present, absent or throwing. | A throw/timeout leaves the verdict byte-identical. | The same evaluation run with `explain` present/absent/throwing yields verdicts deep-equal modulo `diagnosis`/`rationale`. |
| R8 | **Refusal handback** carries per-dimension `rationale` (+`diagnosis`) beside `detail.recall`. | No diagnosis → fields omitted, the rest of the detail unchanged. | A below-bar submit with probes yields rationales for exactly the judged dimensions; `detail.recall` is unaffected. |
| R9 | **Pre-note brief** carries `brief.quality.judgment` = the recorded verdict's score, flagged and per-dimension diagnosis/rationale for the note-owed step. | No recorded verdict → `judgment` absent. | After an accepted step, the note-step descriptor shows the diagnosis; before any verdict it does not. |
| R10 | **Recall** attaches ONE rendered line per exemplar — the relevant dimension's — by reference, counted in the token budget. | That dimension has no diagnosis → omitted, never padded. | A recalled case shows one rationale for the queried dimension only, and `lessonTokens` grows by its length so the bound still holds. |
| R11 | **No structural change**: no table, migration, `STORE_SCHEMA` bump, new event type or dependency. | — | `git diff` shows nothing under `src/store/`; `STORE_SCHEMA` byte-identical; `package.json` untouched. |
| R12 | **Cost bound** (D13). | — | On a cached verdict reuse the fake call count is unchanged; on a cold submit it is exactly two (score, then battery). |
| R13 | **Divergence clause** (D11) appears only when the dimension is below its bar/flagged AND every probe is clean, and changes nothing else. | A dimension with no probes never gets the clause (there is no pattern to compare). | A low score with all-clean probes renders the clause; a low score with one dirty probe renders that probe's clause instead; a high score with clean probes renders no clause at all. |

## Model

| Element | Owner | Valid states | Invariants | Requirement | Failure if absent |
| --- | --- | --- | --- | --- | --- |
| `QualityDimension.probes?` | `src/types/schema.ts:142-151` | absent, or 1..6 typed probes | ids unique per dimension; caps enforced at parse | D1, D4, R1 | There would be no composed why, and the label design would return. |
| `PROBES_PER_DIMENSION=6`, `PROBES_TOTAL=48` | same file, beside the schema | constants | a valid rubric can never exceed pi-jev's limits | D4, R1 | The protocol limit would become a runtime failure instead of an authoring error. |
| `Scorer.explain?` (optional) | `src/quality/evaluate.ts:13-22` | absent or implemented | never affects the score path | D3, R2, R7 | Existing fake scorers would break, and the drift question would return. |
| Battery assembly (`<dim>.<probe>` ids, scoreless state) | `src/quality/jev-scorer.ts` beside `JUDGE` (`:17`) | one request or none | all-or-nothing answers | D5, R3, R4 | Partial diagnoses would be indistinguishable from full ones. |
| Renderer (template table + `RATIONALE_MAX`) | `src/quality/jev-scorer.ts` | absent line or ≤240 chars, ≤3 clauses | deterministic; omits unknown answers | D7, R5, R13 | Three surfaces would each invent their own wording. |
| `diagnosis[]`, `rationale?` on the verdict | `src/types/schema.ts:184-191` | absent or filled | additive, optional, never in the digest | D6, D8, R6 | The evidence would not be in the record, or the pin would move for output. |
| `brief.quality.judgment?` | `src/types/pi.ts` + `descriptor.ts:130-142` | absent or the recorded view | read-only projection | D12, R9 | The note would stay a guess. |
| `RecallCase.rationale?` | `src/types/pi.ts:221-243` + `ranker.ts:171-184` | absent or one line | by reference; exactly one; budgeted | D12, R10 | The exemplar would show the wrong dimension's reason or break the token bound. |

## Exclusions

- Any change to the scoring judgment, the score, the gate, the bars or `compoundDecision` (D2, D3, R7).
- Model-authored prose; any new dependency; a new table/event type/migration (R11).
- `diagnosis`/`rationale` inside `Quality`, `rulerDigest` or any floor input (D9).
- Backfilling old verdicts; sharing one probe battery across tasks (D1: each task composes its own).
- Probes for the BRIEF's `RecallSet` notes (`recall.ts:73-...`); this unit puts the line on the query path's
  `RecallCase`, which is what "beside the exemplar's note" names.

## Alternatives

| Alternative | Rejected because |
| --- | --- |
| A single `choice` label per dimension (the first draft) | One label asks the model to categorise its own number — a narration, not evidence; the owner's decision. |
| Model-authored prose (a schema-LLM “rationale”) | pi-jev emits no text (`pi-jev/src/types.ts:3-10`, README:165) and a second model would be a new dependency and a new failure surface. |
| Probes in the SCORING request (one call) | pi-jev sends one prompt per call (`client.ts:44`), so it would change what the numbers are judged against — the drift this unit exists to avoid (D2, R2). |
| Free-form per-task probe text with no caps | Bounds would move to runtime and a valid task could overflow `MAX_QUESTIONS`/`MAX_REQUEST_BYTES`; the parse-time cap makes it impossible (D4). |
| Render at read time only (store the answers, not the line) | Then a later template change would silently rewrite what past agents were shown; the log must record what was displayed (D6). |
| Probes in the global `quality` block instead of per dimension | The battery diagnoses ONE dimension's criteria; a shared battery could not say which dimension failed (D1). |

## Open questions for the lead

1. **Probe caps** — `6` per dimension / `48` total (recommended: well under pi-jev's 128, and enough for a
   five-fault diagnosis). Confirm or re-set.
2. **`RATIONALE_MAX = 240`, 3 clauses** — enough for a rendered pattern with the dimension prefix and the
   divergence clause; confirm the bound.
3. **Divergence clause wording** — it asserts "the dimension statement may be too vague"; it is surfaced only
   when the score is low and every probe is clean. Confirm the wording is acceptable as a code-owned string.
4. **Surface (c) scope** — query-path cases only (recommended), or the brief's `RecallSet` notes too.
