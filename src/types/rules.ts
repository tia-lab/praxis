/**
 * The rules atom: a reusable, file-owned set of named one-line rules, referenced by a task and — when an
 * author cites one — composed into a criterion's question at resolve time.
 *
 * The file owns what a rule says; a task owns which sets apply to it; a probe owns which rule it judges.
 * Nothing here is enforced: the gate, the bars and the verdict never read a rule (spec R8), and the rule text
 * is never stored except as the pinned bytes of the file it came from.
 *
 * Deliberately absent: severity, tags, applies-to selectors, enabled flags, enforcement actions and links.
 * Each would be a second way to say what the statement already says, and no present consumer needs one.
 */
import { z } from "zod";
import { KEBAB, pathUnder } from "./paths.ts";

/** One line of guidance, not an essay: the statement's bound. */
export const RULE_STATEMENT_MAX = 280;
/** How many rules one file may declare. */
export const RULES_PER_SET_MAX = 32;
/** How many sets one task may reference. */
export const RULE_REFS_PER_TASK_MAX = 8;
/** How many rules one task's brief may carry after expansion. */
export const RULES_PER_TASK_MAX = 16;
/** The composed instruction's bound: the `ProbeSchema.instructions` limit, enforced at resolve. */
export const COMPOSED_INSTRUCTION_MAX = 500;

/** A rule's id inside its set: lower-case kebab, the same segment rule every identity uses. */
export const RuleIdSchema = z.string().regex(KEBAB, "expected a lower-case kebab rule id");
export type RuleId = z.infer<typeof RuleIdSchema>;

/** A rule-set file, as a path under `rules/`: `rules/engineering`, `rules/core/verification`. */
export const RulesetRefSchema = pathUnder("rules");
export type RulesetRef = z.infer<typeof RulesetRefSchema>;

/** One rule: an identity and the one-line statement the agent is shown. */
export const RuleSchema = z.strictObject({
  id: RuleIdSchema,
  statement: z.string().min(1).max(RULE_STATEMENT_MAX),
});
export type Rule = z.infer<typeof RuleSchema>;

/**
 * One rule-set document. `id` must equal the last path segment of the file (the loader enforces it, exactly as
 * `loadTask` does), and ids within a set are unique: a duplicate would make a citation ambiguous.
 */
export const RuleSetSchema = z
  .strictObject({
    id: z.string().regex(KEBAB, "expected a lower-case kebab set id"),
    version: z.int().min(1),
    rules: z.array(RuleSchema).min(1).max(RULES_PER_SET_MAX),
  })
  .superRefine((set, ctx) => {
    const seen = new Set<string>();
    for (const rule of set.rules) {
      if (seen.has(rule.id)) {
        ctx.addIssue({ code: "custom", path: ["rules", rule.id], message: "duplicate rule id" });
      }
      seen.add(rule.id);
    }
  });
export type RuleSet = z.infer<typeof RuleSetSchema>;

/** One task reference: a whole file, optionally narrowed to named ids. */
export const RuleRefSchema = z.strictObject({
  set: RulesetRefSchema,
  /** Named ids only; absent means every rule in the file. */
  rules: z.array(RuleIdSchema).min(1).max(RULES_PER_TASK_MAX).optional(),
});
export type RuleRef = z.infer<typeof RuleRefSchema>;

/**
 * A task's refs, in declared order. Two refs to one set would make the order ambiguous, so that is refused at
 * parse: the expansion is refs in declared order, and the set's own document order inside each ref.
 */
export const TaskRulesSchema = z
  .array(RuleRefSchema)
  .min(1)
  .max(RULE_REFS_PER_TASK_MAX)
  .superRefine((refs, ctx) => {
    const seen = new Set<string>();
    for (const ref of refs) {
      if (seen.has(ref.set)) {
        ctx.addIssue({ code: "custom", message: "set " + JSON.stringify(ref.set) + " is referenced twice" });
      }
      seen.add(ref.set);
    }
  });
export type TaskRules = z.infer<typeof TaskRulesSchema>;

/**
 * One resolved rule: a projection in memory, never persisted. It names the set, its version and digest (so a
 * brief can say which bytes it came from) and the rule itself.
 */
export interface ResolvedRule {
  set: string;
  version: number;
  setDigest: string;
  id: string;
  statement: string;
}
