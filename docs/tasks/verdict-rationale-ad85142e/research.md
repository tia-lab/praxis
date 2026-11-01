# Research — per-dimension verdict rationale, from jev to the three surfaces

Task: verdict-rationale · Hash: ad85142e · Gate: G1 · Date: 2026-10-30 · Method: read the scorer path,
the recorded verdict, the three consumption builders, and pi-jev's own wire contract and validation.
Every claim cites `path:line`. No code was written for this dispatch.

## 0. The constraint that decides the whole design: jev cannot write prose

pi-jev's answer kinds are exactly three — `choice` (one named option out of a `criteria` map),
`noul` (a probability), `score` (an index into 2-10 ordered levels) — declared at
`node_modules/pi-jev/src/types.ts:3-10` and documented at `node_modules/pi-jev/README.md:69,76-83`.
There is **no free-text answer kind**, and the README says so explicitly: pi-jev "does not calibrate
judgments, aggregate multiple" (`:39`) and "Do not infer that this package is a model runtime or a
text generator" (`:165`).

So a per-dimension "rationale" cannot be model prose passed through. It can only be:
**a label chosen from a fixed, code-owned vocabulary, rendered into a bounded sentence by Praxis.**
That is a real limitation and the spec states it in the requirements rather than hiding it. (If the
owner wants model-authored prose, that is a different dependency decision — out of this unit.)

## 1. What the scorer does today

- The port: `Scorer.score` (`src/quality/evaluate.ts:13-22`) returns
  `{ dimensions: {id, score}[], rationale: string, scorer: string }` — ONE string for the whole
  verdict, no per-dimension reason.
- The real adapter: `jevScorer` (`src/quality/jev-scorer.ts:38-60`) sends **one `noul` question per
  rubric dimension, keyed by the dimension id** (`:42-47`, question shape at `:45`), inside a single
  request whose state is `{ goal, artifact, subjectDigest }` (`:48`). It reads back
  `noulOf(response.answers[id])` (`:27-32`, `:52`).
- What the top-level `rationale` actually contains today is a **stringified score list**:
  `response.model + " noul: " + dimensions.map(d => d.id + "=" + d.score.toFixed(2)).join(", ")`
  (`jev-scorer.ts:56`). It is not a reason; it is the numbers again.
- The verdict is assembled in `evaluateArtifact` (`evaluate.ts:44-90`): MIN is the headline score
  (`:73-75`), the compound decision is computed at `:71-72`, and the result is parsed against
  `QualityVerdictSchema` (`src/types/schema.ts:180-200`). The per-dimension entries are
  `{ id, score, key? }` (`schema.ts:184-191`); `rationale` is a single 2000-char string at `:196`.
- The recorded event: the engine appends `quality.verdict` with that payload
  (`src/runner/engine/advance.ts:193-210`), and `qualityHistory` reads it back
  (`src/runner/engine/quality-loop.ts:32-45`).

## 2. Where a rationale would be consumed (all three, with their builders)

**(a) The refusal handback.** `qualityFeedback` (`src/pi/operations.ts:243-299`) rewrites
`detail.quality` for a quality refusal, and its per-dimension entries are
`{ id, score, statement, belowThreshold }` (`:264-269`). The verdict it reads is the one the engine
attached to the refusal detail (`advance.ts:276-283`, `quality: verdict.quality`). A per-dimension
`rationale` on the verdict would flow into that array with one line.
(The refusal already carries the recalled exemplars — `recallFeedback`, `operations.ts:388-425` — so
the rationale sits beside them, which is exactly the requested pairing.)

**(b) Before `op=note`.** Two facts make this cheap: the note is owed on the step that just passed,
and the recorded verdict is reachable by step+version. `noteStanding` (`src/runner/note-gate.ts:357-369`)
names the pending step; `qualityHistory(store, instance, step)` (`quality-loop.ts:32`) returns the
recorded verdicts for it; the brief already shows `brief.quality` (`src/pi/descriptor.ts:130-142`,
schema at `src/types/pi.ts:120-146`). So the pre-note surface is a projection of an existing read —
no new store read, no new event.

