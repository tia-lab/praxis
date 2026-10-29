# Spec — squad-config

Task: squad-config · Hash: c38e8551 · Gate: G2 · Status: accepted · Date: 2026-10-29

## Outcome

`.pi/manifold/config.json` is a pointer to one clone profile
(`.pi/manifold/profiles/research.json`) declaring project `praxis`: five identities in
one `research` team — lead (unlaunched), main-researcher, three researchers — hub
topology, required room, one launch profile. Nothing is activated.

## Requirements

| Id | Requirement | Failure behaviour | Oracle |
| --- | --- | --- | --- |
| R1 | Pointer form: `format`, `projectId`, `active`, `limits`, one clone entry | loader rejects or finds no active policy | key assertions |
| R2 | Pointer holds no profile content (`teams`, `agents`, `connection` absent) | two authorities for the same fact | absence assertions |
| R3 | Profile holds no `projectId` and no `limits` | schema rejects the file | absence assertions |
| R4 | Five agents, one team `research` | compose cannot seat the squad | agent assertions |
| R5 | Slots: lead 1, main-researcher 1, researcher 3 | wrong seat count or extra pane | slot sum = 5 |
| R6 | `hub` converging on `main-researcher` | diffuse reports, no accountable aggregator | topology fields |
| R7 | Room `required` for the team | challenge has no surface | template `room` |
| R8 | Only `lead` assigns/dispatches/composes/scales/retires | peers self-assign | permissions |
| R9 | One launch profile: pi, deepseek-flash, `--thinking high`, relative cwd | wrong model or root | launch assertions |
| R10 | `research` task kind carries a `plannerHint` | researchers invent their own standard | hint present |
| R11 | No credential or environment assignment in either file | secret in a tracked file | pattern scan |
| R12 | No activation, no session, no state created | unaudited state before owner decision | `whoami` still INACTIVE |

## Model

| Element | Owner | Valid states | Invariants | Requirement | Failure if absent |
| --- | --- | --- | --- | --- | --- |
| pointer (`config.json`) | owner | one active id, or null | ceilings live only here | R1–R2 | nothing selects a policy |
| clone profile | owner | present, validated | no projectId, no limits, no lock entry | R3 | activation fails closed |
| agents (5) | owner | declared → bound | ids unique; one team | R4 | no identity to launch |
| template `research` | owner | one | slots sum to 5; bounds admit 5 | R5–R7 | squad cannot form |
| permissions | owner | per role | only `lead` assigns | R8 | unowned work |
| launch profile | owner | one | no secrets; relative cwd | R9 | seats cannot start |

## Exclusions

- No second profile, no composition, no `use`/lock/cache, no `issue` block.
- No activation, sessions, NATS configuration or repository state.
- No `SKILL.md` beside the profile: nothing loads it (F10).
- No research content — that is the next unit.

## Alternatives

| Alternative | Rejected because |
| --- | --- |
| inline config | one file cannot hold a second profile and mixes identity with content |
| `use` profile from git/url | adds lock plus cache for no sharing need |
| lead in its own team id | diverges from the author's member-slot pattern and breaks same-team routing |
| room `optional` | the challenge surface is why there are four seats |

## Open questions

Activation prerequisites (broker env, project trust) are owner-side and verified at
activation, not asserted here.
