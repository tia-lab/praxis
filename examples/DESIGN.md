# Praxis examples — design checkpoint (APPROVED, and authored)

Status: **approved in full and authored** (lead approval, assignment `619539e8`). The catalogue in §3, the
outline in §4 and the discipline in §2 are what shipped; every profile, task and flow listed below exists
under `examples/` and was validated against the shipped schemas, with the three flows loaded through the
engine's own `openFlow`. This file is kept as the design record — §2's choice trap and §6's findings are
the reasoning the README teaches from.

Scope: a new top-level `examples/` tree, docs and schema-valid JSON only. **No `src/`, `tests/`,
`.pi/praxis/`, schema or dependency change.** Every example is a *copy*, not a runtime change: nothing here is
loaded by the engine until a user copies it into `.pi/praxis/`.

## 1. What was grounded before designing (executed, this session)

| Read | What it fixed |
| --- | --- |
| `src/types/schema.ts` (`TaskConfigSchema`, `RequirementSchema`, `FieldSpecSchema`, `CapabilitySchema`, `GateSchema`) | the task contract: `goal`/`rationale`/`scope`, `capabilities` (4 closed names), `produces.schema`, `gate` (2 names), `requires` (section/required/each/minItems/strict/equals/goal/rationale), `role`, `bindsSubject`, `quality` |
| `src/types/quality.ts` (`QualitySchema`, `QualityDimensionSchema`, `ProbeSchema`) | dimensions ≤ 8, probes ≤ 6/dimension and ≤ 48/rubric, `choice` 2-8 options + required `clean` key, `score` 2-10 ordered levels, `noul` carries no criteria, `quantileGate` 1-99, `policy` required/advisory, `maxAttempts`, `onFailure` |
| the task `superRefine` (`schema.ts`) | **a probe's `sections` must name a section the task DECLARES in `requires`** — jev-provability is enforced by the schema, not by advice |
| `src/types/profile.ts` (`ProfileSchema`) | the profile atom: `id`==file stem, `version`, `layer`==folder, `name`, `description` (meta only), `overview`, `invariants`/`prefer`/`avoid` (≤12 × ≤280), optional `examples` (≤6), optional `body` |
| `src/types/flow.ts` (`NodeSchema`, `EdgeSchema`, `FlowConfigSchema`, `DecideSchema`, `WaitSchema`) | nodes carry `id`/`task`/optional `domains`/`decide`/`wait`; edges are `data`/`join`/`branch`(+`label`)/`refuse`; `decide.criteria` 2-8 keys bijective with the node's branch labels; `wait.on.type` + ≤8 `match` fields + optional `timeoutMs` |
| `.pi/praxis/tasks/discovery/research.json` (v8) | the reference exemplar: sections with `goal`/`rationale`, dimensions as affirmative statements, probes targeted at declared sections |
| `.pi/praxis/profile/{conduct/occam,role/engineer,domain/code}.json` | the house style for profiles: short `overview`, obligations in `invariants`, concrete `prefer`/`avoid` |
| `.pi/praxis/flows/engineering/feature.json` | the flow document shape (`schema`, `flow`, `nodes`, `edges`, `result`, optional `issue`) |

Validation method (and what it can and cannot prove):

- **Tasks** and **profiles**: parsed with the real exported schemas (`TaskConfigSchema`, `ProfileSchema`) by a
  throwaway script outside the repo — no source change. This proves schema validity, including the
  `sections ⊆ requires` rule.
- **Flows**: parsed with `FlowConfigSchema` and then loaded with `openFlow` against the copied task files, so
  the run-time resolution (task refs, label bijection, merge slots) is proven too. The two sample tasks are
  tasks, so this check lands with the full set.
- What validation cannot prove: that a rubric *teaches* well, and that a dimension is worth gating. That is the
  lead's judgement, and §3 is the wording to judge.

## 2. The quality-dimension discipline (the point of the unit)

A dimension or probe must be an **affirmative, specific, jev-provable** assertion. Three rules, each with its
failure mode:

1. **Affirmative.** State the property the artifact HAS. Negative framing ("is not vague", "lacks filler",
   "fails to cite") tells the judge what absence to look for and scores a coin flip, because absence is not a
   property of the text.
2. **Specific.** Name the property measurably — the field, the section, the act. "High quality", "clear",
   "thorough" are not properties a judge can locate; they are moods.
3. **Jev-provable.** The claim must be provable **from the artifact's own content**, and the criterion must
   point jev at where that content lives (`sections`). A claim about the agent's reasoning, effort or good
   intentions is not in the artifact, so jev cannot ground it — and the schema refuses a `sections` value that
   is not a declared `requires` section, so an ungroundable claim cannot even name a target.

