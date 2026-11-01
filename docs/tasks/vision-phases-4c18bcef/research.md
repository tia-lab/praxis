# Research — vision phases

Task: vision-phases · Hash: 4c18bcef · Gate: G1 · Status: in progress · Date: 2026-10-29

## 0. Contract

task: Produce an evidence-based phase programme for the Praxis runtime core and its co-constraints
scope: the vision-phases task folder in docs/
acceptance: seven questions answered with source-inspected or executed evidence; per-phase goal artifact acceptance exclusions blocking gates and rework cost; at least one rejected ordering with its discriminating constraint; the two-phase proof defined; a reuse ledger with adopt adapt or reject reasons; owner accepts

```sh
canonical() { printf 'task: %s\nscope: %s\nacceptance: %s\n' "$1" "$2" "$3" \
  | sed -E 's/[[:space:]]+$//'; }
canonical "<task>" "<scope>" "<acceptance>" | sha256sum | cut -c1-8   # 4c18bcef
```

## 1. Alignment

**Intent** — an agent drifts from the goal across turns: it reinterprets, expands, or loses
track of which phase it is in. Nothing structural holds the goal, the phase and the
deliverable. Praxis makes alignment structural instead of remembered: the runtime owns
goal + phase + artifact; the agent owns only the choices inside the phase.

**Target** — a composable runtime outside the parent agent's context window. A flow
configuration (data) declares ordered phases, the capabilities each phase may use, the
artifact each phase must produce and the gate that lets work advance. The agent works
inside the current phase only; the phase produces a durable artifact; a recorded gate
verdict advances or blocks; the parent receives a bounded result with artifact references.
The runtime knows no domain: engineering, legal and operational flows differ only in their
data. JSON is the only configuration format for v1.

**Frozen** (owner-decided; not open to re-litigation here)

| Decision | Reason |
| --- | --- |
| Manifold assigns · Occam reasons · Praxis executes and preserves · Jung synthesizes | three authorities exist or are planned; a second reasoning engine or team manager duplicates authority |
| One owner per fact; the Praxis store is not the assignment authority and not a cognitive trace | competing copies make recovery and audit impossible |
| Completion means task/artifact acceptance, never merely successful tool calls | schema-valid output is not a finished task |
| Durable intent → external operation → observed result → receipt; uncertain effects block replay; no exactly-once claims | a crash mid-effect is the failure that silently corrupts work |
| The parent receives a bounded result and references, never a transcript | that is the point of out-of-context execution |
| Domain differences live in data, never in runtime code | otherwise domain-generality is a claim, not a property |

**Open for this research** — the runtime's state model and transitions · the host seam · the
durability model · artifact canonicalisation and handoff · what enforcement v1 must prove ·
the gate-verdict semantics · what exists already and must not be rebuilt.

**Limits** — no isolation or sandbox claim (broker checks constrain routed calls only) · no
exactly-once external execution · no savings, learning or compliance claims without evidence ·
no Occam dependency, no Rust runtime.

**Acceptance** — a phase programme in which every phase carries goal · artifact · acceptance
proof · exclusions · blocking gates · rework cost, with evidence for the ordering and the
named constraint that rejected each alternative ordering.

**Assumed** (not confirmed by the owner) — single actor in v1 · the first slice is read-only ·
artifacts are tracked repository files with digests recorded in the store · the store root is
`.pi/praxis/`.

## 2. Questions — each needs evidence, not opinion

| # | Question | Evidence required |
| --- | --- | --- |
| Q1 | What is an instance: the facts it owns, its states, what is pinned at creation? | source-inspected prior art + the exact fields and the failure each prevents |
| Q2 | What advances it: transition, predicate, who records the verdict, and what a `no-go` leaves behind? | the state machine with every transition and its guard |
| Q3 | What does the artifact handoff require: canonicalisation, digest, versioning, and how the next phase consumes it without the transcript? | a concrete handoff trace, including what phase 2 cannot see |
| Q4 | What must v1 enforce, and what may be deferred without re-cutting the model? | a split with the reason each deferred item is safe to defer |
| Q5 | What does the parent receive? | the bounded result shape and what it deliberately omits |
| Q6 | What proves the runtime: the smallest end-to-end run that could falsify the design? | a two-phase proof where phase 2 sees only phase 1's artifact |
| Q7 | What already exists that must not be rebuilt? | reuse ledger: candidate → what it provides → adopt/adapt/reject → cost (coupling, licence, lifecycle) |

## 3. Reading plan

| Member | Slice |
| --- | --- |
| researcher-1 | `.dev/references/fabric-research/01-construction.md`, `02-kernel-runtime.md` — kernel, providers, runtime shape |
| researcher-2 | `.dev/references/fabric-research/03-agents-providers.md`, `04-config-security.md` — tool/provider boundaries, config and security posture |
| researcher-3 | `.dev/references/jev/*/docs/` — typed decisions, durable jobs, composition, native rewrite ledger |
| main-researcher | synthesis; `docs/vision.md` §3–§8; reads jev-search only where a reuse candidate needs it |

All paths are read-only evidence. Nothing under `.dev/` or `/home/tia/_DEV/AI/jev` may be copied
into `src/` without the dependency-inspection rule in `AGENTS.md`.

## 4. Write discipline

Only `main-researcher` writes in this folder. The other three report and challenge in the
team room and never touch files. `research.md` §0–§4 are fixed input: §0 changes only by an
owner decision recorded as a new hash; §1–§3 are owned by the lead.

## 5. What would fail this research

- A programme that restates `docs/vision.md` and resolves nothing.
- A design document in disguise: types and modules before constraints.
- Options without the constraint that discriminates them.
- A recommendation that cannot name what evidence would reverse it.
- Any claim labelled `executed` that was only read.

## 6. Findings

`main-researcher` writes findings here, each labelled `source-inspected`, `executed`,
`inference` or `untested`, with `path:line` references. Unresolved questions stay visible.

### 6.1 Answer summary

