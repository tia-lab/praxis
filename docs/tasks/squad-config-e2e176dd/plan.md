# Plan — squad-config

Task: squad-config · Hash: e2e176dd · Gate: G3 · Status: approved · Date: 2026-10-29

Basis: `spec.md` in this folder, R1–R11.

## Affected declarations

| Path | Declaration | Before | Effect | Requirement | Callers |
| --- | --- | --- | --- | --- | --- |
| `.pi/manifold/config.json` | whole project manifest | absent | create | R1–R10 | Manifold loader, activation |
| `docs/squad-config-e2e176dd/*.md` | task documents | absent | create | evidence | none |
| `AGENTS.md` | authorization ledger | one unit | extend by one line | traceability | agents |

## Budget

| Path | After LOC | Split needed |
| --- | --- | --- |
| `.pi/manifold/config.json` | ~64 | no |
| `spec.md` / `plan.md` / `research.md` / `review.md` | < 120 each | no |

## Steps

1. Write `.pi/manifold/config.json` with the five identities, `research` template,
   caps, permissions and launch profile — done when the file parses as JSON.
2. Assert shape statically against the source-read schema — done when every check
   in the table reports `ok`.
3. Record digests and the self-review verdict — done when `review.md` names every
   subject digest.

## Checks

| # | Command | Scope | Expects |
| --- | --- | --- | --- |
| 1 | `node -e 'JSON.parse(...)'` | narrow | parses |
| 2 | `node -e` key and range assertions (15 checks) | narrow | all `ok` |
| 3 | `grep -niE 'token\|secret\|password\|api[-_]?key'` | narrow | no match |
| 4 | `wc -l` on every written file | narrow | ≤ 600 each |
| 5 | `sha256sum` of every subject | review | one digest each |

Check 2 is a static assertion of the source-read schema, **not** Manifold's own
validator: running that would execute the borrowed repository, which `AGENTS.md`
forbids. Real validation happens at activation (`whoami`, `org.teams.config`).

## Recovery

Nothing is activated and no state exists, so recovery is deleting the file. A
mid-write partial file is detected by check 1 and replaced, never patched.

## Out of scope

Activation, broker environment, session launch, team compose, the research
programme, and any change to `package.json` or `src/`.
