/**
 * The hooks contract's shapes: eight closed hook names (before_/after_ over the four mutating ops)
 * and ONE closed payload type per hook. Closed means closed: no index signature, so a payload with
 * an extra field is a compile error rather than a silently carried value.
 *
 * Why these eight and no others: read, issue.template and issue.open are a query and diagnostics —
 * nothing composes on them. Why one payload type per hook: a binding is typed against its own name
 * through `HookPayloads`, so `before_start` cannot be handed a submit's payload by mistake.
 */
import type { AlignmentAnchor } from "../quality/jev-align.ts";
import type { LearningNoteSubjective } from "./learning.ts";
import type { InstanceStatus } from "./schema.ts";

/** Every hook, in taxonomy order. */
export const HOOK_NAMES = [
  "before_start",
  "after_start",
  "before_check",
  "after_check",
  "before_submit",
  "after_submit",
  "before_note",
  "after_note",
] as const;
export type HookName = (typeof HOOK_NAMES)[number];

/** The hooks that run at an op's entry and may VETO it. */
export const BEFORE_HOOKS = ["before_start", "before_check", "before_submit", "before_note"] as const;
export type BeforeHookName = (typeof BEFORE_HOOKS)[number];

/** The hooks that run once the op produced its outcome. Observe-only: they cannot veto. */
export const AFTER_HOOKS = ["after_start", "after_check", "after_submit", "after_note"] as const;
export type AfterHookName = (typeof AFTER_HOOKS)[number];

/** The recorded judgment an accepted or refused submit produced (absent for a floorless task). */
export interface VerdictSummary {
  /** MIN over the dimensions: the headline score. */
  score: number;
  /** MEAN over the dimensions: the value the global bar gates on. */
  mean: number;
  dimensions: { id: string; score: number }[];
  /** Dimensions that passed only inside the tolerance band. */
  flagged: string[];
  /** Dimensions below `bar - tolerance`: a hard refuse. */
  refused: string[];
  rubricDigest: string;
}

/**
 * `before_start`: the decision inputs. The anchor is the flow-pinned task (Unit 3's D2); the order
 * is present only as its DIGEST — the text is never handed to a hook, the same rule the gate set.
 */
export interface BeforeStartPayload {
  op: "start";
  flow: string;
  requestId: string;
  orderDigest: string;
  anchor: AlignmentAnchor;
}

/** `after_start`: what now exists. */
export interface AfterStartPayload {
  op: "start";
  instance: string;
  status: InstanceStatus;
  step: string;
}

/** `before_check`: a dry run is about to validate these bytes. */
export interface BeforeCheckPayload {
  op: "check";
  instance: string;
  step: string;
  artifact: unknown;
  artifactDigest: string;
}

/** `after_check`: the dry run's answer. A check records nothing, so there is no verdict. */
export interface AfterCheckPayload {
  op: "check";
  instance: string;
  step: string;
  ok: boolean;
  missing: string[];
}

/** `before_submit`: the bytes about to be judged. */
export interface BeforeSubmitPayload {
  op: "submit";
  instance: string;
  step: string;
  artifact: unknown;
  artifactDigest: string;
}

/** `after_submit`: accepted or refused, with the verdict that decided it. */
export interface AfterSubmitPayload {
  op: "submit";
  instance: string;
  step: string;
  decision: "accepted" | "refused";
  verdict?: VerdictSummary;
}

/** `before_note`: the reflection about to be recorded (null when the caller sent none). */
export interface BeforeNotePayload {
  op: "note";
  instance: string;
  step: string;
  subjective: LearningNoteSubjective | null;
}

/** `after_note`: what was recorded, including the engine's stub fallback. */
export interface AfterNotePayload {
  op: "note";
  instance: string;
  step: string;
  noteVersion: number;
  stub: boolean;
}

/** The name → payload map. A binding is typed against its own hook, not the union. */
export interface HookPayloads {
  before_start: BeforeStartPayload;
  after_start: AfterStartPayload;
  before_check: BeforeCheckPayload;
  after_check: AfterCheckPayload;
  before_submit: BeforeSubmitPayload;
  after_submit: AfterSubmitPayload;
  before_note: BeforeNotePayload;
  after_note: AfterNotePayload;
}

/** A binding: what a project registers. `id` is unique per hook name. */
export interface HookBinding<N extends HookName = HookName> {
  name: N;
  id: string;
  run: (payload: HookPayloads[N]) => void | Promise<void>;
}

/** The outcome of a `before_` dispatch: a veto names the hook that stopped the op, and why. */
export type BeforeOutcome = { vetoed: false } | { vetoed: true; reason: string; hook: string };

/** The outcome of an `after_` dispatch: contained failures, named so they can be logged. */
export interface AfterOutcome {
  failures: { hook: string; reason: string }[];
}
