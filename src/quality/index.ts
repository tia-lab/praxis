/** The quality-evaluation surface (quality eval): the scorer port, the two entry points, the pi-jev adapter. */
export {
  ABSOLUTE_MIN,
  CALIBRATION_MIN,
  DEFAULT_QUANTILE,
  FIRST_HALF,
  FIRST_RAISE_MIN,
  HALF_WINDOW,
  QUANTILE_FORMULA_ID,
  QUANTILE_WINDOW,
  RAISE_STEP,
  SAMPLE_AGREEMENT_MIN,
  SAMPLE_RANGE_MAX,
  SAMPLE_REPEATS,
} from "../runner/engine/types.ts";
export { advanceEvaluated, evaluateArtifact, type Scorer } from "./evaluate.ts";
export { choiceQuestion, jevScorer, type JevScorerOptions } from "./jev-scorer.ts";
/** The branch decider (R9): the router port, the jev implementation and the fail-closed normalizer. */
export {
  ROUTER_ID,
  ROUTE_TIMEOUT_MS,
  jevRouteRouter,
  routeOf,
  type JevRouteOptions,
  type RouteAnswer,
  type RouteDecision,
  type RouteInput,
  type RouteRouter,
} from "./jev-branch.ts";
/** The rubric sampler (S3): repeat-N agreement before a bar may raise. */
export { agreeOn, recordRubricSample, sampleIfDue, sampleRubric, type SampledRun } from "./sample.ts";
/** Execution learning, task-level (O2): the per-scope adaptive bars and the compound acceptance. */
export {
  BAR_FORMULA_ID,
  barAt,
  perDimensionDecision,
  compositionKey,
  dimensionKey,
  flooredBar,
  ofTask,
  quantileBars,
  quantileBarsFor,
  raisesOf,
  recomputeBar,
  sampleFor,
  unsampledDueScopes,
  scanEvents,
  scopeOf,
  type BarDecision,
  type Compound,
  type GenuinePass,
  type LogEvent,
} from "./bar.ts";
/** The bounded experience query (P7): solved cases ranked deterministically behind an injected port. */
export {
  activeRanker,
  applyBounds,
  caseKey,
  collectCases,
  excludedFor,
  rubricKeys,
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