| # | Answer in one line | Evidence |
| --- | --- | --- |
| Q1 | An instance is a durable record of one authorized flow run: it owns execution facts (identity, actor binding, pinned definitions, assignment reference, step/attempt/status/revision, budgets, artifacts, effect intents/receipts) and not assignment state, cognition, source files or the parent transcript. requested/authorized are pre-durable; durable states are running, blocked, validating, completed, failed, abort_requested, aborted. | docs/vision.md:25-27, :75, :126-141; .pi/git/github.com/tia-lab/manifold/src/storage/schema.ts:39-49; src/storage/org/assignments.ts:130-220 |
| Q2 | Only the engine records a verdict, after a declared predicate over durable evidence; the producer cannot self-advance. A no-go leaves the instance blocked at the same step with a typed reason, unmet checks and an unaccepted artifact draft; no artifact is accepted and no effect is blindly retried. | docs/vision.md:103-117, :139-142, :146-150; docs/WORKFLOW.md:83-106; assignments.ts:130-188 |
| Q3 | The accepted artifact is canonical JSON bytes, SHA-256 digested, immutable per version; the next step receives a handoff reference plus verified artifact bytes, never the producer transcript, event log or session. | docs/vision.md:169-186, :235; .pi/git/github.com/tia-lab/manifold/src/policy.ts:8-17; /media/Development/AI/occam/.dev/pi-fabric-main/src/agents/types.ts:184-186, :214-216 |
| Q4 | V1 must enforce trusted identity, the ceiling intersection, broker-only allowlists, pinned definitions, budgets, durable intent/receipt, gate plus acceptance, immutable history and a bounded parent result. OS isolation, flow expansion, nesting, mutations, maintenance, multi-actor authority, signing, adapter breadth and experience can be deferred only because each has no enabled path and fails closed; flow expansion, nesting and maintenance will need a deliberate schema extension, not a silent re-cut. | docs/vision.md:38-51, :225-238, :257-266; AGENTS.md:88-118, :125-138; Fabric src/schema/policy.ts:1-38, docs/kernels.md:176-186 |
| Q5 | The parent receives instanceId, flow, status, summary, artifacts, evidenceRefs and nextAction plus a typed reason/current step/recovery on failure; it deliberately omits transcript, tool arguments, step history, raw events, hidden prompts and other instances. | docs/vision.md:204-222, :235; Fabric src/fabric-exec-tool.ts:938-961; src/agents/handoff-completion.ts:20-25 |
| Q6 | The smallest falsifier is a two-phase run: A writes a nonce-bearing decision artifact under a read-only loadout; B starts in a fresh session with only the accepted artifact readable and must reproduce the nonce and decision. Removing artifact access must make B fail; if B still succeeds, the boundary leaks and the design is falsified. | This document, section 6.7; docs/vision.md:268-285 |
| Q7 | Adopt Pi core tools as brokered actions, Node node:sqlite and node:crypto as store/digest primitives, and Zod for schemas; adapt Fabric's bounded agent result and observation surfaces behind an adapter, and adapt Manifold's reporter/verdict separation as a reference; reject Manifold, Fabric, jev-fabric and jev-search as Praxis's store or runtime. | This document, section 6.8; AGENTS.md:88-118; docs/WORKFLOW.md:193-198 |

Every material statement below is labelled source-inspected, executed, inference, proposed or untested. Anything not so labelled is a heading or a direct quotation.

### 6.2 Q1 — What an instance is

**Answer.** An instance is not the agent session and not the assignment. It is the durable record of one authorized flow run, keyed by a stable ID, whose state survives turns, compaction and restarts (docs/vision.md:27, :136). The agent session is replaceable; the instance and its event log are not.

**Facts the instance owns.**

| Fact | Why it exists | Failure it prevents | Evidence |
| --- | --- | --- | --- |
| instance_id | Stable identity for status, resume, abort and artifact references | A resumed or inspected run is ambiguous or mistaken for another | docs/vision.md:136 |
| actor_binding | Principal ID plus the trusted source of the binding (Pi host or Manifold), captured before creation | A request field forges identity or a later session claims another actor's instance | docs/vision.md:38-50; AGENTS.md:91-103 |
| assignment_ref (nullable) | assignmentId plus featureRevision as a read-only reference, not a copy of goal/acceptance/state | Praxis becomes a second assignment authority or silently works a stale task revision | AGENTS.md:88-90; docs/vision.md:152; assignments.ts:72-76 |
| definition_digests | Config, profile, flow, template and schema-version digests resolved at admission | A definition changes mid-run and the record no longer describes what ran | docs/vision.md:75, :136; invariant 1 at :227 |
| status, current_step, attempt | The only derived current position; events remain the source | Resume guesses a step or silently retries an attempt | docs/vision.md:126-141, :146 |
| revision | Monotonic compare-and-swap version for the instance row | Two writers overwrite each other; a stale writer appears to succeed | docs/vision.md:136; Manifold uses CAS heads and versioned phases (src/storage/schema.ts:51-55) |
| request_id plus payload_digest | Actor-qualified idempotency key for create/resume/abort | Duplicate instances, or a conflicting payload replaying as success | docs/vision.md:138 |
| capability_ceiling | The resolved intersection used at admission, with policy revision and timestamp | A later policy change is back-dated onto an earlier decision, or a child expands rights | docs/vision.md:38-50; AGENTS.md:91-99 |
| artifact_root and write_scope | The only filesystem paths this instance may write | Path traversal or an artifact landing outside the task folder | docs/vision.md:55; path confinement precedent in policy.ts:22-25 |
| budget | Max steps, tool calls, runtime, depth 0, and consumed amounts | Unbounded loops, hidden nested work, or a runaway child | docs/vision.md:65-74; AGENTS.md:104-107 |
| created_at, updated_at | Ordering and retention inputs | Retention or audit cannot distinguish stale from current | docs/vision.md:136; src/storage/schema.ts:39-49 |

**States.** requested and authorized are request phases, not durable instance states: authorization happens before insertion, so a denial returns a typed reason with zero effects (docs/vision.md:25-26). The durable states are:

| State | Meaning | Allowed next | Invariant |
| --- | --- | --- | --- |
| running | An admitted step is active | running (next step), validating, blocked, failed, abort_requested | At most one active step per instance; no effect without an intent |
| validating | The final required artifact is schema-valid and awaiting acceptance | completed, blocked, failed, abort_requested | Schema-valid is not complete (docs/vision.md:186) |
| blocked | A predicate, capability or acceptance check failed, or a dependency is unavailable | running on authorized resume, failed, abort_requested | Same step and accepted artifact version remain; no automatic retry |
| completed | Terminal; task/artifact acceptance recorded | none | Acceptance record must name a validator other than the producer |
| failed | Terminal typed failure | none | No silent reopen; a retry is a new authorized unit |
| abort_requested | Authorized abort recorded, effects not yet reconciled | aborted only when no effect is uncertain | Uncertain effects keep the instance here (docs/vision.md:141) |
| aborted | Terminal; abort reason and reconciled effects recorded | none | No exactly-once or rollback claim |

**What the instance does not own.** Assignment goal, exclusions, acceptance and assignment state are Manifold's (AGENTS.md:88-90; src/storage/schema.ts:39-49). Reasoning traces and interpretations are Occam's, and Occam is not installed; an unavailable Occam runtime yields a named blocker, not a fabricated result (AGENTS.md:131-138). Source repository files are the project's; the instance may only write its artifact paths. The parent transcript is the parent session's and is never copied into the instance (docs/vision.md:235).

**What is pinned at creation.** The admission snapshot pins: actor binding and source, assignment reference and feature revision when present, canonical digests of config/profile/flow/templates, the resolved capability ceiling and policy revision, budgets, artifact root/write scope, request identity, and the store schema version. Config changes affect new instances unless an authorized instance migration is performed (docs/vision.md:75); resume revalidates current policy without silently replacing pinned definitions (docs/vision.md:142). The pinned ceiling is an audit fact; current authority remains owned by the policy source.

