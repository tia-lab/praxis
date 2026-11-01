# Live test — how to launch

The live end-to-end test runs a **real Pi agent** against a **real Praxis flow** with
**live jev (TypeSafe) scoring**, inside a herdr pane that has `TYPESAFE_API_KEY`
exported. It is the proof the quality loop works outside the in-process test doubles.

## The one rule that matters

Launch `pi` with the **full extension stack PLUS the praxis extension**. Do **not**
pass `--tools praxis,bash` and do **not** strip extensions: a restricted/`--no-extensions`
launch breaks tool-call parsing and the model emits its tool calls as **literal text**
(e.g. raw `<｜｜DSML｜｜ invoke>` blocks) that never execute. The working runs keep all the
global/configured extensions on (fabric, web, bash, …) and simply add `praxis` on top.

## Steps (interactive, watchable in a pane)

1. Use a herdr pane whose shell has `TYPESAFE_API_KEY` exported.
   Check without printing the key: `echo len=${#TYPESAFE_API_KEY}` (expect ~108).
2. From the repo root, launch interactive pi adding **only** the praxis extension:
   ```sh
   PRAXIS_STORE_DIR=/tmp/praxis-live PRAXIS_CONFIG=.pi/praxis/flows/engineering/feature.json \
     pi --extension ./src/pi/extension.ts
   ```
   - `PRAXIS_CONFIG` selects the flow (the Pi tool otherwise defaults to
     `engineering/feature.json`).
   - `PRAXIS_STORE_DIR` gives a fresh, disposable SQLite store (defaults to
     `.pi/praxis/state` — point it at `/tmp/...` so the live run never touches the repo store).
   - No `--tools` filter, no `--no-extensions`: `praxis`, `bash`, fabric and web stay available
     and tool-calling parses correctly.
3. Send the task to the agent (running pi registers as a herdr agent):
   ```sh
   herdr agent prompt <pane-id> "$(cat /tmp/praxis-live-prompt.txt)"
   ```
4. Read results: `herdr pane read <pane-id>`, or inspect the store under `$PRAXIS_STORE_DIR`
   (`instance` row + the `gate.verdict` / `quality.verdict` / `artifact.accepted` events).

## Headless variant (CI / acceptance harness, no TUI)

Same launch, add `--mode json --print "<prompt>"` and redirect to a JSONL transcript:
```sh
PRAXIS_STORE_DIR=/tmp/praxis-live PRAXIS_CONFIG=.pi/praxis/flows/engineering/feature.json \
  pi --mode json --extension ./src/pi/extension.ts --print "$(cat /tmp/praxis-live-prompt.txt)" \
  > /tmp/praxis-live.jsonl 2>&1
```

## What a good live run shows

- real `praxis` tool calls (not text), `op=start` → research → `op=submit`;
- the **deterministic gate passing** (`object/schemaMatches/noncePresent/sectionRequirement`)
  while the **quality floor** decides acceptance;
- a live `jev-1.14.0` verdict with per-dimension scores and an aggregate vs the threshold;
- the rework loop on a below-floor refusal, and durable `quality.verdict` events in the store.

## Second option — staggered non-interactive baseline (32 sessions)

A faster, cheaper way to produce a **clean calibration baseline** without watching
panes. Use this when you want the bars to calibrate from scratch under the full
rubric and all mechanisms (EMA ratchet, Pareto cap, refusal-recall, jev recall).

- **Fresh store** so bars seed from the floor (0.6), not polluted by a prior run:
  `PRAXIS_STORE_DIR=/tmp/praxis-baseline` (new, empty).
- **32 headless sessions** (`pi --print`), model **`deepseek-flash:high`**.
- **Staggered in 8 waves of 4, one wave per minute** — at most 4 run concurrently.
  This avoids hammering jev, and lets each wave's solved cases land before the next
  so later waves actually **recall** them (the shared-cache + learning-loop test);
  the bars then ratchet **progressively**, which is the honest calibration curve.
- **Research step first.** Iterate until research calibrates as wished, *then*
  escalate to the full flow (research → spec → plan → implement → review).
- **Same one rule:** keep the full extension stack and add praxis
  (`--extension ./src/pi/extension.ts`), never `--no-extensions`. Each pane's shell
  must export `TYPESAFE_API_KEY` (jev scoring).
- **Panes:** test-1 tab `wB:tW` (16) + test-2 tab `wB:tY` (16) = 32.
- **Launch line per session:**
  ```sh
  cd <repo> && PRAXIS_STORE_DIR=/tmp/praxis-baseline \
    PRAXIS_CONFIG=.pi/praxis/flows/engineering/feature.json \
    pi --model deepseek-flash:high --extension ./src/pi/extension.ts \
       --print "$(cat <prompt-file>)"
  ```
- **Read the baseline from the store** (bars, `quality.verdict`, `recall.ranked`),
  not the panes.
