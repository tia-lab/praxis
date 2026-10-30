/**
 * Authority checks the engine applies before it reads or writes anything: who may observe an
 * instance, who may submit a step, and the separation-of-duties rule a subject-binding step adds.
 * Routed-call authority only — it is not isolation (gate #1 stays open).
 */
import { fail, type AppError } from "../../types/errors.ts";
import type { Instance, TaskConfig } from "../../types/schema.ts";
import type { Store } from "../../store/db.ts";
import { listEvents } from "../../store/events.ts";
import { roleAssignment } from "../identity.ts";
import { EVENT } from "./types.ts";

/** A typed refusal for a caller acting on an instance role it does not hold (R10). */
function forbidden(instance: Instance, actor: string, what: string): AppError {
  return fail("INSTANCE_FORBIDDEN", "actor may not " + what + " on instance " + JSON.stringify(instance.id), {
    instance: instance.id,
    actor,
  });
}

/** The author recorded for a step: the actor of its accepted artifact, when one is known. */
function stepAuthor(store: Store, instance: Instance, step: string): string | undefined {
  for (const event of listEvents(store, instance.id)) {
    if (event.type !== EVENT.artifactAccepted) continue;
    const payload = event.payload as { step?: string; actor?: string };
    if (payload.step === step && typeof payload.actor === "string") return payload.actor;
  }
  return undefined;
}

/**
 * Observe authority (inspect/read): the instance creator and every assigned role holder
 * may see the instance; an unknown actor is refused. No actor (CLI/internal) skips the check,
 * which keeps the degenerate single-actor case (unit F) and every CLI path unchanged.
 */
export function assertObserver(store: Store, instance: Instance, actor: string | undefined): void {
  if (actor === undefined || actor === instance.actor) return;
  if (Object.values(roleAssignment(store, instance)).includes(actor)) return;
  throw forbidden(instance, actor, "observe");
}

/**
 * Submit authority for one step (R10, team relay): the holder of the step's declared role,
 * or the creator when the step declares none. A subject-binding step additionally refuses
 * the author of the subject it would judge — separation of duties, so no self-review, even
 * if a single actor was (mis)assigned both roles.
 */
export function assertStepActor(
  store: Store,
  instance: Instance,
  task: TaskConfig,
  sources: readonly string[],
  actor: string | undefined,
): void {
  if (actor === undefined) return;
  const assignment = roleAssignment(store, instance);
  if (task.role === undefined) {
    if (actor !== instance.actor) throw forbidden(instance, actor, "submit");
  } else {
    const holder = assignment[task.role];
    if (holder !== actor) throw forbidden(instance, actor, "fill the role " + JSON.stringify(task.role));
  }
  // Separation of duties applies only to team instances (roles pinned); a solo instance,
  // which has no role assignment, legitimately reviews its own work (the shipped behaviour).
  if (task.bindsSubject === true && Object.keys(assignment).length > 0) {
    for (const source of sources) {
      if (stepAuthor(store, instance, source) === actor) {
        throw fail("INSTANCE_FORBIDDEN", "the author of " + JSON.stringify(source) + " may not also judge it", {
          instance: instance.id,
          step: task.id,
          source,
          actor,
        });
      }
    }
  }
}