**Inference.** The field list is the smallest one that makes each failure above detectable. A field that cannot name the failure it prevents should not exist (AGENTS.md engineering conduct; docs/WORKFLOW.md:161-191).

### 6.3 Q2 — What advances an instance

**Answer.** The engine advances an instance only by recording a verdict after evaluating a declared predicate over durable evidence. The agent may propose an artifact or request a transition; it cannot write a verdict, edit the status, or accept its own work. This is the same separation Manifold already enforces between assignee report and assigner finalize (assignments.ts:130-188), and the same rule the working procedure applies to review (docs/WORKFLOW.md:83-106).

**Transitions and guards.**

| From | Event and guard | To | Verdict writer | Durable record |
| --- | --- | --- | --- | --- |
| none | admit(actor, flow, ceiling) passes authorization, identity, config and budget checks | running at step 0 | engine | instance.created with pinned digests and request identity |
| running | Agent operation is allowed by the step ceiling and postcondition is not yet met | running (same step) | none | effect.intent and effect.receipt for effects; no progress event |
| running | Step predicate returns pass, and more steps remain | running at next step | engine | verdict.recorded(pass) and step.completed |
| running | Step predicate returns no-go, is unknown, or required evidence is missing | blocked | engine | verdict.recorded(no-go) with reason and unmet check IDs |
| running | Final required artifact is schema-valid and acceptance is required | validating | engine | artifact.draft plus verdict.recorded(schema-valid) |
| validating | An authorized validator (not the producer) records acceptance | completed | engine, on the validator's record | verdict.recorded(acceptance-passed) and instance.completed |
| validating | Acceptance is rejected, or no acceptance record exists when the flow requires one | blocked | engine | verdict.recorded(acceptance-rejected) with unmet checks |
| blocked | Authorized resume with a new attempt; current policy still allows the step | running | engine | step.resumed, attempt incremented |
| any nonterminal | Typed terminal error | failed | engine | instance.failed with reason |
| any nonterminal | Authorized abort with reason | abort_requested | engine | abort.requested |
| abort_requested | Every effect is confirmed or failed; none uncertain | aborted | engine | effects.reconciled and instance.aborted |
| abort_requested | At least one effect is uncertain | abort_requested (stays) | engine | effect.uncertain; blind replay is blocked |

**Predicates.** The flow declares a predicate ID, not code (docs/vision.md:103-117, :146). The engine owns a fixed registry such as sources-recorded, decisions-recorded, schema-valid, and acceptance-passed; an unknown ID is a config error at load, not a runtime surprise. A predicate receives only durable evidence references and the current artifact metadata; it cannot read the agent transcript. This keeps domain behavior in data and the runtime free of domain logic (docs/vision.md:146-150; frozen decisions, docs/vision.md:17-21).

**Who records the verdict.** The engine writes a verdict event in the same transaction that changes instance status and step position; the agent's tool surface has no write access to verdict, status, step or acceptance records. A verdict without an evidence reference is invalid. A verdict that names the producer as the acceptance validator is invalid. This is a code-level authority check, not a prompt instruction (docs/vision.md:38-51; AGENTS.md:104-107).

**What a no-go leaves behind.** A no-go is not a rollback. It leaves: the instance blocked; the same current_step and attempt incremented; a typed reason such as SCHEMA_INVALID, EVIDENCE_MISSING, ACCEPTANCE_REJECTED, CAPABILITY_DENIED or DEPENDENCY_UNAVAILABLE; the list of unmet check IDs; the artifact draft version (not accepted); every prior receipt and event; and the budget already consumed. Resume starts a new attempt from the same step. A rework decision in Manifold similarly returns the assignment to assigned while preserving phases and evidence (assignments.ts:171-181). An uncertain effect blocks resume until reconciled (docs/vision.md:139-142, :167).

**Open point — acceptance in a single-actor v1.** The assumed single actor cannot be both producer and independent validator. V1 has three honest options: (a) the parent/owner records acceptance with its identity, as G6 does (docs/WORKFLOW.md:208-213); (b) a separate Manifold reviewer assignment records acceptance; or (c) only deterministic predicates are used and owner acceptance remains outside the instance. If none is available, validating must remain blocked; self-acceptance is not an allowed fallback. This point is untested until the owner chooses.

### 6.4 Q3 — Artifact handoff

**Answer.** An artifact is an immutable, canonical JSON document with a digest-addressed version. The next step receives a handoff reference and verified bytes, not the producer's session. The handoff is a data boundary, not a prompt convention.

**Artifact record.**

| Field | Meaning | Failure it prevents | Evidence |
| --- | --- | --- | --- |
| artifact_id | Stable ID within the instance | A path or filename becomes the identity | docs/vision.md:184-186 |
| template_digest, schema_digest | The exact template and schema used | A later template change reinterprets old bytes | docs/vision.md:75, :184 |
| version | Monotonic per artifact; accepted versions are immutable | In-place edits destroy auditability | docs/vision.md:186 |
| path | Repository-relative path under the instance artifact root | Path escape or artifact outside the task folder | docs/vision.md:55 |
| content_digest | sha256: over canonical bytes | Silent byte changes, whitespace or key-order ambiguity | .pi/git/github.com/tia-lab/manifold/src/policy.ts:8-17 |
| validation_state | draft, schema-valid, accepted, rejected | Schema-valid is mistaken for accepted | docs/vision.md:186 |
| accepted_verdict | The verdict event that accepted this version | A later step consumes a draft or a producer's self-claim | docs/WORKFLOW.md:83-106 |
| produced_by_step | Step and attempt that wrote the version | Provenance is lost after resume | docs/vision.md:155-167 |

**Canonicalisation rule (proposed).** Accept only parsed JSON values; reject cycles, undefined, functions, symbols, NaN, Infinity and duplicate object keys. Arrays preserve order. Object keys sort by UTF-16 code unit order. Strings use JSON escaping. Emit UTF-8 without a BOM and without insignificant whitespace. Digest the resulting bytes with SHA-256 and render as sha256: plus hex. This adapts the sorted-key canonical JSON already used by Manifold (policy.ts:8-17); it is not copied source and needs its own fixtures for Unicode, number spelling, duplicate keys and schema dialect before P5 acceptance.

**Versioning.** A write never overwrites an accepted version. A revision creates version n+1; the prior version remains readable and attributable. The canonical structured artifact and digest are authoritative; Markdown/YAML are derived renderings (docs/vision.md:186). A digest is identity, not approval: the same bytes may be re-read, but only an acceptance verdict makes them consumable by the next step.

**Concrete handoff trace.**

