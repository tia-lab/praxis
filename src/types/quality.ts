/**
 * The quality rubric a task declares and is judged against: probes, dimensions, the floor.
 *
 * Moved out of `schema.ts` unchanged (file cap, AGENTS.md 3): the rubric definitions are the one
 * owner of "what good means" for a task, and everything that judges or records a judgment imports
 * them from here. `schema.ts` re-exports every name below, so existing importers do not move.
 * No behaviour, no shape change.
 */
import { z } from "zod";

/** A decomposed quality rubric a task is judged against (the quality floor). */
/**
 * A task section id: the same kebab form as a probe id, so a criterion's targeting and a task's
 * `requires` clauses share ONE rule (T1). Declared here because the rubric is what points at them.
 */
export const SectionNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, "expected a lower-case kebab section id");
export type SectionName = z.infer<typeof SectionNameSchema>;

/**
 * One jev probe: an independent, calibrated question whose answer helps explain why a dimension
 * scored what it scored (verdict-rationale D4). Phrased POSITIVELY for `noul` (the probability that
 * the property holds), `choice` names its options and says which one is the satisfied answer,
 * `score` lists its ordered levels worst-first. A dimension without probes has no structured why.
 */
export const ProbeSchema = z
  .strictObject({
    id: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, "expected a lower-case kebab probe id"),
    type: z.enum(["choice", "noul", "score"]),
    instructions: z.string().min(1).max(500),
    /** `choice`: 2-8 named options (the answer is one key). `score`: 2-10 ordered levels, worst first. */
    criteria: z
      .union([
        z.record(z.string().min(1).max(64), z.string().min(1).max(200)),
        z.array(z.string().min(1).max(200)),
      ])
      .optional(),
    /** `choice` only: the option key that counts as satisfied (the clean answer). */
    clean: z.string().min(1).max(64).optional(),
    /**
     * The artifact sections this criterion judges (T1, R3). Absent means it judges the WHOLE
     * artifact, which is exactly today's behaviour. A declared id must name a section the task
     * requires; the task schema refuses anything else (R4), so a target can never judge nothing.
     */
    sections: z.array(SectionNameSchema).min(1).max(6).optional(),
  })
  .superRefine((probe, ctx) => {
    const issue = (path: string, message: string): void => {
      ctx.addIssue({ code: "custom", path: [path], message });
    };
    // Targeting is checked for every probe type, before the per-type shape rules (T1, R3).
    if (probe.sections !== undefined) {
      const seen = new Set<string>();
      for (const section of probe.sections) {
        if (seen.has(section)) issue("sections", "duplicate section " + JSON.stringify(section));
        seen.add(section);
      }
    }
    if (probe.type === "noul") {
      if (probe.criteria !== undefined) issue("criteria", "a noul probe carries no criteria");
      if (probe.clean !== undefined) issue("clean", "a noul probe has no clean option");
      return;
    }
    if (probe.type === "choice") {
      if (probe.criteria === undefined || Array.isArray(probe.criteria)) {
        issue("criteria", "a choice probe needs a criteria map of named options");
        return;
      }
      const options = Object.keys(probe.criteria);
      if (options.length < 2 || options.length > 8) issue("criteria", "a choice probe needs 2-8 options");
      if (probe.clean === undefined) issue("clean", "a choice probe must name its clean option");
      else if (!options.includes(probe.clean)) issue("clean", "the clean option must be one of the criteria keys");
      return;
    }
    if (!Array.isArray(probe.criteria)) {
      issue("criteria", "a score probe needs 2-10 ordered levels");
      return;
    }
    if (probe.criteria.length < 2 || probe.criteria.length > 10) issue("criteria", "a score probe needs 2-10 levels");
    if (probe.clean !== undefined) issue("clean", "a score probe is clean at its top level, not by name");
  });
export type Probe = z.infer<typeof ProbeSchema>;

