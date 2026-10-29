/**
 * Zod schemas for the slice's declared contracts (spec R1, R3, R11, R12).
 *
 * Types are inferred from the schemas so there is one authority per shape. Every
 * object is strict: an undeclared key is a typed refusal, never a silent pass.
 * Zod is the only third-party dependency the slice admits.
 */
import { z } from "zod";
import { fail, type Code } from "./errors.ts";
import { IssueConfigSchema } from "./issue.ts";

const KEBAB = /^[a-z][a-z0-9-]{0,63}$/;

/** Step identifiers used in the flow config, event payloads and artifacts. */
export const StepIdSchema = z.string().regex(KEBAB, "expected a lower-case kebab name");
export type StepId = z.infer<typeof StepIdSchema>;

/** Flow name, e.g. `architect`. */
export const FlowNameSchema = StepIdSchema;

/** The closed capability registry (spec R7). An unknown name cannot be declared. */
export const CapabilitySchema = z.enum(["artifact.read", "artifact.write", "emit"]);
export type Capability = z.infer<typeof CapabilitySchema>;

/** The only gate this slice implements: deterministic, no model in the loop. */
export const GateSchema = z.enum(["schema-valid-and-nonce"]);
export type Gate = z.infer<typeof GateSchema>;

/** Declared artifact/result schema name, e.g. `praxis.artifact.architecture/v1`. */
export const SchemaNameSchema = z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*\/v[1-9][0-9]*$/);
export type SchemaName = z.infer<typeof SchemaNameSchema>;

/** `sha256:` plus 64 lowercase hex characters. */
export const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
export type Digest = z.infer<typeof DigestSchema>;

/** Instance identifier; the store derives it from the creation payload. */
export const InstanceIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

/** Instance nonce carried into artifacts so a gate can prove provenance. */
export const NonceSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

export const ActorSchema = z.string().min(1).max(128);

/** ISO-8601 instant. An explicit offset is accepted; the caller owns the value. */
export const TimestampSchema = z.iso.datetime({ offset: true });

/** Event type, dotted lower-case, e.g. `instance.created`. */
export const EventTypeSchema = z.string().regex(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/);

/**
 * One step of the flow. `consumes` names the step whose accepted artifact this
 * step receives; the first step consumes nothing.
 */
export const StepConfigSchema = z.strictObject({
  id: StepIdSchema,
  capabilities: z.array(CapabilitySchema).max(8),
  produces: z.strictObject({ schema: SchemaNameSchema }),
  consumes: StepIdSchema.optional(),
  gate: GateSchema,
});
export type StepConfig = z.infer<typeof StepConfigSchema>;

/**
 * The flow is data (spec R1): exactly two steps, each producing one artifact.
 * `issue` is the optional issue-reporting declaration the tool's two `issue.*` ops
 * read; its shape is owned by `src/types/issue.ts`, never restated here.
 */
export const FlowConfigSchema = z
  .strictObject({
    schema: z.literal("praxis.config/v1"),
    flow: FlowNameSchema,
    steps: z.array(StepConfigSchema).length(2),
    result: SchemaNameSchema,
    issue: IssueConfigSchema.optional(),
  })
  .superRefine((config, ctx) => {
    const seen = new Set<string>();
    config.steps.forEach((step, index) => {
      if (seen.has(step.id)) {
        ctx.addIssue({ code: "custom", message: `duplicate step id: ${step.id}`, path: ["steps", index, "id"] });
      }
      seen.add(step.id);
    });
    const [first, second] = config.steps;
    if (first.consumes !== undefined) {
      ctx.addIssue({ code: "custom", message: "the first step cannot consume an artifact", path: ["steps", 0, "consumes"] });
    }
    if (second.consumes === undefined) {
      ctx.addIssue({ code: "custom", message: "the second step must consume an artifact", path: ["steps", 1, "consumes"] });
    } else if (second.consumes !== first.id) {
      ctx.addIssue({ code: "custom", message: `unknown artifact source: ${second.consumes}`, path: ["steps", 1, "consumes"] });
    }
  });
export type FlowConfig = z.infer<typeof FlowConfigSchema>;

/** Declared states. `validating` is model-only in this slice (spec, Model). */
export const InstanceStatusSchema = z.enum(["running", "blocked", "completed", "failed"]);
export type InstanceStatus = z.infer<typeof InstanceStatusSchema>;

/**
 * The mutable current state as a value. The plan's snake_case names are the store's
 * column names; `src/store/instance.ts` owns the one mapping between row and value.
 * A running instance always names a current step, so the value is never null.
 */
export const InstanceSchema = z.strictObject({
  id: InstanceIdSchema,
  flow: FlowNameSchema,
  actor: ActorSchema,
  configDigest: DigestSchema,
  status: InstanceStatusSchema,
  currentStep: StepIdSchema,
  revision: z.int().min(0),
  nonce: NonceSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Instance = z.infer<typeof InstanceSchema>;

/**
 * Artifact states: a recorded version starts `pending`; `accepted` is a separate,
 * digest-verified transition. A recorded version is never rewritten (spec R4).
 */
export const ArtifactStateSchema = z.enum(["pending", "accepted"]);
export type ArtifactState = z.infer<typeof ArtifactStateSchema>;

export const ArtifactSchema = z.strictObject({
  instance: InstanceIdSchema,
  step: StepIdSchema,
  version: z.int().min(1),
  path: z.string().min(1).max(4096),
  digest: DigestSchema,
  schema: SchemaNameSchema,
  state: ArtifactStateSchema,
  derivedFrom: DigestSchema.nullable(),
  at: TimestampSchema,
});
export type Artifact = z.infer<typeof ArtifactSchema>;

/** A bounded artifact reference: no bytes, no path, no transcript. */
export const ArtifactRefSchema = z.strictObject({
  step: StepIdSchema,
  version: z.int().min(1),
  digest: DigestSchema,
  schema: SchemaNameSchema,
});
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;

/** The parent-facing result: exactly these six keys (spec R11). */
export const ResultSchema = z.strictObject({
  instanceId: InstanceIdSchema,
  flow: FlowNameSchema,
  status: InstanceStatusSchema,
  artifacts: z.array(ArtifactRefSchema),
  summary: z.string().min(1).max(4096),
  nextAction: z.string().min(1).max(1024),
});
export type Result = z.infer<typeof ResultSchema>;

/** One appended event, as listed back from the store. */
export const EventSchema = z.strictObject({
  instance: InstanceIdSchema,
  seq: z.int().min(1),
  type: EventTypeSchema,
  payload: z.unknown(),
  at: TimestampSchema,
});
export type StoredEvent = z.infer<typeof EventSchema>;

/** Flatten zod issues into a detail a caller can print without a schema handbook. */
function issues(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message }));
}

/** Parse with one schema, or fail with the given typed code. */
export function parseWith<T>(schema: z.ZodType<T>, value: unknown, code: Code, what: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw fail(code, `${what} is invalid`, issues(parsed.error));
  return parsed.data;
}

/** Parse the flow config. An unknown step, capability or ref is CONFIG_INVALID. */
export function parseFlowConfig(value: unknown): FlowConfig {
  const parsed = FlowConfigSchema.safeParse(value);
  if (!parsed.success) throw fail("CONFIG_INVALID", "flow config is invalid", issues(parsed.error));
  return parsed.data;
}
