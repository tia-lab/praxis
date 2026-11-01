# Manifold — an evidence map of the system as it is TODAY

> **What this document is.** A **current-state map** of Manifold, read entirely from the source at
> `/home/tia/_DEV/AI/manifold` in read-only mode. It describes **what IS** — not what should be, not a
> proposal, not a plan. For the *proposal* to unify this layer with Praxis, see
> [COMMUNICATION.md](COMMUNICATION.md); this file deliberately contains no "should".
>
> **Read-only guarantee.** Nothing in the Manifold repository was run, launched, mutated or migrated for
> this map; its database, NATS server and services were untouched. Every claim below is a citation to a
> line that was read.
>
> **Legend.** `[C]` = **confirmed** by reading the cited code. `[I]` = **inferred** from the cited code
> plus reasoning where no single line states the fact. Every `[C]` claim carries `path:line`.

| | |
| --- | --- |
| Source studied | `/home/tia/_DEV/AI/manifold/src` — 76 TypeScript files, 14,780 lines |
| Schema version | `SCHEMA_VERSION = 6` — `src/storage/schema.ts:1` |
| Tables | **31** (28 in `storage/schema.ts`, plus `policy_rebinds`, `releases`, `coordinator_releases`) |
| Tool surface | one Pi tool named `manifold` — `src/extension.ts:78` |
| Transport | NATS, subject `manifold.v1.<projectId>.<agentId>.inbox` — `src/transport.ts:91` |

---

## 1. Module map

```text
src/
├── extension.ts         the Pi tool + flags + hooks; one dispatch door into the Store       [C]
├── coordination.ts      cross-agent coordination helpers
├── policy.ts            project root, safe paths, digest, role/route policy (canSend)
├── herdr.ts             launches agents into panes; injects the identity flags              [C]
├── launch-pump.ts       the in-process launch tick (setInterval)                            [C]
├── inspector.ts / doctor.ts / init.ts / process.ts / sessions.ts / panes.ts / issues.ts
├── teams.ts             team ops on the Store facade
├── teams-blueprint.ts   the blueprint: topology, caps, validation                          [C]
├── tui/                 the operator console
├── loader/              profile loading (git/url source, sha256 lock + cache)              [C]
├── types/               the contracts: org.ts (identity+limits), protocol.ts (requests),
│                        storage.ts (Binding), gate.ts, profile.ts, limits.ts               [C]
└── storage/
    ├── database.ts      open + migrate + rebind; WAL required; metadata pins project+root    [C]
    ├── schema.ts        SCHEMA_VERSION 6 and 28 of the 31 tables, with every trigger         [C]
    ├── store.ts         the Store facade: gate runner, dispatch, prune, watchdog exposure    [C]
    ├── gate.ts          the gate runner (stages, external verdicts, STALE_POLICY)            [C]
    ├── classify.ts      the R0-R6 change classifier behind every rebind                      [C]
    ├── transport.ts     NATS: connect, creds auth, subscribe/publish on the inbox subject    [C]
    ├── rooms.ts         team rooms: message, per-member deliveries, revision, ack            [C]
    ├── expectations.ts  per-owner awaited-phase deadlines + the watchdog sweep               [C]
    ├── seats.ts         the seat projection + assignee liveness                              [C]
    ├── releases.ts      operator-only release audit (+ pre-migration recovery)               [C]
    ├── retention.ts     message pruning                                                      [C]
    ├── launches.ts / launch.ts, terminate.ts, store.ts   lifecycle + crash recovery
    └── org/             the org layer: schema, dispatch, assignments, teams, grants, tasks,
                         compose, reads, phases, schema (migrations)                          [C]
```

### 1.1 Architecture, end to end

