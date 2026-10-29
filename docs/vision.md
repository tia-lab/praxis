# Praxis — Composable Persistent Work Runtime

**Status:** Initial design specification · 2026-10-29 · Design only; implementation not authorized by this document.

## 1. North star

> **Praxis owns the boundaries and continuity of work; the agent owns choices within those boundaries.**

Praxis is a composable, persistent, out-of-context execution runtime inside Pi. An authorized agent invokes a named **flow**. Praxis creates a durable work instance, restricts its tools and nested runtimes, advances through validated steps, produces structured artifacts, records effects and experience, and returns a compact result to the calling agent.

| Level    | System       | Responsibility                                                                                  |
| -------- | ------------ | ----------------------------------------------------------------------------------------------- |
| Atom     | **Occam**    | Cognition, reasoning, evidence, learning (MUST BE REDONE) /home/tia/\_DEV/AI/occam/             |
| Molecule | **Praxis**   | Work execution, flow state, artifacts, effects                                                  |
| Organism | **Manifold** | Communication, assignments, teams, authority (WE CAN ALREADY WORK) /home/tia/\_DEV/AI/manifold/ |
| System   | **Jung**     | Collective synthesis and federated memory (NOT DONE)                                            |

**Other refrences**
/home/tia/\_DEV/AI/tia-mcp-rs very heavy but useful idea there

Praxis must not become a second reasoning engine, team manager, or federated memory authority.

## 2. Essential behavior

1. **One config:** a strict project JSON file references relative profiles, flows and document templates.
2. **Authorized entry:** `praxis(flow: "architect")` either creates/resumes an authorized instance or returns a typed denial with no effect.
3. **Sticky binding:** an agent stays within its active flow until completion or an authorized, recorded abort/revision. State survives turns, compaction and restarts.
4. **Agent-directed steps:** within a step, the agent selects allowed tools or nested runtimes; Praxis validates operations and controls progression.
5. **Composable runtimes:** permitted steps may invoke Pi tools, Fabric, Occam Reason, or other registered runtimes.
6. **Out of parent context:** intermediate work remains in the runtime; the caller receives a bounded summary, artifact references and status.
7. **Structured outputs:** agents incrementally produce JSON-schema-validated artifacts, renderable to JSON, YAML or Markdown.
8. **Durable experience:** Praxis records work outcomes and supports a bounded background memory-maintenance flow.

## 3. Authority and composition

**Profile** answers _who can invoke what_. **Flow** answers _what steps and outputs are required_. **Step** answers _which operations are allowed now_. **Artifact template** defines _what must be produced_.

Effective permissions are the intersection:

`project policy ∩ actor profile ∩ parent runtime ∩ flow ∩ current step`

- Absent capability list: inherit the existing parent ceiling.
- `["*"]`: all capabilities already allowed by that ceiling, **not** all host capabilities.
- `[]`: no capabilities.
- Explicit list: restrict to the listed subset.
- Nested runtime calls inherit a non-expanding ceiling and share the parent's budgets.
- Unknown names are invalid; unauthorized known names are denied.
- An agent may propose a flow extension only with a declared permission. Expansion is versioned, validated and separately authorized; it never silently increases the running instance's rights.
- The actor's identity must come from a trusted Pi/Manifold binding, never an untrusted request field.

**Enforcement limit:** broker checks only constrain calls routed through Praxis. A strong claim that an agent _cannot touch anything else_ requires blocking alternate tool paths or using an OS sandbox. This must be a separate integration gate, not a prompt instruction.

## 4. Illustrative configuration

Proposed entry: `.pi/praxis/config.json`; all paths relative to the canonical project root. Strict parsing rejects unknown keys, traversal, escaping symlinks, and missing files.

```json
{
	"schema": "praxis.config/v1",
	"enabled": false,
	"profiles": { "architect": "profiles/architect.json" },
	"flows": { "architect": "flows/architect.json" },
	"templates": { "architecture-spec": "templates/architecture-spec.json" },
	"limits": {
		"maxConcurrentInstances": 2,
		"maxDepth": 3,
		"maxSteps": 24,
		"maxToolCalls": 100,
		"maxRuntimeMs": 1800000
	},
	"memory": { "enabled": false, "maintenanceEveryTurns": 20 }
}
```

All numeric values are **proposals, not calibrated limits**. Existing instances pin their config/profile/flow/template digests. Config changes affect new instances unless an authorized instance migration is performed.

Example profile `profiles/architect.json`:

```json
{
	"schema": "praxis.profile/v1",
	"id": "architect",
	"allowedFlows": ["architect"],
	"tools": ["read", "grep", "find"],
	"runtimes": ["fabric", "occam"],
	"mayExpandFlow": false,
	"mayAbortOwn": true
}
```

Example flow `flows/architect.json`:

