/**
 * Issue-reporting config and templates (mirrors manifold's `src/types/issue.ts`, narrowed).
 *
 * One strict block decides whether a project may file reports and where they land; one
 * ordered template per category fixes what a report must answer. The lists here are data,
 * so the runner validates against the same fields the template renders.
 */
import { z } from "zod";

export const ISSUE_CATEGORIES = ["bug", "ergonomics", "docs", "workflow", "feature"] as const;
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

/**
 * The optional project block. Absent or `active:false` disables reporting entirely.
 * An active block needs an absolute directory; the categories, when given, must be a
 * unique subset of the closed registry.
 */
export const IssueConfigSchema = z
  .strictObject({
    active: z.boolean(),
    path: z.string().min(1).max(4096).optional(),
    categories: z.array(z.enum(ISSUE_CATEGORIES)).min(1).max(5).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.active && value.path === undefined) {
      ctx.addIssue({ code: "custom", path: ["path"], message: "an active issue block requires path" });
    }
    if (value.path !== undefined && !value.path.startsWith("/")) {
      ctx.addIssue({ code: "custom", path: ["path"], message: "the issue path must be an absolute directory" });
    }
    if (value.categories !== undefined && new Set(value.categories).size !== value.categories.length) {
      ctx.addIssue({ code: "custom", path: ["categories"], message: "issue categories must be unique" });
    }
  });
export type IssueConfig = z.infer<typeof IssueConfigSchema>;

/** Fields every report needs, whatever its category. */
export const ISSUE_COMMON_FIELDS = ["title", "summary", "severity", "affected", "evidence"] as const;

/** The per-category fields, in the order a report should answer them. */
export const ISSUE_CATEGORY_FIELDS: Record<IssueCategory, readonly string[]> = {
  bug: ["steps", "expected", "actual", "reproducibility"],
  ergonomics: ["attempted", "friction", "wouldHaveHelped", "frequency"],
  docs: ["location", "currentText", "whyMisleading", "proposedText"],
  workflow: ["currentFlow", "breakingPoint", "proposedChange", "risk"],
  feature: ["problem", "proposal", "alternatives", "impact", "acceptanceIdea"],
};

/** One row of a template: the field name and whether a report must carry it. */
export interface IssueField {
  readonly name: string;
  readonly required: boolean;
}

/** The ordered field list for one category: common fields first, then its own. */
export interface IssueTemplate {
  readonly category: IssueCategory;
  readonly fields: readonly IssueField[];
}

export function issueTemplate(category: IssueCategory): IssueTemplate {
  const names = [...ISSUE_COMMON_FIELDS, ...ISSUE_CATEGORY_FIELDS[category]];
  return { category, fields: names.map((name) => ({ name, required: true })) };
}
