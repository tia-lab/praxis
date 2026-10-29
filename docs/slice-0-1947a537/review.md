# Review — slice-0

Task: slice-0 · Hash: 1947a537 · Gate: G5 · Append-only. Nobody edits a verdict.

Reviewed tree: HEAD `ea2369f` (`test: move every test into tests/ mirroring src`), clean.
Reviewer: reviewer-1, separate session; not an author of the code or the move. The lead
performed the test move (commit `ea2369f`, attribution in `STATUS.md`), so this review
inspects the moved tree and does not re-litigate the move.

## Digests of every reviewed file

```sh
sha256sum docs/slice-0-1947a537/spec.md docs/slice-0-1947a537/plan.md \
  docs/slice-0-1947a537/research.md STATUS.md .pi/praxis/config.json \
  src/cli.ts src/types/errors.ts src/types/schema.ts \
  src/store/db.ts src/store/instance.ts src/store/events.ts src/store/artifacts.ts \
  src/runner/canonical.ts src/runner/capabilities.ts src/runner/engine.ts src/runner/result.ts \
  tests/testkit.ts tests/store/canonical.test.ts tests/store/store.test.ts \
  tests/runner/canonical.test.ts tests/runner/handoff.test.ts \
  tests/runner/negative.test.ts tests/runner/result.test.ts \
  package.json tsconfig.json .gitignore
```

```
2f6bc8d2a0339357751a93741df012d081b21931c0e54d427d6e3041e43d6cda  docs/slice-0-1947a537/spec.md
c1ae972a5a2fbd215d3fe28e8988f54229dfe0a7f6115de01fd6512a99df7cdd  docs/slice-0-1947a537/plan.md
36db027450f42c12c26392776b86b7df763ab4a872663c57ab6573261e330ea0  docs/slice-0-1947a537/research.md
502b7769ea32fc42454a1031d23edf40b28a98a9fd58d27cf16d00ec31a56025  STATUS.md
b3640654774ddbafb7e197764575a516564eacb250f4899926c3e94dba4c9cee  .pi/praxis/config.json
f6105957ae14c80bd95c0e3f3b55b300664887e02e83404d94d173335337dd6e  src/cli.ts
207a8a0874fe30c50418d0537a01dc1e302c13f0b7cb616d0ca360e0448e745a  src/types/errors.ts
81c1d684c824822068939e18dd1d415cb3e2689c6c4e83704bcabf4db1dd7e72  src/types/schema.ts
9507a686dbbb779a0ac04ef74174d5bce873644679b8ee1dee833d6daf4898a0  src/store/db.ts
d708eb495659ab107862a28faf744ebed6633688dad19d6a86a777982163b022  src/store/instance.ts
9f812a7faacc0451f143f2b460c7f6952259b16f7993f36db4efd1bd4b96789a  src/store/events.ts
c9da312c45397047e628a69e7d59c342d0e84c29c34f4566dbfcc653ac21e6da  src/store/artifacts.ts
64f29a94c197accd6520502cb1645d9fed810212b28bd0b7a7e73b2f8ba8e582  src/runner/canonical.ts
f22b94e749c8107c5854c3880bf146bb0a02e00f3c241fc3ff216a8a0939a985  src/runner/capabilities.ts
36e248eab7b57b02fb2156331bde662f2ba6ecc32b5ed68a7286c8672fd5cc60  src/runner/engine.ts
5044b6f9b27f165ad9d85d8c2fe3a936142509cf3717632fcb32b084e8b8a1f7  src/runner/result.ts
161eeab107edfa35f0ebb2d7e954aa590d0dc40002714111d079aa8ec22e9012  tests/testkit.ts
36a89af8dfb95e5ddb0e68e110253274f24c015bab417494c80eac7cbe5f89a6  tests/store/canonical.test.ts
0e02bd5f9e6f1f2e71340b9be023f02a649a3b17f515e14747ed494c8cb85069  tests/store/store.test.ts
c4165882b396ec0a2df9788765ccc4f6e6b6dddd00ee2e9f025ebcdc8e6fa44a  tests/runner/canonical.test.ts
2f7a88b513dfe4657aa184507756797d3c175e7e482b989baeb681515b7ef627  tests/runner/handoff.test.ts
2267044cb2e49848847a81b4cbf4f6a49a0cdbfded53330788880aee11dda928  tests/runner/negative.test.ts
f55eb534e438aaf645204ba21c55b794299693b30746984a3d783c439a8dabe5  tests/runner/result.test.ts
179b3eab4cb479eddcafb89c1929cf8bcf2f234686e6d9befe583c55ff04a54f  package.json
eb4f521ffb17bb0a85e36c898e31b74cfde14bd763426d66bffc84114cb55b68  tsconfig.json
69e7c248173fb6ee0d3a9f09de7546a31f90074d9b1b106ebaa893485b68b0a3  .gitignore
```

