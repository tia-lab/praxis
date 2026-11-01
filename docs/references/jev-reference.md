# jev / TypeSafe System One — reference for Praxis authors

> **What this file is.** Everything Praxis can do with jev, gathered from the TypeSafe docs, the local
> public-examples repo (`.dev/typesafe-public-examples-main/`, §4b), our `pi-jev` client and this repo's own
> code, so nobody has to re-search the web. Every claim carries a
> tag: **[doc: /page.md]** = the TypeSafe docs (full URLs in §10), **[source: path:line]** = code read in
> this machine, **[example: <path>]** = a shape read from a cached example request/answer in the local
> public-examples repo, **[proposed]** = a design idea, not shipped behaviour, **[v0.3.0+]** = would need
> a pi-jev release beyond the installed 0.2.2 (no claim below needs one today). Nothing here is measured
> unless a doc or an example states it.

**The one caveat, up front.** jev is a *decision* model, not a text generator: it evaluates a state and
returns typed answers (choice / score / noul). It does not write prose, code, or explanations of its
reasoning. [doc: /concepts/system-one.md] [doc: /introduction/coding-agents.md] Any "rationale" Praxis
shows is either a label jev picked or text Praxis rendered from labels — never model prose
[source: src/quality/jev-scorer.ts:121].

---

## 1. The three primitives

Every question has an `id` (the key you read the answer under), a `type`, and `instructions`; choice and
score also take `criteria`. Every question in a request sees the same `state`, is judged independently,
and comes back under its own id. [doc: /primitives.md]

| Primitive | Ask it for | Answer fields | Use it when |
| - | - | - | - |
| `choice` | one option out of a named set | `choice`, `probabilities` (all options, sums to 1), `confidence` | routing, classification, picking a field value [doc: /primitives/choice.md] |
| `score` | a level on an ordered rubric | `score` (a fractional position, e.g. `1.43`), `probabilities` per level, `legend` (level → description), `confidence` | gradations: severity, completeness, quality [doc: /primitives/score.md] |
| `noul` | the probability that a statement is true | `noul` in `[0,1]` — **no confidence field** | atomic yes/no facts you then combine in code [doc: /primitives/noul.md] [doc: /confidence.md] |
| `box` | where something is in an image | `box {top,bottom,left,right}` + `confidence` | images only — **not available to Praxis** (no image support in our client) [doc: /primitives/box.md] [source: node_modules/pi-jev/dist/src/types.d.ts:1-14] |

**Reading probabilities.** `probabilities` is the full distribution; the answer (`choice`, `score`) is
derived from it: a score is the probability-weighted level position, so a split between levels 1 and 2
(`0.57/0.43`) reads `1.43`, not `2`. [doc: /primitives/score.md]

**Reading confidence.** `confidence` collapses the shape of that distribution into `0..1`: `1` when all
probability sits on one outcome, `0` when it is spread evenly; for a three-option choice the formula is
`(3 × largest − 1) / 2`. Flat = the model is torn, which usually means the question or the option set is
under-specified, not that the state is ambiguous. [doc: /confidence.md]

**Reading noul.** A noul is a calibrated probability, and calibration is measured across groups of
predictions — it does not promise that one answer is right. [doc: /concepts/system-one.md] Threshold it
in code; do not treat `0.51` as a fact.

---

## 2. Structured EntryType (JSON instead of strings)

The docs allow **structure wherever text is allowed**: `instructions`, choice option descriptions, score
level descriptions, and noul `criteria.true` / `criteria.false`. Each accepts `string`, `object`, `array`,
or `null`. [doc: /primitives/advanced.md]

```json
{ "type": "noul", "instructions": {
    "question": "Does the claimed sender identity conflict with the sending domain?",
    "compare": ["ticket.sender.display_name", "ticket.sender.email"],
    "focus": "Compare the named organization with the email domain." } }
```

```json
{ "type": "choice",
  "instructions": "Which department owns this product?",
  "criteria": {
    "sporting": { "covers": "bikes, bottles, cages", "excludes": "drinkware for the home" },
    "home":     { "covers": "drinkware, kitchen", "excludes": "cycling accessories" } } }
```

*Structure when it adds clarity or when the data is already JSON* — a schema, a taxonomy node, a database
row can be passed whole instead of serialized into a string template. [doc: /primitives/advanced.md]

**Status in Praxis — available now.** The installed, pinned client is `pi-jev` **0.2.2** and it already
types the structured shape: `EntryType = string | number | boolean | null | EntryType[] | { [k: string]: EntryType }`,
`ChoiceQuestion.criteria: Record<string, EntryType>`, `ScoreQuestion.criteria: EntryType[]`
[source: node_modules/pi-jev/dist/src/types.d.ts:2-23]. (The earlier plan to ship this in 0.3.0 is
superseded: 0.2.2 carries it.) The praxis *probe schema* is what still restricts criteria to plain strings —
`Record<string,string>` or `string[]`, no objects — so a structured probe would be a schema change here, not
a client one [source: src/types/schema.ts:148-190] **[proposed]**.

**Noul criteria** (`criteria.true` / `criteria.false`) pin a subtle yes/no boundary with a definition and
examples on each side [doc: /primitives/advanced.md]. The client types them
[source: node_modules/pi-jev/dist/src/types.d.ts:11-18] and the public examples *use* them — the
function-calling dispatcher builds set-membership nouls as
`{"type":"noul", "instructions": …, "criteria": {"true": …}}`
[source: .dev/typesafe-public-examples-main/cookbooks/function_calling/dispatch.py:79-86]. Praxis's probe
schema does not expose a noul's criteria yet [source: src/types/schema.ts:148-172] **[proposed]**.

