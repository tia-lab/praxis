# Design — the profile system: three layers, four owners, one pinned resolution

Task: profiles · Hash: 286ce77d · Gate: design (G2/G3 combined per the unit) · Status: draft · Date: 2026-10-31
Content unit: `.pi/praxis/profile/{role,domain}/*.json`. **No runtime code in this unit** — the loader and the
selector are Shape B (§9). No `src/` file, schema, store or extension is touched.

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

Path: `.pi/praxis/profile/<layer>/<name>.json`, `layer ∈ {conduct, role, domain}`, the same path grammar the
task, rule-set and flow references use (`pathUnder`, one segment rule). **`id` equals the last path segment**,
and a document whose `id` disagrees with its filename is refused, exactly as a task is.

```ts
// Shape B (src/types/profile.ts): the whole shape, nothing optional.
export const ProfileLayerSchema = z.enum(["conduct", "role", "domain"]);

export const ProfileSchema = z.strictObject({
  id: z.string().regex(KEBAB),                  // kebab; must equal the file's last segment
  version: z.int().min(1),
  layer: ProfileLayerSchema,
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(240),      // one line: when to use this profile
  body: z.string().min(1).max(8000),            // the markdown the agent receives
});
```

Six fields, all required, strict: an unrecognised key is a refusal rather than a silent pass. There is no
`extends`, no `tools`, no `capabilities`, no `priority`: the layer field already carries composition, the
resolver already owns order, and a profile must never be able to name a permission.

Every body ends with the same advisory sentence:

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

The three authored layers never restate each other. A role body contains no conduct core and no subject method;
a domain body contains no role obligation. A role opens by naming the two sections it inherits and stating that
it cannot weaken or widen them.

## 4. Resolution

Resolved **once per instance**, at `op=start` (and again at `before_agent_start`, which reads the pin, never the
library). Order of assembly, first to last:

```text
conduct/<default>.body            (mandatory, exactly one)
role/<assignment role>.body       (optional; declared or absent)
domain/<flow domain>.body         (optional; declared or absent)
task.rules bodies                 (the task's rule-sets, already resolved by the rules unit)
```

Each block is introduced by a one-line provenance header — `## Role: architect (v1)` — so the agent can tell
which layer a sentence came from, and so the resolved text is auditable without reading the store.

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

The more specific owner wins a **conflict of instruction**: a task rule beats a domain method, a domain method
beats a role habit, and all of them sit inside the conduct frame. Precedence is a documented reading order, not
an enforcement: it resolves what to do when two layers point different ways; it never deletes a required check,
never widens a permission and never overrides the project's own instructions.

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

1. Every file in `profile/role/` and `profile/domain/` parses as JSON, carries exactly
   `{id, version, layer, name, description, body}`, and `id` equals its filename.
2. `layer` equals the folder name; `version` is an integer ≥ 1; `description` ≤ 240 characters.
3. Every body ends with the advisory sentence, verbatim.
4. No body contains `occam_`, `reasoning_protocols`, `extends` or `select_profile`; no body names a tool that
   this runtime does not have; no body carries a coercive register (an "iron law", "no exceptions", an all-caps
   mandate) — every profile states its obligations as guidance.
5. No role body restates the conduct core: a role opens with its stance and the two inherited sections only.
6. No domain body states a role obligation; a domain states subject specifics only.
7. The resolver order, the mandatory conduct default, the failure matrix, the pin and the precedence are stated
   once each in this document and agree with each other.

## 11. Open items for the lead

- **O1 (blocking for the taxonomy).** `conduct/occam.json` does **not** exist. The conduct file is
  `.pi/praxis/profile/occam.json` and its header does not match the schema in §2:

  | | existing file | the schema |
  | --- | --- | --- |
  | path | `profile/occam.json` | `profile/conduct/occam.json` |
  | layer | `"role": "main"` | `"layer": "conduct"` |
  | extra key | `_poc` | none (strict) |

  The body text needs no change. The minimal migration is `git mv` plus two header lines, and it was **not
  applied** because the unit says to stop and flag any shape change to that file.
- **O2.** `.pi/praxis/profile/test.json` is an untracked live-test POC with a `statements` array, which is not a
  profile. It should move out of the tree (or be deleted) before the taxonomy is enforced; left untouched here.
- **O3.** The existing conduct body closes with "…grant additional authority"; the new profiles close with
  "…grant any permission" per the unit brief. Harmonising the conduct line is a one-line edit, batched with O1.

## 12. Minimality ledger

- **MIN-006** no speculative surface: no severity, tags, priority, tools or `extends` field; no fourth layer.
- **MIN-009** one owner per fact: conduct=project, role=assignment, domain=flow, rules=task; the resolved text is
  derived, never stored; the pin stores the files' own bytes.
- **MIN-010** one mechanism: the profile layers use the path/version/pin machinery the task and rule-set atoms
  already use; the selector reuses the jev adapter seam rather than adding a second judgment path.
- The three layers exist because each has a different owner and a different lifetime; merging any two would give
  one owner a fact it does not own.