## What was executed

All labels below are `executed` unless marked otherwise.

```
node --version
  v24.9.0 (EXPERIMENTAL warning for node:sqlite on every run)

node --test tests/store/canonical.test.ts tests/store/store.test.ts \
  tests/runner/canonical.test.ts tests/runner/handoff.test.ts \
  tests/runner/negative.test.ts tests/runner/result.test.ts
  tests 29 | pass 29 | fail 0 | duration 1529ms

npx tsc --noEmit
  exit 0, no output

node --test tests/runner/handoff.test.ts
  P3 draft/derive distinct PIDs, derive trace only artifact.read/artifact.write — pass
  P8 SIGKILL between phases, same step/digest, one row per step, contiguous seq — pass
```

Direct probes (public CLI, throwaway stores under `/tmp`; the probe scripts are not part of
the tree):

```
# canonical hole
plain [1,,3]                    -> CANONICAL_INVALID "array is not exactly its indices at $"
[1,,3] + own extra=0            -> CANONICAL_INVALID "hole at $[1]"
[1,2], delete [0], extra=0      -> CANONICAL_INVALID "hole at $[0]"
{ a: [1,,3] } + a.extra=0       -> CANONICAL_INVALID "hole at $.a[1]"
[1,2] + note="extra"            -> CANONICAL_INVALID "array is not exactly its indices at $"
dense [1,2,3]                   -> accepted "[1,2,3]"

# gate reject (wrong nonce on draft)
exit 1, ARTIFACT_INVALID; gate.verdict reject {object:true,schemaMatches:true,noncePresent:false};
instance failed; draft artifact pending; no accepted event.

# R8 reject (derive artifact without derivedFrom)
exit 1, ARTIFACT_INVALID; gate.verdict reject {derivedFromMatches:false, noncePresent:true};
draft accepted, derive pending, instance failed.

# R2 idempotence / conflict
same request id, same payload  -> exit 0, created:false
same request id, other actor   -> exit 1, REQUEST_CONFLICT

# R1 invalid configs (unknown capability, bad consumes, three steps, bad schema name)
each -> exit 1, CONFIG_INVALID, no store file created (0 instances)

# R6 kill probes
SIGKILL 40ms into phase B with a 20 MB payload -> instance still running at derive,
only draft accepted, retry completed, one row per step, event seq 1..8.
SIGKILL the instant derive/v1.json appears (bytes before row) -> no derive row,
retry completed, one row per step, event seq 1..8.
```

Plan checks, run literally:

```
node --test src/store/canonical.test.ts   -> "Could not find ..." exit 1
node --test src/store/store.test.ts       -> "Could not find ..." exit 1
node --test src/runner/handoff.test.ts    -> "Could not find ..." exit 1
node --test src/runner/negative.test.ts   -> "Could not find ..." exit 1
node --test src/runner/result.test.ts     -> "Could not find ..." exit 1
grep -rn "from '" src | grep -v "node:" | grep -v "zod"  -> empty, exit 1
```

