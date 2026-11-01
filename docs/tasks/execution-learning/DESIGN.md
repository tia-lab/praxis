# Execution Learning Loop — design

**Status: design-only.** No code, dependency, schema, store or flow is authorized by this
document. It specifies the loop so an owner can freeze decisions and authorize bounded build
units later. Sequencing is P7/P8 (evidence storage → recall/learning) and sits behind the Occam
memory seam; it does not jump ahead of accepted predecessors.

## 0. What this is — and what it is not

Praxis owns **execution learning**: how to *produce an accepted artifact* for a task, and later
for a flow. This is **not cognition**. Occam is reason itself and will inherit a structurally
identical loop at the **reasoning** level. Same pattern, two levels, two owners:

- A lesson about *how to execute task T* is a **Praxis** fact (execution learning).
- A lesson about *how to reason* is an **Occam** fact (reasoning learning).

One authoritative owner per fact; no shared store, no duplicated authority, no competing copy.
Guiding sentence, extended: **Manifold assigns · Occam reasons · Praxis executes, preserves work
and learns how to execute better · Jung synthesizes across projects.** Cross-project
generalization of lessons remains Jung's, never Praxis's.

## 1. The cycle (one task)

```
  RECALL  →  BRIEF  →  WORK  →  SCORE  →  ITERATE  →  LEARN  →  RANK  →  RATCHET
    ↑                                                                          |
    └───────────────────── next agent on the same task ───────────────────┘
```

1. **RECALL** — at `start`, Praxis selects the most useful prior learning notes for this task and
   injects them into the brief. The agent begins primed by accumulated execution wisdom.
2. **BRIEF** — the brief also carries the **evaluation disclosure**: the exact standard this task
   is judged by (dimensions, current threshold, aggregation rule, judging stance). The agent
   learns the standard from the brief, **never by reading Praxis code**.
3. **WORK** — the agent produces an artifact knowing both the standard and the prior lessons.
4. **SCORE** — deterministic gate first (schema/nonce/sections), then live per-dimension judgment
   aggregated by MIN into an overall score against the current (possibly raised) threshold.
5. **ITERATE** — a below-floor refusal returns per-dimension feedback and the weakest dimension.
   A generous attempt budget lets the agent *search* for a better solution.
6. **LEARN** — at the task's terminal outcome (pass, or budget-exhausted continue/escalate) a
   **learning note** is recorded durably: why it passed/failed and what to do better.
7. **RANK** — notes accumulate; the recall function ranks them so the *next* agent gets the best.
8. **RATCHET** — the engine recomputes the task's effective threshold from stable history; the bar
   rises as competence compounds, forcing fresh lessons. The flywheel turns.

## 2. Entities

- **Task** (existing, extended): + evaluation disclosure, + recall config, + adaptive-bar state.
- **QualityVerdict** (existing): one per attempt — per-dimension scores, MIN aggregate, decision.
- **LearningNote** (new): the lesson, split into an **engine-authored objective part** (trusted)
  and an **agent-authored subjective part** (advisory, with provenance).
- **RecallSet** (new, derived): the top-N notes the recall function selected for a given start.
- **BarState** (new): the engine-computed effective threshold + the history and formula inputs
  that produced it, recorded for audit; the agent can never set it.

**Storage (O6 — CLOSED).** All four new facts are **append-only event types on the existing
SQLite event log** — `learning.note`, `bar.raised`, `bar.contested`, `recall.selected` — with no
second authority: BarState is the latest `bar.raised` folded per task, and recall reads the
`learning.note` events directly. **No projection index, no RAG, no jev-search** — option (a), pure
event-scan. Rationale (owner): even a large project stays well under ~1M notes, SQLite read/scan at
that size is milliseconds, and this is not a performance-critical system — keep it simple.
Retention: keep all (immutable evidence); recall still reads only a bounded recent window.
Migration is additive (new event types; old readers ignore unknown types). If scale ever demands, a
derived, rebuildable index is the first lever — but not now.

## 3. The brief the agent receives (no code access)

The step descriptor/brief is the *only* channel for the standard. It must contain:

