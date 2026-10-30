# seat-step-contract-7ae692a2 — research

task: A seat enters a flow step, receives that step's contract from the engine, and has no room or peer channel to chat in; the gate alone decides when the step is done.
scope: .pi/manifold/profiles/tester.json, .pi/manifold/config.json, .pi/praxis/flows/, .pi/skills/praxis-seat/, src/cli.ts, tests/cli/
acceptance: A composed team creates no room; each seat is handed its step's goal, capabilities, produced schema and gate before it acts; the engine refuses completion the gate did not accept; zero peer-to-peer messages in the trail.
amended 2026-10-29 — created — owner directive: the team must not chat and must work the step.

## 0. Alignment

```
Intent      A team of Pi sessions spent ~40 messages talking to each other and one seat
            produced 237 lines of prose no gate could judge. What broke: no seat knew
            what its step was, so each invented one — and the room let them compare
            inventions instead of doing the work.
Target      A composed team with no room at all. Each seat is handed exactly one step:
            the task document's goal, capability set, produced schema, gate and required
            sections. It does that, submits, and stops until the engine advances it.
Frozen      No room in a team. Reason: the room is where invented work was compared and
            negotiated; removing the channel removes the failure mode.
            Completion is the engine's gate, never a seat's opinion. Reason: accepted
            artifacts already beat prose in this repo (instance i824449a32d1).
Open        (a) How the step reaches the seat: the lead pastes the brief into the
                assignment, or the seat calls a praxis step surface itself.
                Owner: lead. Evidence: what a Manifold assignment can carry today.
            (b) Room policy "forbidden" needs one operator rebind in the Manifold TUI.
                Owner: owner. This blocks (a) and everything below it.
Limits      No isolation, identity or exactly-once claim. Denial stays broker-only: a
            seat with a shell can still touch files its capabilities do not grant.
Acceptance  Compose a team and observe: zero rooms created, zero peer messages, each
            seat's first content is its step contract, and the engine's verdict is the
            only thing that says "done".
Assumed     That the owner will run the rebind. Marked assumed, not agreed.
```

## 1. What is actually missing today

Observed, this session:

- `.pi/manifold/profiles/tester.json` declares `"room": "required"` in all four
  templates — a room is created whether or not anyone needs one.
- Seats receive a Manifold assignment: an id, a title, a goal sentence. No schema, no
  gate, no capability list. "Done" is whatever the seat imagines.
- Praxis holds the real contract (`goal`, `capabilities`, `produces`, `gate`,
  `requires`) per step, but nothing hands it to the seat.
- `grep -c praxis .pi/manifold/profiles/tester.json` → 0. No seat is even told the
  engine exists.

## 3. Test results — 2026-10-29, real team, real instance

Store: fresh v2 (`praxis.sqlite`); the v1 store was moved whole to
`/tmp/praxis-state-v1-1793299103342`, nothing deleted.
Instance: `i2301352dcea90314fd75102f2a5f9d3c` (`flows/workflow`), nonce
`836e5abca349720d9402e87b8c8ebfcd`.

**T0 — no room. PASS.** `tt1` (test template, `launch:false`) returned
`"room": null`; `SELECT count(*) FROM rooms WHERE team=tt1` → 0. `tt3` (research
template, launched) the same. The channel does not exist, it is not merely unused.

**T2 — one seat, one step, no chat. PASS.** `tt3` — lead, main-researcher,
researcher-1, researcher-2, room forbidden. Assignment
`2b16a83d-d014-480d-b496-07ae2e2b03a9` carried the step contract for `research`:
goal, capabilities `[artifact.write, emit]`, schema `praxis.artifact.delivery/v1`,
seven required sections, the nonce, and the exact command to submit.
Observed: artifact v1 refused by the gate, v2 accepted
(`sha256:1ddcb00d059f8bcc22c6d9c48509ca05f068c9a862faa2852fa11b37f518fedd`),
instance advanced `research → spec`, assignment reported. Total messages in the
project: 105, every one a `control` message; **zero peer traffic, zero room posts**.
Between the assign and the acceptance, not one seat spoke to another.

**T3 — the gate refuses incomplete work. PASS.** A `spec` artifact missing
`exclusions` and `alternatives`, and carrying `outcome` as a string:
`{"error":{"code":"ARTIFACT_INVALID",...,"missing":["outcome: not a section","exclusions","alternatives"]}}`
— and the instance stayed at `spec`, revision unchanged. The engine is the judge.

**T1 — peer-to-peer denial. NOT RUN.** No seat attempted a peer send, so the route
denial is inferred from the profile matrix, not observed. Recorded as untested.

**Cleanup.** tt1, tt2, tt3 drained, retired and archived; zero active teams; only the
`lead` attempt remains live. The repo has no seat-written file: `git status` shows
only this unit, the two profile files and `AGENTS.md`.

## 2. Stop condition

Nothing is built until Open (b) is answered: with rooms allowed, the chat channel that
produced the failure stays, and any seat discipline remains conduct rather than
enforcement.
