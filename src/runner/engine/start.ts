/**
 * Starting an instance: create or re-open the one instance a request id names, pinning the flow and
 * every task version in one transaction. Never forks, never re-pins.
 */
import { fail } from "../../types/errors.ts";
import { RoleAssignmentSchema, parseWith } from "../../types/schema.ts";
import { transact } from "../../store/db.ts";
import { insertInstance } from "../../store/instance.ts";
import { appendEvent } from "../../store/events.ts";
import { insertDefinition, insertPublication, readDefinition } from "../../store/definitions.ts";
import { ROLE_DEFINITION_ID } from "../identity.ts";
import { canonicalBytes, digest } from "../canonical.ts";
import { instanceIdFor, openFlow } from "./flow.ts";
import { loadExisting, nonceFor, stamp, withStore } from "./support.ts";
import { EVENT, type StartOptions, type Started } from "./types.ts";

/** Create or re-open the instance a request id names; never fork (R2), never re-pin (R4). */
/** Keep a recorded order inside its bound; the digest is always taken over the whole text. */
function clipOrder(text: string, limit: number): string {
  return text.length <= limit ? text : text.slice(0, limit - 1) + "\u2026";
}

export function start(options: StartOptions): Started {
  const flow = openFlow(options);
  if (flow.config.flow !== options.flow) {
    throw fail("CONFIG_INVALID", "config declares flow " + JSON.stringify(flow.config.flow), {
      requested: options.flow,
      declared: flow.config.flow,
      path: flow.path,
    });
  }
  const actor = options.actor ?? process.env.PRAXIS_ACTOR ?? "cli";
  const id = instanceIdFor(flow.config.flow, options.requestId);
  const at = stamp(options);
  const first = flow.config.nodes[0];

  return withStore(options, (store, storeDir) => {
    const existing = loadExisting(store, id);
    if (existing !== undefined) {
      const pinned = readDefinition(store, existing.id, "flow", existing.flow).digest;
      if (pinned !== flow.flowDigest || existing.actor !== actor) {
        throw fail(
          "REQUEST_CONFLICT",
          "request " + JSON.stringify(options.requestId) + " was already used with a different payload",
          {
            instance: id,
            pinned: { flowDigest: pinned, actor: existing.actor },
            offered: { flowDigest: flow.flowDigest, actor },
          },
        );
      }
      return { instance: existing, flow, created: false };
    }

    const instance = transact(store, () => {
      const row = insertInstance(store, {
        id,
        flow: flow.config.flow,
        actor,
        status: "running",
        currentStep: first.id,
        nonce: nonceFor(),
        now: at,
      });
      // R4: the flow, every task version and the first publications commit with the row.
      insertDefinition(store, {
        instance: id,
        kind: "flow",
        id: flow.config.flow,
        digest: flow.flowDigest,
        bytes: canonicalBytes(flow.config),
      });
      for (const [ref, task] of flow.tasks) {
        if (task.state !== "published") {
          throw fail("TASK_NOT_PUBLISHED", `task ${ref} is ${task.state}, so it cannot be pinned`, {
            task: ref,
            state: task.state,
          });
        }
        const bytes = canonicalBytes(task);
        const taskDigest = digest(bytes);
        insertDefinition(store, { instance: id, kind: "task", id: ref, digest: taskDigest, bytes });
        // The path, not the label: two nested paths may end in the same id and are two
        // publications. The version is the one the document declares (R3, R5).
        insertPublication(store, { task: ref, version: task.version, digest: taskDigest, at });
      }
      if (options.roles !== undefined && Object.keys(options.roles).length > 0) {
        const roles = parseWith(RoleAssignmentSchema, options.roles, "CONFIG_INVALID", "role assignment");
        const bytes = canonicalBytes(roles);
        insertDefinition(store, { instance: id, kind: "assignment", id: ROLE_DEFINITION_ID, digest: digest(bytes), bytes });
      }
      return row;
    });
    // The event is evidence of creation, not part of the pin set, and `appendEvent` owns
    // its own transaction; the pins and the row above commit together without it.
    appendEvent(store, id, {
      type: EVENT.instanceCreated,
      payload: {
        flow: flow.config.flow,
        requestId: options.requestId,
        actor,
        flowDigest: flow.flowDigest,
        nonce: instance.nonce,
        storeDir,
        // T2: the order the caller was handed, clipped, with a digest of the RAW text. Two meanings
        // stay separate: this digest is the raw order, while `orderDigestOf` digests the gate's
        // normalized form. Absent order -> absent keys -> today's payload byte for byte.
        ...(options.order === undefined
          ? {}
          : { order: clipOrder(options.order, 4000), orderDigest: digest(options.order) }),
      },
      at,
    });
    return { instance, flow, created: true };
  });
}