- the task goal, the output schema, the section contract (`requires`);
- the **evaluation disclosure**: each rubric dimension id + statement; the **current effective
  threshold**; the **aggregation rule** (overall = MIN of dimensions — so every dimension must
  independently clear the floor); the **judging stance** (an independent model scores each
  dimension in [0,1] for how fully the standard is met, over the artifact JSON + the goal);
  and a note that the bar may rise over time;
- the **recall payload**: the RecallSet — distilled lessons from prior agents on this task.

Consequence for testing: a live test is only valid if the agent works from the brief, not from
reading `src/`. (The earlier 0.85 run read the scorer source — that is exactly the access we are
removing; the standard must instead be *given*.)

## 4. Scoring and iteration (retry = search)

- **Generous `maxAttempts`** — the budget is a search for a better solution, not a 3-strike cap.
- **Replace the hard stall rule.** Today the loop stops on the first non-improvement
  (`score <= previous`). That fights exploration and is brittle under noisy model scores. Replace
  it with a **noise-tolerant no-progress window**: stop only on true budget exhaustion, or when
  the best score has not improved beyond a margin across the last K attempts (K and the margin
  configured), so a single dip or score wobble does not end the search.
- **Escalating re-injection.** A refusal is not a flat repeat: because every submit routes through
  the runtime, Praxis re-primes the brief with increasingly pointed help — attempt 1 names the
  weakest dimension and surfaces its lessons; a further miss injects the single most-corroborated
  lesson for that dimension plus the exact feedback. Recall precision rises with difficulty. This
  is a pure runtime behavior.
- Every attempt's verdict stays recorded (as today); the digest cache still prevents paying twice
  for identical bytes.

## 5. The learning note (O3 + O4 — CLOSED)

Recorded at the task's terminal outcome. Two parts:

- **Objective (engine-authored, trusted):** task (path, version), instance id, final outcome
  (pass / continued-failed / escalated), the final and best per-dimension scores, attempts used,
  the artifact digest the note refers to, the bar level in force, timestamps.
- **Subjective (agent-authored, advisory):** `whatWrong` (per weakest dimension, with the score
  it had), `whatRight` (what already held and did not need fixing), `whatBetter` (a concrete,
  actionable improvement for the next attempt), and short per-dimension tags.

The objective part cannot be forged by the agent; the subjective part carries provenance (which
session/model wrote it) so recall can weight corroboration. Notes are **immutable evidence**;
corrections are new notes, never edits (versioning + provenance per the contract).

**Enforcement (O3).** The two parts are enforced differently:

- **Objective part — unconditional, engine-written.** Recorded automatically at every terminal
  outcome; no agent action is needed, so the substrate always holds the objective record even if
  the agent writes nothing. F2 is therefore never fully skipped.
- **Subjective part — required, deterministically gated, but never a deadlock.** It is a mandatory
  closing reflection checked by a deterministic adequacy gate (same spirit as section
  requirements): it must name the actual weakest dimension by id, and carry a non-empty
  `whatBetter` distinct from `whatWrong`. A trivial stub is refused. Omission does not block
  forever: bounded attempts to produce a valid note, then the engine writes a `"no lesson
  provided"` stub with provenance and the instance completes — the omission is recorded against
  that agent's provenance, never a hang.
- **Accepted vs closed.** The artifact is accepted at the quality gate (the work, never discarded
  over a note problem); the instance reaches `completed` only once the reflection is recorded or
  stubbed. Acceptance = artifact meets bar; closure = lesson preserved.
- **Why a coerced note is harmless.** Recall ranking (§6) down-weights empty/escalated-outcome and
  uncorroborated notes and refuses trivial content, so a stub ranks last and rarely surfaces.
  Enforcement guarantees a note exists; recall ranking guarantees only good notes propagate.

**Note schema (O4).** One immutable note per terminal outcome, keyed to `(task, instance)`:

