# Design — the profile system: three layers, four owners, one pinned resolution

Task: profiles · Hash: 286ce77d · Gate: design (G2/G3 combined per the unit) · Status: draft · Date: 2026-10-31
Content unit: `.pi/praxis/profile/{conduct,role,domain}/*.json`. **No runtime code in this unit** — the loader and
the selector are Shape B (§9). No `src/` file, schema, store or extension is touched.

amended 2026-10-31 — §0 kept byte-identical (hash8 unchanged); §2 replaced by the owner-locked schema; the
advisory line moved from every body to one resolver-appended line; §4 now states the field-wise union and the
injection order; §10 oracles rewritten; §11 records O1–O3 closed — the owner locked the schema and the layout.

## 0. Contract

<!-- One physical line per key: this block is the hash input. Never reflow it. -->

task: define a three-layer profile set (conduct, role, domain) as file-owned JSON atoms under .pi/praxis/profile and design their composition, resolution, pinning and advisory selection check
scope: .pi/praxis/profile/{role,domain}/*.json and docs/profiles-<hash8>/design.md; later, under a separate Shape-B authorization, src/types/profile.ts and the before_agent_start loader
acceptance: every authored profile parses against one schema (id equals the filename, version, layer, name, description, body), layers on the conduct profile without duplicating it, carries no Occam machinery and names no tool this runtime lacks, and closes with the advisory line; the design fixes the four owners, the mandatory conduct default, the typed fail-closed refusals, per-instance pinning, the conflict precedence task-rules > domain > role > conduct, and the four guards on the advisory jev check; no runtime code in this unit

Recompute: `printf 'task: %s\nscope: %s\nacceptance: %s\n' '<t>' '<s>' '<a>' | sed -E 's/[[:space:]]+$//' | sha256sum | cut -c1-8` → `286ce77d`.

## 1. Outcome

An agent's conduct is assembled from three reusable, file-owned layers instead of one long prompt: **conduct**
(how work is done at all), **role** (what this seat owes), **domain** (what this subject demands). Each layer is
an atom with a path, a version and one owner. The composition is resolved once per instance and pinned, so a
run's conduct is reproducible after the files change.

Not in this unit: any code. Not in this design: a fourth mechanism, a rule engine, an enforcement gate.

## 2. The atom

**Status: locked by the owner (2026-10-31).** Every file in `.pi/praxis/profile/` parses against the schema
below; this section is a contract, not a proposal.

### 2.0 What the lock changed

The locked shape is the closed object below: structured fields the runtime validates, plus an optional prose
spine for the one layer that needs it.

What the lock does **not** change, because this design does not key on it: the atom's identity
(`id == filename`, `layer == folder`, `version`), the four owners (§3), the resolution order and its
provenance headers (§4), the fail-closed matrix (§5), the pin (§6), the precedence (§7) and the advisory
guards (§8) all read `{layer, id, version}` — never the body's internal shape.

The ten profiles moved, mechanically:

| before | locked field | the move that was made |
| --- | --- | --- |
| the `# X profile` title and the stance paragraph | `name`, `description`, `overview` | the stance becomes `overview` |
| `## Project and task requirements` | `invariants[]` | one entry per sentence that must hold |
| `## Role obligations` bullets | `invariants[]` or `prefer[]` | a hard obligation becomes an invariant; a default worth preferring becomes a preference |
| the "do not" clauses already in each body | `avoid[]` | one entry each |
| `## Deliverable` | `invariants[]` or `prefer[]` | whichever the sentence actually is |
| the closing advisory sentence | — | **removed from every profile**; the resolver appends the single advisory line once (§4) |
| the flowing Occam prose | `body` | kept for `conduct/occam` only (≤ 4000); roles and domains omit it |

The mapping is the record of a move that has been made, not a proposal; §10 verifies the result.

Path: `.pi/praxis/profile/<layer>/<name>.json`, `layer ∈ {conduct, role, domain}`, the same path grammar the
task, rule-set and flow references use (`pathUnder`, one segment rule). **`id` equals the last path segment**,
and a document whose `id` disagrees with its filename is refused, exactly as a task is.

```ts
// Shape B (src/types/profile.ts).
ProfileSchema = z.strictObject({
  id: z.string().regex(KEBAB),              // MUST equal the file's last path segment
  version: z.int().min(1),
  layer: z.enum(['conduct','role','domain']), // MUST equal the folder it sits in
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(240),   // META ONLY — selection/catalog line, NOT injected as conduct
  overview: z.string().min(1).max(280),      // injected first: 1-2 line intent
  invariants: z.array(z.string().min(1).max(280)).max(12), // always-hold
  prefer: z.array(z.string().min(1).max(280)).max(12),     // do
  avoid: z.array(z.string().min(1).max(280)).max(12),      // don't (+ why, calm)
  examples: z.array(z.strictObject({ bad: z.string().max(280).optional(), good: z.string().max(280).optional(), note: z.string().max(280).optional() })).max(6).optional(),
  body: z.string().min(1).max(4000).optional(), // optional flowing prose spine; occam uses it, roles/domains usually omit
}).refine(p => (p.invariants.length + p.prefer.length + p.avoid.length) > 0 || !!p.body, 'a profile must carry content');
```

Nine fields are required and two optional (`examples`, `body`). The object is **strict**: an unknown key is
`PROFILE_INVALID`, a typed refusal rather than a silent pass. `description` is metadata — the selection line,
never injected; `overview` is what the agent reads first. The three entry arrays are capped at 12 of 280
characters each, so a profile states obligations instead of writing an essay, and the refine requires content:
at least one entry across the three arrays, or a `body`. There is no `extends`, no `tools`, no `capabilities`,
no `priority` — the layer already carries composition, the resolver already owns order, and a profile must never
be able to name a permission.

**No profile carries the advisory sentence.** The resolver appends it **once** to the composed output (§4), so
it cannot drift between files and a new profile cannot omit it. The single line is:

> This profile guides behavior. It does not enforce gates, prove truth, install hooks, or grant any permission.

### 2.1 Source discipline

Occam is primary: the conduct profile and the role obligations come from it. Four distilled patterns are
borrowed from the superpowers skills as **secondary enrichment**, rewritten in our own words and in this
project's calm, evidence-led register: the claim-to-proof mapping (reviewer, "evidence before claims"), the
red-green essence (domain/code), multi-component boundary instrumentation (debugger), and "rulings, not stalls"
plus unit right-sizing (lead).

Deliberately not imported: the coercive register ("iron law", "no exceptions", all-caps mandates), the
skill-invocation rules, git worktrees, the brainstorm server, and every hook, script or plugin. Those are harness
behaviour rather than conduct, and no profile can enforce them anyway. The superpowers skills are MIT-licensed
(© Jesse Vincent); the text here is adapted, not copied, and nothing is quoted at length.

## 3. Taxonomy and the four owners

| Layer | What it answers | Owned by | Declared at |
| --- | --- | --- | --- |
| **conduct** | how work is done at all | the **project** (one active default) | project config; today `conduct/occam` |
| **role** | what this seat owes | the **assignment** (a seat, not a task) | the start request / assignment authority |
| **domain** | what this subject demands | the **flow** | the flow document |
| **task rules** | reusable guidance for this unit of work | the **task** | the task's `rules` refs (already built) |

**The task never names a profile.** A task is reusable across profiles: putting `role` or `domain` in a task
document would bind the work to one seat and destroy that reuse. A task may reference rule-sets; that is the
only profile-adjacent fact it owns.

The three authored layers never restate each other. A role carries no conduct core and no subject method; a
domain carries no role obligation. Each role's `overview` states that it layers on the conduct frame and cannot
weaken or widen it.

## 4. Resolution

Resolved **once per instance**, at `op=start` (and again at `before_agent_start`, which reads the pin, never the
library). Order of assembly, first to last:

```text
overview      = conduct, then role, then domain      (ordered, one or two lines each)
body          = the prose spine when a layer has one  (conduct; roles and domains usually omit it)
invariants    = UNION(conduct, role, domain, task rules)
prefer        = UNION(conduct, role, domain, task rules)
avoid         = UNION(conduct, role, domain, task rules)
examples      = UNION(conduct, role, domain)          (any that declare them)
advisory      = one line, appended once by the resolver
```

**Field-wise union, not text concatenation.** Each field is merged across the layers; entries keep their own
wording and a duplicate collapses to one. `overview` is the exception — it is ordered, one line per layer,
because it is the agent's first orientation. On a direct conflict, precedence decides (§7).

**Injection order** is fixed: `overview` → `body` (when present) → `invariants` → `prefer` → `avoid` →
`examples` → the advisory line. Each section opens with a one-line provenance header naming the layers that
contributed (`## Invariants (conduct, role)`), so the agent can tell which layer an entry came from and the
resolved text is auditable without reading the store.

The resolver is pure: `(project config, assignment, flow, task, profile files) → { blocks, ids, versions, digests }`.
It reads no store, writes nothing, and returns a value; the caller pins it (§6) and hands the text to the agent.

**Where the text goes:** the agent's system context at `before_agent_start` (Shape B). It does **not** enter the
six-key result, and it does not enter the step brief in this design. The brief stays the task's contract; the
profile is the agent's conduct. A one-line `profiles: [{layer, id, version}]` readout on `instance.created` is
the audit trail (§6).

## 5. Fail-closed

| Condition | Code | Detail | When |
| --- | --- | --- | --- |
| `conduct` default absent, unreadable, unparseable, or its `id` ≠ filename | `PROFILE_NOT_FOUND` | `layer: "conduct"`, `reason: "no-default" or "invalid"`, path | start, before any write |
| a declared `role`/`domain` names a file that does not exist | `PROFILE_NOT_FOUND` | `layer`, `id`, path | start, before any write |
| a declared name is not a kebab id, or the document is malformed | `CONFIG_INVALID` | `layer`, `id`, issue | start |
| a declared `role`/`domain` exists but is not authorized for this instance | `PROFILE_FORBIDDEN` | `layer`, `id`, the allowed set | start |
| a pinned profile row is absent | `PIN_MISSING` | existing shape | read |
| pinned bytes ≠ digest | `PIN_CORRUPT` | existing shape | read |

Two new codes (`PROFILE_NOT_FOUND`, `PROFILE_FORBIDDEN`), the same split the task and rule-set units use:
"the name does not exist" and "the name exists but you may not use it" are different facts. `CONFIG_INVALID`,
`PIN_MISSING` and `PIN_CORRUPT` are reused. The `Code` mirror in `src/types/pi.ts` and `TAXONOMY_SIZE` grow by
two (Shape B).

Conduct is **mandatory**: there is no "no conduct" state and no empty default. A missing or broken conduct file
is a project misconfiguration and refuses the start rather than silently running an agent with no conduct.

## 6. Pinning

The resolved set is pinned inside the existing start transaction, one `definition` row per layer actually used:

```text
kind: "profile", id: "conduct/occam",  bytes: <file bytes>, digest: <sha256>
kind: "profile", id: "role/architect", bytes: <file bytes>, digest: <sha256>
kind: "profile", id: "domain/code",    bytes: <file bytes>, digest: <sha256>
```

This is the mechanism the rules unit already uses for `kind: "ruleset"` — the column is text and the key is
already `(instance, kind, id)`, so it needs **no DDL, no table and no migration**. `loadPinnedProfiles` re-verifies
each digest on every read: editing a profile file afterwards cannot change a finished run's conduct.

`instance.created` gains an additive payload key `profiles: [{layer, id, version, digest}]` — evidence, not a
schema change (event payloads are free-form). Two runs with the same ids and versions had the same conduct.

## 7. Precedence on conflict

```text
task rules  >  domain  >  role  >  conduct
```

The more specific owner wins a **direct conflict**: a task rule beats a domain method, a domain method beats a
role habit, and all of them sit inside the conduct frame. It applies only where two layers actually disagree —
non-conflicting entries are unioned and all of them hold (§4). Precedence is a documented reading order, not an
enforcement: it never deletes a required check, never widens a permission and never overrides the project's own
instructions.

The layers are ordered by *ownership specificity*, not by recency: a later file does not beat an earlier one, and
neither does a newer version.

## 8. The advisory selection check

An optional jev decision — *does this role/domain fit this goal?* — may run at start. It is **advisory**: it
never refuses work, never widens the layers, and never becomes a gate. Four guards bound it:

- **(a) Closed set.** The candidates are the authorized profiles for that layer. An unknown name is invalid; a
  known-but-unauthorized name is denied. The model chooses from a list; it cannot invent an entry.
- **(b) Fail-closed.** No decision, a stale one, an error or a timeout falls back to **conduct + role only**
  (the declared seat without a domain, or without the contested layer). It never falls back to a guess that adds
  surface. A failed selector must be indistinguishable from a selector that was never asked.
- **(c) Conduct-only, never amplifying.** The check runs *beneath* the ceiling, not beside it: the effective
  permissions are already the intersection project ∩ profile ∩ parent ∩ flow ∩ step, computed in code before
  any profile is read. A selector that names a profile can only *narrow* which advisory text is shown — it can
  never add a capability, a tool, a scope or a write. If the code above it would deny an action, no profile
  decision changes that.
- **(d) Pinned per instance.** The decision is taken once, recorded as
  `{layer, candidate, goalDigest, availableSet, chosen, at}`, and pinned with the profiles. It is not re-judged
  mid-run: a run's conduct cannot drift because a later turn looked different.

The decision is written to a durable record only when a selector actually ran; an advisory check that never
fired writes nothing, so a rules-free, selector-free run is byte-identical to today.

## 9. Shape B — what is not built

| Piece | Seam it will use | Status |
| --- | --- | --- |
| `src/types/profile.ts` (the schema in §2) | `src/types/` | not built |
| `src/runner/profile.ts` (resolver, §4) | pure module, no store | not built |
| `before_agent_start` loader | the Pi extension surface (`src/pi/extension.ts`) | not built |
| pinning (§6) | `src/runner/engine/start.ts` + `DefinitionKindSchema` gains `"profile"` | not built |
| the selector (§8) | `src/quality/` jev adapter, outside any transaction | not built |
| flow-level `domain` declaration | `FlowConfigSchema.profile?` | not built |

Nothing in this unit depends on Shape B landing: the content is valid today and is read by nothing.

## 10. Acceptance oracles (content, runnable now)

1. Every file in `profile/{conduct,role,domain}/` parses as JSON against the §2 `strictObject`: the nine required
   keys, no unknown key, and every string inside its bound (280 per entry, 240 for `description`, 64 for `name`,
   4000 for `body`).
2. `id` equals the filename's last segment and `layer` equals the folder; `version` is an integer ≥ 1.
3. The refine holds: at least one entry across `invariants`/`prefer`/`avoid`, or a `body`.
4. No profile contains `occam_`, `reasoning_protocols`, `extends` or `select_profile`, names no tool this runtime
   lacks, and carries no coercive register (an "iron law", "no exceptions", an all-caps mandate).
5. No profile carries the advisory sentence — the resolver appends it once (§4); a file that contains it fails.
6. No role restates the conduct core and no domain states a role obligation; each adds only what its layer owns.
7. `conduct/occam.json` exists (it is mandatory) and its `body` is the flowing discipline, ≤ 4000 characters,
   with the hard sentences lifted into `invariants` and the prohibitions into `avoid`.

## 11. Closed items (the lock)

- **O1 — closed.** The conduct file moved to `profile/conduct/occam.json` and was adapted to the locked schema:
  `layer: "conduct"`, `_poc` dropped, the hard sentences lifted into `invariants`, the prohibitions into `avoid`,
  and the flowing discipline kept in `body` (≤ 4000).
- **O2 — closed.** `profile/test.json` (the POC marker with a `statements` array) was deleted; the tree is now
  exactly `conduct/occam.json`, seven `role/*.json` and two `domain/*.json`.
- **O3 — closed by removal.** No profile carries the advisory line any more; the resolver appends the one line
  (§4), so there is no per-file wording to harmonise.
- **Versions stay at 1.** Nothing has ever resolved or pinned these files (Shape B is unbuilt), so this is a
  schema change rather than a published-version change: no instance can be holding an older reading.

## 12. Minimality ledger

- **MIN-006** no speculative surface: no severity, tags, priority, tools or `extends` field; no fourth layer.
- **MIN-009** one owner per fact: conduct=project, role=assignment, domain=flow, rules=task; the resolved text is
  derived, never stored; the pin stores the files' own bytes.
- **MIN-010** one mechanism: the profile layers use the path/version/pin machinery the task and rule-set atoms
  already use; the selector reuses the jev adapter seam rather than adding a second judgment path.
- The three layers exist because each has a different owner and a different lifetime; merging any two would give
  one owner a fact it does not own.
