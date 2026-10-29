/**
 * The Pi extension entry point: exactly one tool, no hook (R1, R11).
 *
 * `praxis` is the whole surface. This module registers no `tool_call` or
 * `tool_result` handler, command or provider, because a Pi-wide tool lockdown has
 * no step-to-tool owner in the flow config and is a separate unit, not this slice.
 */
import type { PiHost } from "./host.ts";
import { createPraxisTool } from "./tool.ts";

export default function praxisExtension(pi: PiHost): void {
  pi.registerTool(createPraxisTool());
}
