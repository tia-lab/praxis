# Spec — Slice 0

Task: slice-0 · Hash: 1947a537 · Gate: G2 · Status: draft · Date: 2026-10-29

## Outcome

A headless runtime that runs one two-phase flow over a durable store and proves by executed
checks that: a step can only use its own declared capabilities; phase B receives phase A's
accepted artifact and nothing else; a process death between phases loses or duplicates
nothing; the caller receives a bounded result with no transcript. Nothing runs inside Pi yet.

## Requirements

| Id | Requirement | Failure behaviour | Oracle |
| --- | --- | --- | --- |
| R1 | The flow is data: one JSON config declares two steps with capabilities, template and gate. | unknown step, unknown capability or bad ref → typed refusal, zero state written | valid + invalid fixtures |
| R2 | Creating an instance pins the config digest and the actor; a repeated request id with a different payload is rejected. | silently creating a second instance or replaying a changed payload as success | two create calls, compare |
| R3 | Events are append-only; the instance row is derived current state. | any edit or deletion of history | schema and code review |
| R4 | Phase A writes artifact v1 as canonical JSON with a sha256 digest. | non-canonical bytes, unstable digest across key order | two key orders → identical digest |
| R5 | The gate is a deterministic predicate (`schema-valid` + nonce present), recorded as a verdict event. | accepting an artifact that fails the predicate | negative artifact run |
| R6 | Process death after A; resume loads instance and accepted artifact from the store only. | resume guessing a step, losing the artifact or duplicating a write | `kill -9` between phases, then resume |
| R7 | Phase B receives only `{artifactRef, digest, path, schema}` and may call `artifact.read`. | B reaching any other capability or any repository file | denial check + B's call trace |
| R8 | B's artifact must carry `derivedFrom` = A's digest and the instance nonce. | accepting a B artifact that did not consume A | negative run |
| R9 | With artifact access removed, B fails closed and writes nothing. | the boundary leaking through another channel | control instance |
| R10 | A corrupted digest fails closed before any dispatch. | acting on bytes that do not match the recorded digest | control instance |
| R11 | The result carries `instanceId, flow, status, artifacts[], summary, nextAction` and nothing else. | transcript, event log or tool arguments in the result | result assertion |
| R12 | No third-party dependency: `node:sqlite`, `node:crypto`, `node:test` only. | the slice borrowing the inherited manifest | import scan |

## Model — the minimum

Store `.pi/praxis/state/praxis.sqlite` (WAL, `synchronous=FULL`):

```
instance(id, flow, actor, config_digest, status, current_step, revision, nonce, created_at, updated_at)
event(instance, seq, type, payload_json, at)              -- append-only, pk(instance, seq)
artifact(instance, step, version, path, digest, schema, state, derived_from, at)
```

States: `running`, `blocked`, `completed`, `failed`. `validating` is declared in the model but
not implemented in this slice; acceptance is the deterministic gate (research §6.3 option c).

## Capabilities — a closed registry per step

`artifact.write`, `artifact.read`, `emit`. An unknown name is a config error at load; a known
name not granted to the current step is denied with a typed reason and zero effects. The step
API exposes no shell, no arbitrary filesystem and no network.

**Limit, stated plainly:** the process still has OS access. This is a broker boundary, not
isolation. Gate #1 stays open and no check here may claim otherwise.

## Canonical artifact

Parsed JSON values only; no cycles, `undefined`, `NaN`, `Infinity` or duplicate keys. Arrays
keep order; object keys sort by UTF-16 code unit; UTF-8 without BOM; no insignificant
whitespace; digest = `sha256:` + hex over those bytes. A version never overwrites an accepted
version.

## Process interface

```
node --experimental-strip-types src/cli.ts run <flow> --request <id> [--now <iso>]
node --experimental-strip-types src/cli.ts resume <instance> [--now <iso>]
node --experimental-strip-types src/cli.ts status <instance>
```

Two invocations are two processes with no shared memory: that is what makes the handoff claim
mean something.

## Checks

P1 digest stability across key order · P2 accepted verdict precedes B · P3 distinct PIDs, no
shared handle · P4 B's trace contains only `artifact.read`/`artifact.write` · P5 nonce and
decision reproduced from the artifact · P6 `derivedFrom` recorded · P7 no-access control fails
`ARTIFACT_UNAVAILABLE` · P8 corrupt-digest control fails `ARTIFACT_DIGEST_MISMATCH` · P9
restart preserves step, digest and attempt with no duplicate write · P10 conflicting request
payload rejected · P11 denied capability yields a typed denial and zero effects · P12 result
contains only the whitelisted fields.

## Exclusions

No Pi integration · no adapters or Fabric · no external effects · no model or LLM in the loop ·
no owner-acceptance gate · no flow expansion · no nesting · no multi-actor · no Zod · no
Markdown rendering · no migration or retention policy.

## Open questions

1. **Dependency posture** — zero-dep is proposed; the contracts unit may introduce Zod later
   and must not be smuggled in here.
2. **Ignore rule** — `.pi/praxis/` must narrow to `.pi/praxis/state/` so the flow config can be
   tracked while the store stays out of Git.
3. **TypeScript execution** — `--experimental-strip-types` on Node 24.9 is untested; if it
   fails, a build step would be new scope and needs its own decision.