```json
{
	"schema": "praxis.flow/v1",
	"id": "architect",
	"artifact": "architecture-spec",
	"steps": [
		{
			"id": "inspect",
			"kind": "agent",
			"tools": ["read", "grep", "find"],
			"completion": "sources-recorded"
		},
		{
			"id": "reason",
			"kind": "agent",
			"runtimes": ["occam", "fabric"],
			"completion": "decisions-recorded"
		},
		{
			"id": "draft",
			"kind": "artifact",
			"template": "architecture-spec",
			"completion": "schema-valid"
		},
		{ "id": "review", "kind": "validation", "completion": "acceptance-passed" }
	]
}
```

These are **illustrative contracts**; freeze exact schema and error names before implementation.

## 5. Runtime lifecycle

```text
requested → authorized → running → validating → completed
                           │   ↑          │
                           └───┘ next step
                           │
                           ├→ blocked → resumed (authorized)
                           ├→ failed
                           └→ abort_requested → aborted (effects reconciled)
```

Every instance persists: stable ID, trusted actor, optional Manifold assignment reference, pinned definition digests, active step, step history, obligations, artifacts, effect intents, receipts, status and revision.

- Same actor-qualified request ID + same payload replays; conflicting payload rejects.
- Completion requires step checks **and** task/artifact acceptance.
- Abort needs a named reason and permitted actor; uncertain effects may delay closure.
- Resume reconciles unfinished effects and revalidates current policy without silently replacing pinned definitions.
- A sticky binding cannot be bypassed by starting a different flow unless policy explicitly permits concurrency/switching.

## 6. Step execution and dataflow

Each step defines its ID, kind (`agent`, `tool`, `runtime`, `artifact`, `validation`), typed input/output bindings, permitted capabilities, limits, completion predicate, and allowed transitions. Later steps may consume earlier **validated outputs by reference**.

An agent chooses an allowed operation; Praxis checks it, records intent for effects, dispatches through a capability broker, records an evidence receipt, checks the step postcondition, then advances. A typed decision may choose a permitted branch, but cannot bypass a failed predicate. No unbounded retries or recursive runtime calls.

Adapters for Pi tools, Fabric, Occam and other runtimes declare schemas, side-effect class, required permissions, cancellation/reconciliation behavior, limits and receipt format. Nested calls require depth/cycle checks and shared budget reservation. An unavailable adapter returns a named blocker, not fabricated success.

## 7. Persistence and external effects

Use one local durable execution store (SQLite is the proposed default), separate from Manifold assignment authority and Occam cognitive traces. Append-only events support derived current state.

Minimum records:

| Record        | Fields                                                                        |
| ------------- | ----------------------------------------------------------------------------- |
| Instance      | id, actor, flow/profile/config digests, status, current step, revision        |
| Step event    | step id, attempt, transition, input/output digests, timestamp                 |
| Effect intent | operation, idempotency key, state: planned/running/confirmed/uncertain/failed |
| Receipt       | step/effect ref, outcome, evidence refs, digest, timestamp                    |
| Artifact      | schema/template digest, version, path, content digest, validation state       |
| Experience    | outcome, step refs, lessons, provenance                                       |

For external effects use **durable intent → external operation → observed result → durable receipt**. Never hold a SQLite write transaction across an external call. On crash, uncertain effects block blind replay until reconciled. Do not claim exactly-once external execution.

## 8. Structured artifacts

Templates define a strict structured document, e.g.:

```json
{
	"schema": "praxis.artifact.architecture/v1",
	"goal": "...",
	"constraints": [],
	"decisions": [],
	"alternatives": [],
	"risks": [],
	"acceptance": [],
	"evidenceRefs": []
}
```

The agent fills the artifact progressively. Praxis validates field types, required content, evidence links, and task-level acceptance. The canonical structured artifact and digest are authoritative; Markdown/YAML are derived renderings. **Schema-valid does not automatically mean task-complete.** Artifact revisions are versioned and attributable.

## 9. Local memory and hidden maintenance

Praxis captures **execution experience**: step outcomes, useful sequences, failures, artifact revisions, and validated lessons. It does not replace Occam's reasoning memory.

A separate, explicitly authorized maintenance flow may run after a configurable number of completed turns/events or on a bounded schedule. It may use Jev/Occam when available and budgeted to:

- cluster similar work experiences and detect hidden patterns;
- deduplicate and reorganize retrieval views;
- update classifications, relationships and relevance rankings;
- synthesize versioned advisory patterns;
- supersede interpretations when contradicted by evidence.

It **must not** silently edit original receipts, historical events, owner permissions, active bindings, or completed artifact bytes. Every interpretation change is provenance-linked, reversible and auditable. Maintenance cannot grant itself capabilities or interrupt active steps. Its budget, cooldown and behavior when Pi is not running require explicit design.

**Boundary:** Praxis maintains local work experience; **Jung** handles project-wide/cross-project synthesis and federated domain lakes. Read access and contribution/export permissions are separate.

## 10. Parent-facing API

Proposed operations: `praxis.run`, `praxis.status`, `praxis.inspect`, `praxis.resume`, `praxis.abort`. All mutations require stable request IDs and permission checks.

Illustrative result:

