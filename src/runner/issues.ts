/**
 * File-backed issue reporting (mirrors manifold's `src/issues.ts`, one JSON file per report).
 *
 * The configured directory is the source of truth: nothing is cloned, pushed or indexed. A
 * report is accepted only after its JSON is fully written and renamed into place, so a
 * reader never sees half a file. Credentials are screened before anything is written.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fail, type Code } from "../types/errors.ts";
import { ISSUE_CATEGORIES, IssueConfigSchema, issueTemplate } from "../types/issue.ts";
import type { IssueCategory, IssueConfig } from "../types/issue.ts";

/**
 * `ISSUE_DISABLED` is not a member of `Code`; the taxonomy lives in `src/types/errors.ts`,
 * which this assignment may not edit. The code is declared once here and asserted into the
 * union so callers can still branch on `error.code === "ISSUE_DISABLED"`. Reported to lead
 * as a blocker: adding the member to `Code` removes this assertion.
 */
export const ISSUE_DISABLED = "ISSUE_DISABLED" as Code;

/** Who filed the report. A correlation label, not an authenticated identity. */
export interface IssueReporter {
  readonly agent: string;
  readonly role?: string;
}

/** One report: the category plus every field the category's template requires. */
export interface IssueInput {
  readonly category: string;
  readonly [field: string]: unknown;
}

/** Where the report landed and the identifier it can be found by. */
export interface IssueReport {
  readonly file: string;
  readonly id: string;
}

const SECRET = /token|secret|password|api[-_]?key/i;

/**
 * The project's `issue` block, or `undefined` when it declares none.
 * A block that is present but invalid is CONFIG_INVALID, never silently ignored.
 */
export function issueConfigOf(fileConfig: unknown): IssueConfig | undefined {
  if (fileConfig === null || typeof fileConfig !== "object") return undefined;
  const block = (fileConfig as { issue?: unknown }).issue;
  if (block === undefined) return undefined;
  const parsed = IssueConfigSchema.safeParse(block);
  if (!parsed.success) {
    throw fail(
      "CONFIG_INVALID",
      "issue block is invalid",
      parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message })),
    );
  }
  return parsed.data;
}

function categoryOf(config: IssueConfig, value: string): IssueCategory {
  if (!(ISSUE_CATEGORIES as readonly string[]).includes(value)) {
    throw fail("CONFIG_INVALID", "unknown issue category: " + JSON.stringify(value), { known: [...ISSUE_CATEGORIES] });
  }
  const category = value as IssueCategory;
  const enabled = config.categories ?? ISSUE_CATEGORIES;
  if (!(enabled as readonly string[]).includes(category)) {
    throw fail("CONFIG_INVALID", "issue category is not enabled: " + JSON.stringify(category), { enabled: [...enabled] });
  }
  return category;
}

/** Validate one report and write it atomically; a refusal leaves no file behind. */
export function openIssue(config: IssueConfig | undefined, input: IssueInput, reporter: IssueReporter): IssueReport {
  if (config === undefined || !config.active) {
    throw fail(ISSUE_DISABLED, "issue reporting is not enabled for this project", { active: config?.active ?? false });
  }
  const directory = config.path;
  if (directory === undefined || !directory.startsWith("/")) {
    throw fail("CONFIG_INVALID", "the issue path must be an absolute directory", { path: directory ?? null });
  }
  const category = categoryOf(config, input.category);
  const fields: Record<string, string> = {};
  for (const field of issueTemplate(category).fields) {
    const raw = input[field.name];
    if (typeof raw !== "string" || raw.trim() === "") {
      throw fail("CONFIG_INVALID", "missing required issue field: " + field.name, { category, field: field.name });
    }
    const value = raw.trim();
    if (SECRET.test(value)) {
      throw fail("CONFIG_INVALID", "possible credential in the report; redact it before reporting", { field: field.name });
    }
    fields[field.name] = value;
  }

  const id = "ISS-" + category + "-" + randomBytes(3).toString("hex");
  const file = join(directory, id + ".json");
  const record = {
    schemaVersion: 1,
    id,
    category,
    fields,
    reporter: reporter.role === undefined ? { agent: reporter.agent } : { agent: reporter.agent, role: reporter.role },
    at: new Date().toISOString(),
  };
  const temporary = file + "." + process.pid + "." + randomBytes(3).toString("hex") + ".tmp";
  try {
    mkdirSync(directory, { recursive: true });
    writeFileSync(temporary, JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
    renameSync(temporary, file);
  } catch (error) {
    try {
      rmSync(temporary, { force: true });
    } catch {
      // Best effort: a stray temporary file never becomes a report.
    }
    throw fail("STORE_INVALID", "could not write the issue report", {
      file,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  return { file, id };
}