1. Step A produces artifact v1 at docs/<task>/<instance>/architecture.json; the engine writes artifact.draft and content_digest.
2. Gate A validates schema, required fields, evidence paths and template digest; the engine writes verdict.recorded(pass) and artifact.accepted with version 1.
3. The engine constructs handoffRef with artifactId, version, path, digest, schema and acceptedVerdictId. It does not include the A transcript, A tool calls, A session ID, event log or parent messages.
4. Step B starts in a fresh session. Its prompt contains the task and handoffRef, not A's narration. Its tool loadout permits praxis.artifact.read for the accepted artifact and its own artifact writes; it denies repository reads, shell, Fabric and the event log for the proof variant.
5. praxis.artifact.read returns bytes plus digest; the engine checks the digest before dispatch. A mismatch is ARTIFACT_DIGEST_MISMATCH with zero effects.
6. B produces artifact v2, which records derivedFrom with the v1 digest; the same gate applies.

**What phase 2 cannot see.** A's session transcript, A's step events, the instance event log, the parent session, other artifacts, hidden prompts, raw tool arguments, and (in the proof variant) any repository file. This matches the parent boundary in docs/vision.md:235 and the fact that a Fabric agent result exposes terminal text/value, not the transcript (/media/Development/AI/occam/.dev/pi-fabric-main/src/agents/types.ts:184-186, :214-216; src/providers/agents-provider.ts:642). It is a brokered boundary unless an OS sandbox is added; direct shell access bypasses it (docs/vision.md:51; docs/kernels.md:176-186).

### 6.5 Q4 — What v1 must enforce and what may be deferred

**Must enforce in v1.** Read-only here means the flow may write only its own artifact files under the instance artifact root; it may not modify source files or call external services. These are the checks that make that first flow meaningful; each is code-level, not a prompt.

| # | Requirement | Enforcement point | Acceptance proof | Evidence |
| --- | --- | --- | --- | --- |
| E1 | Trusted actor identity, never a request field | Admission resolves the binding from the Pi/Manifold host before insertion | A forged actor field cannot create or resume; a denial has zero effects | docs/vision.md:38-50; AGENTS.md:91-103 |
| E2 | Effective ceiling = intersection of project, profile, parent, flow and step | Admission and every step entry compute the intersection; unknown names invalid, unauthorized known names denied | A denied flow/tool returns a typed reason and writes nothing | docs/vision.md:38-50; AGENTS.md:91-99 |
| E3 | Broker allowlist for the current step | Every routed operation checks the step's capability set; no ambient pass-through | A tool outside the step is denied before dispatch; audit event recorded | docs/vision.md:146-150; Fabric src/schema/policy.ts:1-38 as a precedent |
| E4 | Pinned definitions with no silent replacement | Admission writes canonical definition digests; resume compares and revalidates policy | A changed flow/profile causes a typed block or an authorized migration, not a silent run | docs/vision.md:75, :142 |
| E5 | Budgets per instance and step | Max steps, tool calls, runtime, depth 0; reservations checked before dispatch | Exhaustion returns a typed terminal/blocked result; no unbounded retry | docs/vision.md:65-74; AGENTS.md:104-107 |
| E6 | Durable intent, then external operation, then observed result, then receipt | Intent committed before the call; receipt committed after; no store transaction held across the call | A crash leaves a visible intent; an uncertain effect blocks replay | docs/vision.md:155-167; AGENTS.md:104-107 |
| E7 | Gate verdict plus task/artifact acceptance | Engine-only verdict; acceptance requires an authorized validator other than the producer | Schema-valid but unaccepted cannot complete; a rejected artifact stays blocked | docs/vision.md:139-142, :186; docs/WORKFLOW.md:208-213 |
| E8 | Immutable history and immutable accepted artifacts | Append-only events; versioned artifacts; no in-place accepted-byte edits | Re-reading history yields the same bytes; a new interpretation is a new record | docs/vision.md:227-238; AGENTS.md:104-107 |
| E9 | Bounded parent result with references only | The result builder whitelists fields and caps sizes; no transcript hook | Parent output contains no step events or tool arguments | docs/vision.md:204-222, :235 |

**Deferred, with the reason each is safe now.**

| Deferred item | Why safe to defer now | What would invalidate the deferral | Gate |
| --- | --- | --- | --- |
| OS sandbox / true isolation | V1 is read-only; broker checks constrain routed calls only. No containment claim is made. | A requirement to run untrusted mutation or to claim containment | #1 isolation (docs/vision.md:257-266) |
| Flow expansion and active migration | No expansion API exists; unknown steps/config are rejected. Enabling it later is a deliberate schema extension with a new review, not a silent re-cut. | A need to add steps or capabilities to a running instance | #4 flow expansion |
| Nested runtimes | Depth is fixed at 0; no nested-call path is installed. Enabling nesting needs depth/cycle/budget records. | A step that must invoke another runtime | #8 nested execution |
| Mutating tools and external effects beyond artifact files | The first flow is read-only; mutation requires a new authorized unit. | A flow that writes source or calls an external service | Product scope, AGENTS.md:125-138 |
| Background maintenance | No trigger, scheduler or turn counter exists; nothing runs without an active Pi process. | A requirement to synthesize or reorganize experience | #7 maintenance |
| Multi-actor teams and concurrency | Single actor is the assumed v1 scope (research contract section 1, lines 73-75); Manifold owns team authority. | Concurrent writers or independent review | #3 identity; docs/WORKFLOW.md:123-141 |
| Receipt signing / remote attestation | The trust model is a local single-user store; Fabric explicitly excludes a malicious trusted host/provider (docs/verified-kernels.md:306). | A remote or multi-host store, or a claim of tamper-proof receipts | #6 durability |
| Adapter breadth (Occam, Jung, other runtimes) | No interface is observed today; an unavailable adapter must return a named blocker (docs/vision.md:150). | An accepted runtime interface and an owner-approved dependency | P4; AGENTS.md:131-138 |
| Experience records and retrieval | They depend on durable receipts and artifact history that do not exist yet; adding them early would duplicate evidence. | A validated need to reuse outcomes | P7 |
| Derived Markdown/YAML rendering | It is not authoritative; canonical JSON plus digest is enough for G1-P6. | A consumer that cannot read JSON | #5 artifact contract |

**What is not claimed.** V1 does not claim OS isolation, sandbox containment, exactly-once external execution, savings, learning, independent review or compliance (docs/vision.md:238; AGENTS.md:100-103). Broker checks constrain only calls routed through Praxis; an agent with direct shell/Fabric access bypasses them (docs/vision.md:51; AGENTS.md:100-103).

### 6.6 Q5 — What the parent receives

**Answer.** A bounded result with references, not a transcript replay (docs/vision.md:235). The shape below is proposed and follows the vision's illustrative result (docs/vision.md:206-222).

    {
      "schema": "praxis.result/v1",
      "instanceId": "px_...",
      "flow": "architect",
      "status": "completed",
      "summary": "Two-sentence outcome, at most 2000 characters.",
      "artifacts": [
        { "id": "a_...", "version": 1, "path": "docs/.../architecture.json",
          "digest": "sha256:...", "schema": "praxis.artifact.architecture/v1" }
      ],
      "evidenceRefs": ["evt_...", "receipt_..."],
      "nextAction": null
    }

