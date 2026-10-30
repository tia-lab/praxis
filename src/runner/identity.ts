/**
 * The identity / role-resolution seam (team relay).
 *
 * This is the ONLY place the role -> authorized-actor assignment is read. Today it reads
 * the map pinned in the instance's own `definition` row at creation (trusted launcher,
 * immutable). A Manifold-backed build replaces this one function's body to return the
 * live assignment instead; every caller in the engine stays unchanged, so plugging
 * Manifold is a one-module swap, exactly like the store driver.
 *
 * The caller identity itself comes from the host session (`actorFor` in the Pi tool),
 * never from a tool argument (R10); this module only answers "who holds each role".
 */
import { isAppError } from "../types/errors.ts";
import { readDefinition } from "../store/definitions.ts";
import type { Store } from "../store/db.ts";
import { RoleAssignmentSchema, parseWith, type Instance } from "../types/schema.ts";

/** The definition id the role map is pinned under (kind "assignment"). */
export const ROLE_DEFINITION_ID = "roles";

/**
 * The role -> actor map for an instance. An instance started without roles has no pinned
 * assignment and resolves to an empty map, so authority falls back to the instance creator.
 */
export function roleAssignment(store: Store, instance: Instance): Record<string, string> {
  let bytes: Uint8Array;
  try {
    bytes = readDefinition(store, instance.id, "assignment", ROLE_DEFINITION_ID).bytes;
  } catch (error) {
    if (isAppError(error) && error.code === "PIN_MISSING") return {};
    throw error;
  }
  const value: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
  return parseWith(RoleAssignmentSchema, value, "PIN_CORRUPT", "pinned role assignment");
}