```text
        ┌──────────────────────────────────────────────────────────────────────────────┐
        │  Pi host                                                                     │
        │   manifold tool (src/extension.ts:78)  ──flags──►  --manifold-agent / -root      │
        │        │                                        / --session-dir  (ext:74-75)  │
        │        │  one more agent launched in a pane by src/herdr.ts:78-79                │
        │        ▼                                                                     │
        │  ┌───────────────────────────── Store (store.ts) ──────────────────────────┐ │
        │  │  execute(binding, request)                                              │ │
        │  │    1. GATE  (gate.ts)  identity.binding → permission → budget →         │ │
        │  │                        quality.alignment        (phases 10/20/30)      │ │
        │  │    2. DISPATCH (src/storage/org/dispatch.ts)  ~30 ops: assignments, teams, tasks,   │ │
        │  │                                    rooms, grants, reads                │ │
        │  │    3. RECEIPT  operations / org_operations  (idempotent per requestId)  │ │
        │  └───────────┬───────────────────────────┬───────────────────────────────┘ │
        │              │                           │                                  │
        │      SQLite (WAL)  one file per root     │      NATS  live inbox            │
        │      .pi/manifold/state/manifold.sqlite  │      manifold.v1.<proj>.<agent>  │
        │      metadata.project + metadata.root    │      ….inbox                     │
        └──────────────┼───────────────────────────┼──────────────────────────────────┘
                       │                           │
              durable facts (31 tables)      live wake-ups (messages row is durable;
                       │                     published_at / observed_at / processed_at
                       ▼                     are the three receipts)
                messages, rooms, assignments, teams, claims, grants, fences …
```

The two-line summary of the architecture: **one tool door, one gate ladder, one SQLite file per
(root, project), and NATS only for waking a subscriber** — the durable record is always SQLite.

## 2. STORE — SQLite + WAL, one file per (root, projectId)

**Location and identity** `[C]`: the file is `.pi/manifold/state/manifold.sqlite` under the project root
(`src/storage/database.ts:60`), with its `-wal` and `-shm` siblings guarded as safe paths (`:61`).
WAL is **required**, not preferred: the open path asserts `journal_mode=wal` and refuses otherwise
(`:71-72`). The database is opened with a 5 s busy timeout (`:64`). Identity lives in a one-row
`metadata` table that pins `project`, `root`, `policy`, `limits` (`src/storage/schema.ts:302`), and an open
against the wrong project refuses the store (`src/storage/database.ts:218`) `[C]`.

**The 31 tables, by owner.** Every line number is the `CREATE TABLE` in `src/storage/schema.ts` unless stated.

| Group | Tables |
| --- | --- |
| **Message core** | `metadata` (:302), `attempts` (:308), `messages` (:315), `operations` (:328) |
| **Rooms** | `rooms` (:353), `room_messages` (:359), `room_deliveries` (:370), `room_readers` (:379), `room_cursors` (:388), `room_operations` (:395) |
| **Org: teams** | `teams` (:125), `team_members` (:133), `teams_history` (:140) |
| **Org: work** | `tasks` (:146), `assignments` (:152), `assignment_phases` (:164), `claims` (:170), `expectations` (:179) |
| **Org: launch** | `creation_intents` (:190), `launches` (:195), `provisioned_panes` (:209) |
| **Org: authority** | `policy_revisions` (:79), `policy_fences` (:93), `member_grants` (:50), `member_grant_events` (:65), `gate_decisions` (:283), `policy_rebinds` (`src/storage/database.ts:22`) |
| **Audit / receipts** | `org_operations` (:227), `priority_sends` (:31), `releases` (`src/storage/releases.ts:11`), `coordinator_releases` (`src/storage/store.ts:57`) |

**Columns that carry the model** — read from the DDL, not guessed `[C]`:

- `assignments` (`src/storage/schema.ts:152-158`): `id`, **`parent TEXT REFERENCES assignments(id)`** (self-referencing
  tree), `task`, `feature_revision`, `assigner`, `assignee`, `team`, `goal`, `exclusions`, `acceptance`,
  `state` (CHECK in the seven values below), `created_at`, `updated_at`.
- `teams` (`:125-130`): `id`, `template`, `name`, `topology_json`, `blueprint_digest`, `created_by`, and
  `state` CHECK `('proposed','forming','active','draining','retired','archived')`, plus the four timeline
  columns `created_at`, `drained_at`, `retired_at`, `archived_at`.
- `team_members` (`:133-136`): `(team, agent)` PK, `role`, `profile`, `joined_at`, `left_at` — membership is
  a **time interval**, never a deletion.
- `tasks` (`:146-149`): `id`, `feature`, `kind`, `deps_json`, `body`, `state` CHECK
  `('pending','ready','assigned','done','failed','cancelled')`.
