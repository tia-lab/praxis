# Praxis — working procedure

**Owner of:** how work is sequenced and reviewed — phases, gates, task identity,
document shapes, roles and stop conditions.
**Not owner of:** scope and authority (`AGENTS.md`), product design
(`docs/vision.md`). Where they disagree, this file is wrong about procedure and
`AGENTS.md` about scope; the owner resolves it. No fact is stated twice.

**Binding principles:** the in-repo conduct profile
`.pi/praxis/profile/conduct/occam.json` and the in-repo rule sets under
`.pi/praxis/rules/`. The conduct profile is the text the agent actually receives in
its composed prompt, and the rule sets are versioned beside it: the canon cannot drift
from what runs.
`.pi/skills/praxis-minimality/` owns the canon statement and the citation rules; cite
a rule id (`minimality/smallest-complete-system`) in every plan entry, finding and
blocker so a minimality claim is checkable instead of rhetorical. `MIN-0xx` ids
appear in earlier ledger, plan and review text: they are historical notation for the
external Occam canon, read-only inspiration and not a dependency. The Occam role
skills and the `occam_reason` tool are **out of scope** — Occam is not installed
here and its instrumentation gates are inapplicable.

## 1. Task identity

Every authorized unit of work owns exactly one folder:

```
docs/<slug>-<hash8>/
  research.md   §0 holds the contract verbatim; it is the hash input
  spec.md       requirements + model            (waivable, §4)
  plan.md       declarations, steps, checks     (always)
  review.md     append-only verdicts            (always)
```

- `slug` — lowercase-hyphen, ≤40 chars, from the task name.
- `hash8` — first 8 hex of `sha256` over the canonical block below.
- The three canonical lines are **one physical line each**. Wrapping them breaks
the hash; never reflow §0.

```sh
canonical() { printf 'task: %s\nscope: %s\nacceptance: %s\n' "$1" "$2" "$3" \
  | sed -E 's/[[:space:]]+$//'; }
canonical "<goal, one line>" "<paths>" "<checks>" | sha256sum | cut -c1-8
```

Rules:

- `research.md` §0 is the **single owner** of the task contract. `AGENTS.md` holds
  only a one-line pointer (folder + hash).
- The folder name is immutable once G1 passes. A changed contract is a **new**
  hash and a **new** folder; the old folder gains `superseded-by: <new>` and is
  never deleted.
- An identical canonical block is the same task: reuse the folder. Two distinct
  contracts colliding on 8 hex extend both to 12 and say so in §0.
- `research.md`, `spec.md` and `plan.md` may be amended until their gate passes;
  each amendment appends one line: `amended <date> — <what changed> — <why>`.
  After a gate passes, changing that document needs a new review attempt, and a
  contract change additionally needs a new folder.
- `review.md` is append-only. Nobody edits a verdict.
- `docs/` is tracked in Git: it is evidence. Runtime state, stores and WAL files
  never are.

## 2. Phases and gates

```
G0 CONTRACT → G1 RESEARCH → G2 SPEC → G3 PLAN → G4 IMPLEMENT → G5 REVIEW → G6 ACCEPT
                                ↑FAIL       ↑FAIL      ↑FAIL
```

| Gate | Artifact | Pass condition | On FAIL |
| --- | --- | --- | --- |
| G0 | ledger entry + folder | owner goal, scope and acceptance recorded; `hash8` reproducible | stop |
| G1 | `research.md` | sources at `path:line`; competing explanations; labelled findings; affected owners/callers; uncertainty; review PASS | amend, new attempt |
| G2 | `spec.md` or §4 waiver | requirement ids with failure behaviour and oracle; model with one owner per fact; exclusions; alternatives; review PASS | amend, new attempt |
| G3 | `plan.md` | affected-declaration table; steps ordered by dependency; checks table; recovery; out of scope; LOC budget; review PASS | amend, new attempt |
| G4 | code | each step's narrow check executed and inspected; plan coverage current; no unplanned declaration | return to G3 |
| G5 | `review.md` | findings against requirement ids; minimality challenged (`minimality/no-speculative-surface`, `minimality/measure-real-complexity`, `minimality/prefer-dominating-alternative`); verdict PASS | return to G3/G4 |
| G6 | — | the **owner** accepts the artifact against the statement | reopen |