---

## 3. Batching: many questions, one request

* Each question is judged **independently** against the state, so its answer does not depend on what else
  is in the request; ask everything the code *might* need and ignore what you do not. [doc: /primitives.md]
* One batched call is dramatically cheaper and faster than N calls: a 13-question GDPR run measured
  **12.2× cheaper and 10.0× faster with no change in answers** (run-to-run std dev 0). [doc: /cookbooks/parallel_questions.md]
* Documented limits: **no separate cap on the number of questions** per request [doc: /models.md] — what
  binds is context: **64k tokens per request**, **32k per question** (state + one question), raisable via
  long context [doc: /models.md]. HTTP body ≤ **32 MiB**, ≤ **64** nesting levels, finite numbers only,
  UTF-8 JSON [doc: /api/errors.md].
* **Our client is stricter than the API** [source: /media/Development/AI/pi-jev/src/client.ts:5]: at most
  **128 questions** and **262 144 request bytes** (the response is capped at 1 MiB). Praxis therefore
  bounds probes at parse time — 6 per dimension, 48 per rubric [source: src/types/schema.ts:193-204].
* Edges: over 128 questions or 262 144 bytes pi-jev throws **before sending** [source: /media/Development/AI/pi-jev/src/client.ts:33-48];
  the API answers `413` for a body over 32 MiB and `400` for a broken request rule [doc: /api/errors.md].
* **Observed scale in a shipped example:** the structure-recovery cookbook asks **62 questions in one
  request** and caches a single `seconds: 0.51` for the whole call
  [example: .dev/typesafe-public-examples-main/cookbooks/autoformat/json_cache.json] — one call, not 62.
* **Question-id grammar is yours.** The function-calling example composes ids for routing, arguments,
  presence and set membership — `__tool__`, `plot_price.symbol`, `plot_price.symbol?`,
  `compare_returns.symbols.AAPL` [source: .dev/typesafe-public-examples-main/cookbooks/function_calling/dispatch.py:64-92].
  Praxis uses the same idea with `<dimension>.<probe>` [source: src/quality/jev-scorer.ts:89].

---

## 4. Method cookbooks — the patterns worth stealing

One row per page: the technique, the calls it makes, and what Praxis could do with it. All techniques are
[doc: /cookbooks/<name>.md]; the Praxis column is **[proposed]** unless it names shipped code.

| Cookbook | Technique | The calls | Praxis use |
| - | - | - | - |
| **Function calling** | Sentence → function name + closed-set arguments | one `choice` per argument plus one for the function, each with confidence | map an agent order to a *task* and its arguments instead of free-text routing [proposed] |
| **Skill suggestion** | Rank a 194-skill catalogue, then re-check the winner | request 1: `choice` over a shortlist; request 2: verify the top candidate | the two-request shape our jev ranker already uses for exemplars (rank, then one distinctness pass) [source: src/quality/ranker-jev.ts:83-101] |
| **Guardrails for LLMs** | Hazard screen that does not live in a prompt | a battery of `noul` hazards + one `score` for harm severity, thresholds in code | screen an incoming order for prompt-injection or out-of-scope work before `start` [proposed] |
| **Double-checking citations** | String-match for missing quotes, then judge the surviving context | one `choice` per quote: does its context support the claim | the `grounded` dimension's "locatable" probe is exactly this [source: .pi/praxis/tasks/discovery/research.json] |
| **Classifying RAG passages** | Second stage between retrieval and generation | one request per (query, passage) with four questions: relevant, usable, contradicts, instructs-the-model | classify recalled exemplars for relevance *and* for injection before showing them [proposed] |
| **Simple memory system** | Let jev decide what is worth remembering | one extra request per call: `noul` per candidate memory | decide which refusal reasons to keep as lessons [proposed] |
| **Hierarchical classification** | Walk a deep taxonomy level by level | one `choice` per level over that node's children, with the subtree as each option's description; parallel **beam search** keeping top-K paths | classify a task/flow into a directory tree, or pick the next step from a large flow library [proposed] |
| **Classification using confidence** | Easy vs hard cases from the same call | one `choice` per document; report the group when `confidence` is high, the parent when it is low | route low-confidence verdicts to a visible "unchecked" flag instead of a refusal [proposed] |
| **Twitch chat filter** | Per-message filter, concurrent | one request per message, three questions (kind, toxic, spoiler), rules in code | per-step screening of tool output or artifacts [proposed] |
| **SDE cascade** | mini → verify → reasoning | stage 1 mini model extracts; jev `noul`/`choice` verifies each field; the expensive model sees only disputes | our probe battery is the verify rung for the *quality* judgment; the same shape works for extraction [proposed] |
| **Date extraction** | Read the parts, resolve in code | one call of `choice` questions (kind, month, day, year, weekday); code builds the date; low confidence → review | extract task metadata (version, threshold) from prose orders [proposed] |
| **Pre-parsed value extraction** | Regex finds spans, jev picks one | `choice`/`noul` over candidate spans; code copies the exact span | pick a digest/path out of an order without letting a model produce it [proposed] |
| **Structure recovery** | Never rewrite the text | two requests: `noul` per line join, `choice` per block type; code renders Markdown | render an artifact summary from typed answers instead of generated prose [proposed] |
| **Shopping cart** | Shrinking-options loop | repeated `choice` questions over a shrinking item set, then one batched request per item for its fields | fill a task's required sections from an order in one pass [proposed] |
| **Reading a scanned vaccination record** | Image questions | `noul` per record, `box` per row, `choice` per cell including `unreadable` | not available to Praxis: no image/box support in our client [source: node_modules/pi-jev/dist/src/types.d.ts:1-14] |
| **OCR confidence and bounding boxes** | Verify extracted values | `box` per value, `score` against the page and against a crop, flag lows | same shape for verifying a claimed file:line citation, text-only [proposed] |
| **Feeder-cam visit log** | Frame-by-frame events | five questions per frame, one of them a `box` | not applicable (images) — but the "one request per frame, code builds the log" shape is [proposed] |
| **Re-ranking** | Shortlist then judge | BM25 shortlist of 30, then one question per (query, candidate); top-1 5% → 18%, top-10 38% → 62% | exactly our recall: deterministic pool of 20, then one jev ordering [source: src/quality/ranker.ts:355-361] |
| **Line-by-line search** | Score every line id | one `choice` over 218 line ids + a `noul` "does the document contain an answer" | find the section of a task document an order is really about [proposed] |
| **Knowledge graph entity alignment** | Decide duplicates, name the disagreement | one `score` per pair + three companion `noul`s for which fields disagree | diagnose *why* two verdicts disagree, without prose [proposed] |
| **Intelliprompter** | Live coverage of a checklist | one `score` per uncovered note on each transcript delta; latch when above threshold | track which required sections an artifact has actually covered, as the agent works [proposed] |
| **Self-consistency: choices** | Measure label stability | 15 repeats of an 8-`choice` rubric; compare labels across runs | measure whether a rubric's labels are stable before trusting its bar [proposed] |
| **Self-consistency: nouls** | Route instability to humans | 15 repeats of a 14-`noul` rubric; keep probabilities visible | detect a flaky dimension statement (the divergence signal, measured) [proposed] |
| **Parallel questions** | Batch is free | the same 13 questions as one call vs 13 calls: 12.2× cheaper, 10.0× faster, identical answers | keep our probe battery in ONE call — we do [source: src/quality/jev-scorer.ts:145-186] |
| **Autoresearch feature discovery** | Questions as features | an LLM proposes questions, jev answers them per row, a CatBoost model trains on the answers; errors drive the next round | propose new probes for a dimension from recorded failures [proposed] |