- `claims` (`:170-174`): `kind` CHECK `('path','shared-resource')`, `scope`, `root_name` (multi-root,
  `CLAIM_ROOT_COLUMN` at `:19`), `acquired_at`, `released_at` — a claim is released, never deleted.
- `expectations` (`:179-186`): `owner`, `assignment`, `awaited_phase` CHECK
  `('reported','finalized','completion_sent','completed')`, `deadline`, `state` CHECK
  `('waiting','fulfilled','escalated')`.
- `attempts` (`:308-312`): `id`, `agent`, `session`, `started_at`, `ended_at`, `policy_generation`, `pid`,
  `pid_started_at` — and a **partial unique index `live_agent ON attempts(agent) WHERE ended_at IS NULL`**
  (`:314`), which is how "one live session per agent" is enforced by the database itself.
- `messages` (`:315-321`): `seq` (autoincrement), `id`, `sender`, `recipient`, `conversation`,
  `correlation`, `body`, `created_at`, **`published_at`, `observed_at`, `processed_at`** (the three
  transport receipts), `priority`.
- `room_deliveries` (`:370-376`): `(message, recipient)` PK with `observed_at`, `processed_at`,
  `published_at` — one row **per recipient**, which is what makes rooms per-member.

**Immutability is enforced in the database, not by convention** `[C]`. Every content table carries a
`BEFORE UPDATE ... RAISE(ABORT)` trigger and a `BEFORE DELETE ... RAISE(ABORT,'retained …')` trigger:
messages (`src/storage/schema.ts:333,335`), receipts (`:338,340`), teams/team_members/teams_history
(`:231-244`), tasks (`:246,248`), assignments (`:250,252`), phases (`:254,256`), claims (`:258,260`),
expectations (`:262,264`), intents (`:266,268`), launches (`:270-275`), panes (`:220-225`),
org receipts (`:277,279`), policy revisions and fences (`:89,91` and `:104,106`), member grants
(`:62,73,75`), priority sends (`:36,38`), gate decisions (`:297`), releases
(`src/storage/releases.ts:26,28`), coordinator releases (`src/storage/store.ts:63,65`).
The pattern is uniform: **state columns may move; identity, content and history may not.**

**Rebind / migration** `[C]`. A configuration change is not an in-place edit: it opens a **new policy
generation**, records the revision (`policy_revisions`, `src/storage/schema.ts:79`), computes the per-agent fence set
(`policy_fences`, `:93`), and writes an **append-only rebind audit** carrying the before/after policy,
blueprint, limits and the live counts (`policy_rebinds`, `src/storage/database.ts:22-33`). Additive schema columns are
applied by `ensureColumn` migrations rather than a version bump for every field
(`src/storage/schema.ts:14-21`; `src/storage/org/schema.ts:55-79`), and `SCHEMA_VERSION` is 6 (`src/storage/schema.ts:1`).

## 3. TRANSPORT — NATS for the live signal, SQLite for the record

`[C]` The client is `@nats-io/transport-node` with `connect` and `credsAuthenticator` (`src/transport.ts:2`).
Options are built in one place: servers list, `timeout: 2000`, `reconnect: true`,
`maxReconnectAttempts: -1` (`:21`); credentials are either token/user-password or a `.creds` file read at
connect time (`:26-29`). A refused connection is reported as an operator problem, never as a raw crash
(`:49`).

- **Subscribe**: the agent subscribes to `manifold.v1.<projectId>.<agentId>.inbox` (`:91`), idempotently —
  a subscribe failure must not leave a connection that looks healthy while the inbox is dead (`:79-81`).
- **Publish**: a send publishes to `manifold.v1.<projectId>.<recipient>.inbox` (`:149`).
- **The durable record is independent of the live one** `[C]`: the `messages` row exists before the
  publish; `published_at` records the publish, `observed_at` the client-side observation, and
  `processed_at` the ack (`src/storage/schema.ts:315-321`, indexes at `:322-327`). The server-side flow is outbox-first:
  `OUTBOX_QUERY` selects unsent rows for a sender (`src/storage/schema.ts:4`), so a crash between "stored" and
  "published" is recoverable rather than lost.
