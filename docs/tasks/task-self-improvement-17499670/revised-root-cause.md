# Revised root cause — the scorer does not know the task

Task: task-self-improvement · Hash: 17499670 · Gate: G1 (revised) · Status: draft — design predecessor of `plan.md` · Date: 2026-10-31
Labels: **SM** store-measured (query shown) · **SI** source-inspected (path:line) · **DOC** repo document.

Supersedes the priority of the earlier `docs/task-self-improvement-17499670/research.md` diagnosis (nested MIN, unreachable
criteria, floor, EMA). Those findings stand — they are **downstream amplifiers**. This document puts the
semantic defect first and re-orders the whole fix.

---

## 0. What changed in this revision

The earlier report was right about the mathematics and wrong about the priority. Nested MIN, the unreachable
criteria, the 0.6 floor and the EMA are real — but they amplify a blind judgment. The cause is upstream:
**the judge is asked to grade an artifact against a task it was never told about, for a question it never saw,
section by section that carry no meaning.** Fix the semantics and half of the unreachable criteria evaporate;
leave the semantics and every mathematical fix merely re-scores a blind judgment more kindly.

---

## 1. The semantic defect (primary) — five verified breaks

### 1.1 The real order is discarded at the door — SI + SM

`op=start` *requires* the order (`src/pi/operations.ts:180`) and spends it **only** on the alignment gate
(`:186 judgeOrder({ order, anchor })`). `start()` is then called **without it** (`:196`:
`start({ ...options, flow, requestId, actor, roles })`; `StartOptions` has no `order`). The store proves it
never lands:

```sql
SELECT payload FROM event WHERE type='instance.created' LIMIT 1;
```
```json
{"actor":"pi-session:…","flow":"flows/engineering/feature","flowDigest":"sha256:9b44…",
 "nonce":"eccc…","requestId":"base-w02","storeDir":"/tmp/praxis-rewarm"}
```

No order, no task goal, no scope. `SELECT type,count(*) FROM event WHERE payload LIKE '%order%'` returns only
**learning.note (9)** and **recall.selected (5)** — the word appearing inside lesson prose. **The order is not
durable anywhere in 784 events.** The alignment judgment is envelope-only too; no event carries it.

The scorer's goal is the *constant*: `src/quality/evaluate.ts:243` passes
`{ goal: task.goal, artifact: options.artifact, subjectDigest }`, where `task.goal` for research is
`establish what is true from sources and the code before anything is designed` (`research.json`).

**Consequence:** the only question in the request is the one the artifact wrote about itself. All 64 research
artifacts carry their own `question` section, and they differ (SM):
`{"boundary":"The gate's combination of already-computed dimension scores…"}`,
`{"boundary":"Only the recall.ranked cache on the recallRanked path…"}`. So `covers-question`, `coverage`,
`gap`, `alignment`, `answered-what-asked` and `drift` are graded against **the agent's self-declared framing**.
That is a closed loop, not a judgment.

### 1.2 The task goal is bare and wide — SI + DOC

`TaskConfigSchema.goal` is `z.string().min(1).max(1000)` (`src/types/schema.ts:238`). There is **no `rationale`,
no `scope`, no `mustAnswer`, no `mustNot`** anywhere in the task document (top keys: `id, version, state, gate,
goal, capabilities, produces, requires, quality`). One sentence has to serve as the agent's commission *and* the
judge's standard. It cannot.

### 1.3 Sections have no intent — SI + DOC (with one correction)

`RequirementSchema` is `{ section, note?, required?, each?, values?, … }` (`src/types/schema.ts:109-124`). The
`note` field **is** carried into the brief and is explicitly *never machine-graded* (`schema.ts:112`). So the
mechanism exists but is **essentially unpopulated: 1 of 12 task documents uses `note`**
(`design/spec.json`); `research.json`'s six sections are bare names — `contract, question, sources, findings,
affected, uncertainty`. The **judge sees none of this**: no section, no note, no goal — only the blob.

### 1.4 Probes and dimensions are untargeted — SI

`ProbeSchema` = `{ id, type, instructions, criteria?, clean? }` (`src/types/quality.ts:18-64`) and
`QualityDimensionSchema` = `{ id, statement, probes?, floor? }` (`src/types/quality.ts:67-82`). **No section
linkage on either.** `grounded.every-claim-cited` does not say it judges `findings`+`sources`;
`parsimony.deletable` is scoped to nothing.

### 1.5 Therefore the jev request is a flat, disconnected blob — SI

`src/quality/jev-scorer.ts:224`: `state = { goal, artifact, subjectDigest }` where `artifact` is the **whole
document**, and every question is `probe.instructions` alone (`questionOf`, `:69-78`) with the generic `JUDGE`
sentence for the witness (`:31`). No section, no order, no task intent, no reference text.

### 1.6 The store carries the fingerprint of exactly this — SM

| Dimension / criterion | avg | p50 | What it needs to be judged | Read |
|---|---|---|---|---|
| **covers-question.coverage** | **0.941** | 0.965 | the real order | **nearly free** — the artifact supplies its own question |
| alignment (dimension) | 0.840 | 0.86 | the real order | free |
| grounded (dimension) | **0.458** | 0.46 | the cited sources' text | collapses |
| **parsimony (dimension)** | **0.331** | 0.32 | what the question needs (scope) | collapses |
| `grounded.locatable` | **0.460** | 0.46 | the cited text — never supplied | coin-flip, 95 % < 0.6 |
| `parsimony.redundant` / `.deletable` | 0.371 / 0.389 | — | the asked question + scope | harsh global vibe |

**The pattern is the diagnosis:** the dimensions that need the *order* are cheap and near-ceiling; the ones that
need *targeted content* sit near 0.4. A judge that cannot see the assignment rewards the artifact's own story
and punishes everything that needs evidence it was never given.

**A real citation, SM:** `{"source":"src/quality/bar.ts","location":"207-219 (compoundDecision body, read in
full)","establishes":"the whole combination in one function…"}` — **no quoted text**. So `locatable` (does the
cited location actually contain the claim) is not merely hard; it is unanswerable from the request as composed.

