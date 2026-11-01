# Praxis examples — learn to compose Praxis end to end

A complete, copy-pasteable example set: **profiles** (conduct, role, domain), **tasks** (atoms with a
rubric) and **flows** (the wiring), plus the one thing that is hardest to get right — **how to write
quality dimensions a judge can actually prove**.

Everything here is a *copy*, not a runtime change: nothing loads until you copy it into `.pi/praxis/`.
The names are deliberately generic (a support inbox) so the *shape* is what you read.

> **Honest boundary, up front.** Praxis constrains the calls routed through it. It is **not** a sandbox:
> an agent with direct shell or tool access is not stopped by anything in this repository (gate #1). The
> actor identity is **config-trust** (`PRAXIS_ROLE`/`PRAXIS_ACTOR`), never authenticated (gate #3), and
> **no exactly-once claim** is made about an external effect. Everything below is about routing, gating
> and preserving work — not about isolation.

## Contents

| Path | What it is |
| --- | --- |
| `profile/conduct/evidence-first.json` | a conduct profile: the always-on layer |
| `profile/role/support-analyst.json`, `profile/role/support-lead.json` | two role profiles: the seat, fixed per session |
| `profile/domain/email-ops.json`, `profile/domain/billing-ops.json` | two domain profiles: the dynamic lens, declared on a flow node |
| `tasks/examples/*.json` | 7 task atoms: `triage`, `reply`, `archive`, `escalate`, `brief`, `implement`, `review` |
| `flows/examples/inbox-triage.json` | wait → branch → three terminal tasks |
| `flows/examples/inbox-triage-human.json` | the same shape with the reply node as a **human wait** |
| `flows/examples/change-loop.json` | brief → implement → review, with the refuse loop back to implement |
| `DESIGN.md` | the design checkpoint this set was built from |

---

## 1. The three documents, and how they compose

| Document | Owns | Lives at | Selected by |
| --- | --- | --- | --- |
| **profile** | conduct — how the agent behaves | `.pi/praxis/profile/<layer>/<id>.json` | `PRAXIS_ROLE` (role) + the flow node (domain) |
| **task** | what work is, and what "good" means | `.pi/praxis/tasks/<path>.json` | referenced by a flow node |
| **flow** | the order work happens in | `.pi/praxis/flows/<path>.json` | `--flow` / `PRAXIS_CONFIG` |

Three rules that keep them from bleeding into each other:

1. **A task never references a flow**, and a flow never defines a task. A flow names a task by library
   path (`tasks/examples/triage`); a task is reused by any number of flows.
2. **A flow never carries what a task owns** — no goal, no rubric, no capabilities. A node carries an
   `id`, a `task` reference, and the three attributes the *flow layer* owns: `domains`, `decide`, `wait`.
3. **A profile never names a permission.** A profile states obligations; capabilities live in the task
   and are enforced by the engine, never by prose.

## 2. Profiles — the composed system prompt

Three layers are composed into the system prompt at every run boundary, in this order:

```text
conduct   .pi/praxis/profile/conduct/<id>.json   the fixed base          (selected by project config)
role      .pi/praxis/profile/role/<id>.json      the seat                (PRAXIS_ROLE)
domain?   .pi/praxis/profile/domain/<id>.json    what the subject needs  (declared on the FLOW NODE)
environment                                       Pi's own prompt, last
```

- **conduct** is always the same text; **role** is one seat per session; **domain** is the only dynamic
  layer, and it is declared **on the flow node**, never on the task — the same task can run as a mail
  task in one flow and a code task in another.
- A node may declare **several** domains (up to 6). They are **union-composed**: overviews in
  declaration order, then the entries, deduplicated. `examples/flows/examples/inbox-triage.json` declares
  `domains: ["email-ops", "billing-ops"]` on its first node, so that step reads both.
- The last line is always the advisory: a profile guides conduct, it grants nothing and enforces nothing.

Every profile is a strict object; the fields you will actually write are:

```jsonc
{
  "id": "email-ops",        // MUST equal the file stem
  "version": 1,
  "layer": "domain",        // MUST equal the folder: conduct | role | domain
  "name": "Email operations",
  "description": "…",       // META only: the catalogue line, never injected
  "overview": "…",          // ≤ 280 chars, injected first
  "invariants": ["…"],      // always hold
  "prefer":     ["…"],      // what to do
  "avoid":      ["…"],      // what not to do, with the reason
  "examples":   [{ "bad": "…", "good": "…", "note": "…" }]   // optional, ≤ 6
}
```

## 3. Tasks — the atom

A task owns four things: what the step must achieve (`goal`, `rationale`, `scope`), what the artifact
must contain (`requires`), what "good" means (`quality`), and who may submit it (`role`).

```jsonc
{
  "id": "triage",                    // MUST equal the file stem
  "version": 1,
  "state": "published",              // only a published task may be pinned
  "gate": "section-requirements",    // or "schema-valid-and-nonce"
  "goal": "…",                       // what the step must achieve; required
  "rationale": "…",                  // why the stage exists (the judge reads it)
  "scope": "…",                      // what the step is NOT about
  "capabilities": ["artifact.write", "emit", "evaluate"],   // closed set of four names
  "produces": { "schema": "praxis.artifact.triage/v1" },
  "role": "support-analyst",         // who may submit; absent means the instance creator
  "bindsSubject": false,             // a reviewer sets true: judge a NAMED version, never your own
  "requires": [ /* the section contract, below */ ],
  "quality":  { /* the rubric, §4 */ }
}
```

**`requires` is a contract, not a suggestion.** Each clause names a section and what must be in it. The
gate reads the *artifact*, so the artifact must be shaped the way the clauses describe:

| Clause key | Meaning |
| --- | --- |
| `section` | the section id the artifact must carry |
| `required` | field names that must be present and non-empty |
| `each` | field names every array entry must carry (with `minItems`) |
| `minItems` | how many entries the section needs |
| `strict` | reject any field the clause does not name |
| `equals` | exact values a field must carry (e.g. `{"verdict": "PASS"}`) |
| `goal` / `rationale` | the judge-facing *purpose* of the section — written for the scorer, not the agent |

`goal`/`rationale` on the **task** are the judge's context; `goal`/`rationale` on a **clause** tell the
judge what that section is *for*, which is what makes a section-targeted criterion meaningful.

## 4. The quality-dimension discipline (read this twice)

Every dimension and every probe must be **affirmative**, **specific** and **jev-provable**. This is the
single thing most likely to make a rubric useless while looking perfectly valid.

### The three rules

1. **Affirmative — state what the artifact HAS.** Never phrase a criterion as an absence: *"is not
   vague"*, *"lacks filler"*, *"fails to cite"*. A judge asked to detect an absence scores a coin flip,
   because absence is not a property of the text. Say what should be *there*.
2. **Specific — name the field, the section, the act.** *"High quality"*, *"clear"*, *"thorough"* are
   moods. A specific claim can be checked by a reader who has only the artifact.
3. **Jev-provable — the claim must be provable from the artifact's own content, and the probe must point
   at where.** A probe with `sections` tells the judge exactly which part of the artifact to read. A
   claim about the agent's *reasoning*, *effort* or *intentions* is not in the artifact, so jev cannot
   ground it — and the schema refuses a `sections` value that the task does not declare in `requires`,
   so an ungroundable claim cannot even name a target.

### Good vs bad

| Kind | BAD | Why it fails | GOOD |
| --- | --- | --- | --- |
| dimension | "The report is not vague." | negative; nothing to locate | "Each finding names the place in the draft where the defect appears and the consequence it causes." |
| dimension | "The answer lacks filler." | negative; no field to read | "The message section states who sent it, what it asks for and any deadline it names." |
| dimension | "Quality is high." | a mood, not a property | "The assessment verdict follows from the findings recorded above it." |
| dimension | "The agent reasoned carefully." | not in the artifact at all | "The classification names exactly one label and states why each other label does not apply." |
| `noul` probe | "The document is not missing key facts." | negative | "Each of the required fields in the classification is present with a concrete value." |
| any probe | `{ "type": "noul", "instructions": "It is good." }` | untargeted and unfalsifiable | `{ "type": "noul", "instructions": "Each finding names the place in the draft where the defect appears.", "sections": ["findings"] }` |
| `score` probe | levels "bad / ok / good" | adjectives, no observable difference | "the evidence is a restatement of the topic" / "the evidence names message text that bears on the label" / "the evidence quotes the decisive message text and ties it to the label" |
| `choice` probe | a clean option phrased as a fault | a fault is not a satisfied state | options `deadline_recorded` / `deadline_omitted` / `deadline_invented`, clean = `deadline_recorded` |

### The choice trap

A `choice` probe scores **1 only on its `clean` option**. If the clean option cannot be reached by a
legitimate artifact, an honest answer scores zero and drags the dimension below its bar. So the clean
option must cover **every legitimate state**, and the other options must name the faults:

```jsonc
"criteria": {
  // GOOD: the clean option covers "there is a deadline" AND "the message names none"
  "deadline_recorded": "the section states the deadline the message names, or states that the message names none",
  "deadline_omitted":  "the message names a deadline that the section leaves out",
  "deadline_invented": "the section states a deadline the message does not name"
},
"clean": "deadline_recorded"
```

**This trap is not hypothetical:** the first draft of `tasks/examples/triage.json` had
`stated / none_named / omitted` with `clean: "stated"`, which punishes a message that names no deadline.
It is in `DESIGN.md` as the mistake the examples are built to avoid.

### The one place a fault belongs

Score levels run worst-first, and a `choice` option that is not `clean` names a fault — so those lines *do*
describe what a deficient artifact looks like ("the summary records no topic"). That is their job: the level
names an **observable state**, which is what makes the score reproducible. The rule applies to the
**dimension statement**, the **probe instruction** and the **clean option**: those assert a property, never an
absence. Every task in this directory was audited mechanically for exactly that split.

### What the schema already enforces

- a probe's `sections` must name a section declared in `requires` — the task is refused otherwise;
- probe ids are unique inside a dimension; at most **6 probes per dimension**, **48 per rubric**;
- `choice`: 2–8 options and a `clean` key that is one of them; `score`: 2–10 ordered levels, worst first;
  `noul`: no criteria at all;
- dimensions: 1–8, each an id (≤64) and an affirmative `statement` (≤500).

### How the gate uses all this

Every dimension is scored, then compared against a **measured** bar — a quantile of the carried work for
that dimension, never an authored number — and **every** dimension must pass (a pure AND). Scores are
recorded with their evidence. If a dimension keeps refusing, the fix is the *dimension*: it is either not
affirmative, not specific, or not groundable in the artifact. Raising nothing, and editing no bar, will
help.

## 5. Flows — the wiring

```jsonc
{
  "schema": "praxis.flow/v2",
  "flow": "flows/examples/inbox-triage",   // MUST equal the file's path under .pi/praxis/flows/
  "nodes": [ /* 1..16, declared in execution order */ ],
  "edges": [ /* 0..32 */ ],
  "result": "praxis.result/v1"
}
```

Four edge kinds:

| Kind | Meaning |
| --- | --- |
| `data` | sequence: run `to` after `from`, handing over its accepted artifact |
| `refuse` | the rework target when a gate refuses — from a later node back to an earlier one |
| `branch` | one of N successors, chosen by the node's `decide` block; the edge carries the `label` |
| `join` | several sources into one node — **see "what is not composable" below** |

Node attributes beyond `id` and `task`:

- **`decide`** (2–8 `criteria`): the node routes to exactly one labelled arm, and the criteria keys must be
  **exactly** the labels of that node's branch edges. A deciding node emits no `data`/`join` edge.
- **`wait`** (`on.type` + optional `match` of up to 8 fields, optional `timeoutMs`): arriving at the node
  **parks** the instance (status `waiting`) until a host delivers a matching event. The timeout is
  evaluated **lazily**, when someone resumes — nothing sweeps. `match` is exact equality over declared
  fields.
- **`domains`**: the domain profiles this step runs under.

### The three example flows

```text
inbox-triage.json          inbox-triage-human.json         change-loop.json
  [triage]  wait(email)      [triage]  wait(email)           [brief] --data--> [implement]
     | decide                  | decide                                    ^   --data--> [review]
  +--+--+--+                 +--+--+--+                                    |               |
  v  v  v  v                 v  v  v  v                                 [refuse] <--------+
 reply arch esc            reply(human) arch esc
 (one arm runs; the others never start)
```

- **`inbox-triage`**: the first node already waits, so `start` returns a **parked** instance. A host
  resumes it with an `email.received` event; the triage step runs, its artifact is judged, and the router
  picks **one** of `reply` / `archive` / `escalate`.
- **`inbox-triage-human`**: identical, except `reply` waits for a **human** (`human.submitted` with
  `match: {step: "reply"}`). A human node is not a separate mechanism — it is a wait, followed by the
  ordinary gate.
- **`change-loop`**: the loop you run when quality *is* the gate. `review` declares `bindsSubject`, so it
  judges a named version and never its own work; a refusal on `review` sends the work back to
  `implement` through the `refuse` edge.

### What is NOT composable today (and why)

- **`join` is reserved.** A join needs two or more distinct sources. Reaching a node with two
  predecessors requires a node that fans out, and only `branch` may fan out — but branch arms are
  **mutually exclusive**, so a join fed by two arms would wait for work that never runs and the run fails
  closed at the join (`ARTIFACT_UNAVAILABLE`). No shipped flow uses `join`. The examples do not teach a
  shape that cannot run; when a parallel-fan-out primitive exists, a join becomes expressible.
- **Nesting is gated.** A node cannot reference a sub-flow yet; that needs the flow-expansion and
  budget gates (#4/#8) opened.
- **A branch arm cannot reconverge into a `join`**, and a `refuse` edge may not target a `wait` node
  (re-parking on rework would discard the resume receipt and hang the run).

## 6. End to end — the same run twice

### A. `change-loop`: sequence, a refusal, and a loop

The host starts the run (the CLI is the host surface; the agent uses the `praxis` tool):

```sh
PRAXIS_CONFIG=.pi/praxis/flows/examples/change-loop.json \
PRAXIS_STORE_DIR=/tmp/praxis-demo \
  node src/cli.ts run flows/examples/change-loop --request demo-1
```

```jsonc
// the six-key result — status running, nothing accepted yet
{ "instanceId": "i…", "flow": "flows/examples/change-loop", "status": "running",
  "artifacts": [], "summary": "running at brief: 0 artifact(s) accepted", "nextAction": "resume" }
```

1. The agent does the work, then **dry-runs** the shape with `op=check` (read-only: it reports the sections
   still missing and writes nothing), and **submits** with `op=submit`.
2. The gate decides: `schema-valid-and-nonce` or `section-requirements` first, then the quality rubric
   against the measured bars. On accept the artifact is recorded and the instance moves:
   `{ … "artifacts": [{"step":"brief","version":1,"digest":"sha256:…","schema":"praxis.artifact.brief/v1"}],
   "summary": "running at implement: 1 artifact(s) accepted", "nextAction": "resume" }`
3. **The learning note.** A step that reached its terminal outcome owes a note. The next advance refuses
   to move until `op=note` records it (`INSTANCE_STATE_INVALID`, "step … is awaiting its learning note"),
   and after a bounded budget the engine writes a `stub: true` note itself — an agent can delay the flow,
   never deadlock it. The objective half (scores, dimension, attempts) is derived from the events; only the
   agent's own reflection is written.
4. `implement` runs **with the brief's accepted artifact as its handoff** (the four fields: step, version,
   digest, schema). Its own quality can pass or refuse.
5. Suppose `review` refuses (`bindsSubject`: it judged a named version, never its own work). A refusal is
   **evidence, not death**: the `refuse` edge re-points the instance to `implement` and the loop runs
   again. Nothing is lost; the refusal and the verdict stay in the log.
6. An accepted `review` has no successor, so the instance closes:
   `{ … "status": "completed", "summary": "completed: 3 artifact(s) accepted", "nextAction": "none" }`

### B. `inbox-triage`: parking, waiting, resuming, routing

```sh
PRAXIS_CONFIG=.pi/praxis/flows/examples/inbox-triage.json \
PRAXIS_STORE_DIR=/tmp/praxis-demo \
  node src/cli.ts run flows/examples/inbox-triage --request mail-7
```

The **first node waits**, so `start` returns an instance that is already parked — nothing was executed:

```jsonc
{ "instanceId": "i…", "flow": "flows/examples/inbox-triage", "status": "waiting",
  "artifacts": [], "summary": "waiting at triage: 0 artifact(s) accepted",
  "nextAction": "wait: email.received" }
```

A parked instance **refuses to advance** (`INSTANCE_STATE_INVALID`) — that is the point: the work cannot
be pushed forward by an eager agent. The host delivers the outside event:

```sh
cat > /tmp/event.json <<'JSON'
{ "type": "email.received", "fields": { "from": "customer@example.com", "subject": "Refund for order 4471" } }
JSON
node src/cli.ts resume <instanceId> --event /tmp/event.json
```

The event is matched against the park's declared predicate (`type` plus exact equality on any `match`
fields), one `wait.resumed` receipt is written, and the instance returns to `running` **at the same step**.
Then:

1. the agent submits the triage artifact; the gate accepts it;
2. the **router** reads the accepted artifact and records **one** `branch.decided` with a label —
   `reply`, `archive` or `escalate`;
3. the instance moves to that one arm. **The other arms never start.**
4. that arm's task runs, is gated, takes its note, and closes the instance.

Two failure modes worth knowing: an event that does not match (wrong `type`, or a declared field with a
different value) is refused `WAIT_EVENT_INVALID` **with no write at all**; a park whose declared timeout has
passed fails the instance closed (`WAIT_TIMEOUT`) the next time somebody resumes it. Timeouts are
evaluated **lazily** — nothing sweeps parked instances.

## 7. Copy it into your project and run it

```sh
mkdir -p .pi/praxis/tasks/examples .pi/praxis/flows/examples \
         .pi/praxis/profile/conduct .pi/praxis/profile/role .pi/praxis/profile/domain

cp examples/tasks/examples/*.json   .pi/praxis/tasks/examples/
cp examples/flows/examples/*.json   .pi/praxis/flows/examples/
cp examples/profile/conduct/*.json  .pi/praxis/profile/conduct/
cp examples/profile/role/*.json     .pi/praxis/profile/role/
cp examples/profile/domain/*.json   .pi/praxis/profile/domain/
```

Two invariants make the copies work, and both are checked by the loader: a **flow key must equal its path**
(`flows/examples/inbox-triage` ↔ `.pi/praxis/flows/examples/inbox-triage.json`), and a **task reference names
its library path** (`tasks/examples/triage` ↔ `.pi/praxis/tasks/examples/triage.json`). The ids inside the
files equal the file stems.

Select a flow, and point the store somewhere scratch:

```sh
export PRAXIS_CONFIG=.pi/praxis/flows/examples/inbox-triage.json
export PRAXIS_STORE_DIR=/tmp/praxis-demo
node src/cli.ts run flows/examples/inbox-triage --request mail-7
```

`praxis status <instance>` shows the durable state, `praxis artifact read <instance> <step>` shows one
accepted artifact, and `praxis metrics` projects the quality history. In an agent session the same work goes
through the `praxis` tool (`start`, `check`, `submit`, `note`, `read`, `recall`).

### Validate your own copies before you submit them

Save this as `/tmp/check-task.mjs` (adjust the first path to your checkout) and run it on each file you
write. It uses **the schemas the engine uses**, so it catches a dimension whose `sections` are not declared,
a bad probe shape and a malformed section contract — the three mistakes that otherwise surface only at
`op=start`:

```js
import { readFileSync } from "node:fs";
import { TaskConfigSchema } from "/path/to/praxis/src/types/schema.ts";
const doc = JSON.parse(readFileSync(process.argv[2], "utf8"));
const r = TaskConfigSchema.safeParse(doc);
console.log(r.success ? "task OK: " + doc.id : r.error.issues);
```

```sh
node --experimental-strip-types /tmp/check-task.mjs .pi/praxis/tasks/examples/triage.json
```

Every file in this directory was validated the same way, plus each flow through the engine's own
`openFlow` (task references, the criteria↔label bijection, the merge-slot rule and the domain profiles).

## 8. Where to go next

- `docs/FLOWS.md` — the control-flow algebra in full: what is built, what is proposed, what is gated.
- `ARCHITECTURE.md` — the technical state: modules, the event catalogue, the quality engine, the gates.
- `docs/WORKFLOW.md` — how a unit of work is gated (the same loop these tasks model).
- `.pi/praxis/tasks/discovery/research.json` — the reference rubric for a real, multi-dimension task.
- `AGENTS.md` — scope, the authorization ledger, and the open gates.