---

---

## 4b. Local examples — the same cookbooks, grounded in their own caches

The repository at `.dev/typesafe-public-examples-main/` (gitignored local evidence, read-only per
`AGENTS.md`) ships **21** of those cookbooks with their `json_cache.json`. Read honestly: the caches are
**answer/feature projections** keyed by a hash — question ids, answer values, `model`, `usage` and a
`seconds` field — **not raw request logs**. So they ground the *answer* side and the *question ids*; the
request text comes from the docs and, where a folder ships code, from that code.
[source: .dev/typesafe-public-examples-main/cookbooks/*/json_cache.json]

**Licence rule used here.** Nine folders carry a `DATA_LICENSE.md`: citation_check,
classification_using_confidence, classifying_rag_passages, feeder_watch, llm_guardrails,
parallel_questions, rerank_typesafe, semantic_find, skill_suggestion
[source: .dev/typesafe-public-examples-main/cookbooks/*/DATA_LICENSE.md]. For those, only the technique and
the TypeSafe question/answer **structure** are described — no dataset rows, no quoted corpus. Their data is
**[third-party data — see DATA_LICENSE.md]**. `question_tuning/` carries a third-party labelled dataset with
**no** licence file in the folder, so it is treated the same way.

### autoformat — structure recovery

Two batched `choice` questions per text block — “what kind of block is this?” and “what heading level?” —
**62 questions in ONE request** [source: .dev/typesafe-public-examples-main/cookbooks/autoformat/json_cache.json].
The cached judgment per block:

```json
{ "type": "heading", "hlevel": "title", "callout": "note", "confidence": 0.99,
  "probabilities": { "heading": 0.99, "list_item": 0.01 },
  "step": 0.13 }
```
[example: .dev/typesafe-public-examples-main/cookbooks/autoformat/json_cache.json]

**Praxis:** [proposed] render an artifact outline (which section, which level) from `choice` answers rather
than asking a model to write it.

### basic_memory — memory worth keeping

One `noul` per call: “is this worth remembering?” — the cached answer is literally `{ "remember": {
"type": "noul", "noul": 0.03 } }` [example: .dev/typesafe-public-examples-main/cookbooks/basic_memory/json_cache.json].

**Praxis:** [proposed] decide which refusal reason or lesson is worth keeping, with the same thresholded
`noul`.

### cart_from_primitives — a shrinking-options loop

One `choice` per field, repeated over a shrinking item set; the cache shows exactly the field answers:
`{ "size": { "choice": "large", "confidence": 1.0 }, "milk": { "choice": "oat", "confidence": 1.0 } }`
[example: .dev/typesafe-public-examples-main/cookbooks/cart_from_primitives/json_cache.json].

**Praxis:** [proposed] fill several required sections of an artifact from one prose order, one `choice` per
field, loop while options shrink.

### citation_check — does the context support the claim

One `choice` per claim × source, with three options `supports` / `says_nothing` / `contradicts`; the cache
records the full distribution and the latency:

```json
{ "choice": "says_nothing", "confidence": 0.56,
  "probabilities": { "contradicts": 0.28, "says_nothing": 0.71, "supports": 0.01 } }
```
[example: .dev/typesafe-public-examples-main/cookbooks/citation_check/json_cache.json] · the source text it
checks against is **[third-party data — see DATA_LICENSE.md]**.

