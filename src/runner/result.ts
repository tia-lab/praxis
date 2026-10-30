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

/** Keep a derived reason inside the result's own field bounds (R11). */
function clip(text: string, limit: number): string {
  return text.length <= limit ? text : text.slice(0, limit - 1) + "\u2026";
}

/**
 * The one thing the parent should do next. A `failed` instance with a reason is the quality
 * escalation: the step exhausted its attempt budget or stopped improving and the onFailure policy
 * halted it, so the reason travels with the action and the parent is asked for guidance instead of
 * guessing. A failure without a reason is the older terminal case (an unreadable pin).
 */
function nextActionFor(status: string, reason: string | undefined): string {
  if (status === "completed") return "none";
  if (status === "failed") return reason === undefined ? "inspect-store" : "needs-guidance: " + clip(reason, 900);
  return "resume";
}

function summaryFor(instance: Instance, accepted: number): string {
  if (instance.status === "completed") return `completed: ${accepted} artifact(s) accepted`;
  if (instance.status === "failed") {
    const head = `failed at ${instance.currentStep}: ${accepted} artifact(s) accepted`;
    return instance.failedReason === undefined ? head : clip(head + "; " + instance.failedReason, 4096);
  }
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
    nextAction: nextActionFor(instance.status, instance.failedReason),
  };
  return parseWith(ResultSchema, candidate, "RESULT_INVALID", "result");
}