---

## 2. The grader findings (downstream) — unchanged in substance, now explained

Given 1.1–1.5, the arithmetic turns weak, unanchored judgments into a hard zero:

| Finding | Evidence | Label |
|---|---|---|
| **Nested MIN** — headline = MIN over dimensions (`evaluate.ts:129`), each dimension = MIN over its criteria (`jev-scorer.ts:140-146`, `bound` at `:235-250`) | headline p50 **0.305**, max **0.50**; **parsimony's max over 198 verdicts is 0.555** → `P(pass) = 0` by construction | SM |
| **Categorical zero** — a non-clean `choice` scores `0.0` (`jev-scorer.ts:146`) | **19/198 verdicts at exactly 0.000**, e.g. `grounded=[0.68,0.26,0.31,0]` → 0 | SM + SI |
| **Floor above the rubric's support** — 0.6 | **198/198** fail `qualityPerDimension`; **149/198** clear `qualityMean` | SM |
| **No passes → no ratchet** — `genuinePasses` skips `failed` acceptances (`bar.ts:134`) | **64/64** accepted carry `failed`; **0** `bar.raised/held/contested/sampled` | SM + SI |
| **Teaching works, the statistic hides it** — the bound criterion rises +0.085/attempt (95/134 up) while the mean of all criteria is −0.006 | `stalled` on the MIN headline (`quality-loop.ts:200-202`) ends **64/64** runs at attempt **2–3** despite `maxAttempts: 10` (`.pi/praxis/config.json`); **0/63** recall sets contain a passing exemplar (`withExemplar`, `recall.ts:277-281`, is dead code) | SM + SI |
| **EMA** — never executes | `bar.ts:408` (no 5-pass window). Still wrong for its job when it does | SM + SI |

**Why this is downstream:** under 1.1–1.5 a *good, on-order* artifact cannot score high on `covers-question`
(the judge cannot tell) and a *padded* one cannot be caught (no scope to measure padding against). The maths
then guarantees the floor is unreachable. Fix the maths first and you get a kind, meaningless pass; fix the
semantics first and the maths becomes tunable.

---

## 3. The corrected causal chain

```text
no order + bare goal + sectionless sections + untargeted probes
        │
        ├─► the artifact's own `question` is the standard  → covers/alignment near-ceiling (0.84–0.94)
        ├─► criteria that need evidence have none          → locatable/redundant/deletable ≈0.37–0.46
        │
        └─► nested MIN over 19 blind judgments             → headline p50 0.31, parsimony max 0.555
                    │
                    ├─► 0/198 pass → 0 genuine passes → 0 bar raises → bar frozen at seed
                    └─► MIN hides per-attempt progress → `stalled` at attempt 2–3 → no positive exemplar
```

---

## 4. Corrected priority order (end to end)

| # | Step | Kind | Gate effect | Breaking? |
|---|---|---|---|---|
| **T1** | Task-document intent, **additive optional**: `rationale`, `scope`, `requires[].goal`/`rationale`, `probes[].sections` + validation + `targeted` flag | schema/code | none (absent = today) | **No** |
| **T2** | Order durability: `StartOptions.order`, `instance.created.order/orderDigest`, `orderOf()` | code/event payload | none (nothing reads it) | No |
| **T3** | Composed scorer: `goal = order + task intent`, `subject = targeted sections`, probes grouped by section, witness kept, plan recorded | code | **YES — it changes scores** (owner-visible; never lowers a bar, no new gate) | No |
| **T4** | Author **research v6**: rationale, scope, six section goals, probe→section targeting, a short quote per source | data | none directly | No |
| **T5** | Re-measure with the same rig; re-derive floor + tolerance from the new distribution | measurement | informs T6 | No |
| **T6** | Grader maths (the prior P0–P6, ~10 %): choice credit → mean within a dimension → floor → no-progress on the vector → criterion-level recall/notes → trimmed-mean ratchet | code | floor raise only; never-lower untouched | No |
| **T7** | Acceptance: pass rate, attempts/pass, bound-criterion Δ vs control, order-anchored coverage | measurement | — | No |