| Kind | BAD (rejected) | Why it fails | GOOD (as shipped in the samples) |
| --- | --- | --- | --- |
| dimension | "The report is not vague." | negative; unlocatable | "Each finding names the place in the draft where the defect appears and the consequence it causes." |
| dimension | "The answer lacks filler." | negative; no field to read | "The message section states who sent it, what it asks for and any deadline it names." |
| dimension | "Quality is high." | a mood, not a property | "The assessment verdict follows from the findings recorded above it." |
| dimension | "The agent reasoned carefully." | not in the artifact at all | "The classification names exactly one label and states why each other label does not apply." |
| probe (`noul`) | "The document is not missing key facts." | negative | "Each of the required fields in the classification is present with a concrete value." |
| probe (target) | `{ "type": "noul", "instructions": "It is good." }` | untargeted and unfalsifiable | `{ "type": "noul", "instructions": "Each finding names the place in the draft where the defect appears.", "sections": ["findings"] }` |
| probe (`score`) | levels "bad / ok / good" | adjectives, no observable difference | "the evidence is a restatement of the topic" / "names message text that bears on the label" / "quotes the decisive text and ties it to the label" |
| probe (`choice`) | clean option phrased as a fault, or reachable only sometimes | a fault is not a satisfied state, and an honest answer must be able to score | options `deadline_recorded` / `deadline_omitted` / `deadline_invented`, clean = `deadline_recorded` |

**The choice trap.** A `choice` probe scores 1 only on its `clean` option, so if that option is unreachable
for a legitimate artifact the honest answer scores zero and the dimension drags a good run below its bar. The
clean option must therefore cover every legitimate state ("states the deadline the message names, **or** states
that the message names none"), and the other options must name the faults (`deadline_omitted`,
`deadline_invented`). The sample was written the other way first and corrected here — that is exactly the
mistake the README has to teach against.

How the rules bind together: a `score` or `choice` probe must express an ordered or exclusive set of
**observed** states, so the levels themselves are the specificity test. And every dimension ends up compared
against a **measured** bar (a quantile of carried work, floored at 0.5, pure AND across dimensions), so a
dimension that cannot be grounded does not merely read badly — it silently lowers what the gate accepts.

## 3. Catalogue (proposal)

### Profiles — `examples/profile/`

| File | Layer | Teaches |
| --- | --- | --- |
| `conduct/evidence-first.json` | conduct | the always-on layer: say only what the artifact can show; no permission names, no tools |
| `role/support-analyst.json` | role | a seat that classifies and drafts; pairs with `role: "support-analyst"` on a task |
| `role/support-lead.json` | role | a seat that reviews and escalates; pairs with the review task's `role` |
| `domain/email-ops.json` | domain | domain declared on a **flow node**; mail semantics (threading, quoted context, tone) |
| `domain/billing-ops.json` | domain | a second domain, to show **union composition** when a node declares both |

### Tasks — `examples/tasks/examples/`

| File | Teaches | Requires |
| --- | --- | --- |
| `triage.json` *(sample 1, written)* | a decision artifact with quoted evidence; the task a `decide` node routes on | message, classification |
| `reply.json` | a drafted reply that answers each question in the message | reply, coverage |
| `archive.json` | a deliberately tiny task: one section, two dimensions — volume is not the point | summary |
| `escalate.json` | an escalation brief: what the customer needs, what the agent cannot decide | escalation, handoff |
| `brief.json` | a plan artifact: the change, its acceptance and its rollback | change, acceptance |
| `implement.json` | a change record: files touched, checks run, their outcomes | changes, checks |
| `review.json` *(sample 2, written)* | `bindsSubject` review: findings with a location + consequence | findings, assessment |

### Flows — `examples/flows/examples/`

| File | Shape | Teaches |
| --- | --- | --- |
| `inbox-triage.json` | `wait(email.received)` on the first node → `triage` with `decide` {reply, archive, escalate} → three terminal tasks | wait + lazy timeout, the branch/bijection rule, three mutually exclusive arms, **and that a flow may begin already parked** |
| `change-loop.json` | `brief --data--> implement --data--> review --refuse--> implement` | the refuse loop with the quality gate as decider, and `bindsSubject` on the reviewer |
| *(optional, propose separately)* `inbox-triage-human.json` | same shape, reply node is a **wait on `human.submitted`** | the human node as a wait variant — a park, then the ordinary gate |

Each flow's `flow` key and file path agree (`flows/examples/inbox-triage` ↔
`.pi/praxis/flows/examples/inbox-triage.json`), and each task reference names its library path
(`tasks/examples/triage`).

## 4. `examples/README.md` outline (proposal)

