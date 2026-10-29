---
name: praxis-workflow
description: Run an authorized unit of work in the Praxis repo through its gates — task identity and hash, research → spec → plan → implement → review, document shapes and stop conditions. Use when starting, resuming or reviewing a task, plan, spec or review under /home/tia/_DEV/AI/praxis.
---

# Praxis workflow

## Shared core — read before phase work

1. `docs/WORKFLOW.md` — the authority. If this skill and that file disagree, this
   skill is wrong.
2. `praxis-alignment` — before commissioning research, a team or an implementation
   unit: intent, target, frozen, open, limits, acceptance, assumptions.
3. `praxis-minimality` — scope and minimality. Load it before planning or reviewing;
   it owns the canon link and the citation duty.
4. `docs/vision.md` — only when the unit touches product design.

Occam is **inspiration, not a dependency**: no `occam_reason`, no Occam role skills,
no package. Its protocol gates are inapplicable; its principles bind as conduct, and
`praxis-minimality` links the canon that states them.

For any organization action, layer `manifold` + `manifold-organizer` on top.
Manifold activation is an owner action, not a property of this repo: while inactive
there are no teams, assignments or independent reviewers, and while active a verdict
is still `independence: self` unless a separate session produced it.

## Gates

```
G0 contract → G1 research → G2 spec → G3 plan → G4 implement → G5 review → G6 accept
```

No gate before its predecessor's PASS; no code before G3 PASS. Pass conditions,
the spec waiver and the verdict format live in `docs/WORKFLOW.md` §2–4 — read
them there and do not restate them here.

## Task identity

`docs/<slug>-<hash8>/` holds `research.md` (the contract in §0), `spec.md` or a
recorded waiver, `plan.md`, `review.md`. Shapes: `docs/templates/`.

```sh
canonical() { printf 'task: %s\nscope: %s\nacceptance: %s\n' "$1" "$2" "$3" \
  | sed -E 's/[[:space:]]+$//'; }
canonical "<goal>" "<paths>" "<checks>" | sha256sum | cut -c1-8
```

## Rules agents actually break

- The author never writes `review.md`; a verdict needs a `sha256` of every file it
  reviewed.
- `independence: self` until Manifold is active. Never claim independent.
- Every declaration is in the plan; an unplanned one returns to G3.
- ≤600 lines per file; types separated from runtime; `index.ts` is the only barrel.
- Start from the data model, not from operations.
- Label every material claim `documented | source-inspected | executed | untested |
  proposed`. A passing check proves only what it exercised.

## Stop

Stale scope · changed contract hash · conflicting edits · failed check · unknown
external effect · deviation from the plan → stop the affected work, preserve
unrelated edits, report. Never work around it.