- **Rooms**: a room post writes `room_messages` plus one `room_deliveries` row per member
  (`src/storage/rooms.ts:161`), and the member's unread count is a `room_deliveries` count (`:203`); ack sets
  `processed_at` with `COALESCE` so a second ack is a no-op (`:254`). `room.read` advances a monotonic
  cursor (`room_cursors`, `src/storage/schema.ts:388`) and the page revision is `MAX(rowid)` over the recipient's
  pending rows (`src/storage/rooms.ts:286`).

**What is NOT in the code** `[C]/[I]`: there is no at-least-once delivery loop over `room_deliveries`
beyond the per-call ack, and no JetStream. Delivery reliability for a live session rests on (a) the durable
row and (b) the session reading its inbox again — not on broker redelivery. `[I]`

## 4. IDENTITY and BINDING — injected at launch, not asserted in a message

`[C]` Identity is **launch-injected and non-overridable**, in three layers:

1. **The flags exist and say what they mean**: `pi.registerFlag('manifold-agent', …)` and
   `pi.registerFlag('manifold-root', … 'never selectable by peer messages')` (`src/extension.ts:74-75`).
2. **A value may not smuggle a flag**: a schema refine rejects any string matching
   `--(manifold-agent|manifold-root|session-dir)` (`src/types/org.ts:82`) — so a peer message cannot carry
   an identity assertion that the host would then honour.
3. **The launcher injects them**: `src/herdr.ts:78-79` passes `--manifold-agent <agent> --manifold-root <root>
   --session-dir <…>` into the pane it spawns.

The runtime binding is a strict three-id object: `BindingSchema = { agentId, attemptId, sessionId }`
(`src/types/storage.ts:4`). It is **1:1 with a live attempt**: `attempts` holds `(id, agent, session,
started_at, ended_at)` with the partial unique index that permits at most one live attempt per agent
(`src/storage/schema.ts:308-314`), and `projectId` comes from the store's own `metadata` row (`src/storage/schema.ts:302`,
`src/storage/database.ts:76`) rather than from the caller.

Launch lifecycle `[C]`: `creation_intents` records a proposed member set (`src/storage/schema.ts:190`); `launches`
records one row per intended agent with state CHECK `('requested','launching','launched','uncertain','failed')`
and `failure_source` CHECK `('inferred','definite')` (`:195-207`); `provisioned_panes` records which pane
was provisioned for which agent, immutably (`:209-215`, triggers `:220-225`). `UNIQUE(intent,agent)` on
launches makes a repeated launch request idempotent at the row level (`:206`).

**The honest limit** `[C]`: this identity is *injected by the host*, not *proved by the agent*. It closes
impersonation-by-message and gives a fence a stable subject; it is not a cryptographic attestation of which
binary is running.

## 5. AUTHORITY — the gate runner, the fence, the classifier, the grants

**The runner** `[C]`: stages run in phase order inside one call and **a denial short-circuits** (a later
stage leaves no trace) — `src/storage/gate.ts:163-171`. The stage ids are
`identity.binding`, `permission`, `budget`, `quality.alignment` (`src/types/gate.ts:94`), constructed with
phases **10 / 20 / 30** (`src/storage/store.ts:231,248`), and each stage declares a fail policy
(`fail: 'closed'` for identity/permission/budget; `'open-recorded'` for the alignment judgment —
`src/storage/store.ts:270`). Denials and flags are **recorded**, allows are not: `gate_decisions` stores only
`verdict IN ('deny','flag')` (`src/storage/schema.ts:283-293`, trigger `:297`), which keeps the allow path write-free.

**The fence** `[C]`. Every live attempt carries the `policy_generation` it started under
(`src/storage/schema.ts:308`), and the authority query joins the attempt, the active metadata and the agent's fence
rows in **one statement** (`src/storage/schema.ts:110-118`) `[C]`. A fence row newer than the attempt's generation
denies with **`STALE_POLICY`** (`src/storage/gate.ts:43`), and one message serves both the guard and the stage so they
cannot drift (`:29-31`). A generation with no recorded revision is treated as **R0 — fence everything**
rather than trusting silence (`src/storage/schema.ts:118-120`).

**An external verdict** (a judgment computed elsewhere, e.g. a jev alignment) may only apply if it was
computed for **this stage**, over **this subject digest**, against the **generation still in force**, and
before it expired — four checks, each with its own refusal (`src/storage/gate.ts:106-133`); otherwise it is downgraded
per that stage's fail policy (`:145`).

