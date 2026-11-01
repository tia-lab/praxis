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
import { createPromptHook } from "./prompt-hook.ts";

/**
 * The tool, plus one hook that composes the whole system prompt at each run boundary: conduct, role, the
 * current step's domain, then Pi's own prompt nested last. The hook composes nothing when no role is claimed,
 * so an unconfigured host keeps Pi's prompt exactly.
 */
export default function praxisExtension(pi: PiHost, cwd: string = process.cwd()): void {
  pi.registerTool(withFooter(createPraxisTool()));
  const hook = createPromptHook({ cwd });
  pi.on?.("before_agent_start", hook);
}
