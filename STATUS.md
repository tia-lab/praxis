# Where we are

**Molecule core built through P6; P7 experience is the deepest layer.** As of 2026-10-30:
P0 contracts, P2 durable engine, P3 step runner, P5 artifacts, P6 Pi integration — shipped.
P7 experience — the per-dimension + global quality ratchet, execution notes and recall steering —
shipped and proven live at 16× concurrency on one store (24/24 clean; honest-uncertainty ratcheted
0.60→0.775, grounded the laggard, 5 flagged, 2 compound refusals, all notes closed).
**P4 adapters: closed at the current set (Pi broker + jev scorer) by owner decision (2026-10-30).**
**P1 authority: capability intersection + routed-call denial built; trusted identity (gate #3)
consciously deferred — no identity claim made.** Open: gate #1 isolation, #4 flow expansion,
#6 durability retention/migration, #7/P8 maintenance, #8 nested budgets; P9 full architect
scenario not yet run end to end. Deferred means a conscious choice not to build now, not a met gate.

**Earlier milestones:** Slice 0 accepted; Pi integration + step brief/flow position shipped;
P5 artifact templates (hash8 99d43024) shipped; engineering task/flow library landed (2026-10-29).

## P5 — artifact templates (unit E, hash8 99d43024)

Two things, no new store/gate/dependency:
- **Typed field contracts.** A task's `requires` clause now takes, all opt-in and
  deterministic: field `type`, a `note` (guidance shown in the brief), `strict`
  (no extra keys), `minLength`/`maxLength`, `pattern`, `enum`, and cross-section
  `references` ("section.field"). Untyped clauses behave exactly as before.
  `.pi/praxis/tasks/design/spec.json` is the worked example.
- **Provenance in the brief.** The step descriptor now carries `consumes` (accepted
  predecessor refs), `derivedFrom` (single data source) and `subject` (when the step
  binds one), so a consuming step has the exact digest to carry and passes on first
  submit — closing the gap the live agent found (plan lost a version discovering it).

Files: `src/types/schema.ts`, `src/runner/requirements.ts`, `src/types/pi.ts`,
`src/runner/engine.ts`, `src/pi/tool.ts`, `.pi/praxis/tasks/design/spec.json`,
`tests/runner/template.test.ts`. Verified: `tsc` clean; 146/146 tests;
feature flow resolves and the typed spec parses with `references` intact.

## Task/flow library (new)
Tasks are atoms (one task = one gated artifact); flows compose them with edges
(`data` sequential, `join` merge, `refuse` loop back on rejection). Organised under
`.pi/praxis/`:

```
tasks/
  discovery/  research  reproduce  assess
  design/     spec  plan  plan-lite
  build/      implement  patch  refactor
  verify/     verify  review  review-lite
flows/
  engineering/
    feature    research → spec → plan → implement → verify → review   (refuse review→plan)
    bugfix     reproduce → spec → plan → patch → verify → review       (refuse review→plan)
    fix        reproduce → plan-lite → patch → review-lite             (refuse review→plan)  [small]
    refactor   assess → plan-lite → refactor → review                  (refuse review→plan)
```

Weight scales with the work: the big `feature` flow chains six atoms with the full
`plan` and full `review`; the small `fix` flow chains four with `plan-lite` and
`review-lite`; every flow loops failed reviews back to planning. Each `review`/`review-lite`
`bindsSubject` and consumes exactly one predecessor, so the subject digest is well-defined.
Distinct artifact schemas per stage (research/spec/plan/change/verification/review) now show
up in the agent's step `brief`.

Default flow (no `PRAXIS_CONFIG`) is now `flows/engineering/feature.json`; select another with
`PRAXIS_CONFIG=.pi/praxis/flows/engineering/fix.json` etc.

The previous placeholder schemas were frozen into `tests/praxis-schemas/` and the five
schema-coupled tests were rebound there (path-only, no logic change), so the committed library
is free to evolve.

Touched: `.pi/praxis/{tasks,flows}/**` (rebuilt), `src/pi/tool.ts` + `src/runner/engine.ts`
(default path), `tests/{runner,store,pi}/*` (path rebinds only). `tsc` clean; 139/139 tests
pass; all four flows load and resolve their task atoms through the engine.

## Slice 0, closed
- Headless two-phase runtime; acceptance run in three processes; owner accepted.

## Pi integration, shipped
- One Pi tool `praxis` (`start`/`submit`/`read` + `issue.template`/`issue.open`).
- Step descriptor now carries `steps` (flow position) and `brief` (goal, produces schema,
  section contract) so an agent knows where it is and what to produce.
- Broker-only guard; no isolation (gate #1), no trusted identity (gate #3) claimed.

## Not done
- Feature-request → workflow routing: the flow is still fixed by `PRAXIS_CONFIG`/default; an
  agent may not choose its own gates. A router that maps a request to feature/bugfix/fix/refactor
  is a separate unit with an owner decision about who selects the flow.
