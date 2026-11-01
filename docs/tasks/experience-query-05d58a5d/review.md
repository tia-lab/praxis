## G5 implement — attempt 1 — PASS — 2026-10-30T17:10:41Z
subjects (sha256, first 16):
plan.md 159366a314d4f285
ranker.ts b10cc404ba898eb9
recall.ts b8db7e325e4bc873
tool.ts cb55b64c6165ed2f
pi.ts 144eb438962dd461
ranker.test.ts d9127ac76f928d4b
reviewer: lead (session reviewing wB:p22's authored subject)  independence: independent
verdict basis:
- R3 (the extraction) checked by test + suite: `recall.ts` now exports one `scoreCandidate(signals)` with the cover-set as a parameter; the brief's `recallFor` equals `scoreCandidate` computed directly, and the full 250 pre-existing tests stayed green — behaviour-preserving, not a rewrite. CONFIRMED.
- R7 within-store checked by test: a query in project B returns zero while A holds a solved case, and A's digest never appears in B's answer. The ranker module reads one store via `withStore`/`collectCases`. CONFIRMED.
- R8 read-only checked by test: five table counts AND the store-file sha256 identical before and after a query. CONFIRMED.
- R2 solved-cases-only checked by test: a stub note, a continued-FAILED carry and a note-less acceptance are all excluded; only a real accepted+verdict+noted case is returned. CONFIRMED.
- Port purity confirmed by read: `RankerPort.rank({need, candidates})` takes no store; `collectCases(store)` does the read; `recallExperience` runs `assertObserver`; `setRankerForTest` injects a fake. R9: no new Code (taxonomy 31), `op=recall` in the enum + route; tsc 0; 258/258 no-network; scope confined.
findings:
- F1 [resolved by amendment] spec D2 said the ranker "takes the store"; the implementation keeps the port PURE and attaches the store-derived bar context (CaseSignals) to each ExperienceCase at collection. Same intent, cleaner shape; the engineer appends a one-line spec correction rather than editing silently. Not a code defect.
- F2 [disclosed] a missing/corrupt pin degrades that case's margin signal to 0 rather than failing the query — matches R3's stated failure behaviour. Acceptable.
verdict: PASS. R1–R10 verified independently; one scorer, read-only, within-store, bounded, no new Code/dependency/schema/key. Unit 5 accepted; the roadmap is complete.
