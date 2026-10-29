# Plan — squad-config

Task: squad-config · Hash: c38e8551 · Gate: G3 · Status: approved · Date: 2026-10-29

Basis: `spec.md` in this folder, R1–R12.

## Affected declarations

| Path | Declaration | Before | Effect | Requirement | Callers |
| --- | --- | --- | --- | --- | --- |
| `.pi/manifold/config.json` | inline project | inline file from the superseded unit | replace with pointer | R1–R2 | loader, activation |
| `.pi/manifold/profiles/research.json` | clone profile | absent | create | R3–R10 | loader |
| `docs/squad-config-c38e8551/*.md` | task documents | absent | create | evidence | none |
| `AGENTS.md` | ledger | two units | one bullet + supersede note | traceability | agents |

## Budget

| Path | After LOC | Split needed |
| --- | --- | --- |
| `.pi/manifold/config.json` | 14 | no |
| `.pi/manifold/profiles/research.json` | ~80 | no |
| task documents | < 120 each | no |

## Steps

1. Write the pointer (`config.json`) and the clone profile
   (`profiles/research.json`) — done when both parse as JSON.
2. Assert pointer/profile split, squad shape and launch constraints — done when every
   check reports `ok`.
3. Record digests and the verdict — done when `review.md` names every subject digest.

## Checks

| # | Command | Scope | Expects |
| --- | --- | --- | --- |
| 1 | `node -e` JSON parse of both files | narrow | parses |
| 2 | `node -e` 20 assertions (split, slots, caps, hub, room, launch, secrets) | narrow | all `ok` |
| 3 | `command -v pi` | narrow | executable resolves |
| 4 | `wc -l` on written files | narrow | ≤ 600 each |
| 5 | `sha256sum` of every subject | review | one digest each |

Check 2 asserts the source-read schema statically; it is **not** Manifold's loader.
Running that would execute the borrowed repository, which `AGENTS.md` forbids.

## Recovery

No activation and no state: recovery is deleting the profile or restoring the previous
inline file by reverting the commit. A partial file is caught by check 1 and replaced.

## Out of scope

Activation, broker environment, session launch, compose, the research programme, and
any change to `package.json` or `src/`.
