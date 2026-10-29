---
name: praxis-minimality
description: Scope and minimality decisions — use when adding a file, field, dependency, mechanism or permission, or when reviewing a plan, spec or diff for over-scope, duplication or speculative surface.
---

# Praxis minimality

## Load the canon first — 109 lines, bounded

1. `/home/tia/_DEV/AI/occam/rules/INVARIANTS.md` — MIN-001…MIN-012 (27 lines)
2. `/home/tia/_DEV/AI/occam/rules/CODE.md` — decision ladder, ownership, failure,
   tests, evidence (82 lines)

Read both before plan or review work. Pinned at authoring time:

```
INVARIANTS.md  6323cee19accc8c667270da668e56be9a79d2a98d52f24d3736c6abcfd238afd
CODE.md        d2e2c8158f3ad557afb02888c0bc10a5c84dcf40b2e4023f7d55d05c90e2c823
```

If either file is unreadable, or a digest no longer matches, **stop and report**. Do
not improvise minimality and do not silently follow a drifted canon.

Ownership: Occam owns the canon; this skill owns the Praxis consequences and the
citation duty. Where they conflict, the canon wins. Occam is inspiration, not a
dependency — no `occam_reason`, no role skills, no package.

## Citation duty

Every plan entry, review finding and blocker cites the id it serves (`MIN-004`). A
minimality claim without an id is rhetoric.

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
