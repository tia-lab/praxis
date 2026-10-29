---
name: praxis-alignment
description: Establish and record alignment on what is wanted before work starts — intent, target, frozen decisions, open decisions, limits, acceptance and assumptions. Use when an owner says "align" or "is it clear", before commissioning research or a team, or when a unit's outcome could be satisfied by two materially different results.
---

# Praxis alignment

Alignment is not agreement held in conversation. It is a written artifact that both
sides can re-read after a compaction, when the transcript is gone and the work is
still running.

## When

- Before commissioning research, a team, or an implementation unit.
- When a request could be satisfied by two materially different results.
- When the owner says "align", "is it clear", "before we start".
- Not for a bounded change with a settled contract: that is a plan, not alignment.

## The artifact — write it down, ≤ 25 lines

```markdown
Intent      what breaks today; the failure this work must prevent
Target      what the thing is, one paragraph, no mechanisms
Frozen      decisions not open to re-litigation, each with its reason
Open        decisions still to make, each with its owner and the evidence needed
Limits      claims we may not make even when the work succeeds
Acceptance  how we will know the delivered thing matched the intent
Assumed     anything the owner has not confirmed, marked as assumed
```

Store it where the work lives: `research.md` §0, the plan's requirement basis, or the
assignment brief. Chat-only alignment dies at the first compaction.

## Rules

1. **Intent first.** Ask what concretely breaks today before asking what to build. A
   design derived only from a specification is an assumption wearing a suit.
2. **No mechanisms during alignment.** Types, files, APIs, layout and phases stay
   *Open* until *Target* is agreed; proposing them early invites the owner to react to
   code instead of the goal.
3. **Smallest sufficient question set.** One question per unresolved decision, each
   answerable in a line, each changing what would be built.
4. **Frozen needs a reason.** A frozen list without reasons is dogma; an empty frozen
   list means nothing is aligned yet.
5. **Owner words outrank documents.** Where the owner and a design document disagree,
   the owner wins and the document is updated — never silently reinterpreted.
6. **Label assumptions.** Anything not explicitly confirmed is `assumed` and listed;
   never presented as agreed.
7. **Alignment is bounded.** The artifact must be shorter than the work it governs. No
   scoring matrices, no weighted criteria, no ceremony (`praxis-minimality`).
8. **Re-opening is explicit.** Only new evidence or an owner change reopens alignment;
   record which, and what changed. Nothing else does.

## Stop

Do not start research, compose a team, or write code while an *Open* item is one the
work depends on, or while any *Assumed* line is load-bearing. State what is missing and
ask the single question that unblocks it.
