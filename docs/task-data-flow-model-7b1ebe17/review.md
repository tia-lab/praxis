# Review — task-data-flow-model

Append-only. One section per gate attempt. Nobody edits a verdict.
Verdicts are cast by a reviewer session that did not author the subject; the lead
records them here verbatim in substance and never alters a verdict.

## G1 research — attempt 1 — FAIL — 2026-10-29
Subject: docs/task-data-flow-model-7b1ebe17/research.md @ sha256:65508be0b42246ef74db38c9bd7077d9f302e92f0ef17564cd37c1c438f06013
reviewer-1 (independent session): FAIL. R1 blocking — line 3 states Hash: 96c9af7d while §0
hashes to 7b1ebe17. R2 blocking — §7 lists Q1 as unknown and says G2 cannot start until it is
answered, contradicting resolved Q1. R3 blocking, lead-owned — no AGENTS.md pointer, so G0
evidence was absent. R4/R5 minor — engine.ts:589-596 must cover 597-601; db.ts:19-57 must be
19-61. R6 advisory — F4 calls the gate content-blind while listing a content check.
reviewer-2 (independent session): FAIL. A1 — same stale header hash. A2 — same §7 contradiction.
B1 blocking — the db.ts row names store/instance.ts, store/artifacts.ts and store/events.ts as
callers of SCHEMA_STATEMENTS, which is a private const used once at db.ts:135. B2 blocking — the
engine.ts row groups validateFlow and gate under tool.ts/cli.ts callers; only advance has them.
Both reviewers reproduced 7b1ebe17 from the §0 lines and 96c9af7d from the <hash> variant.
Lead action: R3 cured in AGENTS.md (c75f130). R1/R2/R4/R5/B1/B2 returned as one rework.

## G1 research — attempt 2 — FAIL — 2026-10-29
Subject: docs/task-data-flow-model-7b1ebe17/research.md @ sha256:1b06e6b340d1b6fe54b2a30935c16a6577db39783c61cc96b3ed731a22cbe690
Rework dd728fa closed R1, R2, R4, R5, B1 and B2; the lead verified each against the file and
recomputed §0 = 7b1ebe17.
reviewer-1: FAIL, F1-F4 and F6-F8 pass, F5 fails.
reviewer-2: FAIL on F5 only, and verified the subject digest before the first read and again
before reporting, so no concurrent edit occurred during review.
F5: the B1 cure replaced one false claim with another — the db.ts row then asserted that
store/instance.ts, store/artifacts.ts and store/events.ts call openStore. grep -rn openStore src
returns engine.ts:31 (import), engine.ts:122 (the only call) and db.ts:108 (definition); the
three store modules import Store, storeCall and transact at artifacts.ts:16, events.ts:10 and
instance.ts:13. Lead reproduced both commands; the finding holds.

