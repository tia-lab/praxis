# Plan — praxis ergonomics and composition roadmap

Task: extras-roadmap · Hash: ad609563 · Gate: G3 (roadmap) · Status: draft · Date: 2026-10-30

Basis: `research.md` §0 in this folder. This is a sequencing roadmap over five units; each
unit is implemented on its own ledger GO and carries its own checks below. Nothing here
authorizes code — it fixes the order, scope and acceptance so each unit lands cleanly.

## Owner decisions (frozen)

**KEEP, in order:** 1 skill + one-tool ergonomics · 2 repo housekeeping · 3 jev alignment
gate · 4 hooks contract · 5 bounded experience-query.

**REJECT:**
- **Agent picks / switches its own flow** — the profile and praxis task are **hardcoded at
  spawn**; a worker never chooses or mutates its flow/runtime (context hygiene; flexibility
  belongs to the Manifold/orchestrator layer, not the worker). `MIN-006`.
- **Peer scoreboard / beat-other-agents** — the per-dimension ratchet already is the
  challenge, objective and artifact-based. A leaderboard invites gaming and drifts toward
  ranking people over judging artifacts (Occam-seam risk). `MIN-006`.

**Boundaries binding every unit:** skills/prompts guide conduct, they never enforce
(enforcement stays in code); no isolation / trusted-identity / exactly-once claim — gates
#1/#3/#8 stay open; one authoritative owner per fact; fail closed with a typed reason;
≤600 lines per file.

---

## Unit 1 — main praxis skill + one-tool ergonomics  *(easy; foundation)*

- **Goal:** one `praxis` tool (ops `start/submit/read/note/check` + params) and a runtime-
  injected `SKILL.md` that teaches an agent to drive it: the gate loop, reading the
  `brief` and recall, producing the step artifact, and writing the note (tagging every
  flagged dimension).
- **Scope/paths:** `.pi/skills/praxis/SKILL.md` (+ any referenced files). No `src` change
  unless a brief-field is found missing, which is then its own finding.
- **Approach:** describe the existing tool contract and artifact shapes from
  `src/pi/tool.ts` and `src/types/pi.ts`; do not restate scoring internals.
- **Acceptance:** an agent given only the skill + the tool completes a `research` step
  end-to-end on a fresh store (start → check → submit → note) without hand-written prompt
  scaffolding. Behavioural, not a word count.
- **Boundary:** guides conduct only; it enforces nothing.
- **Owner input:** owner supplies the first skill draft, or lead drafts for owner
  correction. `MIN-004`.

## Unit 2 — repo identity / housekeeping  *(easy; independent)*

- **Goal:** remove inherited pi-manifold residue so packaging is not blocked.
- **Scope/paths:** `package.json` (name, description, scripts, drop unused
  `@nats-io/transport-node`), `commitlint.config.cjs`, `.husky/`, `.gitignore` (add the
  authorized praxis store path; keep WAL/SHM out of Git).
- **Acceptance:** `package.json` names praxis and its scripts point at files that exist;
  no unused NATS dependency; the commit hook is either praxis's own or removed (owner
  choice); the store root is git-ignored; `tsc` and the suite stay green.
- **Boundary:** no runtime behaviour change; reversible. `spec: none — basis: §4 waiver,
  no model/contract/authority change` if taken as one unit.

## Unit 3 — jev alignment gate  *(small; routing hygiene)*

- **Goal:** before praxis acts on an order, `jev(order, hardcoded-task) → aligned?` — a
  misaligned order is **refused with a typed code and logged**; no runtime mutation.
- **Model:** inputs are the **incoming order** and the agent's **hardcoded praxis task**
  (set at the trusted spawn, not read from the order); output is a typed Choice
  `{aligned | misaligned, reason}`; misaligned → typed refusal, recorded.
- **Scope/paths:** `src/runner/` (pre-dispatch check), `src/types/` (the typed verdict +
  refusal code), `src/pi/tool.ts` (wire-in), `tests/`.
- **Acceptance:** a research-task agent handed a code order is refused before any step
  write, with a typed code; an aligned order proceeds unchanged; the refusal is logged and
  visible (a wrong reject is correctable, not silent).
- **Boundary:** **routing hygiene, not isolation (gate #1) and not identity (gate #3).**
  The task anchor is only trustworthy because it comes from the trusted spawn; the gate
  claims nothing more. A semantic judgment, so it is typed + logged, never silent.

## Unit 4 — hooks contract  *(design unit; spec first)*

- **Goal:** a typed, ordered hook/event surface (`after_praxis_check`, `after_praxis_send`,
  …) so Manifold/Occam can bind in a defined order.
- **Scope/paths:** `src/types/` (hook event + payload schemas), `src/runner/` (emit points),
  `tests/`. G2 spec required (contract-bearing).
- **Acceptance:** hooks fire in declared order; a hook runs **inside** the capability
  ceiling and cannot amplify rights; a hook failure is typed and fail-closed; **no store
  transaction is held across an external hook call** (durable intent → op → receipt).
- **Boundary:** P4-adjacent composition seam; no exactly-once claim.

## Unit 5 — bounded experience-query  *(design unit; within-store only)*

- **Goal:** let an agent search **this project's** execution store for similar solved
  cases, with provenance, extending recall.
- **Scope/paths:** `src/quality/` or `src/store/` (query), `src/types/`, `tests/`. G2 spec
  if it adds a stored field or query contract.
- **Acceptance:** a query returns past cases from this store with their receipts/digests;
  stale refs excluded; results carry provenance.
- **Boundary:** **within-store only.** No cross-project / federated similarity — that is
  **Jung**, and Praxis must not become a federated memory authority.

---

## Order (first → last)

1. Unit 1 (skill + one-tool) — foundation.
2. Unit 2 (housekeeping) — independent, quick.
3. Unit 3 (jev alignment gate) — needs Unit 1's fixed-task model.
4. Unit 4 (hooks) — spec first.
5. Unit 5 (experience-query) — spec first.

**Then scale:** load-scale is safe now (16× held clean). **Trust-scale** (untrusted or
independent actors) reopens gate #1 isolation and gate #3 identity — not before.

## Checks (per unit, run and inspected at that unit's G4)

| # | Unit | Command | Expects |
| --- | --- | --- | --- |
| 1 | 1 | live: fresh store, agent with only skill+tool | research step completes start→check→submit→note |
| 2 | 2 | `npm run` scripts; `tsc`; suite | scripts resolve; no NATS; green |
| 3 | 3 | `tests/` misaligned order | typed refusal before any write; aligned proceeds |
| 4 | 4 | `tests/` hook order + failure | declared order; fail-closed; no txn across call |
| 5 | 5 | `tests/` query | within-store cases with provenance; stale excluded |

## Out of scope (whole roadmap)

Isolation / OS sandbox, trusted identity binding, flow-expansion authority, nested-execution
budgets, background maintenance (P8), agent-selected flows, peer scoreboard, and any claim
of exactly-once execution or compliance.
