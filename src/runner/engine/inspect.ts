/**
 * The read paths: current durable state plus the bounded result, and one recorded artifact.
 * Both verify the pins and never consult the library.
 */
import { fail } from "../../types/errors.ts";
import type { Artifact } from "../../types/schema.ts";
import { loadInstance } from "../../store/instance.ts";
import { readArtifact } from "../../store/artifacts.ts";
import { buildResult } from "../result.ts";
import { assertObserver } from "./authority.ts";
import { acceptedRefs, currentHandoffs, loadPinnedFlow } from "./flow.ts";
import { waitTypeOf } from "./wait.ts";
import { qualityHistory, withFailedReason } from "./quality-loop.ts";
import { messageOf, withStore } from "./support.ts";
import type { Inspection, InspectOptions, ReadOptions } from "./types.ts";

/** Current durable state plus the bounded result, without running a node. */
export function inspect(options: InspectOptions): Inspection {
  return withStore(options, (store) => {
    const loaded = loadInstance(store, options.instance);
    assertObserver(store, loaded, options.actor);
    const instance = withFailedReason(store, loaded);
    const accepted = acceptedRefs(store, instance.id);
    const flow = loadPinnedFlow(store, instance);
    return {
      instance,
      result: buildResult(instance, accepted, waitTypeOf(flow, instance)),
      flow,
      handoffs: currentHandoffs(flow, instance, accepted),
      qualityHistory: qualityHistory(store, instance.id, instance.currentStep),
    };
  });
}

/** Read one recorded artifact and return its parsed value (the `artifact.read` surface). */
export function readStepArtifact(options: ReadOptions): { artifact: Artifact; value: unknown } {
  return withStore(options, (store) => {
    assertObserver(store, loadInstance(store, options.instance), options.actor);
    const read = readArtifact(store, options.instance, options.step);
    const text = Buffer.from(read.bytes).toString("utf8");
    let value: unknown;
    try {
      value = JSON.parse(text) as unknown;
    } catch (error) {
      throw fail("ARTIFACT_INVALID", "recorded artifact is not JSON", { reason: messageOf(error) });
    }
    return { artifact: read.artifact, value };
  });
}
