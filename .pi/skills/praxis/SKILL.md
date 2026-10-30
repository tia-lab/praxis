---
name: praxis
description: Drive the single `praxis` tool through one step of a Praxis flow — read the step brief and the recall you were given, build a typed artifact, dry-run it, submit it, learn from the refusal or close the step with a learning note. Use whenever the `praxis` tool is available in this session and you have been given a flow step to run.
---

# Praxis — running a step with the one tool

Praxis owns the boundaries and the record of work; you own the choices inside them. This
skill is the whole of the ergonomics: five operations, one loop, and the two documents the
runtime hands you (the **step descriptor** and the **result**). Nothing else is needed.

Read this once, then follow the loop. You do not need to read Praxis source to know the
standard — it arrives in the brief at runtime.

## What this skill does not do

- It **guides conduct; it enforces nothing.** Permissions, the acceptance decision and the
  record are enforced in code, by the tool. If you skip a step here, the gate refuses you.
- It does **not** state the scoring rules. The judging standard is in the runtime brief
  (`brief.quality`), which is derived from the task you were dispatched. Learn it from
  there, every run — it can tighten as the task's history proves competence.
- It does **not** let you choose or switch your flow. The flow, the task and the profile are
  fixed for you at spawn by whoever dispatched you. You pass the flow you were given; you
  never shop for a different one.
- No claim of isolation, trusted identity or exactly-once execution is made anywhere. Tools
  other than `praxis` are not blocked by this runtime; only calls routed through the tool
  are gated.

## The tool

One tool, `praxis`, with these operations. Every call is a single JSON argument object.

| op | requires | returns |
| --- | --- | --- |
| `start` | `flow`, `requestId` | `{ result, step, nonce }` — opens **or re-opens** the instance that request id names |
| `check` | `instance`, `artifact` | `{ ok, missing[], step }` — dry run, records nothing |
| `submit` | `instance`, `artifact` | `{ result, step }` — advances exactly one step, or refuses |
| `note` | `instance`, `subjective` | `{ result, step, note{step, noteVersion, stub, missing?} }` |
| `read` | `instance`, `step` | `{ artifact, value }` — one recorded artifact, only if this step grants it |

A refusal is not an exception: it comes back with `code`, `message` and a `detail` object,
and nothing in the flow has advanced. Read the code, not the prose.

## The loop

### 1. Start (or resume) and read the descriptor

```
praxis { op: "start", flow: "<the flow you were dispatched on>", requestId: "<your unit's id>" }
```

The same flow + request id always addresses the same instance, so **re-calling `start` is how
you resume** — never invent a new request id to "get a fresh start", that forks the work.
A different session using your request id is refused (`REQUEST_CONFLICT`).

You get back three things:

- `result` — the six keys the parent sees: `instanceId`, `flow`, `status`,
  `artifacts[]` (`step`, `version`, `digest`, `schema`), `summary`, `nextAction`.
  Keep `instanceId`: every later op needs it.
- `step` — the descriptor for the step you are on now:
  - `id` — this step; `steps[]` — the whole flow in order, so you know where you are;
  - `capabilities[]` — what this step may do; `ops[]` — **which operations are live right
    now** (do not attempt an op that is not listed);
  - `brief` — the work: `goal`, `produces` (the schema name your artifact must declare),
    `requires` (the section contract), and when they apply `consumes[]`, `derivedFrom`,
    `subject`, `bindsSubject`;
  - `brief.quality` — **the standard**: `dimensions[{id, statement}]`, `threshold` (the
    bar in force for this run, which may have risen), `aggregation`, `judging` (how the
    judge reads your artifact), and `recall`.
- `nonce` — carry it into the artifact on every submit.

**Read the recall before you work.** `brief.quality.recall` holds `weakSet[]` — the
dimensions currently costing this task the most — and `notes[]`, each a prior agent's lesson
(`whatWrong`, `whatRight`, `whatBetter`, `tags[{dimension, lesson}]`, the score it hit and
its `relevance`), plus `bar`. Aim your effort at the weak set, and reuse the lessons
instead of rediscovering them. An empty recall on a cold task is normal: you are the first,
and your note seeds it.

### 2. Do the work

The brief's `goal` and section contract are the whole assignment. Ground every claim: a
judged dimension is usually about whether a claim is tied to something real, so keep the
evidence in the artifact rather than in your head.

### 3. Dry run until clean, then submit

```
praxis { op: "check", instance, artifact: {...} }        // { ok, missing[], step }
```

`check` validates **only** the section contract — not the schema name, not the nonce, not
the score. It records nothing: no event, no attempt spent, no budget consumed. Call it as
often as you like while shaping the document; it is free.

When `ok` is true, submit:

```
praxis { op: "submit", instance, artifact: {...} }
```

The artifact is one JSON object carrying:

