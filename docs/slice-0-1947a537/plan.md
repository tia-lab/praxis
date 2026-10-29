# Plan — Slice 0

Task: slice-0 · Hash: 1947a537 · Gate: G3 · Status: approved · Date: 2026-10-29

Basis: `spec.md` R1–R13 in this folder. Owner approved the spec with "done proceed".

## Ownership split (write claims)

Exactly one writer per path. A needed change outside your claim is a blocker for lead,
never an edit.

| Claim | Owner | Paths |
| --- | --- | --- |
| A | engineer-1 | `src/types/`, `src/store/` (tests co-located: `src/store/*.test.ts`) |
| B | engineer-2 | `src/runner/`, `src/cli.ts` (tests co-located: `src/runner/*.test.ts`) |
| C | lead | `docs/slice-0-1947a537/`, `.pi/praxis/config.json` |
| D | reviewer-1 | `docs/slice-0-1947a537/review.md` |

## Declarations

| Path | Declaration | Requirement |
| --- | --- | --- |
| `src/types/errors.ts` | `Code` union, `AppError {code,message,detail?}`, `fail(code, msg, detail?)` | R13 |
| `src/types/schema.ts` | Zod: `FlowConfig`, `StepConfig`, `Instance`, `Artifact`, `Result`, `StepId` | R1, R3, R11 |
| `src/store/db.ts` | `openStore(path)` → WAL, `synchronous=FULL`, creates `instance`/`event`/`artifact`/`meta` | R3, R6 |
| `src/store/instance.ts` | `createInstance`, `loadInstance`, `setStatus` with revision compare-and-set | R2, R6 |
| `src/store/events.ts` | `appendEvent` (no update, no delete), `listEvents` | R3 |
| `src/store/artifacts.ts` | `recordArtifact`, `readArtifact` (returns bytes + verifies digest), `acceptArtifact` | R4, R5, R10 |
| `src/runner/canonical.ts` | `canonicalBytes(value)`, `digest(bytes)` (`sha256:`+hex) | R4, P1 |
| `src/runner/capabilities.ts` | closed registry `artifact.read|artifact.write|emit`; `grantFor(step)`; `call(step, name, fn)` throws `CAPABILITY_DENIED` | R7, R9, P11 |
| `src/runner/engine.ts` | `start(flow, reqId)`, `advance(instance)`; gate `schema-valid-and-nonce`; writes verdict events | R5, R8 |
| `src/runner/result.ts` | `buildResult(instance)` whitelists six fields | R11 |
| `src/cli.ts` | `run <flow> --request --artifact --now`, `resume <instance> --artifact --now`, `status <instance>`, `artifact read <instance> <step>` | R6, R7 |

Tests are co-located with their owner because the team allows two path claims per
assignment: `src/store/*.test.ts` for A, `src/runner/*.test.ts` for B.
| `.pi/praxis/config.json` | the flow: two steps, capabilities, templates, gate | R1 |

## Store schema (exact)

```
meta(key TEXT PRIMARY KEY, value TEXT)
instance(id TEXT PRIMARY KEY, flow TEXT, actor TEXT, config_digest TEXT,
         status TEXT, current_step TEXT, revision INTEGER, nonce TEXT,
         created_at TEXT, updated_at TEXT)
event(instance TEXT, seq INTEGER, type TEXT, payload TEXT, at TEXT,
      PRIMARY KEY(instance, seq))
artifact(instance TEXT, step TEXT, version INTEGER, path TEXT, digest TEXT,
         schema TEXT, state TEXT, derived_from TEXT, at TEXT,
         PRIMARY KEY(instance, step, version))
```

No `UPDATE` or `DELETE` against `event` anywhere in the code. `instance` is the only
mutable row, guarded by `revision`.

## Steps

1. **Types and store** (claim A) — errors, zod schemas, sqlite schema, instance/event/artifact
   accessors. Done when `tests/store.test.ts` passes and `sqlite3 ... ".schema"` shows the four tables.
2. **Canonical and digest** (claim A) — sorted keys, UTF-8, no BOM, sha256. Done when two key
   orders yield one digest.
3. **Capabilities, engine, result** (claim B) — closed registry, gate, verdict events, bounded
   result. Done when a two-step flow completes in-process.
4. **CLI and the two-process handoff** (claim B) — `run`, `resume`, `status`. Done when A is a
   separate PID from B and B reads only the artifact.
5. **Negative controls** (claim B) — no-access and corrupt-digest instances. Done when both
   fail with their typed codes and write nothing.
6. **Review** (claim D) — the reviewer runs every check and writes `review.md`.

## Checks

| # | Command | Expects |
| --- | --- | --- |
| P1 | `node --test src/store/canonical.test.ts` | one digest for two key orders |
| P2 | `node --test src/store/store.test.ts` | four tables; event table rejects UPDATE |
| P3 | `node --test src/runner/handoff.test.ts` | distinct PIDs; B trace only artifact.read/write |
| P4 | `node --test src/runner/negative.test.ts` | `ARTIFACT_UNAVAILABLE` and `ARTIFACT_DIGEST_MISMATCH`, zero writes |
| P5 | `node --test src/runner/result.test.ts` | exactly six fields, no events |
| P6 | `grep -rn "from '" src \| grep -v "node:" \| grep -v "zod"` | empty |
| P7 | `npx tsc --noEmit` | clean |
| P8 | kill between phases, then `resume` | same step, same digest, no duplicate artifact row |

Every check is executed and its real output pasted into the report. A check that did
not run is reported as not run.

## Recovery

Delete `.pi/praxis/state/` and rerun. No migration, no retention, no repair path: the store
is disposable by design in this slice.

## Out of scope

Pi integration, adapters, external effects, models, owner-acceptance gate, flow expansion,
nesting, multi-actor, rendering, migration, retention, `validating` state.
