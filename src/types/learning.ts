/**
 * Execution-learning shapes (task-level loop, O4/O6): the note, the bar signals and the recall set.
 * They live in their own owner module for the same reason `issue.ts` and `project.ts` do — the
 * flow/task contract in `schema.ts` is not quietly widened, and that file stays inside its size cap.
 * Every one of these is an append-only event payload; the note's OBJECTIVE half is deliberately
 * absent from the stored form because it is derived from the events that already own it.
 */
import { z } from "zod";
import {
  ActorSchema,
  DigestSchema,
  InstanceIdSchema,
  StepIdSchema,
  TaskRefSchema,
  TimestampSchema,
} from "./schema.ts";



/** One lesson keyed by a rubric dimension id, so weakness and corroboration stay lookups (O5). */
export const LearningTagSchema = z.strictObject({
  dimension: z.string().min(1).max(64),
  lesson: z.string().min(1).max(500),
});
export type LearningTag = z.infer<typeof LearningTagSchema>;

/** The agent's half of a note: the only text an agent authors, advisory and provenance-stamped. */
export const LearningNoteSubjectiveSchema = z.strictObject({
  whatWrong: z.string().min(1).max(1000),
  whatRight: z.string().min(1).max(1000),
  whatBetter: z.string().min(1).max(1000),
  tags: z.array(LearningTagSchema).min(1).max(8),
});
export type LearningNoteSubjective = z.infer<typeof LearningNoteSubjectiveSchema>;

