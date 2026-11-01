# Plan — flow Unit 2: WAIT + TRIGGER (durable park/resume)

Task: wait-trigger · Hash: f330a0aa · Gate: G3 · Status: draft (awaiting review) · Date: 2026-11-01

Basis: `spec.md` in this folder (R1-R16, D1-D6) and `research.md` (F1-F19, E1-E7). `spec: present` — the unit
adds a status, a node attribute, an engine entrypoint, a failure taxonomy and a host surface, so no §4 waiver
applies. **Design only.** An owner GO starts S1; each slice lands green before the next begins.

## Requirement basis

- R1 `waiting` + transitions — oracle: park/resume flip states; `waiting->completed` refused; advance on waiting refused
- R2 the `wait` node declaration — oracle: bad cardinality/type/timeout and a refuse-into-wait edge all `CONFIG_INVALID`
- R3 arrival parks (two sites) — oracle: `A->W->B` parks at W with one park event; a repeated arrival adds none; a non-wait flow never parks
- R4 the park event — oracle: one per arrival, payload carries type and an injected-clock deadline, `db.ts` unchanged
- R5 the resume entrypoint — oracle: match -> running at the same step; each refusal writes nothing; a stranger is `INSTANCE_FORBIDDEN`
- R6 the receipt — oracle: one per resume, digest stable, no undeclared field stored
- R7 idempotent resume — oracle: two identical resumes -> one receipt; a resume while running is refused
- R8 lazy timeout — oracle: past-deadline resume fails with `WAIT_TIMEOUT`, `failedReason` derives, no receipt, no timer
- R9 the matcher — oracle: exact match resumes; missing/wrong/typed-mismatched fields refuse; extras ignored
- R10 the parked result — oracle: `status: waiting`, `nextAction: "wait: <type>"`; other results unchanged
- R11 the trigger seam — oracle: no trigger node/edge exists; the actor is recorded as given and never authenticated
- R12 idempotent triggers, no exactly-once — oracle: two starts with one request id -> one instance; two identical resumes -> one receipt
- R13 the human node — oracle: park -> resume -> submit -> the ordinary gate refuses a below-bar artifact
- R14 non-wait flows byte-identical — oracle: existing suite green, five digests match, `db.ts` diff empty
- R15 codes and mirror — oracle: `tsc` clean and the taxonomy test green with 38
- R16 scope — oracle: `git status --porcelain docs/tasks/wait-trigger-f330a0aa` lists three documents

## Affected declarations

| Path | Declaration | Before | Effect | Requirement | Callers |
| --- | --- | --- | --- | --- | --- |
| `src/types/schema.ts` | `InstanceStatusSchema` (`:282`) | 3 values | **replace**: `+= "waiting"` | R1 | `store/instance.ts`, `result.ts`, envelopes |
| `src/types/flow.ts` | `NodeSchema` (`:73`), `NODE_KEYS` (`:319`), `superRefine` (`:139`) | id/task/domains/decide | **create** `WaitSchema`; **replace** the node shape and the key list; **create** the refuse-target rule | R2 | `parseFlowConfig` (`:332`), `openFlow` |
| `src/store/instance.ts` | `TRANSITIONS` (`:42-46`) | running->completed/failed | **replace**: + running->waiting, waiting->running, waiting->failed | R1 | `setStatus` (`:163`) |
| `src/types/errors.ts` / `src/types/pi.ts` | `Code` (`:21-60`) / `CODES` | 36 codes | **replace**: +2, mirror +2 | R15 | every module / envelopes |
| `src/runner/engine/types.ts` | `EVENT` (`:9-32`) | 21 names | **create** `instanceParked`, `waitResumed`; **create** `ResumeOptions`, `Resumed` | R4, R6 | `wait.ts`, `cli.ts` |
| `src/runner/engine/wait.ts` | — | absent | **create**: `arriveAt`, `resume`, `matchEvent`, `deadlineOf` | R3-R9 | `start.ts`, `advance.ts`, `cli.ts` |
| `src/runner/engine/start.ts` | the created path (`:59-70`) | sets `running` | **replace**: park when the first node waits | R3 | `cli.ts`, `operations.ts` |
| `src/runner/engine/advance.ts` | the successor move (`:381-388`) | `setStatus(running, successor)` | **replace**: `arriveAt(...)` | R3 | `cli.ts`, `operations.ts`, 33 test sites |
| `src/runner/engine/index.ts` | the barrel | — | **replace**: re-export `resume` and its types | R5 | importers |
| `src/runner/result.ts` | `nextActionFor` (`:38-44`) | resume for every non-terminal status | **replace**: `waiting` arm | R10 | `buildResult` |
| `src/cli.ts` | the `resume` verb (`:112-137`) | `advance` | **replace**: `--event <file>` selects `resume`; a parked instance without it refuses with a hint | R11 | the operator / a host cron |
| `tests/testkit.ts` | `writeFlow` | node fixtures | **replace**: a `wait` fixture field | R2, R3 | every runner test |
| `tests/types/errors.test.ts` | `TAXONOMY_SIZE` (`:46`) | 36 | **replace**: 38 | R15 | — |
| `tests/runner/wait.test.ts` | — | absent | **create**: arrival/park oracles (R1-R4, R14) | R1-R4, R14 | — |
| `tests/runner/wait-resume.test.ts` | — | absent | **create**: resume oracles (R5-R10, R12, R13) | R5-R13 | — |

