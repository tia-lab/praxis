# Review — hooks contract

## G1 research — attempt 1 — PASS — 2026-10-30T16:45:26Z
subject: docs/hooks-contract-2fbfdba5/research.md sha256:fe563865d45615f56281d478c24c2d06f82e3b14786e18018ea86f51d111423f
reviewer: lead (session reviewing wB:p22's authored subject)  independence: independent
verdict basis:
- F1 op entries confirmed by read: startOperation:365, submitOperation:494, noteOperation:521, checkOperation:550, readOperation:560, issueOperation:585, executePraxisTool:614. CONFIRMED; read/issue correctly unhooked.
- F6 confirmed: the alignment gate lives in startOperation (required(args.order), judgeOrder, throw fail(ALIGNMENT_REJECTED)), so a before_start hook runs before it — deterministic hooks first, the network judge last. CONFIRMED.
- F4 confirmed: the closed Code union is 30 after Unit 3; the CODES mirror is `as const satisfies readonly Code[]`. HOOK_VETOED makes 31.
- F7 confirmed: event.instance REFERENCES instance(id) — the same no-instance-no-event limit Unit 3 recorded; a post-commit hook failure genuinely has no durable home. Not invented.
- after_submit's verdict source: `quality.verdict` is a real recorded event; reading it from qualityHistory needs no engine signature change. CONFIRMED feasible.
findings: none blocking.

## G2 spec — attempt 1 — PASS — 2026-10-30T16:45:26Z
subject: docs/hooks-contract-2fbfdba5/spec.md sha256:209b0894f1dd0a94fec056d1670ea94d995e7b0ab0f2c2cfc91e871dc9a6167f
reviewer: lead (session reviewing wB:p22's authored subject)  independence: independent
verdict basis:
- R1–R11 each carry a failure behaviour and a checkable oracle (write-free veto proven by five row-counts + no-store-file; byte-identical-when-empty proven by the existing deep-equals; the mirror by tsc + TAXONOMY_SIZE 31).
- The safety spine is correct and minimal: R9 — dispatch receives only (name, payload), no Store/Grant/engine handle, called AFTER the tool's own authority decisions, so a hook can only SUBTRACT; A5 — no payload transform, so a hook never becomes a second author of the artifact. (MIN-004/006/009.)
- D4 containment is honest: after_ throws are caught, logged to stderr, result unchanged, and the non-durability is stated as the F7 limit with A3 named, not a hidden promise.
- D5/R10: empty registry => byte-identical envelopes; no store/flow schema, no result key, no dependency, no engine signature change.
- D3 veto code: HOOK_VETOED (new), not GATE_REJECTED — I concur: the cause and remedy differ (a hook veto may face a perfect artifact; the agent escalates, not edits), and the taxonomy is one-member-per-cause-class.
findings:
- F1 [advisory -> owner] D3 adds one new typed code, HOOK_VETOED (taxonomy 30->31). Low-stakes and reversible in one line; owner-visible per the Unit 3 pattern. cure: owner nod. evidence: read spec D3/R11.
verdict: PASS. R1–R11 sound; the design cannot amplify authority or transform the artifact. G4 (plan + implement) is gated only on the owner's nod of HOOK_VETOED.

## G5 implement — attempt 1 — PASS — 2026-10-30T16:54:40Z
subjects (sha256, first 16):
plan.md 015a2c70c6f7ae47
hooks.ts 1c96d4b8ba45366f
hooks.ts 6ebb3b455c932df5
tool.ts ca6cb1cc1078b47e
hooks.test.ts 061bca56f210a541
reviewer: lead (session reviewing wB:p22's authored subject)  independence: independent
verdict basis:
- R9 (the safety spine) checked by read: src/runner/hooks.ts imports ONLY ../types/errors.ts and ../types/hooks.ts — no Store, no Grant, no engine handle; a hook's only input is (name, payload). A hook can subtract or observe, never amplify. Also asserted mechanically by the test's import-list check. CONFIRMED.
- R3/R4 write-free veto checked by test + read: a vetoing (or throwing) before_ on each op -> HOOK_VETOED; fresh project creates no store file; five table counts unchanged. CONFIRMED.
- R8 verdict for an ACCEPTED submit checked by read: verdictSummaryOf reads qualityHistory(store, instance, <judged step>) filtered by version, using inspect only for the flow config; the accepted step has advanced but the judged step's verdict is read explicitly. R8 met; the spec's D1 parenthetical is corrected by amendment (finding F1). CONFIRMED.
- R6/R7 containment checked by test: two after_ hooks, first throwing -> both run, envelope deep-equals the no-hook run, exactly one stderr line. CONFIRMED.
- R10 byte-identical-when-empty checked by the existing deep-equals + per-op cases; R11 mirror by tsc + TAXONOMY_SIZE 31. tsc 0; 250/250 under the no-network stub; scope confined to the declared paths.
findings:
- F1 [resolved by amendment] spec D1's note said the after_submit verdict is read from inspect(...).qualityHistory; that is wrong for an acceptance (inspect reports the current, already-advanced step). The implementation reads the judged step explicitly and meets R8; the engineer appends a one-line spec correction rather than editing silently. Not a code defect.
- F2 [process, non-blocking] the engineer implemented before writing plan.md this turn (G3<->G4 inverted), disclosed; plan.md records the checks actually run. The substantive gate (G2 spec) passed before code, so the work stands; recorded for honesty, not re-worked.
verdict: PASS. R1–R11 verified independently; the design cannot amplify authority or transform the artifact. Unit 4 accepted; tool.ts stays under the owner cap waiver.
