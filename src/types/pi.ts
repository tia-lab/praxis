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
import { ActorSchema, ArtifactStateSchema, CapabilitySchema, DigestSchema, FlowNameSchema, InstanceIdSchema, NonceSchema, PROBES_PER_DIMENSION, RequirementsSchema, ResultSchema, SchemaNameSchema, StepIdSchema, TaskRefSchema, TimestampSchema } from "./schema.ts";
import { LearningNoteSubjectiveSchema, RecallSetSchema } from "./learning.ts";

/**
 * The operations the one tool exposes (R2). `note` is the execution-learning closing reflection
 * (F2/O4): the agent's subjective lesson for a step that already reached its terminal outcome.
 */
export const PraxisToolOpSchema = z.enum(["start", "submit", "read", "note", "check", "recall"]);
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
    /**
     * The order this start is carrying: the work the agent was told to do. `op=start` requires it,
     * because it is the thing the alignment gate judges against the flow-pinned task. The order is
     * never stored; only its digest appears in a refusal or in the unchecked flag.
     */
    order: z.string().min(1).max(4000).optional(),
    instance: InstanceIdSchema.optional(),
    artifact: z.record(z.string(), z.unknown()).optional(),
    step: StepIdSchema.optional(),
    /** Optional role -> actor map the creator pins at start; never the caller's own actor (R10). */
    roles: z.record(z.string(), z.string()).optional(),
    /** The subjective half of a learning note (`op=note`); the objective half is derived. */
    subjective: LearningNoteSubjectiveSchema.optional(),
    /**
     * `op=recall`: what the agent is stuck on, in its own words. Searched against THIS project's
     * store only; nothing is written.
     */
    need: z.string().min(1).max(500).optional(),
    /** `op=recall`: the rubric dimensions to cover; defaults to the current step's. */
    tags: z.array(z.string().min(1).max(64)).max(8).optional(),
    /** `op=recall`: how many cases to return (1..10, default 5). */
    max: z.int().min(1).max(10).optional(),
  })
  .superRefine((args, ctx) => {
    const require = (field: "flow" | "requestId" | "instance" | "artifact" | "step" | "order" | "need"): void => {
      if (args[field] === undefined) {
        ctx.addIssue({ code: "custom", path: [field], message: `${args.op} requires ${field}` });
      }
    };
    if (args.op === "start") {
      require("flow");
      require("requestId");
      require("order");
    } else if (args.op === "submit") {
      require("instance");
      require("artifact");
    } else if (args.op === "note") {
      require("instance");
    } else if (args.op === "check") {
      require("instance");
      require("artifact");
    } else if (args.op === "recall") {
      require("instance");
      require("need");
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
  ops: z.array(z.enum(["submit", "read", "note", "check"])),
  steps: z.array(StepIdSchema),
  /**
   * Present ONLY when the alignment judge could not answer: the start proceeded unchecked, and both
   * the agent and the parent are told so (the parent through the result's `summary`). A start that
   * was judged aligned carries no field at all, so the unchanged path stays unchanged.
   */
  alignment: z
    .strictObject({
      /** `unchecked`: the judge could not answer. `soft`: aligned, but close to the boundary (R37). */
      decision: z.enum(["unchecked", "soft"]),
      reason: z.string().min(1).max(400),
      orderDigest: DigestSchema,
      /** soft only: the two probabilities the flag names. */
      aligned: z.number().min(0).max(1).optional(),
      misaligned: z.number().min(0).max(1).optional(),
    })
    .optional(),
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
    /**
     * The DOMAIN profiles this step runs under (domain injection), in node order: the node's own
     * `domains`, or the flow-level default, composed and pinned at start. This is the ONE dynamic
     * conduct layer - the agent's conduct and role are fixed system identity and are never composed
     * here. Absent when the node declares none, so a domain-free envelope is byte-identical.
     */
    domain: z
      .array(
        z.strictObject({
          /** The bare domain id, e.g. `code`. */
          id: z.string().min(1).max(64),
          version: z.int().min(1),
          /** The profile file's own digest, so the brief names the bytes it came from. */
          digest: DigestSchema,
          overview: z.string().min(1).max(280),
          invariants: z.array(z.string().min(1).max(280)).max(12),
          prefer: z.array(z.string().min(1).max(280)).max(12),
          avoid: z.array(z.string().min(1).max(280)).max(12),
        }),
      )
      .max(6)
      .optional(),
    /**
     * The rules this TASK follows (task-rules), in the order the task declares them and, inside one set,
     * in the set document's own order. Absent when the task references none: the envelope is then
     * byte-identical to the one before this field existed. Guidance for the agent - never a gate input.
     */
    rules: z
      .array(
        z.strictObject({
          set: z.string().min(1).max(128),
          version: z.int().min(1),
          /** The set's own digest, so the brief names the bytes it came from. */
          digest: DigestSchema,
          id: z.string().min(1).max(64),
          statement: z.string().min(1).max(280),
        }),
      )
      .max(16)
      .optional(),
    /**
     * The quality floor this step is judged against, when the task (or the flow it inherits
     * from) declares one: the agent sees the standard before it submits, not only on refusal.
     * Bounded by the task document itself (at most 8 dimensions of at most 500 characters).
     */
    quality: z
      .strictObject({
        // The rubric as the BRIEF shows it: identity, statement, floor, and what decides each
        // dimension. Disclosure only — never a score, never a bar the agent could argue with.
        dimensions: z
          .array(
            z.strictObject({
              id: z.string().min(1).max(64),
              statement: z.string().min(1).max(500),
              floor: z.number().min(0).max(1).optional(),
              /** The rank this dimension gates at (A2), when it declares one; default 25. */
              quantileGate: z.int().min(1).max(99).optional(),
              /**
               * The criteria that decide this dimension, when it is composed (compose slice R13):
               * the authored text the judge asks, with its type and its options or levels.
               */
              criteria: z
                .array(
                  z.strictObject({
                    id: z.string().min(1).max(64),
                    type: z.enum(["choice", "noul", "score"]),
                    instructions: z.string().min(1).max(500),
                    /** choice: the authored options, keyed by option id. */
                    options: z.record(z.string().min(1).max(64), z.string().min(1).max(200)).optional(),
                    /** choice: the option that counts as satisfied. */
                    clean: z.string().min(1).max(64).optional(),
                    /** score: the authored levels, worst first. */
                    levels: z.array(z.string().min(1).max(200)).optional(),
                    /** The sections this criterion judges; absent means the whole artifact (T1, R5). */
                    sections: z.array(z.string().min(1).max(64)).min(1).max(6).optional(),
                    /**
                     * Present when this criterion judges a NAMED RULE (task-rules): the rule text is
                     * already inside `instructions`, and this is the reference it came from.
                     */
                    rule: z
                      .strictObject({ set: z.string().min(1).max(128), id: z.string().min(1).max(64) })
                      .optional(),
                  }),
                )
                .max(PROBES_PER_DIMENSION)
                .optional(),
            }),
          )
          .min(1)
          .max(8),
        /**
         * The threshold IN FORCE: the task's authored min_floor, or the higher bar the engine has
         * ratcheted to from stable history (O2). The agent never sets it and cannot see the code.
         */
        threshold: z.number().min(0).max(1),
        policy: z.enum(["required", "advisory"]),
        /** How the per-dimension judgments become one score: the MINIMUM (MIN-011). */
        aggregation: z.literal("min"),
        /**
         * How a composed dimension's criteria become its score, present when any dimension declares
         * criteria: the MINIMUM, so no strong criterion hides a failed one (R13, D4).
         */
        criteriaAggregation: z.literal("min").optional(),
        /**
         * The gate ACTUALLY applied, beside the earned bar above: the Pareto cap,
         * `min(earnedBar, paretoThreshold)`, per scope. Display only — the decision is
         * the gate, which reads the same numbers. Below the Pareto point these values equal
         * the earned bar / authored floor, so the field only says something new above it.
         */
        gate: z
          .strictObject({
            /** `min(threshold, paretoThreshold)`: what the MEAN must reach to pass. */
            threshold: z.number().min(0).max(1),
            /** Per dimension id: `min(earnedBar_d, paretoThreshold)`. */
            dimensions: z.record(z.string().min(1).max(64), z.number().min(0).max(1)),
          })
          .optional(),
        /**
         * The RECORDED judgment this step already carries, for the note-owed step: its score, the
         * flagged set and each dimension's structured diagnosis and rendered rationale
         * (verdict-rationale D12b). Read from the log, never recomputed; absent until the step has a
         * recorded verdict.
         */
        judgment: z
          .strictObject({
            score: z.number().min(0).max(1),
            mean: z.number().min(0).max(1).optional(),
            flagged: z.array(z.string().min(1).max(64)).max(8),
            dimensions: z.array(
              z.strictObject({
                id: z.string().min(1).max(64),
                score: z.number().min(0).max(1),
                /** The criterion that produced the composed minimum, when the dimension was composed (R14). */
                bound: z.string().min(1).max(64).optional(),
                /** The statement witness recorded beside the composed score (R14). Evidence, never a gate. */
                statementScore: z.number().min(0).max(1).optional(),
                /** The witness departed from the composed score by at least DIVERGENCE_MIN. */
                divergence: z.boolean().optional(),
                rationale: z.string().min(1).max(240).optional(),
                /** The dimension's own Q50 of the carried population (A3): the median a pass must reach. */
                q50: z.number().min(0).max(1).optional(),
                /** How far below its Q50 a FLAGGED dimension sat (Q50 minus score). */
                gap: z.number().min(0).max(1).optional(),
                /** Criterion ids the judge answered near its own boundary (S2). Disclosure, never a gate. */
                torn: z.array(z.string().min(1).max(64)).max(48).optional(),
                /** The deciding criterion was torn, so the verdict is provisional (S6, R33-R35). */
                provisional: z.boolean().optional(),
                provisionalOn: z
                  .array(
                    z.strictObject({
                      dimension: z.string().min(1).max(64),
                      criterion: z.string().min(1).max(64),
                      signal: z.enum(["mass", "confidence", "noul-band"]),
                    }),
                  )
                  .max(48)
                  .optional(),
                diagnosis: z
                  .array(
                    z.strictObject({
                      probe: z.string().min(1).max(128),
                      answer: z.union([z.string().min(1).max(80), z.number().min(0).max(10)]),
                      /**
                       * The sections this criterion was asked to judge, exactly as the scorer records them
                       * (src/quality/jev-scorer.ts): a targeted criterion keeps its target on the answer.
                       * Absent on an untargeted criterion. Mirrored here because the descriptor is a
                       * strictObject - an unmirrored key makes the whole descriptor invalid.
                       */
                      sections: z.array(z.string().min(1).max(64)).min(1).max(6).optional(),
                      confidence: z.number().min(0).max(1).optional(),
                      pClean: z.number().min(0).max(1).optional(),
                      pTop: z.number().min(0).max(1).optional(),
                      spread: z.number().min(0).max(1).optional(),
                    }),
                  )
                  .max(48)
                  .optional(),
              }),
            ),
          })
          .optional(),
        /** The judging stance: what the judge does, in the agent's own terms (F1). */
        judging: z.string().min(1).max(400),
        /** The lessons selected for this step, ranked from recorded notes (F3, F7). */
        recall: RecallSetSchema.optional(),
      })
      .optional(),
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

/** `note`: the six-key result, the descriptor, and what the reflection did (real or stub). */
export const NoteEnvelopeSchema = z.strictObject({
  result: ResultSchema,
  step: StepDescriptorSchema,
  note: z.strictObject({
    step: StepIdSchema,
    noteVersion: z.int().min(1),
    /** True when the engine wrote the "no lesson provided" stub after the bounded attempts. */
    stub: z.boolean(),
    /** What the adequacy gate still found missing, when the stub was forced. */
    missing: z.array(z.string().min(1)).optional(),
  }),
});

/**
 * `check`: the dry run (stateless). `ok` says whether the artifact's sections satisfy the current
 * step's declared `requires`, and `missing` carries the same path-addressable gaps a refusal would,
 * so an agent can fix structure before spending a submit. Nothing is recorded: no event, no attempt,
 * no nonce or schema check here — only the deterministic section requirements.
 */
export const CheckEnvelopeSchema = z.strictObject({
  ok: z.boolean(),
  missing: z.array(z.string().min(1)),
  step: StepIdSchema,
});
export type CheckEnvelope = z.infer<typeof CheckEnvelopeSchema>;

/**
 * One solved case as `op=recall` returns it: the ranking score, the signal breakdown that produced it,
 * the provenance read from the record, and the lesson. No bytes, no transcript, no event log.
 */
export const RecallCaseSchema = z.strictObject({
  score: z.number().min(0).max(1),
  relevance: z.strictObject({
    need: z.number().min(0).max(1),
    outcome: z.number().min(0).max(1),
    corroboration: z.number().min(0).max(1),
    recency: z.number().min(0).max(1),
    margin: z.number().min(0).max(1),
  }),
  provenance: z.strictObject({
    instance: InstanceIdSchema,
    task: TaskRefSchema,
    taskVersion: z.int().min(1),
    step: StepIdSchema,
    version: z.int().min(1),
    digest: DigestSchema,
    writtenBy: ActorSchema,
    at: TimestampSchema,
  }),
  outcome: z.literal("pass"),
  /** True only when this case's text passed the instruction screen (S4, R26). */
  screened: z.boolean(),
  /** The three noul probabilities that ordered this case, keyed by criterion id (S5, R31). */
  nouls: z.record(z.string().min(1).max(32), z.number().min(0).max(1)).optional(),
  /** The weighted sum of those three, with the frozen weights (R30). */
  total: z.number().min(0).max(1).optional(),
  /** The code-owned line a withheld case carries instead of its text. */
  withheld: z.string().min(1).max(200).optional(),
  /**
   * The recorded rationale of THIS exemplar's verdict for the dimension the query is about — by
   * reference from the `quality.verdict` event, never a third stored copy (verdict-rationale D12c).
   * Absent when that dimension carries no rationale.
   */
  rationale: z.string().min(1).max(240).optional(),
  lesson: z.strictObject({
    whatWrong: z.string().max(400),
    whatRight: z.string().max(400),
    whatBetter: z.string().max(400),
    tags: z.array(z.strictObject({ dimension: z.string().min(1).max(64), lesson: z.string().min(1).max(240) })).max(8),
  }),
});
export type RecallCase = z.infer<typeof RecallCaseSchema>;

/** `recall`: the need echoed back, how many cases survived the bounds, and the ranked cases. */
export const RecallEnvelopeSchema = z.strictObject({
  need: z.string().min(1).max(500),
  count: z.int().min(0).max(10),
  truncated: z.boolean(),
  /** Dimensions excluded because a case's identity changed since it was judged (S4, R28). */
  excluded: z.array(z.string().min(1).max(64)).max(8).optional(),
  cases: z.array(RecallCaseSchema).max(10),
});
export type RecallEnvelope = z.infer<typeof RecallEnvelopeSchema>;

/** The successful envelopes, one per operation. Exactly one is returned. */
export type PraxisToolEnvelope =
  | z.infer<typeof StartEnvelopeSchema>
  | z.infer<typeof StepEnvelopeSchema>
  | z.infer<typeof ReadEnvelopeSchema>
  | z.infer<typeof NoteEnvelopeSchema>
  | z.infer<typeof CheckEnvelopeSchema>
  | z.infer<typeof RecallEnvelopeSchema>;

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
  "RULE_NOT_FOUND",
  "PROFILE_NOT_FOUND",
  "PROFILE_INVALID",
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
  "QUALITY_BLOCKED",
  "ALIGNMENT_REJECTED",
  "HOOK_VETOED",
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