The five test commands name the pre-move paths; the same checks were then executed from
`tests/` (29/29, above). The grep is a **false-empty oracle**: every source import uses
double quotes, so it matches nothing whether or not a dependency exists. The real scan:

```
node:crypto node:fs node:path node:sqlite zod
```

Other executed checks:

```
sqlite_master -> tables artifact,event,instance,meta (all STRICT);
               triggers event_append_only_update, event_append_only_delete
grep event writes -> only INSERT INTO event (no UPDATE, no DELETE FROM)
grep 'throw "' src -> none; grep 'catch {' src -> none
wc -l src/**/*.ts -> max 573 (engine.ts), all < 600
git check-ignore -> .pi/praxis/state/praxis.sqlite ignored; .pi/praxis/config.json tracked
```

### Plan checks, executed from the new paths

The plan's own commands name the pre-move paths (F2); each check's subject was executed
from the approved `tests/` layout:

| # | Plan subject | Command executed | Output |
| --- | --- | --- | --- |
| P1 | one digest for two key orders | `node --test tests/store/canonical.test.ts` | 6 pass, 0 fail, exit 0 |
| P2 | four tables; event rejects UPDATE/DELETE | `node --test tests/store/store.test.ts` | 11 pass, 0 fail, exit 0 |
| P3 | distinct PIDs; B trace only read/write | `node --test tests/runner/handoff.test.ts` | 2 pass (P3 + P8), exit 0 |
| P4 | `ARTIFACT_UNAVAILABLE` / `ARTIFACT_DIGEST_MISMATCH`, zero writes | `node --test tests/runner/negative.test.ts` | 3 pass, 0 fail, exit 0 |
| P5 | six fields, no history | `node --test tests/runner/result.test.ts` | 2 pass, 0 fail, exit 0 |
| P6 | no non-node/non-zod import | actual-specifier scan | `node:crypto node:fs node:path node:sqlite zod`; no dynamic import/require |
| P7 | `tsc --noEmit` clean | `npx tsc --noEmit` | exit 0, no output |
| P8 | kill between phases, resume | P8 in `tests/runner/handoff.test.ts` + two independent SIGKILL probes | pass; one row per step; seq contiguous |

Suite total from the six files: 29 pass, 0 fail (1529 ms).

## Requirement status