**The change classifier** `[C]` — `src/storage/classify.ts`, seven rules applied in order, with **R2 the
only early return** and **R3-R6 only ever ADDING** fenced agents (`:15-16`):

| Rule | What changed | Fence effect | Cite |
| --- | --- | --- | --- |
| **R0** | the workspace block (directories claims and launches may address), or an unparseable revision | fence **every** live attempt | `src/storage/classify.ts:66` |
| **R1** | limits (attempt ceiling, scale-seat preflight) | fence all — rationing changed | `:69` |
| **R2** | an additive-only policy change | existing sessions keep authority (early return) | `:88` |
| **R3** | an agent removed, or its role/team/parent changed | fence that agent | `:98` |
| **R4** | a role's routes changed (`sendTo` is directional) | fence the agents on both sides | `:112` |
| **R5** | blueprint permission for one role changed | fence that role's holders | `:127` |
| **R6** | blueprint structure changed | fence the affected roles | `:140` |

The classification is recorded per fence row as
`('fallback','additive','widening','narrowing','mixed')` (`src/storage/classify.ts:22`), so a rebind leaves evidence of
*why* an agent was fenced.

**Grants vs revokes** `[C]`. A blueprint is the *one owner of removal*; a member grant is the *one owner of
addition* (`src/storage/org/grants.ts:9-19`). Grants are durable state read per operation
(`activeGrants`, `:37`) and merge monotonically over the blueprint permission
(`effectivePermission`, `:62`) — a grant can only add capability, never narrow authority. Duration is
bounded by `GRANT_CAP = 16` (`:21`), identities are immutable (`src/storage/schema.ts:62`), and every grant/revoke
writes an append-only event keyed `(actor, request_id)` (`src/storage/schema.ts:65-72`) so a retried request cannot
duplicate the authority change.

## 6. ASSIGNMENTS — a parent tree with a five-state handshake

`[C]` An assignment is a row in `assignments` whose `parent` references another assignment
(`src/storage/schema.ts:152`), so the work graph is a **tree**, and the phase history is readable from a node down
(`assignment_phases`, `:164`, indexed by assignment+time at `:169`).

```text
                    ┌──────────── assignment state machine ────────────┐
                    │                                                   │
   dispatch ──────► assigned ──report──► reported ──finalize──► finalized
   (assignments    │  (:185)              (:154)                  (:190)
    .ts:104 needs  │                                                 │
    a READY task)  │                                          complete (:202)
                    │                                                 ▼
                    │                                         completion_sent
                    │                                                 │
                    │                                          complete  (:170)
                    │                                                 ▼
                    │                                            completed
                    │
                    └──fail──► failed          └──cancel──► cancelled
                       (:283 CHECK lists all seven states)
```

Read precisely: **the assignee reports, the assigner finalizes, the assignee completes.** The code enforces
who may move what — `only the assigner may finalize` (`src/storage/org/assignment-reads.ts:30`: a row is offered
`finalize` when `assigner === actor` and state is `reported`/`completion_sent`), and `finalize` carries a
decision `('accept','rework')` (`src/types/protocol.ts` finalize literal). `rework` returns the assignment to
the earlier state rather than closing it `[C]`.

**Every operation** `[C]`, all dispatched from one table (`src/storage/org/dispatch.ts:48-53`): `dispatch`, `assign`,
`report`, `finalize`, `complete`, `fail`, plus `assignment.close` (`:37`). `dispatch` refuses unless the
task is `ready` (`src/storage/org/assignments.ts:104`).

**Claims** `[C]`: a claim is a durable path or shared-resource lock owned by one assignment
(`src/storage/schema.ts:170`), released by timestamp, and capped per assignment — `claims.length <=
teamsBlueprint.caps.maxClaimsPerAssignment` (`src/storage/org/assignments.ts:37-38`). A partial unique index on active
claims per scope (`src/storage/schema.ts:176`) is what makes "one owner" a database fact rather than a convention.

**Task authoring** `[C]`: `task.create`, `task.deps`, `feature.plan` (`src/storage/org/dispatch.ts:45-47`;
`src/storage/org/tasks.ts:9`) build the `tasks` graph that dispatch then hands out.