```json
{
  "task": "tasks/discovery/research",
  "taskVersion": 2,
  "instance": "if5e…",
  "noteVersion": 1,
  "objective": {
    "outcome": "pass|continued-failed|escalated",
    "barLevel": 0.60,
    "bestScore": 0.85,
    "dimensions": [ { "id": "grounded", "score": 0.85 } ],
    "weakest": "grounded",
    "attempts": 1,
    "artifactDigest": "sha256:…",
    "scorer": "jev-1.14.0",
    "at": "2026-10-30T…"
  },
  "subjective": {
    "whatWrong": "…",
    "whatRight": "…",
    "whatBetter": "…",
    "tags": [ { "dimension": "grounded", "lesson": "cite file:line for every claim; grep -n the anchor" } ]
  },
  "provenance": { "agent": "pi-session:…", "model": "…" }
}
```

- The `objective` block and `provenance` are **engine-written**; `subjective` is the agent's only input.
- **Tags are keyed by rubric dimension id** (reference-checked against the task's dimensions), so weakness-coverage and corroboration are deterministic lookups, no NLP.
- **Provenance is engine-stamped** from the Pi/Manifold binding (never an untrusted request field), so corroboration cannot be forged by one agent posing as many.
- **Adequacy gate (O3):** `whatBetter` non-empty and distinct from `whatWrong`; `whatRight` present; `tags[]` includes at least `objective.weakest`; every `tags[].dimension` is a real rubric id.

**Across a bar raise.** A raise adds a level; it never rewrites history — a note that passed at 0.60 stays forever a 0.60-pass (immutable). Recall's recency-by-bar-version (§6) decays old-bar notes (~×0.7 per level) but keeps them available, so recall is never empty after a raise: transferable lessons still surface, lower-weighted, until fresh new-bar passes re-top the ranking. Two things **span bar versions** so a raise does not reset the substrate: the **weak-set** (the bottleneck dimension carries across levels) and **corroboration** (counted per dimension across versions, so the substrate grows more trustworthy over the task's whole life). The intended difficulty — first new-bar agents fail more, lean on decayed lessons plus feedback, climb and re-seed — is bounded by §7's `bar.contested` signal and the cooldown.

## 6. The recall function (O1 — CLOSED)

At `start`, choose the best lessons for this task. Ranking is **deterministic, auditable and
owner-tunable** (never agent-chosen), and stays *selection*, not *synthesis* (synthesis across
tasks/projects is Occam/Jung). Frozen defaults:

**Per-note relevance** = weighted sum of five signals, each normalized to [0,1]:

| Signal | Weight | Meaning |
| --- | --- | --- |
| weakness-coverage | 0.35 | does the note's `whatBetter`/tags address the dimensions currently weakest across recent history? (targets the MIN-gate bottleneck) |
| outcome | 0.25 | pass = 1.0 · failed-with-concrete-`whatBetter` = 0.5 · empty/escalated = 0.1 |
| corroboration | 0.20 | independent agents recording a similar lesson, saturating as `1 − 1/(1+k)` |
| recency-by-bar-version | 0.10 | notes under the current bar ≈ 1.0, decaying ~×0.7 per older bar level, so lessons calibrated to a lower bar retire themselves |
| score-margin | 0.10 | how far above the floor the note's artifact scored |

**Selection** is MMR-style for coverage, not top-N duplicates: pick the highest-relevance note,
then down-weight remaining notes that repeat an already-covered dimension+lesson, repeat until N
or the token budget. Always include ≥1 passing exemplar when one exists.

**Bounds:** N = 3–5 notes; the recall payload is capped at ~800–1200 tokens, each note trimmed to
its subjective core (`whatWrong`/`whatBetter`/tags + the score it hit) since the objective detail
is already in the evaluation disclosure.

**Cold start:** no notes → empty recall; the brief still carries the standard; the first agent's
note seeds the substrate. No fabrication.

**Recorded:** the RecallSet, each note's computed relevance and the weak-set used are stored, so
"why these lessons" is reproducible.

## 7. The adaptive bar (O2 — CLOSED)

The effective threshold rises with proven, *stable*, easily-earned competence — computed by the
engine, never by the working agent (an agent may not amplify its own ceiling). Frozen defaults
(all tunable):

**Trigger.** Re-evaluated after each terminal task outcome (cheap); it only *acts* when a full,
qualifying window has accumulated. Evaluate often, raise rarely.

