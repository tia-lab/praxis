/**
 * Zod schemas for the slice's declared contracts (spec R1, R3, R11, R12).
 *
 * Types are inferred from the schemas so there is one authority per shape. Every
 * object is strict: an undeclared key is a typed refusal, never a silent pass.
 * Zod is the only third-party dependency the slice admits.
 */
import { z } from "zod";
import { KEBAB } from "./paths.ts";
import { TaskRulesSchema } from "./rules.ts";

// The path grammar moved to `paths.ts` (the file cap); re-exported so no importer moves.
export { KEBAB, pathUnder } from "./paths.ts";

// The flow document moved to flow.ts (the file cap); re-exported so no importer moves.
import { FlowNameSchema, SchemaNameSchema, StepIdSchema } from "./flow.ts";
export * from "./flow.ts";

/** The closed capability registry (spec R7). An unknown name cannot be declared. */
export const CapabilitySchema = z.enum(["artifact.read", "artifact.write", "emit", "evaluate"]);
export type Capability = z.infer<typeof CapabilitySchema>;

/** The only gate this slice implements: deterministic, no model in the loop. */
export const GateSchema = z.enum(["schema-valid-and-nonce", "section-requirements"]);
export type Gate = z.infer<typeof GateSchema>;

/** `sha256:` plus 64 lowercase hex characters. */
export const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
export type Digest = z.infer<typeof DigestSchema>;

/** Instance identifier; the store derives it from the creation payload. */
export const InstanceIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

/** Instance nonce carried into artifacts so a gate can prove provenance. */
export const NonceSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

export const ActorSchema = z.string().min(1).max(128);

/** A flow role an actor may be assigned to (team relay): a lower-case kebab name. */
export const RoleNameSchema = z.string().regex(KEBAB, "expected a lower-case kebab role name");
export type RoleName = z.infer<typeof RoleNameSchema>;

/** The pinned role -> authorized-actor map an instance runs under (team relay). */
export const RoleAssignmentSchema = z.record(RoleNameSchema, ActorSchema);
export type RoleAssignment = z.infer<typeof RoleAssignmentSchema>;

/** ISO-8601 instant. An explicit offset is accepted; the caller owns the value. */
export const TimestampSchema = z.iso.datetime({ offset: true });

/** Event type, dotted lower-case, e.g. `instance.created`. */
export const EventTypeSchema = z.string().regex(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/);

/**
 * One step of the flow. `consumes` names the step whose accepted artifact this
 * step receives; the first step consumes nothing.
 */
/** The value types a field may be constrained to; absent means presence only. */
export const FieldTypeSchema = z.enum(["string", "number", "boolean", "object", "array"]);
export type FieldType = z.infer<typeof FieldTypeSchema>;

/**
 * One field of a section's contract. A bare string names a field that must be present and
 * non-empty, the behaviour the slice shipped with. The object form adds, all optional and all
 * deterministic: a `type`, a human `note` carried into the brief, string/array `minLength`/
 * `maxLength`, a `pattern` the string must match, an `enum` of allowed values, and
 * `references` ("section.field") naming the set this value must be drawn from.
 */
export const FieldSpecSchema = z.union([
  z.string().min(1).max(64),
  z.strictObject({
    field: z.string().min(1).max(64),
    type: FieldTypeSchema.optional(),
    note: z.string().min(1).max(500).optional(),
    minLength: z.number().int().min(0).max(100000).optional(),
    maxLength: z.number().int().min(1).max(100000).optional(),
    pattern: z.string().min(1).max(500).optional(),
    enum: z.array(z.union([z.string(), z.number(), z.boolean()])).min(1).max(64).optional(),
    references: z.string().regex(/^[a-z][a-z0-9-]{0,63}\.[a-z][a-z0-9-]{0,63}$/, "expected section.field").optional(),
  }),
]);
export type FieldSpec = z.infer<typeof FieldSpecSchema>;

/** What a stage's document section must contain to pass (spec: stage requirement). */
export const RequirementSchema = z.strictObject({
  section: z.string().min(1).max(64),
  /** Human guidance for this section, carried into the brief; never machine-graded. */
  note: z.string().min(1).max(500).optional(),
  /**
   * What this section is FOR, in the judge's terms (T1, R2). `note` is the agent-facing half and
   * stays ungraded; this is the half the scorer is given when a criterion targets the section.
   * Two fields, two audiences: never merged.
   */
  goal: z.string().min(1).max(500).optional(),
  /** Why this section is required at all, carried to the judge beside its goal. */
  rationale: z.string().min(1).max(500).optional(),
  /** Reject any field this clause does not name (an object section or each array entry). */
  strict: z.boolean().optional(),
  minItems: z.number().int().min(0).max(1000).optional(),
  required: z.array(FieldSpecSchema).max(32).optional(),
  each: z.array(FieldSpecSchema).max(32).optional(),
  /** Exact values a section's fields must carry, e.g. verdict: "PASS". */
  equals: z
    .record(z.string().min(1).max(64), z.union([z.string(), z.number(), z.boolean()]))
    .optional(),
});
export type Requirement = z.infer<typeof RequirementSchema>;

