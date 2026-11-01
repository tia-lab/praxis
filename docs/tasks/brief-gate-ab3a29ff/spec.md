# Spec — the brief shows the effective (capped) gate beside the earned bar

Task: brief-gate · Hash: ab3a29ff · Gate: G2 · Date: 2026-10-30 · Display-only.

## Frozen shape

`brief.quality` gains ONE optional object; nothing existing changes meaning:

| Field | Meaning |
| --- | --- |
| `threshold` (existing) | the **earned** global bar (the ratchet's record), as today |
| `dimensions[].floor` (existing) | the **authored** aspiration per dimension, as today |
| `gate.threshold` (new) | `gateBar(earnedGlobal, pareto)` — the value the MEAN must actually reach |
| `gate.dimensions[id]` (new) | `gateBar(earnedBar_d, pareto)` — the value this dimension must actually reach |

Absent when the task declares no quality floor, exactly like `quality` itself.

## Requirements

| Id | Requirement | Failure behaviour | Oracle |
| --- | --- | --- | --- |
| R1 | The descriptor reports the effective gate per scope, derived with the exported `gateBar` and the `pareto` already on `Bars` — one implementation, no new formula. | Without a quality floor nothing is projected (`gate` absent, like `quality`). | A task with `threshold: 0.87` and a dimension floor of `0.9` yields `gate.threshold === 0.8` and `gate.dimensions.solves === 0.8` while `threshold` stays `0.87` and the authored floor stays `0.9`. |
| R2 | Both values are shown: the earned bar is unchanged, the gate is additive. | If the derived bars are unavailable the gate is omitted rather than guessed. | A real ratcheted earned bar of `0.85` appears as `threshold: 0.85` with `gate.threshold: 0.8`. |
| R3 | Below the Pareto point the two are equal. | — | `threshold: 0.6` yields `gate.threshold === 0.6` and dimension gates equal to their earned/authored values. |
| R4 | Display only: the decision, the ratchet, the ranker, the store and the flow/task documents are untouched. | — | `compoundDecision`, `decideRaise` and `emaOf` are byte-identical; `git diff` shows no store or flow change. |
| R5 | The envelope stays parseable for every existing consumer: the new key is optional inside a `strictObject`. | A descriptor that omits `gate` validates exactly as before. | Every existing test passes unchanged. |

## Exclusions

Removing or re-meaning `threshold`; adding per-dimension EARNED bars (only the gate values are new);
changing `JUDGING_STANCE`; any decision, store or schema-of-record change.

## Open questions

None. (A later unit could show the earned per-dimension bars too; the authored floor plus the
effective gate already bound what the agent must do.)
