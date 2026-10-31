/** The quality-evaluation surface (quality eval): the scorer port, the two entry points, the pi-jev adapter. */
export { DEFAULT_PARETO_THRESHOLD, SAMPLE_AGREEMENT_MIN, SAMPLE_RANGE_MAX, SAMPLE_REPEATS } from "../runner/engine/types.ts";
export { advanceEvaluated, evaluateArtifact, type Scorer } from "./evaluate.ts";
export { jevScorer, type JevScorerOptions } from "./jev-scorer.ts";
/** The rubric sampler (S3): repeat-N agreement before a bar may raise. */
export { agreeOn, recordRubricSample, sampleIfDue, sampleRubric, type SampledRun } from "./sample.ts";
/** Execution learning, task-level (O2): the per-scope adaptive bars and the compound acceptance. */
export {
  BAR_CEILING,
  BAR_EMA_ALPHA,
  BAR_EMA_PERIODS,
  BAR_FORMULA_ID,
  BAR_MAX_STEP,
  BAR_MEAN_ATTEMPTS_MAX,
  BAR_MIN_STEP,
  BAR_WINDOW,
  DIMENSION_TOLERANCE,
  GLOBAL_SCOPE,
  WARMUP_MIN,
  barAt,
  barsFromQuality,
  compoundDecision,
  compositionKey,
  dimensionKey,
  effectiveBar,
  effectiveBarFor,
  effectiveBars,
  effectiveBarsFor,
  emaOf,
  gateBar,
  genuinePasses,
  lowerQuartile,
  ofTask,
  raisesOf,
  recomputeBar,
  sampleFor,
  unsampledDueScopes,
  scanEvents,
  scopeOf,
  stdev,
  type BarDecision,
  type Bars,
  type Compound,
  type GenuinePass,
  type LogEvent,
} from "./bar.ts";
/** The bounded experience query (P7): solved cases ranked deterministically behind an injected port. */
export {
  activeRanker,
  applyBounds,
  collectCases,
  deterministicRanker,
  DUPLICATE_JACCARD,
  JEV_CLIP,
  JEV_POOL,
  recallExperience,
  setRankerForTest,
  SINGLE_FLIGHT_WAIT_MS,
  type DistinctChoice,
  type DistinctOutcome,
  type DistinctRanker,
  type RankedKey,
  type CaseSignals,
  type ExperienceCase,
  type QueryNeed,
  type RankedCase,
  type RankerPort,
  type RecallPayload,
} from "./ranker.ts";
/** The jev distinct-exemplar stage and its persisted, lazily read-through cache (D1-D11). */
export {
  coverDigestOf,
  jevRanker,
  recallRanked,
  setDistinctRankerForTest,
  setRankedPersistForTest,
  setSingleFlightWaitForTest,
} from "./ranker-jev.ts";
/** Execution learning, task-level (O1): the ranked, bounded recall set and its targeted lesson. */
export {
  RECALL_MAX,
  RECALL_TOKEN_BUDGET,
  RECALL_WEIGHTS,
  briefRecall,
  escalatedLesson,
  recallFor,
  weakSetFor,
  type TargetedLesson,
  scoreCandidate,
  type CandidateRelevance,
  type CandidateSignals,
} from "./recall.ts";
