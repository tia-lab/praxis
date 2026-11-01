/**
 * Advancing one node: run the step under its grant, gate the artifact, record the verdict, and
 * either accept, refuse, retry, or apply the onFailure policy. Exactly one node per call.
 */
import { fail, isAppError } from "../../types/errors.ts";
import { type Instance, type QualityVerdict, type ResolvedNode, type Result, type TaskConfig } from "../../types/schema.ts";
import { loadInstance, setStatus } from "../../store/instance.ts";
import { appendEvent } from "../../store/events.ts";
import { readArtifact } from "../../store/artifacts.ts";
import { grantFor } from "../capabilities.ts";
import { buildResult } from "../result.ts";
import { buildHandoffs, gate, runStep, successorOf } from "../step.ts";
import { authoredQuality } from "./rules.ts";
import { assertObserver, assertStepActor } from "./authority.ts";
import { acceptedRefs, currentHandoffs, loadPinnedFlow } from "./flow.ts";
import { snapshotActive } from "./active.ts";
import { qualityRefusal, failureOutcome, recordAcceptance } from "./quality-loop.ts";
import { ABSOLUTE_MIN } from "./types.ts";
import { perDimensionDecision, quantileBars, recomputeBar } from "../../quality/index.ts";
import {
  finishInstance,
  maxNoteAttempts,
  noteAttempts,
  pendingNote,
  recordNoteRefusal,
  writeStubNote,
} from "../note-gate.ts";
import { stamp, withStore } from "./support.ts";
import { EVENT, type AdvanceOptions, type HandoffRef, type OpenedFlow } from "./types.ts";

/**
 * The engine never trusts a pass the floor in force does not support (O2). A verdict is computed
 * outside the store against the bar as it stood then; if a raise landed in between, a pass below
 * the current bar is downgraded here rather than carried by its old decision. Fail-closed, and the
 * recorded verdict is left otherwise untouched.
 */
function gatedVerdict(verdict: QualityVerdict | undefined, bars: { perDimension: ReadonlyMap<string, number> }): QualityVerdict | undefined {
  if (verdict === undefined) return undefined;
  if (verdict.decision !== "pass" || perDimensionDecision(verdict.dimensions, bars).pass) return verdict;
  return { ...verdict, decision: "below" };
}

/**
 * Advance the instance by exactly one node.
 * Resume never guesses a node: `currentStep` in the store names it, the wiring comes from
 * the pinned flow's edges, and the consumed artifacts are reloaded from the store.
 */