## Budget

| Path | Current LOC | After LOC | Split owner boundary if >600 |
| --- | --- | --- | --- |
| `src/runner/engine/wait.ts` | — | ~180 | new; if it grows past ~450 split `arriveAt` from `resume` into `wait-park.ts`/`wait-resume.ts` |
| `src/types/flow.ts` | 345 | ~375 | under |
| `src/runner/engine/advance.ts` | 394 | ~404 | under |
| `src/runner/engine/types.ts` | 237 | ~262 | under |
| `src/cli.ts` | 183 | ~210 | under |
| `src/runner/engine/start.ts` | 132 | ~140 | under |
| `src/types/schema.ts` | 357 | ~359 | under |
| `src/store/instance.ts` | 199 | ~202 | under |
| `src/runner/result.ts` | 67 | ~71 | under |
| `src/types/errors.ts` / `pi.ts` | 94 / 469 | 98 / 471 | under |
| `src/pi/operations.ts` | 589 | **589 (untouched)** | the 600 cap leaves no room for a new op; R11's CLI surface is the reason |

## Steps

**Slice A is the buildable core** (a park/resume engine with durable evidence, reachable from the host CLI).
**Slice B is the parts gated by #6/#7** and is *not* built here. Nothing in this plan is authorized yet.

1. **S1 — status and node declaration** — files: `src/types/schema.ts`, `src/types/flow.ts` — add
   `"waiting"`; add `WaitSchema`; add `wait` to `NodeSchema` and `NODE_KEYS`; add the refuse-target rule.
   Done when: a wait node loads; the four negative shapes and the refuse-into-wait edge are `CONFIG_INVALID`;
   a `wait` + `decide` node loads. Requirements: R1, R2.
2. **S2 — the transition map** — file: `src/store/instance.ts` — three new moves. Done when: `tsc` compiles
   (the `Record<InstanceStatus, ...>` makes the omission an error), park/resume flip, `waiting->completed` refused.
   Requirement: R1.
3. **S3 — the codes** — files: `src/types/errors.ts`, `src/types/pi.ts`, `tests/types/errors.test.ts` — two
   codes, the mirror, `TAXONOMY_SIZE = 38`. Done when: `tsc` clean, taxonomy test green. Requirement: R15.
4. **S4 — engine types** — file: `src/runner/engine/types.ts` — `EVENT.instanceParked`, `EVENT.waitResumed`,
   `ResumeOptions`, `Resumed`. Done when: the names exist and nothing else changes. Requirements: R4, R6.
5. **S5 — the wait module** — file: `src/runner/engine/wait.ts` (new) — `arriveAt` (park or move, idempotent,
   injected clock), `matchEvent` (exact equality over declared fields), `deadlineOf`, and `resume`
   (authority -> status -> park-in-force -> deadline -> match -> dedupe -> receipt -> running). Done when:
   R3-R9's oracles pass and the module contains no `new Date()` and no timer. Requirements: R3-R9.
6. **S6 — wire the two arrival sites** — files: `src/runner/engine/start.ts`, `src/runner/engine/advance.ts`,
   `src/runner/engine/index.ts` — the first node and the successor move go through `arriveAt`; export `resume`.
   Done when: `A->W->B` parks at W after A is accepted, a non-wait flow's moves are unchanged, and the existing
   suite is green. Requirement: R3, R14.
7. **S7 — the parked result** — file: `src/runner/result.ts` — the `waiting` arm of `nextActionFor`. Done when:
   a parked result reads `wait: <type>` and every other status' result is byte-identical. Requirement: R10.
8. **S8 — the host surface** — file: `src/cli.ts` — `resume <instance> --event <file>`; without the flag the
   command keeps today's meaning and a parked instance refuses with a hint. Done when: the CLI resumes a parked
   instance and a plain resume of one is `INSTANCE_STATE_INVALID`. Requirement: R11.
9. **S9 — proofs** — files: `tests/testkit.ts`, `tests/runner/wait.test.ts`, `tests/runner/wait-resume.test.ts` —
   every oracle R1-R14 as a runnable test (fakes only, no network), plus the five flow digests and the
   `db.ts` diff guard. Done when: the suite is green and the digests match. Requirements: R1-R14.
