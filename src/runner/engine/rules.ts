/**
 * Rule resolution (task-rules, S2).
 *
 * Two loaders feed one shape: `openFlow` reads a rule-set from the library, `loadPinnedFlow` reads it back
 * from the instance's own `ruleset` definition rows. `resolveRules` expands a task's refs in declared order
 * and `withRuleText` composes a cited rule into the criterion's question.
 *
 * WHAT THIS MODULE DOES NOT DECIDE: which quality is the judge's and which is the ruler's. Editing a cited
 * rule's statement must change the JUDGE's question without re-keying a dimension or re-warming a bar, so the
 * composition belongs to the judge path only; the identity path reads the authored rubric. That split is the
 * amended spec's (R9'), and this module stays silent on it: it returns a COMPOSED quality and never touches
 * `dimensionKey`, the bars or `rulerDigest`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fail, type AppError } from "../../types/errors.ts";
import { parseWith, type TaskConfig } from "../../types/schema.ts";
import type { Quality } from "../../types/quality.ts";
import {
  COMPOSED_INSTRUCTION_MAX,
  RULES_PER_TASK_MAX,
  RuleSetSchema,
  type ResolvedRule,
  type RuleSet,
} from "../../types/rules.ts";
import { digest } from "../canonical.ts";
import { messageOf } from "./support.ts";
import type { OpenedFlow } from "./types.ts";

/** One rule-set as read (library) or as pinned (instance): the document, its exact bytes and the digest. */
export interface PinnedRuleSet {
  /** The reference it answers, e.g. `rules/engineering`. */
  readonly path: string;
  readonly doc: RuleSet;
  /** The exact bytes read (library) or pinned (instance). */
  readonly bytes: Uint8Array;
  /** `digest(bytes)`: the value `start` pins, so a later read can prove nothing moved. */
  readonly digest: string;
}

/** The key a citation is looked up by: one set, one id. */
const keyOf = (set: string, id: string): string => set + "\u0000" + id;

/**
 * Read one rule-set from the library: the file at `<rulesDir>/<path>.json`, parsed, with `id` equal to its
 * last path segment (exactly what `loadTask` requires). A missing file is `RULE_NOT_FOUND`; bad bytes, a bad
 * shape or a mismatched id is `CONFIG_INVALID`. Every refusal fires before anything is written.
 */
export function loadRuleSet(rulesDir: string, ref: string): PinnedRuleSet {
  const relative = ref.slice("rules/".length);
  const path = join(rulesDir, relative + ".json");
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    throw fail("RULE_NOT_FOUND", "rule-set " + ref + " is not readable", {
      reason: "set-missing",
      set: ref,
      path,
      cause: messageOf(error),
    });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch (error) {
    throw fail("CONFIG_INVALID", "rule-set " + ref + " is not JSON", { set: ref, path, reason: messageOf(error) });
  }
  const doc = parseWith(RuleSetSchema, raw, "CONFIG_INVALID", "rule-set " + ref);
  const name = relative.slice(relative.lastIndexOf("/") + 1);
  if (doc.id !== name) {
    throw fail("CONFIG_INVALID", "rule-set " + ref + " declares a different identity", { set: ref, id: doc.id, path });
  }
  return { path: ref, doc, bytes, digest: digest(bytes) };
}

/**
 * Expand a task's refs into rules, in the order spec §4 fixes: refs in DECLARED order, and inside one ref the
 * rule-set's own DOCUMENT order, filtered by the cited ids. An author cannot reorder the expansion by
 * reordering ids.
 *
 * Refusals: a ref with no resolved set, an id the set does not declare, a citation no ref covers
 * (`RULE_NOT_FOUND`), and an expansion over `RULES_PER_TASK_MAX` (`CONFIG_INVALID`).
 */
