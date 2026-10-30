# Execution Learning Loop — task-level implementation plan (for wB:p22)

Build the task-level loop frozen in `docs/execution-learning/DESIGN.md` (F1–F8, O1–O7). Execute
in one pass, in the slice order below; each slice keeps `tsc` clean and the suite green before the
next. STOP and report immediately if a design point is ambiguous or a scope path must expand — do
not improvise outside the write boundaries.

## Reuse (most of the plumbing already exists)
- Events + `EVENT`/`EventTypeSchema` (dotted lowercase) — `src/runner/engine/types.ts:7`,
  `src/types/schema.ts:76`. New event types validate as-is.
- The `Scorer` port + `evaluateArtifact` (MIN aggregation, floor) + `advanceEvaluated` +
  `cachedVerdict` — `src/quality/evaluate.ts`.
- The deterministic section gate `missingFor` — `src/runner/requirements.ts`; reuse its shape for
  the note adequacy gate.
- Terminal outcomes already recorded: `quality.verdict`, `artifact.accepted`, `instance.failed`,
  `quality.continued` — so the note's OBJECTIVE facts are already in the log and are DERIVED, never
  duplicated.
- `failureOutcome` + `recordAcceptance` — `src/runner/engine/quality-loop.ts`,
  `src/runner/engine/advance.ts`.
- The brief/`stepDescriptor` + `qualityFeedback` — `src/pi/tool.ts:180,306`; actor/provenance via
  `parseWith(ActorSchema, "pi-session:"+shortDigest(sessionId))`.

## Write boundaries (scope paths — do not touch others)
`src/types/schema.ts`, `src/types/pi.ts`, `src/runner/engine/types.ts`,
`src/runner/engine/advance.ts`, `src/runner/engine/quality-loop.ts`, `src/quality/evaluate.ts`,
`src/quality/index.ts`, `src/quality/bar.ts` (new), `src/quality/recall.ts` (new),
`src/runner/note-gate.ts` (new), `src/pi/tool.ts`, `tests/**`. Keep every file < 600 lines.

---

## Slice 1 — types & events
- `src/runner/engine/types.ts`: add to `EVENT` — `learningNote: "learning.note"`,
  `barRaised: "bar.raised"`, `barContested: "bar.contested"`, `recallSelected: "recall.selected"`.
