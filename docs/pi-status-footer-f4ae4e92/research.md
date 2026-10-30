# Research — a minimal right-aligned Pi status footer over the prompt bar

Task: pi-status-footer · Hash: f4ae4e92 · Gate: G1 · Date: 2026-10-30 · Method: read the installed
Pi package's own docs, type declarations and compiled interactive-mode source. Every claim below
cites `path:line`. Version read: the package installed at
`/home/tia/.bun/install/global/node_modules/@earendil-works/pi-coding-agent` (docs `docs/tui.md`,
195 lines; types `dist/core/extensions/types.d.ts`; source
`dist/modes/interactive/interactive-mode.js`).

## Q1 — does Pi support an element placed over the prompt bar, right-aligned?

**Yes.** The exact surface is `ctx.ui.setWidget(key, content, { placement: "aboveEditor" })`, and
`aboveEditor` is the default.

- `docs/tui.md:13` — "Persistent content near the editor | `ctx.ui.setWidget()`".
- `docs/tui.md:192` — `widget-placement.ts` "places persistent content around the editor".
- `examples/extensions/widget-placement.ts:5-6` — the whole example:
  `ctx.ui.setWidget("widget-above", ["Above editor widget"]);` and
  `ctx.ui.setWidget("widget-below", ["Below editor widget"], { placement: "belowEditor" });`
- `dist/core/extensions/types.d.ts:47` — `export type WidgetPlacement = "aboveEditor" | "belowEditor";`
- `dist/core/extensions/types.d.ts:49-52` — `interface ExtensionWidgetOptions { placement?: WidgetPlacement }`
  with "Defaults to \"aboveEditor\"" in the doc comment.
- `dist/modes/interactive/interactive-mode.js:1854` — `const placement = options?.placement ?? "aboveEditor";`

**Placement is literally over the prompt bar.** The interactive view mounts its containers in this
order (`interactive-mode.js:691-699`):

```
documentContainer        // transcript
pendingMessagesContainer
statusContainer          // working indicator
widgetContainerAbove     // <- placement "aboveEditor"
editorContainer          // <- the prompt bar
widgetContainerBelow
footerContainer          // the built-in footer line (git branch, statuses, context)
```

and extension widgets are routed into that container
(`interactive-mode.js:1934`: `renderWidgetContainer(this.widgetContainerAbove, this.extensionWidgetsAbove, true, true)`).
So an `aboveEditor` widget is the last thing above the prompt bar and the first thing below the
transcript — exactly the requested position, no renderer hacking.

**Right alignment is not automatic: it needs the component form.** `setWidget` accepts two content
shapes (`types.d.ts:101-104`):

1. `string[]` — each line becomes `new Text(line, 1, 0)` (`interactive-mode.js:1853-1860`), i.e. left
   padding 1, and `Text` has `paddingX` but no alignment (`@earendil-works/pi-tui`
   `dist/components/text.js`, class `Text`). Left-aligned; at most `MAX_WIDGET_LINES = 10` lines.
2. `(tui: TUI, theme: Theme) => Component` — a component whose `render(width)` we own
   (`types.d.ts:102-104`, factory invoked at `interactive-mode.js:1861`: `component = content(this.ui, theme)`).

The component contract is two required members (`@earendil-works/pi-tui` `dist/tui.d.ts:68-89`):
`render(width: number): string[]` and `invalidate(): void`. So **form 2 is the surface that lets us
right-align**: pad the line to the supplied width ourselves.

**Clearing is supported and is the blank state.** `setWidget(key, undefined)` disposes and removes the
component for that key and re-renders (`interactive-mode.js:1853-1859`); when no widget is registered
the container holds Pi's own `Spacer(1)` (`interactive-mode.js:1936-1938`), i.e. the pre-existing
layout, so clearing leaves no residue. Setting the same key again disposes the previous component and
replaces it, so a re-render per update needs no manual invalidation.

**Widgets are per-session and reset for us.** `resetExtensionUI()` calls `clearExtensionWidgets()` on a
session rebind (`interactive-mode.js`, `resetExtensionUI`), so a new session starts with no footer
without any bookkeeping on our side.

## Q2 — where does the displayed fact come from (no second owner, no store field)?

The runtime already returns it. The six-key result carries the flow key and the instance id
(`src/types/schema.ts:448-455`: `instanceId`, `flow`, `status`, `artifacts`, `summary`, `nextAction`),
and every step-bearing envelope carries the current step id (`src/types/pi.ts:93-96`
`StepDescriptorSchema { id, capabilities, ops, steps, ... }`). Per envelope:

