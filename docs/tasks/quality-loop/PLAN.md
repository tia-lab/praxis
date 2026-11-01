# Quality rework loop + flow scoring — implementation plan

## Goal
Make Praxis quality gates drive self-correction and whole-flow correctness for long-running,
agent-coordinated flows: a task below its floor is refused with **actionable per-dimension feedback**
and retried under a **bounded budget** that escalates to a durable `blocked` state; the flow exposes an
**aggregate quality signal**; and a **flow-outcome judgment** checks the artifact chain against the
original request.

## Design source
Based on the in-session design. Grounded in current code: `src/quality/evaluate.ts` (the `Scorer`
port, `advanceEvaluated`, `evaluateArtifact`), `src/quality/jev-scorer.ts`, `src/runner/engine.ts`
(gate + quality enforcement, refusal path, `setStatus`, `listEvents`), `src/runner/step.ts` (`gate`,
`refused`), `src/types/schema.ts` (`QualitySchema`, `QualityVerdictSchema`, `InstanceStatusSchema`,
`ResultSchema`), `src/types/pi.ts` (`StepDescriptorSchema`, `FailureDetailsSchema`, `CODES`),
`src/types/errors.ts` (the `Code` union), `src/pi/tool.ts`, `src/runner/result.ts`, `src/store/*`.

Grounded facts used below: `InstanceStatus` is `running|completed|failed` (a `blocked` value is new);
`listEvents(store, instance)` already exposes the full event history, so attempt-count, no-progress,
and the digest score-cache are **derivable with no new store columns**; `instance.created` records
only `requestId`, so Unit 4 must also persist the original request goal.

## Boundaries (hold across all units)
- Praxis **enforces and records**; it never authors remediation prose. Feedback = the typed verdict +
  the rubric's own dimension statements. The agent/Occam decides *how* to fix.
- Budgets, no-progress, escalation, caching are **code-enforced resource bounds**, never prompt text.
- All scoring stays **jev/pi-jev typed judgment** — no new reasoning engine, no new store.
- No exactly-once claim; the digest score-cache follows the durable intent→receipt pattern.
- Quality-history learning/analytics is **Occam/Jung** territory — out of scope here.
- Each unit is a separate authorized unit through the WORKFLOW gates; this file is a plan, not a grant.

## Units

### Unit 1 — Rubric-in-brief + actionable refusal feedback
The agent sees the quality standard **before** it submits, and on a quality refusal receives the
per-dimension scores + rationale so it can fix the *named* dimensions.
- `src/types/pi.ts` — `StepDescriptorSchema.brief` gains optional
  `quality: { dimensions:[{id,statement}], threshold, policy }`. (~12)
- `src/pi/tool.ts` — populate `brief.quality` from the step's effective quality (`task ?? flow`); on a
  `QUALITY_BELOW_THRESHOLD`/`QUALITY_REQUIRED` failure make the failure `detail` carry
  `{ overall, threshold, dimensions:[{id,score,statement}], weakest, rationale }`. (~18)
- `src/runner/engine.ts` — both refusal `throw fail(...)` sites include
  `...(verdict.quality ? { quality: verdict.quality } : {})` in details. (~8)
- Tests (`tests/pi/*`, `tests/runner/quality.test.ts`) — brief carries the rubric; a refusal detail
  names the failing dimensions with scores. (~40)
- Acceptance: a start/read descriptor shows the rubric; a below-threshold submit returns detail listing
  each dimension score and which are below; full suite green. Clip rubric text to bound descriptor size.
- **LOC: ~38 src + ~40 test ≈ 78.** Risk: low.

### Unit 2 — Bounded retry: attempt budget, no-progress, `blocked` escalation, digest score-cache
A task that cannot reach its floor self-retries up to a budget, stops early if not improving, escalates
to a durable `blocked` state (not death), and never re-scores identical bytes.
- `src/types/schema.ts` — `InstanceStatusSchema` adds `"blocked"`; `QualitySchema` adds optional
  `maxAttempts` (default e.g. 3); the instance row carries a `blockedReason`. (~14)
- `src/types/errors.ts` + `src/types/pi.ts` CODES — add `QUALITY_BLOCKED` (kept in sync). (~4)
- `src/runner/engine.ts` — on a quality refusal: derive attempt count and the previous version's score
  from `listEvents` (count `quality.verdict` for the step); if `attempts >= budget` OR
  `score <= previousScore`, append an `instance.blocked` event, `setStatus("blocked", currentStep,
  reason)`, and throw `QUALITY_BLOCKED` with the verdict + history; otherwise keep the node current for
  retry exactly as today. (~35)