/**
 * A stage may demand several sections at once (one document, many clauses):
 * `research.md` alone has eight. A bare clause stays valid.
 */
export const RequirementsSchema = z.union([RequirementSchema, z.array(RequirementSchema).min(1).max(16)]);
export type Requirements = z.infer<typeof RequirementsSchema>;

/** A task's declared state; only `published` may be pinned (spec R3). */
export const TaskStateSchema = z.enum(["draft", "published"]);
export type TaskState = z.infer<typeof TaskStateSchema>;

/**
 * One task document, a strict `praxis.task/v1` unit (spec R1). The task owns the
 * work; the flow owns the wiring, so there is no `consumes` and no `onRefuse`
 * here — edges carry both facts.
 */
/** The quality rubric: probes, dimensions and the floor, defined once in `./quality.ts` (re-exported). */
import { PROBES_TOTAL, QualitySchema, SectionNameSchema } from "./quality.ts";
export {
  PROBES_PER_DIMENSION,
  PROBES_TOTAL,
  ProbeSchema,
  SectionNameSchema,
  type SectionName,
  QualityDimensionSchema,
  QualitySchema,
  type Probe,
  type Quality,
} from "./quality.ts";

/** A recorded typed judgment over one artifact: the pinned ruler and the score (quality eval). */
export const QualityVerdictSchema = z.strictObject({
  decision: z.enum(["pass", "below", "unavailable"]),
  /** MIN over the dimensions: the reported headline score, unchanged by the compound gate. */
  score: z.number().min(0).max(1),
  dimensions: z.array(
    z.strictObject({
      id: z.string().min(1).max(64),
      score: z.number().min(0).max(1),
      /** The dimension's identity key (id + criteria, or id + statement) in force when it was judged. */
      key: z.string().min(1).max(64).optional(),
      /**
       * The criterion that produced the composed minimum, ties by declared order (compose slice R8).
       * Absent on a dimension with no criteria, which is judged by its statement alone.
       */
      bound: z.string().min(1).max(64).optional(),
      /**
       * The statement witness's probability, recorded beside the composed score (R7). Evidence: it
       * never enters the score, the mean, the decision or the bar.
       */
      statementScore: z.number().min(0).max(1).optional(),
      /** The witness departed from the composed score by at least DIVERGENCE_MIN (0.20). */
      divergence: z.boolean().optional(),
      /**
       * The jev battery's structured answers for this dimension (verdict-rationale D6): the evidence a
       * reader reasons from. Additive and optional — a verdict recorded before the battery has none.
       */
      diagnosis: z
        .array(
          z.strictObject({
            probe: z.string().min(1).max(128),
            answer: z.union([z.string().min(1).max(80), z.number().min(0).max(10)]),
            /** The sections this criterion was asked to judge; absent means the whole artifact (T3, R17). */
            sections: z.array(SectionNameSchema).min(1).max(6).optional(),
            /** The judge's own uncertainty (S2). Absent when the client reported none — never 0-filled. */
            confidence: z.number().min(0).max(1).optional(),
            pClean: z.number().min(0).max(1).optional(),
            pTop: z.number().min(0).max(1).optional(),
            spread: z.number().min(0).max(1).optional(),
          }),
        )
        .max(PROBES_TOTAL)
        .optional(),
      /** The rendered, bounded line the agent was shown for this dimension (D7). Evidence, never a gate input. */
      rationale: z.string().min(1).max(240).optional(),
      /** Criterion ids this dimension's judge answered near its own boundary (S2, R17). */
      torn: z.array(z.string().min(1).max(64)).max(PROBES_TOTAL).optional(),
    }),
  ),
  /** MEAN over the dimensions: the value the global bar gates on (stamped by the engine). */
  mean: z.number().min(0).max(1).optional(),
  /**
   * Dimensions that PASSED but sat below their own Q50 of the carried population (A3): where the
   * next lesson comes from. Derived on demand, no gate effect, nothing stored.
   */
  flagged: z.array(z.string().min(1).max(64)).max(8).optional(),
  /**
   * Every criterion the judge answered near its own boundary, keyed <dimension>.<criterion> (S2, R17).
   * Recorded evidence: it never enters the score, the mean, the decision or a bar (R18, D10).
   */
  torn: z.array(z.string().min(1).max(129)).max(PROBES_TOTAL).optional(),
  /**
   * True when the criterion that DECIDED this verdict was itself torn (S6, R33): the judgment is
   * honest about being close, and still decides exactly as it would have (R35).
   */
  provisional: z.boolean().optional(),
  /** True when this artifact was judged against an ORDER, not only the task goal (T3, R17). */
  anchored: z.boolean().optional(),
  /**
   * The digest of the order it was judged against (T3, R18), the same value recorded on
   * `instance.created`: two orders are two assignments, and the score cache must not fold them.
   */
  anchorDigest: DigestSchema.optional(),
  /** Which deciding criteria were torn, and which signal made them torn (S6, R34). */
  provisionalOn: z
    .array(
      z.strictObject({
        dimension: z.string().min(1).max(64),
        criterion: z.string().min(1).max(64),
        /** mass = a choice/score distribution, confidence = the answer's own confidence, noul-band = a single probability near 0.5. */
        signal: z.enum(["mass", "confidence", "noul-band"]),
      }),
    )
    .max(PROBES_TOTAL)
    .optional(),
  rationale: z.string().max(2000),
  rubricDigest: DigestSchema,
  scorer: z.string().min(1).max(200),
  source: z.enum(["jev", "unavailable", "error"]),
});
export type QualityVerdict = z.infer<typeof QualityVerdictSchema>;

