/**
 * A minimal status footer over the prompt bar: the flow and current step of this session's active
 * praxis instance, right-aligned, and blank when the session has no active instance.
 *
 * The element is Pi's own `aboveEditor` widget (`ctx.ui.setWidget`, docs/tui.md:13): it is mounted
 * between the transcript and the editor (interactive-mode.js:691-699), i.e. directly over the prompt
 * bar. Only the component-factory form can be right-aligned — the `string[]` form wraps each line in
 * `new Text(line, 1, 0)`, which pads but never aligns.
 *
 * Nothing here reads the store, writes a record or changes a result. The display is a projection of
 * the envelope the tool already returned (the six-key result carries `flow`, `StepDescriptor` carries
 * `id`), so it owns no fact of its own and cannot disagree with the record.
 */
import type { PiFooterUi, PiSessionContext, PiToolDefinition, PiToolResult } from "./host.ts";

/** The widget key; one element, replaced in place on every update. */
export const FOOTER_WIDGET_KEY = "praxis:status";

/** What the footer shows: the flow key as the record holds it and the current step id. */
export interface FooterState {
  /** e.g. `flows/delivery`. */
  readonly flow: string;
  /** e.g. `research`. */
  readonly step: string;
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function textOf(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * The next footer state from one tool result's `details`, or `current` unchanged when the envelope
 * says nothing about the position. `start`/`submit`/`note` carry both halves; `check` carries the step
 * only, so the flow is kept; `read`, `recall` and every failure carry neither.
 */
export function nextFooterState(current: FooterState | undefined, details: unknown): FooterState | undefined {
  const envelope = recordOf(details);
  if (envelope === undefined) return current;
  const result = recordOf(envelope.result);
  const stepField = envelope.step;
  const stepRecord = recordOf(stepField);
  const flow = textOf(result?.flow);
  const step = textOf(stepField) ?? textOf(stepRecord?.id);
  if (flow !== undefined && step !== undefined) return { flow, step };
  if (step !== undefined && current !== undefined) return { flow: current.flow, step };
  return current;
}

/** The flow's own name: the last segment of `flows/<path>` (`schema.ts:30-38`). */
export function flowLabel(flow: string): string {
  const parts = flow.split("/");
  return parts[parts.length - 1] ?? flow;
}

/** The one line the footer renders. */
export function footerLabel(state: FooterState): string {
  return "praxis: " + flowLabel(state.flow) + " · " + state.step;
}

/**
 * Right-align one line in `width` columns. The arithmetic is on the PLAIN string on purpose: every
 * token shown here is schema-constrained kebab ASCII (`schema.ts:15`, `:30-38`), so its length is its
 * visible width, and the theme colour is applied afterwards so ANSI cannot affect the count. A width
 * narrower than the label clips it rather than wrapping (research Q4: switch to `truncateToWidth` if
 * this ever renders free text).
 */
export function rightAlign(line: string, width: number): string {
  const room = Math.floor(width);
  if (!Number.isFinite(room) || room <= 0) return "";
  if (line.length >= room) return line.slice(0, room);
  return " ".repeat(room - line.length) + line;
}

/**
 * Publish the state to Pi's widget slot. `undefined` removes the element entirely, leaving Pi's own
 * spacer — the layout that exists when no extension widget is registered. A UI without `setWidget`
 * (or no UI at all, e.g. print mode) is a no-op.
 */
export function publishFooter(ui: PiFooterUi | undefined, state: FooterState | undefined): void {
  if (ui === undefined || typeof ui.setWidget !== "function") return;
  if (state === undefined) {
    ui.setWidget(FOOTER_WIDGET_KEY, undefined);
    return;
  }
  const label = footerLabel(state);
  ui.setWidget(
    FOOTER_WIDGET_KEY,
    (_tui, theme) => ({
      render: (width: number): string[] => [theme.fg("muted", rightAlign(label, width))],
      invalidate: (): void => undefined,
    }),
    { placement: "aboveEditor" },
  );
}

/**
 * Wrap the tool definition so every call republishes the footer from its own result. The wrapper
 * returns the very result object it received and swallows any display error: the footer is display
 * only and must never change a call's outcome. A different session id resets the state, so one
 * session's flow is never shown in another's prompt area.
 */
export function withFooter(definition: PiToolDefinition): PiToolDefinition {
  const execute = definition.execute.bind(definition);
  let current: FooterState | undefined;
  let session: string | undefined;
  return {
    ...definition,
    async execute(
      toolCallId: string,
      params: unknown,
      signal: AbortSignal | undefined,
      onUpdate: ((partial: PiToolResult) => void) | undefined,
      ctx: PiSessionContext,
    ): Promise<PiToolResult> {
      const result = await execute(toolCallId, params, signal, onUpdate, ctx);
      try {
        const id = ctx.sessionManager?.getSessionId?.();
        // The first call of a session is not a switch: nothing is on screen yet to clear.
        const switched = session !== undefined && id !== session;
        session = id;
        const next = nextFooterState(switched ? undefined : current, result.details);
        // Compare the values, not the objects: the derivation builds a fresh record each call.
        const changed = next?.flow !== current?.flow || next?.step !== current?.step;
        if (switched || changed) publishFooter(ctx.ui, next);
        current = next;
      } catch {
        // Display only: a footer that cannot render must not fail the call.
      }
      return result;
    },
  };
}
