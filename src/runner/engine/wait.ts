/**
 * Durable park and resume (flow Unit 2, slice A): the wait is an EVENT, not a column, and a resume is
 * a short transaction that validates, matches, receipts and moves — never a daemon.
 *
 * Contract, and the honest boundary:
 *  - an arrival at a `wait` node appends ONE `instance.parked` intent and moves the instance to
 *    `waiting`; every other arrival moves it to `running` exactly as before (R3, R4);
 *  - a resume checks authority, then state, then the park in force, then the deadline, then the
 *    predicate: every refusal happens before any write except the lazy timeout, which is terminal by
 *    design (R5, R8, R9);
 *  - the matcher is exact equality over DECLARED fields (D6): no jev, no regex, no coercion;
 *  - the clock is the engine's injected `now`; this module reads no ambient time and starts no timer
 *    (check 9), so a park and its deadline are reproducible from the options alone;
 *  - parking holds no transaction open and nothing sweeps: a parked instance past its deadline stays
 *    parked until a host calls resume, which is the pre-gate form of the maintenance gate (#7).
 */
import { fail } from "../../types/errors.ts";
import type { Instance } from "../../types/schema.ts";
import type { Store } from "../../store/db.ts";
import { listEvents } from "../../store/events.ts";
import { loadInstance, setStatus } from "../../store/instance.ts";
import { appendEvent } from "../../store/events.ts";
import { canonicalBytes, digest } from "../canonical.ts";
import { buildResult } from "../result.ts";
import { snapshotActive } from "./active.ts";
import { assertObserver } from "./authority.ts";
import { acceptedRefs, currentHandoffs, loadPinnedFlow } from "./flow.ts";
import { payloadOf, stamp, withStore } from "./support.ts";
import { EVENT, type OpenedFlow, type ResumeOptions, type Resumed, type WaitEvent } from "./types.ts";

/** One park as the log states it: the event seq is the park id a receipt names. */
interface Park {
  seq: number;
  payload: Record<string, unknown>;
}

/**
 * The park currently IN FORCE: the last `instance.parked` whose seq no `wait.resumed` receipt names.
 * Absent means there is nothing to resume, which is the corrupt case a waiting instance must never be in.
 */
function parkInForce(store: Store, instance: string): Park | undefined {
  let park: Park | undefined;
  const resumed = new Set<number>();
  for (const event of listEvents(store, instance)) {
    if (event.type === EVENT.instanceParked) {
      park = { seq: event.seq, payload: payloadOf(event.payload) };
    } else if (event.type === EVENT.waitResumed) {
      const payload = payloadOf(event.payload);
      if (typeof payload.parkSeq === "number") resumed.add(payload.parkSeq);
    }
  }
  return park !== undefined && !resumed.has(park.seq) ? park : undefined;
}

/** The deadline a park declares, computed from the INJECTED clock; absent when no timeout was declared. */
export function deadlineOf(at: string, timeoutMs: number | undefined): string | undefined {
  if (timeoutMs === undefined) return undefined;
  const base = Date.parse(at);
  if (!Number.isFinite(base)) throw fail("CONFIG_INVALID", "the engine clock is not an ISO-8601 instant", { at });
  return new Date(base + timeoutMs).toISOString();
}

/**
 * The deterministic matcher (D6, R9): the type must equal exactly and every DECLARED field must be
 * present with a strictly equal value. Undeclared extras are ignored; a declared field absent from the
 * event is a mismatch. No coercion, no regex, no subset.
 */
export function matchEvent(declared: { type: unknown; match?: unknown }, event: WaitEvent): boolean {
  if (declared.type !== event.type) return false;
  const match = declared.match;
  if (match === undefined) return true;
  if (typeof match !== "object" || match === null) return false;
  const fields = event.fields ?? {};
  return Object.entries(match as Record<string, unknown>).every(([key, expected]) => fields[key] === expected);
}

/** Only the DECLARED fields the event actually matched: the receipt never stores the event body. */
function matchedFields(park: Park, event: WaitEvent): Record<string, string | number | boolean> | undefined {
  const match = park.payload.match;
  if (typeof match !== "object" || match === null) return undefined;
  const declared = Object.keys(match as Record<string, unknown>);
  if (declared.length === 0) return undefined;
  const fields = event.fields ?? {};
  const matched: Record<string, string | number | boolean> = {};
  for (const key of declared) {
    const value = fields[key];
    if (value !== undefined) matched[key] = value;
  }
  return matched;
}

/**
 * Move the instance onto `targetId`: park when the target declares a wait, run otherwise (R3).
 *
 * Idempotent by construction: a park already in force at this step is not appended twice, so a crash
 * between the append and the status move is repaired by the next arrival and a repeated arrival is a
 * no-op beyond the status move.
 */