- `src/quality/evaluate.ts` (`advanceEvaluated`) — before scoring, scan `listEvents` for an existing
  `quality.verdict` with the same `artifactDigest` **and** `rubricDigest`; reuse it instead of calling
  the scorer (digest cache). (~20)
- `src/runner/engine.ts` read/inspect + `src/runner/result.ts` — surface `blocked` status and reason
  in the parent result / `nextAction`. (~12)
- Tests — budget exhausts → blocked + event; no-progress → blocked; cache hit → scorer NOT called
  (counting fake); blocked is durable and re-openable; an improving scorer still passes. (~75)
- Acceptance: with a fake below-threshold scorer a step blocks after `maxAttempts`, records
  `instance.blocked` + the last verdict, status reads `blocked`; an identical-digest resubmit does not
  call the scorer; a scorer that crosses the floor passes.
- **LOC: ~85 src + ~75 test ≈ 160.** Risk: medium — derive-not-store attempt counting must be exact,
  and `blocked` must round-trip through every status reader and `src/store` row validation.

### Unit 3 — Flow aggregate quality
One at-a-glance trust signal for the whole flow, derived, no model call.
- `src/types/schema.ts` — new `flow.quality` event payload; optional `quality` on `ResultSchema`
  (⚠ changes the “exactly six keys” R11 contract — owner decision). (~15)
- `src/runner/engine.ts` — on `instance.completed`, aggregate all `quality.verdict` scores (MIN overall
  + per-step vector) and append `flow.quality`. (~22)
- `src/runner/result.ts` — include the aggregate (if R11 extended) or expose via read. (~15)
- Tests. (~40)
- Acceptance: a completed flow has a `flow.quality` event = MIN of step scores with the vector; the
  result surfaces it.
- **LOC: ~52 src + ~40 test ≈ 92.** Risk: low–medium (the R11 change is why it is its own unit).

### Unit 4 — Flow-outcome scorer (did we build the right thing)
At flow completion, judge the artifact chain against the ORIGINAL request; on drift, route back to the
divergence step.
- `src/runner/engine.ts` `start()` — persist the original request goal in `instance.created` (scorer
  state). (~8)
- `src/types/schema.ts` — flow doc gains optional `outcomeQuality` rubric (dimensions judging the
  chain). (~12)
- new `src/quality/flow-outcome.ts` — at the terminal node build state `{ originalRequest, chain of
  accepted artifacts }`, score via the same `Scorer`; below → route to a configured divergence target
  (reuse refuse-edge mechanics); record `flow.outcome.verdict`. (~45)
- `src/runner/engine.ts` — wire the terminal-node check + routing. (~18)
- Tests. (~60)
- Acceptance: a chain that passes every step floor but contradicts the original request is refused at
  completion with a recorded outcome verdict and routed to the divergence step; a coherent chain
  completes.
- **LOC: ~83 src + ~60 test ≈ 143.** Risk: higher — chain-vs-request state shaping and divergence
  routing are the most novel; needs its own spec round.

## Totals
| Unit | Source | Test | Total |
|---|---|---|---|
| 1 Rubric + feedback | ~38 | ~40 | ~78 |
| 2 Bounded retry + escalation + cache | ~85 | ~75 | ~160 |
| 3 Flow aggregate | ~52 | ~40 | ~92 |
| 4 Flow-outcome scorer | ~83 | ~60 | ~143 |
| **All four** | **~258** | **~215** | **~473** |

## Recommended sequencing
**Units 1 + 2 together** — the self-correcting bounded loop, the core of the request (≈ 238 LOC). Then
Unit 3 (≈ 92). Then Unit 4 (≈ 143) after its own spec.

## Open owner decisions (settle before submit)
1. Unit 3 extends the six-key `Result` contract (R11) — approve, or keep the aggregate as an
   event-only read.
2. Unit 2 `maxAttempts` default and scope — per-task, per-flow, or both; and the default number.
3. Unit 4 ordering — confirm it runs after 1+2+3 and gets its own spec gate.
4. Whether to submit 1+2 as a single engineer unit (recommended) or as two.
