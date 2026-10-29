# Research — slice-0

Task: slice-0 · Hash: 1947a537 · Gate: G1 · Status: reviewed · Date: 2026-10-29

## 0. Contract

task: Build Slice 0, a headless two-phase runtime proving phase containment, artifact handoff, resume and a bounded result
scope: src/, tests/, the slice-0 task folder in docs/
acceptance: two separate processes; phase B receives only the artifact reference and its bytes; removing artifact access fails closed; a corrupted digest fails closed; a restart between phases preserves the accepted artifact and current step; the parent result carries no transcript; every check is executed and its output recorded

```sh
canonical() { printf 'task: %s\nscope: %s\nacceptance: %s\n' "$1" "$2" "$3" \
  | sed -E 's/[[:space:]]+$//'; }
canonical "<task>" "<scope>" "<acceptance>" | sha256sum | cut -c1-8   # 1947a537
```

## 1. Inheritance rather than re-derivation

The accepted programme (`docs/vision-phases-4c18bcef/research.md` §6) supplies the instance
model, the eight durable states, the verdict rule, the artifact contract and the two-phase
proof. This unit **inherits** them; re-deriving them here would duplicate one authority for
the same facts (`MIN-005`). What is researched here is only what the slice needs and the
programme did not settle.

## 2. What exists today (source-inspected unless labelled)

| Fact | Evidence |
| --- | --- |
| `src/` is empty; no `tests/` exists | `ls src` |
| `package.json` is still manifold's: `pi-manifold`, dead scripts, `zod 4.6.7`, `@nats-io/transport-node` | read of the file |
| `tsconfig.json` exists but is inherited and unused by any build | read of the file |
| Node is v24.9.0 | executed (`node --version`) during the research unit |
| `node:sqlite` `DatabaseSync` with `journal_mode=WAL` works; sorted-key sha256 is stable across key order | executed probe in the research unit, temp file removed |
| `.pi/praxis/` is ignored **wholesale** by `.gitignore` | `git check-ignore` |
| Manifold is active and the blueprint now converges on `lead` | `diagnose` / `org.teams.config` after the rebind |

## 3. Questions the slice must settle

| # | Question | Why the programme did not settle it |
| --- | --- | --- |
| Q1 | Store location and the minimum table set | §6.5 names the store requirement, not its shape for one flow |
| Q2 | How a step's capability set is expressed and denied in a headless process | §6.5 E3 states the rule; the slice needs a concrete closed registry |
| Q3 | Exactly what phase B receives | §6.4 gives the handoff fields; the slice must fix the literal payload |
| Q4 | What the restart proof kills, and how the state survives | §6.7 states the assertion, not the procedure at process level |
| Q5 | Dependency posture: zero-dep or Zod | §6.8 recommends Zod for contracts, but `package.json` is inherited residue, so importing it now borrows another project's manifest |

## 4. Findings

- F1 [source-inspected] A headless two-process proof is **stronger** than an in-process test for
the same claim: different PID, different memory, no shared module state. It cannot prove the
Pi host seam, and no claim should say it does.
- F2 [source-inspected] `.pi/praxis/` being ignored wholesale would also ignore a tracked flow
config. The rule must narrow to `.pi/praxis/state/` in this unit.
- F3 [inference] The slice needs no third-party dependency: `node:sqlite`, `node:crypto` and
`node:test` cover durability, digests and checks. Adopting Zod here would pull the inherited
manifest into the slice's scope.
- F4 [inference] `validating` can be folded into a deterministic gate for the slice because a
schema-valid, nonce-bearing artifact is the whole acceptance condition; the owner-acceptance
state is deferred to the next iteration (research §6.3 option (c)).

## 5. Uncertainty

- `node --experimental-strip-types` behaviour on 24.9 is **untested**; if it fails the fallback
is a build step, which is scope this unit must not silently absorb.
- SQLite `synchronous=FULL` under power loss is **untested**; only process death is tested.

## 6. Handoff

The spec fixes the same five questions with concrete shapes; anything it cannot fix is
listed as an open question rather than guessed.