**Window.** The last **W = 5 genuine passes** (independent runs). Continued-FAILED artifacts never
count, so `onFailure=continue` cannot inflate the bar.

**Raise only when ALL hold over the window:**
- headroom: `margin >= 0.12` — passes clear the floor comfortably;
- stability: `stdev(scores) <= 0.08` — consistent, not a fluke;
- low effort: `mean attempts <= 2` — agents pass easily, so the bar is too low;
- cooldown: `>= W` passes since the last raise — no runaway ratcheting.

**Robustness.** Headroom is measured from the window's **lower-quartile** best-score, not the
mean, so one lucky high score cannot lift the bar.

**Step (small, earned).** `new_floor = clamp(min_floor, old_floor + step, ceiling)` with
`step = min(0.05, 0.5 * (margin - 0.12))` — a modest headroom nudges ~+0.01–0.02, a large headroom
caps at +0.05.

**Floor / ceiling.** `min_floor` = the task's originally authored threshold (never below).
`ceiling ~= 0.9` — above that, model-judge noise dominates and breeds gaming/deadlock.

**Never auto-lowers.** The ratchet keeps “done means more.” If a **full window under the new bar
yields zero passes**, emit a loud **`bar.contested`** signal for owner review; the owner lowers or
adjusts by authorized decision — Praxis never silently relaxes it.

**Versioning & audit.** Each raise publishes a new task version; a `bar.raised` event records
`{from, to, window stats, formula id, timestamp}`, reproducible and surfaced in the next brief's
evaluation disclosure. Old lessons decay by bar-version (ties to §6 recency).

## 8. Flows (O7 — CLOSED: task first, then apply at scale)

When flows adopt the mechanism: a **flow-outcome verdict** (did the whole flow build the right
thing, not just pass each step), **flow-level learning notes**, a **flow recall** passed at flow
start, and a **flow adaptive bar** — all scoped to (flow path, version), mirroring the task-level
entities exactly. Adopt only after the task-level loop is proven, to avoid two unproven layers at
once. The sequence is frozen: get the **task-level loop working exactly as wanted first**, then
apply the identical pattern at scale to flows — reusing the same event types and primitives, scoped
to (flow path, version). Flow-level additionally depends on the flow-outcome scorer (the earlier
Unit 3/4), which is not built. Neither the flow loop nor flow evaluation exists yet.

## 9. Ownership and boundaries

- **Praxis owns execution-learning facts** (how to execute task/flow X). **Occam owns
  reasoning-learning facts.** Structurally identical loops, different levels, no shared store.
- The **standard is disclosed to the agent via the brief**, never by code access.
- **Enforcement vs. norm (the honest line).** Praxis enforces the *outcome* in code: the artifact
  does not advance unless it meets the independent judge's bar, and the agent is re-primed on every
  failure (fail-closed). Praxis does **not** force the agent's internal compliance — that it reads
  and heeds recall, or that it never peeks at `src/`. Broker-only injection *shapes behavior*; it
  is **not isolation**. So F1 ("work only from the brief") is a conduct norm until the agent's
  toolset is restricted — vision **open gate #1 (isolation model)**, a dependency, not settled
  here. Crucially, because the judge is independent and the gate is fail-closed, bypassing recall
  or reading source buys **no cheaper pass**: the artifact must still genuinely score ≥ bar. Recall
  is help that lowers attempts, not the enforcement; the enforcement is the gate.
- **Praxis assembles deterministically; the agent assembles nothing.** The brief, the evaluation
  disclosure, the weak-set, corroboration, each note's relevance, the MMR RecallSet (with a fixed
  tie-break), the escalating re-injection and the bar recompute are all **pure functions of the
  durable store**, rebuilt by the engine at every turn (start and each refusal): the same store
  state yields the same brief byte-for-byte, reproducible after a restart, auditable, and not an
  LLM call. The only two non-deterministic inputs in the whole loop are the model's per-dimension
  judgment at submit and the agent's free-text lesson; each is **recorded once and thereafter
  treated as fixed data**. The agent produces only the artifact and the subjective lesson.
- The **bar is engine-owned**, deterministic, recorded — no self-amplification.
- Notes: objective part engine-authored (trusted), subjective part agent-authored (advisory,
  provenance). Immutable; evolve only by new versioned notes.