**Praxis:** the `grounded` dimension's `locatable` probe is this pattern, at the probe level
[source: .pi/praxis/tasks/discovery/research.json].

### classification_using_confidence — easy vs hard from one call

One `choice` per document into a 75-group code system; the cache keeps the answer and its confidence
`{ "group": …, "confidence": …, "probabilities": { … } }`, which is what decides “report the group” vs
“report the parent division”. [example: .dev/typesafe-public-examples-main/cookbooks/classification_using_confidence/json_cache.json]
(Classification codes: **[third-party data — see DATA_LICENSE.md]**.)

**Praxis:** [proposed] the same read picks a visible “unchecked” flag over a refusal when a verdict is torn.

### classifying_rag_passages — filter before generation

Per (query, passage) pair, a battery: relevant? usable? contradicts? tries to instruct the model? The cache
keeps only the **downstream** answer text and token counts (`input_tokens`, `output_tokens`, `text`), so the
jev side is described from the docs [doc: /cookbooks/classifying_rag_passages.md]; the corpus is
**[third-party data — see DATA_LICENSE.md]**.
[example: .dev/typesafe-public-examples-main/cookbooks/classifying_rag_passages/json_cache.json]

**Praxis:** [proposed] screen recalled exemplars for “tries to instruct the model” before they reach the agent.

### date_extraction — read the parts, resolve in code

One `choice` per part, all in one request — `mode`, `year`, `month`, `day`, `weekday`, `week_offset`,
`day_anchor` — each with its own confidence:

```json
{ "mode": { "choice": "relative", "confidence": 0.94 },
  "weekday": { "choice": …, "confidence": … }, "month": { "choice": "none", "confidence": 0.99 } }
```
[example: .dev/typesafe-public-examples-main/cookbooks/date_extraction_cookbook/json_cache.json]

**Praxis:** [proposed] read structured metadata (a version, a threshold, a step id) out of a prose order as
parts, and resolve it in code.

### entity_alignment — decide duplicates, name the disagreement

No `json_cache` in this folder: it ships `candidate_pairs.json` — pairs of records with their comparable
fields (`id`, `entity_a{name, brewery, style, abv}`, `entity_b{…}`)
[example: .dev/typesafe-public-examples-main/cookbooks/entity_alignment/candidate_pairs.json]. The technique
(one `score` per pair plus companion `noul`s naming which fields disagree) comes from the docs
[doc: /cookbooks/entity_alignment.md].

**Praxis:** [proposed] diagnose *why* two judgments of the same artifact disagree, field by field.

### feeder_watch — one request per frame

Each cached frame stores a full response — `{ response: { answers, model, usage }, seconds }` — with the
question ids `bird_present`, `how_many`, `bird`, `species_left`, `species_right`, and a `box` answer:
`{ "type": "box", "box": { "top": …, "bottom": …, "left": …, "right": … }, "confidence": … }`
[example: .dev/typesafe-public-examples-main/cookbooks/feeder_watch/json_cache.json]. Frames and labels are
**[third-party data — see DATA_LICENSE.md]**.

**Praxis:** not usable — Praxis has no image or `box` support [source: node_modules/pi-jev/dist/src/types.d.ts:1-14];
the workflow shape (one request per unit, code builds the log) is reusable [proposed].

### function_calling — a question grammar, not a prompt

This folder ships its code, and it is the clearest example of composing questions from a spec:
`spec.json` declares each function, its closed-set arguments and the wording, and `dispatch.py` builds
[source: .dev/typesafe-public-examples-main/cookbooks/function_calling/dispatch.py:67-92]:

* a route `choice` under the id `__tool__` over every function name;
* a `choice` per argument (`<fn>.<arg>`) over its closed set;
* a **presence** `noul` per argument (`<fn>.<arg>?`) — “does the user state this?” — so a default can be kept;
* for set-valued arguments, one `noul` per member (`<fn>.<arg>.<member>`) with `criteria: {"true": …}`;
* and `read()` **drops** an argument when its presence probability is under `STATED`
  [source: .dev/typesafe-public-examples-main/cookbooks/function_calling/dispatch.py:159-200].

The cached answer shows exactly that shape — `__tool__` carrying a full probability vector over ten
functions, plus one `noul` per argument and per presence question
[example: .dev/typesafe-public-examples-main/cookbooks/function_calling/json_cache.json].

**Praxis:** [proposed] this is the pattern for “which op, with which arguments, and did the caller actually
say?” — the presence noul is the honest way to distinguish “not stated” from “stated as the default”.

### intelliprompter — live checklist coverage

One `score` per uncovered note, re-asked as the transcript grows; the cache keys the answers by
checklist and note (`c_<i>_<j>`) and stores a score position (`{ "score": 3.02 }`) — a fractional level,
not a label [example: .dev/typesafe-public-examples-main/cookbooks/intelliprompter/json_cache.json].

**Praxis:** [proposed] track which required sections an artifact has actually covered while the agent works.

### llm_guardrails — a hazard battery

One request per message with a `noul` battery plus a severity `score`; the cache stores exactly
`{ "nouls": { "harmful_request": …, "jailbreak": …, "medical_advice": …, "self_harm": … }, "severity": … }`
[example: .dev/typesafe-public-examples-main/cookbooks/llm_guardrails/json_cache.json]. The prompt corpus is
**[third-party data — see DATA_LICENSE.md]**.