On a non-completed status, the same envelope carries a typed reason (code, message, retryable), currentStep, unmetChecks, and the permitted nextAction; it never fabricates success. praxis.status, praxis.inspect, praxis.resume and praxis.abort are separately authorized operations; inspect is bounded and does not become a transcript endpoint (docs/vision.md:204-222).

**Deliberately omitted.** Internal transcript; tool arguments and raw outputs; step history; the event log; hidden prompts; other instances; accepted artifact bodies (references only); and internal reasoning. The parent can request a bounded inspection with an explicit scope, not by default.

**Caps.** Proposed, not calibrated: summary at most 2000 characters; at most 16 artifacts; at most 32 evidence refs; total envelope at most 8 KiB. These are placeholder bounds to be tested in P6. Existing host bounds are evidence that bounding is normal, not a calibration: Fabric caps output at min(executor.maxOutputChars, maxOutputTokens*4) and 20,000 characters on failure (/media/Development/AI/occam/.dev/pi-fabric-main/src/fabric-exec-tool.ts:938-943); a Fabric handoff summary truncates at 8,000 characters (src/agents/handoff-completion.ts:23-25).

### 6.7 Q6 — The two-phase falsification proof

**Hypothesis.** If Praxis really preserves work outside the agent context, then a fresh phase B, given only the accepted phase-A artifact, can reproduce a value that exists only in that artifact; and B cannot reproduce it when artifact access is removed. Any other result falsifies the handoff or the boundary.

**Setup.**

- A fixture flow with two steps: A (produce) and B (derive). No mutation, no nested runtime, no Fabric adapter.
- The engine generates a 128-bit random nonce at instance creation and injects it only into A's task prompt and the expected A artifact contract (which requires a nonce field). The nonce is not in B's prompt.
- A's loadout: read, grep, find, artifact.write. No shell, no Fabric, no event log. A must write an artifact with nonce, decision, evidenceRefs and rationale, plus a short summary.
- Gate A: schema validation, required evidence paths exist, template digest matches, content digest is stable. The engine records artifact.accepted and a pass verdict.
- B's loadout: artifact.read for the accepted A artifact and artifact.write for its own output. No repository read, no shell, no Fabric, no event log. B's prompt contains the task and the handoff ref, not A's narration or nonce.
- B must write an artifact with nonce, acceptedDecision, derivedFrom and note, where derivedFrom is A's digest. B's artifact is validated by the same gate.

**Procedure.**

1. Create the instance with a fixed request ID and a known actor binding.
2. Run A to completion; record instance.created, step.started, artifact.draft, verdict.recorded(pass), artifact.accepted.
3. Kill the parent process and restart the host; resume the instance from the store. Confirm the accepted artifact digest and current step are unchanged.
4. Start B in a fresh session. Capture B's session ID, tool-call trace, prompt hash and artifact reads.
5. Run B; record artifact.draft, verdict.recorded(pass), instance.completed.
6. Run the negative control on a second instance with the same nonce and A artifact but B's artifact-read capability removed. B must stop with ARTIFACT_UNAVAILABLE or a typed denial and zero writes.
7. Run a third instance with a deliberately corrupted artifact digest; B must stop with ARTIFACT_DIGEST_MISMATCH and zero writes.
8. Run a fourth instance with a B attempt to call a denied tool; the denial must be typed and leave the step blocked with no effect.
9. Inspect the parent result; confirm it contains only the bounded envelope and no transcript, tool arguments or event log.
10. Repeat with the OS-sandbox variant only after gate #1 is accepted; until then the proof is broker-level.

**Assertions.**

| ID | Assertion | If it fails |
| --- | --- | --- |
| P1 | A's artifact digest equals the digest of its canonical bytes | Canonicalisation or write path is unstable |
| P2 | A's accepted verdict exists before B starts | B could consume a draft |
| P3 | B's session ID differs from A's; no shared session ID or transcript handle | The boundary reuses context |
| P4 | B's tool trace contains only artifact read/write; zero read, grep, find, bash, Fabric | The loadout leaks |
| P5 | B's nonce equals the engine nonce and acceptedDecision equals A's decision | B did not consume the artifact |
| P6 | B's derivedFrom equals A's digest | Provenance is not recorded |
| P7 | Negative control: B without artifact access fails with ARTIFACT_UNAVAILABLE, no nonce and no decision | The boundary leaks through another channel |
| P8 | Corrupt-digest control fails with ARTIFACT_DIGEST_MISMATCH, no write | Integrity is not checked |
| P9 | Restart between A and B preserves digest, step and attempt; no duplicate artifact write or effect intent | Durability or idempotency is broken |
| P10 | Conflicting request payload replay is rejected | Idempotency is payload-blind |
| P11 | A denied tool in B yields a typed denial and zero effects | Enforcement is prompt-only |
| P12 | Parent result contains only the whitelisted envelope | Bounded result is not enforced |

**Falsifiers.** The design is falsified if any of these occurs: B returns the nonce or decision while artifact access is removed; B cannot return them while artifact access is present; a schema-valid B artifact with a wrong nonce is accepted; a restart duplicates an artifact write or changes the accepted digest; B's trace shows a non-artifact read; or the parent result contains transcript/event data. These are the conditions under which the proof fails, not a checklist to explain away.

**What this proof does not prove.** It does not prove OS isolation, because B may still have direct shell access unless the host loadout or an OS sandbox blocks it; it does not prove exactly-once external execution; it does not prove that B's semantic decision is correct, only that it was derived from the artifact; and it has not been executed on the installed Pi host. It is the smallest falsifier at P2/P3/P5/P6; P9 repeats it on a real Pi host (docs/vision.md:268-285).

### 6.8 Q7 — Reuse ledger

**Decision rule.** Adopt a facility only when it owns the fact Praxis needs or removes a dependency without creating a second authority. Adapt when the mechanism is useful but the ownership or lifecycle is wrong. Reject when the candidate would create a competing store, unobserved interface or unmaintainable dependency. Cost is coupling plus licence plus lifecycle, not only lines of code (AGENTS.md:67-80, :114-118).