export const TaskConfigSchema = z.strictObject({
  id: StepIdSchema,
  version: z.int().min(1),
  state: TaskStateSchema,
  /** What the agent must achieve in this stage. Required (A3). */
  goal: z.string().min(1).max(1000),
  /** Why this stage exists: the judge's second context line, after the order (T1, R1). Optional. */
  rationale: z.string().min(1).max(1000).optional(),
  /** What this stage is NOT about: the boundary that makes padding measurable (T1, R1). Optional. */
  scope: z.string().min(1).max(1000).optional(),
  capabilities: z.array(CapabilitySchema).max(8),
  produces: z.strictObject({ schema: SchemaNameSchema }),
  gate: GateSchema,
  /** What the document must contain before this stage may pass: one clause or many. */
  requires: RequirementsSchema.optional(),
  /** The flow role authorized to submit this step; absent means the instance creator. */
  role: RoleNameSchema.optional(),
  /** An optional quality floor: a typed judgment over the produced artifact (quality eval). */
  quality: QualitySchema.optional(),
  /**
   * Reusable guidance this task follows: file refs under `rules/`, optionally narrowed to named ids.
   * Absent means none, and a task with none behaves exactly as it did before this field existed.
   */
  rules: TaskRulesSchema.optional(),
  /** A review must carry the digest of the version it judged (spec R6). */
  bindsSubject: z.boolean().optional(),
}).superRefine((task, ctx) => {
  // A criterion may only target a section the task DECLARES (T1, R4): otherwise it would judge a
  // section that does not exist and silently score nothing. A task with no targeting adds no issue,
  // so every document that does not use the feature parses exactly as before.
  const clauses = task.requires === undefined ? [] : Array.isArray(task.requires) ? task.requires : [task.requires];
  const declared = new Set(clauses.map((clause) => clause.section));
  for (const dimension of task.quality?.dimensions ?? []) {
    for (const probe of dimension.probes ?? []) {
      for (const section of probe.sections ?? []) {
        if (declared.has(section)) continue;
        ctx.addIssue({
          code: "custom",
          path: ["quality", "dimensions", dimension.id, "probes", probe.id, "sections"],
          message: "section " + JSON.stringify(section) + " is not declared in requires",
        });
      }
    }
  }
});
export type TaskConfig = z.infer<typeof TaskConfigSchema>;

/**
 * Declared states (spec R8). `failed` has two writers: an unreadable pin (terminal corruption)
 * and the quality escalation, which additionally records a failedReason, an `instance.failed`
 * event and a needs-guidance signal. Nothing is silently resumed from a failed instance.
 */
export const InstanceStatusSchema = z.enum(["running", "completed", "failed"]);
export type InstanceStatus = z.infer<typeof InstanceStatusSchema>;

/**
 * The mutable current state as a value. The plan's snake_case names are the store's
 * column names; `src/store/instance.ts` owns the one mapping between row and value.
 * A running instance always names a current step, so the value is never null. The flow
 * digest lives in the instance's `definition` row, not here (spec R5).
 */
export const InstanceSchema = z.strictObject({
  id: InstanceIdSchema,
  flow: FlowNameSchema,
  actor: ActorSchema,
  status: InstanceStatusSchema,
  currentStep: StepIdSchema,
  /**
   * Why the instance failed, derived on read from its own `instance.failed` event. Never a
   * store column: the event log is the one owner of that fact.
   */
  failedReason: z.string().min(1).max(1000).optional(),
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
