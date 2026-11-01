/**
 * The project's own configuration (`.pi/praxis/config.json`): defaults that belong to the project
 * rather than to one flow document. A separate owner module for a small shape, exactly as
 * `issue.ts` owns the issue block, so the flow contract is not quietly widened.
 *
 * Precedence for every default it carries: the task's own declaration wins, then the flow's, then
 * this project default, then the constant in code.
 */
import { z } from "zod";

/** The project-wide defaults a task or flow may still override. */
export const ProjectDefaultsSchema = z.strictObject({
  /**
   * How many refused attempts a step may make before its onFailure policy applies, when neither
   * the task nor the flow declares one. A resource bound the project tunes; never a prompt.
   */
  maxAttempts: z.int().min(1).max(50).optional(),
  /**
   * Where this project keeps its Praxis store, relative to the project root when it is relative.
   * Sits BETWEEN the environment and the built-in default: `PRAXIS_STORE_DIR` still wins, so a
   * checkout can be pointed at another store without editing the committed config.
   */
  storeDir: z.string().min(1).optional(),
  /**
   * The role seat this project claims when PRAXIS_ROLE is unset: an id under profile/role/<id>.json.
   * Advisory text only - it grants nothing, and gate #3 (trusted identity) stays open: whoever can edit
   * this file can claim a seat.
   */
  role: z.string().min(1).optional(),
});
export type ProjectDefaults = z.infer<typeof ProjectDefaultsSchema>;

/** One project config document: the schema id plus its defaults. Strict, so a typo is refused. */
export const ProjectConfigSchema = z.strictObject({
  schema: z.literal("praxis.project/v1"),
  defaults: ProjectDefaultsSchema.optional(),
});
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