**(c) Recall.** `collectCases` already pairs each accepted artifact with its `quality.verdict`
(`src/quality/ranker.ts:171-184`, the verdict map at `:177-184`) and the payload case is
`RecallCaseSchema` (`src/types/pi.ts:221-243`). The "relevant dimension" is the one being recalled for:
the weak set in the brief path (`src/quality/recall.ts:73-...`) and the caller's `tags` in the query
path (`ranker.ts:299-303`). Budget: `lessonTokens` (`ranker.ts:77-84`) computes the per-case cost and
`applyBounds` (`:263-286`) enforces the ~1200-token budget; `RECALL_TOKEN_BUDGET = 1000` is the brief
path's own bound (`recall.ts:32`). A rationale must be counted there or the budget silently breaks.

## 3. The rubric digest is not affected (and must not be)

`rulerDigest` (`evaluate.ts:29-31`) digests `{ ruler: quality, floors }` — the Quality DECLARATION and
the bars. The verdict is an OUTPUT, not an input, so adding a field to the verdict changes no digest,
no pin and no bar. Conversely, a rationale must never be added to `Quality`, or every task's digest
and pin would move for an evidence field.

## 4. SCORE DRIFT — the risk, stated precisely

pi-jev serialises **one request body per call** (`node_modules/pi-jev/src/client.ts:44`:
`JSON.stringify({ model, state, questions })`), with 1..128 questions allowed (`:5`, `:34`). So:

- Adding a rationale question to the SAME request changes the prompt the model judges against. The
  `noul` questions are unchanged as objects, but the model sees more to answer, and nothing in the
  protocol pins the numbers to be stable across that change. **The drift is structural, not
  hypothetical**, and it cannot be quantified from this repository: there is no recorded live A/B, and
  the suite's scorers are fakes.
- If the numbers move, every existing bar, every ratchet watermark and every test expectation built
  on scored values becomes incomparable — the "clean re-test baseline" is lost. That is why the spec
  pins the safer of the two shapes (D2): a **second, explain-only call**, leaving the scoring request
  byte-for-byte what it is today. Drift is then zero by construction, and provable: the suite already
  captures the scoring request (`tests/quality/jev-scorer.test.ts:53-70` asserts the exact question map
  and state), so "unchanged" is an assertion, not a hope.

## 5. COST

- **One call, scores + rationale**: 1 round-trip, one prompt carrying the artifact once. Cheapest in
  tokens; pays in unquantified drift (§4).
- **Two calls** (recommended): the scoring call is unchanged, the explain call re-sends the same
  `state` (artifact included) with only `choice` questions. Cost is roughly **+1 model call and ~the
  same input tokens again per submit**; output is tiny (one label per dimension). Both fit the
  protocol limits (`MAX_REQUEST_BYTES = 262_144`, `MAX_QUESTIONS = 128`, `client.ts:5,34`).
- A saved call exists already: the score cache reuses a recorded verdict for identical bytes and
  ruler (`evaluate.ts:94-140`), so a repeated submit of the same artifact costs **zero** explain calls
  as well (the rationale rides along on the reused verdict, §6).
- At 32+ concurrent agents the difference is one extra model call per (uncached) submit — bounded and
  parallel, not a queue.

## 6. Two existing properties the design must not break

- **The score cache** (`evaluate.ts:94-140`) reuses a recorded verdict for the same bytes+ruler. A
  rationale stored on the verdict is therefore reused with it — consistent by construction, and no
  extra call. If the rationale were computed at read time instead, two reads of the same artifact
  could disagree, which is why §"Outcome" stores it at evaluation time.
- **Fail-closed scoring**: a missing/throwing scorer degrades to `unavailable`
  (`evaluate.ts:35-37`). An explain failure must NOT degrade the verdict the same way — the score is
  already earned, and the rationale is evidence, not a gate input.

## 7. What is unknown (labelled)

- **No live measurement of the label vocabulary's usefulness.** Whether five fixed labels per
  dimension say enough to steer a rework is a judgement, not a measurement; the alternative (free
  text) is not available from this dependency.
- **No drift measurement for the one-call variant** (§4). If the owner ever wants it, it needs a live
  A/B on a frozen artifact set — out of scope here.
- **The recall budget's real headroom** is untested with rationales attached; the spec makes the
  rationale part of `lessonTokens` so the bound stays exact rather than assumed.
