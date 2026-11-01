# Research — bounded experience-query

Task: experience-query · Hash: 05d58a5d · Gate: G1 · Status: draft · Date: 2026-10-30

## 0. Contract

<!-- One physical line per key: this block is the hash input. Never reflow it. -->

task: bounded experience-query: an agent searches this project store for similar solved cases relevant to its current need and receives only ranked results with provenance, deterministic-first behind a ranker port, spec-first
scope: docs/<slug>-<hash8>/, later src/quality/ranker.ts, src/quality/recall.ts, src/quality/index.ts, src/pi/tool.ts, src/types/pi.ts, tests/
acceptance: research traces the existing recall ranking, the store read surface and what makes a solved case recognizable, the op attachment point, the provenance available without a schema change, and the within-store boundary at path:line; spec settles the query op, the ranker port with a deterministic implementation over recall signals, the query input and bounded result shape, the within-store-only rule, the no-schema/no-dependency/no-new-key rule, and the read-only-experience-retrieval boundary

Recompute: `printf 'task: %s\nscope: %s\nacceptance: %s\n' "<t>" "<s>" "<a>" | sed -E 's/[[:space:]]+$//' | sha256sum | cut -c1-8` → `05d58a5d`.

## 1. Question and boundary

**Question.** An agent starting a step already receives up to five lessons for *its own task* in the
brief. When it is stuck on a problem that a *different* task in this project already solved, it has
no way to ask. Can Praxis answer that question from its own store — deterministically ranked, bounded,
with provenance — without becoming a search engine or a federated memory?

**Boundary.** Read-only experience retrieval (P7) over **one project store**. Not cognition (Occam),
not cross-project synthesis or federated memory (**Jung**, and Praxis must not become one:
`docs/vision.md:21`, `AGENTS.md:518`, `AGENTS.md:558-559`), and not isolation or identity.

## 2. Sources inspected

| Path | What was read | How |
| --- | --- | --- |
| `src/quality/recall.ts` | weights, window bounds, weak-set, candidate scoring, MMR, exemplar, entries | read in full |
| `src/quality/bar.ts` | the cross-instance event scan and the task filter | read |
| `src/store/events.ts`, `src/store/artifacts.ts` | the read surface | read |
| `src/runner/engine/support.ts` | `withStore` — how a store is opened and scoped | read |
| `src/types/learning.ts` | the note, the recall set, the provenance | read |
| `src/types/pi.ts`, `src/pi/tool.ts` | ops, args, dispatcher, envelopes | read |
| `docs/execution-learning/DESIGN.md` | the determinism invariant on the brief | read |
| `AGENTS.md`, `docs/vision.md` | the federated-memory boundary | read |

## 3. Competing explanations

- **E1: extend the brief's recall block with the agent's need.** Rejected: the brief is a pure
  function of the store (F7), and an agent-supplied need is not — folding it in would break the
  byte-for-byte determinism the learning loop rests on.
- **E2: a keyword search over the event log.** Rejected: it returns the log, not lessons, and its
  ranking would be a second scorer with no relation to the one the loop already trusts.
- **E3: a query op whose ranking is the SAME deterministic scoring the brief uses, with the
  caller's need standing in for the weak-set** (chosen shape). One scorer, two cover sets.

## 4. Findings

- **F1 [source-inspected]** The deterministic ranking already exists and is frozen:
  `RECALL_WEIGHTS = {weakness 0.35, outcome 0.25, corroboration 0.20, recency 0.10, margin 0.10}`
  (`src/quality/recall.ts:22`), `RECALL_MAX = 5` (:30), `RECALL_TOKEN_BUDGET = 1000` (:32),
  `RECENT_NOTES = 40` / `RECENT_VERDICTS = 20` (:36-37), `RECENCY_DECAY = 0.7` (:39),
  `weakSetFor` (:73), `candidates` (:119) which computes `relevance` at (:159), `tokenCost`
  (:185), MMR `select` (:196, coverage set at :198), `withExemplar` (:226), `recallFor` (:238),
  `briefRecall` (:256), `escalatedLesson` (:290). The per-candidate scoring is **private** to
  `recall.ts` today.
- **F2 [source-inspected]** The read surface is small and read-only: `scanEvents(store, types)` is
  the one cross-instance scan (`src/quality/bar.ts:75`, a SELECT over `event` in one total order),
  `ofTask` filters a scan by task (`:105`), `listEvents` reads one instance (`src/store/events.ts:65`),
  `readArtifact`/`acceptArtifact` handle bytes and state (`src/store/artifacts.ts:196`, `:215`), and
  `withStore` opens **one** store directory per call (`src/runner/engine/support.ts:29`).