**Deadlines are per awaited phase** `[C]`: creating a report opens an expectation for the assigner to
finalize, and every transition fulfils the previous one and opens the next
(`src/storage/expectations.ts:40-53`). Defaults: `reportedMs`, `finalizedMs`, `completionSentMs` each 600 000 ms and
`maxDeadlineMs` 86 400 000 ms, with a refine that no phase deadline exceeds the max
(`src/types/org.ts:96-106`). A **watchdog sweep** marks overdue expectations `escalated`
(`src/storage/expectations.ts:54-56`) and is driven by an in-process pump in the extension (`WatchdogPump`,
`src/extension.ts:197`) — a timer in the host, not a background service `[C]`.

## 7. TEAMS — a blueprint-bounded primitive with a six-state lifecycle

`[C]` The blueprint is a document with topologies and caps: a `mesh` topology requires an explicit
`convergerRole` (`src/teams-blueprint.ts:48`), a `hub` topology likewise (`:53`), a phase topology may **not**
declare nested phases (`:57-62`), and mesh rounds are validated against
`teamsBlueprint.caps.meshMaxRounds` (`:192`). That last pair — *no nested phases*, *finite mesh rounds* — is
the rigidity in one sentence.

```text
                       team lifecycle  (teams.state CHECK, src/storage/schema.ts:127)
   ┌──────────┐   compose    ┌─────────┐  members   ┌────────┐
   │ proposed │─────────────►│ forming │───────────►│ active │
   └──────────┘              └─────────┘            └───┬────┘
                                                        │ team.drain
                                                        ▼
                                                   ┌──────────┐  team.retire  ┌─────────┐
                                                   │ draining │──────────────►│ retired │
                                                   └──────────┘               └────┬────┘
                                                                                   │ team.archive
                                                                                   ▼
                                                                              ┌──────────┐
                                                                              │ archived │
                                                                              └──────────┘
```

`team.scale` adds or removes **exactly one** member per request (`src/storage/org/teams.ts:34`: `add` XOR `remove`), and
a seat that is occupied by a live session cannot be scaled into another team (`:58`). Growth spends a seat
against `maxActiveAttempts + reservedAttempts` (`:63-67`).

**Seats** `[C]`: one projection decides who occupies a seat — live attempts, launches still
`requested`/`launching`, and `launched`/`uncertain` rows not yet bound by an attempt
(`src/storage/seats.ts:8-12`, `seatAgents` at `:18-20`). A separate **liveness** answer (live / pending /
unreconciled / dead) exists because an in-flight launch is reachable but a never-bound launch older than
`LAUNCH_PENDING_MS = 120 000` is not (`src/storage/seats.ts:24-29`).

## 8. ROOMS — team messaging with per-member durable deliveries

`[C]` `rooms` is 1:1 with a team (`team TEXT NOT NULL UNIQUE`, `src/storage/schema.ts:353-358`); `room_messages`
holds the content (`:359`) and `room_deliveries` holds one row per recipient with the three receipts
(`:370`). Membership grants are `room_readers` with `revoked_at` (`:379`), read position is
`room_cursors` (`:388`), and dedupe for `room.post` is `room_operations` keyed `(actor, request_id)`
(`:395`).

Operations `[C]`: `room.post`, `room.read`, `room.digest`, `room.grant`, `room.revoke`, `room.request`,
and `team.room` to enable/disable a team's room — all literal request shapes in `src/types/protocol.ts`.
The revision a reader sees is `MAX(rowid)` over that recipient's pending deliveries (`src/storage/rooms.ts:286`), so a
room is a monotonic stream per member rather than a shared cursor.

## 9. PROFILES — git/url sources, a sha256 lock, and a 32-entry catalog

`[C]` Profiles are loaded from a **source** (git or url) into a cache addressed by content: the loader
reads `readCachedProfile(root, entry.resolved.sha256)` and refuses a size mismatch
(`src/loader/commands/profiles.ts:5,65-82`), and records the resolved `sha256` in a lock entry
(`:100-102`). `allow_multi_profile` composes several profiles, and a selected profile with no healthy exact
lock/cache entry is refused by name (`:19`). The catalog is capped at **32** entries (`:40-42`).

**Why this matters to the map** `[I]`: the profile layer is already content-addressed by digest, which is
the same discipline the store uses for pins — a profile cannot silently change under a running agent.

## 10. LIMITS and BOUNDS — every number has one owner

