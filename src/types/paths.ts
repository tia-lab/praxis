/**
 * The path grammar the three reference kinds share: a root directory, then one or more lower-case kebab
 * segments. Moved out of `schema.ts` unchanged (it is load-bearing there: the file is at 589 lines and the
 * cap is 600) and given a third root, `rules`, so a rule-set reference obeys exactly the rule a task and a
 * flow reference already obey.
 *
 * One owner: a segment means the same thing in `tasks/`, `flows/` and `rules/`, and no path can leave its
 * root (no dot, no `.json`, no absolute form).
 */
import { z } from "zod";

/** The one segment rule every identity uses: lower-case kebab, at most 64 characters. */
export const KEBAB = /^[a-z][a-z0-9-]{0,63}$/;

/** The shared path body: zero-or-more nested kebab segments ending in one name. */
const PATH_SEGMENTS = "([a-z][a-z0-9-]{0,63}/)*[a-z][a-z0-9-]{0,63}";

/** Build the path schema for one root: `tasks/<segments>`, `flows/<segments>` or `rules/<segments>`. */
export function pathUnder(root: "tasks" | "flows" | "rules"): z.ZodString {
  return z.string().regex(new RegExp("^" + root + "/" + PATH_SEGMENTS + "$"), "expected " + root + "/<path>");
}
