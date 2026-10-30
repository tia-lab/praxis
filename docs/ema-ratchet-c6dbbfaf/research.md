# Research — the current adaptive bar (O2), before changing its statistic

Task: ema-ratchet · Hash: c6dbbfaf · Gate: G1 · Date: 2026-10-30 · Method: read the implementation and
the design text it was built from. Every claim cites `path:line`. Nothing here is executed behaviour
beyond what the existing tests already assert; that is marked where it matters.

Authority for the current formula: `docs/execution-learning/DESIGN.md:198-232` (§7, "O2 — CLOSED"),
restated for scopes in `docs/per-dimension-bars/PLAN.md:5-25`.

## 1. What the ratchet actually is

**Scopes.** Two kinds: `global` (the MEAN of the dimensions) and one per dimension
(`src/quality/bar.ts:49` `GLOBAL_SCOPE = "global"`; scopes built at `bar.ts:328-357`). Each has its
own seed and its own fold of raises (`bar.ts:165-172` `barAt`: seed, then each raise's `to` in log
order; `bar.ts:175-183` `effectiveBars`).

**The value a scope ratchets on.**

- global: `bar.ts:349` — `.map((pass) => ({ value: pass.mean, ... }))`, i.e. per genuine pass, the MEAN
  of its dimension scores. This is the "windowed-mean" the owner's note names: the *input* to the
  global scope is a mean.
- a dimension: `bar.ts:353-355` — that dimension's own score in the pass.

**What counts as a genuine pass** (`bar.ts:205-245`, function `genuinePasses` at `bar.ts:219`): an
`artifact.accepted` event with no `failed` flag (`bar.ts:242`) whose own verdict — same instance, same
step, and `version <= accepted version` — was recorded with `decision === "pass"` at exactly that
version (`bar.ts:248-252`). A continued-FAILED artifact is excluded twice over. `attempts` is the count
of verdicts for that step up to that version (`bar.ts:247`).

**The window and the cooldown** (`bar.ts:387-393`): `sinceRaise` keeps only passes strictly after the
last raise's timestamp; `window = sinceRaise.slice(-BAR_WINDOW)` with `BAR_WINDOW = 5`
(`bar.ts:35`). So a raise can happen at most once per five new genuine passes — that *is* the
"cooldown" of `DESIGN.md:213`.

**The four gates** (`bar.ts:405-425`, `decideRaise`):

| gate | code | constant |
| --- | --- | --- |
| headroom | `margin = lowerQuartile(sorted scores) - current`; require `>= 0.12` | `BAR_MARGIN_MIN` (`bar.ts:39`), `bar.ts:417-418` |
| stability | `stdev(scores) <= 0.08` | `BAR_STDEV_MAX` (`bar.ts:41`), `bar.ts:419` |
| low effort | window mean of `attempts` `<= 2` | `BAR_MEAN_ATTEMPTS_MAX` (`bar.ts:43`), `bar.ts:420` |
| cooldown | the window itself (only passes after the last raise) | `bar.ts:392-393` |

**The step** (`bar.ts:422-424`): `step = min(0.05, 0.5 * (margin - 0.12))`, then
`to = round4(min(0.9, max(seed, current + step)))`, and `if (!(to > current)) return undefined`
(`bar.ts:425`). Constants `BAR_MAX_STEP = 0.05` (`bar.ts:47`), `BAR_CEILING = 0.9` (`bar.ts:45`).

**Warmup** (`bar.ts:389-390`): `scope.observations < WARMUP_MIN` (`10`, `bar.ts:37`) → decision
`warming`, no raise. Observations are verdict *events* for the scope's identity (`bar.ts:341-347`),
not passes.

**Never lowers.** Two independent facts: `barAt` only ever assigns `raise.to` (`bar.ts:165-172`), and a
raise is refused unless `to > current` (`bar.ts:425`). No code path writes a smaller bar — `grep` over
`src/quality` finds no lowering assignment.

**Contested** (`bar.ts:453-489`): only for a scope with at least one raise; counts verdict events after
the last raise; if `>= BAR_WINDOW` verdicts and zero passes since, emits `bar.contested` once per
`(scope, bar)` value (`bar.ts:470-476`). It is a signal, never a lower.

**Where it runs.** After a terminal outcome: `src/runner/engine/advance.ts:221` and
`src/runner/engine/quality-loop.ts:224,252` call `recomputeBar`; every scope is evaluated
(`bar.ts:378-385`). Cheap by design because it is a log scan.

**How the bar is enforced.** `compoundDecision` (`bar.ts:290-310`): every dimension must sit at or
above `bar - DIMENSION_TOLERANCE` (0.05, `bar.ts:55`), and the MEAN must clear the GLOBAL bar with **no
tolerance** (`bar.ts:308`). So the global bar is the hard gate; per-dimension bars carry a band.

## 2. What that means numerically today (derived, not measured)