`[C]` The limits document is a strict object: `maxActiveAttempts` (1-256), `reservedAttempts` (0-1),
`maxStoredMessages` (default 200 000) and `maxStoredRoomMessages` (default 100 000)
(`src/types/limits.ts:6-14`).

- **The reserve is not a general allowance** `[C]`: `attemptCeiling()` adds `reservedAttempts` **only** when
  the binding's agent holds the policy's human-facing role (`src/storage/store.ts:145-149`), so the single human
  identity can always bind even when the attempt pool is full — a lockout guard, and the reason the limit
  is schema-capped at 1.
- **Phase deadlines** are bounded per transition and globally (`src/types/org.ts:96-106`; §6).
- **Retention** `[C]`: processed messages above `maxStoredMessages` are pruned
  (`src/storage/store.ts:150-155` → `src/storage/retention.ts:13`); unread mail is never pruned — the `retain_messages` trigger
  refuses deleting an unprocessed row (`src/storage/schema.ts:335-337`). Rooms have their own cap
  (`maxStoredRoomMessages`), and `room_deliveries` cascades with its message (`src/storage/schema.ts:371`).

## 11. RECOVERY and CRASH — what survives a dead process

`[C]` Four mechanisms, each visible in the schema:

1. **Ownership is a live attempt row**, not an in-memory claim: `attempts(agent, session, started_at,
   ended_at)` with `UNIQUE(agent) WHERE ended_at IS NULL` (`src/storage/schema.ts:308-314`). A dead process leaves the
   row; nothing else can bind that agent until the row is ended.
2. **Operator release, audited**: `releases` (agent, attempt, released_by, request_id, reason, at)
   records who released which attempt and why (`src/storage/releases.ts:11-16`), with an `immutable_releases` trigger
   (`:26`). `releaseAttemptAtRoot` is the pre-migration path — it opens the database directly, without
   constructing a `Store`, precisely so a stranded attempt can be cleared when the store cannot open
   (`src/storage/releases.ts:23-40`). `coordinator_releases` is the coordinator-facing twin (`src/storage/store.ts:57`).
3. **Launch uncertainty is a state, not a guess**: a launch that may or may not have happened is
   `uncertain` with `failure_source` `inferred`/`definite` (`src/storage/schema.ts:195-207`), reconciled by
   `team.reconcile` (`src/storage/org/dispatch.ts:44`). The seat projection keeps an unbound `launched`/`uncertain` row
   holding a seat only until an attempt started after it was requested (`src/storage/seats.ts:8-12`) — so a crashed
   launch cannot lock the pool out forever.
4. **Process identity is recorded**: `attempts.pid` and `pid_started_at` (`src/storage/schema.ts:311`, columns added at
   `:9-10`) let a host decide whether the process behind a live attempt still exists `[I]` — the code that
   compares them was not read line by line, so this is inferred from the columns.

**What recovery does NOT do** `[C]`: there is no attempt-heartbeat table and no automatic attempt expiry.
A stranded attempt is cleared by an audited operator release (§10 numbers stay intact), not by a timer.

## 12. THE TOOL SURFACE — one tool, one request union, five next actions

`[C]` The extension registers exactly one tool, `manifold` (`src/extension.ts:78-79`). Every operation is a
literal in one request union (`src/types/protocol.ts`), dispatched by one switch (`src/storage/org/dispatch.ts:26-75`).
The op families, as read from that switch: `whoami`, `status`, `peers`, `inbox`, `history`, `send`, `ack`,
`help`, `now`, `diagnose`, `issue.template`, `issue.open`, the `org.*` and `team.*` reads
(`org.status`, `org.teams.config`, `org.teams`, `org.tasks`, `org.assignments`, `org.phases`, `org.ready`,
`org.launches`, `org.list`), the `room.*` ops, the team ops (`team.compose`, `team.scale`, `team.drain`,
`team.retire`, `team.archive`, `team.room`, `team.launch`, `team.reconcile`), the task ops
(`task.create`, `task.deps`, `feature.plan`), the assignment ops (`dispatch`, `assign`, `report`,
`finalize`, `complete`, `fail`, `assignment.close`), and the grant ops (`member.grant`,
`member.revoke`).