Hard rules:

- No gate starts before its predecessor passes. No code before G3 PASS.
- G4 may not introduce a declaration absent from the plan; finding one is a G3
  amendment, not improvisation.
- G6 is an owner statement. Passing tests, a green build, a merged branch or a
  reviewer PASS are not acceptance.
- A gate is re-entered only by a new attempt recorded in `review.md`.

### 2.1 The loop as practised

The diagram above is the gate ladder. This is the order work actually moves in.

```
align → design + plan → lead-verify → implement → live-probe → owner accepts
```

- **align** (G0) — intent, target, frozen and open decisions, limits, acceptance. A
  unit whose outcome two materially different results could satisfy is not aligned;
  align before commissioning research or a team.
- **design + plan** (G1/G2/G3, moving together) — a spec may be frozen
  **provisional**: unpassed, its open contradictions deliberately left for the plan
  and the code to find. Research is recorded in the task folder, not staged as its own
  ceremony, when the sources are already in hand and named at `path:line`.
- **lead-verify** — the review at each of those gates. Reviews are **incremental**
  (§3).
- **implement** (G4) — ordered slices, each behind the same checks (`tsc`, the suite,
  the narrow test), one commit per slice, never a red commit.
- **live-probe** (G5) — a real agent on a real flow answering from its injected
  prompt (`docs/LIVE-TEST.md`). No unit test establishes this.
- **accept** (G6) — only the owner's statement completes a task.

A heavy full-document review loop — every attempt re-reading the whole artifact — was
tried and **stopped by the owner**: it produced ceremony instead of findings. Do not
re-introduce it.

## 3. Review contract

One section per gate attempt in `review.md`:

```
## <gate> <artifact> — attempt <n> — <PASS|FAIL> — <ISO-8601 UTC>
subject: docs/<slug>-<hash8>/spec.md sha256:<64 hex>
reviewer: <identity>  independence: self|independent
findings:
- F1 [blocking] <path:line|section> — <consequence> — cure: <smallest fix> — evidence: <read|run>
verdict basis: R1 checked by <how>; R2 <how>
```

- A verdict without a `sha256` of every reviewed file is void.
- `independence: independent` requires a different session that did not author the
  subject. Most verdicts here are written by the lead, including a lead driving
  separate herdr/Manifold agents: record what was actually independently **verified**
  (commands run, greps, diffs) and keep `independence: self` for authorship. Never
  claim an independence you cannot point at.
- The author never writes `review.md`.
- Findings are ranked by consequence and name a concrete consequence plus the
  check that would establish resolution. Speculation and taste are advisory at
  most.
- Blocking findings are resolved or explicitly carried into the next attempt;
  cancelling one needs evidence, not a re-reading.
- `contour_review` is a structural aid. It is not independence and not acceptance.

### Incremental reviews

A reviewer receives the changed lines, the previous verdict and the subject digest,
and judges **the delta and what cites it** — not the whole document again. That is
the owner's standing direction and what makes a review attempt per slice affordable.

A full-document review is reserved for a subject whose model changed, and the
verdict's first line says so.

## 4. Spec waiver

`spec.md` may be waived **only** when all three hold:

1. no type, schema, data model, persistence format, public API/tool contract,
   authority or permission semantics change;
2. the change is reversible;
3. the plan carries, inline, the complete requirements table with oracles, the
   logical model with owners, and the exclusions.

The plan then records `spec: none — basis: <one line naming why>`. Anything
irreversible, contract-bearing or model-changing needs a spec. A waiver is a
recorded decision, never an omission; a waiver hiding a model change is a blocking
finding.

## 5. Roles and teams

Default is one author. Compose more only against a named gap.

| Seat | When | Boundary |
| --- | --- | --- |
| author | always | only writer for the task folder and its claimed paths |
| reviewer | every gate from G1 | read-only; gets artifact paths, digests and requirement ids, never the author's narration |
| researcher | ≥2 independent source areas | read-only, disjoint claims, reports findings not code |
| coordinator | >3 seats | carries assignments; owns no task content |

