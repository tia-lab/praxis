# Plan — bounded experience-query

Task: experience-query · Hash: 05d58a5d · Gate: G3 · Status: draft · Date: 2026-10-30
Spec: `spec.md` (D1–D6, R1–R10). §4 waiver applies to this plan only: the spec exists, and it adds a
tool op — a contract change — which is why a plan is required rather than ceremony.
Written BEFORE the code (no repeat of Unit 4's inversion).

## 1. Affected declarations

| Path | Declaration | Change | Effect on callers | Spec |
| --- | --- | --- | --- | --- |
| `src/quality/recall.ts` | `candidates` (:119) and the relevance arithmetic (:159) | **extracted** into `scoreCandidate(signals)` + `CandidateSignals`/`CandidateRelevance`, with the COVER SET as a parameter; `candidates` now calls it with the weak-set | none: the brief's ranking must stay byte-identical (R3's oracle) | D2, R3 |
| `src/quality/ranker.ts` | new | `QueryNeed`, `ExperienceCase`, `RankedCase`, `RankerPort`, `deterministicRanker()`, `collectCases`, `applyBounds`, `recallExperience`, `setRankerForTest` | imported by the tool through the barrel | D2, D3 |
| `src/quality/index.ts` | the barrel | exports the ranker surface | the tool imports only the barrel | — |
| `src/types/pi.ts` | `PraxisToolOpSchema` (:21), args (:33-48) + refine, envelopes | + `recall`; + `need`/`tags`/`max`; + `RecallEnvelopeSchema` | the generated host parameters grow by three optional/bounded keys | D1, R1 |
| `src/pi/tool.ts` | one handler + one dispatch line | thin: build the need, call `recallExperience`, wrap in the envelope | +~8 lines (the file is over the cap under the owner waiver) | F8, R1 |
| `tests/quality/ranker.test.ts` | new | the port, the extraction equality, bounds, provenance, within-store, read-only | — | R1–R10 |
| `.pi/skills/praxis/SKILL.md` | one op row + one paragraph | when to use `recall`, what it returns, this project's store only | agents learn the op | R10 |

## 2. Steps, in dependency order

1. **The extraction** (`recall.ts`): move the arithmetic into `scoreCandidate` with `cover` as a
   parameter; `candidates` calls it. Check: the whole existing suite, and the byte-identity case
   below — the brief's own results must not move.
2. **The ranker** (`ranker.ts`): types, `collectCases` (solved cases from events, per the spec's
   R2), `deterministicRanker` (uses `scoreCandidate` with the need's tags as cover, and each case's
   own task bars from its pinned task definition), `applyBounds`, the injected seam, and
   `recallExperience` (open the store, assert the observer, default the tags from the current step,
   collect → rank → bound).
3. **The barrel** (`index.ts`): export the surface.
4. **The contract** (`pi.ts`): op name, args + refine, `RecallEnvelopeSchema`.
5. **The wiring** (`tool.ts`): the thin handler and the dispatch line.
6. **The skill**: the op row and the paragraph.
7. **The tests** (R1–R10) and the full suite under the no-network stub.

## 3. Checks

| Check | Assertion | Result |
| --- | --- | --- |
| typescript | `npx tsc --noEmit` | — |
| extraction is an extraction | the same store and args through the brief path give the same `RecallSet` before and after (a test that ranks a seeded store and compares against the brief's own `recallFor` output, plus the untouched suite) | — |
| negative parses (R1) | missing/empty/oversized `need`, `max` 0 and 11 → `CONFIG_INVALID` with the field path | — |
| solved cases only (R2) | one good case + one stub note + one continued-FAILED acceptance + one note-less acceptance → only the good one is returned | — |
| injected ranker (R4) | a fake `RankerPort` returning reversed order is reflected exactly | — |
| bounds (R5) | 10 long lessons: `count ≤ max`, total lesson characters inside the budget, `truncated: true` | — |
| provenance (R6) | the returned case's provenance equals the seeded events field by field | — |
| within-store (R7) | two separate project stores: a query in one never returns the other's case; the module's imports reviewed | — |
| read-only (R8) | five table counts and the store file's sha256 identical before/after | — |
| nothing else changed (R9) | no new Code (taxonomy still 31), `package.json` untouched, the six result keys untouched; diff limited to the declared paths | — |
| skill (R10) | the op row and paragraph exist and match the contract | — |

## 4. Recovery

- The extraction (step 1) is the only change to existing behaviour; if the brief's ranking moves,
  step 1 is reverted and the query keeps its own scoring local — but R3 then fails, so the extraction
  is fixed rather than worked around.
- The op is additive: removing the enum entry, the route and the handler removes the feature whole.
- The query writes nothing, so no failure mode can leave the store inconsistent.
- If the pinned task definition for a case is missing or corrupt, that case loses its margin signal
  (0) instead of failing the query (R3's failure behaviour).

## 5. Out of scope

Cross-project or federated reads (Jung); a jev-relevance ranker (`.dev` `jev-search` is reference
only, adoption needs its own inspection and owner approval); semantic clustering, embeddings or
keyword search; recording queries as events; caching; a flow-level recall (its own unit); any store
or flow schema change; any new `Code`; the six-key result.

## 6. LOC budget

| Area | Estimate |
| --- | --- |
| `src/quality/ranker.ts` (new) | ~185 |
| `src/quality/recall.ts` (extraction, net) | ~+25 / −15 |
| `src/quality/index.ts` | +3 |
| `src/types/pi.ts` (op, args, envelope) | +30 |
| `src/pi/tool.ts` (thin handler + route) | ~+12 |
| `tests/quality/ranker.test.ts` | ~250 |
| `.pi/skills/praxis/SKILL.md` | ~+12 |

`src/pi/tool.ts` is 721 lines and grows by ~12 under the owner's waiver; the ranking, the case
assembly and the bounds all live in `src/quality/ranker.ts`.
