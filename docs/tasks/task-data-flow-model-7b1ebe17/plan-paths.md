# Plan — task identity as a path

Task: task-data-flow-model · Hash: 7b1ebe17 · Amendment: task identity is a path · Date: 2026-10-29

**Status 2026-10-29: implemented as `a75b969f`, accepted and committed in `6318963` — as a
reference, not as authority.** Where this plan's item 5 and item 7 say the definition row id is
`<path>@<version>`, the accepted implementation keys the row by the path (deviation D-b: a scan
instead of a keyed read was refused) and `publication` stays `(task, version)`. Item 3's
`PRAXIS_CONFIG` change was not authorized and `engine.ts:181` still passes it raw (D-c).

Basis: frozen `plan.md` (`sha256:5f23e927…1d2a1f`) items 3–6. Lead decision, not reopened: a node reference carries **no
version**, the task document keeps its `version`, and start pins `(path, version, digest)`. This plan amends spec R1–R4, the Model
Task document row and the amendment log; R5–R9 stand. Row counts in the items below are targets for the engineer's own test files,
not executed results; only item 8's command runs today.

1. **Amend R1–R4, the Model Task document row and the amendment log.** `docs/task-data-flow-model-7b1ebe17/spec.md` — R1 (:33), R2 (:34),
   R3 (:35), R4 (:36), the Task document row (:57), and one appended amendment-log line after :144 superseding the `<id>@<version>`
   statements at :135, :136 and :139: library path `.pi/praxis/tasks/<any/nested/path>.json`; reference `tasks/<path>` with no
   `@version`, malformed → `CONFIG_INVALID`; R4's pin id is `<path>@<version>`, the version taken from the document; pins and
   publications keyed `(path, version)`. New oracles: a nested path loads; a bare `tasks`, a leading slash, `.`, `..`, an empty
   segment and a `.json` suffix are `CONFIG_INVALID`; a missing path is `TASK_NOT_FOUND`; one path at two versions is two publications.
   **Check:** `grep -c 'path grammar' docs/task-data-flow-model-7b1ebe17/spec.md` → `5` (R1–R4 and the Task document row).
2. **`TaskRefSchema` becomes a path grammar — amends R2.** `src/types/schema.ts` — `TaskRefSchema` (:101), `parseTaskRef` (:122),
   `NodeSchema.task` (:108). Replace `^[a-z][a-z0-9-]{0,63}@[1-9][0-9]*$` with `^tasks/([a-z][a-z0-9-]{0,63}/)*[a-z][a-z0-9-]{0,63}$`:
   the folder group is zero-or-more, so `tasks/research` and `tasks/core/research` both match; lowercase kebab segments, no `@`, `.`,
   `..`, leading `/` or `.json`. `parseTaskRef` returns the path string, not `{id, version}`.
   **Check:** `node --test tests/runner/task-ref.test.ts` (new) → `pass 7 · fail 0`.
3. **The library walk refuses an escaping path — amends R1.** `src/runner/engine.ts` — `loadTask` (:138), `tasksDirOf` (:122).
   Replace `join(tasksDir, \`${id}@${version}.json\`)` (:140) with the reference + `.json`, then require the resolved path to stay
   inside `tasksDir` — a `..` crossing it is `CONFIG_INVALID` and nothing is read. Absent file → `TASK_NOT_FOUND` (:145); unreadable
   or invalid → `CONFIG_INVALID` with `{path}`. `tests/runner/task-library.test.ts` holds 7 top-level tests today; this item adds three —
   `an escaping task path is CONFIG_INVALID and nothing is read`, `an absent task path is TASK_NOT_FOUND`, `an unreadable or invalid task document is CONFIG_INVALID with its path`.
   **Check:** `node --test tests/runner/task-library.test.ts` → `pass 10 · fail 0`.
4. **`node.task` holds the path — amends R2.** `src/runner/engine.ts` (:191, `tasks.set(node.task, loadTask(tasksDir, node.task))`)
   and `src/types/schema.ts` (`NodeSchema` :108). The reference is `tasks/<path>`; resolution reads the document and takes its
   `version` for the pin, so the node carries no version.
   **Check:** `node --test tests/runner/edges.test.ts` → `pass 14 · fail 0` (`research@1`-style references are now `CONFIG_INVALID`).
5. **Pins and publications keyed by path plus version — amends R3.** `src/store/definitions.ts` — `INSERT_DEFINITION` (:71),
   `SELECT_PUBLICATION`/`INSERT_PUBLICATION` (:72, :73), `publicationOf` (:131), and the two identity checks that still parse a bare
   id: `PublicationRowSchema.task` (:54) and the `seed.task` parse in `insertPublication` (:143) widen from `StepIdSchema` to the
   path schema; the `DefinitionSeed.id` comment (:33) states `<path>@<version>` for tasks. `src/store/db.ts` leaves this item: no DDL
   changes — `definition.id` and `publication.task` are already `TEXT` and both keys are unchanged. `definition.id` is
   `<path>@<version>`, `publication.task` the path, the publication key stays `(task, version)`; a rewrite of one `(path, version)`
   stays `TASK_VERSION_CONFLICT`; the flow-document pin is unchanged by this item.
   **Check:** `node --test tests/runner/pin.test.ts` → `pass 9 · fail 0` (five today plus four; two versions of one path are two publications).
