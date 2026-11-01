# Review — verdict-rationale (G2 spec)

Task: verdict-rationale · Hash: ad85142e · Gate: G2 · Verdict: **PASS** · Subject: spec.md (dimension-as-jev-battery revision).

## Verdict

PASS. The spec is rigorous and minimal: 13 requirements each with failure behaviour + oracle, zero score drift by construction, additive-optional store, three surfaces, no table/migration/dependency.

## Independently verified

- **jev returns no prose** (System One; typed choice/noul/score only) — confirmed in the TypeSafe docs (docs.typesafe.ai) and pi-jev types. The battery-of-probes design is the correct way to get a structured "why" from jev.
- **Bars inherit across a probes-only change** — confirmed in `src/quality/bar.ts`: `dimensionKey = digest(id + statement)` and `compositionKey` is over those keys; `probes` are in neither, so adding a battery changes `rulerDigest` (correctly invalidating that rubric's cached verdicts) but re-warms NO bars. (This corrects the dispatch brief's re-warm note.)
- **Zero drift**: the scoring `noul` request is byte-identical to today's, pinned by `tests/quality/jev-scorer.test.ts:53-70` plus the new golden-request test.

## Lead decisions on the open points

1. Probe caps 6/dimension, 48/rubric, `CONFIG_INVALID` at parse — accepted.
2. `RATIONALE_MAX` 240, ≤3 clauses — accepted.
3. D11 divergence clause (score below bar + all probes clean → "the statement may be too vague") — accepted; it makes the parsimony-statement hypothesis verifiable from the record.
4. Recall rationale = query-path cases only — accepted (brief RecallSet out of scope).

## Binding for implementation

- The battery NEVER feeds the gate, score, mean, flagged set or bars; an explain throw/timeout leaves the verdict byte-identical.
- `diagnosis[]` (structured answers) and `rationale` (rendered line) are additive-optional on `QualityVerdictSchema.dimensions[]`; not in `rulerDigest`.
- No free-text/LLM prose, no new table/event/migration/dependency, no score recomputation from the battery.

Implementation authorized (G3). Owner approved directly 2026-10-31.
## G3 — implementation review

Verdict: **PASS** (verified by running, 2026-10-31). tsc 0; full suite 301/301 (292 prior unchanged + 9 new).
Confirmed: the scoring request is byte-identical (zero-drift pinned test passed); a battery-only outage leaves
the verdict deep-equal to the no-battery run (explain is never a gate input); store untouched
(praxis.store/v2); research.json v5 with 19 probes parses; diagnosis/rationale are additive-optional on the
verdict and not in rulerDigest. Engineer authorized to commit and stand down.
