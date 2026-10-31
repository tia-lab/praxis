/**
 * The engine's public surface. This file holds NO logic: every operation, type and constant is a
 * re-export of the module that owns it, so importers keep the one `runner/engine/index.ts` path
 * while the implementation is split by cohesion.
 */
export { DEFAULT_MAX_ATTEMPTS, DEFAULT_ON_FAILURE, EVENT } from "./types.ts";
export type {
  AdvanceOptions,
  EngineOptions,
  HandoffRef,
  InspectOptions,
  Inspection,
  OnFailure,
  OpenedFlow,
  QualityAttempt,
  ReadOptions,
  StartOptions,
  Started,
} from "./types.ts";
export { orderFor, orderOf, storeDirOf, tasksDirOf } from "./support.ts";
export { acceptedRefs, currentHandoffs, instanceIdFor, loadPinnedFlow, openFlow, validateFlow } from "./flow.ts";
export { qualityHistory } from "./quality-loop.ts";
export { start } from "./start.ts";
export { advance } from "./advance.ts";
export { inspect, readStepArtifact } from "./inspect.ts";
export { gate } from "../step.ts";
export type { Verdict } from "../step.ts";