```json
{
	"schema": "praxis.result/v1",
	"instanceId": "px_...",
	"flow": "architect",
	"status": "completed",
	"summary": "Architecture specification produced and validated.",
	"artifacts": [{ "id": "a_...", "path": "...", "digest": "sha256:..." }],
	"evidenceRefs": ["..."],
	"nextAction": null
}
```

Blocked/failed/aborted results return a stable typed reason, current step, and permitted recovery. Full internal transcripts never enter the parent context by default; bounded authorized inspection is available.

## 11. Non-negotiable invariants

1. One strict root config; all referenced definitions confined and digest-pinned.
2. Every active instance has a trusted actor, authorized flow and effective capability ceiling.
3. Wildcards, nesting, memory and dynamic composition cannot amplify permissions.
4. Steps and effects are durably recorded; retries are idempotent where possible.
5. Uncertain external effects block blind re-execution.
6. Agent choice is limited to current-step operations and allowed transitions.
7. Completion requires task acceptance, not merely successful tool calls.
8. Historical evidence is immutable; memory interpretations may evolve with versioning.
9. Parent context receives bounded results and references, not internal transcript replay.
10. Manifold owns assignments; Occam owns cognition; Praxis owns work execution; Jung owns federated synthesis.
11. Missing/unknown/stale/unauthorized state fails closed with a typed reason.
12. No savings, learning, or sandbox claims without real evidence.

## 12. Implementation workstream

| Unit                   | Deliverable                                                                | Acceptance                                                                 |
| ---------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **P0 Contracts**       | Strict config/profile/flow/step/artifact/result schemas and error taxonomy | Invalid keys, bad refs, cycles, permission escalation rejected             |
| **P1 Authority**       | Trusted actor binding, policy intersection, capability registry            | Denied flow/tool causes zero effects; child cannot expand rights           |
| **P2 Durable engine**  | Instance state machine, event log, intents, receipts, idempotency          | Crash/restart resumes correct step; uncertain effect not retried blindly   |
| **P3 Step runner**     | Typed dataflow, step predicates, branching and budgets                     | Step B consumes A output; failed check blocks advancement                  |
| **P4 Adapters**        | Pi tool broker; gated Fabric/Occam adapters                                | Input/output validated; unavailable adapter blocks; nested budget enforced |
| **P5 Artifact engine** | Structured templates, validation, canonical persistence, rendering         | Invalid artifact cannot complete; digest stable; rendering is derived      |
| **P6 Pi integration**  | Out-of-context host execution and compact parent result                    | Parent sees no internal trace; authorized status/inspect/resume works      |
| **P7 Experience**      | Durable execution lessons and retrieval                                    | Outcomes trace to receipts; stale refs excluded                            |
| **P8 Maintenance**     | Bounded background synthesis with reversible interpretations               | Original evidence unchanged; budget enforced; changes auditable            |
| **P9 Live acceptance** | Architect flow end-to-end, restart, negative permissions                   | Real Pi host run completes artifact; unauthorized operation blocked        |

**Order:** P0 → P1 → P2 → P3 → P5 → P6; add P4 adapters as the broker stabilizes; P7 → P8 after evidence storage; P9 after integration gates. Begin with a **read-only architect flow** before enabling mutations or nested runtimes.

## 13. Open design gates

1. **Isolation:** broker-only tool confinement versus OS sandbox; specify what is actually enforceable.
2. **Pi host seam:** supported out-of-context invocation, cancellation and restart behavior; do not depend on undocumented Fabric internals.
3. **Trusted identity:** source of actor binding with/without Manifold.
4. **Flow expansion:** who may propose, approve, and activate new steps and capabilities; whether active instances can migrate.
5. **Artifact contract:** JSON Schema dialect, canonical digest rules, rendering, acceptance ownership.
6. **Durability:** store root, migration, retention, crash consistency and backups.
7. **Maintenance:** what counts as a turn, who triggers it without an active Pi process, budgets and cooldown.
8. **Nested execution:** maximum depth, cycle rules, shared budgets, cancellation propagation.

## 14. First vertical slice — architect

**Scenario:** an authorized architect runs `praxis.run` for a bounded architecture task.

1. Resolve the actor from trusted host binding; authorize the `architect` flow.
2. Pin definition digests and create the durable instance.
3. `inspect`: use only permitted read/search tools; record source references.
4. `reason`: use an explicitly allowed adapter (or block with a named reason); record decisions and evidence.
5. `draft`: incrementally populate the structured architecture artifact.
6. `review`: validate schema **and** task acceptance; on failure block with exact unmet check.
7. Persist final artifact and receipts; return only a short result with artifact path/digest.
8. Restart midway: resume from durable state without duplicating effects.
9. Negative test: an unauthorized tool or alternate flow is denied before execution.

**Definition of done:** one real Pi-hosted run produces a validated artifact; permission checks, durable resume, evidence and compact output are observed. A green unit suite alone is insufficient.

---

**Guiding sentence:** **Manifold assigns. Occam reasons. Praxis executes and preserves work. Jung reorganizes collective experience.**