| op | envelope | what the footer can read |
| --- | --- | --- |
| `start` | `StartEnvelopeSchema` (`pi.ts:158-162`) | `result.flow`, `result.instanceId`, `step.id` |
| `submit` | `StepEnvelopeSchema` (`pi.ts:165-168`) | same |
| `note` | `NoteEnvelopeSchema` (`pi.ts:177-180`) | same |
| `check` | `CheckEnvelopeSchema` (`pi.ts:196-200`) | `step` (a bare step id) only |
| `read` | `ReadEnvelopeSchema` (`pi.ts:171-174`) | nothing about position |
| `recall` | `RecallEnvelopeSchema` | nothing about position |
| any failure | `FailureDetails` (`code`, `message`) | nothing |

So the footer is a projection of the envelope the agent already received: no store read, no new field,
no competing copy of "which instance/step this session is on". `check` can update the step while
keeping the flow it last saw; `read`/`recall`/failures leave the display untouched.

Flow label: `flow` is a path under `flows/` (`schema.ts:30-38`, `FlowNameSchema = pathUnder("flows")`),
so the displayed name is its last segment — `flows/delivery` renders as `delivery`.

## Q3 — how does the extension reach `ctx.ui`?

The tool's `execute` receives `ctx: ExtensionToolContext`, which extends `ExtensionContext` with
`ui`, `mode` and `hasUI` (`types.d.ts:213-224` `ExtensionContext`; `:262-269` `ExtensionToolContext`;
`:514` the `execute(...)` signature). So the extension can wrap its own tool definition's `execute`
and publish from the call's own context — no event subscription, no mutation of Pi's internals, and
the tool contract (`src/pi/host.ts` `PiToolDefinition`) keeps its exact shape. In non-TUI modes
`hasUI` is false and the publish is a no-op (`docs/tui.md:9-15`: `ctx.ui` first, and
`ctx.mode !== "tui"` guards terminal-only UI).

## Q4 — right-alignment mechanics and width safety

`docs/tui.md:26` says to use `visibleWidth()`/`truncateToWidth()` rather than hand-rolling terminal
width. Both are exported by `@earendil-works/pi-tui` (installed; `dist/index.d.ts` exports
`TruncatedText, truncateToWidth, visibleWidth`), and the package is already a declared optional peer
dependency of this project (`package.json` `peerDependencies`).

**Decision: the footer module stays dependency-free and pads from the plain string.** The reason is
concrete, not laziness: every token we display is schema-constrained ASCII — flow path segments and
step ids are kebab names (`schema.ts:15`, `:30-38`) — so for our text
`visibleWidth(plain) === plain.length`. We therefore compute the padding on the unstyled string and
apply the theme colour afterwards (the colour is a foreground escape, so it cannot change the
visible width of the spaces). Truncation, when the terminal is narrower than the label, is likewise a
plain `slice` — again only ever applied to kebab ASCII. If a future footer ever shows free text, this
decision must be revisited and `truncateToWidth` used instead; the plan records that.

## Q5 — the alternatives, and why they are not this element

| Surface | Cited | Verdict |
| --- | --- | --- |
| `setWidget(..., { placement: "aboveEditor" })` | `types.d.ts:47-52`, `interactive-mode.js:691-699` | **chosen** — exactly over the prompt bar, ours to render, clearable |
| `setStatus(key, text)` | `types.d.ts:84` — "Set status text in the footer/status bar" | wrong position: it writes into Pi's built-in footer line below the editor, left side, alongside git branch and context usage; also not ours to align |
| `setFooter(factory)` | `types.d.ts:106-116` | replaces Pi's entire footer (dropping git branch, context usage, extension statuses). A far bigger claim than "one minimal element", and it is not over the prompt bar |
| `ctx.ui.custom({ overlay: true })` | `docs/tui.md:130-150` | an interactive screen that owns the area and a completion lifecycle; `docs/tui.md:150` — "Do not call `OverlayHandle.hide()` on an overlay created by `ctx.ui.custom()`". Wrong shape for a passive readout |
| `setTitle` | `types.d.ts` `setTitle` | the terminal window/tab title, not the prompt area |
| editor component (`setEditorComponent`) | `docs/tui.md:196-198` (`CustomEditor`) | replaces the input itself; it must keep IME, focus and shortcuts working — vastly more risk for a status readout |

## What is still unverified (labelled honestly)

- **Documented + source-inspected, not yet executed**: that an `aboveEditor` component factory renders
  right-aligned in a live terminal. The implementation verification will prove the wiring and the
  rendered string at a given width through a test with a fake `ui`; whether the TUI paints it at the
  right edge is asserted by the padding arithmetic, not by a screenshot.
- **Not tested in this unit**: RPC mode (`docs/rpc-extension-ui.md`) — `hasUI` is true there, and
  `setWidget` exists in the RPC UI context; the extension only publishes when `hasUI` and a
  `setWidget` are both present, so RPC behaviour is "whatever RPC does with widgets", out of scope.
- **Narrow terminals**: truncation is plain-slice; a very narrow terminal may clip the label rather
  than show an ellipsis. Accepted for a minimal readout.
