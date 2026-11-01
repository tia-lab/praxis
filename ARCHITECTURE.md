# Praxis — architecture

This document is the authoritative technical state of Praxis. It MUST be updated whenever the architecture changes.

Verified against HEAD a61a279 (2026-11-01), the commit that ships flow Unit 2 Slice A, plus the working
tree of that date (only AGENTS.md and docs/FLOWS.md were dirty, both by the lead). Evidence labels
throughout: **[code]** = read in the source at the cited path; **[doc]** = read in a document at the cited
path; **[executed]** = observed by running a command in this session. Nothing here is inferred from a
conversation or a summary.

[executed] At the time of writing: npm run check (tsc --noEmit) exits 0, and node --test over
tests/**/*.test.ts reports 450 tests, 450 pass, 0 fail (92 test files). src/ is 64 TypeScript files, 12,864
lines; the largest is src/pi/operations.ts at 589 lines, so no file is at or over the 600-line cap (AGENTS.md
§3) and the tightest headroom left is 11 lines.

What this document does NOT claim: no isolation, no sandbox, no trusted identity, no exactly-once external
execution. Those are open gates (§9.5) and the code says so at every seam cited here.

## 1. Layer split

Praxis is the **molecule** of a four-layer system: **Manifold assigns** (which team, which seat, which work),
**Occam reasons** (cognition, judgment quality), **Praxis executes and preserves work** (durable instances,
gated steps, validated artifacts, the record), **Jung synthesizes** (cross-project experience). Praxis owns
the boundaries and the continuity of work; the agent owns the choices inside them. It never becomes a
reasoning engine, a team manager or a federated memory authority, and it never holds a fact another layer
owns: assignments belong to Manifold (the role map Praxis pins is a copy of a start-time input, not an
authority), cognition belongs to Occam, and cross-project synthesis belongs to Jung. The one seam that makes
this real in code today is src/runner/identity.ts:8-14 — roleAssignment() is the ONLY reader of the
role-to-actor source, so a Manifold-backed build swaps one function body and nothing else. [code]

## 2. Module map

src/ (64 files, 12,864 lines). Every module below was opened; the responsibility line summarises its own
header and its exported surface.

### src/types/ — declared contracts, no runtime behaviour