6. **Keep the five task documents flat, add one nested example — amends R1, R3.** `.pi/praxis/tasks/{research,spec,plan,implement,review}@1.json`
   become `.pi/praxis/tasks/{research,spec,plan,implement,review}.json` — same directory, one segment, content unchanged (`version: 1`,
   `state: "published"`, `bindsSubject: true` on review). The document's `id` is kept and must equal the last path segment: the five
   flat files keep `"id": "research"` … unchanged, and the nested example `.pi/praxis/tasks/core/research.json` declares
   `"id": "research"` too — the path is the identity, `id` the label — so `loadTask` compares `task.id` with the last segment, not with
   the old `<id>@<version>`.
   **Check:** `node --test tests/runner/task-library.test.ts` → `pass 11 · fail 0` (item 3's ten plus `a flat and a nested task path both resolve`).
7. **Point the flow documents at the paths — amends R2.** `.pi/praxis/flows/workflow.json` (:5-9, `"task": "<id>@1"` today) and its own
   flow name at :3, `"flow": "workflow"`. `node.task` at :5-9 becomes `tasks/<id>`, the flat path of item 6; `"flow"` at :3 becomes
   `"flows/workflow"` under item 10's `FlowPathSchema`.
   **Check:** `grep -c '"task": "tasks/' .pi/praxis/flows/workflow.json` → `5`; `grep -c '"flow": "flows/workflow"' .pi/praxis/flows/workflow.json` → `1`.
8. **Leave the committed legacy flows untouched — amends R2.** `.pi/praxis/config.json`, `.pi/praxis/flows/{research,delivery}.json`.
   **Check:** `git status --porcelain -- .pi/praxis/config.json .pi/praxis/flows/research.json .pi/praxis/flows/delivery.json` → empty.
9. **tsc and the suite.** **Check:** `npx tsc --noEmit` → exit 0, no output; `node --test 'tests/**/*.test.ts'` → `fail 0`; paste both.

10. **One segment rule for both kinds — amends R2.** `src/types/schema.ts`: one exported `PathSegmentsSchema`, used to build `TaskRefSchema` (:101) and a new `FlowPathSchema` (`flows/<segments>`) — one schema, not two, and the same zero-or-more folder rule applies under `flows/` as under `tasks/`. `FlowNameSchema` (:19) derives from it, so `FlowConfigSchema.flow` (:140), `InstanceSchema.flow` (:276) and `ResultSchema.flow` (:319) carry a path. `tests/runner/path-grammar.test.ts` (new) covers it.
    **Check:** `node --test tests/runner/path-grammar.test.ts` → `pass 8 · fail 0` (the six refusals — bare prefix, leading `/`, `.`, `..`, empty segment, `.json` — hold identically for tasks and flows, plus a flat and a nested accept for each).
11. **A flow resolves by path under `.pi/praxis/flows/` — amends R2.** `src/runner/engine.ts` (`openFlow` :170, default :172, `EngineOptions.configPath` :60), `src/cli.ts` (`--config` → `configPath` :50) and `src/pi/tool.ts` (:113-118): the selector is `flows/<path>` without `.json`, resolved under `.pi/praxis/flows/`, while `options.configPath` stays the resolved absolute file (default `…/.pi/praxis/flows/workflow.json`). An absolute selector that resolves inside `.pi/praxis/flows/` is accepted and maps to the pin key `flows/<path>` by dropping the directory prefix and the `.json` suffix; a selector outside that directory, or one carrying `.json`, `..` or a leading `/`, is `CONFIG_INVALID` with nothing read and no key. `tests/runner/flow-path.test.ts` (new) and `tests/pi/config-path.test.ts` (:10-19) are in this item: :10 stays `/project/.pi/praxis/flows/workflow.json`; :17 becomes `/project/.pi/praxis/flows/other.json` for selector `flows/other`; :19's `/abs/flow.json` becomes a typed `CONFIG_INVALID` assertion, and an absolute-inside case asserts key `flows/other`.
    **Check:** `node --test tests/runner/flow-path.test.ts` → `pass 5 · fail 0`; `node --test tests/pi/config-path.test.ts` → `pass 4 · fail 0` (default, relative selector, absolute outside refused, absolute inside keyed).
12. **A missing flow path is `FLOW_INVALID` with the path — amends R2.** `src/runner/engine.ts` `openFlow`: an absent document is `FLOW_INVALID` carrying `{path}`; the code is already in the closed union, so no widening.
    **Check:** `node --test --test-name-pattern 'FLOW_INVALID' tests/runner/flow-path.test.ts` → one `✔`; a pattern run with none is a failed check.
13. **The flow pin is keyed by the flow path — amends R3.** `src/runner/engine.ts` (:311 `kind: "flow"`, `loadPinnedFlow` :370, `instanceIdFor` :229) and `src/store/definitions.ts`, with `tests/runner/pin.test.ts` in this item: the `definition` row's `id` is `flows/<path>` and the instance id hashes that path, so two nested flows share neither row nor instance. `openFlow` requires the selector's derived key and the document's own `flow` (workflow.json:3 under item 7) to agree exactly — a mismatch is `CONFIG_INVALID` and nothing is pinned, so no instance can pin under a key other than the one item 14 asserts.
    **Check:** `node --test tests/runner/pin.test.ts` → `pass 11 · fail 0` (item 5's nine plus two nested flows, one row each).
14. **A nested flow and a nested task compose in one run — amends R1, R2, R3.** `tests/runner/nested.test.ts` (new): `.pi/praxis/flows/ops/deep/run.json` with `"task": "tasks/core/research"`, started under `PRAXIS_CONFIG=flows/ops/deep/run`; one advance accepts and the result's `flow` is `flows/ops/deep/run`.
    **Check:** `node --test tests/runner/nested.test.ts` → `pass 1 · fail 0`; then `node --test 'tests/**/*.test.ts'` → `fail 0`.
