/**
 * The `praxis` tool: one bounded surface over the accepted Slice 0 engine (R1-R13).
 *
 * Three operations, one argument schema: `start` opens or re-opens the instance a
 * request id names and returns the six-key result with the derived step descriptor
 * and the pinned nonce; `submit` calls `advance` exactly once; `read` returns one
 * recorded artifact, and only after the current step's grant allows `artifact.read`.
 *
 * The descriptor is derived from the pinned flow and the instance on every call and
 * is never stored (R6). Every operation failure leaves through one typed `isError`
 * result built from `src/types/errors.ts`; a failed instance state is not an
 * operation failure and travels inside a successful six-key result (R8, R13).
 *
 * Limit, stated plainly: the guard here constrains calls routed through this tool.
 * It does not block `bash`, `read`, Fabric, MCP, another extension or a new session,
 * and claims no isolation, sandbox or trusted identity (R10, R11; gate #1 stays open).
 */
import { resolve } from "node:path";
import { z } from "zod";
import { asAppError, fail } from "../types/errors.ts";
import { ActorSchema, parseWith } from "../types/schema.ts";
import type { Artifact, Instance, StepConfig } from "../types/schema.ts";
import { ArtifactSummarySchema, FailureDetailsSchema, PraxisToolArgsSchema, ReadEnvelopeSchema, StartEnvelopeSchema, StepDescriptorSchema, StepEnvelopeSchema } from "../types/pi.ts";
import type { ArtifactSummary, FailureDetails, PraxisToolArgs, StepDescriptor } from "../types/pi.ts";
import { CAPABILITY_NAMES, grantFor, requireGrant } from "../runner/capabilities.ts";
import { digest } from "../runner/canonical.ts";
import { advance, inspect, openFlow, readStepArtifact, start } from "../runner/engine.ts";
import type { EngineOptions, OpenedFlow } from "../runner/engine.ts";
import type { PiSessionContext, PiToolDefinition, PiToolResult } from "./host.ts";

export const PRAXIS_TOOL_NAME = "praxis";

export const PRAXIS_TOOL_DESCRIPTION = [
  "Run one step of a Praxis flow in this session.",
  "op=start opens or re-opens a flow instance and returns the six-key result, the current step descriptor and the nonce.",
  "op=submit advances exactly one step with the artifact JSON for that step.",
  "op=read returns one recorded artifact when the current step grants artifact.read.",
  "Only calls routed through this tool are gated by the step grant: other tools are not blocked and no isolation is claimed.",
].join(" ");

/** The host parameters, generated from the one Zod schema (no second authority). */
export const PRAXIS_TOOL_PARAMETERS = z.toJSONSchema(PraxisToolArgsSchema, {
  target: "draft-2020-12",
});

/**
 * Resolve the engine paths under the host session's cwd, never `process.cwd()`:
 * a caller's project root is the host context's, not this module's (R3, R5, G3-F6).
 */
export function engineOptions(
  ctx: PiSessionContext,
): Required<Pick<EngineOptions, "configPath" | "storeDir">> {
  if (typeof ctx.cwd !== "string" || ctx.cwd === "") {
    throw fail("CONFIG_INVALID", "the host context carries no working directory");
  }
  return {
    configPath: resolve(ctx.cwd, ".pi/praxis/config.json"),
    storeDir: resolve(ctx.cwd, ".pi/praxis/state"),
  };
}

/** First 32 hex of sha256 over `session:` + id, with the `sha256:` prefix removed. */
function shortDigest(sessionId: string): string {
  return digest("session:" + sessionId).slice(7, 39);
}

/**
 * The actor is a correlation label derived from the host session, never from tool
 * arguments (R10). `start` uses it to decide re-open versus conflict; `submit` and
 * `read` are bound by the instance and the step grant. No authorization decision
 * may rely on it: gate #3 stays open.
 */
export function actorFor(ctx: PiSessionContext): string {
  const sessionId = ctx.sessionManager?.getSessionId?.();
  if (typeof sessionId !== "string" || sessionId === "") {
    throw fail("CONFIG_INVALID", "the host session has no id to label the actor", {
      source: "sessionManager.getSessionId",
    });
  }
  return parseWith(ActorSchema, "pi-session:" + shortDigest(sessionId), "CONFIG_INVALID", "actor label");
}

/** The current step of the pinned flow, or a typed refusal. */
function currentStepOf(flow: OpenedFlow, instance: Instance): StepConfig {
  const step = flow.config.steps.find((candidate) => candidate.id === instance.currentStep);
  if (step === undefined) {
    throw fail("CONFIG_INVALID", "current step " + JSON.stringify(instance.currentStep) + " is not in the pinned flow", {
      instance: instance.id,
      step: instance.currentStep,
      path: flow.path,
    });
  }
  return step;
}