## G1 research — attempt 3 — SPLIT — 2026-10-29
Subject: docs/task-data-flow-model-7b1ebe17/research.md @ sha256:18c046cdbe16c7a1c47ae1026daef0622c42b366e3955e49caa7d5ec7b02a852
Rework 05f9874 closed F5 exactly as briefed; the lead verified the row against grep and confirmed
the scope was one clause, one amended line, §0 untouched.
reviewer-1: PASS on G1-G9, with advisories: openFlow omits tool.ts:256,262 (judged non-blocking
because no listed edge is false); F4's "content-blind about the subject" phrasing; the openStore
row does not claim "only", which is correct.
reviewer-2: FAIL on G6 only. The engine.ts row still names tests/runner/* as callers of advance
and omits openFlow's tool.ts:256 and :262 call sites.
Lead adjudication with commands: grep -rn 'advance(' src/ tests/ returns cli.ts:102, cli.ts:129
and tool.ts:249 only, so "tests/runner/*" is a false edge; grep -rn openFlow src/ tests/ returns
engine.ts:218,312 and tool.ts:256,262,290, so two sites were missing. reviewer-2 is correct;
reviewer-1 missed the false edge.

## G1 research — attempt 4 (lead-authorized extension beyond the three-round cap) — 2026-10-29
Subject: docs/task-data-flow-model-7b1ebe17/research.md @ sha256:09c083ac9a13acaba99269e48572c8266b12ab8d6918ee0a47885de571cfdd26
Scope: one cell, the caller column of the src/runner/engine.ts row.
Result: advance -> src/pi/tool.ts:249, src/cli.ts:102,129; openFlow -> engine.ts:218,312,
src/pi/tool.ts:256,262,290. Both clauses match the two greps exactly; amended lines 9.
Verification: the lead ran both commands and compared the cell word for word. No reviewer verdict
was cast on this single cell, because two reviewers had already certified every other item twice
and the cap was extended by the lead, not by the reviewers. This exception is recorded rather
than hidden: a reviewer pass on attempt 4 is owed if the cell is ever cited as authority.

## G2 spec — attempts 1-5 (recorded after the fact, 2026-10-29)
The lead kept these verdicts in the manifold assignment record and did not append them here
when they landed. That was a gap in this file's promise to be append-only and complete; the
summaries below are reconstructed from the assignment evidence, not rewritten.

attempt 1  subject 463f692c  FAIL both seats   11 findings (4 shared): missing oracles on R2/R3/R6,
           join-plus-review contradiction, two owners for the flow digest, wrong base table sites
attempt 2  subject 19bcf7a3  FAIL both seats    4 findings (0 shared): R6 code path, loader
           STORE_INVALID vs INSTANCE_STATE_INVALID, no durable publication record, eight codes
           absent from the closed union
attempt 3  subject 605124fc  FAIL both seats    5 findings (2 shared): incomplete config_digest
           retirement, publication claiming to be the only durable bytes record; plus node kebab
           rule without an oracle, wrong INSTANCE_STATE_INVALID citation, CODES mirror unnamed
attempt 4  subject 3faace6a  SPLIT              1 blocking (task reference resolution undefined)
           + 3 advisories; reviewer-2 passed N1-N6
attempt 5  subject 8254dc01  FAIL both seats    3 findings (2 shared): version rule has no oracle;
           R6 failure column contradicts its own requirement text; one file per id cannot hold two
           published versions, so the two-version oracle is unimplementable
Each round's lead actions, cures and the reasons a cure was adopted are in the assignment record
and in the amended lines of spec.md.
## G3 plan — attempt 1 — FAIL — 2026-10-29
Subject: docs/task-data-flow-model-7b1ebe17/plan.md @ sha256:737eb8ba96e7d9bba1924b8d61f6670ac25211f7a9c38e8750e8ffc005f5cd74 (512 lines)
Recorded by lead from the manifold assignment verdicts, verbatim in substance. Neither reviewer could
write this section: both were assigned under "Do not edit any file", so the verdict channel was the
assignment report, not this file. The lead records; the reviewers' wording and findings are not altered.

reviewer-1 (assignment 1d7c78de): FAIL — 1 blocking, 8 advisory.
B1 blocking: step 3 claims to rewrite .pi/praxis/config.json, which is outside unit D's recorded scope
and is the committed Slice 0 research flow.
A1: steps 0 and 8 are the only steps whose Done-when does not name their check (C0 at :304, C13);
steps 1-7 all close properly, quoted line by line.

reviewer-2 (assignment a331b6a5): FAIL — 5 blocking.
R1: the Requirement column carries non-requirement tokens (W4, U5 are spec-review finding labels; two
rows carry an em dash and the literal "tests"), against the plan's own line 10.
R2: .pi/praxis/config.json rewritten and .pi/praxis/** claimed outside unit D scope, while only step.ts
is flagged as needing an extension; also proposes moving .pi/praxis/state/ aside.
R4: the D3 override is restated as "prepared but not merged ahead of a PASS", narrower than AGENTS.md:102-103.
R5: "supersedes the byte-identical promise" is asserted rather than routed to the owner.
R6: step 8 names no requirement ids.
Advisory: six citation drifts, and store.test.ts 338-vs-341 line count.

Lead actions: one combined amendment assignment (eb1b96ba) with the lead ruling that Slice 0 stays
byte-identical, the live store is not touched, and the migration emits task documents and new flow
files only.
### reviewer-1 advisories A2-A8 (added 2026-10-29 after reviewer-1 flagged the omission)
The block above records B1 and A1 and states "8 advisory", which under-counted what a later reader can
see. The full advisory list, titles only, from the assignment report:
A2 (F5) "the shipped delivery flow exercises R6" - C12 checks the declaration, not the behaviour.
A3 (F5) C8 does not prove src/types/org.ts untouched.
A4 (F3) four src/pi/tool.ts declaration citations are two lines low.
A5 (F4) one budget row and one test line are stale.
A6 (section 0) the same 16:53 edit is described twice with different provenance.
A7 (F6) widens the artifact.accepted payload without naming the open artifact-contract gate.
A8 (F2/F6) step 5 names src/runner/step.ts as its path while A12 forbids creating it.
