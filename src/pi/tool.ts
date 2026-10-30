/**
 * The `praxis` tool surface — what Pi loads. The tool identity, the host argument schema, the args
 * parse and the dispatcher live here; every op handler lives in `./operations.ts` and the descriptor
 * projections in `./descriptor.ts`. This file re-exports the names tests and fixtures have always
 * imported from it, so no import path changed when the handlers moved.
 *
 * Limit, stated plainly: the guard here constrains calls routed through this tool. It does not block
 * `bash`, `read`, Fabric, MCP, another extension or a new session, and claims no isolation, sandbox
 * or trusted identity (gate #1 and #3 stay open).
 */
import { z } from "zod";
import { PraxisToolOpSchema, PraxisToolArgsSchema } from "../types/pi.ts";
import { parseWith } from "../types/schema.ts";
import { ISSUE_CATEGORIES } from "../types/issue.ts";
import {
  checkOperation,
  failure,
  IssueOpArgsSchema,
  issueOperation,
  IssueOpSchema,
  noteOperation,
  readOperation,
  recallOperation,
  startOperation,
  submitOperation,
} from "./operations.ts";
import type { PiSessionContext, PiToolDefinition, PiToolResult } from "./host.ts";

// The pre-split public surface, unchanged for every caller.
export { actorFor, engineOptions, failure, ok, setAlignJudgeForTest, setScorerForTest } from "./operations.ts";
export { stepDescriptor } from "./descriptor.ts";

export const PRAXIS_TOOL_NAME = "praxis";

export const PRAXIS_TOOL_DESCRIPTION = [
  "Run one step of a Praxis flow in this session.",
  "op=start opens or re-opens a flow instance and returns the six-key result, the current step descriptor and the nonce.",
  "op=submit advances exactly one step with the artifact JSON for that step.",
  "op=check dry-runs an artifact against the current step's section requirements and returns {ok, missing, step} without recording anything: no event, no attempt, no nonce or schema check.",
  "op=read returns one recorded artifact when the current step grants artifact.read.",
  "op=note submits the subjective lesson a step owes once its artifact was accepted (whatWrong, whatRight, whatBetter, dimension-keyed tags): the engine derives the objective half itself, and the step's work does not advance until the note is recorded.",
  "op=issue.template returns the field spec a report for one category must answer; op=issue.open files that report through the project's configured issue block.",
  "Only calls routed through this tool are gated by the step grant: other tools are not blocked and no isolation is claimed.",
].join(" ");

/** The two issue ops; the writer in `src/runner/issues.ts` owns their semantics. */

const PraxisOpSchema = z.enum([...PraxisToolOpSchema.options, ...IssueOpSchema.options]);

/**
 * What the host declares: the shared argument shape plus the issue ops. The three
 * original ops are still parsed by `PraxisToolArgsSchema` itself, so their per-op
 * requirements keep their single owner.
 */
const PraxisHostArgsSchema = z.strictObject({
  ...PraxisToolArgsSchema.shape,
  op: PraxisOpSchema,
  category: z.enum(ISSUE_CATEGORIES).optional(),
  title: z.string().min(1).max(120).optional(),
  summary: z.string().min(1).max(2000).optional(),
  severity: z.enum(["blocker", "major", "minor"]).optional(),
  affected: z.string().min(1).max(512).optional(),
  evidence: z.string().min(1).max(32768).optional(),
  categoryFields: z.record(z.string(), z.string().min(1).max(4096)).optional(),
});

/** The host parameters, generated from Zod (no hand-written schema). */

export const PRAXIS_TOOL_PARAMETERS = z.toJSONSchema(PraxisHostArgsSchema, {
  target: "draft-2020-12",
});

/** `issue.open` arguments: the common fields, plus the category's own under `categoryFields`. */

export async function executePraxisTool(args: unknown, ctx: PiSessionContext): Promise<PiToolResult> {
  try {
    const op = (args as { op?: unknown } | null | undefined)?.op;
    if (op === "issue.template" || op === "issue.open") {
      return issueOperation(parseWith(IssueOpArgsSchema, args, "CONFIG_INVALID", "praxis arguments"), ctx);
    }
    const parsed = parseWith(PraxisToolArgsSchema, args, "CONFIG_INVALID", "praxis arguments");
    // `await`, not `return`: an async rejection must reach the catch below (R8: never reject).
    if (parsed.op === "start") return await startOperation(parsed, ctx);
    // `await`, not `return`: an async rejection must reach the catch below (R8: never reject).
    if (parsed.op === "submit") return await submitOperation(parsed, ctx);
    if (parsed.op === "note") return await noteOperation(parsed, ctx);
    if (parsed.op === "check") return await checkOperation(parsed, ctx);
    if (parsed.op === "recall") return await recallOperation(parsed, ctx);
    return readOperation(parsed, ctx);
  } catch (error) {
    return failure(error);
  }
}

/** The one tool definition the extension registers, in the host's own shape (R1, R4). */

export function createPraxisTool(): PiToolDefinition {
  return {
    name: PRAXIS_TOOL_NAME,
    label: "Praxis",
    description: PRAXIS_TOOL_DESCRIPTION,
    parameters: PRAXIS_TOOL_PARAMETERS,
    executionMode: "sequential",
    async execute(
      _toolCallId: string,
      params: unknown,
      _signal: AbortSignal | undefined,
      _onUpdate: ((partial: PiToolResult) => void) | undefined,
      ctx: PiSessionContext,
    ): Promise<PiToolResult> {
      return executePraxisTool(params, ctx);
    },
  };
}