- **F3 [source-inspected]** A "solved case" is already recognizable from events, with no new table:
  an `artifact.accepted` event whose payload has no `failed` marker, carrying
  `{step, version, digest, schema, task, taskVersion, derivedFrom}`
  (`src/runner/engine/quality-loop.ts:298-304`); its `quality.verdict` carries the scores
  (dimensions/mean/flagged/rubricDigest); its `learning.note` carries the lesson and the provenance
  (`src/types/learning.ts:47-55`: task, taskVersion, instance, step, noteVersion, subjective|null,
  stub, provenance). A **stub** note has no lesson and must not be surfaced as one.
- **F4 [source-inspected]** How an agent invokes work today: the op enum (`src/types/pi.ts:21`), the
  strict args object (`:33-48`), the per-op refine, the dispatcher (`src/pi/tool.ts:684`, routes at
  `:692-696`), one handler per op, and one envelope per op (`CheckEnvelopeSchema`,
  `NoteEnvelopeSchema`). A new op therefore attaches at: the op enum, one optional arg block, the
  refine, one handler, one dispatch line and its own envelope. Nothing in the six-key result moves.
- **F5 [source-inspected]** The provenance the spec may return already exists: the accepted
  artifact's `digest`, `step`, `version`, the task path and `taskVersion` (F3), the verdict's
  score/mean/flagged/rubricDigest, the note's `provenance.agent` (engine-stamped,
  `src/types/learning.ts:55`) and its `at`. No schema change, no new column, no new event.
- **F6 [source-inspected]** The boundary is structural, not a promise: every read goes through
  `withStore` on one directory (`src/runner/engine/support.ts:29`) and `scanEvents` is a SELECT
  inside that one database (`src/quality/bar.ts:75`). There is **no cross-project read path** in the
  codebase, and `docs/vision.md:21` plus `AGENTS.md:518` forbid Praxis from becoming a federated
  memory authority; cross-project synthesis is Jung's (`AGENTS.md:558-559`).
- **F7 [source-inspected]** The brief's learning payload is deterministic by contract: the same store
  state must yield the same brief byte for byte (`docs/execution-learning/DESIGN.md` §9 / F8), and a
  test asserts it. An agent-initiated, agent-parameterised query cannot be part of that payload.
- **F8 [source-inspected]** `src/pi/tool.ts` is 721 lines, over the 600 cap under the owner's waiver
  (`docs/jev-alignment-gate-b8c0e751`, Unit 3). The query op must therefore add **as little as
  possible** to it: the ranking lives in `src/quality/ranker.ts`, the handler is thin.

## 5. Affected owners and callers

| Owner | Effect |
| --- | --- |
| `src/quality/ranker.ts` (new) | the `RankerPort`, the deterministic implementation, the candidate assembly from events |
| `src/quality/recall.ts` | its private per-candidate scoring is EXTRACTED so the ranker can reuse it with the caller's need as the cover set — one scorer, two callers |
| `src/quality/index.ts` | the barrel exports the ranker surface (the tool imports the barrel) |
| `src/types/pi.ts` | one op name, one optional arg block, one envelope |
| `src/pi/tool.ts` | one thin handler and one dispatch line (F8) |
| `tests/` | a fake ranker through the port; ranking, bounds, provenance, within-store and read-only cases |
| `.pi/skills/praxis/SKILL.md` | one row and a paragraph: the op exists and when to use it |

## 6. Uncertainty and open questions

- **Q1 (decision 1).** A new op or an extension of the brief. Argued in spec D1; the recommendation
  is a new op named `recall`.
- **Q2.** Whether the need's tags are required. Proposed: optional, defaulting to the current step's
  rubric ids — the agent usually does not want to restate what the brief already told it.
- **Q3.** Whether a query should be recorded (an event) for audit. Proposed NO: the query writes
  nothing, so the store stays the only evidence and re-running the same query reproduces the same
  ranking from the same store. A recorded query would be a new event type and a new write path.
- **Q4.** Whether cross-task cases need their own task's bar to interpret the score. They do, and the
  deterministic ranker computes each candidate's bar from ITS task's rubric via the existing
  `effectiveBars` (`src/quality/bar.ts:175`) — no new signal, and it is why the ranker takes the
  store rather than a pre-computed list.

## 7. Handoff

Spec: `spec.md` in this folder (D1–D6, requirements, failure behaviour, oracles). No code until the
spec passes (G2).
