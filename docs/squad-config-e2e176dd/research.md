# Research — squad-config

Task: squad-config · Hash: e2e176dd · Gate: G1 · Status: reviewed · Date: 2026-10-29

superseded-by: `docs/squad-config-c38e8551/` — the contract moved from inline to
pointer form on owner correction. Verdicts below remain valid for the inline shape only.

## 0. Contract

task: Define the Praxis research squad configuration in .pi/manifold/config.json for later owner activation
scope: .pi/manifold/config.json
acceptance: config.json satisfies the Manifold inline project schema; squad is 1 lead outside the team plus 1 main-researcher and 3 researchers launched; hub topology with main-researcher converging; room required; only main-researcher may write the report; activation remains a separate owner action

```sh
canonical() { printf 'task: %s\nscope: %s\nacceptance: %s\n' "$1" "$2" "$3" \
  | sed -E 's/[[:space:]]+$//'; }
canonical "<task>" "<scope>" "<acceptance>" | sha256sum | cut -c1-8   # e2e176dd
```

## 1. Question and boundary

Which exact configuration declares the approved research squad so that a later owner
activation succeeds without inventing fields?

Not researched: NATS broker operation, Herdr pane mechanics, model quality, the
research programme itself, and activation.

## 2. Sources inspected

| Source | Location | Establishes |
| --- | --- | --- |
| `src/types/profile.ts` | 1–60 | `InlineProjectSchema` = `ProfileSchema` + `projectId` + `limits`; portable launch `cwd` is relative |
| `src/types/org.ts` | 1–160 | slots, topology, bounds, room policy, caps, permissions, launch constraints, deadlines |
| `src/types/limits.ts` | all | project-level attempts ceiling; reserve is the lead lockout guard |
| `src/types/policy.ts` | all | `Id`, `EnvName`, `Agent`, `Connection`, `Manifest` shapes |
| `examples/config.teams.example.json` | all | a working inline declaration; no `version` under `teams` |
| `README.md` | 69–101 | inline vs catalog forms; single config entry; strict validation |
| `skills/manifold-organizer/SKILL.md` | all | reuse, ownership, room, launch and lifecycle conduct |
| `skills/manifold/SKILL.md` | all | ops, `team.compose`, `whoami`; activation is `INACTIVE` |

## 3. Competing explanations

| Candidate | Rejected because |
| --- | --- |
| catalog form (`profiles/NAME.json` + `active`) | needed only for switchable multi-profile setups; one squad now (`MIN-006`) |
| profile composition (`allow_multi_profile`) | opt-in multi-profile merge; nothing to merge yet |
| `mesh` topology | needs rounds plus a converger; `hub` already gives one aggregator |
| `sequential` | imposes a pipeline on four parallel investigations |
| 5 launched seats with the lead inside | this session already is the lead; 4 launched seats fill exactly one 2×2 tab |

## 4. Findings

- F1 [source-inspected] Inline config is `ProfileSchema.shape` + `projectId` + `limits`,
  and carries `format: 1`, not `version`.
- F2 [source-inspected] `teams` inside a profile is strict and accepts only
  `templates`, `taskKinds`, `caps`, `permissions`, `launchProfiles`, `deadlines`.
  A `version` key there fails closed.
- F3 [source-inspected] Profile launch `cwd` is relative (default `.`); absolute
  cwd belongs to the non-portable launch schema.
- F4 [source-inspected] `executable` must end in `pi`; model and arguments must
  carry no credentials or environment assignments; `timeoutMs` ∈ [3000, 300000].
- F5 [source-inspected] Routing is role-declared. Under `hub`, restricting
  `researcher` to `main-researcher` makes routing and topology guards agree.
- F6 [source-inspected] Room policy is a template field (`required`), not a
  compose mutation; a required room exists when the team is composed.
- F7 [source-inspected] Permissions are per role; `{}` means every default false,
  so researchers cannot assign, dispatch, compose, scale or retire.
- F8 [source-inspected] `caps.maxMembersPerTeam` must admit the slot total; bounds
  `maxMembers` must equal the intended 4.
- F9 [inference] `convergerRole` is optional in schema; naming `main-researcher`
  makes hub aggregation explicit instead of implied.
- F10 [inference] Declaring `lead` under its own team id keeps it out of slot
  membership while `scope: "project"` routing still reaches the team.
- F11 [untested] `MANIFOLD_NATS_SERVERS` presence is unverified; activation fails
  closed without it.

## 5. Affected owners and callers

| Path | Declaration | Callers | Effect |
| --- | --- | --- | --- |
| `.pi/manifold/config.json` | project manifest + team blueprint | Manifold loader, activation | created |

## 6. Uncertainty and open questions

- Q1 Does `hub` need `convergerRole` semantically? Schema optional; resolved by a
  live `org.teams.config` read after activation.
- Q2 Is `maxActiveAttempts: 6` right for five identities? Resolved by `whoami`
  capacity after activation.
- Q3 Schema drift: Manifold is pinned at v0.1.0, so these fields are fixed for now.

## 7. Handoff

The configuration is declarative and reversible; activation is the only step that
creates durable state.