- One writer per task folder. Parallel writers need disjoint claimed paths and an
  explicit split recorded in the plan.
- A claim is metadata, not a lock: verify bytes, never the claim.
- Handoff carries goal, exclusions, acceptance, claimed paths, artifact paths and
  `hash8`. Return carries artifact, evidence, verdict. Never a transcript.
- Every seat must be justified by evidence in the compose reason; no seats for
  hypothetical futures (`minimality/no-speculative-surface`).
- Manifold is in use: the lead staffs seats through herdr/Manifold agents. This file
  grants no assignment authority of its own, and an assignment does not manufacture
  independence — a verdict is `independence: independent` only when a separate
  session that did not author the subject produced it.

## 6. Invariants

Binding without restatement:

- The in-repo conduct profile and minimality rule set (header), cited by rule id.
- `docs/vision.md` §11 (1–12) by reference.
- `AGENTS.md` product and security constraints.

Repo-local consequences:

- Data model first: types, owners, valid states and invariants before operations.
- One authoritative owner per fact; derive rather than duplicate.
- Explicit valid states; no optional-field envelope that hides them.
- Fail closed with a typed reason; no swallowed error, no plausible-success path.
- Historical evidence is immutable; a new interpretation is a new record.
- No claim of sandbox, exactly-once, savings or compliance without evidence.

## 7. Code rules

TypeScript now; Rust is declared but **not adopted**.

```
src/
  types/<domain>.ts     zod schema + z.infer types only; no I/O, no logic
  <owner>/<concern>.ts  behaviour; imports the contract from types/
  <owner>/index.ts      folder surface: re-exports only, zero logic
  index.ts              package surface
tests/                  node:test; mirrors src/ one level deep
tests/<owner>/<area>.test.ts
  testkit.ts            shared fixtures live here, never in src/
```

Tests never live inside `src/`. No `*.test.ts`, no fixtures and no test helpers under
`src/`. A write-claim limit is **not** a reason to co-locate a test: split the
assignment instead, or open the claim on `tests/` for the owner of the code under test.

1. ≤600 physical lines per file — stricter than the 700 in Occam/TIA and binding
   here. Split on an owner boundary; never to reach a number; never compress code
   to fit.
2. Types and runtime never mix. Schemas live in `types/`; behaviour validates at
   its own trust boundary using those schemas.
3. `index.ts` is the only allowed barrel. Any other index file is a defect.
4. Start every unit from its data structure; functions and module boundaries derive
   from the model, never the reverse.
5. Every declaration is bound to a requirement (`minimality/bind-to-requirement`) and
   listed in the plan; unrequested additions are blocking findings
   (`minimality/no-speculative-surface`).
6. Typed, discriminated failures. No string throws, no fabricated recovery.
7. Inject clock and IDs where behaviour depends on them; no ambient `Date.now()`.
8. Tests: narrow first, failure and recovery paths included, assertions derived
   from requirements; no production API added for tests; no new test framework.
9. No new dependency, config option or stored field without owner approval and the
   purpose/version/license/impact inspection in `AGENTS.md`.
10. Rust equivalence if ever adopted: `types/` modules, `mod.rs` as the folder
    surface, the same 600-line limit.

## 8. Evidence

Label every material claim: `documented`, `source-inspected`, `executed`,
`untested`, `proposed`. Record the actual command and outcome; never invent a
result, timing, approval or coverage. A passing check proves only what it
exercised.

## 9. Stop conditions

Stale authority or scope · changed contract hash · conflicting or unexpected edits
· failed check · unknown external effect · material deviation from the plan.

Action: stop the affected work, preserve unrelated edits, record the blocker and
report. Never work around a stop condition.

## 10. Definition of done

Complete means every approved requirement is implemented, its check executed and
inspected, recovery behaviour covered, findings resolved, and the owner accepts the
artifact. Not complete means tests pass, build is green, review PASS or code
merged. Those are evidence, not acceptance.

## 11. Not owned here

Product design (`docs/vision.md`); scope, authority and dependency policy
(`AGENTS.md`); Manifold operation (the `manifold` skill).