10. **S10 — the review this plan schedules** — a **reviewer** writes `review.md` (docs/WORKFLOW.md §3), one
    section per gate attempt, with the subject digests and findings ranked by consequence. Done when: a verdict
    naming R1-R16 exists. **No approval is assumed**: G4 starts only after G3 passes and the owner GO, and G6
    is the owner's statement.

## Checks

| # | Command | Scope | Expects |
| --- | --- | --- | --- |
| 1 | `npm run check` | whole repo | exit 0, no output |
| 2 | `npm test` | whole suite | all pass, no network |
| 3 | `wc -l src/runner/engine/wait.ts src/types/flow.ts src/runner/engine/advance.ts src/cli.ts src/pi/operations.ts \| awk '$1>600{bad=1} END{exit bad}'` | the cap | exit 0, nothing printed (`operations.ts` still 589) |
| 4 | `sha256sum .pi/praxis/flows/engineering/*.json .pi/praxis/config.json` | byte-identical flows | the five digests from the branch unit's record |
| 5 | `git diff src/store/db.ts` | no DDL | empty |
| 6 | `node --test tests/runner/wait.test.ts` | R1-R4, R14 | pass: one park event per arrival, none for a non-wait flow |
| 7 | `node --test tests/runner/wait-resume.test.ts` | R5-R10, R12, R13 | pass, including the zero-write refusals and the idempotent double resume |
| 8 | `sqlite3 <store>/praxis.sqlite "select count(*) from event"` before and after a `WAIT_EVENT_INVALID` resume | zero-write refusal | identical counts |
| 9 | `grep -n "new Date()\|setInterval\|setTimeout" src/runner/engine/wait.ts` | injected clock, no daemon | no output |
| 10 | `node --test tests/types/errors.test.ts` | R15 | pass with `TAXONOMY_SIZE = 38` |
| 11 | `bun src/cli.ts resume <parked-instance>` (no `--event`) | R11 | `INSTANCE_STATE_INVALID` and a hint naming `--event` |
| 12 | `bun src/cli.ts resume <parked-instance> --event <file>` | R5 | exit 0, status `running` at the same step |
| 13 | `sqlite3 <store>/praxis.sqlite "select type, count(*) from event where type in ('instance.parked','wait.resumed') group by type"` | R4, R6 | exactly one park per arrival and one receipt per resume |
| 14 | `git status --porcelain docs/tasks/wait-trigger-f330a0aa` | R16 | exactly this folder's three documents |

## Regression notes (verified against the current tree)

- `tests/store/store.test.ts:123-137` asserts that `completed` and `failed` are terminal and that an unknown
  status (`"blocked"`, cast `as never`) is `INSTANCE_STATE_INVALID`. Adding `waiting` changes neither: the
  terminal states stay terminal and `blocked` stays unknown.
- `tests/runner/branch.test.ts:147`, `tests/runner/note-gate.test.ts:59` and friends assert
  `status: "running"` for flows that declare no wait — those flows never park (R14).
- `tests/runner/result.test.ts:140` pins `nextAction: "resume"` for a running instance; only the new
  `waiting` arm of `nextActionFor` is added, so it stays true.
- `tests/pi/alignment.test.ts:52,120` pin the six result keys; no key is added (R10).

## Recovery

- **A slice fails a check.** Stop that slice; the diff is the whole change, so reverting it restores the last
  green state. Nothing later depends on a red slice.
- **A crash lands between the park append and the status move.** The next arrival sees the park already recorded
  and only moves the status (idempotent by construction, R3), so the instance is never silently running at a
  wait node with a lost park.
- **A second park or a second receipt appears** (two `instance.parked`/one arrival, or two `wait.resumed`/one
  park). Evidence invalidated: R4, R6, R7. Cure in `wait.ts` (dedupe on the park `seq` and the event digest);
  never delete an event — the log is append-only.
- **A deadline computed from the ambient clock** (check 9 finds `new Date()`). Evidence invalidated: R8's
  determinism and any verdict that relied on it. Cure: take the time from the engine's injected `stamp`.
- **A parked instance never resumes.** Expected outside a host seam: this is gate #6/#7 territory. It is visible
  in `status`, `summary` and `nextAction`, and it is not a defect to "fix" with a scheduler.
- **A wait node is edited into a shipped flow.** That breaks R14's byte-identical claim; the flow documents are
  the owner's to change, and this unit must leave them alone.

## Out of scope

The gated table in `spec.md` (retention #6, scheduler #7, a Pi-tool `op=resume`, brief enrichment, a timeout
branch), nesting (#4/#8), any isolation or trusted-identity claim (gates #1/#3), any exactly-once claim, and any
change to the quality gate, bars, scorer, recall ranker, branch router, task documents, shipped flows, the
`pi` tool envelope, `AGENTS.md`, or any `src/`, `tests/`, `.pi/` path **by this unit** (R16).
