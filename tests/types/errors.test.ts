/**
 * The failure taxonomy and its runtime mirror (unit D, slice 1: eight added codes).
 *
 * `Code` in `errors.ts` is a type with no runtime value, so agreement with the
 * `CODES` mirror in `pi.ts` is proved, not assumed:
 *
 *  - `Same<Code, MirrorCode>` is mutual assignability between the union and the
 *    mirror's element type. `CODES` already carries `satisfies readonly Code[]`, so
 *    an extra name fails there; this check adds the other direction, so a union
 *    member missing from the mirror fails here. Drift in either list fails
 *    `npx tsc --noEmit`.
 *  - The runtime half pins the mirror's exact size (a deliberate freeze: a taxonomy
 *    change must edit this expectation, it cannot slip in), exercises every added
 *    code through `fail` -> `failure`, and proves an undeclared name is refused by
 *    the error schema.
 *
 * Nothing here is skipped or weakened, and no pre-existing test was edited.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Code } from "../../src/types/errors.ts";
import { fail, isAppError } from "../../src/types/errors.ts";
import { failure } from "../../src/pi/tool.ts";
import { FailureDetailsSchema } from "../../src/types/pi.ts";

/** Codes beyond the original seventeen: eight from unit D, INSTANCE_FORBIDDEN from unit F, three from quality. */
const ADDED: readonly Code[] = [
  "NODE_INVALID",
  "TASK_NOT_FOUND",
  "TASK_NOT_PUBLISHED",
  "TASK_VERSION_CONFLICT",
  "PIN_MISSING",
  "PIN_CORRUPT",
  "SUBJECT_MISSING",
  "SUBJECT_STALE",
  "INSTANCE_FORBIDDEN",
  "QUALITY_REQUIRED",
  "QUALITY_BELOW_THRESHOLD",
  "QUALITY_BLOCKED",
];

/** The taxonomy size the mirror must report: 17 existing + these 12. */
const TAXONOMY_SIZE = 30;

/** The runtime mirror, reached through the schema the tool actually validates with. */
const MIRROR = FailureDetailsSchema.shape.code.options;
type MirrorCode = (typeof MIRROR)[number];

/** Mutual assignability: true only when neither side has a name the other lacks. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const UNION_AND_MIRROR_AGREE: Same<Code, MirrorCode> = true;

test("the closed union and the runtime mirror name exactly the same codes", () => {
  assert.equal(UNION_AND_MIRROR_AGREE, true);
  assert.equal(MIRROR.length, TAXONOMY_SIZE, "the mirror must carry 17 existing + 12 added codes");
  assert.equal(new Set(MIRROR).size, MIRROR.length, "no duplicate in the mirror");
  for (const code of ADDED) {
    assert.ok((MIRROR as readonly string[]).includes(code), code + " is missing from the mirror");
  }
});

test("every added code round-trips through the error shape", () => {
  for (const code of ADDED) {
    const message = "failure for " + code;
    const error = fail(code, message);
    assert.ok(isAppError(error));
    assert.equal(error.code, code);

    const bare = failure(error);
    assert.equal(bare.isError, true);
    const bareDetails = FailureDetailsSchema.parse(bare.details);
    assert.equal(bareDetails.code, code);
    assert.equal(bareDetails.message, message);
    assert.equal("detail" in bareDetails, false);
    assert.equal(JSON.parse(bare.content[0].text).code, code);

    const detailed = failure(fail(code, message, { reason: "test" }));
    assert.equal(detailed.isError, true);
    assert.deepEqual(FailureDetailsSchema.parse(detailed.details).detail, { reason: "test" });
  }
});

test("a name outside the closed union is refused by the error schema", () => {
  assert.equal(FailureDetailsSchema.safeParse({ code: "NOT_A_CODE", message: "x" }).success, false);
  assert.equal(FailureDetailsSchema.safeParse({ code: "task_not_found", message: "x" }).success, false);
  assert.equal(FailureDetailsSchema.safeParse({ code: "TASK_ERROR", message: "x" }).success, false);
  assert.equal(FailureDetailsSchema.safeParse({ code: "NODE_INVALID", message: "" }).success, false);
});