**Praxis:** [proposed] the same battery shape on an incoming order, before `start` writes anything.

### ocr_confidence_bounding_boxes — verify extracted values

Per field: a `box` locating the value on the page (normalised `left`/`top`/`right`/`bottom`) plus `score`s
against the page and against a crop of that box; the cache stores the boxes per field name
[example: .dev/typesafe-public-examples-main/cookbooks/ocr_confidence_bounding_boxes/json_cache.json].

**Praxis:** not usable directly (images); the two-pass “locate, then score the crop” idea maps onto
verifying a claimed `path:line` citation text-only [proposed].

### parallel_questions — the batching measurement

Here the cache holds the **corpus** (one entry per document), not answers, so the measurement itself comes
from the page: 13 questions over one article, one batched call vs 13 calls — **12.2× cheaper, 10.0×
faster**, answers unchanged (std dev 0) [doc: /cookbooks/parallel_questions.md]. The article text is
**[third-party data — see DATA_LICENSE.md]**.
[example: .dev/typesafe-public-examples-main/cookbooks/parallel_questions/json_cache.json]

**Praxis:** already the rule — the whole probe battery goes in ONE call [source: src/quality/jev-scorer.ts:145-186].

### pre_parsed_value_extraction — regex finds, jev picks

One `choice` over candidate spans a regex already found, so a value cannot be invented:
`{ "choice": "jane.personal@example.net", "confidence": 0.97 }`
[example: .dev/typesafe-public-examples-main/cookbooks/pre_parsed_value_extraction_cookbook/json_cache.json].

**Praxis:** [proposed] pick a digest, path or id out of an order from candidates the code extracted.

### question_tuning — how a question is worded

No `json_cache` here: the folder ships one labelled dataset (`banking77_refunds.json`, rows of
`{ split, text, label, intent }`) [example: .dev/typesafe-public-examples-main/cookbooks/question_tuning/banking77_refunds.json],
so there is **no** TypeSafe request or answer shape to cite — it is a study of the questions themselves.
The dataset is third-party and the folder carries **no** `DATA_LICENSE.md`, so no rows are reproduced here.

**Praxis:** [proposed] treat question wording as the tunable artifact — a probe's `instructions` are worth
measuring like a rubric statement.

### reading_scanned_documents — yes/no, where, and what it says

Two passes: an image pass with a `noul` per record, a `box` per row and a `choice` per cell (including
`unreadable`), then a **text-only** follow-up. The cache keeps the second pass keyed by row
(`row-1` … `row-5`) [example: .dev/typesafe-public-examples-main/cookbooks/reading_scanned_documents/json_cache.json];
the scan itself is **[third-party data — see DATA_LICENSE.md]**.

**Praxis:** the two-pass shape (judge, then verify in a cheap second request) is worth copying [proposed].

### rerank_typesafe — shortlist then judge

One entry per (query, candidate) pair, 2 846 cached: `{ "probs": { "is_cited_source": …, "same_proposition": …, "shared_language": … }, "input_tokens": …, "output_tokens": … }`
— note **three `noul` probabilities per pair**, not one label, and the code ranks on the combination
[example: .dev/typesafe-public-examples-main/cookbooks/rerank_typesafe/json_cache.json]. The corpus is
**[third-party data — see DATA_LICENSE.md]**; the published result is top-1 5% → 18%, top-10 38% → 62%
[doc: /cookbooks/rerank_typesafe.md].

**Praxis:** this is exactly our recall architecture — deterministic shortlist, then jev ordering
[source: src/quality/ranker.ts:355-361] — with the trio of nouls as a [proposed] upgrade over one score.

### semantic_find — score every line id

One request scores every line of a document: the cache keeps `exists` (a noul) and a **per-line relevance
vector** (`relevance: [ … ]`), plus the latency
[example: .dev/typesafe-public-examples-main/cookbooks/semantic_find/json_cache.json]. The document is
**[third-party data — see DATA_LICENSE.md]**.

**Praxis:** [proposed] find the section of a task document or flow an order is really about, by scoring
every line id in one call.

### skill_suggestion — rank, then re-check

Two-stage: a shortlist of `fits` probabilities per candidate, then a `winner` choice — the cache stores both
`{ "winner": …, "fits": { … }, "seconds": … }` [example: .dev/typesafe-public-examples-main/cookbooks/skill_suggestion/json_cache.json].
The skill roster is **[third-party data — see DATA_LICENSE.md]**.

**Praxis:** the same two-stage shape our jev ranker uses for exemplars: pre-rank deterministically, then one
jev pass to choose [source: src/quality/ranker-jev.ts:83-101].

### twitch_chat_filter — one message, three questions

One request per message: a `choice` category with its full distribution, plus `toxic` and `spoiler` `noul`s;
the cache adds `model` and `seconds` per message
[example: .dev/typesafe-public-examples-main/cookbooks/twitch_chat_filter/json_cache.json]:

```json
{ "category": "conversation",
  "probabilities": { "conversation": 0.79, "hype": 0.21, "question": 0.0, "backseat": 0.0, "spam": 0.0 },
  "toxic": 0.28, "spoiler": 0.02, "model": "jev-1.14.0", "seconds": 0.07 }
```

**Praxis:** [proposed] per-artifact screening with a category plus two hazard nouls, rules in code.

## 5. Architecture patterns