export function arriveAt(store: Store, instance: Instance, flow: OpenedFlow, targetId: string, at: string): Instance {
  const target = flow.config.nodes.find((node) => node.id === targetId);
  if (target === undefined) {
    throw fail("CONFIG_INVALID", "arrival names a node that is not in the flow: " + JSON.stringify(targetId), {
      instance: instance.id,
      step: targetId,
    });
  }
  const wait = target.wait;
  if (wait === undefined) {
    return setStatus(store, instance.id, { status: "running", currentStep: targetId }, instance.revision);
  }
  const pending = parkInForce(store, instance.id);
  if (pending === undefined || pending.payload.step !== targetId) {
    const deadline = deadlineOf(at, wait.timeoutMs);
    appendEvent(store, instance.id, {
      type: EVENT.instanceParked,
      payload: {
        step: targetId,
        eventType: wait.on.type,
        ...(wait.on.match === undefined ? {} : { match: wait.on.match }),
        ...(deadline === undefined ? {} : { deadline }),
      },
      at,
    });
  }
  return setStatus(store, instance.id, { status: "waiting", currentStep: targetId }, instance.revision);
}

/** The event type a parked instance is waiting for, for the bounded result (R10). */
export function waitTypeOf(flow: OpenedFlow, instance: Instance): string | undefined {
  return flow.config.nodes.find((node) => node.id === instance.currentStep)?.wait?.on.type;
}

/**
 * Resume a parked instance with ONE outside event (R5). Order, and every refusal before any write:
 * authority -> status -> park in force -> deadline (lazy, terminal) -> predicate -> receipt dedupe ->
 * receipt + `running` at the SAME step.
 */
export function resume(options: ResumeOptions): Resumed {
  return withStore(options, (store, storeDir) => {
    const instance = loadInstance(store, options.instance);
    assertObserver(store, instance, options.actor);
    const at = stamp(options);
    if (instance.status !== "waiting") {
      throw fail("INSTANCE_STATE_INVALID", "instance " + instance.id + " is " + instance.status + ", not waiting", {
        instance: instance.id,
        status: instance.status,
        step: instance.currentStep,
      });
    }
    const flow = loadPinnedFlow(store, instance);
    const park = parkInForce(store, instance.id);
    if (park === undefined) {
      throw fail("INSTANCE_STATE_INVALID", "instance " + instance.id + " is waiting with no park in force", {
        instance: instance.id,
        step: instance.currentStep,
      });
    }
    const deadline = park.payload.deadline;
    if (typeof deadline === "string" && Date.parse(at) > Date.parse(deadline)) {
      const reason = "the wait at " + JSON.stringify(park.payload.step) + " passed its deadline";
      appendEvent(store, instance.id, {
        type: EVENT.instanceFailed,
        payload: { step: park.payload.step, reason, code: "WAIT_TIMEOUT", deadline },
        at,
      });
      setStatus(store, instance.id, { status: "failed", currentStep: instance.currentStep }, instance.revision);
      throw fail("WAIT_TIMEOUT", reason, { instance: instance.id, step: park.payload.step, deadline, now: at });
    }
    if (!matchEvent({ type: park.payload.eventType, ...(park.payload.match === undefined ? {} : { match: park.payload.match }) }, options.event)) {
      throw fail("WAIT_EVENT_INVALID", "the event does not satisfy the park at " + JSON.stringify(park.payload.step), {
        instance: instance.id,
        step: park.payload.step,
        expected: { type: park.payload.eventType, ...(park.payload.match === undefined ? {} : { match: park.payload.match }) },
        received: { type: options.event.type, fields: Object.keys(options.event.fields ?? {}) },
      });
    }
    const eventDigest = digest(canonicalBytes({ type: options.event.type, fields: options.event.fields ?? {} }));
    const already = listEvents(store, instance.id).some((event) => {
      if (event.type !== EVENT.waitResumed) return false;
      const payload = payloadOf(event.payload);
      return payload.parkSeq === park.seq && payload.eventDigest === eventDigest;
    });
    if (already) {
      const acceptedNow = acceptedRefs(store, instance.id);
      return {
        instance,
        result: buildResult(instance, acceptedNow, waitTypeOf(flow, instance)),
        flow,
        handoffs: currentHandoffs(flow, instance, acceptedNow),
      };
    }
    const matched = matchedFields(park, options.event);
    appendEvent(store, instance.id, {
      type: EVENT.waitResumed,
      payload: {
        step: park.payload.step,
        parkSeq: park.seq,
        eventType: options.event.type,
        eventDigest,
        ...(matched === undefined ? {} : { matched }),
      },
      at,
    });
    const moved = setStatus(store, instance.id, { status: "running", currentStep: String(park.payload.step) }, instance.revision);
    const acceptedNow = acceptedRefs(store, instance.id);
    snapshotActive(moved, flow, storeDir, at);
    return {
      instance: moved,
      result: buildResult(moved, acceptedNow, waitTypeOf(flow, moved)),
      flow,
      handoffs: currentHandoffs(flow, moved, acceptedNow),
    };
  });
}
