# Plan — recalled examples on a below-bar refusal

Task: quality-recall-feedback · Hash: e829ed25 · Gate: G3 · Date: 2026-10-30

## Shape

| File | Change |
| --- | --- |
| `src/pi/operations.ts` | one new private helper `recallFeedback`; in `submitOperation`'s quality branch the rethrow becomes `throw recallFeedback(reviewed, …, refusedStep, verdict)`. Nothing else in the catch moves. |
| `.pi/skills/praxis/SKILL.md` §4 | three lines: the refusal already carries `detail.recall`; study it; `op=recall` with the same tags and a higher `max` gets more. |
| `tests/pi/recall-feedback.test.ts` | new: a refusal with a warm store carries ≤3 ranked cases intersecting the refused dimensions with provenance; a cold store omits the field; an `ARTIFACT_INVALID` refusal carries none. |

## The helper

```
recallFeedback(error, options, step, verdict) -> AppError
  dimensions  = the rubric of the step's task (pinned flow), id -> statement
  refused     = verdict.refused, or every rubric id when that is empty (the MEAN gate alone)
  tags        = refused ∩ rubric ids
  need        = "passing work for <id>: <statement>; …" clipped to 500
  payload     = recallExperience(options, { need, tags, max: 3 })
  cases === 0 -> return the error untouched (no field)
  otherwise    -> fail(code, message, { ...detail, recall: payload })
```

Gated on `verdict !== undefined`: no recorded verdict means no below-bar judgment to point at
(`QUALITY_REQUIRED`, a config refusal, keeps its current shape). Wrapped in `try/catch`: any failure
returns the refusal exactly as it was, so the typed code is never lost (the same best-effort rule as
`qualityFeedback`).

## Checks

| Check | Assertion |
| --- | --- |
| warm store | the refusal's `detail.recall` has `count ≤ 3`, `cases` with provenance and lesson tags intersecting `refused` |
| cold store | `detail.recall === undefined` and the rest of the detail is unchanged |
| other refusals | an `ARTIFACT_INVALID` refusal has no `recall` key |
| read-only | the store's row counts and file digest are unchanged (recall writes nothing) |
| untouched | `git diff` shows only `operations.ts`, the skill, the new test and this folder; the gate, `compoundDecision`, the ratchet, the ranker and the envelopes are byte-identical |
| typescript / suite | `tsc --noEmit` 0; the full suite green under the no-network stub |

## Out of scope

Changing the ranker, the scoring, the gate, the engine, the store, the envelope or the six-key result;
persisting the recall; attaching examples on a pass; more than three cases; a new typed recall field in
`src/types/pi.ts` (`detail` stays `z.unknown()` — the shape is the existing `RecallEnvelope`).
