/**
 * The Pi tool surface contracts (R1, R2, R5-R8).
 *
 * One strict argument schema states what a `praxis` call may carry; the host
 * parameters are generated from it, so there is no second hand-written schema.
 * The envelopes bound what the parent receives: the six-key result plus a
 * derived step descriptor, a nonce on `start`, or one artifact summary on
 * `read`. Shapes with another owner are reused, never restated: `Result`,
 * `Capability`, `StepId`, `Digest` from `schema.ts`, the failure taxonomy
 * from `errors.ts`.
 */
import { z } from "zod";
import type { Code } from "./errors.ts";
import { ArtifactStateSchema, CapabilitySchema, DigestSchema, FlowNameSchema, InstanceIdSchema, NonceSchema, RequirementsSchema, ResultSchema, SchemaNameSchema, StepIdSchema } from "./schema.ts";

/** The three operations the one tool exposes (R2). */
export const PraxisToolOpSchema = z.enum(["start", "submit", "read"]);
export type PraxisToolOp = z.infer<typeof PraxisToolOpSchema>;

/**
 * One strict argument object (R2). The host checks shape and unknown keys; the
 * per-op requirement runs in the handler, because the generated JSON Schema
 * drops refinements (`required` is only `op`: research F3, review G2-F3). A
 * missing per-op field is CONFIG_INVALID at that parse, never a half-filled
 * engine call. There is no `actor` key: the actor comes from the session (R10).
 */
export const PraxisToolArgsSchema = z
  .strictObject({
    op: PraxisToolOpSchema,
    flow: FlowNameSchema.optional(),
    requestId: z.string().min(1).max(128).optional(),
    instance: InstanceIdSchema.optional(),
    artifact: z.record(z.string(), z.unknown()).optional(),
    step: StepIdSchema.optional(),
    /** Optional role -> actor map the creator pins at start; never the caller's own actor (R10). */
    roles: z.record(z.string(), z.string()).optional(),
  })
  .superRefine((args, ctx) => {
    const require = (field: "flow" | "requestId" | "instance" | "artifact" | "step"): void => {
      if (args[field] === undefined) {
        ctx.addIssue({ code: "custom", path: [field], message: `${args.op} requires ${field}` });
      }
    };
    if (args.op === "start") {
      require("flow");
      require("requestId");
    } else if (args.op === "submit") {
      require("instance");
      require("artifact");
    } else {
      require("instance");
      require("step");
    }
  });
export type PraxisToolArgs = z.infer<typeof PraxisToolArgsSchema>;

/**
 * The derived view of the current step (R6): its id, the capabilities the pinned
 * flow grants it, the operations that grant makes usable, the flow's ordered step ids
 * so an agent knows where it is, and the current task's brief so it knows what to
 * produce. Never stored; every field is derived fresh from the pinned flow and task.
 */
export const StepDescriptorSchema = z.strictObject({
  id: StepIdSchema,
  capabilities: z.array(CapabilitySchema),
  ops: z.array(z.enum(["submit", "read"])),
  steps: z.array(StepIdSchema),
  brief: z.strictObject({
    goal: z.string().min(1),
    produces: SchemaNameSchema,
    requires: RequirementsSchema.optional(),
    bindsSubject: z.boolean().optional(),
    /** The accepted predecessor artifacts this step consumes, with their digests. */
    consumes: z.array(z.strictObject({ step: StepIdSchema, schema: SchemaNameSchema, digest: DigestSchema })).optional(),
    /** The digest this step must carry as `derivedFrom` (a single data source only). */
    derivedFrom: DigestSchema.optional(),
    /** When the step binds a subject, the digest to carry as `subject`. */
    subject: DigestSchema.optional(),
  }),
});
export type StepDescriptor = z.infer<typeof StepDescriptorSchema>;

/** One recorded artifact as the parent sees it (R5, R7): no path, no bytes. */
export const ArtifactSummarySchema = z.strictObject({
  step: StepIdSchema,
  version: z.int().min(1),
  digest: DigestSchema,
  schema: SchemaNameSchema,
  state: ArtifactStateSchema,
});
export type ArtifactSummary = z.infer<typeof ArtifactSummarySchema>;

/** `start`: the six-key result, the descriptor and the instance nonce (R3). */
export const StartEnvelopeSchema = z.strictObject({
  result: ResultSchema,
  step: StepDescriptorSchema,
  nonce: NonceSchema,
});

/** `submit`: the result after exactly one `advance` (R4). */
export const StepEnvelopeSchema = z.strictObject({
  result: ResultSchema,
  step: StepDescriptorSchema,
});

/** `read`: the summary plus the one artifact body the caller asked for (R5). */
export const ReadEnvelopeSchema = z.strictObject({
  artifact: ArtifactSummarySchema,
  value: z.unknown(),
});

/** The successful envelopes, one per operation. Exactly one is returned. */
export type PraxisToolEnvelope =
  | z.infer<typeof StartEnvelopeSchema>
  | z.infer<typeof StepEnvelopeSchema>
  | z.infer<typeof ReadEnvelopeSchema>;

/**
 * The runtime mirror of the `Code` union in `errors.ts`. The annotation makes a
 * missing or an extra name a compile error, so this list cannot drift from the
 * taxonomy while staying the only runtime occurrence of a code.
 */
const CODES = [
  "CONFIG_INVALID",
  "FLOW_INVALID",
  "REQUEST_CONFLICT",
  "INSTANCE_NOT_FOUND",
  "INSTANCE_FORBIDDEN",
  "INSTANCE_STATE_INVALID",
  "REVISION_CONFLICT",
  "CANONICAL_INVALID",
  "ARTIFACT_INVALID",
  "ARTIFACT_UNAVAILABLE",
  "ARTIFACT_DIGEST_MISMATCH",
  "ARTIFACT_STATE_INVALID",
  "ARTIFACT_VERSION_CONFLICT",
  "NODE_INVALID",
  "TASK_NOT_FOUND",
  "TASK_NOT_PUBLISHED",
  "TASK_VERSION_CONFLICT",
  "PIN_MISSING",
  "PIN_CORRUPT",
  "SUBJECT_MISSING",
  "SUBJECT_STALE",
  "CAPABILITY_DENIED",
  "GATE_REJECTED",
  "QUALITY_REQUIRED",
  "QUALITY_BELOW_THRESHOLD",
  "RESULT_INVALID",
  "STORE_INVALID",
  "INTERNAL",
] as const satisfies readonly Code[];

const FailureCodeSchema: z.ZodEnum<{ [K in Code]: K }> = z.enum(CODES);

/** An operation failure (R8): typed code, message, optional detail. */
export const FailureDetailsSchema = z.strictObject({
  code: FailureCodeSchema,
  message: z.string().min(1),
  detail: z.unknown().optional(),
});
export type FailureDetails = z.infer<typeof FailureDetailsSchema>;