export function resolveRules(task: TaskConfig, sets: ReadonlyMap<string, PinnedRuleSet>): ResolvedRule[] {
  const refs = task.rules ?? [];
  // NO early return: a task with no refs still gets the citation check below, because a probe may cite a
  // rule its task does not reference - that is a refusal, not an empty expansion.
  const resolved: ResolvedRule[] = [];
  const covered = new Set<string>();
  for (const ref of refs) {
    const set = sets.get(ref.set);
    if (set === undefined) {
      throw fail("RULE_NOT_FOUND", "rule-set " + ref.set + " is not resolved for this flow", {
        reason: "set-missing",
        set: ref.set,
      });
    }
    const wanted = ref.rules === undefined ? undefined : new Set(ref.rules);
    if (wanted !== undefined) {
      for (const id of wanted) {
        if (set.doc.rules.some((rule) => rule.id === id)) continue;
        throw fail("RULE_NOT_FOUND", "rule " + id + " is not declared by " + ref.set, {
          reason: "rule-missing",
          set: ref.set,
          rule: id,
        });
      }
    }
    for (const rule of set.doc.rules) {
      if (wanted !== undefined && !wanted.has(rule.id)) continue;
      covered.add(keyOf(ref.set, rule.id));
      resolved.push({ set: ref.set, version: set.doc.version, setDigest: set.digest, id: rule.id, statement: rule.statement });
    }
  }
  if (resolved.length > RULES_PER_TASK_MAX) {
    throw fail("CONFIG_INVALID", "task " + task.id + " expands to more rules than a brief may carry", {
      count: resolved.length,
      max: RULES_PER_TASK_MAX,
    });
  }
  // A citation must be covered by the task's own refs: a probe cannot cite a rule the task does not follow.
  for (const dimension of task.quality?.dimensions ?? []) {
    for (const probe of dimension.probes ?? []) {
      if (probe.rule === undefined) continue;
      if (covered.has(keyOf(probe.rule.set, probe.rule.id))) continue;
      throw fail("RULE_NOT_FOUND", "criterion " + probe.id + " cites a rule its task does not reference", {
        reason: "citation-not-referenced",
        set: probe.rule.set,
        rule: probe.rule.id,
        probe: probe.id,
      });
    }
  }
  return resolved;
}

/**
 * The composed rubric: every citing criterion's question gains `\nRule <id>: <statement>`.
 *
 * This is the JUDGE's rubric and the BRIEF's criterion text - never the ruler's. The identity path
 * (`dimensionKey`, the bars, `rulerDigest`) reads the authored rubric, so editing a cited statement changes
 * what the judge is asked and nothing else (the amended R9').
 *
 * A quality with no rules, or a task that cites none, is returned UNCHANGED (identity, not a copy): a
 * rules-free project is byte-identical to the one before this field existed.
 */
export function withRuleText(quality: Quality | undefined, rules: readonly ResolvedRule[]): Quality | undefined {
  if (quality === undefined || rules.length === 0) return quality;
  const byKey = new Map(rules.map((rule) => [keyOf(rule.set, rule.id), rule]));
  let changed = false;
  const dimensions = quality.dimensions.map((dimension) => {
    const probes = dimension.probes;
    if (probes === undefined) return dimension;
    let touched = false;
    const next = probes.map((probe) => {
      if (probe.rule === undefined) return probe;
      const rule = byKey.get(keyOf(probe.rule.set, probe.rule.id));
      if (rule === undefined) {
        throw fail("RULE_NOT_FOUND", "criterion " + probe.id + " cites an unresolved rule", {
          reason: "citation-not-referenced",
          set: probe.rule.set,
          rule: probe.rule.id,
          probe: probe.id,
        });
      }
      const composed = probe.instructions + "\nRule " + rule.id + ": " + rule.statement;
      if (composed.length > COMPOSED_INSTRUCTION_MAX) {
        throw fail("CONFIG_INVALID", "criterion " + probe.id + " composes to more than " + COMPOSED_INSTRUCTION_MAX + " characters", {
          probe: probe.id,
          length: composed.length,
          max: COMPOSED_INSTRUCTION_MAX,
        });
      }
      touched = true;
      return { ...probe, instructions: composed };
    });
    if (!touched) return dimension;
    changed = true;
    return { ...dimension, probes: next };
  });
  if (!changed) return quality;
  return { ...quality, dimensions };
}

/**
 * IDENTITY: exactly today's expression. The bars, `dimensionKey`, `rulerDigest`, the note gate and the
 * brief's gate read this - never the composed rubric (invariant I6, spec R9').
 */
export function authoredQuality(flow: OpenedFlow, task: TaskConfig): Quality | undefined {
  return task.quality ?? flow.config.quality;
}

/**
 * THE JUDGE'S RUBRIC: authored, plus the statements of the rules its criteria cite. It has exactly TWO
 * consumers - the scorer request and the brief - and nothing that keys an identity may read it.
 */
export function judgeQuality(flow: OpenedFlow, task: TaskConfig): Quality | undefined {
  return withRuleText(authoredQuality(flow, task), resolveRules(task, flow.rules));
}

/** A typed refusal, narrowed for a caller that wants to branch on the code. Not used by the engine. */
export type RuleRefusal = AppError;