| Id | Status | Evidence |
| --- | --- | --- |
| R1 | satisfied | Flow is data: `.pi/praxis/config.json` (sha `b3640654…`) parsed by `FlowConfigSchema`; two steps, capabilities, `produces.schema`, gate; unknown capability/consumes/three-step/bad-schema all `CONFIG_INVALID` with zero store written (probe). See F1 for the "template" wording. |
| R2 | satisfied | `start()` pins `configDigest` + actor and derives `instanceIdFor(flow,request)`; same request same payload → `created:false`; same request other actor → `REQUEST_CONFLICT`; `createInstance` refuses a duplicate id in one transaction (probe + `tests/store/store.test.ts`). |
| R3 | satisfied | `event` is append-only by trigger (UPDATE/DELETE abort), verified by schema dump and the store test; `instance` is the only mutable row and every write is a revision CAS. See F8 on derivation. |
| R4 | satisfied; duplicate-key clause unproven | Canonical bytes: sorted UTF-16 keys, arrays in order, UTF-8 no BOM, `sha256:`+hex; two key orders one digest and known empty-string vector (P1 tests). `src/runner/canonical.ts:14-16` explicitly states duplicate keys in *text* are undetectable; see F3. |
| R5 | satisfied with a narrow predicate | Deterministic `gate()` = object + declared schema-name equality + nonce (+ `derivedFrom` for a consuming step), recorded as a `gate.verdict` event before acceptance; reject marks the instance `failed`. Negative runs above. See F4 on body validation. |
| R6 | satisfied | P8 kill test (between phases) plus two independent SIGKILL probes: pointer stays at `derive`, accepted draft digest survives, retry completes, exactly one artifact row per step, event seq contiguous. Resume takes the step and predecessor from the store; the current step's payload is still caller-supplied (F10). |
| R7 | satisfied for the engine's fixed derive step; unproven for an arbitrary step body | `buildHandoff` produces exactly `{artifactRef,digest,path,schema}`; the engine passes it to `runStep`, which re-reads A under `artifact.read` and records the trace `["artifact.read","artifact.write"]`. There is no configurable step body, so the four-field object is used only via `digest`; `path`/`schema`/`artifactRef` are otherwise unused. See F1/F6. |
| R8 | satisfied | Gate on the consuming step requires `derivedFrom === handoff.digest` and the instance nonce; a derive artifact without `derivedFrom` is rejected (probe), and the accepted row records `derived_from` = A's digest (P3 test). |
| R9 | satisfied | Removing `artifact.read` from derive: `buildHandoff` throws `ARTIFACT_UNAVAILABLE` before dispatch; artifact rows, events and the instance row are byte-identical before/after (P7 test). |
| R10 | satisfied | A corrupted draft file fails `ARTIFACT_DIGEST_MISMATCH` in `buildHandoff` before dispatch with zero writes (P8 control); bytes are re-verified at record, read and accept. |
| R11 | satisfied | `ResultSchema` is strict and `buildResult` emits exactly `instanceId, flow, status, artifacts[], summary, nextAction`; a seventh key is `RESULT_INVALID`; no path, payload, event or transcript appears (P5 tests). |
| R12 | satisfied in `src`; manifest not satisfied | Real import scan: only `zod` plus `node:crypto/fs/path/sqlite`. `package.json` still declares `@nats-io/transport-node` and the name `pi-manifold`; the spec's OQ1 defers the manifest to the identity unit. See F5. |
| R13 | satisfied | One error module (`src/types/errors.ts`) with a closed `Code` union, `AppError`, `fail`, `asAppError`; no string throw and no bare catch in `src`; the CLI prints `{code,message,detail}` and exits 1. Unknown values collapse to `INTERNAL` (documented). |

## Findings, ranked by consequence

- **F1 [advisory] R7 / R1 "template"** — `src/types/schema.ts:54-60`, `.pi/praxis/config.json`,
  `src/runner/engine.ts:342-343,459-489,516-549`. The config declares `produces.schema`, not
  the `template` R1 names; there is no step body, so "B receives only the handoff" is proven
  for the engine's fixed derive step, not for any declared step code. Consequence: the
  containment claim is narrower than a reader of R1/R7 would assume; a future step body is
  not covered by an executed denial control. Cure: decide whether `template` means
  `produces.schema` (then say so in the spec/plan) or a step body (then execute it under its
  grant with the handoff as its only input and add the "B attempts a non-granted call"
  control). Evidence: source read, `grep handoff`, the gate probe that accepts
  `{schema,nonce}` with no body.

- **F2 [advisory] plan check table is stale** — `docs/slice-0-1947a537/plan.md` Checks.
  P1–P5 name `src/store/*.test.ts` / `src/runner/*.test.ts`; those paths ceased to exist in
  `ea2369f`. P6's grep can never fail because the sources import with double quotes.
  Consequence: the plan's literal commands cannot reproduce the review, and P6 would pass
  with any dependency. Cure: amend the plan to `tests/...` paths and a real specifier scan
  (`node:crypto node:fs node:path node:sqlite zod`); record the amendment. The equivalent
  checks were executed and pass, so this is a plan/document defect, not an implementation
  defect — but G6 should not cite P1–P6 verbatim until it is amended.

- **F3 [advisory] R4 duplicate-key clause is not implemented** — `src/runner/canonical.ts:14-16`.
  `JSON.parse` collapses `{"a":1,"a":2}` before canonicalisation; the module documents that it
  cannot see the text form. Consequence: duplicate-key text is normalised and accepted rather
  than refused, so the model's "no duplicate keys" is unproven. Cure: amend R4 to the parsed-
  value form, or add a duplicate-detecting parse (a parser is new scope and collides with
  R12). Evidence: source read; no test covers duplicate-key text.

