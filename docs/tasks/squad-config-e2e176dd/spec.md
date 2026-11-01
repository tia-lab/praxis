# Spec — squad-config

Task: squad-config · Hash: e2e176dd · Gate: G2 · Status: accepted · Date: 2026-10-29

## Outcome

`.pi/manifold/config.json` declares one project (`praxis`) with five identities and
one `research` team template: 1 lead outside the team, 1 main-researcher, 3
researchers, `hub` topology, required room, one launch profile. Configuring does
not activate anything.

## Requirements

| Id | Requirement | Failure behaviour | Oracle |
| --- | --- | --- | --- |
| R1 | Parses as an inline project: `format: 1`, `projectId`, `limits` | loader rejects the file, activation fails closed | static key assertions |
| R2 | Exactly five agents: `lead`, `main-researcher`, `researcher-1..3` | compose cannot seat the squad | assertion on `agents` |
| R3 | Team `research` slots = 1 main-researcher + 3 researchers | wrong seat count or an extra pane | slot sum = 4 |
| R4 | `hub` topology converging on `main-researcher` | diffuse reports, no accountable aggregator | `topology` fields |
| R5 | Room policy `required`; room holds the 4 team members | challenge has no surface | template `room` |
| R6 | `lead` holds assign, dispatch, compose `research`, scale own, retire own | nobody can staff or close the team | `permissions.lead` |
| R7 | `researcher` and `main-researcher` hold no assignment authority | peers can self-assign | `permissions.*` defaults |
| R8 | One launch profile: `pi`, `deepseek/deepseek-flash`, `--thinking high`, relative cwd, timeout 240000 | wrong model, wrong root, or hangs | launch-profile assertions |
| R9 | Caps bound: 1 team, 4 members, 4 concurrent assignments, 2 claims | unbounded fan-out | `caps` |
| R10 | No credential, token or environment assignment inside the file | secret leakage into a tracked file | pattern scan |
| R11 | This unit performs no activation and creates no session | unaudited state before owner decision | `whoami` still `INACTIVE` |

## Model

| Element | Owner | Valid states | Invariants | Requirement | Failure if absent |
| --- | --- | --- | --- | --- | --- |
| project `praxis` | owner | one manifest file | single config entry, no fallback | R1 | loader has nothing to read |
| agents (5) | owner | declared, then bound at activation | ids unique, role and team declared | R2 | no identity to launch or assign |
| template `research` | owner | one template | slots sum to 4; bounds admit 4 | R3–R5 | compose cannot form the squad |
| permissions | owner | per role | only `lead` assigns; others default false | R6–R7 | work cannot be dispatched or closes unowned |
| launch profile | owner | one profile | no secrets; relative cwd; timeout in range | R8 | seats cannot start |
| caps | owner | one set | caps ≥ template needs | R9 | compose fails with `LIMIT` |

## Exclusions

- No catalog, no `allow_multi_profile`, no second template or team.
- No `issue` block.
- No activation, no sessions, no NATS configuration, no repository state.
- No research programme content — that is the next unit.

## Alternatives

| Alternative | Rejected because |
| --- | --- |
| catalog form with `profiles/research.json` | adds indirection with one profile and no switching need |
| `mesh` with a converger and round cap | more failure paths for the same aggregation |
| lead inside the team as a 5th slot | second tab, and a lead that reports to itself |
| room `optional` | the challenge surface is the point of four seats |

## Open questions

Activation prerequisites (broker env, trust) are owner-side and unresolved by
configuration; they are verified at activation, not asserted here.