- `schema` — exactly `brief.produces`;
- `nonce` — exactly the nonce `start` returned;
- every section `brief.requires` names, with its required fields;
- when the brief names them: `derivedFrom` (the digest of the single artifact you consume —
  copy it from `brief.consumes[0].digest`), all `consumes[].digest` values for a join, and
  `subject` when the step binds one (`brief.subject` — a review binds the digest it judged).

A refusal here means the deterministic gate rejected the document (`ARTIFACT_INVALID`,
`SUBJECT_MISSING`, `SUBJECT_STALE`, `ARTIFACT_DIGEST_MISMATCH`…): the details name the
check that failed. Fix and resubmit. Identical bytes will be judged once, not twice.

Once a step is accepted you may read its recorded bytes with `op=read` **if** `read` is in
`ops`; otherwise the step has no read grant and you work from what you already have.

### 4. If the judgment refuses you

A below-bar refusal returns `detail` with `checks` and `compound`, and `detail.quality`
holding:

- `dimensions[{id, score, statement, belowThreshold}]` — every dimension, its score and the
  rubric line it was scored against;
- `weakest` — the lowest;
- `compound.flagged[]` — dimensions that passed only narrowly, `compound.refused[]` — the
  ones that failed their own bar, `compound.mean` — the overall mean against the
  `detail.quality.threshold` in force;
- `lesson` — a targeted prior lesson for the weakest dimension when one exists.

Fix what the numbers say, not what feels close: a dimension in `refused` must be genuinely
improved; a high mean does not buy a weak dimension through. A resubmission must carry
**changed bytes**.

The attempt budget is per step, and the loop stops when it is spent or the score stops
moving. At that point the task's failure policy decides, and both outcomes are recorded:
either the best attempt is carried forward **marked as failed** (the step advances, and your
note must say what did not hold), or the instance ends `failed` with
`nextAction: "needs-guidance: …"` and the refusal detail carries `attempts` and
`maxAttempts` — then stop and report; do not retry blindly.

### 5. On pass: close the step with the note

An accepted artifact is not a closed step. The step owes a **learning note**, and its own
descriptor will show `note` in `ops` instead of `submit`:

```
praxis { op: "note", instance, subjective: {
  whatWrong:  "<what did not hold on the attempt that missed>",
  whatRight:  "<what already held and needs no fixing>",
  whatBetter: "<a concrete improvement for the next agent — not a restatement>",
  tags: [ { dimension: "<rubric dimension id>", lesson: "<one actionable sentence>" } ]
} }
```

Rules the gate applies, so you can pass first time:

- `whatBetter` must be non-empty **and must not restate** `whatWrong`; `whatRight` present;
- every `tags[].dimension` is a real dimension id from `brief.quality.dimensions`;
- at least one tag on the **weakest** dimension, and **one tag for every dimension the verdict
  reported as flagged** — a dimension that only passed narrowly is exactly the mediocrity this
  step must not close over. A note that ignores a flagged dimension is refused, and the
  `tags:` gap names that dimension (as the weakest one, or as passing only inside its
  tolerance band).
- If you keep sending inadequate notes the engine eventually records a `stub` in your name
  and moves on (`note.stub: true`): the omission is recorded against you, so write the real
  thing.

The note's objective half (outcome, scores, weakest dimension, attempts, the judged digest)
is written by the engine from the record — you supply only the reflection.

## Worked example — the `research` step

```
start   { op:"start", flow:"flows/engineering/feature", requestId:"unit-42" }
        -> result{instanceId, artifacts:[], summary, nextAction}, nonce
           step.id "research", steps ["research","spec","plan","implement","verify","review"]
           brief.goal "establish what is true from sources and the code before anything is designed"
           brief.produces "praxis.artifact.research/v1"
           brief.requires: contract{task,scope,acceptance}, question{question,boundary},
                           sources[>=2 x {source,location,establishes}], findings[>=1],
                           affected[>=1 x {path,declaration,effect}], uncertainty[>=1]
           brief.quality.recall.weakSet [], notes []   (cold task: you seed it)

check   { op:"check", instance, artifact:{ schema, nonce, contract:{...}, question:{...},
          sources:[{...},{...}], findings:[...], affected:[...], uncertainty:[...] } }
        -> { ok:true, missing:[], step:"research" }

submit  { op:"submit", ...same artifact... }
        -> accepted -> result.status "running", step.id "spec",
           step.ops ["note","read"]   (or refused: read the numbers and resubmit)

note    { op:"note", instance, subjective:{ whatWrong, whatRight, whatBetter,
          tags:[{dimension:"grounded",lesson:"…"}, … one per flagged dimension …] } }
        -> note{step:"research", noteVersion:1, stub:false}, then the next step's descriptor
```

Then continue with the next step the descriptor names. You never pick the next step: the flow
does.

## When something is wrong with Praxis itself

If the tool refuses you in a way the brief cannot explain, or a field you need is missing from
the descriptor, say so in your report — and if the project has issue reporting enabled, use
`op=issue.template` then `op=issue.open` with the evidence. Do not work around a broken
contract by guessing at hidden fields.
