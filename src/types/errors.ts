/**
 * The only error module in the slice (spec R13).
 *
 * Every failure is an AppError: one closed typed code, a message and an optional
 * detail. Nothing throws a bare string; a caught unknown value is converted
 * through `asAppError` so a caller can always branch on `code`.
 */

/**
 * Closed failure taxonomy. `CONFIG_INVALID` covers a malformed document, request or
 * identifier: the input-contract failure, distinct from a missing row.
 * `FLOW_INVALID` is a flow declaration that cannot load or resolve and
 * `GATE_REJECTED` is the deterministic gate refusing an artifact.
 * `NODE_INVALID` is a flow node beyond its two declared keys, `TASK_*` is a task
 * unit that is absent, unpublished or version-conflicting, `PIN_*` is an instance
 * whose pinned definition is missing or corrupt, and `SUBJECT_*` is a review whose
 * judged subject is absent or no longer the accepted version. `QUALITY_*` is the
 * typed judgment over an artifact: a missing score, a score below the floor, and the
 * escalation when a step exhausts its attempt budget or stops improving.
 */
export type Code =
  | "CONFIG_INVALID"
  | "FLOW_INVALID"
  | "REQUEST_CONFLICT"
  | "INSTANCE_NOT_FOUND"
  | "INSTANCE_FORBIDDEN"
  | "INSTANCE_STATE_INVALID"
  | "REVISION_CONFLICT"
  | "CANONICAL_INVALID"
  | "ARTIFACT_INVALID"
  | "ARTIFACT_UNAVAILABLE"
  | "ARTIFACT_DIGEST_MISMATCH"
  | "ARTIFACT_STATE_INVALID"
  | "ARTIFACT_VERSION_CONFLICT"
  | "NODE_INVALID"
  | "TASK_NOT_FOUND"
  | "RULE_NOT_FOUND"
  | "PROFILE_NOT_FOUND"
  | "PROFILE_INVALID"
  | "TASK_NOT_PUBLISHED"
  | "TASK_VERSION_CONFLICT"
  | "PIN_MISSING"
  | "PIN_CORRUPT"
  | "SUBJECT_MISSING"
  | "SUBJECT_STALE"
  | "CAPABILITY_DENIED"
  | "GATE_REJECTED"
  | "QUALITY_REQUIRED"
  | "QUALITY_BELOW_THRESHOLD"
  | "QUALITY_BLOCKED"
  /** The order does not belong to the task the pinned flow will run (routing hygiene, not safety). */
  | "ALIGNMENT_REJECTED"
  /** A `before_` hook refused the op (composition seam inside the ceiling; write-free). */
  | "HOOK_VETOED"
  | "RESULT_INVALID"
  | "STORE_INVALID"
  | "INTERNAL";

export class AppError extends Error {
  readonly code: Code;
  readonly detail?: unknown;

  constructor(code: Code, message: string, detail?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

/** Construct, do not throw: the caller decides where the failure surfaces. */
export function fail(code: Code, message: string, detail?: unknown): AppError {
  return new AppError(code, message, detail);
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/**
 * Convert any caught value into a typed AppError. An AppError passes through
 * untouched; anything else becomes INTERNAL carrying the original detail.
 */
export function asAppError(value: unknown): AppError {
  if (isAppError(value)) return value;
  if (value instanceof Error) {
    return fail("INTERNAL", value.message, { name: value.name, stack: value.stack ?? null });
  }
  return fail("INTERNAL", `unexpected non-error failure: ${typeof value}`, { value });
}