1. **What Praxis is, in one page** — molecule vs atom; who assigns, who reasons, who preserves. The honest
   boundary: routed calls only, no isolation, no trusted identity, no exactly-once (gates #1/#3 open).
2. **The three documents** — profile / task / flow, and where each lives under `.pi/praxis/`.
3. **Profiles** — conduct → role → domain, composed into the executed system prompt; what is fixed and what
   is dynamic (domain is declared on the flow **node**, never on the task); a worked example of the union.
4. **Tasks** — `goal`/`rationale`/`scope`, `capabilities`, `produces`, `gate`, and the `requires` section
   contract (`required`, `each`, `minItems`, `strict`, `equals`, `goal`/`rationale` for the judge);
   `role`, `bindsSubject`; `quality` (`policy`, `maxAttempts`, `onFailure`).
5. **The quality-dimension discipline** — the three rules of §2, the GOOD/BAD table, the
   `sections ⊆ requires` rule the schema enforces, how each probe type grounds a claim, and what to do when a
   dimension keeps refusing (fix the dimension, not the bar).
6. **Flows** — nodes and edges; `data` sequence, the `refuse` loop; `branch` + `decide` + `label` and the
   criteria↔label bijection; `wait` + the trigger seam (`start`, `praxis resume --event`); the human node as a
   wait; the merge-slot rule; and an explicit "what is NOT composable today" list (see §6).
7. **End-to-end walkthrough** — `start` → the step brief → the artifact → `check` → `submit` → the gate's
   verdict → accept, or the refuse loop → the handoff to the next node → the learning note → `completed`, with
   the six-key result shown at each step and a parked instance shown waiting and resuming.
8. **Copy-paste and run it yourself** — where each file goes, how to select the flow, how to run against a
   scratch store, and how to validate your own copies before submitting them.
9. **Where to go next** — the shipped engineering flows, `docs/FLOWS.md`, `ARCHITECTURE.md`, and the ledger.

## 5. The two sample tasks (written and validated)

| File | Id | Dimensions / probes | What it demonstrates |
| --- | --- | --- | --- |
| `examples/tasks/examples/triage.json` | `triage` | 3 / 6 | every dimension affirmative and section-targeted; a `score` whose three levels are observable states; a `choice` whose clean option covers every legitimate state (`deadline_recorded`) and whose other options name the two faults (`deadline_omitted`, `deadline_invented`); `role: "support-analyst"` matching the catalogue's role profile |
| `examples/tasks/examples/review.json` | `review` | 2 / 4 | `bindsSubject: true` (the reviewer judges a named version, never its own work); a dimension that spans two declared sections ("the verdict follows from the findings"), which is exactly what `sections: ["assessment", "findings"]` makes provable |

Executed check (throwaway script outside the repo, no source change):

```text
$ bun run /tmp/validate-examples.ts examples/tasks/examples/triage.json examples/tasks/examples/review.json
OK   examples/tasks/examples/triage.json  id=triage dimensions=3 probes=6 sections=2
OK   examples/tasks/examples/review.json  id=review dimensions=2 probes=4 sections=2
```

Both parse against the shipped `TaskConfigSchema`, including its `superRefine` (probe `sections` must be
declared in `requires`) and the `QualitySchema` bounds (probe ids unique, ≤ 6/dimension, ≤ 48/rubric).

## 6. Findings this checkpoint records (each verified against the current tree)

- **`join` is declared but not composable in one run today.** A join needs ≥ 2 distinct sources
  (`src/types/flow.ts`, the join rule); two predecessors require a node to fan out, and only `branch` may fan
  out — with **mutually exclusive** arms. A join fed by two branch arms therefore loads but **fails closed at
  run time** (`ARTIFACT_UNAVAILABLE` at the join, because the arm that never ran has no accepted artifact).
  **No shipped flow uses `join`** (`grep -c '"join"' .pi/praxis/flows/engineering/*.json` → 0 in all four).
  The examples therefore do not teach a join, and the README says reserved-until-parallel-work instead of
  inventing a shape that cannot run.
- **The exemplar's two negatively framed probes.** `research.json` v8 phrases `within-boundary` as
  "Nothing outside the stated boundary is claimed." and `distinct` as "Each finding states a claim that no
  other finding already states." Under §2 they read affirmatively ("The claims stay within the stated
  boundary." / "Each finding states a distinct claim."). **The live rubric is deliberately NOT edited in this
  unit** (exclusion: that is a separate refine pass); the examples model the framing.
- **`bindsSubject` needs no `subject` section.** The live `review.json` declares `bindsSubject: true` and no
  subject field: the engine compares the artifact's `derivedFrom` with the accepted version. The example
  follows that, so a reader does not invent a field the gate ignores.
- **A task's own `gate` is one of two names** (`schema-valid-and-nonce`, `section-requirements`); every gated
  example uses `section-requirements`, the gate that actually reads `requires`.

## 7. Approval (received) and what shipped

**Approved in full**: (a) the catalogue in §3 — including the optional human-wait flow, now authored as
`flows/examples/inbox-triage-human.json`; (b) the README outline in §4, with §4.5's discipline wording; (c)
the two sample tasks in §5 as the shape for the rest.

Shipped: 5 profiles, 7 tasks, 3 flows, and `examples/README.md`. Validation (executed): every profile and task
parsed against its shipped Zod schema (`ProfileSchema`, `TaskConfigSchema` — including the rule that a probe's
`sections` must be declared in `requires`), and each flow loaded through `openFlow` with the copied tasks and
profiles present, proving the task references, the criteria↔label bijection, the merge-slot rule and the
domain-profile resolution.