| Pattern | Idea | Praxis use |
| - | - | - |
| **Speculative fan-out** [doc: /patterns/fan-out.md] | Ask every question you might need in one request; discard in code | our probe battery asks all dimensions' probes even though only one may matter |
| **Confidence-gated routing** [doc: /patterns/confidence-routing.md] | The answer says *what*; confidence says *whether to act* | threshold the alignment `choice`'s confidence rather than only its label [proposed] |
| **Composite scoring** [doc: /patterns/composite-scoring.md] | Atomic scores, weights in code | already how dimensions and bars work; jev supplies the atoms, Praxis the weights [source: src/quality/evaluate.ts:71-76] |
| **Intent routing** [doc: /patterns/intent-routing.md] | Classify the request, route to logic / specialist / human | route an order to the flow it belongs to instead of refusing [proposed] **[control-flow · future layer]** |

---

## 6. Our client: `pi-jev`

*Signature* [source: /media/Development/AI/pi-jev/src/client.ts:104]:

```ts
evaluate(request: JevRequest, opts?: EvaluateOptions): Promise<JevResponse>
JevRequest    = { state: unknown; questions: Record<string, Question>; model?: string }
EvaluateOptions = { signal?: AbortSignal; apiKey?: string; model?: string; fetcher?: typeof fetch }
JevResponse   = { model: string; answers: Record<string, Answer>; usage?: { input_tokens; output_tokens } }
```

* Endpoint: `POST https://api.typesafe.ai/v1/systemone` [source: /media/Development/AI/pi-jev/src/client.ts:3].
* Auth: `Authorization: Bearer <key>`; the key comes from `TYPESAFE_API_KEY` or `opts.apiKey`, is never
  logged, and is never returned [source: /media/Development/AI/pi-jev/src/client.ts:102-116].
* Client-side pre-flight validation (all throw *before* sending): 1–128 questions, JSON-serializable
  state, request ≤ 262 144 bytes, non-empty `model` if given, and per-question shape checks — choice needs
  named options, score needs 2–10 levels, noul needs only instructions
  [source: /media/Development/AI/pi-jev/src/client.ts:19-48].
* Response validation: every question id must be answered with the **same type**, confidence (if present)
  in `[0,1]`, a choice must be one of its criteria keys, a score inside `0..levels-1`; otherwise the whole
  call throws [source: /media/Development/AI/pi-jev/src/client.ts:61-93].
* Failure behaviour: no network error detail ever surfaces (headers could leak), a missing key is a
  plain error, `429`/`529` become `JevTransientError`, other non-2xx becomes `TypeSafe HTTP <status>`, and
  an oversized response throws [source: /media/Development/AI/pi-jev/src/client.ts:106-140].
* `EntryType` (structured instructions/criteria, including noul `criteria.true/false`) is part of the
  installed client's types, v0.2.2 [source: node_modules/pi-jev/dist/src/types.d.ts:2-23]; what Praxis has not
  done is *expose* it through the probe schema [source: src/types/schema.ts:148-190].

---

## 7. How Praxis uses jev today

| Where | What it asks | Source |
| - | - | - |
| **Dimension scoring** | one `noul` per rubric dimension: “answer the probability it is fully satisfied: <statement>” | [source: src/quality/jev-scorer.ts:18,42-48] |
| **Probe battery (the why)** | one `choice`/`noul`/`score` per declared probe, ids `<dimension>.<probe>`, state without scores | [source: src/quality/jev-scorer.ts:145-186] |
| **Probe declarations** | `{id, type, instructions, criteria?, clean?}`, ≤6 per dimension, ≤48 per rubric, refused at parse | [source: src/types/schema.ts:148-204] |
| **Rendered rationale** | labels → ≤3 clauses, ≤240 chars, divergence clause when clean-but-below | [source: src/quality/jev-scorer.ts:75-141] |
| **Recall ranking** | one `score` per candidate, “how much NEW guidance would this add”, ordered then de-duplicated | [source: src/quality/ranker-jev.ts:47-101] |
| **Alignment gate** | one `choice` (aligned / misaligned) over the order and the flow's anchor | [source: src/quality/jev-align.ts:56-114] |

Praxis never sends images or `box` questions, never sets the danger-zone headers, and treats every jev
failure as a visible degradation rather than a silent pass [source: src/quality/evaluate.ts:90-100].

---

## 8. Adoption ideas — **[proposed]**

**Layer legend (owner-fixed, 2026-10-31).** `[task-loop]` = built in the task self-improvement unit, as ordered slices; `[task-loop · optional]` = a later, optional task slice; `[control-flow · future layer]` = orchestration above the task — captured only, never designed in this unit. Every `[task-loop]` idea also carries a **Map inside jev** line naming the exact primitive, answer field and reference section it rests on.

