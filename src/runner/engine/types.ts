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
  /** The derived, watermark-versioned recall cache: a jev-ranked exemplar set, never a fact. */
  recallRanked: "recall.ranked",
  /** S3: a rubric identity was sampled with repeat judgments before its first raise. */
  rubricSampled: "rubric.sampled",
  /** S3: a due raise was withheld because the identity has no stable sample. */
  barHeld: "bar.held",
} as const;

/**
 * How many refused attempts one step may make before the instance blocks, when neither the
 * task nor the flow declares `maxAttempts`. A resource bound in code, never in a prompt.
 */
export const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * The Pareto (good-enough) point of a quality gate, when neither the task nor the flow declares one:
 * the gate compares every dimension and the mean against `min(bar, paretoThreshold)`, so a run that is
 * good enough is never refused merely because the adaptive bar climbed above it. The RATCHET is not
 * capped by this constant: bars keep rising and recording the level actually reached.
 */
export const DEFAULT_PARETO_THRESHOLD = 0.8;

/**
 * The quantile bar (quantile-bars A1-A7). One observation per instance, a percentile of the carried
 * population, a floor no bar may sit below, and a window of two halves.
 *
 * NAMES: the plan names the window and the formula `BAR_WINDOW` / `BAR_FORMULA_ID`, but those two
 * identifiers still belong to the live EMA ratchet (BAR_WINDOW = 5, praxis.bar.ema/v3) until that
 * machinery is deleted; existing assertions import them. So S1 adds the quantile pair under its own
 * names and the deletion step takes the canonical names over.
 */
/** No bar - authored, measured or legacy - may sit below this (A1). */
export const ABSOLUTE_MIN = 0.5;
/** Observations a (task, dimension) scope needs before a measured bar exists (spec 3.5). */
export const CALIBRATION_MIN = 20;
/** The quantile bar's window: two halves of HALF_WINDOW (spec 3.4). */
export const QUANTILE_WINDOW = 40;
export const HALF_WINDOW = QUANTILE_WINDOW / 2;
/** The smallest raise worth recording (spec 3.6). */
export const RAISE_STEP = 0.02;
/** The percentile a dimension gates at when it declares no `quantileGate` (A2). */
export const DEFAULT_QUANTILE = 25;
/** The formula id the quantile ratchet records on every raise (spec 3.6). */
export const QUANTILE_FORMULA_ID = "praxis.bar.quantile/v1";

/**
 * Uncertainty thresholds (S2): code constants, never a task-document field (R36). A criterion is
 * reported TORN — the judge itself was close to the boundary — when its answer distribution is wide
 * or its clean-option mass sits near the split. A `noul` returns ONE probability and no mass, so its
 * only within-judgment signal is the value's distance from 0.5.
 */
export const TORN_SPREAD = 0.35;
/** The `noul` band: a single probability this close to 0.5 is a torn judgment (R16, R17). */
export const TORN_NOUL_BAND = [0.45, 0.55] as const;

/**
 * Rubric stability (S3, R20-R21): how many repeat judgments one sample takes, and what counts as
 * agreement. Repeat-N is the ONLY instability signal a `noul` can have (it has no mass), so a
 * `noul`/`score` agrees by the RANGE of its values across the repeats and a `choice` by how often
 * the same key recurs. Both are code constants: no task document sets them.
 */
export const SAMPLE_REPEATS = 3;
/** The widest noul/score range that still counts as agreement across SAMPLE_REPEATS judgments. */
export const SAMPLE_RANGE_MAX = 0.3;
/** How much of the repeats must pick the same `choice` key (2 of 3) to count as agreement. */
export const SAMPLE_AGREEMENT_MIN = 2 / 3;
/** The choice band: P(clean) inside it is a torn judgment (R17). */
export const TORN_CLEAN_BAND = [0.4, 0.6] as const;

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
  /**
   * The order the caller was handed (T2). RECORDED on `instance.created`, not interpreted here: the
   * engine stores it so the record carries the assignment the work was done for. An absent order
   * writes no key, so a start without one produces exactly the payload it always did.
   */
  order?: string;
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
