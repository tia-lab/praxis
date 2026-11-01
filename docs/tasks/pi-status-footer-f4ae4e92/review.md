# Review — pi status footer

## G-review (small UI unit, §4 waived) — attempt 1 — PASS — 2026-10-30T17:33:09Z
subjects (sha256, first 16):
research.md 5f33df75fea2a8c2
plan.md a781b43b05c094a6
footer.ts cc18d45f0d81dda3
host.ts 3e01b779373901f5
footer.test.ts 1f35bb1fea73a158
reviewer: lead (session reviewing wB:p22's authored subject)  independence: independent
verdict basis:
- The Pi widget API is REAL, confirmed by grep of the installed package: `WidgetPlacement = "aboveEditor" | "belowEditor"` and the `setWidget(key, component|string[]|undefined, options)` overloads (dist/core/extensions/types.d.ts:47,101-102), `placement ?? "aboveEditor"` (interactive-mode.js:1854), docs/tui.md:13, and the shipped examples/extensions/widget-placement.ts. The component-factory form is what allows right-alignment, as the report states. CONFIRMED (not guessed).
- Derivation checked by read: footer.ts imports only host.ts types; `nextFooterState` projects `result.flow` + `step`/`step.id` from the tool's own `details`; no store read, no stored field, no second owner of the fact. Blank (setWidget undefined) when the session has no active instance.
- Scope checked by git: engine, store, src/types/pi.ts, src/pi/tool.ts, operations.ts and descriptor.ts are UNTOUCHED; only src/pi/extension.ts, src/pi/host.ts (type-only mirror) and the new src/pi/footer.ts changed, plus tests + docs. Display-only: no runtime behaviour change.
- tsc --noEmit exit 0; footer.test.ts 13/13; full suite 271/271 under the no-network stub, none changed.
- The right-align arithmetic runs on plain ASCII kebab tokens (schema-constrained), colour applied after, so column count is safe; the report records that a future free-text footer must switch to truncateToWidth. Sound and disclosed.
findings:
- F1 [accepted deviation] the readout is `praxis: <flow> · <step>`, not flow+task: neither the six-key result nor StepDescriptor carries the task id, so showing it would need a store read or a schema/contract change (both out of scope). It matches the owner's own example (`feature · research`); a true task-id surface is a separate unit if the owner wants it.
verdict: PASS. Over the prompt bar, right-aligned, derived not duplicated, display-only, scope confined, suite green. Accepted.