/** Engine-stamped provenance: the session binding's actor, never a field a caller supplies. */
export const ProvenanceSchema = z.strictObject({
  agent: ActorSchema,
  model: z.string().min(1).max(200).optional(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

/**
 * The STORED learning note (O4): one immutable note per (instance, step) terminal outcome.
 * `subjective` is null exactly when the engine wrote a `stub` after the bounded note attempts were
 * spent — the omission is recorded, never hidden and never a hang.
 */
export const LearningNoteSchema = z.strictObject({
  task: TaskRefSchema,
  taskVersion: z.int().min(1),
  instance: InstanceIdSchema,
  step: StepIdSchema,
  noteVersion: z.int().min(1),
  subjective: LearningNoteSubjectiveSchema.nullable(),
  stub: z.boolean(),
  provenance: ProvenanceSchema,
});
export type LearningNote = z.infer<typeof LearningNoteSchema>;

/**
 * The window inputs around an adaptive-bar raise, recorded so the evidence is reproducible. Since the
 * EMA ratchet these are disclosure on every scope (the quartile and the stdev no longer decide a raise).
 */
export const BarWindowSchema = z.strictObject({
  passes: z.array(z.number().min(0).max(1)).min(1).max(16),
  lowerQuartile: z.number().min(0).max(1),
  margin: z.number().min(-1).max(1),
  stdev: z.number().min(0).max(1),
  meanAttempts: z.number().min(0).max(50),
});
export type BarWindow = z.infer<typeof BarWindowSchema>;

/**
 * One criterion's agreement across the repeat judgments of a rubric sample (S3, R21): a `choice`
 * agrees by how often the same key was picked, a `noul`/`score` by the RANGE of its values, because
 * neither has a distribution to spread.
 */
export const SampleAgreementSchema = z.strictObject({
  dimension: z.string().min(1).max(64),
  criterion: z.string().min(1).max(64),
  type: z.enum(["choice", "noul", "score"]),
  /** Agreed when the modal answer recurs enough (choice) or the range is tight enough (noul/score). */
  stable: z.boolean(),
  /** choice: the share of repeats that picked the modal key (1 = unanimous). */
  agreement: z.number().min(0).max(1).optional(),
  /** noul/score: max - min across the repeats. */
  range: z.number().min(0).max(1).optional(),
  /** The answers themselves, in repeat order: the evidence agreed about, not a summary of it. */
  answers: z.array(z.union([z.string().min(1).max(80), z.number().min(0).max(10)])).min(1).max(9),
});
export type SampleAgreement = z.infer<typeof SampleAgreementSchema>;

/**
 * One raise of a task's effective floor, with the formula id and the evidence that produced it (O2,
 * audit). Since the EMA ratchet the decision input is `ema`; `window` is disclosure.
 */
export const BarRaisedSchema = z.strictObject({
  task: TaskRefSchema,
  taskVersion: z.int().min(1),
  /**
   * What this raise governs: `global` (the MEAN bar) or a dimension id. Absent means `global`,
   * which is how a scope-less legacy raise is read.
   */
  scope: z.string().min(1).max(64).optional(),
  /**
   * The identity key the raise belongs to: a dimension's (id + statement) digest, or the rubric's
   * composition digest for the global scope. A dimension whose identity changes stops matching, so
   * it resets to its floor; an unchanged one inherits. Absent on legacy raises.
   */
  key: z.string().min(1).max(64).optional(),
  from: z.number().min(0).max(1),
  to: z.number().min(0).max(1),
  /**
   * The evidence window that decided the raise. OPTIONAL because the quantile ratchet records a
   * percentile and an `n` instead; a record written by either path parses under both (spec 3.7).
   */
  window: BarWindowSchema.optional(),
  /** The percentile the raise was computed at (quantile bars, A2). Absent on an EMA-era record. */
  percentile: z.int().min(1).max(99).optional(),
  /** How many observations the raise was computed from. Absent on an EMA-era record. */
  n: z.int().min(1).optional(),
  /**
   * The exponential moving average that decided this raise: the smoothed level of the scope's genuine
   * passes (see the EMA helper the old ratchet used). Optional because records written before it
   * ratchet carry no `ema` and must still parse and fold.
   */
  ema: z
    .strictObject({
      /** The EMA period count the recurrence used (9). */
      periods: z.int().min(1).max(64),
      /** `2 / (periods + 1)`. */
      alpha: z.number().min(0).max(1),
      /** The EMA at the moment of the raise. */
      value: z.number().min(0).max(1),
      /** How many genuine passes of this scope the EMA was computed from. */
      samples: z.int().min(1),
    })
    .optional(),
  formulaId: z.string().min(1).max(64),
  /**
   * The rubric sample that vouched for this raise (S3, R23): how many repeat judgments it took, the
   * per-criterion agreement, and the artifact they were taken over. Additive-optional, because a raise
   * recorded before the sample existed must still parse and fold.
   */
  stability: z
    .strictObject({
      repeats: z.int().min(2).max(9),
      stable: z.boolean(),
      artifactDigest: DigestSchema,
      criteria: z.array(SampleAgreementSchema).min(1).max(48),
    })
    .optional(),
  at: TimestampSchema,
}).refine((raise) => raise.to >= raise.from, {
    // Monotonicity is a DECISION, so the record refuses a decrease: no path may lower a bar, and a
    // hand-written or buggy decrease fails to parse instead of silently winning (spec 3.7, F6).
    message: "a raise must not lower the bar (to < from)",
    path: ["to"],
  });
export type BarRaised = z.infer<typeof BarRaisedSchema>;

/**
 * One recorded rubric sample: the same frozen artifact re-judged SAMPLE_REPEATS times under one rubric
 * composition, so a bar may not ratchet on an identity nobody has sampled (S3, R20-R22). Derived
 * evidence for the ratchet, never a second owner of the bar; at most one per (task, version, composition).
 */
export const RubricSampledSchema = z.strictObject({
  task: TaskRefSchema,
  taskVersion: z.int().min(1),
  /** The scope whose due raise triggered the sample: `global` or a dimension id. */
  scope: z.string().min(1).max(64),
  /** That scope's identity key. */
  key: z.string().min(1).max(64).optional(),
  /** The rubric composition the sample vouches for (a new composition needs its own sample). */
  composition: z.string().min(1).max(64),
  /** The frozen accepted artifact the repeats were taken over. */
  artifactDigest: DigestSchema,
  repeats: z.int().min(2).max(9),
  criteria: z.array(SampleAgreementSchema).min(1).max(48),
  /** Stable only when EVERY criterion agreed (R21). */
  stable: z.boolean(),
  at: TimestampSchema,
});
export type RubricSampled = z.infer<typeof RubricSampledSchema>;

/** A full window under the raised bar with no pass at all: a loud signal, never an auto-lower. */
export const BarContestedSchema = z.strictObject({
  task: TaskRefSchema,
  taskVersion: z.int().min(1),
  /** `global` or a dimension id; absent means `global` (legacy). */
  scope: z.string().min(1).max(64).optional(),
  /** The identity key the contest belongs to (see BarRaisedSchema.key). */
  key: z.string().min(1).max(64).optional(),
  bar: z.number().min(0).max(1),
  attempts: z.int().min(0),
  reason: z.string().min(1).max(500),
});
export type BarContested = z.infer<typeof BarContestedSchema>;

/** One selected lesson, trimmed to its subjective core plus the score it hit (O1 bounds). */
export const RecallNoteSchema = z.strictObject({
  id: z.string().min(1).max(200),
  step: StepIdSchema,
  outcome: z.enum(["pass", "continued-failed", "escalated"]),
  score: z.number().min(0).max(1),
  relevance: z.number().min(0).max(1),
  whatWrong: z.string().max(1000),
  whatRight: z.string().max(1000),
  whatBetter: z.string().max(1000),
  tags: z.array(LearningTagSchema).max(8),
  /**
   * True only when this case's text passed the instruction screen (S4, R26). A case that failed, or
   * that could not be screened, keeps its record and loses its text; `withheld` says why, in one
   * code-owned line. Never absent: an unjudged case is disclosed, not silently served.
   */
  screened: z.boolean(),
  withheld: z.string().min(1).max(200).optional(),
});
export type RecallNote = z.infer<typeof RecallNoteSchema>;

/**
 * One derived recall-cache entry: the jev-ranked exemplar set for one EVIDENCE state. It is a cache,
 * not a fact — rebuildable by recomputation and superseded by a newer entry, never edited (events are
 * append-only). The key is (task, taskVersion, coverDigest, watermark) where the watermark is the
 * number of solved cases the task had when the entry was computed, so any new solved case invalidates
 * it. Like the alignment judgment, a jev-ranked result is RECORDED but not reproducible: the
 * deterministic stage is, and this record says which model ordered it and what it cost.
 */
export const RecallRankedSchema = z.strictObject({
  task: TaskRefSchema,
  taskVersion: z.int().min(1),
  /** The dimensions the query asked for (the cover), as the caller supplied them. */
  cover: z.array(z.string().min(1).max(64)).min(1).max(8),
  /** A stable digest of the sorted cover, so key lookup does not depend on order. */
  coverDigest: z.string().min(1).max(64),
  /** The solved-case count at computation time: equal to the current count means FRESH. */
  watermark: z.int().min(0),
  /** Only a jev-ranked set is cached; a deterministic fallback answer is never persisted (D10). */
  rankedBy: z.literal("jev"),
  model: z.string().min(1).max(200),
  usage: z
    .strictObject({
      input: z.int().min(0),
      output: z.int().min(0),
    })
    .optional(),
  /** How many candidates stage 1 offered the model (bounded by the code constant). */
  pool: z.int().min(0).max(64),
  /** The chosen exemplars, in the order jev put them, with the score that ordered them. */
  chosen: z
    .array(
      z.strictObject({
        instance: InstanceIdSchema,
        step: StepIdSchema,
        version: z.int().min(1),
        jev: z.number().min(0).max(1),
        /** The three noul probabilities that ordered it (S5, R31), keyed by criterion id. */
        nouls: z.record(z.string().min(1).max(32), z.number().min(0).max(1)).optional(),
        /** The weighted sum those probabilities produce (R30). */
        total: z.number().min(0).max(1).optional(),
        /** The instruction screen's verdict for this case, recorded with the ranking (S4, R26). */
        screen: z
          .strictObject({
            instructs: z.number().min(0).max(1),
            outside: z.number().min(0).max(1),
            passed: z.boolean(),
          })
          .optional(),
      }),
    )
    .max(5),
  at: TimestampSchema,
});
export type RecallRanked = z.infer<typeof RecallRankedSchema>;

/** The recorded RecallSet: the selected lessons, the weak-set they were ranked against (O1, audit). */
export const RecallSetSchema = z.strictObject({
  bar: z.number().min(0).max(1),
  weakSet: z.array(z.string().min(1).max(64)).max(8),
  notes: z.array(RecallNoteSchema).max(5),
  /**
   * Dimensions whose identity key changed since a case was judged, so that case was excluded for
   * them (S4, R28, D15). Recorded once per set: the exclusion is evidence, not a silent filter.
   */
  excluded: z.array(z.string().min(1).max(64)).max(8).optional(),
});
export type RecallSet = z.infer<typeof RecallSetSchema>;