/**
 * Derived `{id, capabilities, ops}` (R6): `submit` only while running under
 * `artifact.write`, `read` whenever the grant carries `artifact.read`, in that order.
 */
export function stepDescriptor(flow: OpenedFlow, instance: Instance): StepDescriptor {
  const grant = grantFor(currentStepOf(flow, instance));
  const ops: ("submit" | "read")[] = [];
  if (instance.status === "running" && grant.capabilities.has("artifact.write")) ops.push("submit");
  if (grant.capabilities.has("artifact.read")) ops.push("read");
  return parseWith(
    StepDescriptorSchema,
    {
      id: grant.step,
      capabilities: CAPABILITY_NAMES.filter((name) => grant.capabilities.has(name)),
      ops,
    },
    "RESULT_INVALID",
    "step descriptor",
  );
}

/** The store row minus its path and bytes: what the parent is allowed to see (R7). */
function artifactSummary(artifact: Artifact): ArtifactSummary {
  return parseWith(
    ArtifactSummarySchema,
    {
      step: artifact.step,
      version: artifact.version,
      digest: artifact.digest,
      schema: artifact.schema,
      state: artifact.state,
    },
    "RESULT_INVALID",
    "artifact summary",
  );
}

/** A validated success envelope: `content` is the JSON text of the same `details` (R7). */
export function ok(schema: z.ZodType, details: unknown): PiToolResult {
  const parsed = schema.safeParse(details);
  if (!parsed.success) {
    throw fail(
      "RESULT_INVALID",
      "tool envelope is invalid",
      parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message })),
    );
  }
  return { content: [{ type: "text", text: JSON.stringify(parsed.data) }], details: parsed.data };
}

/** A typed operation failure (R8): `AppError` passes through, anything else is INTERNAL. */
export function failure(error: unknown): PiToolResult {
  const appError = asAppError(error);
  let details: FailureDetails;
  try {
    details = FailureDetailsSchema.parse(
      appError.detail === undefined
        ? { code: appError.code, message: appError.message }
        : { code: appError.code, message: appError.message, detail: appError.detail },
    );
  } catch {
    details = { code: appError.code, message: appError.message };
  }
  return { content: [{ type: "text", text: JSON.stringify(details) }], details, isError: true };
}

function required(value: string | undefined, what: string): string {
  if (value === undefined || value === "") {
    throw fail("CONFIG_INVALID", what + " is required");
  }
  return value;
}

function startOperation(args: PraxisToolArgs, ctx: PiSessionContext): PiToolResult {
  const actor = actorFor(ctx);
  const options = engineOptions(ctx);
  const started = start({
    ...options,
    flow: required(args.flow, "flow"),
    requestId: required(args.requestId, "requestId"),
    actor,
  });
  const { instance, result } = inspect({ ...options, instance: started.instance.id });
  return ok(StartEnvelopeSchema, {
    result,
    step: stepDescriptor(started.flow, instance),
    nonce: instance.nonce,
  });
}

function submitOperation(args: PraxisToolArgs, ctx: PiSessionContext): PiToolResult {
  const options = engineOptions(ctx);
  const advanced = advance({
    ...options,
    instance: required(args.instance, "instance"),
    artifact: args.artifact,
  });
  return ok(StepEnvelopeSchema, {
    result: advanced.result,
    step: stepDescriptor(openFlow(options), advanced.instance),
  });
}

function readOperation(args: PraxisToolArgs, ctx: PiSessionContext): PiToolResult {
  const options = engineOptions(ctx);
  const flow = openFlow(options);
  const { instance } = inspect({ ...options, instance: required(args.instance, "instance") });
  if (flow.configDigest !== instance.configDigest) {
    throw fail("CONFIG_INVALID", "the flow config no longer matches the digest this instance pinned", {
      instance: instance.id,
      pinned: instance.configDigest,
      offered: flow.configDigest,
      path: flow.path,
    });
  }
  // R5: the current step's grant decides, before any artifact is opened.
  requireGrant(grantFor(currentStepOf(flow, instance)), "artifact.read");
  const read = readStepArtifact({
    ...options,
    instance: instance.id,
    step: required(args.step, "step"),
  });
  return ok(ReadEnvelopeSchema, { artifact: artifactSummary(read.artifact), value: read.value });
}

/** Parse the arguments, dispatch one operation, and never throw (R2, R8). */
export function executePraxisTool(args: unknown, ctx: PiSessionContext): PiToolResult {
  try {
    const parsed = parseWith(PraxisToolArgsSchema, args, "CONFIG_INVALID", "praxis arguments");
    if (parsed.op === "start") return startOperation(parsed, ctx);
    if (parsed.op === "submit") return submitOperation(parsed, ctx);
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