| File | Lines | Responsibility |
| --- | --- | --- |
| src/types/schema.ts | 358 | The closed task/instance/artifact/result/event contracts, after flow Unit 1 moved the flow-document block into flow.ts: CapabilitySchema:32, GateSchema:36, TaskConfigSchema:246, InstanceStatusSchema:283 (running/completed/failed/**waiting**), InstanceSchema:290, EventTypeSchema:51, ResultSchema:339 (six keys). Re-exports the rubric, rule and flow shapes. |
| src/types/flow.ts | 389 | The flow document, moved out of schema.ts by Unit 1 to hold the 600-line cap and extended by both flow units: DecideSchema:68 (2-8 branch options), WaitSchema:90 (on.type, on.match of at most WAIT_MATCH_MAX 8 fields, timeoutMs 1000-2592000000), NodeSchema:106 (id, task, optional domains/decide/wait), EdgeKindSchema:119 (**data/join/branch/refuse**), EdgeSchema:130 (a label present iff the kind is branch), FlowConfigSchema:161 with its one superRefine:174 (ordering, the branch fan-out exemption, the merge-slot count, and the refusal of a refuse edge into a wait node at :217-223), ResolvedNode:342, NODE_KEYS:363 (id/task/domains/decide/wait), parseFlowConfig:376. |
| src/types/quality.ts | 172 | The rubric: QualitySchema, QualityDimensionSchema:98 (id, statement, probes, quantileGate, deprecated floor:118), ProbeSchema:31 (choice/noul/score, sections, rule citation), PROBES_PER_DIMENSION 6 / PROBES_TOTAL 48. threshold:127 and paretoThreshold are parsed and IGNORED. |
| src/types/pi.ts | 471 | The tool contract: PraxisToolOpSchema:21 (start, submit, read, note, check, recall), PraxisToolArgsSchema:31, and one strict envelope per op (Start, Step, Read, Note, Check, Recall). **The op set did not change for Units 1-2**: branch and wait add no tool op — wait's host surface is the CLI (§8), because operations.ts is at the cap. |
| src/types/learning.ts | 287 | Append-only learning payloads: LearningNoteSchema:51, BarRaisedSchema:97, RubricSampledSchema:167, BarContestedSchema:187, RecallNote/RecallSet, RecallRanked. |
| src/types/profile.ts | 89 | The locked profile schema and PROFILE_LAYERS (conduct/role/domain), PinnedProfile, ComposedDomains. |
| src/types/rules.ts | 99 | Rule-set documents and RuleRef (file ref or id subset). |
| src/types/hooks.ts | 147 | The eight hook names (before_/after_ x start/check/submit/note) and their payload types. |
| src/types/errors.ts | 98 | The ONE closed Code union (:21-62, **38 codes**) plus AppError, fail, isAppError, asAppError. The four flow-control codes ROUTE_UNAVAILABLE:56, ROUTE_INVALID:58, WAIT_TIMEOUT:60 and WAIT_EVENT_INVALID:62 were added by Units 1-2; the pi.ts mirror is compile-checked and TAXONOMY_SIZE (tests/types/errors.test.ts:48) is 38. |
| src/types/project.ts | 38 | praxis.project/v1: defaults.maxAttempts, defaults.storeDir, defaults.role. |
| src/types/active.ts | 36 | The active-step snapshot shape the host reads (ACTIVE_FILE, ActiveSnapshotSchema). |
| src/types/paths.ts | 21 | The shared reference grammar: KEBAB:14, pathUnder():17 for tasks/flows/rules. |
| src/types/issue.ts | 64 | The issue-report document and its config. |

### src/store/ — the durable store, and the only SQL in the project

| File | Lines | Responsibility |
| --- | --- | --- |
| src/store/db.ts | 171 | STORE_SCHEMA = praxis.store/v2 (:17); the five tables and two append-only triggers (:19-76); WAL, synchronous=FULL, busy_timeout 5000 (:150-153); openStore:124; transact:103. |
| src/store/instance.ts | 204 | insertInstance, createInstance, loadInstance, setStatus with revision expectations, and TRANSITIONS:46-51 — the closed move table: running -> completed/failed/waiting, waiting -> running/failed, both terminal states terminal. The instance row is current state; failedReason and the park in force are DERIVED on read. |
| src/store/events.ts | 93 | appendEvent:39 (monotone seq per instance) and listEvents:65. The log is the fact store. |
| src/store/artifacts.ts | 236 | recordArtifact:148 (digest-verified bytes, pending only), readArtifact:196, acceptArtifact:215. |
| src/store/definitions.ts | 167 | The per-instance pins: DefinitionKindSchema:32 (flow/task/assignment/ruleset/profile), insertDefinition:85, readDefinition:106, publicationOf/publication rows keyed (task, version). |

### src/runner/ — the engine and its supporting seams

| File | Lines | Responsibility |
| --- | --- | --- |
| src/runner/engine/index.ts | 31 | Export-only surface; every importer uses this one path. Unit 2 added `export { arriveAt, deadlineOf, matchEvent, resume, waitTypeOf } from "./wait.ts"` (:29). |
| src/runner/engine/start.ts | 136 | start(): create or re-open the instance a request id names, pin flow + task versions + rules + profiles + role map in one transaction (:54 re-open, :129 create). A first node that declares `wait` parks the new instance through arriveAt (:132), so a triggered flow can begin already parked. |
| src/runner/engine/advance.ts | 397 | advance(): exactly one node per call — observe, note-closure gate, run step, deterministic gate, quality decision, accept/refuse/onFailure, successor, snapshot. The successor move goes through arriveAt (:389), so arriving at a `wait` node parks instead of running it; a parked instance is refused at the status guard, not advanced. |
| src/runner/engine/wait.ts | 214 | **Flow Unit 2's park/resume.** deadlineOf:56 (an ISO deadline from the injected clock), matchEvent:68 (deterministic equality over the declared fields only), arriveAt:99 (park or move, idempotent on a crash between the two), waitTypeOf:129, resume:138 (authority -> status -> park in force -> lazy deadline -> match -> receipt dedupe -> one `wait.resumed` receipt -> running at the same step). No table, no timer, no ambient clock. |
| src/runner/engine/flow.ts | 295 | openFlow:115 (read + validate + resolve tasks/rules/profiles), instanceIdFor:188, currentHandoffs:210 (now includes branch edges), loadPinnedFlow:229 (read the pins back). |
| src/runner/engine/rules.ts | 203 | authoredQuality, judgeQuality and resolveRules: the AUTHORED rubric keys the bars, the COMPOSED rubric feeds the judge and the brief. |
| src/runner/engine/quality-loop.ts | 331 | failureOutcome:177 (attempt budget, no-progress, escalate vs continue), recordAcceptance:282, qualityHistory:33, withFailedReason:87. |
| src/runner/engine/profile.ts | 122 | loadProfileLayer:37 (any layer), loadProfile:68 (domain), resolveDomains:90, composeDomains:103. |
| src/runner/engine/prompt.ts | 131 | The PURE composer composeSystemPrompt:97 and isComposedPrompt:129; PROMPT_MARKER_PREFIX:17, PROMPT_ADVISORY:20. No I/O. |
| src/runner/engine/active.ts | 91 | The derived hint the host reads: writeActiveStep:30, readActiveStep:44, snapshotActive:58, activePath:22. |
| src/runner/engine/authority.ts | 77 | assertObserver:36 and assertStepActor:48 — the ownership and role checks on every op. |
| src/runner/engine/inspect.ts | 49 | inspect:17 (instance + result + pinned flow + handoffs + quality history; it now also passes the parked event type so a waiting instance's result can say `wait: <type>`) and readStepArtifact. |
| src/runner/engine/types.ts | 265 | EVENT (**19 names**, :9-35 — incl. branchDecided:31, instanceParked:33, waitResumed:35) and every engine constant (§6, §8), plus EngineOptions/StartOptions/AdvanceOptions/ResumeOptions and the OpenedFlow shape. |
| src/runner/engine/support.ts | 166 | Path resolution (storeDirOf, tasksDirOf, rulesDirOf, profileDirOf), projectConfig, withStore, nonceFor, stamp, orderOf/orderFor, branchDecisionFor (the recorded-route read the branch seam uses), pinnedJson. |
| src/runner/step.ts | 407 | runStep:154 (the artifact body under its grant), gate:298 (the deterministic gate), buildHandoffs:103, successorOf:85 — now `(config, nodeId, label?)`, so a `decide` node routes on its recorded label and refuses ROUTE_INVALID without one. |
| src/runner/note-gate.ts | 373 | The learning note: noteObjective:56 (derived), noteGate:102 (adequacy), recordNote:293, writeStubNote:249, finishInstance:268. |
| src/runner/result.ts | 73 | buildResult:58 — exactly six keys (RESULT_FIELDS:16), validated by ResultSchema before it leaves. nextActionFor:36 gained the `waiting` arm (:40, `wait: <event type>`), so a parked instance tells its parent to WAIT rather than resume. |
| src/runner/canonical.ts | 139 | Canonical JSON and digest (canonicalBytes:117, digest:122, digestOf:128); refusals are typed, never coercions. |
| src/runner/requirements.ts | 173 | missingFor:17 — the deterministic section validator behind gate "section-requirements". |
| src/runner/capabilities.ts | 84 | The closed capability registry and the per-step Grant; a denial is thrown before the body runs. |
| src/runner/identity.ts | 35 | roleAssignment() — the one reader of the role-to-actor map (see §1). |
| src/runner/hooks.ts | 140 | The hooks registry: registerHook:42, dispatchBefore:84, dispatchAfter:102, beforeOp/afterOp. A hook may subtract or observe, never widen. |
| src/runner/task.ts | 34 | canonicalBlock/hash8/taskFolder — the three-line task contract hash (docs/WORKFLOW.md). |
| src/runner/issues.ts | 124 | File-backed issue reporting (openIssue:75). |

### src/quality/ — judgment, bars, recall

| File | Lines | Responsibility |
| --- | --- | --- |
| src/quality/evaluate.ts | 376 | The Scorer port, evaluateArtifact, and advanceEvaluated:326 — the score is computed OUTSIDE any transaction, then handed to advance(). |
| src/quality/jev-scorer.ts | 351 | The live pi-jev adapter: one noul per dimension (JUDGE:31), the explain-only probe battery, RATIONALE_MAX 240, DIVERGENCE_MIN 0.2. Unit 1 extracted the one `choice` question literal into choiceQuestion:122 so the branch router reuses it instead of owning a second copy. |
| src/quality/jev-branch.ts | 141 | **Flow Unit 1's route router.** The RouteRouter port (:51), RouteInput/RouteAnswer, jevRouteRouter:87 (ONE `choice` question over the node's authored criteria, built by choiceQuestion) and a strict label read. Fail-CLOSED: an unavailable judge is ROUTE_UNAVAILABLE and an undeclared label is ROUTE_INVALID — the opposite of the alignment gate's proceed-with-a-flag. |
| src/quality/bar.ts | 453 | The ratchet: raiseTarget:179, supported:166, recomputeBar:333, perDimensionDecision:347, carriedObservations, plus the quantile math. |
| src/quality/scope.ts | 207 | The read layer: scanEvents, dimensionKey/compositionKey, raisesFor, barAt/flooredBar, quantileBars, sampleFor. A MOVE out of bar.ts; bar.ts re-exports it. |
| src/quality/sample.ts | 183 | The S3 rubric sampler: repeat-N agreement before a first raise (sampleIfDue:133, recordRubricSample:116). |
| src/quality/recall.ts | 377 | Deterministic recall and the lesson: RECALL_WEIGHTS:24, RECALL_MAX:32, RECALL_TOKEN_BUDGET:34, weakSetFor, scoreCandidate, recallExperience. |
| src/quality/ranker.ts | 488 | The bounded experience query: collectCases, deterministicRanker, applyBounds; JEV_POOL 20, JEV_CLIP 240, DUPLICATE_JACCARD 0.8, SINGLE_FLIGHT_WAIT_MS 250. |
| src/quality/ranker-jev.ts | 481 | Stage 2: recallRanked:338 — one pi-jev evaluate over the pool, a persisted recall.ranked cache keyed (task, taskVersion, cover, watermark), single-flight, deterministic fallback. |
| src/quality/screen.ts | 89 | The code-owned screen on lesson text before it reaches a parent (SCREEN_FAIL 0.5, WITHHELD_NOTE). |
| src/quality/jev-align.ts | 229 | The order-alignment judge used by op=start. |
| src/quality/metrics.ts | 412 | A READ-ONLY projection over the log (no table, no view). Imported by src/cli.ts and its test only — never by the gate (§9.4). |
| src/quality/index.ts | 102 | The barrel; the one import surface for the tool and the CLI. It now also re-exports the branch router. |

### src/pi/ — the Pi host surface

| File | Lines | Responsibility |
| --- | --- | --- |
| src/pi/tool.ts | 115 | The tool identity (PRAXIS_TOOL_NAME:33), the JSON argument schema, the args parse and the dispatcher executePraxisTool:75. Op handlers live elsewhere; imports are re-exported so no path moved. |
| src/pi/operations.ts | 589 | The eight handlers: startOperation:177, submitOperation:372, noteOperation:466, checkOperation:502, recallOperation:520, readOperation:536, issueOperation:561, plus engineOptions:71/actorFor:110, ok/failure and the test seams. Unit 1's route seam lives here; Unit 2 added nothing, because the file is at the cap (§9.4) and wait's host surface is the CLI. |
| src/pi/descriptor.ts | 307 | The derived step view: currentStepOf:23, learningView:118, stepDescriptor:203 (the brief), artifactSummary:292. Nothing here is stored. |
| src/pi/extension.ts | 26 | The Pi entry point: registerTool(withFooter(...)):23 and pi.on("before_agent_start", hook):25. |
| src/pi/prompt-hook.ts | 145 | createPromptHook:103 — reads the role, the two fixed profiles and the active snapshot, composes, and returns { systemPrompt }. Fail-closed and marker-guarded. |
| src/pi/host.ts | 118 | The type-only mirror of the Pi host surface (PiToolResult, PiSessionContext, BeforeAgentStartEvent:69, PiHost:86, PiFooterUi). No runtime import. |
| src/pi/footer.ts | 137 | The display-only status element: nextFooterState:41, publishFooter:84, withFooter:107. |
| src/pi/feedback.ts | 92 | qualityFeedback:23 — a quality refusal rendered as the verdict, the rubric's statements, the bars in force and one lesson. |

## 3. Data model

One SQLite file per store root: <storeDir>/praxis.sqlite [code src/runner/engine/support.ts:85-93] Schema
identity praxis.store/v2 is pinned in meta and a mismatch refuses the store [code src/store/db.ts:17,155-160].
Pragmas: journal_mode WAL, synchronous FULL, busy_timeout 5000 [code src/store/db.ts:150-153].

Tables [code src/store/db.ts:19-70]:

- meta(key, value) — the schema identity.
- instance(id, flow, actor, status, current_step, revision, nonce, created_at, updated_at) — CURRENT state only.
- event(instance, seq, type, payload JSON text, at, PRIMARY KEY(instance, seq)) — the fact log. Two triggers
  abort any UPDATE or DELETE [code src/store/db.ts:73-76], so history is append-only in the database itself.
- artifact(instance, step, version, path, digest, schema, state, derived_from, at) — one row per recorded
  version; the BYTES live beside it at <storeDir>/artifacts/<instance>/<step>/v<N>.json and are digest-checked
  on record and on read [code src/store/artifacts.ts:159-176,196-214].
- definition(instance, kind, id, digest, bytes BLOB) — the per-instance PIN: the flow document, every task
  version, the rule-sets, the domain profiles and the role map that a run was created under [code
  src/store/definitions.ts:32,85-136].
- publication(task, version, digest, at) — the durable publication record per task version; a digest, never
  bytes [code src/store/definitions.ts:55-65,148].

### 3.1 Event kinds (19) [code src/runner/engine/types.ts:9-35]

instance.created, gate.verdict, quality.verdict, quality.continued, instance.failed, needs.guidance,
artifact.accepted, step.trace, instance.completed, learning.note, bar.raised, bar.contested, recall.selected,
recall.ranked, rubric.sampled, bar.held, **branch.decided, instance.parked, wait.resumed**.

The first nine carry the engine's transitions; the next seven carry the execution-learning loop; the last
three are the flow-control records — ONE `branch.decided` per routed deciding step (Unit 1) and the
`instance.parked` / `wait.resumed` pair per park (Unit 2). All three are event-fold like the learning
evidence: no table, no column, no DDL was added for any of them [code src/store/db.ts unchanged across
b04a04e..a61a279].

### 3.2 What is STORED and what is COMPUTED

STORED (a row or an event is the owner):

- current instance state (status, current step, revision, nonce) and its transition events;
- every artifact version: bytes on disk + a row with the canonical digest, schema, state and derived_from;
- the pins: flow/task/ruleset/profile/assignment BYTES plus their digests, per instance;
- every gate verdict and every quality verdict, with the full per-dimension judgment;
- every bar.raised / bar.contested / bar.held / rubric.sampled, every learning.note (real or stub:true),
  every recall.selected and every recall.ranked cache entry;
- the flow decisions: one branch.decided per (instance, step, artifact digest) and the instance.parked /
  wait.resumed pair, where the park event's own seq is the id its receipt names [code src/runner/engine/wait.ts:99-137].

COMPUTED ON DEMAND — no column, no table, no second copy:

- **The bars.** No bar is stored. Every bar is flooredBar(raisesFor(...)): a MAX fold over that dimension's
  recorded raises, floored at 0.5, read on every decision [code src/quality/scope.ts:139-171]. Quantiles are
  NEVER stored: each observation population is re-derived from quality.verdict + artifact.accepted on
  demand, and only a RAISE is written down [code src/quality/bar.ts:405-453; README:180-183].
- The Q50 learning flag, the MIN headline, the dimension differences and every metric row: a projection over
  the same events [code src/quality/metrics.ts:1-15].
- failedReason on the instance value: derived on read from instance.failed [code src/types/schema.ts:486-496;
  src/runner/engine/quality-loop.ts:87].
- qualityHistory and the attempt budget: derived from the event log, which is why no store column exists for
  either [code src/runner/engine/quality-loop.ts:33-86; src/runner/engine/types.ts:200-216].
- the step brief, the descriptor, the six-key result and the active-step snapshot: projected on every call
  [code src/pi/descriptor.ts:1-6; src/runner/result.ts:1-16; src/runner/engine/active.ts:1-18].
- The note's OBJECTIVE half (scores, dimension, attempts, outcome): derived from the events that already own
  those facts; only the agent's subjective half is stored [code src/runner/note-gate.ts:3-13,35-101].
- The recall ranking: computed by a port and CACHED as a derived recall.ranked event keyed by the evidence
  state; a stale or missing entry recomputes, so the cache is never authoritative.
- The park in force, and a parked instance's nextAction: derived from the status plus the park/receipt pair,
  never a column [code src/runner/engine/wait.ts:129-137; src/runner/result.ts:36-41].

## 4. Execution path

The whole agent surface is one tool with six ops [code src/types/pi.ts:21] plus two issue.* ops
[code src/pi/operations.ts:34]. Every op goes through executePraxisTool [code src/pi/tool.ts:75], which parses
the args, dispatches, and returns { content, details, isError } where details is a validated envelope.

    start  -> create or re-open the instance this requestId names; pin flow+tasks+rules+profiles+roles;
              none of that happens until the order-alignment judge has passed
    check  -> dry run: validate the artifact's SECTIONS against the current task's requires; writes nothing
    submit -> score (outside the store), then run the node, gate it, decide quality, accept / refuse / retry
    note   -> record the learning note a terminal step owes (or the engine's bounded stub)
    read   -> the accepted artifact of one step (grant-checked)
    recall -> bounded, ranked, provenance-carrying experience from THIS store

The CLI is a seventh surface that is deliberately NOT a tool op: `resume <instance> --event <file>` is the
host seam that delivers the outside event a parked instance waits for (Unit 2, §7). A parked instance refuses
advance and every op that would advance it (INSTANCE_STATE_INVALID at src/runner/engine/advance.ts:60-66);
only resume moves it back to running, at the same step.

### 4.1 Gates, in the order they fire

1. **Ownership and role (every op).** assertObserver for inspect/read/check/recall; assertStepActor for
   submit/note — the instance creator or the holder of the step's task role; a stranger is
   INSTANCE_FORBIDDEN [code src/runner/engine/authority.ts:36-70]. This is routed-path authority only.
2. **Alignment (start only).** anchorOf(openFlow(...)) reads the task anchor from the flow that WOULD be
   pinned, then the jev judge compares the caller's order against it; misaligned throws ALIGNMENT_REJECTED
   BEFORE any write, an unavailable judge proceeds with a visible "unchecked" flag on the step summary
   [code src/pi/operations.ts:176-245; src/quality/jev-align.ts].
3. **Capability ceiling.** grantFor(step, task.capabilities) and a refusal before the body runs
   [code src/runner/capabilities.ts:1-40]. A step may only use the four names artifact.read, artifact.write,
   emit, evaluate [code src/types/schema.ts:32].
4. **Pins and flow validity.** loadPinnedFlow re-reads the instance's own pinned bytes and digests; a
   mismatching pin is terminal (PIN_CORRUPT) while a missing pin is recoverable [code
   src/runner/engine/advance.ts:65-76, flow.ts:224].
5. **The step body.** runStep builds the handoffs the node consumes (one for a data edge, all sources in
   declared order for a join edge) and writes the artifact version [code src/runner/step.ts:103-153,154-281].
6. **The deterministic gate (gate()).** object, schema name, nonce, subject presence and the
   subject-vs-derivedFrom relation, then the task's declared section requirements via missingFor — no
   coercion, no partial credit [code src/runner/step.ts:298-384; src/runner/requirements.ts:17].
7. **The quality gate.** Every dimension's score against max(0.5, its measured bar); a pure AND. A below-bar
   dimension refuses; the gate is described in full in §6 [code src/quality/bar.ts:347-356;
   src/runner/step.ts:309-320].
8. **The refusal / onFailure policy.** A refusal is evidence, not death: a refuse edge re-points the work, no
   edge retries the node. On the attempt budget or on no progress, the task's onFailure decides — escalate
   sets status failed, records needs.guidance and throws QUALITY_BLOCKED; continue accepts the best-scoring
   version marked FAILED and moves on [code src/runner/engine/quality-loop.ts:177-281; advance.ts:300-360].
9. **Closure — the note gate.** A step that reached its terminal outcome owes a learning note; the next
   advance refuses to move until it is recorded, with a bounded budget after which the engine writes
   stub:true itself, so an agent can delay the flow but never deadlock it [code src/runner/note-gate.ts:1-13,
   src/runner/engine/advance.ts:166-190].
10. **Arrival — park or move.** The successor move goes through arriveAt (src/runner/engine/advance.ts:389).
   If the target node declares `wait`, the engine appends one instance.parked and sets the status to waiting
   instead of running; otherwise it sets running at the target exactly as before. `start` applies the same
   rule to the first node (src/runner/engine/start.ts:132), so a triggered flow can begin already parked.

The score itself never runs inside a store transaction: advanceEvaluated inspects (opens and closes the
store), computes the verdict with the injected Scorer, and only then calls advance()
[code src/quality/evaluate.ts:326-376; src/runner/engine/advance.ts:50]. This is the durable-intent ->
external-call -> durable-receipt rule applied to the judge.

### 4.2 The six-key result

Exactly six keys leave the runtime, validated against ResultSchema before return: instanceId, flow, status,
artifacts[] (step, version, digest, schema — no bytes, no path), summary, nextAction
[code src/runner/result.ts:16-66; src/types/schema.ts:339-346]. A **parked** instance reports status `waiting`
and nextAction `wait: <event type>`; every other status keeps the values described above
[code src/runner/result.ts:36-41]. The parent never receives the event log, a
transcript, artifact bytes or a store path.

## 5. Composed system prompt

At every run boundary the Praxis extension REPLACES the agent's whole system prompt with one composed
document, in this order [code src/pi/extension.ts:23-26; src/pi/prompt-hook.ts:103-145]:

    conduct      .pi/praxis/profile/conduct/occam.json    FIXED    leads
    role         .pi/praxis/profile/role/<role>.json      FIXED    one seat per session
    domain?      .pi/praxis/profile/domain/<id>.json      DYNAMIC  declared by the current flow NODE
    environment  Pi's own rendered prompt                  nested LAST, verbatim

- **The hook.** pi.on("before_agent_start") receives the prompt Pi rendered for this run; the handler reads
  event.systemPrompt and returns { systemPrompt } to replace it. It deliberately does NOT set
  event.systemPromptOptions.forceSystemPrompt (a shared mutable object would re-render on the next run and
  nest a second environment) [code src/pi/prompt-hook.ts:1-16; docs/tasks/composed-prompt-c0c929ff/design.md §3].
- **The guard.** A composed prompt starts with PROMPT_MARKER_PREFIX ("<!-- praxis:system-prompt v1"); if the
  incoming prompt already starts with it the hook returns undefined, so a second boundary nests nothing
  [code src/runner/engine/prompt.ts:17,129; src/pi/prompt-hook.ts:104-106].
- **The role.** PRAXIS_ROLE, else the project config's defaults.role; nothing else. This is CONFIG-TRUST: any
  process that can set the variable claims that seat's text. It is advisory text, never a permission, and
  trusted identity stays gate #3 (open) [code src/pi/prompt-hook.ts:57-70,111-115].
- **Fail-closed.** No role, an unreadable profile or any load failure returns undefined and leaves Pi's own
  prompt untouched, with ONE warning line. The hook never emits a partial composition
  [code src/pi/prompt-hook.ts:111-127].
- **Profile loading.** loadProfileLayer(dir, layer, id) is the one reader of a profile document; the layer,
  the file name and the document's own id/layer must agree or it is PROFILE_INVALID, and a missing file is
  PROFILE_NOT_FOUND [code src/runner/engine/profile.ts:29-66]. Conduct and role are cached per process by
  path+mtime, so a boundary costs one stat [code src/pi/prompt-hook.ts:42-52].
- **The composer.** composeSystemPrompt is pure: no I/O, no clock, no store. Overviews appear in layer order,
  body comes from conduct only, invariants/prefer/avoid/examples are field-wise unions, the advisory line is
  appended exactly ONCE after the layers and before the environment block [code
  src/runner/engine/prompt.ts:1-16,97-128].
- **The domain at the boundary.** The engine writes a DERIVED snapshot at every boundary —
  <storeDir>/active.json, shape ActiveSnapshotSchema — with the instance, flow, step, status and the current
  node's resolved domain profiles [code src/runner/engine/active.ts:30-90; src/types/active.ts]. The hook
  reads it and takes domains only when status === "running"; a stale, absent or malformed file yields NO
  domain, never a guess [code src/pi/prompt-hook.ts:74-100]. The snapshot is marked closed when the instance
  stops running. This host-reads-a-Praxis-file coupling is gate #2, recorded as exercised, not closed
  [doc docs/vision.md §13 gate 2].

## 6. Quality engine — the LIVE model

Everything below was read from src/quality and src/runner/step.ts. The mean/tolerance/Pareto/EMA/global-bar
model described by earlier documents is GONE from the code; see §9.2 and §9.3 for the last places its words
survive.

### 6.1 One measured bar per dimension — a quantile of carried work

- **Scope.** One bar per (task, dimension IDENTITY). There is no global scope and no mean bar
  [code src/quality/bar.ts:1-11; README:172-178].
- **Identity.** dimensionKey = digest of the dimension's id plus WHAT DECIDES IT: the composed criteria when
  it has probes (id, type, instructions, criteria, clean, and for a cited criterion the rule REFERENCE set+id,
  never the rule's text/version), otherwise its statement [code src/quality/scope.ts:78-108]. A republished
  task with unchanged dimensions inherits its earned bars; editing what decides a dimension resets only that
  dimension.
- **Population.** ONE observation per INSTANCE, not per attempt: the dimension score of the version the
  instance CARRIED (accepted version; best-scoring version for a carried failure). Verdicts with no score are
  not observations [code src/quality/bar.ts:405-450].
- **Quantile.** The value at rank floor(p/100 x (n - 1)) of the sorted population — the LOWER definition —
  quantized DOWN to two decimals, floored at ABSOLUTE_MIN = 0.5 [code src/quality/bar.ts:370-400].
  p = the dimension's quantileGate, default DEFAULT_QUANTILE = 25 (Q25) [code src/runner/engine/types.ts:69-72;
  src/types/quality.ts:106-112].
- **Fold.** flooredBar = max(0.5, MAX over recorded raises). Monotone by construction: nothing lowers a bar,
  and a legacy decreasing sequence cannot either [code src/quality/scope.ts:139-171].
- **Step.** A raise is recorded only when the candidate is at least RAISE_STEP = 0.02 above the bar in force
  [code src/quality/bar.ts:253-259; src/runner/engine/types.ts:66].

### 6.2 When a bar may move

- **First raise (the K3 guard).** Eligible only at n >= FIRST_RAISE_MIN = 28 = CALIBRATION_MIN 20 + 2 x
  FIRST_HALF 4. The candidate comes from the 20 observations the confirmation halves never saw; both
  4-observation halves must independently support it — at most floor(p x |half| / 100) values may sit below
  the candidate [code src/quality/bar.ts:166-215; src/runner/engine/types.ts:62-78].
- **Steady rule.** After a raise, two halves of HALF_WINDOW = 20 (window 40) are read and the LOWER half's
  quantile is adopted, so a lucky newest batch cannot carry the bar [code src/quality/bar.ts:206-215].
- **The sample guard (S3).** A raise on an identity no stable rubric sample vouches for is HELD: a bar.held
  event is recorded and the bar does not move. The sample is repeat-N agreement over the same frozen artifact
  (SAMPLE_REPEATS 3, SAMPLE_RANGE_MAX 0.3, SAMPLE_AGREEMENT_MIN 2/3) [code src/quality/bar.ts:240-247;
  src/quality/sample.ts:1-13; src/runner/engine/types.ts:88-101].
- **Contest.** A full 40-observation window under a raised bar with NO pass emits bar.contested once per bar
  level. It records and never lowers; lowering a contested bar is an owner act [code
  src/quality/bar.ts:270-330].

### 6.3 The gate is a pure AND

perDimensionDecision: a verdict passes iff EVERY dimension's score is at or above
max(ABSOLUTE_MIN, its measured bar). No tolerance band, no mean, no Pareto cap, no compensating dimension
[code src/quality/bar.ts:340-356]. MIN over the dimensions remains the REPORTED headline score — disclosure,
not the rule [code src/types/schema.ts:155-160].

### 6.4 The learning flag (Q50)

A dimension that PASSED but sits below its own median of the same carried population is flagged; it is
derived on demand, has no gate effect and is not stored. The note gate requires a lesson for every flagged
dimension [code src/quality/metrics.ts; src/runner/note-gate.ts:102-137; README:236-240].

### 6.5 Recall — two stages, one cached judgment

1. **Deterministic pre-rank** over bounded recent notes/verdicts: RECALL_WEIGHTS weakness .35, outcome .25,
   corroboration .20, recency .10, margin .10; RECALL_MAX 5, RECALL_TOKEN_BUDGET ~1000
   [code src/quality/recall.ts:24-36].
2. **One pi-jev evaluate** over the top JEV_POOL 20, asking how much NEW guidance each case adds; duplicates
   are collapsed by Jaccard >= DUPLICATE_JACCARD 0.8 on the selected text, which is what makes the set
   DISTINCT [code src/quality/ranker-jev.ts; src/quality/ranker.ts:446-452].
3. **The result is a derived cache**, persisted as one recall.ranked event keyed by (task, taskVersion,
   coverDigest, watermark = candidate count). A fresh entry is served with ZERO jev calls; a miss computes
   once (in-process single-flight, 250 ms cross-process wait) and appends the event after the call, outside
   any transaction. A jev failure caches NOTHING and the deterministic answer serves that call
   [code src/quality/ranker-jev.ts:1-14,338-420].
4. **Lesson text is screened** by a code-owned battery before it reaches a parent: two nouls (does it instruct
   the reader; would it push them outside the step's capabilities), failure at >= 0.5, and an unavailable
   screen WITHHOLDS the text rather than passing it [code src/quality/screen.ts:1-15,57-88].

### 6.6 The probe battery is explain-only

Each dimension may declare up to 6 probes (48 per rubric) [code src/types/quality.ts:94-106]. They are asked
in ONE explain-only jev call AFTER the score is computed; the score, the gate, the bars and the flags never
read them, and a probe-battery failure leaves the verdict byte-identical [code src/quality/jev-scorer.ts:1-60;
src/quality/evaluate.ts:1-14]. The rendered rationale is capped at 240 characters with at most 3 clauses, and
a divergence clause fires when the score is below the bar while the probes read clean
[code src/quality/jev-scorer.ts:37-52].

## 7. Flow and task model

- **Flows are molecules.** A flow document is praxis.flow/v2: an id (flows/<path>), nodes, edges, optional
  default domains and optional quality default [code src/types/flow.ts:161-341]. A node carries an id, a task
  reference and the three OPTIONAL attributes the flow layer owns — `domains`, a `decide` block (Unit 1) and a
  `wait` predicate (Unit 2) — and never a capability, gate or schema [code src/types/flow.ts:106-115;
  NODE_KEYS:363].
- **Edges are the logic.** FOUR kinds now: data (one artifact in), join (several sources in declared order),
  branch (one of N successors, chosen by the node's `decide` block; the edge carries the `label` that names
  the option) and refuse (the rework target when a gate refuses) [code src/types/flow.ts:118-140]. A branch edge
  is exempt from the data/join fan-out counts and is counted only as a MERGE SLOT by its distinct source, so
  N mutually exclusive arms from one node consume exactly one slot at a reconvergence node [code
  src/types/flow.ts:174-260]. A refuse edge may not target a `wait` node (:217-223). nodes[] is declared in
  execution order: data/join/branch edges run low-to-high, refuse edges high-to-low, which is what makes
  acyclicity checkable without a graph library [code src/types/flow.ts:174-341].
- **Tasks are atoms.** A task document under .pi/praxis/tasks/<path>.json declares id (== last path segment),
  version, state draft|published, gate, goal, capabilities, produces.schema, requires (the typed section
  contract), optional quality (dimensions, probes, quantileGate, maxAttempts, onFailure), bindsSubject,
  rules and domains [code src/types/schema.ts:246-298; an instance: .pi/praxis/tasks/design/spec.json].
- **Path identity.** One segment rule — lower-case kebab, 1-64 chars — for tasks/, flows/ and rules/; no dot,
  no json suffix, no absolute form, so no reference can leave its library [code src/types/paths.ts:1-21; the
  ref grammar is pathUnder("tasks")/("flows")/("rules")].
- **Rule-sets.** .pi/praxis/rules/<path>.json holds id, version and rules[{id, statement <= 280}]; a task
  references a set (optionally an id subset); a probe may CITE a rule by {set, id} and the resolved text is
  composed into the criterion at judge time, while the bar identity keys on the citation, not the text
  [code src/types/rules.ts; src/runner/engine/rules.ts; src/quality/scope.ts:90-108].
- **Shipped library.** 12 task documents (discovery, design, build, verify) and 4 flows under
  .pi/praxis/flows/engineering/ (feature, bugfix, fix, refactor); the default flow is
  .pi/praxis/flows/engineering/feature.json [code src/runner/engine/flow.ts:116-118].
- **The instance pins what it ran.** start writes a definition row for the flow and for every task version,
  rule-set and profile it resolved, plus the role map; loadPinnedFlow reads those bytes back and re-verifies
  their digests, so a library edit cannot change work already in flight [code src/runner/engine/start.ts:60-130;
  src/runner/engine/flow.ts:229-290].
- **Primitive status (matches docs/FLOWS.md §3 and §5).** sequence, join and loop (`data`/`join`/`refuse`)
  were already built; **branch is built** (commit b04a04e), **wait is built** (a61a279, Slice A: park/resume
  with a lazily evaluated timeout and no daemon), the **human node is built as a wait variant** (a park whose
  event is a submission, then the ordinary gate), and the **trigger is a host seam, not a primitive** — `start`
  fires and `praxis resume --event` continues (§8). **Nesting remains △ proposed and disabled** (gates #4/#8),
  and wait's operational extras stay gated: retention (#6), an off-process scheduler (#7) and a Pi-tool
  `op=resume` [code src/types/flow.ts:106-115; src/runner/engine/wait.ts:1-30; src/cli.ts:137-146].

## 8. Configuration and environment

Path resolution, exact code precedence [code src/runner/engine/support.ts:19-52]:

| What | Order |
| --- | --- |
| Store root | options.storeDir (CLI --store) > PRAXIS_STORE_DIR > project defaults.storeDir > <cwd>/.pi/praxis/state |
| Flow document | options.configPath > PRAXIS_CONFIG > <cwd>/.pi/praxis/flows/engineering/feature.json |
| Task library | options.tasksDir > PRAXIS_TASKS_DIR > <cwd>/.pi/praxis/tasks |
| Rule-set library | options.rulesDir > PRAXIS_RULES_DIR > <cwd>/.pi/praxis/rules |
| Profile library | options.profileDir > PRAXIS_PROFILE_DIR > <cwd>/.pi/praxis/profile |

Environment variables read by src/ [executed: grep -rhoE "PRAXIS_[A-Z_]+" src | sort -u]: PRAXIS_ACTOR (the
default actor when the host supplies none), PRAXIS_CONFIG, PRAXIS_PROFILE_DIR, PRAXIS_PROMPT_TRACE (the hook
writes one JSON trace line — bytes, sha256, section order, role — only when set), PRAXIS_ROLE (the claimed
seat), PRAXIS_RULES_DIR, PRAXIS_STORE_DIR, PRAXIS_TASKS_DIR. (The PRAXIS_TOOL_* names are string constants in
the tool definition, not environment reads.)

The project config .pi/praxis/config.json is praxis.project/v1 with defaults { maxAttempts, storeDir, role }
[code src/types/project.ts]. The committed file sets only defaults.maxAttempts = 10. A missing, unreadable or
invalid file is ignored (it degrades to code defaults) and is cached per project root once successfully parsed
[code src/runner/engine/support.ts:54-81]. Precedence for the attempt budget: task/flow quality.maxAttempts >
project defaults.maxAttempts > DEFAULT_MAX_ATTEMPTS = 3 [code src/runner/engine/types.ts:36,204-210].

Engine constants in force (all code, never a task field) [code src/runner/engine/types.ts:36-101]:
DEFAULT_MAX_ATTEMPTS 3, DEFAULT_ON_FAILURE continue, ABSOLUTE_MIN 0.5, CALIBRATION_MIN 20,
QUANTILE_WINDOW 40 / HALF_WINDOW 20, RAISE_STEP 0.02, DEFAULT_QUANTILE 25, FIRST_HALF 4,
FIRST_RAISE_MIN 28, QUANTILE_FORMULA_ID praxis.bar.quantile/v1, TORN_SPREAD 0.35, TORN_NOUL_BAND
[0.45,0.55], SAMPLE_REPEATS 3, SAMPLE_RANGE_MAX 0.3, SAMPLE_AGREEMENT_MIN 2/3, TORN_CLEAN_BAND [0.4,0.6].

The CLI (src/cli.ts) exposes run, resume [--artifact <file> | --event <file>], status, artifact read and
metrics [code src/cli.ts:117-205], and reads the same env precedence through the engine options. `resume
--event` is the only host surface for a parked instance (Unit 2): the flag selects the wait resume, while a
plain resume keeps its original meaning and a parked instance refuses it with INSTANCE_STATE_INVALID.

## 9. Legacy and tech debt to fix before adding new work

### 9.1 Bootstrap residue inherited from pi-manifold — what actually remains

The 2026-10-30 housekeeping unit already fixed most of the manifest. [executed: cat package.json, cat .husky/*,
cat commitlint.config.cjs, cat .gitignore] Current facts, stated precisely.

ALREADY FIXED (do not re-report as debt): package.json name is pi-praxis and the description describes Praxis;
the pi.extension entry points at ./src/pi/extension.ts, which exists; the scripts are check (tsc --noEmit),
test (node --test "tests/**/*.test.ts") and prepare (husky || true), all runnable; there is NO
@nats-io/transport-node dependency; zod 4.6.7 IS used (imports across src/types/*); .gitignore DOES cover the
praxis store (.pi/praxis/state/ plus the *.sqlite, *.sqlite-wal, *.sqlite-shm globs).

STILL PRESENT:

- **commitlint.config.cjs** at the repo root + the devDependencies @commitlint/cli, @commitlint/config-conventional
  and husky. Its headerPattern accepts an optional "[N] " prefix and a fixed type-enum; nothing in Praxis needs
  it, and no Praxis-authored convention mentions a numeric prefix.
- **.husky/commit-msg** — a shell hook that (a) rewrites every message to "[n] <message>" using the total
  commit count, and (b) calls commitlint through an ABSOLUTE, machine-specific path:
  /home/tia/.bun/bin/bunx commitlint --edit "$1". It cannot work on any other host and it mutates the message
  the author wrote.
- **.husky/pre-commit** — an EMPTY file (a bare newline). It runs nothing and implies a gate that does not exist.
- **.gitignore, the manifold block** — .pi/manifold/state/, .pi/manifold/sessions/, .pi/manifold/cache/,
  .pi/manifold/experiments/, .pi/manifold/journal.json, .pi/manifold/operator.lock, .pi/manifold/operator.lock.stale.*,
  plus the tests/live/** rules. Praxis does not write any of those paths; the live-test rules are inherited too.
- **scripts/release.ts and scripts/release-lib.ts** — inherited manifold release tooling, now tracked (commit
  d99775e added them). No npm script references them and nothing in src/ imports them, so they remain orphan
  files in the tree.
- The .pi/manifold/ directory itself (.pi/manifold/config.json, profiles/research.json, profiles/tester.json)
  and its state — Manifold's own declaration, referenced by the ledger, not Praxis code.

### 9.2 Dead code left by the quantile cutover (EMA / Pareto / compound)

The LIVE model is §6. These survivors still say the old model and should be deleted in one cleanup:

- **src/quality/bar.ts:1-22** — the module header still describes praxis.bar.ema/v3, the nine-period EMA, the
  +/-0.05 approach, WARMUP_MIN 10 and BAR_WINDOW 5, and line 6 still says acceptance carries a tolerance band.
  None of it is the code below it.
- **src/quality/bar.ts:43** — BAR_FORMULA_ID = "praxis.bar.ema/v3", exported through src/quality/index.ts:22 and
  NOT used by any raise (every raise records QUANTILE_FORMULA_ID).
- **src/quality/bar.ts:45-56** — doc comments with no constant under them (cooldown, warmup, mean attempts,
  ceiling, largest raise, EMA periods/alpha) left behind by deleted declarations.
- **src/quality/bar.ts:111-119** — the Compound interface (mean, flagged, refused), exported at
  src/quality/index.ts:38, while the gate returns { pass, refused } from perDimensionDecision.
- **src/quality/bar.ts:100-108** — three orphaned doc comments with no function beneath them: population
  standard deviation (:100), the lower quartile (:102) and the nine-period EMA (:104-108).
- **src/quality/scope.ts:139-152** — the barAt docstring is duplicated (two copies, the first describing a
  behaviour the code does not have).
- **src/runner/engine/types.ts:38-44** — the DEFAULT_PARETO_THRESHOLD doc comment survives with no constant;
  line 44 is a comment saying the cap is gone.
- **src/runner/engine/types.ts:46-56** — a note claiming BAR_WINDOW/BAR_FORMULA_ID "still belong to the live EMA
  ratchet". They do not exist any more on either side.
- **src/runner/step.ts:316-317** — the gate options still accept pareto?: number; advance.ts:151-152 passes
  pareto: undefined together with the comment "the gate caps at the Pareto point". Nothing reads it.
- **src/types/learning.ts:95,125-127** — bar.raised still carries the optional EMA-era ema field and its
  comment; it is legacy-parse compatibility only. Same for BarWindowSchema (:117) and the tolerance wording in
  QualityVerdictSchema comments.
- **src/types/quality.ts:118-148** — three fields are parsed and IGNORED: dimension.floor ("@deprecated since
  quantile-bars"), quality.threshold ("there is no global bar and no mean bar") and quality.paretoThreshold
  ("the Pareto cap is gone"). They are kept so old task documents and pins still load — but the shipped task
  documents no longer set them, so the acceptance surface carries dead knobs.
- **src/quality/evaluate.ts:71,182**, **src/runner/engine/quality-loop.ts:117**, **src/runner/engine/advance.ts:182,283**
  — comments still speak of "the compound decision", "the MEAN" and a "tolerance band". The behaviour is the
  pure AND; the words are not.

### 9.3 Documentation drift

- **docs/vision.md §13a, the P7 experience bullet (around line 322)** still says "a per-dimension + global
  quality ratchet". There is no global bar and no mean in the code (§6); STATUS.md and README already say so.
- **README.md** — the "Quality bars and learning" section carries the quantile model and is committed as of
  a008e39; re-check it against §6 whenever §6 moves. It predates flow Units 1-2 and does not yet describe the
  branch or wait primitives.
- **src/pi/extension.ts:2** — "exactly one tool, no hook (R1, R11)" while the same function registers the
  before_agent_start hook at :25.
- **src/runner/engine/profile.ts:7-10** — "ONLY THE DOMAIN LAYER IS COMPOSED HERE. conduct and role ... stay
  with the host", contradicted by loadProfileLayer:37 in the same file, which the host calls for conduct and
  role (src/pi/prompt-hook.ts:44-52). The body's own docstring (:29-35) is correct; the header is stale.
- **src/runner/engine/support.ts:32** — the doc comment above profileDirOf says "Rule-set library resolution"
  (copy-paste from rulesDirOf).
- **src/runner/issues.ts:16-21** — ISSUE_DISABLED is cast into Code ("as Code") with a comment saying the
  taxonomy in src/types/errors.ts may not be edited by that assignment. It is the one code outside the closed
  union.
- **src/pi/prompt-hook.ts:63-69** — the hook's storeDirOf resolves option > PRAXIS_STORE_DIR > <cwd>/.pi/praxis/state
  and skips the project config's defaults.storeDir, which the engine DOES consult (src/runner/engine/support.ts:20-30).
  A project that sets only defaults.storeDir gets the engine writing to the configured root while the hook reads
  the default root, so the domain silently disappears from the prompt.

### 9.4 Structural facts worth knowing before adding code

- **No file is at or over the 600-line cap.** Largest: src/pi/operations.ts 589, src/quality/ranker.ts 488,
  src/quality/ranker-jev.ts 481, src/types/pi.ts 471, src/quality/bar.ts 453, src/types/flow.ts 389.
  operations.ts is the tight one (11 lines of headroom), which is why wait's host surface is the CLI; schema.ts
  fell from 594 to 358 when Unit 1 moved the flow document into flow.ts.
- **src/quality/metrics.ts is imported only by src/cli.ts and its own test** — by design (it must never gate),
  but it means nothing in the tool path exercises it.
- **.pi/praxis/state/ contains both praxis.sqlite (the live store, with -wal/-shm) and a stray praxis.db** —
  local, gitignored, not read by any code path (openStore is called with praxis.sqlite only).
- The store directory also holds the artifacts/ tree; the store is gitignored but its contents are real
  evidence and must not be deleted casually.

### 9.5 Open gates, and what each one BLOCKS

From docs/vision.md §13 [doc], with the blocking consequence stated:

1. **Isolation** — broker-only tool checks versus an OS sandbox. BLOCKS any claim that an agent "cannot touch
   anything else": src/pi/tool.ts:1-10 and src/runner/capabilities.ts:8-12 both say plainly that a routed call
   is constrained and a direct bash/read/Fabric call is not.
2. **Pi host seam** — exercised, not closed: the extension now composes the whole prompt and reads a
   Praxis-written snapshot (§5). BLOCKS any claim that the host coupling is stable across Pi versions, and any
   isolation reading of it.
3. **Trusted identity** — BLOCKS any identity claim: the role is PRAXIS_ROLE/config (§5), the actor is whatever
   the host session says (src/pi/operations.ts:109), and no metric or verdict may attribute to an agent.
4. **Flow expansion** — who may propose/approve/activate new steps or capabilities, and whether live instances
   migrate. BLOCKS any dynamic flow composition, any self-authored step, and any instance migration.
5. **Artifact contract** — the JSON Schema dialect and rendering. BLOCKS claiming a general artifact contract
   beyond the canonical JSON + per-task section requirements that exist (§4.1, §6).
6. **Durability** — store root policy, MIGRATION, RETENTION, crash consistency, backups. BLOCKS any new table,
   any DDL, any store-schema bump: this is why derived caches are events (recall.ranked) and not tables
   [code src/quality/ranker-jev.ts:1-14]. Unit 2 stayed inside it the same way: the park is an instance.parked
   event and the receipt a wait.resumed event, so parked instances introduce NO new storage and NO retention
   policy of their own.
7. **Maintenance** — what counts as a turn, and who triggers background work with no active process. BLOCKS
   any daemon, any scheduled job, any write-triggered maintenance. The recall cache is LAZY read-through
   precisely to stay inside this gate, and so is Unit 2's timeout: nothing sweeps parked instances and a
   deadline is only evaluated when a host calls resume. A host cron calling start/resume is the pre-gate form;
   a Praxis-side scheduler is gate #7 itself.
8. **Nested execution** — depth, cycle rules, shared budgets, cancellation. BLOCKS any nested runtime, any
   sub-flow invocation, any budget that spans instances.

## 10. Maintenance rule

Re-edit this file in the same change, and before any review, whenever any of the following moves:

- a module is added, deleted, renamed or its responsibility changes (src/**);
- the event catalogue changes, or a fact moves between STORED and COMPUTED (§3);
- a gate is added, removed or re-ordered, or the six result keys change (§4);
- the composed prompt's order, sources, marker, or the active snapshot's shape changes (§5);
- any quality constant, the gate rule, the ratchet rule, the recall stages or their bounds change (§6);
- the flow/task/rule/profile document shapes or their path grammar change (§7);
- an environment variable, a path default or a project-config field is added or its precedence changes (§8);
- a debt item in §9 is fixed, or a new one is found;
- an open gate in §9.5 is closed, or a claim is made that depends on one.

A change that alters behaviour without altering this document is a defect in the change, not in the document.
