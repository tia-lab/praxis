# Review — jev alignment gate

## G1 research — attempt 1 — PASS — 2026-10-30T16:24:12Z
subject: docs/jev-alignment-gate-b8c0e751/research.md sha256:c4f81336e977352d1148e178575157d28b46b501f333aa65dd0d11a80d3a21b6
reviewer: lead (session reviewing wB:p22's authored subject)  independence: independent
verdict basis:
- F2 checked by grep: no `order` input exists in `src` — every hit is log/append-order prose. CONFIRMED.
- F8 checked by read: `CODES` at `src/types/pi.ts:185-215` is `as const satisfies readonly Code[]`; the `Code` union is 29 entries. CONFIRMED (drift is a compile error).
- F9 checked by read: `event.instance … REFERENCES instance(id)` in `src/store/db.ts` (×3 tables) — a refusal that creates no instance cannot append an event. CONFIRMED; the "logged ≠ durable" finding is real.
- F3 checked by read: `src/runner/engine/start.ts` — first write is inside `transact` after the gate point; a pre-`start()` refusal is write-free. CONFIRMED.
- F7 (pi-jev ships ChoiceQuestion/ChoiceAnswer) not independently confirmed here — grep path missed; the runtime's own contract states jev supplies typed Choice, and `jev-scorer.ts` already uses `evaluate`. Carried to G4 as an implementation check, non-blocking.
findings:
- none blocking. The research is grounded at path:line and the competing seam options are stated.

## G2 spec — attempt 1 — PASS — 2026-10-30T16:24:12Z
subject: docs/jev-alignment-gate-b8c0e751/spec.md sha256:00b04eba2820edb031d3c0193563c56c51be615c671ad7408c82eab4f700aedd
reviewer: lead (session reviewing wB:p22's authored subject)  independence: independent
verdict basis:
- R1–R8 each carry a failure behaviour and a checkable oracle (row-count and store-digest oracles for the write-free requirement R4; envelope deep-equal for the unchanged pass path R5; `tsc` + `TAXONOMY_SIZE` for the mirror R6).
- D2 anchor is sourced only from the pinned flow document; the order contributes text only — the trust model is sound (MIN-004: every field bound to a requirement).
- D4 one new code, mirrored with a compile-time drift guard; the order text is never stored, only its digest — minimal (MIN-006/009).
- Exclusions and alternatives (A1 dispatcher, A2 optional, A3 scope-field, A4 durable record) are explicit; §4 correctly declares the unit non-waivable (tool contract + Code union).
findings:
- F1 [advisory → owner] D1 makes `order` a REQUIRED arg: it breaks every existing `op=start` caller until updated and requires the skill change in the same acceptance. Consequence: correct for a gate that must bite, but owner-visible. cure: owner sign-off. evidence: read spec D1/R1.
- F2 [advisory → owner] R3/D3 fail-closed makes a judge outage refuse EVERY start (`judge unavailable`): a new hard dependency on jev for the core start path. Consequence: strictness vs availability trade the spec under-weights. cure: owner rules fail-closed vs a distinct judge-unavailable outcome. evidence: read spec R3/D3.
- F3 [advisory → owner] R7/F9 a refusal is not durably recorded (no instance to append to); a wrong reject is visible in `detail` but not stored. Consequence: no audit trail of rejects yet. cure: accept for now (A4 is a separate unit) or expand scope (new hash/folder). evidence: F9 confirmed above.
verdict: PASS. The three findings are owner-visible decisions, not spec defects; the spec settled each with a stated reason. G4 is gated on owner sign-off of F1–F3, per the ledger.

## G5 implement + spec-amend — attempt 1 — PASS (one blocking cap finding) — <NOW-SET-BELOW>
subjects (sha256, first 16):
spec.md 0974f03bd076cf1c
plan.md c0e032b94ed7a89d
jev-align.ts 8d0e09e0c0cc3ce2
tool.ts e8a10eb3fac47402
pi.ts d84f2ed9b4a68450
errors.ts b9e635c0053fc1db
alignment.test.ts 88d5c1b1094a71e1
now: 2026-10-30T16:32:40Z
reviewer: lead (session reviewing wB:p22's authored subject)  independence: independent
verdict basis:
- spec amendment checked by read: D3/D3a/R3/R9 + Model now carry the three outcomes; judge-unavailable PROCEEDS with a typed flag (step.alignment + a summary clause), no new result key; amendment line present. Matches owner decision (ii).
- pi-jev Choice confirmed by read of node_modules/pi-jev/src/types.ts:3,9 and client.ts:23,81-86 — the design uses a real choice question, not a noul stand-in (G4 carry-check from G1 F7 resolved).
- R1 required order: a start without/empty order -> CONFIG_INVALID, zero writes (alignment.test.ts case e). CONFIRMED.
- R4 misaligned write-free: alignment.test.ts cases b/c assert the sqlite file is never created, and all five table counts identical before/after. CONFIRMED.
- R5 aligned unchanged: case a asserts the envelope is exactly {result, step, nonce}, step.alignment undefined, no summary clause, the six result keys. CONFIRMED byte-shape.
- R9/(ii) unavailable: case d asserts the start proceeds, step.alignment {decision:unchecked, reason, orderDigest} and the summary clause present, six result keys, instance exists. CONFIRMED.
- R6 mirror: ALIGNMENT_REJECTED in errors.ts and pi.ts (1 each); `as const satisfies readonly Code[]`; TAXONOMY_SIZE 30; tsc exit 0. Cannot drift. CONFIRMED.
- Suite: 242/242 under the no-network stub, no NETWORK ATTEMPT (every start goes through the injected judge). Scope: git shows only the 4 declared src files + the new jev-align.ts + the skill.
findings:
- F4 [BLOCKING] src/pi/tool.ts is 651 lines, over the binding 600 cap (WORKFLOW §7); it was 609 under the earlier op=check waiver and this unit added +42. Consequence: a cap breach that is not a behaviour defect but must not pass silently. cure: extract the op handlers (startOperation et al.) into a sibling module so tool.ts < 600 (move, not rewrite) — OR an explicit owner re-waiver. evidence: wc -l src/pi/tool.ts = 651. ROUTED TO OWNER: (a) split now, or (b) waive and split as its own unit.
- F5 [advisory] no judge timeout in this cut (a hang is bounded by caller patience; any surfaced throw becomes unavailable). Disclosed, out of scope. Acceptable.
verdict: PASS on R1–R9 (behaviour verified independently). Final unit acceptance is held on the owner's ruling of F4 (cap). No other blocking finding.
