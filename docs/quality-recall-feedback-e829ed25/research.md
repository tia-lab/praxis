# Research — recalled examples on a below-bar refusal

Task: quality-recall-feedback · Hash: e829ed25 · Gate: G1 (research-light, owner-directed) · Date: 2026-10-30
Method: read the refusal path and the recall operation as they exist; every claim cites `path:line`.
No execution beyond the suite is claimed here.

## 1. The refusal path (where the examples can be attached)

`src/pi/operations.ts:355-381` — `submitOperation`: the success path returns the `StepEnvelope`; the
catch (`:375-380`) runs `qualityFeedback(error, …)` and, **only when the code is one of the quality
codes** (`QUALITY_CODES`, `operations.ts:233`), computes the verdict summary and then rethrows:

```
const verdict = verdictSummaryOf({ ...options, instance }, refusedStep, Number(detail?.version ?? 0));
await afterOp("after_submit", { … decision: "refused", … });
throw reviewed;
```

`qualityFeedback` (`operations.ts:243-299`) already returns a **rebuilt** error:
`fail(error.code, error.message, { ...detail, quality: {...} })` — so enrichment by rebuilding is the
established pattern here, and the thrown value is the last thing the dispatcher needs to hand on.

The dispatcher's catch (`src/pi/tool.ts` `executePraxisTool`) turns any error into
`failure(error)` (`src/pi/operations.ts:133`), whose `details` is `{ code, message, detail }` with
`detail: z.unknown().optional()` (`src/types/pi.ts:299` / `FailureDetailsSchema`). **A new key under
`detail` therefore needs no type change and no envelope change** — the agent already receives
`detail.compound`, `detail.quality`, `detail.checks`.

## 2. What the gate already tells us

`verdictSummaryOf` (`operations.ts:311-341`) returns `VerdictSummary`:
`{ score, mean, dimensions[{id, score}], flagged[], refused[], rubricDigest }`, where `refused` is the
**same** `compoundDecision` the gate used (`bar.ts:290-310`), not a second opinion. So the dimensions
that failed their own bar are already computed on this path — no gate change, no extra decision.

When the refusal was the MEAN gate alone, `refused` is empty and `flagged` holds every dimension (the
tolerance band); the fallback for "which dimensions to query for" is the step's rubric dimension ids,
which the refusal already carries in `detail.quality.dimensions[]` and which can be read from the
pinned flow (`inspect(...).flow.tasks.get(node.task)?.quality`).

## 3. The recall operation (the call to mirror)

`recallOperation` (`operations.ts:443-455`):

```
recallExperience({ ...options, instance, actor: actorFor(ctx) }, { need, tags?, max? })
```

`recallExperience` (`src/quality/ranker.ts:291-308`) is **read-only**: it loads the instance, asserts
the caller is an observer of it (`assertObserver`, so the submitting session qualifies), collects the
solved cases (`collectCases`, `ranker.ts:154-227`: an accepted artifact + its verdict + a note with a
subjective half), ranks them with the injected/deterministic ranker behind `RankerPort` and bounds the
answer (`applyBounds`, ≤ `max`, ~1200 tokens). It returns `RecallPayload` =
`{ need, count, truncated, cases }` — exactly `RecallEnvelopeSchema` (`src/types/pi.ts:237-242`), i.e.
the same shape `op=recall` answers with, so an agent that has seen one recognises the other.

`recallExperience` is already imported in `operations.ts` (used by `learningView`/`qualityFeedback`), so
the call adds no import and no module edge.

## 4. Why inline rather than only on request

The refusal is the moment the agent must change something and has no idea what "good" looked like here.
`op=recall` exists but the agent must know to ask, and must build its own need text while it is
guessing. Attaching the ranked cases to the refusal costs one read-only scan on a path that has just
done a model call and a store transaction, and stops the common failure of resubmitting the same shape.
The field is bounded (3 cases) so the parent context stays bounded, and it is omitted entirely when the
store is cold, so an empty answer never appears as a field.

## 5. Unknowns / limits (labelled)

- **Not measured**: how often a below-bar refusal happens on a store that already holds cases; the
  suite seeds one, production history is unknown.
- **Ranking quality is unchanged**: the cases are chosen by the existing deterministic ranker with the
  need text built from the rubric statements; this unit does not judge whether that ranking is good.
- **The cold-store path is the common one early**: with no notes yet there are no cases, so the feature
  is silent until the project has solved work — which is exactly the intended behaviour, not a bug.
