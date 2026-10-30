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

/** The window inputs an adaptive-bar raise was computed from, recorded so it is reproducible. */
export const BarWindowSchema = z.strictObject({
  passes: z.array(z.number().min(0).max(1)).min(1).max(16),
  lowerQuartile: z.number().min(0).max(1),
  margin: z.number().min(-1).max(1),
  stdev: z.number().min(0).max(1),
  meanAttempts: z.number().min(0).max(50),
});
export type BarWindow = z.infer<typeof BarWindowSchema>;

/** One raise of a task's effective floor, with the formula id that produced it (O2, audit). */
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
  window: BarWindowSchema,
  formulaId: z.string().min(1).max(64),
  at: TimestampSchema,
});
export type BarRaised = z.infer<typeof BarRaisedSchema>;

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
});
export type RecallNote = z.infer<typeof RecallNoteSchema>;

/** The recorded RecallSet: the selected lessons, the weak-set they were ranked against (O1, audit). */
export const RecallSetSchema = z.strictObject({
  bar: z.number().min(0).max(1),
  weakSet: z.array(z.string().min(1).max(64)).max(8),
  notes: z.array(RecallNoteSchema).max(5),
});
export type RecallSet = z.infer<typeof RecallSetSchema>;