**Justification for the inversion:** under the current request the judge grades an artifact's *story about
itself*; every mathematical fix below T3 merely re-weights a blind judgment — which is why 198 attempts produced
0 passes, 0 raises and a flat +0.02 across waves, while a targeted fix to a *named* criterion still moved it
+0.085. Give the judge the assignment first; then tune the arithmetic.

---

## 5. What survives of the earlier P0–P6 once anchoring exists

| Prior item | Status after T1–T4 | Why |
|---|---|---|
| `grounded.locatable` unanswerable | **changes, still needed** | With the order + a targeted `sources` section + a required short quote per source, the judge CAN check the quote supports the claim. The path-exists check belongs in the deterministic section gate, not jev. |
| `parsimony.deletable` / `.redundant` | **changes, still needed** | Removable-without-losing-the-answer becomes answerable only when the question is known — the criterion becomes meaningful rather than a global vibe. The ladder's top rung is still perfection; recalibrate it. |
| choice → 0.0 annihilation | **survives unchanged** | Independent defect; 19/198 headlines at 0.0. |
| MIN → mean within a dimension (MIN across dims kept) | **survives, less urgent** | Anchored scores should be less noisy, but monotonicity stands: an improvement must move the score or the loop cannot see it. |
| Floor rescale | **re-derive, do not hard-code** | Anchoring moves the distribution in both directions; 0.70 was measured on blind judgments. |
| No-progress on the dimension vector | **survives unchanged** | 64/64 runs died at attempt 2–3 while the target criterion improved. |
| Criterion-level notes/recall | **survives, gets better** | A lesson can now name (section, criterion); `withExemplar` starts working once passes exist. |
| Trimmed-mean ratchet | **survives unchanged** | Inert until passes exist. |
| Teaching metric | **survives; add one** | Add order-anchored coverage: does the artifact answer *the order*, not its own question. |

---

## 6. Boundaries (unchanged, restated)

No identity, isolation or exactly-once claim. The semantic anchor is **routing/definition hygiene**, not
confinement: a direct engine or shell call bypasses every judgment (gate #1 open). Provenance stays the
instance actor string (gate #3 open). No store schema change: the order rides an existing event payload
(gate #6 untouched). No background process (gate #7 untouched). Recall stays within one project store; rubric
intent stays per task, never federated (Jung line). Nothing here lowers a bar or touches the never-lower
invariant.

---

## 7. Evidence index (reproducible)

Store: `/tmp/praxis-rewarm/praxis.sqlite` (784 events, 64 instances, research v5, `flows/engineering/feature`).

```sql
-- the order is not durable
SELECT payload FROM event WHERE type='instance.created' LIMIT 1;
SELECT type,count(*) FROM event WHERE payload LIKE '%order%' GROUP BY type;
-- the headline and the mean
SELECT round(json_extract(payload,'$.score'),2) s,count(*) FROM event WHERE type='quality.verdict' GROUP BY s;
SELECT round(json_extract(payload,'$.mean'),2) m,count(*) FROM event WHERE type='quality.verdict' GROUP BY m;
-- which dimension limits, and which criterion binds
SELECT json_extract(j.value,'$.id'),count(*) FROM event e, json_each(e.payload,'$.dimensions') j
 WHERE e.type='quality.verdict' GROUP BY 1 ORDER BY 2 DESC;
SELECT json_extract(j.value,'$.bound'),count(*) FROM event e, json_each(e.payload,'$.dimensions') j
 WHERE e.type='quality.verdict' AND json_extract(j.value,'$.bound') IS NOT NULL GROUP BY 1 ORDER BY 2 DESC;
-- gate checks
SELECT json_extract(payload,'$.checks.qualityMean') m,count(*) FROM event WHERE type='gate.verdict' GROUP BY m;
```

Code anchors: `src/pi/operations.ts:180-196` (order used only for alignment) · `src/runner/engine/types.ts`
(`StartOptions`, no order) · `src/runner/engine/start.ts:92-99` (created payload) · `src/quality/evaluate.ts:243`
(goal = task.goal) · `src/quality/jev-scorer.ts:69-78,224` (whole-blob state, bare probe questions) ·
`src/types/quality.ts:18-64,67-82` (no targeting) · `src/types/schema.ts:109-124,233-250` (no section/task intent)
· `src/quality/bar.ts:134,408` (failed passes excluded, no window) · `src/runner/engine/quality-loop.ts:200-202`
(stalled) · `src/quality/recall.ts:277-281` (exemplar requires a pass).
