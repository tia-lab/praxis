import { createHash } from "node:crypto";

/** The three lines that identify a task, as docs/WORKFLOW.md defines them. */
export interface TaskContract {
  task: string;
  scope: string;
  acceptance: string;
}

/**
 * The canonical block is the hash input: one physical line per field, exactly as
 * written in the spec, with trailing whitespace stripped. Reflowing it changes the
 * hash, which is the point — the folder name is a commitment to the contract.
 */
export function canonicalBlock(contract: TaskContract): string {
  const lines = [
    "task: " + contract.task,
    "scope: " + contract.scope,
    "acceptance: " + contract.acceptance,
  ].map((line) => line.replace(/[ \t]+$/, ""));
  return lines.join("\n") + "\n";
}

/** First 8 hex of sha256(canonicalBlock). */
export function hash8(contract: TaskContract): string {
  return createHash("sha256").update(canonicalBlock(contract), "utf8").digest("hex").slice(0, 8);
}

/** docs/tasks/<slug>-<hash8>: the one folder an authorized unit of work owns. */
export function taskFolder(slug: string, contract: TaskContract): string {
  const clean = slug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  if (clean.length === 0) throw new Error("task slug must contain a letter or digit");
  return "docs/tasks/" + clean + "-" + hash8(contract);
}