- `src/types/schema.ts`: add `LearningNoteSubjectiveSchema` (`whatWrong`, `whatRight`, `whatBetter`
  strings; `tags: array<{dimension, lesson}>`), `LearningNoteSchema` (the STORED form:
  `{task, taskVersion, instance, step, noteVersion, subjective|null, stub:boolean, provenance}` —
  objective is derived, not stored), `BarRaisedSchema` (`{from, to, window, formulaId, at}`),
  `RecallNoteSchema`/`RecallSetSchema` (trimmed notes + the weak-set + each note's relevance).
- `src/types/pi.ts`: extend the brief `quality` block with `aggregation: "min"`, `judging` (the
  stance string), `threshold` = the EFFECTIVE bar, and `recall: RecallSet`.
- Accept: `tsc` clean; new schemas parse; new event types match `EventTypeSchema`.

## Slice 2 — adaptive bar (`src/quality/bar.ts`, new)
- `effectiveBar(store, task, quality): number` — fold the latest `bar.raised` for `(task,
  taskVersion)`; default = `quality.threshold` (the authored min_floor).
- `recomputeBar(store, task, quality, at)` — called after each terminal outcome: collect the last
  **W=5 genuine passes** for the task (derive from `artifact.accepted` + its `quality.verdict`;
  continued-FAILED never counts); compute headroom from the window's **lower-quartile** best-score,
  `stdev`, mean attempts; raise iff margin>=0.12 AND stdev<=0.08 AND mean-attempts<=2 AND
  cooldown (>=W passes since last raise), by `step=min(0.05, 0.5*(margin-0.12))`,
  clamp to `[min_floor, 0.9]`; append `bar.raised`. If a full post-raise window yields ZERO passes,
  append `bar.contested` (never auto-lower).
- Wire `effectiveBar` into `advanceEvaluated` (use it, not the static threshold) and into
  `stepDescriptor` disclosure.
- Accept: seeded stable-high history raises +0.01–0.05; noisy/high-effort history does not;
  zero-pass window emits `bar.contested`; min_floor never undercut; ceiling 0.9 held; cooldown
  blocks back-to-back raises.

## Slice 3 — learning note (record + op + gate)
- OBJECTIVE is derived (Slice 2/existing events) — do NOT duplicate it into storage.
- `src/runner/note-gate.ts` (new): `noteGate(subjective, rubric, weakest)` — deterministic: `whatBetter`
  non-empty and != `whatWrong`; `whatRight` present; `tags[]` includes `weakest`; every
  `tags[].dimension` is a real rubric id. Return typed gaps like `missingFor`.
- New tool op `note` in `src/pi/tool.ts`: agent submits the subjective lesson; gate it; on pass append
  `learning.note` (subjective + engine-stamped provenance). A step that reached a terminal outcome is
  **note-pending** (derive: terminal event for the step exists, no `learning.note` for
  `(instance,step)` yet); `submit`/advance past it is blocked until a note is recorded. Bounded note
  attempts (reuse the maxAttempts budget); after exhaustion the ENGINE appends a `stub:true`
  `learning.note` and proceeds — never a deadlock. The instance reaches `completed` only once the
  final step's note (real or stub) is recorded.
- Accept: a passed step blocks until a valid note; a trivial note is refused; stub written after the
  bounded attempts and the flow proceeds; objective facts derivable; `completed` only after the last
  note.

## Slice 4 — recall (`src/quality/recall.ts`, new) + injection + escalation
- `recallFor(store, task, quality): RecallSet` — scan `learning.note` events for the task across
  instances (pure event-scan, O6); derive each note's objective from linked events; compute the
  **weak-set** (lowest mean per-dimension over recent history, spanning bar versions), **corroboration**
  (count of independent-provenance notes tagging the same dimension, saturating `1-1/(1+k)`),
  **relevance** = 0.35*weakness-coverage + 0.25*outcome + 0.20*corroboration + 0.10*recency-by-bar +
  0.10*score-margin; **MMR** select N=3–5 within ~1000 tokens, always include >=1 passing exemplar;
  append `recall.selected` (set + relevances + weak-set) for audit. Fixed tie-break by note id so it is
  deterministic. Empty store -> empty recall.
- Inject `RecallSet` into `stepDescriptor.brief.quality.recall`.
- Escalating re-injection in `qualityFeedback` (`tool.ts:306`): on a below-floor refusal, attach the
  single most-corroborated lesson for the verdict's weakest dimension.
- Accept: seeded notes -> weakest-dimension lessons rank first, MMR dedups, N+budget respected,
  exemplar included; cold start empty; `recall.selected` recorded; refusal returns the weakest-targeted
  lesson.

## Slice 5 — disclosure wiring + tests
- Finish the brief disclosure (`aggregation`, `judging`, effective `threshold`, `recall`).
- Tests (NO network; inject a fake `Scorer` via the existing seam): bar raise / no-raise / contested /
  cooldown / ceiling / min_floor; note gate pass / trivial-refuse / stub-fallback / note-pending blocks
  advance; recall ranking (weakness-coverage dominance, corroboration, MMR dedup, exemplar, budget,
  cold start); escalating re-injection; **across a bar raise** (old notes decay but survive; weak-set
  and corroboration span versions); **determinism** (same store state -> same brief bytes).
- Accept: `tsc` clean; full suite green (the existing 183 + new) under the no-network stub; every file
  < 600 lines.

## Report
When done, report from your SHELL to `wB:pW`:
`herdr agent prompt wB:pW 'praxis execution-learning report (sender: wB:p22): <files + LOC, tsc, test
counts, no-network confirmation, any disclosed deviation>'` and stop for review.

## Hard rules / non-claims
- F1 is a **conduct norm**, not a guarantee: do **not** claim isolation or restrict the agent's
  toolset (isolation gate #1 is out of scope). No identity or exactly-once claims.
- **No flow-level loop** (O7: task-level first). No semantic clustering of lesson text (that is
  Occam — corroboration stays the deterministic per-dimension proxy).
- Events are **additive**; no store migration, no retention policy beyond keep-all. Provenance is
  engine-stamped from the session binding only.
- Do not touch `ResultSchema`'s six keys. Do not commit (owner handles git). Keep the suite green
  throughout.
