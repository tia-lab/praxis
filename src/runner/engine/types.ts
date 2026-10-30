/**
 * The engine's declared surface: options, results and the pinned-flow value, plus the event names
 * and the resource bounds the loop enforces. Pure declarations — no logic lives here.
 */
import type { FlowConfig, Instance, QualityVerdict, Result, TaskConfig } from "../../types/schema.ts";

export const EVENT = {
  instanceCreated: "instance.created",
  gateVerdict: "gate.verdict",
  qualityVerdict: "quality.verdict",
  qualityContinued: "quality.continued",
  instanceFailed: "instance.failed",
  needsGuidance: "needs.guidance",
  artifactAccepted: "artifact.accepted",
  stepTrace: "step.trace",
  instanceCompleted: "instance.completed",
  /** Execution learning (task-level loop): the four additive learning facts, all append-only. */
  learningNote: "learning.note",
  barRaised: "bar.raised",
  barContested: "bar.contested",
  recallSelected: "recall.selected",
} as const;

/**
 * How many refused attempts one step may make before the instance blocks, when neither the
 * task nor the flow declares `maxAttempts`. A resource bound in code, never in a prompt.
 */
export const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * What a step does when it cannot reach its floor, unless the task or the flow says otherwise.
 * `continue` keeps the flow moving with the best attempt on the record; `escalate` halts the
 * instance in `failed` and records a needs-guidance signal. Escalation cannot route anywhere
 * yet (Manifold is not integrated), so continuing is the default.
 */
export const DEFAULT_ON_FAILURE: OnFailure = "continue";

/** The declared onFailure policies, as a type the policy reader returns. */
export type OnFailure = "escalate" | "continue";

export interface EngineOptions {
  /** Store root; default <cwd>/.pi/praxis/state or PRAXIS_STORE_DIR. */
  storeDir?: string;
  /** Flow document; default <cwd>/.pi/praxis/flows/engineering/feature.json or PRAXIS_CONFIG. */
  configPath?: string;
  /** Task library root; default <cwd>/.pi/praxis/tasks or PRAXIS_TASKS_DIR. */
  tasksDir?: string;
  /** Pinned timestamp for the artifact rows; defaults to the wall clock. */
  now?: string;
  /** Actor pinned at creation; default PRAXIS_ACTOR or "cli". */
  actor?: string;
  /**
   * The project's default attempt budget (`.pi/praxis/config.json`), threaded in by the boundary so
   * the engine never reads configuration itself. A task's or flow's own `maxAttempts` still wins.
   */
  defaultMaxAttempts?: number;
}

export interface StartOptions extends EngineOptions {
  flow: string;
  requestId: string;
  /** Optional role -> actor map, pinned at creation and immutable (team relay). */
  roles?: Record<string, string>;
}

export interface AdvanceOptions extends EngineOptions {
  instance: string;
  /** Parsed artifact payload supplied by the caller for the node being run. */
  artifact?: unknown;
  /** A quality verdict pre-computed outside any transaction (quality eval); enforced by the gate. */
  qualityVerdict?: QualityVerdict;
}

export interface InspectOptions extends EngineOptions {
  instance: string;
}

export interface ReadOptions extends InspectOptions {
  step: string;
}

/** A flow document plus the task units it names, all resolved before any write. */
export interface OpenedFlow {
  config: FlowConfig;
  flowDigest: string;
  path: string;
  /** Keyed by the `id@version` reference a node carries. */
  tasks: ReadonlyMap<string, TaskConfig>;
}

export interface Started {
  instance: Instance;
  flow: OpenedFlow;
  created: boolean;
}

/** The accepted predecessor references the current step consumes (step, schema, digest). */
export interface HandoffRef {
  step: string;
  schema: string;
  digest: string;
}

export interface Inspection {
  instance: Instance;
  result: Result;
  /** The pinned flow, so a caller never re-opens the library (R5). */
  flow: OpenedFlow;
  /** The current step's accepted sources, so the descriptor can name provenance. */
  handoffs: HandoffRef[];
  /**
   * Every quality attempt already recorded for the current step, in append order. Read from the
   * event log so the caller can reuse a verdict for the same bytes or count a budget without
   * any store column existing for either fact.
   */
  qualityHistory: QualityAttempt[];
}

/** One recorded quality attempt for a step, exactly as its `quality.verdict` event states it. */
export interface QualityAttempt {
  step: string;
  version: number;
  artifactDigest: string;
  verdict: QualityVerdict;
}