| Candidate | What it provides (evidence) | Decision | Cost and consequence |
| --- | --- | --- | --- |
| Pi core tools (read, grep, find, ls, edit, bash) | Host tools with schemas and risk classes; the only direct execution surface the agent already has | **Adopt** as broker actions for the read-only flow | Coupling: host tool schemas and behaviour; licence: host dependency, not vendored; lifecycle: Pi 1.4.0 installed. Direct access bypasses the broker, so no containment claim (docs/vision.md:51). |
| Fabric fabric_exec plus provider registry and agents runner | Isolated QuickJS guest, provider dispatch, budgets, terminal agent results, structured output validation (02-kernel-runtime.md:152-268; 03-agents-providers.md:90-140, :431-511) | **Adapt** behind a Praxis adapter for agent-step execution and observation | Coupling: pi-fabric 0.123.0, host extension, run files; licence MIT (Fabric package.json:108); lifecycle tied to Fabric and Pi SDK. It is not a workflow store and has no restart recovery (01-construction.md:448-449, :512-513). |
| Fabric state.* provider | Labeled world model, append-only proposals, CAS head, evidence and certificates (03-agents-providers.md:298-318) | **Reject as the Praxis store** | It is a single-head world model over a mesh topic, not multi-instance workflow with effect intents/receipts. Coupling high; competing authority (docs/vision.md:152). |
| Fabric schema.* provider | Host-owned hypothesis/verify/commit with certificates and bounded file transactions (03-agents-providers.md:320-341) | **Reject for v1; revisit for artifact commit** | It commits workspace files, not workflow steps; no formal rollback or crash durability (04-config-security.md:448-462). Coupling high, benefit duplicate. |
| Fabric compact.* provider | Host session compaction intent and carry list (03-agents-providers.md:342-361) | **Reject as artifact memory** | It compacts the parent session; it is not a durable artifact or evidence store. No coupling needed. |
| Manifold | Assignment authority, reporter/assigner separation, claims, feature revisions, SQLite WAL (src/storage/schema.ts:39-58; assignments.ts:72-76, :130-220; database.ts:67-69) | **Adapt as a read-only assignment reference and a verdict-separation precedent; reject as a store or dependency** | No LICENSE file at package root and private true (Manifold package.json:1-5); NATS dependency; assignment facts must remain Manifold's (AGENTS.md:88-90). Coupling high if Praxis reads its tables directly; use the Manifold tool. |
| node:sqlite (DatabaseSync) | Built-in SQLite binding; WAL and synchronous=FULL used by Manifold (database.ts:67-69, :106-112) | **Adopt** as the store engine | No added dependency; Node 24.9 required; the API prints an ExperimentalWarning in the executed probe (see section 6.11). Lifecycle risk: pin Node and test upgrades. |
| node:crypto SHA-256 | Built-in digest and hashing | **Adopt** for artifact/definition digests | No added dependency; standard library lifecycle. |
| Zod 4.6.7 | Runtime schema validation with inferred types | **Adopt** for contract schemas | Already present in the current Praxis package.json (inherited residue), so adopting it adds no install; MIT (node_modules/zod/package.json:5); keep types/schemas separate from behaviour per docs/WORKFLOW.md:161-191. |
| jev-fabric 0.8.1 | Typed decisions, explicit budgets, receipts, durable jobs, bounded observations (docs/decisions.md, docs/composition.md) | **Reject as a runtime dependency; adapt concepts** | MIT (jev-fabric package.json:7), private package, native Bend binary and toolchain; explicitly no restart recovery, replay, rollback or exactly-once (docs/architecture.md:96-99). Not a workflow store. |
| jev-search 0.1.0 | Web search UI and Search1API integration (README.md) | **Reject** | MIT (jev-search package.json:50), private, a web application, not a runtime facility; no fit for Q1-Q6. |
| @earendil-works/pi-durable plus @earendil-works/chord | Durable harness, JSONL storage, conversation/submission types used by Fabric's durable worker (01-construction.md:448-449, :512-513) | **Reject for v1; untested** | Pinned SDK 1.3.0, JSONL adapter, host-coupled; would be a second store. Revisit only if the Pi host seam requires it. |
| Occam | Reasoning/evidence authority; not installed; to be redone | **Reject as a dependency** | No observed interface; a named blocker is required, never a fabricated adapter (AGENTS.md:131-138). |
| Jung | Collective synthesis; does not exist | **Reject** | Named blocker; no interface assumed. |
| pi-fovea and pi-contour | Context/review aids; contour_review is a structural aid | **Reject for v1** | Not authority, not independence, not acceptance (docs/WORKFLOW.md:83-106). |

**Resulting dependency posture (proposed).** V1 adds no runtime dependency beyond what the host already supplies: Pi tools at the boundary, Node built-ins (node:sqlite, node:crypto), and the already-present Zod. Fabric and Manifold are host/adapter authorities reached through tools, not vendored code. Any new dependency still needs the owner's purpose/version/licence/impact inspection (AGENTS.md:114-118).

### 6.9 Phase table

Rework cost is qualitative: **low** means a phase-local fix; **medium** means one adjacent phase reworked; **high** means the instance/authority/artifact model or the proof is re-cut. Costs are inference, not measured.

