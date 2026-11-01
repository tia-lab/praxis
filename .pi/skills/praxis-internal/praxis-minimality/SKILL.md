---
name: praxis-minimality
description: Scope and minimality decisions — use when adding a file, field, dependency, mechanism or permission, or when reviewing a plan, spec or diff for over-scope, duplication or speculative surface.
---

# Praxis minimality

## Canon — in this repo, one copy, no external drift

**Decision (2026-11-01, lead direction): the canon is in-repo.** The two external files
previously pinned here by sha256 — `/home/tia/_DEV/AI/occam/rules/INVARIANTS.md` and
`CODE.md` — are **no longer read and no longer pinned**. They were the source text for
conduct Praxis now owns as data, and a digest pin on another repository's file is drift
waiting to fail on someone else's commit.

Two in-repo files, and nothing else:

1. `.pi/praxis/rules/engineering/minimality.json` — the minimality rule set: 11 rules
   with stable ids, `smallest-complete-system`, `data-model-before-mechanism`,
   `load-bearing-first`, `bind-to-requirement`, `one-owner-per-fact`,
   `no-speculative-surface`, `no-justification-by-elegance`, `fewest-concepts`,
   `measure-real-complexity`, `prefer-dominating-alternative`,
   `never-weaken-requirements`.
2. `.pi/praxis/profile/conduct/occam.json` — the conduct layer the agent actually
   receives in its composed system prompt: `overview`, `invariants`, `prefer`,
   `avoid`, `body`.

**Why this does not lose the canon.** The rule set carries the ladder and its ids; the
conduct profile carries the invariants; both are versioned in this repo, and the
conduct profile is literally what the runtime injects — so the canon cannot say one
thing while the agent is told another. What is *not* carried over is the external
`MIN-0xx` numbering. `MIN-0xx` ids in earlier ledger, plan and review text remain
valid as historical notation for that external canon; new work cites the ids below.

Read both before plan or review work. If either file is missing or does not parse,
**stop and report** — do not improvise minimality and do not fall back to another
repository.

Ownership: Praxis owns both files; this skill owns the Praxis consequences and the
citation duty. Occam is inspiration, not a dependency — no `occam_reason`, no role
skills, no package, and no read of another repo at plan time.

## Citation duty

Every plan entry, review finding and blocker cites what it serves:
`minimality/no-speculative-surface` for a rule id, or `occam: "Never guess"` — the
opening words of a conduct invariant, greppable in the profile — for conduct. A
minimality claim without a citation is rhetoric.

## Praxis consequences — owned here, not in the canon

- ≤600 physical lines per file; split on an owner boundary, never to hit a number.
- Types live in `src/types/`, separate from runtime; `index.ts` is the only barrel.
- A declaration absent from the plan is a blocking finding: amend G3, do not improvise.
- One authoritative owner per fact; derive rather than duplicate.
- No dependency, config option or stored field without owner approval.
- No speculative field, flag, layer or "for later" branch.

## Three tests before adding anything

1. **Justify** — which present requirement, and what breaks without it?
2. **Compare** — is a credible complete alternative no worse on every dimension and
   better on at least one?
3. **Reduce** — can this be removed while every accepted requirement still holds?

## Stop

A requirement that appears to force a large mechanism is a design signal, not
permission. Return to the model and re-ask. Never squeeze code to fit a limit, and
never weaken a requirement to claim minimality.
