/**
 * How a step looks to the agent: the derived descriptor and its view helpers. Everything here is
 * projected from the pinned flow and the instance on every call and never stored; the op handlers in
 * `operations.ts` import it, and `tool.ts` re-exports the one name that was public before the split.
 *
 * Moved verbatim out of `tool.ts` (the 600-line split); no logic changed.
 */
import { fail } from "../types/errors.ts";
import { parseWith, type Artifact, type Instance, type Quality, type ResolvedNode } from "../types/schema.ts";
import { ArtifactSummarySchema, StepDescriptorSchema, type ArtifactSummary, type StepDescriptor } from "../types/pi.ts";
import type { RecallSet } from "../types/learning.ts";
import { CAPABILITY_NAMES, grantFor } from "../runner/capabilities.ts";
import { qualityHistory } from "../runner/engine/index.ts";
import type { EngineOptions, HandoffRef, OpenedFlow } from "../runner/engine/index.ts";
import { withStore } from "../runner/engine/support.ts";
import { briefRecall, effectiveBarsFor, gateBar } from "../quality/index.ts";
import { noteStanding } from "../runner/note-gate.ts";

export function currentStepOf(flow: OpenedFlow, instance: Instance): ResolvedNode {
  const node = flow.config.nodes.find((candidate) => candidate.id === instance.currentStep);
  if (node === undefined) {
    throw fail("CONFIG_INVALID", "current step " + JSON.stringify(instance.currentStep) + " is not in the pinned flow", {
      instance: instance.id,
      step: instance.currentStep,
      path: flow.path,
    });
  }
  const task = flow.tasks.get(node.task);
  if (task === undefined) {
    throw fail("PIN_MISSING", "the pinned flow names a task that has no pinned row", {
      instance: instance.id,
      node: node.id,
      task: node.task,
    });
  }
  const sources = flow.config.edges
    .filter((edge) => (edge.kind === "data" || edge.kind === "join") && edge.to === node.id)
    .map((edge) => edge.from);
  const refuse = flow.config.edges.find((edge) => edge.kind === "refuse" && edge.from === node.id)?.to;
  return refuse === undefined ? { node, task, sources } : { node, task, sources, refuse };
}

/** The judging stance, in the agent's own terms (F1/O1): how a score is produced and combined. */

export const JUDGING_STANCE =
  "an independent judge scores each dimension from 0 to 1 for how fully the artifact meets its statement, given the task goal; the overall score is the MINIMUM of those dimension scores, so every dimension must clear the floor on its own; the floor is this task's current bar and may rise as its history proves stable competence";

/** What the brief discloses about the standard plus what the past teaches (F1, F3, F7). */

/** The recorded judgment of the step that owes a note, so the note is evidence-backed (D12b). */
export interface NoteJudgment {
  score: number;
  mean?: number;
  flagged: string[];
  dimensions: { id: string; score: number; rationale?: string; diagnosis?: { probe: string; answer: string | number }[] }[];
}

interface LearningView {
  bar: number | undefined;
  /** The recorded verdict of the note-owed step, when there is one. */
  judgment: NoteJudgment | undefined;
  /**
   * The gate actually applied, per scope: `gateBar(earnedBar, pareto)`. Reported BESIDE the earned
   * bar so the agent sees the aspiration and the standard the gate enforces, and never over-works to
   * beat a bar the gate caps.
   */
  gate: { threshold: number; dimensions: Record<string, number> } | undefined;
  recall: RecallSet | undefined;
  /** The step that already reached its terminal outcome and still owes a note. */
  pending: string | undefined;
  attempts: number;
  budget: number;
}

/**
 * The learning disclosure for the current step, derived from the store on every call: the effective
 * bar (O2), the ranked recall set (O1) and whether a note is owed (O3). Nothing here is stored on
 * the descriptor, and the same store state yields the same disclosure byte for byte.
 */
export function learningView(options: EngineOptions, flow: OpenedFlow, instance: Instance): LearningView {
  const resolved = currentStepOf(flow, instance);
  const quality: Quality | undefined = resolved.task.quality ?? flow.config.quality;
  const standing = noteStanding(options, instance, flow);
  const recall =
    quality === undefined
      ? undefined
      : briefRecall(options, {
          instance: instance.id,
          step: resolved.node.id,
          task: resolved.node.task,
          taskVersion: resolved.task.version,
          quality,
        });
  // The same effective bars the gate and the recorded bar are derived from, capped at the Pareto
  // point: one formula (`gateBar`), so the brief cannot disagree with the gate.
  const bars = quality === undefined ? undefined : effectiveBarsFor(options, resolved.node.task, quality);
  // The judgment the note must be evidence-backed by: the RECORDED verdict of the step that owes it.
  // One existing read (qualityHistory), no new store path, no recomputation.
  const judgment =
    standing.pending === undefined
      ? undefined
      : withStore(options, (store) => {
          const attempts = qualityHistory(store, instance.id, standing.pending === undefined ? "" : standing.pending.step);
          const recorded = attempts.length === 0 ? undefined : attempts[attempts.length - 1].verdict;
          if (recorded === undefined) return undefined;
          return {
            score: recorded.score,
            ...(recorded.mean === undefined ? {} : { mean: recorded.mean }),
            flagged: recorded.flagged ?? [],
            dimensions: recorded.dimensions.map((dimension) => ({
              id: dimension.id,
              score: dimension.score,
              ...(dimension.rationale === undefined ? {} : { rationale: dimension.rationale }),
              ...(dimension.diagnosis === undefined ? {} : { diagnosis: dimension.diagnosis }),
            })),
          };
        });
  return {
    bar: recall?.bar,
    judgment,
    gate:
      bars === undefined
        ? undefined
        : {
            threshold: gateBar(bars.global, bars.pareto),
            dimensions: Object.fromEntries([...bars.perDimension].map(([id, bar]) => [id, gateBar(bar, bars.pareto)])),
          },
    recall,
    pending: standing.pending?.step,
    attempts: standing.attempts,
    budget: standing.budget,
  };
}