1. **Criteria-composed scorer instructions.** Build the scoring `noul`'s instructions from the dimension's
   probes instead of one generic sentence, so the score and the battery judge the same facts
   [proposed, needs EntryType for structure; plain strings work today]. **[task-loop]** — slice 1.
   *Map inside jev:* primitive **`noul`**, answer field **`noul`** (§1 table: "the probability that a statement
   is true"; no confidence field). The parenthetical is corrected here, not required: §2 already records that
   `pi-jev` 0.2.2 types `EntryType` for `instructions` and `criteria` [source: node_modules/pi-jev/dist/src/types.d.ts:2-23];
   what is still plain strings is the PRAXIS probe schema [source: src/types/schema.ts:148-190]. Composition
   needs no structure at all — one `noul` per criterion, all in ONE request (§3), arithmetic in code.
2. **Probabilities, not just labels.** A score answer already carries per-level probabilities: use
   `P(top level)` as an extra signal beside the score, and flag a dimension whose probability mass is
   split (low `confidence`) as *needs a better statement*, using the D11 divergence clause's wording
   [proposed] [doc: /primitives/score.md]. **[task-loop]** — slice 2.
   *Map inside jev — grounding corrected 2026-10-31, then corrected again the same day:* in pi-jev **0.2.2**
   the documented `probabilities` map does NOT survive the client, which rebuilds every answer from its
   type-specific fields [source: node_modules/pi-jev/dist/src/client.js:69-101]: `ScoreAnswer`/`ChoiceAnswer`
   carry an optional `confidence`, and `NoulAnswer` carries neither
   [source: node_modules/pi-jev/dist/src/types.d.ts:21-35]. **That is an OWNED client gap, not a boundary.**
   pi-jev is ours, so **slice 0** of the task-loop design has it preserve the `choice`/`score` distribution
   **[enabler · pi-jev, owned]** — the same kind of small owned change as the EntryType one. Once slice 0 lands
   the mass IS available and is read as a distribution's SPREAD (§1 "Reading probabilities"). A **`noul`** still
   returns a single probability — no distribution, no confidence — so its only instability signal is repeat-N.
3. **Confidence-gated alignment.** Today the alignment gate refuses on `misaligned` and proceeds flagged
   when jev is unavailable. A `confidence` threshold on the `choice` would add a third, honest state:
   judged-but-unsure → proceed flagged [proposed] [doc: /patterns/confidence-routing.md].
   **[task-loop · optional]** — a later, optional task slice.
   *Map inside jev:* primitive **`choice`**, answer field **`confidence`** (optional, `[0,1]`; §1 "Reading
   confidence", §5 "Confidence-gated routing"). The gate reads the label today and ignores the confidence
   [source: src/quality/jev-align.ts:56-114].
4. **Taxonomy over flows and tasks.** Hierarchical `choice` walk of the `.pi/praxis/` tree (or a task
   catalogue) to route an order to a flow, instead of one flat list [proposed] [doc: /cookbooks/hierarchical_classification.md].
   **[control-flow · future layer]** — routing above the task; captured, not designed here.
5. **Cascade for extraction.** Task metadata (version, threshold, required sections) read by jev over a
   pre-parsed candidate set, with the expensive model only on disputes [proposed] [doc: /cookbooks/sde_cascade.md].
   **[control-flow · future layer]** — intake, not the task loop.
6. **Stability sampling of a rubric.** A repeat-N harness (à la the self-consistency cookbooks) over a
   frozen artifact, to decide whether a new dimension's statement is stable enough to ratchet on
   [proposed] [doc: /cookbooks/consistency_noul_cookbook.md]. **[task-loop]** — slice 3.
   *Map inside jev:* repeat-N of the SAME composed request (the `noul` per criterion plus any `score`/`choice`
   criterion) over one frozen artifact; agreement is read per answer field — `noul`/`score` spread, `choice` key
   agreement — and the decision is code-owned (§4 "Self-consistency: nouls" / "…choices"; [doc:
   /cookbooks/consistency_noul_cookbook.md]). A `noul` carries no confidence (§1), so repeat-N is the ONLY way
   to observe a statement's instability. Each repeat is a real call, so the sample is bounded and recorded.
7. **Injection screening of recalled exemplars.** A `noul` battery ("tries to instruct the model") on each
   recalled case before it reaches the agent [proposed] [doc: /cookbooks/classifying_rag_passages.md].
   **[task-loop]** — slice 4.
   *Map inside jev:* one **`noul`** per case per screen question, ids `<case>.<criterion>` (§3 id grammar),
   thresholded in code (§1 `noul`; §4b classifying_rag_passages — relevant / usable / contradicts / *instructs
   the model*). Each `noul` may carry `criteria.true`/`criteria.false` examples: typed by the client
   [source: node_modules/pi-jev/dist/src/types.d.ts:11-18], NOT exposed by the praxis probe schema
   [source: src/types/schema.ts:148-172] — irrelevant here, because a screen is code-side questions over
   recalled text, not a task-authored probe, so no schema change is needed.
8. **A presence noul for "not stated".** The function-calling example asks a separate `<arg>?` noul — "does
   the user say this?" — and then drops the argument when the probability is low
   [source: .dev/typesafe-public-examples-main/cookbooks/function_calling/dispatch.py:159-200]. Praxis could
   use the same question for an optional order field (a task version, a rework target) instead of guessing
   it from the prose [proposed]. **[control-flow · future layer]** — reading an order, not judging a task's work.
9. **Three nouls instead of one score.** The re-ranking example keeps `is_cited_source`,
   `same_proposition` and `shared_language` per pair and ranks on the combination, which says *why* a
   candidate ranked where it did [example: .dev/typesafe-public-examples-main/cookbooks/rerank_typesafe/json_cache.json].
   The same trio over an exemplar would explain a recall ordering [proposed]. **[task-loop]** — slice 5.
   *Map inside jev:* k **`noul`** questions per candidate, ids `<case>.<criterion>` (§3 id grammar), with the
   combination in code — the §5 "composite scoring" pattern: jev supplies the atoms, Praxis the weights; the
   rerank cache shows the trio per pair. A `noul` has no confidence and no probability mass (§1), so the
   weights are the ONLY combination and must be frozen constants, never a model choice.
10. **A per-line relevance vector.** The semantic-search example returns `exists` plus a relevance probability
   per line id in ONE call [example: .dev/typesafe-public-examples-main/cookbooks/semantic_find/json_cache.json].
   Pointed at a task document, that is a cheap locator for "which section is this order about" [proposed].
   **[control-flow · future layer]** — a locator for the order, not a judgment of the work.
11. **Read `confidence` as a routing axis.** The classification example reports the leaf group when
   confidence is high and the parent division when it is not
   [doc: /cookbooks/classification_using_confidence.md]. A Praxis analogue: report a verdict as *provisional*
   below a confidence threshold instead of refusing it [proposed]. **[task-loop]** — slice 6.
   *Map inside jev:* **`confidence`** on a `choice`/`score` answer (§1 "Reading confidence"; §4b
   classification_using_confidence — the leaf group when confidence is high, the parent when it is not; §5
   "Confidence-gated routing"). A `noul` criterion cannot supply it (§1), so a provisional verdict is derived
   from the criteria that do carry a confidence, with its threshold a code constant.

---

## 9. Copy-paste appendix

**Minimal HTTP request** [doc: /api/system-one.md]:

```sh
curl -s https://api.typesafe.ai/v1/systemone \
  -H "Authorization: Bearer $TYPESAFE_API_KEY" -H 'Content-Type: application/json' \
  -d '{"state":{"order":"carry out the task"},
       "questions":{"fits":{"type":"noul","instructions":"Is the order about this task?"},
                    "kind":{"type":"choice","instructions":"What kind of work?",
                             "criteria":{"build":"new code","fix":"a defect","docs":"documentation"}}}}'
```

**Response shape** [doc: /primitives/choice.md] [doc: /primitives/score.md]:

```json
{ "model": "jev-1.13.0",
  "answers": {
    "fits": { "type": "noul", "noul": 0.93 },
    "kind": { "type": "choice", "choice": "fix", "confidence": 0.81,
              "probabilities": { "build": 0.09, "fix": 0.9, "docs": 0.01 } } },
  "usage": { "input_tokens": 328, "output_tokens": 34 } }
```

**From Praxis code**, with an injectable call for tests [source: src/quality/jev-align.ts:94-118]:

```ts
import { evaluate } from "pi-jev";
const response = await evaluate({
  state: { order, anchor },
  questions: { alignment: { type: "choice", instructions: STANCE + goal, criteria: { aligned: "…", misaligned: "…" } } },
});
const choice = response.answers.alignment; // { type: "choice", choice, confidence }
```

**Reading an answer safely** (the pattern Praxis uses everywhere): fail closed on a missing or mistyped
answer, never default to a pass [source: src/quality/jev-scorer.ts:186-210].

---

## 10. Sources

**TypeSafe docs** (fetched 2026-10-30; every `[doc: …]` tag above is relative to `https://docs.typesafe.ai`):
`/llms.txt` (the full page index), `/introduction.md`, `/introduction/coding-agents.md`, `/concepts/system-one.md`,
`/primitives.md`, `/primitives/choice.md`, `/primitives/score.md`, `/primitives/noul.md`, `/primitives/advanced.md`,
`/confidence.md`, `/models.md`, `/api/system-one.md`, `/api/errors.md`, `/patterns/fan-out.md`,
`/patterns/confidence-routing.md`, `/patterns/composite-scoring.md`, `/patterns/intent-routing.md`,
`/sdk/javascript.md`, `/sdk/javascript/api/type-aliases/EntryType.md`, `/sdk/javascript/api/interfaces/SystemOneRequest.md`,
and all 25 cookbook pages (`/cookbooks/*.md`): function_calling, skill_suggestion, llm_guardrails, citation_check,
classifying_rag_passages, basic_memory, hierarchical_classification, classification_using_confidence,
twitch_chat_filter, sde_cascade, date_extraction_cookbook, pre_parsed_value_extraction_cookbook, autoformat,
cart_from_primitives, reading_scanned_documents, ocr_confidence_bounding_boxes, feeder_watch, rerank_typesafe,
semantic_find, entity_alignment, intelliprompter, consistency_choice_cookbook, consistency_noul_cookbook,
parallel_questions, autoresearch_feature_discovery.

**Local public examples** (gitignored, read-only): `.dev/typesafe-public-examples-main/cookbooks/<name>/` —
`json_cache.json` answer/feature projections for **21** cookbooks (autoformat, basic_memory,
cart_from_primitives, citation_check, classification_using_confidence, classifying_rag_passages,
date_extraction_cookbook, entity_alignment (data only), feeder_watch, function_calling (+ code),
intelliprompter, llm_guardrails, ocr_confidence_bounding_boxes, parallel_questions,
pre_parsed_value_extraction_cookbook, question_tuning (data only), reading_scanned_documents,
rerank_typesafe, semantic_find, skill_suggestion, twitch_chat_filter), plus `LICENSE`, `LICENSES/` and nine
per-folder `DATA_LICENSE.md` files. Treated as evidence, never copied into `src/`, `tests/` or `.pi/`.

**Our code**: `/media/Development/AI/pi-jev/src/{client.ts,types.ts}` (the client) and
`src/quality/{jev-scorer,ranker-jev,jev-align,evaluate}.ts`, `src/types/schema.ts` (Praxis usage).

**Cost, from the docs**: you pay per **input** token, output is free; `$42` per billion / `$0.042` per
million input tokens [doc: /models.md], and the SDE cookbook prices a Jev verifier at `$0.042 / $0.00`
against a reasoning model at `$5.00 / $30.00` per Mtok [doc: /cookbooks/sde_cascade.md]. Praxis has not
measured its own spend.
