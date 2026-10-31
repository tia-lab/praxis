/**
 * How a step looks to the agent: the derived descriptor and its view helpers. Everything here is
 * projected from the pinned flow and the instance on every call and never stored; the op handlers in
 * `operations.ts` import it, and `tool.ts` re-exports the one name that was public before the split.
 *
 * Moved verbatim out of `tool.ts` (the 600-line split); no logic changed.
 */
import { fail } from "../types/errors.ts";
import { parseWith, type Artifact, type Instance, type Probe, type Quality, type ResolvedNode } from "../types/schema.ts";
import { ArtifactSummarySchema, StepDescriptorSchema, type ArtifactSummary, type StepDescriptor } from "../types/pi.ts";
import type { RecallSet } from "../types/learning.ts";
import { CAPABILITY_NAMES, grantFor } from "../runner/capabilities.ts";
import { qualityHistory } from "../runner/engine/index.ts";
import type { EngineOptions, HandoffRef, OpenedFlow } from "../runner/engine/index.ts";
import { withStore } from "../runner/engine/support.ts";
import { ABSOLUTE_MIN } from "../runner/engine/types.ts";
import { briefRecall, quantileBarsFor } from "../quality/index.ts";
import { carriedPopulation, quantileOf } from "../quality/bar.ts";
import { dimensionKey } from "../quality/scope.ts";
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

/**
 * One criterion as the brief shows it (R13): identity, type and the authored text that decides, with
 * its options (choice) or levels (score). Disclosure only — the brief never reveals a score.
 */
function criterionBrief(probe: Probe): Record<string, unknown> {
  const criteria = probe.criteria;
  return {
    id: probe.id,
    type: probe.type,
    instructions: probe.instructions,
    ...(probe.type === "choice" && typeof criteria === "object" && criteria !== null && !Array.isArray(criteria)
      ? { options: criteria, ...(probe.clean === undefined ? {} : { clean: probe.clean }) }
      : {}),
    ...(probe.type === "score" && Array.isArray(criteria) ? { levels: criteria } : {}),
    // The sections this criterion judges, when it targets any (T1, R5): the same target the judge
    // will be given, so the agent can see what each criterion is measured against.
    ...(probe.sections === undefined ? {} : { sections: probe.sections }),
  };
}

/** The judging stance, in the agent's own terms (F1/O1): how a score is produced and combined. */

// Kept inside the brief's 400-character bound: the stance has to state composition AND the MIN rule.
export const JUDGING_STANCE =
  "a judge scores each dimension 0-1. A dimension with criteria is COMPOSED: each criterion is its own question and the dimension scores their MINIMUM, so no strong criterion hides a weak one; the judge's answer to the statement is recorded, never scored. No criteria means the statement scores. The overall score is the MINIMUM of the dimensions; the floor is the current bar, which may rise";

/** What the brief discloses about the standard plus what the past teaches (F1, F3, F7). */

/** The recorded judgment of the step that owes a note, so the note is evidence-backed (D12b). */
export interface NoteJudgment {
  score: number;
  mean?: number;
  flagged: string[];
  dimensions: {
    id: string;
    score: number;
    bound?: string;
    statementScore?: number;
    divergence?: boolean;
    rationale?: string;
    torn?: string[];
    provisional?: boolean;
    provisionalOn?: { dimension: string; criterion: string; signal: "mass" | "confidence" | "noul-band" }[];
    diagnosis?: { probe: string; answer: string | number; confidence?: number; pClean?: number; pTop?: number; spread?: number }[];
  }[];
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

  // S2: the gate the agent must clear is the MEASURED per-dimension bar, uncapped - there is no
  // Pareto point left to cap it with, and no global bar. The floor is the default.
  const measured = quality === undefined ? undefined : quantileBarsFor(options, resolved.node.task, quality);
  // The judgment the note must be evidence-backed by: the RECORDED verdict of the step that owes it.
  // One existing read (qualityHistory), no new store path, no recomputation.
  const judgment =
    standing.pending === undefined
      ? undefined
      : withStore(options, (store) => {
          const attempts = qualityHistory(store, instance.id, standing.pending === undefined ? "" : standing.pending.step);
          const recorded = attempts.length === 0 ? undefined : attempts[attempts.length - 1].verdict;
          if (recorded === undefined) return undefined;
          // The Q50 of the SAME carried population the bar reads (A3, A4): a passing dimension below
          // its own median is flagged, and the gap is how far below it sat. Derived, never stored.
          const flaggedIds = new Set(recorded.flagged ?? []);
          const declared = new Map((standing.pending?.quality.dimensions ?? []).map((dimension) => [dimension.id, dimension]));
          const q50Of = (id: string): number | undefined => {
            const dimension = declared.get(id);
            if (dimension === undefined) return undefined;
            const values = carriedPopulation(store, String(standing.pending?.task ?? ""), id, dimensionKey(dimension));
            return quantileOf([...values].sort((left, right) => left - right), 50);
          };
          return {
            score: recorded.score,
            ...(recorded.mean === undefined ? {} : { mean: recorded.mean }),
            flagged: recorded.flagged ?? [],
            dimensions: recorded.dimensions.map((dimension) => ({
              id: dimension.id,
              score: dimension.score,
              // What decided it (R14): the binding criterion and the statement witness, read back
              // from the recorded verdict rather than recomputed.
              ...(dimension.bound === undefined ? {} : { bound: dimension.bound }),
              ...(dimension.statementScore === undefined ? {} : { statementScore: dimension.statementScore }),
              ...(dimension.divergence === true ? { divergence: true } : {}),
              ...(dimension.rationale === undefined ? {} : { rationale: dimension.rationale }),
              ...(dimension.torn === undefined ? {} : { torn: dimension.torn }),
              ...(recorded.provisional === undefined ? {} : { provisional: recorded.provisional }),
              ...(recorded.provisionalOn === undefined ? {} : { provisionalOn: recorded.provisionalOn }),
              ...(dimension.diagnosis === undefined ? {} : { diagnosis: dimension.diagnosis }),
              ...(q50Of(dimension.id) === undefined ? {} : { q50: q50Of(dimension.id)! }),
              ...(flaggedIds.has(dimension.id) && q50Of(dimension.id) !== undefined
                ? { gap: Math.round((q50Of(dimension.id)! - dimension.score) * 10000) / 10000 }
                : {}),
            })),
          };
        });
  return {
    bar: recall?.bar,
    judgment,
    gate:
      measured === undefined
        ? undefined
        : { threshold: ABSOLUTE_MIN, dimensions: Object.fromEntries([...measured.perDimension]) },
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
                // The brief shows the rubric AND what decides each dimension (R13): identity, statement,
                // floor, and — for a composed dimension — every criterion with the text it asks.
                dimensions: quality.dimensions.map((dimension) => ({
                  id: dimension.id,
                  statement: dimension.statement,
                  ...(dimension.floor === undefined ? {} : { floor: dimension.floor }),
                  ...(dimension.quantileGate === undefined ? {} : { quantileGate: dimension.quantileGate }),
                  ...(dimension.probes === undefined ? {} : { criteria: dimension.probes.map(criterionBrief) }),
                })),
                threshold: learning?.bar ?? quality.threshold,
                ...(learning?.gate === undefined ? {} : { gate: learning.gate }),
                ...(learning?.judgment === undefined ? {} : { judgment: learning.judgment }),
                policy: quality.policy,
                aggregation: "min" as const,
                // How the criteria become a dimension score, shown only when something is composed.
                ...(quality.dimensions.some((dimension) => dimension.probes !== undefined) ? { criteriaAggregation: "min" as const } : {}),
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