| Phase | Goal | Artifact | Acceptance proof | Exclusions | Blocking gates | Rework cost |
| --- | --- | --- | --- | --- | --- | --- |
| **P0 Contracts** | Freeze strict config/profile/flow/step/artifact/result schemas and a typed error taxonomy | src/types/*, schema fixtures, error catalogue | Invalid keys, bad refs, cycles, unknown predicates and permission escalation are rejected with typed reasons; valid fixtures round-trip; no runtime is started | No store, engine, adapter or host code | #5 artifact contract; #6 durability record shape | **High** — every later phase consumes these names and records |
| **P1 Authority** | Trusted actor binding, policy intersection, capability registry | src/types/policy.ts, src/authority/*, tests | Denied flow/tool causes zero effects; unknown names invalid; child cannot expand rights; missing/stale state fails closed | No OS sandbox claim; no Manifold activation; no durable engine | #3 trusted identity; #1 isolation for any containment claim; #2 Pi host seam | **High** — all steps and adapters depend on the ceiling model |
| **P2 Durable engine** | Instance state machine, append-only events, intents, receipts, idempotency, crash recovery | src/store/*, src/types/instance.ts, migration fixtures | Kill/restart at each transition resumes the correct step; uncertain effect is not retried; duplicate request replays; conflicting payload rejects; WAL and synchronous=FULL verified | No step runner, artifact engine, adapters or maintenance | #6 durability; #2 Pi host seam; #3 identity | **High** — a wrong store model re-cuts resume and every receipt |
| **P3 Step runner** | Typed dataflow, predicate registry, step transitions, budgets | src/runner/*, src/types/step.ts, predicate fixtures | Step B consumes A's accepted output by reference; a failed check blocks; a no-go preserves state; budget exhaustion is typed; no unbounded retry | No nested runtimes; no flow expansion; no rendering | #8 nested execution if any; #4 flow expansion if dynamic; #5 artifact handoff shape | **Medium-high** — a wrong predicate model reaches P5/P6 |
| **P5 Artifact engine** | Template validation, canonical persistence, digest/versioning, derived rendering | src/artifacts/*, src/types/artifact.ts, canonical fixtures | Invalid artifact cannot complete; digest stable across key order/format; versions immutable; rendering is derived; accepted bytes never overwritten | No review UI; no cross-project sync; no Occam/Jung | #5 artifact contract | **Medium-high** — a canonicalisation error forces a version migration |
| **P6 Pi integration** | Out-of-context host execution and compact parent result; status/inspect/resume/abort | src/host/*, src/types/result.ts, host harness | Parent sees no internal trace; result is bounded; status/inspect/resume work; restart works; negative permission is denied before effect | No undocumented Fabric internals; no OS sandbox claim; no transcript replay | #2 Pi host seam; #3 identity; #1 isolation for claims | **Medium** — the host seam may change; the model need not |
| **P4 Adapters** | Pi tool broker; gated Fabric/Occam adapters as the broker stabilizes | src/adapters/*, adapter contract tests | Input/output validated; side-effect class declared; unavailable adapter blocks with a named reason; nested budget enforced | No adapter before the broker; no Occam interface assumption; no implicit lifecycle import | #1 isolation; #8 nested execution; #3 identity | **Low** — adapter-local, provided the broker contract is honest |
| **P7 Experience** | Durable execution lessons and retrieval | Experience records and retrieval fixtures | Outcomes trace to receipts; stale refs excluded; history is not mutated | No Occam replacement; no cross-project synthesis | #6 durability and retention | **Low** — dependent on P2/P5 records |
| **P8 Maintenance** | Bounded background synthesis with reversible interpretations | Maintenance flow, budget/cooldown, provenance | Original evidence unchanged; budget enforced; every interpretation change is auditable and reversible | No self-granted capabilities; no interruption of active steps; no trigger without explicit design | #7 maintenance; #6 durability | **Medium** — the trigger and retention model may change |
| **P9 Live acceptance** | Real Pi host run of the architect flow, restart and negative permissions | Live acceptance report, artifacts, receipts | Real Pi run completes a validated artifact; restart resumes; unauthorized operation is blocked; parent result is bounded; no fabricated claim | No synthetic-only proof; no green unit suite as acceptance; no mutation or nesting | All relevant gates; #1 only for claims actually made | **High** — catches integration assumptions the unit suite cannot |

**Sequencing.** P0 to P1 to P2 to P3 to P5 to P6 is the critical path; P4 is inserted only when the broker contract is stable and never ahead of P1/P2/P3; P7 follows P2/P5 evidence; P8 follows P7; P9 is last. This preserves docs/vision.md:255 and AGENTS.md:125-129. P2 may be split internally into P2a (store/events) and P2b (intents/receipts/recovery), but both must pass before P3. The only enabled flow until P9 is the read-only architect flow; mutations, nested runtimes, flow expansion and background maintenance remain disabled (docs/vision.md:255; AGENTS.md:128-129).

### 6.10 Rejected orderings and store choice

| Rejected ordering | Why it is tempting | Constraint that rejects it | Evidence | Verdict |
| --- | --- | --- | --- | --- |
| Store/schema first, then contracts and authority | A database makes the design feel concrete | One owner per fact and fail-closed authority must be fixed before records are chosen; otherwise the schema encodes guesses and every migration is a re-cut | docs/vision.md:240-255; AGENTS.md:88-99, :125-129 | Reject |
| P3 step runner before P2 durable engine | The runner is the visible product; persistence feels like plumbing | The P2 acceptance is crash/restart and no blind replay; a runner without intents/receipts cannot prove either, so its success is only a tool-call sequence | docs/vision.md:139-142, :155-167; docs/WORKFLOW.md:57-81 | Reject |
| P4 adapters before P1/P2 | Fabric/Pi integration looks like the shortest path to a demo | Adapter side-effect classes, cancellation and receipts need the broker and intent model; otherwise the adapter contract is guessed and later breaks the ceiling | docs/vision.md:146-150; AGENTS.md:100-107 | Reject |
| P6 Pi integration before P2/P3/P5 | A compact parent result looks like the goal | The result must describe an instance, step and accepted artifact; without them it is just another tool output and cannot prove resume, acceptance or boundedness | docs/vision.md:204-222, :235; Fabric result shape src/agents/types.ts:184-186, :214-216 | Reject |
| P5 artifact engine before P3 | Canonical JSON and digests are self-contained | A handoff format needs a validated step output and a gate consumer; building it first risks a canonicalisation with no real consumer and a forced migration | docs/vision.md:146, :186 | Reject |
| P9 end-to-end spike first | It would produce a visible demo and prove the idea | A live run without authority, durability and acceptance proves tool calls, not the runtime; the first slice must still be read-only and the unit suite is not acceptance | docs/vision.md:268-285; docs/WORKFLOW.md:208-213 | Reject |
| Build the full generic engine before the architect flow | Generality feels safer than a concrete vertical slice | Every additional abstraction must be bound to a requirement; speculative generality is the failure mode the programme is meant to avoid | docs/WORKFLOW.md:123-141; AGENTS.md:149-155 | Reject |
| Use Manifold or Fabric state.* as the Praxis store | Both already persist state and have working code | One authoritative owner per fact; assignment authority and work-instance state are different facts, and a second copy makes recovery and audit ambiguous | AGENTS.md:88-90; docs/vision.md:152 | Reject |

### 6.11 Contradictions, limits and untested items

**Process contradiction — Manifold is active here.** docs/WORKFLOW.md:141 says "Manifold is **inactive**"; AGENTS.md:35 says the same for the 2026-10-29 research-squad unit, while AGENTS.md:37-42 records only the declaration and says activation is a separate owner action. In this session Manifold is active: manifold now reports team 3859f326-7f61-40de-87c8-7268ea783abd (vision-phases) with five agents and this assignment. Source-inspected in the manifold now output; the ledger contains no activation entry. I did not activate it, did not change its config, and only read the inbox/room and will report/ACK. This discrepancy is reported to the lead; it does not authorize independent review, because no reviewer assignment exists and docs/WORKFLOW.md:99 still requires independence: self until an independent session exists.

**Missing teammate findings.** The reading plan assigned four slices (research.md section 3), but only main-researcher has an assignment; the team room is empty (0 items at read time) and org.assignments returns only 715d6fe8-ea90-45b1-b648-3f462b554d87. I therefore read the assigned Fabric notes and jev docs directly rather than invent teammate reports. The lack of independent challenge is a real limit on this research and is labelled untested.

**No execution of the proposed runtime.** No src/ file, store, flow, adapter or schema was created (src/ is an empty directory at read time). The only executed probe was a temporary /tmp check; it created no repository state. Executed evidence is limited to that probe: node --version returned v24.9.0; node:sqlite DatabaseSync created a STRICT table in a temp file, PRAGMA journal_mode=WAL returned wal, BEGIN IMMEDIATE inserted a row, and sorted-key SHA-256 digests of two key orders were equal (c461c47a...). Node printed ExperimentalWarning: SQLite is an experimental feature and might change at any time. The probe file and its WAL/SHM sidecars were removed. It did not test crash recovery, synchronous=FULL under power loss, multi-process contention or migration.

**Host seam untested.** The installed Pi host is @earendil-works/pi-coding-agent 1.4.0 (global package metadata), while the Fabric research notes were written against 1.3.0 (02-kernel-runtime.md header). No live out-of-context invocation, restart, cancellation or transcript-boundary test was run on 1.4.0. Gate #2 remains open; no undocumented Fabric internals may be assumed (docs/vision.md:257-266).

**Untested / unresolved by gate.**

| Item | State | What would resolve it | Gate |
| --- | --- | --- | --- |
| OS isolation and alternate tool paths | untested; broker-only is the current enforceable claim | An OS-sandbox integration test that blocks direct shell/Fabric paths, or an explicit decision to keep the read-only flow and never claim containment | #1 |
| Pi host seam on 1.4.0 | untested | A live child run with cancellation, restart and bounded result capture | #2 |
| Trusted identity without Manifold | untested | A host binding test with a forged request field and a denied instance | #3 |
| Flow expansion authority and active migration | untested | An owner decision plus a migration/fixture set; currently no API exists | #4 |
| Artifact schema dialect, Unicode/number canonicalisation, duplicate keys | proposed; sorted-key rule is adapted, not standardised | A fixture suite against the chosen dialect and a byte-stability test | #5 |
| Store root, migration, retention, backup, crash consistency | proposed; WAL and temp probe only | A crash-injection test, migration fixtures, retention policy and backup/restore drill | #6 |
| Maintenance trigger and budget | untested; no trigger exists | A bounded trigger design that works without an active Pi process | #7 |
| Nested depth, cycles, shared budgets, cancellation | untested; depth fixed at 0 | A nested-run test with cycle and budget assertions, only after #8 is decided | #8 |
| Single-actor acceptance | untested; three options listed in section 6.3 | Owner choice of owner-acceptance, Manifold reviewer or deterministic-only gates | #3 / G6 |
| Independent review | untested; room empty, no reviewer assignment | A separate session with a reviewer identity and its own review of this file | docs/WORKFLOW.md:99 |
| Rework costs | inference, qualitative | Measured after each phase's first real attempt | — |
| Licence/legal review | source-inspected metadata only; Manifold has no licence file | Owner/legal review before any vendoring; no code is copied now | AGENTS.md:114-118 |

**Housekeeping discrepancy.** AGENTS.md:61 says .gitignore carries .pi/manifold/*; the actual .gitignore has .pi/fabric, .pi/npm/, *.sqlite, *.sqlite-wal, *.sqlite-shm, .dev and .env, but no .pi/manifold/* (source-inspected .gitignore:1-19). The broad *.sqlite* rules would cover the proposed database files, but there is no explicit .pi/praxis/ root rule. This is a housekeeping mismatch to reconcile in the store-authorization unit, not a research decision (AGENTS.md:56-65, :170-180).

**Citation shorthand.** In the tables above, assignments.ts, schema.ts, database.ts, policy.ts and store.ts refer to .pi/git/github.com/tia-lab/manifold/src/ (with storage/org/ for assignments.ts); 01-construction.md through 04-config-security.md refer to .dev/references/fabric-research/; Fabric source paths without a prefix refer to /media/Development/AI/occam/.dev/pi-fabric-main/. The full path is given at first use in each section.

### 6.12 G1 readiness

| Acceptance item from section 0 and section 2 | Where answered | Status |
| --- | --- | --- |
| Q1 instance facts, states, pinned at creation | section 6.2 | Answered with source-inspected prior art and proposed fields |
| Q2 transition, predicate, verdict writer, no-go residue | section 6.3 | Answered as a guarded state machine; single-actor acceptance remains open |
| Q3 canonicalisation, digest, versioning, handoff trace, what phase 2 cannot see | section 6.4 | Answered; canonicalisation fixtures and host enforcement remain untested |
| Q4 v1 enforcement versus deferral, with reasons | section 6.5 | Answered; gate #1/#2/#3 remain open for the claims they govern |
| Q5 bounded parent result and omissions | section 6.6 | Answered with proposed caps |
| Q6 two-phase falsification proof | section 6.7 | Answered so it can fail; not executed |
| Q7 reuse ledger with adopt/adapt/reject and cost | section 6.8 | Answered; licence/legal review and owner dependency approval remain |
| Every phase row carries goal, artifact, acceptance proof, exclusions, blocking gates, rework cost | section 6.9 | Complete for P0-P9 |
| At least one rejected ordering with its discriminating constraint | section 6.10 | Eight rejected alternatives (seven orderings and one store choice) |
| Two-phase proof stated so it can fail | section 6.7 | Falsifiers and negative controls stated |
| Reuse ledger entries | section 6.8 | Fifteen candidates |
| Unresolved items labelled untested | section 6.11 | Listed with the gate that would resolve each |

**Status.** This is research, not a spec or plan. No implementation, src/ write, dependency addition, store creation, flow enablement or Manifold configuration change was performed. G1 review has not been recorded; the owner has not accepted this artifact. A G1 reviewer should check the citations and the falsifiers, not the prose. If G1 passes, G2 may start from sections 6.2-6.5 and the P0/P1 requirements; if it fails, amend this file and record a new attempt (docs/WORKFLOW.md:57-81, :83-106).

## 7. Process record (lead-owned)

- Team `vision-phases` (`3859f326-7f61-40de-87c8-7268ea783abd`) ran with four launched
  seats. Assignments `cb89ea19` (researcher-1) and `a7f30cc0` (researcher-2) reached
  `reported` with substantive reports and were then **failed by the lead** solely
  because blueprint defect MAN-1 makes finalize unsatisfiable (the hub converger is not
  the assigner; see /home/tia/_DEV/AI/manifold/.dev/ISSUES.md). Their reports remain in
  room `a03032ac` as messages 77803f04, a537ce18, e6f6984d, bc4f1a0d.
- Assignment `8d92bf73` (researcher-3, jev slice, room message 789a862d) and
  `715d6fe8` (main-researcher, this synthesis) were closed the same way at team
  retirement, each with its delivered evidence named in the fail reason.
- The hub reported that the room appeared empty at its read time and that
  `org.assignments` showed only its own assignment, so it read the Fabric and jev
  sources itself instead of consuming teammate reports. Consequence, stated honestly
  in §6.11: this research is **single-authored**, and the four-seat independent
  challenge did not occur.
- Blueprint correction queued: `convergerRole` main-researcher → lead, then an owner
  rebind at the reconciled boundary. Filed as MAN-1.

## 8. G1 review (independence: self)

Reviewed against the §0 acceptance. Q1–Q7 are answered with source-inspected or executed
evidence and labelled inferences; the phase table carries all six required columns for
P0–P9; seven orderings are rejected with the constraint that rejects each; the two-phase
proof states twelve assertions and its own falsifiers; the reuse ledger decides
adopt/adapt/reject with cost per candidate. Verdict: **PASS for G1**, with the limitations
it names — no independent review, host seam untested on 1.4.0, canonical JSON rules
proposed rather than fixtured. Owner acceptance (G6) remains outstanding.