Because headroom is measured from the **lower quartile** of five values (`bar.ts:274-277`,
`sorted[floor((n-1)*0.25)]`, i.e. the 2nd of 5), `margin >= 0.12` requires at least three of the five
passes to sit ~0.12 above the bar; the step is then `0.5 * (margin - 0.12)`, so the *smallest* possible
raise is just over zero and a raise of exactly +0.01 needs `margin = 0.14`, while the +0.05 cap needs
`margin >= 0.22`. The two worked examples in the suite match: `tests/quality/bar.test.ts:92`
(window at 0.95, margin 0.35 → capped 0.05 → 0.60→0.65) and `:128` (margin 0.14 → +0.01 → 0.60→0.61).

Two consequences worth naming before changing anything:

1. The decision statistic is an **order statistic** (a quartile), which is deliberately pessimistic:
   one lucky pass cannot lift the bar (`bar.test.ts:170-180` asserts exactly that).
2. Together with the 0.12 margin the ratchet is **slow and coarse**: it can only move in
   0.01–0.05 steps, at most once per five passes, and only when three of five passes are far above the
   bar. A sustained, well-above-bar level therefore does not move the bar to that level — it moves it in
   +0.01 increments each five passes, and each raise resets the evidence window.

That second point is the actual complaint behind "windowed-mean": the ratchet tracks a **5-pass
pessimistic snapshot**, not the **level** the work has reached.

## 3. What an EMA would need (design space, settled in spec.md)

- **A series**: the genuine passes of one scope's identity, in log order — the same `scope.passes`
  array `bar.ts:349-355` already builds, so no new read.
- **A per-pass value** ("high"): either the pass's own scope value (the MEAN for global — today's input),
  the max over its dimensions, or the max over its attempts. spec.md R1 fixes this and rejects the
  alternatives.
- **Alpha**: `alpha = 2/(N+1)` with `N = 9` → `0.2`; half-life `ln(0.5)/ln(0.8) = 3.11` passes; a level
  shift is ~87% absorbed after nine passes (`0.8^9 = 0.134`). These are arithmetic facts about the
  recurrence, not measurements.
- **Seeding**: the first observation, so the EMA is a property of the evidence rather than of the
  authored floor. Warmup still guards the first ten observations, so seeding cannot cause an early jump.
- **The ratchet**: `to = min(ceiling, current + min(0.05, max(0, ema - current)))` — the bar moves
  *toward* the EMA, never away from it, and never down. With `max(current, ...)` this is exactly the
  requested "effective bar = max(current, EMA)", made gradual by the existing 0.05 step cap.
- **Rounding**: `round4` (`bar.ts:322`) so the record carries an audit value, as today.

## 4. Constraints the change must respect (from the contract and the code)

- **No store schema change.** The event payload is JSON in a generic row (`src/store/` event table);
  nothing in the store knows about bars. `BarRaisedSchema` (`src/types/learning.ts:70-89`) is a
  `strictObject`, so any new recorded field must be added to that schema or parsing fails — an
  **additive optional field** keeps old records readable and costs no store migration.
- **No flow schema change**: the bar is not in any flow or task document; only seeds are
  (`quality.threshold`, `dimension.floor`, `Quality` in `src/types/schema.ts`).
- **Warmup, ceiling, never-auto-lower, contested-once**: all frozen by `DESIGN.md:198-232`; the owner's
  brief keeps warmup and contested explicitly.
- **The record must stay reproducible** (`DESIGN.md:230-232`): whatever decides a raise must be
  recorded, so a re-run of the same log yields the same bar.
- **Consumers of the record**: `raisesOf`/`raisesFor`/`barAt` read only `to`, `at`, `scope`, `key`
  (`bar.ts:150-172`), and `src/runner/note-gate.ts:31` reads `barAt`/`raisesOf`; nothing reads
  `window` outside the record itself and the tests (`bar.test.ts:96-100`).

## 5. What is affected by a change of statistic

- `decideRaise` (`bar.ts:405-451`) is the only place the statistic is computed.
- `scopesOf` already produces the ordered pass series per scope, so the EMA needs no new store read.
- `tests/quality/bar.test.ts` asserts exact `to` values for the global scope (`:91-92`, `:127-128`,
  `:214`, `:253`) and the exact window statistics (`:96-100`); those expectations are the re-tune.
- `BAR_FORMULA_ID = "praxis.bar/v2"` (`bar.ts:33`) is asserted at `bar.test.ts:93`; a changed formula
  must change the id, or the audit trail lies about which rule produced a raise (`DESIGN.md:230`).

## 6. Unknown / not verified here

- **No measurement of how often the current gates fire in real use**: the suite has synthetic logs only.
  The claim "the ratchet is slow" (probe 2 above) is derived from the formula and from the two test
  examples, not from production history.
- **No test asserts the pre-change global `to` from a >5-pass series**; the current tests use exactly
  the window length, so the interaction between cooldown and window at longer horizons is unexercised.
- **Judge noise magnitude** (why 0.9 is the ceiling, `DESIGN.md:220-222`) is an authored assumption in
  the design, not something this repository measures.