/** How many probes one dimension may declare (allowed by parse, not by hope). */
export const PROBES_PER_DIMENSION = 6;
/** How many probes a whole rubric may declare: 8 dimensions x 6, far under pi-jev's 128-question limit. */
export const PROBES_TOTAL = 48;

export const QualityDimensionSchema = z.strictObject({
  id: z.string().min(1).max(64),
  statement: z.string().min(1).max(500),
  /**
   * This dimension's composed jev battery: the probes that diagnose WHY it scored what it scored
   * (verdict-rationale D1). Optional: a dimension without probes simply has no structured why.
   */
  probes: z.array(ProbeSchema).min(1).max(PROBES_PER_DIMENSION).optional(),
  /**
   * Which RANK of the population this dimension gates at (A2): an integer percentile, 1-99, default
   * 25. It selects strictness only - it cannot express an absolute value, so it cannot reintroduce
   * an unreachable bar. Recorded on every raise, so the setting is always visible.
   */
  quantileGate: z.int().min(1).max(99).optional(),
  /**
   * @deprecated since quantile-bars: the bar is MEASURED (a quantile of the carried population,
   * floored at 0.5), so an authored floor sets nothing. Parsed and ignored, kept so existing task
   * documents and pins still load; removed from the shipped documents in the data slice.
   */
  floor: z.number().min(0).max(1).optional(),
});
export const QualitySchema = z.strictObject({
  dimensions: z.array(QualityDimensionSchema).min(1).max(8),
  /**
   * @deprecated since quantile-bars: there is no global bar and no mean bar. Parsed and ignored,
   * kept so existing documents and pins still load.
   */
  threshold: z.number().min(0).max(1).default(0.5),
  policy: z.enum(["required", "advisory"]),
  /**
   * How many refused attempts one step may make before the onFailure policy applies (quality
   * loop). Absent means the code default of 3; a task may override the flow default. Part of the
   * declared floor, so it is inside the rubric digest and the pin.
   */
  maxAttempts: z.int().min(1).max(50).optional(),
  /**
   * What happens when a step cannot reach its floor within the budget: `escalate` halts the
   * instance in `failed` and records a needs-guidance signal; `continue` carries the
   * best-scoring attempt forward with the failure on the record. Absent means `continue`.
   */
  onFailure: z.enum(["escalate", "continue"]).optional(),
  /**
   * The Pareto / good-enough point: above it the gate stops tightening. Acceptance compares every
   * dimension and the mean against `min(bar, paretoThreshold)`, so the adaptive ratchet may record a
   * higher bar without refusing a run that is already good enough. Absent means the code default of
   * 0.8 (the old default). Part of the declared floor, so it is inside the rubric digest
   * and the pin; the ratchet itself is unaffected.
   */
  /**
   * @deprecated since quantile-bars: the Pareto cap is gone (F1) - a measured bar cannot exceed the
   * level live work reaches. Parsed and ignored.
   */
  paretoThreshold: z.number().min(0).max(1).optional(),
}).superRefine((quality, ctx) => {
  // A rubric's probe batteries must be answerable in ONE jev request (spec D4): unique probe ids per
  // dimension, and at most PROBES_TOTAL across the rubric — so a VALID task can never overflow pi-jev's
  // own limits at runtime.
  let total = 0;
  for (const dimension of quality.dimensions) {
    const probes = dimension.probes ?? [];
    total += probes.length;
    const seen = new Set<string>();
    for (const probe of probes) {
      if (seen.has(probe.id)) {
        ctx.addIssue({ code: "custom", path: ["dimensions", dimension.id, "probes"], message: "duplicate probe id " + JSON.stringify(probe.id) });
      }
      seen.add(probe.id);
    }
  }
  if (total > PROBES_TOTAL) {
    ctx.addIssue({ code: "custom", path: ["dimensions"], message: "at most " + PROBES_TOTAL + " probes per rubric, found " + total });
  }
});
export type Quality = z.infer<typeof QualitySchema>;
