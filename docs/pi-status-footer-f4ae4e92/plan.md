# Plan — a minimal right-aligned Pi status footer over the prompt bar

Task: pi-status-footer · Hash: f4ae4e92 · Gate: G3 · Date: 2026-10-30 · Status: draft
Predecessor: `research.md` (G1) confirms the surface — `ctx.ui.setWidget(key, factory, { placement:
"aboveEditor" })` mounts between the transcript and the editor, and only the component-factory form can
be right-aligned. No spec: this is a small display unit with no contract, model or store change.

## 1. Shape

One new module owns the whole element; the extension stays a two-line entry point.

| File | Change | Lines |
| --- | --- | --- |
| `src/pi/footer.ts` | **new** — the derivation, the label, the right-align, the publish, and the `withFooter` wrapper | ~130 |
| `src/pi/extension.ts` | registers `withFooter(createPraxisTool())` instead of the bare tool | 13 → 15 |
| `src/pi/host.ts` | the type-only mirror gains `PiFooterUi` + `ui?` on `PiSessionContext` (the host really carries `ui` on the tool ctx: `types.d.ts:213-224`, `:514`) | +22 |
| `tests/pi/footer.test.ts` | **new** — the derivation table, the blank case, alignment, and the wrapper's publish/clear | ~120 |

Nothing else changes: no engine, store, tool contract, handler, flow or task document.

## 2. Where the fact comes from (one owner)

The footer is a **projection of the envelope the agent already received**, never a store read:

| op | `result.flow` | `step` | footer after the op |
| --- | --- | --- | --- |
| `start`, `submit`, `note` | yes | `step.id` | flow + step both refreshed |
| `check` | no | bare step id | step refreshed, flow kept |
| `read`, `recall` | no | no | unchanged |
| failure (`code`/`message`) | no | no | unchanged |

`nextFooterState(current, details)` implements exactly that table; anything unrecognised leaves the
state untouched. No new store field, no second owner of "which instance is active", and re-deriving
from the same six-key result the parent sees means the footer cannot disagree with the record.

Blank when the session has no active instance: the state stays `undefined`, and `setWidget(key,
undefined)` removes the element entirely (research Q1), leaving Pi's own spacer — the pre-existing
layout.

## 3. Steps

1. `src/pi/footer.ts`: `FooterState`, `nextFooterState`, `footerLabel`, `rightAlign`,
   `publishFooter`, `withFooter`, `FOOTER_WIDGET_KEY = "praxis:status"`.
2. `src/pi/host.ts`: add the widget slice of the host UI (`PiFooterUi`, `PiFooterComponent`,
   `PiTheme`) and `readonly ui?: PiFooterUi` on `PiSessionContext`; document that the tool does not
   consult it and only the extension wrapper does.
3. `src/pi/extension.ts`: `pi.registerTool(withFooter(createPraxisTool()))`.
4. `tests/pi/footer.test.ts`.
5. Verify: `tsc`, the full suite, and a direct probe of `rightAlign`/`footerLabel` output.

## 4. Checks

| Check | Assertion |
| --- | --- |
| placement | `publishFooter` calls `setWidget("praxis:status", factory, { placement: "aboveEditor" })` — the only placement over the prompt bar (`interactive-mode.js:691-699`) |
| right alignment | `render(width)` returns exactly one line whose length === width and whose tail is the label, for widths above and below the label length |
| derivation | table in §2, plus `undefined` → `undefined` (blank) and `undefined` for failures |
| blank for none | no publish-time state → `setWidget(key, undefined)` |
| display only | the wrapped `execute` returns the **same** result object it received; a publish that throws is swallowed; `ctx.ui` absent → no calls, no throw |
| session switch | a different session id clears the footer before deriving from the new session |
| typescript | `npx tsc --noEmit` exit 0 |
| suite | the full suite green under the no-network stub, count unchanged (258 → 258 + the new file) |
| scope | `git diff` limited to the four files above plus this folder |

## 5. Out of scope

A richer TUI (multi-line, colours per step, clickable), the built-in footer replacement
(`setFooter`), `setStatus` inside Pi's own footer line, RPC-mode behaviour, persisting the active
instance, any change to the tool's arguments, envelope, descriptor or the engine. No new runtime
dependency: `rightAlign` pads the plain string because every displayed token is schema-constrained
kebab ASCII (`schema.ts:15`, `:30-38`); if a future footer shows free text it must switch to
`truncateToWidth` (research Q4 records this).

## 6. Risk

The element is drawn by Pi from our `render(width)`; a wrong width computation would clip or
overflow by one column. Mitigated by: plain-string arithmetic only, a test at two widths, and the
documented rule that theme colour is applied after padding so ANSI cannot affect the count.
