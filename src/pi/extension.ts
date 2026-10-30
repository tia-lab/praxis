/**
 * The Pi extension entry point: exactly one tool, no hook (R1, R11), and one status footer.
 *
 * `praxis` is the whole tool surface. This module registers no `tool_call` or `tool_result` handler,
 * command or provider, because a Pi-wide tool lockdown has no step-to-tool owner in the flow config and
 * is a separate unit, not this slice.
 *
 * The footer is display only: `withFooter` republishes the right-aligned "flow · step" readout over the
 * prompt bar from each result the tool already returned. It reads no store, writes nothing, and returns
 * the very result it received, so it cannot change a call's outcome.
 */
import type { PiHost } from "./host.ts";
import { withFooter } from "./footer.ts";
import { createPraxisTool } from "./tool.ts";

export default function praxisExtension(pi: PiHost): void {
  pi.registerTool(withFooter(createPraxisTool()));
}