export function advance(options: AdvanceOptions): { instance: Instance; result: Result; flow: OpenedFlow; handoffs: HandoffRef[] } {
  return withStore(options, (store, storeDir) => {
    const instance = loadInstance(store, options.instance);
    assertObserver(store, instance, options.actor);
    const at = stamp(options);
    if (instance.status === "completed") {
      const accepted = acceptedRefs(store, instance.id);
      const flow = loadPinnedFlow(store, instance);
      snapshotActive(instance, flow, storeDir);
      return { instance, result: buildResult(instance, accepted), flow, handoffs: currentHandoffs(flow, instance, accepted) };
    }
    if (instance.status !== "running") {
      throw fail("INSTANCE_STATE_INVALID", "instance " + instance.id + " is " + instance.status, {
        instance: instance.id,
        status: instance.status,
        step: instance.currentStep,
      });
    }

    let flow: OpenedFlow;
    try {
      flow = loadPinnedFlow(store, instance);
    } catch (error) {
      // A mismatching pin is terminal (R5); a missing pin is not (A9).
      if (isAppError(error) && error.code === "PIN_CORRUPT") {
        setStatus(store, instance.id, { status: "failed", currentStep: instance.currentStep }, instance.revision);
      }
      throw error;
    }

    const index = flow.config.nodes.findIndex((node) => node.id === instance.currentStep);
    if (index < 0) {
      throw fail("CONFIG_INVALID", "current step " + JSON.stringify(instance.currentStep) + " is not in the flow", {
        instance: instance.id,
        step: instance.currentStep,
      });
    }
    const node = flow.config.nodes[index];
    const task = flow.tasks.get(node.task) as TaskConfig;
    const sources = flow.config.edges
      .filter((edge) => (edge.kind === "data" || edge.kind === "join") && edge.to === node.id)
      .map((edge) => edge.from);
    const refuse = flow.config.edges.find((edge) => edge.kind === "refuse" && edge.from === node.id)?.to;
    const resolved: ResolvedNode =
      refuse === undefined ? { node, task, sources } : { node, task, sources, refuse };
    assertStepActor(store, instance, task, sources, options.actor);
    // Closure gate (O3): a step that reached its terminal outcome owes a learning note, and the
    // next advance waits for it. The budget is bounded and the engine writes the stub itself once
    // it is spent, so a silently-noting agent can delay the flow but can never deadlock it.
    const awaiting = pendingNote(store, instance, flow);
    if (awaiting !== undefined) {
      const budget = maxNoteAttempts(awaiting.quality, options.defaultMaxAttempts);
      const spent = noteAttempts(store, instance.id, awaiting.step);
      if (spent < budget) {
        const attempts = recordNoteRefusal(store, instance.id, awaiting.step, at, "note-pending", [
          "note: required before advancing",
        ]);
        throw fail("INSTANCE_STATE_INVALID", "step " + JSON.stringify(awaiting.step) + " is awaiting its learning note", {
          instance: instance.id,
          step: awaiting.step,
          currentStep: instance.currentStep,
          attempts,
          maxAttempts: budget,
        });
      }
      writeStubNote(store, instance, awaiting, at);
      const closed = finishInstance(store, instance, flow, at);
      if (closed !== undefined) {
        const acceptedNow = acceptedRefs(store, instance.id);
        return {
          instance: closed,
          result: buildResult(closed, acceptedNow),
          flow,
          handoffs: currentHandoffs(flow, closed, acceptedNow),
        };
      }
    }
    const effectiveQuality = authoredQuality(flow, task);
    // The standard enforced is the MEASURED per-dimension bar (a quantile of the carried population,
    // floored at ABSOLUTE_MIN) - never an authored threshold, a mean, a band or a cap.
    const floors = effectiveQuality === undefined ? undefined : quantileBars(store, node.task, effectiveQuality);
    const grant = grantFor({ id: node.id, capabilities: task.capabilities });
    const handoffs = buildHandoffs(store, instance, resolved, grant);
    const artifact = runStep({ store, storeDir, instance, node, task, grant, handoffs, payload: options.artifact, at });

    const accepted = acceptedRefs(store, instance.id);
    const alreadyAccepted = accepted.some((ref) => ref.step === node.id && ref.version === artifact.version);

    // The gate runs even for a replay of an accepted artifact: acceptance was a judgement
    // about the work as it stood, and after the work moved on the replay is stale.
    const verdict = gate(artifact.value, {
      schema: task.produces.schema,
      nonce: instance.nonce,
      ...(handoffs.length === 1 ? { derivedFrom: handoffs[0].digest } : {}),
      ...(task.requires === undefined ? {} : { requires: task.requires }),
      ...(task.bindsSubject === true ? { subject: true } : {}),
      ...(effectiveQuality === undefined || floors === undefined
        ? {}
        : {
            quality: {
              policy: effectiveQuality.policy,
              threshold: ABSOLUTE_MIN,
              floors: Object.fromEntries(floors.perDimension),
              // The gate caps at the Pareto point; the cached verdict above already used the same cap.
              pareto: undefined,
              verdict: gatedVerdict(options.qualityVerdict, floors),
            },
          }),
    });

    if (alreadyAccepted && verdict.decision !== "accept") {
      appendEvent(store, instance.id, {
        type: EVENT.gateVerdict,
        payload: {
          step: node.id,
          version: artifact.version,
          decision: verdict.decision,
          checks: verdict.checks,
          ...(verdict.missing === undefined ? {} : { missing: verdict.missing }),
          artifactDigest: artifact.digest,
        },
        at,
      });
      if (resolved.refuse !== undefined) {
        setStatus(store, instance.id, { status: "running", currentStep: resolved.refuse }, instance.revision);
      }
      throw fail(verdict.code ?? "ARTIFACT_INVALID", "a replay of accepted step " + JSON.stringify(node.id) + " no longer passes the gate", {
        instance: instance.id,
        step: node.id,
        version: artifact.version,
        checks: verdict.checks,
        replayed: true,
        ...(resolved.refuse === undefined ? {} : { reworkTo: resolved.refuse }),
        ...(verdict.quality === undefined ? {} : { quality: verdict.quality }),
        // The compound diagnostic: which dimensions fell past their band and what the MEAN was, in
        // numbers, so every refusal says exactly what failed — not only the one at the bound.
        ...(verdict.quality === undefined || floors === undefined
          ? {}
          : { refused: perDimensionDecision(verdict.quality.dimensions, floors).refused }),
      });
    }

    if (!alreadyAccepted) {
      appendEvent(store, instance.id, {
        type: EVENT.gateVerdict,
        payload: {
          step: node.id,
          version: artifact.version,
          decision: verdict.decision,
          checks: verdict.checks,
          ...(verdict.missing === undefined ? {} : { missing: verdict.missing }),
          artifactDigest: artifact.digest,
        },
        at,
      });
      if (verdict.quality !== undefined) {
        appendEvent(store, instance.id, {
          type: EVENT.qualityVerdict,
          // `task`/`taskVersion` are additive: the learning scans are task-scoped, not instance-scoped.
          payload: { step: node.id, version: artifact.version, artifactDigest: artifact.digest, task: node.task, taskVersion: task.version, ...verdict.quality },
          at,
        });
      }
      if (verdict.decision === "accept") {
        recordAcceptance({
          store,
          instance,
          step: node.id,
          task,
          taskRef: node.task,
          grant,
          version: artifact.version,
          digest: artifact.digest,
          path: artifact.path,
          handoffs,
          at,
          ...(options.actor === undefined ? {} : { actor: options.actor }),
        });
        // A genuine terminal outcome: re-evaluate the ratchet from the pass just recorded.
        if (effectiveQuality !== undefined) recomputeBar(store, node.task, task.version, effectiveQuality, at);
      } else {
        // A refusal is evidence, not instance death. A refuse edge sends the work back to
        // the node that must be amended; without one the node stays current and is retried.
        // A quality refusal is bounded, and at the bound the task's onFailure policy decides:
        // escalate halts the instance here, while continue accepts the best-scoring attempt
        // (marked FAILED) and falls through to the same successor move an accepted step makes.
        let carried = false;
        if (qualityRefusal(verdict) && floors !== undefined) {
          const outcome = failureOutcome({
            store,
            instance,
            step: node.id,
            taskRef: node.task,
            taskVersion: task.version,
            quality: effectiveQuality,
            bars: floors,
            ...(options.defaultMaxAttempts === undefined ? {} : { defaultMaxAttempts: options.defaultMaxAttempts }),
            verdict: verdict.quality,
            at,
          });
          if (outcome.kind === "escalate") throw outcome.failure;
          if (outcome.kind === "continue") {
            // Re-read the chosen version: its bytes are verified against the recorded digest
            // before it becomes the handoff, exactly as an ordinary acceptance does.
            const chosen = readArtifact(store, instance.id, node.id, outcome.best.version).artifact;
            recordAcceptance({
              store,
              instance,
              step: node.id,
              task,
              taskRef: node.task,
              grant,
              version: chosen.version,
              digest: chosen.digest,
              path: chosen.path,
              handoffs,
              at,
              ...(options.actor === undefined ? {} : { actor: options.actor }),
              failed: outcome.best.verdict,
            });
            carried = true;
          }
        }
        if (!carried) {
          if (resolved.refuse !== undefined) {
            setStatus(store, instance.id, { status: "running", currentStep: resolved.refuse }, instance.revision);
          }
          throw fail(verdict.code ?? "ARTIFACT_INVALID", "artifact for step " + JSON.stringify(node.id) + " failed the gate", {
            instance: instance.id,
            step: node.id,
            version: artifact.version,
            checks: verdict.checks,
            ...(verdict.missing === undefined ? {} : { missing: verdict.missing }),
            ...(resolved.refuse === undefined ? {} : { reworkTo: resolved.refuse }),
            ...(verdict.quality === undefined ? {} : { quality: verdict.quality }),
            // The compound diagnostic: which dimensions fell past their band and what the MEAN was,
            // in numbers, on every refusal — not only on the one at the bound.
            ...(verdict.quality === undefined || floors === undefined
              ? {}
              : { refused: perDimensionDecision(verdict.quality.dimensions, floors).refused }),
          });
        }
      }
    }

    const successor = successorOf(flow.config, node.id);
    // Acceptance is the artifact; closure is the lesson (O3). `finishInstance` is the one writer of
    // the completed transition, so the advance path and the note path cannot disagree about it.
    const updated =
      successor !== undefined
        ? setStatus(store, instance.id, { status: "running", currentStep: successor }, instance.revision)
        : (finishInstance(store, instance, flow, at) ??
          setStatus(store, instance.id, { status: "running", currentStep: node.id }, instance.revision));
    const acceptedNow = acceptedRefs(store, instance.id);
    snapshotActive(updated, flow, storeDir, at);
    return { instance: updated, result: buildResult(updated, acceptedNow), flow, handoffs: currentHandoffs(flow, updated, acceptedNow) };
  });
}