**Assignment-facing reads carry `nextAction`** `[C]`: the enum is
`('report','finalize','complete','wait','none')` (`src/types/protocol.ts:314,321`) — the same five answers a
caller needs in order to act, which is why the handshake can be driven by a peer rather than a scheduler.

**Ack discipline** `[C]`: an inbox page reports the agent's pending count and a monotonically increasing
revision (`src/storage/rooms.ts:203,286`; the same shape for direct messages via `COUNT_QUERY`/`REVISION_QUERY` at
`src/storage/schema.ts:7-8`), and `ack` sets `processed_at` — so "delivered" and "processed" are different facts and
only the second advances the revision.

## 13. The invariants, in one table

| Invariant | How it is enforced | Cite |
| --- | --- | --- |
| **One live attempt per agent** | partial unique index on `attempts` | `src/storage/schema.ts:314` |
| **Non-overridable identity** | schema refine rejects identity flags inside any value; launcher injects them | `src/types/org.ts:82`, `src/herdr.ts:78-79` |
| **Generation fence → `STALE_POLICY`** | attempt generation vs active generation + fence rows, one query | `src/storage/schema.ts:110-118`, `src/storage/gate.ts:43` |
| **Deny/flag recorded, allow not** | `gate_decisions` CHECK `('deny','flag')` | `src/storage/schema.ts:283-293` |
| **Grants add, blueprints remove** | monotonic union; grant identity immutable | `src/storage/org/grants.ts:9-19,62`, `src/storage/schema.ts:62` |
| **One owner per scope (claims)** | partial unique index on active claims per scope | `src/storage/schema.ts:176`, `src/storage/org/assignments.ts:37-38` |
| **Occupancy: one seat, one session** | seat projection over live attempts + in-flight launches | `src/storage/seats.ts:8-20` |
| **History is append-only** | `RAISE(ABORT)` triggers on UPDATE/DELETE for every content table | `src/storage/schema.ts:231-340` |
| **A human cannot be locked out** | `reservedAttempts` added only for the human-facing role | `src/storage/store.ts:145-149` |
| **Application-level intersection ceiling** | the gate's permission stage + grants that only add | `src/storage/store.ts:231`, `src/storage/org/grants.ts:62` |

## 14. Verified vs inferred, and what this map did NOT establish

**Verified** `[C]`: the 31 tables and their columns (§2); WAL and per-root storage (§2); the NATS subject and
the three message receipts (§3); the identity flags, refine, binding and attempt uniqueness (§4); the gate
stages, the fence and the R0-R6 classifier (§5); the assignment tree, its seven states and its six ops (§6);
the team lifecycle, topology caps, seating and occupancy (§7); the room tables and the revision rule (§8);
the profile lock/cache and the 32 cap (§9); the limits and the reserve rule (§10); release audits, launch
uncertainty and retention (§11); the tool and request surface (§12).

**Inferred** `[I]`, stated as such: the `pid`/`pid_started_at` comparison the host performs (§11.4); the
absence of broker-level redelivery (JetStream is not imported anywhere I read) (§3); the claim that no
attempt heartbeat exists (no heartbeat table/column was found in the schema, but I did not read every
runtime file); and the reliance of delivery on the session re-reading its inbox (§3).

**Not established by this map** `[C]`: anything about NATS server configuration, TLS material, deployed
policies or live databases — none were read, by design. The map is a map of the **source**, not of an
installation.

## 15. Index of sections

| § | Subsystem | What it answers |
| --- | --- | --- |
| 1 | Module map + architecture | which files own what, and how a call travels |
| 2 | Store | every table, column, trigger and the rebind path |
| 3 | Transport | NATS vs the durable record, and the three receipts |
| 4 | Identity/binding | why a message cannot claim an identity |
| 5 | Authority | gate stages, fence, classifier, grants |
| 6 | Assignments | the tree, the state machine, the ops, claims, deadlines |
| 7 | Teams | blueprint caps, lifecycle, scale, seats |
| 8 | Rooms | per-member deliveries, revision, ack |
| 9 | Profiles | content-addressed loading, 32 cap |
| 10 | Limits | every bound and who it protects |
| 11 | Recovery | what survives a dead process |
| 12 | Tool surface | the one tool, the request union, nextAction, ack |
| 13 | Invariants | the ten facts the schema will not let you break |
| 14 | Verified vs inferred | what was read, what was reasoned, what was not looked at |
