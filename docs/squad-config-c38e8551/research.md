# Research — squad-config

Task: squad-config · Hash: c38e8551 · Gate: G1 · Status: reviewed · Date: 2026-10-29

## 0. Contract

task: Define the Praxis research squad as a Manifold clone profile behind a pointer config, for later owner activation
scope: .pi/manifold/config.json, .pi/manifold/profiles/research.json
acceptance: config.json is a reference/catalog pointer whose active clone profile declares the research squad; one 5-member team of lead, main-researcher and three researchers; hub topology converging on main-researcher; room required; only main-researcher may write the report; activation remains a separate owner action

```sh
canonical() { printf 'task: %s\nscope: %s\nacceptance: %s\n' "$1" "$2" "$3" \
  | sed -E 's/[[:space:]]+$//'; }
canonical "<task>" "<scope>" "<acceptance>" | sha256sum | cut -c1-8   # c38e8551
```

## 1. Question and boundary

Which file layout declares the squad so the main config stays small, the profile can
be swapped, and later activation succeeds without inventing fields?

Not researched: activation itself, NATS operation, Herdr tab mechanics, the research
programme.

## 2. Sources inspected

| Source | Location | Establishes |
| --- | --- | --- |
| `src/loader/index.ts` | 174–236 | `ProjectFileSchema = union(InlineProject, Pointer)`; `PointerSchema` fields; `ProfileEntrySchema` = clone \| git-use \| url-use |
| `src/types/profile.ts` | 1–60 | `ProfileSchema` carries no `projectId` and no `limits` |
| `src/loader/selected.ts` | 1–99 | clone profiles are read from `.pi/manifold/profiles/<name>.json`; a selected clone must have no lock entry |
| `.pi/manifold/config.json` (manifold repo) | all | the author's own pointer: `format`, `projectId`, `active`, `limits`, `profiles.{mode:clone}` |
| `.pi/manifold/profiles/pm-managed.json` | all | a real clone profile: `format`, `humanFacingRole`, `roles`, `teamIds`, `agents`, `connection`, `teams` |
| `src/types/org.ts` | 1–160 | slots, topology, bounds, room, caps, permissions, launch constraints |
| `src/types/limits.ts`, `src/types/policy.ts` | all | project ceilings; ids, agent, connection shapes |
| `README.md` | 69–101 | inline vs reference/catalog; single config entry; strict validation |

## 3. Competing explanations

| Candidate | Verdict |
| --- | --- |
| inline single file | rejected: bloats the entry file and cannot hold a second profile |
| pointer + one clone profile | **chosen**: the author's own layout, and the only form that switches by `active` |
| pointer + `use` (git/url) profile | rejected: needs a lock entry and a cache; no sharing need |
| `allow_multi_profile` composition | rejected: nothing to merge (`MIN-006`) |

## 4. Findings

- F1 [source-inspected] The two forms are a strict union; inline rejects `active` and
  `profiles`, pointer rejects inline profile fields.
- F2 [source-inspected] `ProfileSchema` has no `projectId` and no `limits`: identity
  and attempt ceilings stay in the pointer, so one authority owns those numbers.
- F3 [source-inspected] A selected clone profile must have **no** lock entry; a
  missing clone file fails `STORAGE_UNAVAILABLE`.
- F4 [source-inspected] Switching = changing `active`; it takes effect at a rebind
  boundary, never hot-swapped under live attempts.
- F5 [source-inspected] The author's profile keeps `connection` per profile, uses
  `taskKinds[*].plannerHint` for per-kind conduct, and omits `deadlines`.
- F6 [source-inspected] The author's templates carry the lead as a **slot member**
  (`eng` slots: lead 1 + architect 1 + engineer 2 + reviewer 1); the human-facing lead
  is a member but is not launched because it is already bound.
- F7 [inference] Following F6, the lead becomes a `research` slot member rather than a
  second team id; `teamIds` stays `["research"]`.
- F8 [source-inspected] `bounds.maxConcurrentAssignments` below member count is the
  author's throttle (5 members, 3 concurrent); adopted as 3.
- F9 [inference] `convergerRole` is schema-optional under `hub`; naming
  `main-researcher` makes aggregation explicit.
- F10 [source-inspected] `.pi/manifold/profiles/<name>/SKILL.md` exists in the author's
  setup, but no loader code reads it: it is local documentation, not a loaded skill,
  and grants nothing.
- F11 [untested] `MANIFOLD_NATS_SERVERS` presence is unverified; activation fails
  closed without it.

## 5. Affected owners and callers

| Path | Declaration | Callers | Effect |
| --- | --- | --- | --- |
| `.pi/manifold/config.json` | pointer | loader, activation | rewritten as pointer |
| `.pi/manifold/profiles/research.json` | clone profile | loader | created |

## 6. Uncertainty and open questions

- Q1 Does the loader accept `lead` as a slot member whose session is already bound?
  Resolved by a live `org.teams` read after activation.
- Q2 Is `maxActiveAttempts: 6` right for five identities? Resolved by `whoami`.
- Q3 Schema drift: Manifold pinned at v0.1.0.

## 7. Handoff

Declarative and reversible: deleting `profiles/research.json` leaves the pointer
failing closed; deleting both restores the pre-unit state.