- **F4 [advisory] R5's "schema-valid" is a name check** — `src/runner/engine.ts:100-104,556-573`.
  The gate checks that `schema` equals the step's `produces.schema` and that the nonce (and
  `derivedFrom`) match; it does not validate the artifact body. Consequence: a payload of
  `{schema,nonce}` is accepted for draft with no architecture content (probe). Cure: define
  body schemas per `produces` or narrow the spec wording to "declared schema name matches".

- **F5 [advisory] R12 manifest residue** — `package.json`. The name is `pi-manifold`, the
  scripts point at nonexistent files, and `@nats-io/transport-node` is declared alongside
  `zod`. Consequence: "Zod is the only third-party dependency" is true of `src` and false of
  the package. Cure: the authorized identity unit (spec OQ1 / AGENTS.md housekeeping), not
  this slice. Evidence: `package.json` read.

- **F6 [advisory] the step trace under-reports reads** — `src/runner/engine.ts:525` vs
  `461-471`. `buildHandoff` reads A's artifact through `probeArtifact` without
  `call(grant,"artifact.read",…)`, while `runStep` performs a second read inside the trace.
  Consequence: `step.trace` lists one `artifact.read` although B's step caused two; the P3
  assertion enshrines the under-report. Cure: route the handoff read through `call` (and
  expect two reads) or record the handoff read explicitly.

- **F7 [advisory] store → runner layering** — `src/store/events.ts:11`,
  `src/store/artifacts.ts:17` import `../runner/canonical.ts`. This is the non-blocking
  layering observation for the P1 decision: claim A's store depends on claim B's runner
  path, inverting the intended bottom-up order and making the store unbuildable without the
  runner module. Cure: move `canonical.ts` to `src/types/` (or a neutral shared module) and
  re-point both owners. Evidence: import grep.

- **F8 [advisory] instance row is written beside the events, not derived from them** —
  `src/store/instance.ts`, `src/runner/engine.ts:373-400`. `status`/`current_step` are updated
  directly; the event log has no status-transition event, so the row cannot be rebuilt by
  replay. A kill between `acceptArtifact` and `appendEvent(artifact.accepted)` heals on retry
  (the artifact is re-gated and a second verdict is appended), but the two records can
  disagree transiently. Consequence for P2: decide whether events or the row are the
  recovery authority; if events, add the missing transitions. Evidence: source read and the
  kill probes.

