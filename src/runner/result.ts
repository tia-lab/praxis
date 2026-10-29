/**
 * The bounded parent result (R11, P12).
 *
 * Exactly six keys leave this runtime, and the shape is validated against the one
 * declared schema before it is returned: no event log, no transcript, no bytes,
 * no store path.
 */
import {
  ResultSchema,
  parseWith,
  type ArtifactRef,
  type Instance,
  type Result,
} from "../types/schema.ts";

export const RESULT_FIELDS = [
  "instanceId",
  "flow",
  "status",
  "artifacts",
  "summary",
  "nextAction",
] as const;

function nextActionFor(status: string): string {
  if (status === "completed") return "none";
  if (status === "failed") return "inspect-store";
  return "resume";
}

function summaryFor(instance: Instance, accepted: number): string {
  if (instance.status === "completed") return `completed: ${accepted} artifact(s) accepted`;
  if (instance.status === "failed") return `failed at ${instance.currentStep}: ${accepted} artifact(s) accepted`;
  return `${instance.status} at ${instance.currentStep}: ${accepted} artifact(s) accepted`;
}

/** Build the six-key result from durable state plus accepted artifact references. */
export function buildResult(instance: Instance, artifacts: readonly ArtifactRef[] = []): Result {
  const candidate = {
    instanceId: instance.id,
    flow: instance.flow,
    status: instance.status,
    artifacts: artifacts.map((artifact) => ({
      step: artifact.step,
      version: artifact.version,
      digest: artifact.digest,
      schema: artifact.schema,
    })),
    summary: summaryFor(instance, artifacts.length),
    nextAction: nextActionFor(instance.status),
  };
  return parseWith(ResultSchema, candidate, "RESULT_INVALID", "result");
}