- **Gaming defenses:** disclose the standard but keep the judge an independent model; the rising
  bar plus corroboration-weighted recall erode superficial rubric-gaming over time.
- **Noise guards:** the adaptive bar gates on stability, not raw average; retries tolerate dips.
- No Occam/Jung interface is assumed; an unavailable cognitive layer yields a named blocker, not a
  fabricated recall.

## 10. Frozen decisions (owner)

- **F1** Evaluation rules reach the agent through the brief; the agent never reads Praxis code.
- **F2** Every task records a learning note on its terminal outcome — pass or fail.
- **F3** Learning notes are the recall substrate; recall is passed in at start.
- **F4** Generous `maxAttempts`: a retry is a search for a better solution.
- **F5** The bar is adaptive and rises with iterations/stable competence.
- **F6** This is Praxis execution learning, not Occam; Occam inherits its own analogous loop.
- **F7** Every task — and later every flow — has a recall function; the recall must be very good.
- **F8** Praxis assembles and injects every brief/recall deterministically from the durable store;
  the agent authors only the artifact and the subjective lesson (see §9).

## 11. Open decisions (owner to settle before build)

- **O1** ✅ CLOSED — recall ranking defaults frozen in §6 (weights; N = 3–5; ~800–1200 tokens;
  MMR selection; cold start); escalating re-injection in §4; enforcement-vs-norm boundary in §9.
- **O2** ✅ CLOSED — bar formula frozen in §7 (trigger per terminal outcome; window W = 5 genuine
  passes; raise gated on margin >= 0.12 + stdev <= 0.08 + mean attempts <= 2 + cooldown; robust
  lower-quartile; step +0.01–0.05; ceiling 0.9; never auto-lower, emit `bar.contested`).
- **O3** ✅ CLOSED — enforcement frozen in §5: objective part engine-written unconditionally;
  subjective part a required, deterministically-adequate reflection with bounded attempts → stub
  fallback (never deadlocks); artifact-acceptance separated from instance-closure; recall ranking
  buries weak notes.
- **O4** ✅ CLOSED — note schema frozen in §5 (immutable, keyed to (task, instance); engine-written
  objective block + stamped provenance; agent-written subjective block with dimension-keyed tags;
  deterministic adequacy gate; behavior across a bar raise). Determinism invariant in §9 / F8.
- **O5** ✅ CLOSED — the line: selection (deterministic relevance, weak-set, per-dimension
  corroboration proxy) stays in Praxis; semantic clustering of lesson text is Occam, deferred
  (§5/§6). Confirmed by owner.
- **O6** ✅ CLOSED — append-only event types on the SQLite log (`learning.note`, `bar.raised`,
  `bar.contested`, `recall.selected`); BarState derived; **option (a) pure event-scan, no
  index/RAG** (owner: <1M notes even at scale, SQLite is fine, keep it simple); keep-all retention,
  bounded reads; additive migration (see §2).
- **O7** ✅ CLOSED — task-level loop first, proven exactly as wanted; then apply the identical
  pattern at scale to flows (reusing the same primitives, scoped to (flow, version)). Flow-level
  also depends on the unbuilt flow-outcome scorer (Unit 3/4). Neither flow loop nor flow evaluation
  exists yet.

## 12. Not in scope / limits

No runtime code, dependency, schema, store or flow is authorized here. No cross-project synthesis
in Praxis. No agent-set bar. No assumed Occam/Jung interface. Sequencing stays P7/P8, behind
evidence storage and the Occam memory seam.

## 13. Acceptance (for the eventual build units)

The loop is correctly built when, for a task: (a) the brief carries the full standard and a
bounded, recorded RecallSet, and an agent with **no access to `src/`** can act on it; (b) a
terminal outcome always produces an immutable learning note with the engine-objective part intact;
(c) a later agent on the same task receives higher-ranked lessons as competence accumulates; (d)
the effective threshold rises only on stable, sufficient history, versions the task, and is never
set by the working agent; (e) the retry budget lets a genuine search proceed without a single dip
ending it; and every change is durable, auditable and reproducible.