- **F9 [advisory] actor is an unauthenticated string** — `src/runner/engine.ts:224`,
  `src/cli.ts`. `--actor`/`PRAXIS_ACTOR` is pinned as the instance actor but is caller-supplied;
  it is not a trusted identity (AGENTS.md, gate #3). Consequence: the stored `actor` must not
  be read as authentication. Cure: the Pi/Manifold binding in the P1/P6 units.

- **F10 [advisory] CLI creation-only mode is not in the spec's process interface** —
  `src/cli.ts:9-12,86-104` vs spec "Process interface". `run` without `--artifact` only creates
  (the nonce goes to stderr); the spec lists no creation-only mode and no `--artifact` flag.
  Consequence: the proof uses three processes (create, A, B), not the spec's two-command
  interface; the handoff claim is unaffected but the interface text is not the code's.
  Cure: amend the spec/plan to the create/execute split or fold creation into `run`.

- **F11 [advisory] task graph is stale** — Manifold `org.tasks`: `7d80021d` (fix the canonical
  hole guard) and `9522c4d8` (remove tests from `src/runner`) are `ready` although the guard
  and the move are already in the tree; the replacement review task `40cd1453` is `ready` and
  unassigned while this review was requested through the room. Cure: lead closes/cancels the
  superseded tasks and assigns the review task, or records why they stay open.

## F1 history and its closure

F1 is the canonical hole guard, opened by lead from P1 and recorded in the header of
`tests/runner/canonical.test.ts` (source-inspected; no earlier `review.md` exists, so the
rework verdict survives only as that comment).

- **Opening** — a decorated sparse array `[1,,3]` with one extra own property has
  `Object.keys(...).length === length`, so a key-count-only guard passes it; `map()`/`join()`
  then skip the hole and the text becomes `[1,,3]`. A plain `[1,,3]` is refused by the key
  count, so it cannot exercise the hole guard.
- **Rework** — reviewer-1's rework verdict was that the first regression test asserted only a
  plain sparse array; under the weak guard it was not red, so it was not evidence. The fix
  needed a fixture that the key-count guard accepts and the hole guard must refuse.
- **Closure** — `tests/runner/canonical.test.ts:50-64` asserts the decorated case is refused
  with a message matching `/hole/`, and `tests/runner/canonical.test.ts:36-48` keeps the plain
  and nested cases. `src/runner/canonical.ts:28-57` now checks the key count, hidden and
  symbol members, and every index descriptor. Executed: decorated → `CANONICAL_INVALID
  "hole at $[1]"`; nested → `"hole at $.a[1]"`; dense control → `[1,2,3]`; suite 29/29.
  The guard is closed by an executed red-test path, not by a re-reading. `7d80021d` is still
  `ready` (F11); the code and test already contain the fix.

## Layering observation for the P1 decision (non-blocking)

`src/store/events.ts` and `src/store/artifacts.ts` import the canonicaliser from
`src/runner/canonical.ts`. The store is the lower layer and claim A; the runner is claim B.
The dependency means the store cannot be built or tested without the runner module, and a
runner-side change silently changes store bytes. The slice is correct today; for P1, move
`canonical.ts` to `src/types/` or a neutral shared module so both owners import downward.
Recorded as F7, explicitly non-blocking for Slice 0.

## G5 implementation — attempt 1 — PASS — 2026-10-29T11:42:09Z

subject: the 26 files whose sha256 are listed above (spec, plan, research, STATUS, config,
all `src/`, all `tests/`, package.json, tsconfig.json, .gitignore)

reviewer: reviewer-1 (separate session, not an author)  independence: independent

verdict basis: R1–R13 each marked above with executed evidence; every plan check P1–P8 was
executed from the new paths and is recorded in the table above; the 29-test suite passes;
`tsc --noEmit` exits 0; the canonical hole case is red-tested and refused;
the two-process P3 and SIGKILL P8 checks pass, plus two independent mid-step kill probes; the
bounded result and all four negative paths were exercised by me. Minimality: no unplanned
declarations beyond the plan's table (engine/cli/result/capabilities are all declared); the
store's canonical import is the one layering exception (F7). Findings F1–F11 are advisory;
none contradicts an executed check.

Verdict limits, stated plainly:

- I did not run the owner's second-terminal G6 run; I ran the CLI in throwaway stores.
- Power-loss durability of WAL + `synchronous=FULL` is untested (the spec says the same); only
  process death was exercised.
- Concurrent resumes (two writers at once) were not exercised; the CAS and `BEGIN IMMEDIATE`
  paths are source-inspected only.
- A kill between `acceptArtifact` and `appendEvent` was not hit deliberately; the retry path
  is reasoned from source and the two kill probes (F8).
- `node --experimental-strip-types` emits an experimental warning on Node v24.9.0; the slice
  depends on it and the spec lists it as untested.
- R4's duplicate-key clause and R7's arbitrary-step-code reading remain **unproven**, and
  R12's manifest half is deferred; they are carried to G6, not silently accepted.
- The plan's literal P1–P6 commands are stale (F2); the same checks were executed from
  `tests/`. If the owner treats the plan text as the acceptance oracle, F2 must be resolved
  by amendment before G6.
- The Manifold assignment `0f7c55d6` referenced by the control note is `failed` (claim
  released, `nextAction: none`); this verdict was produced under the lead's room request and
  claim D, not reported against an active assignment.