/**
 * Derived `{id, capabilities, ops, steps, brief}` (R6): `submit` only while running
 * under `artifact.write`, `read` whenever the grant carries `artifact.read`, in that
 * order. `steps` is the pinned flow's ordered node ids, so the agent knows where it is;
 * `brief` is the current task's goal, output schema and section contract, so the agent
 * knows what to produce before its first submit instead of discovering it by rejection.
 * Both are projected from state already loaded and pinned; nothing new is read or stored.
 */
export function stepDescriptor(
  flow: OpenedFlow,
  instance: Instance,
  handoffs: readonly HandoffRef[] = [],
  learning?: LearningView,
): StepDescriptor {
  const resolved = currentStepOf(flow, instance);
  const single = handoffs.length === 1 ? handoffs[0].digest : undefined;
  const grant = grantFor({ id: resolved.node.id, capabilities: resolved.task.capabilities });
  const quality = resolved.task.quality ?? flow.config.quality;
  const ops: ("submit" | "read" | "note" | "check")[] = [];
  // A step that owes a note cannot submit: the reflection comes first (O3). The engine refuses the
  // submit anyway; saying so here means the agent learns it from the brief, not from a rejection.
  if (learning?.pending !== undefined) ops.push("note");
  else if (instance.status === "running" && grant.capabilities.has("artifact.write")) {
    ops.push("submit");
    // The dry run is offered wherever a submit is: check first, submit when it comes back clean.
    ops.push("check");
  }
  if (grant.capabilities.has("artifact.read")) ops.push("read");
  return parseWith(
    StepDescriptorSchema,
    {
      id: grant.step,
      capabilities: CAPABILITY_NAMES.filter((name) => grant.capabilities.has(name)),
      ops,
      steps: flow.config.nodes.map((node) => node.id),
      brief: {
        goal: resolved.task.goal,
        produces: resolved.task.produces.schema,
        ...(resolved.task.requires !== undefined ? { requires: resolved.task.requires } : {}),
        ...(resolved.task.bindsSubject !== undefined ? { bindsSubject: resolved.task.bindsSubject } : {}),
        ...(handoffs.length > 0 ? { consumes: handoffs.map((handoff) => ({ step: handoff.step, schema: handoff.schema, digest: handoff.digest })) } : {}),
        ...(single !== undefined ? { derivedFrom: single } : {}),
        ...(single !== undefined && resolved.task.bindsSubject === true ? { subject: single } : {}),
        // The standard this step is judged against, before it submits rather than only on refusal:
        // the rubric, the floor IN FORCE (the adaptive bar, not the authored one), how the judgments
        // aggregate, how the judge works, and the lessons previous agents on this task recorded.
        ...(quality === undefined
          ? {}
          : {
              quality: {
                // The brief shows the rubric, not the judge's battery: identity, statement and floor.
                dimensions: quality.dimensions.map((dimension) => ({
                  id: dimension.id,
                  statement: dimension.statement,
                  ...(dimension.floor === undefined ? {} : { floor: dimension.floor }),
                })),
                threshold: learning?.bar ?? quality.threshold,
                ...(learning?.gate === undefined ? {} : { gate: learning.gate }),
                ...(learning?.judgment === undefined ? {} : { judgment: learning.judgment }),
                policy: quality.policy,
                aggregation: "min" as const,
                judging: JUDGING_STANCE,
                ...(learning?.recall === undefined ? {} : { recall: learning.recall }),
              },
            }),
      },
    },
    "RESULT_INVALID",
    "step descriptor",
  );
}

/** The store row minus its path and bytes: what the parent is allowed to see (R7). */

export function artifactSummary(artifact: Artifact): ArtifactSummary {
  return parseWith(
    ArtifactSummarySchema,
    {
      step: artifact.step,
      version: artifact.version,
      digest: artifact.digest,
      schema: artifact.schema,
      state: artifact.state,
    },
    "RESULT_INVALID",
    "artifact summary",
  );
}

/** A validated success envelope: `content` is the JSON text of the same `details` (R7). */
