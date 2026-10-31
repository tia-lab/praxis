/**
 * The rubric sampler (S3, R20-R22, R24).
 *
 * A bar may not ratchet on a rubric identity nobody has sampled (D11). Before a scope's FIRST raise
 * under an identity, the same frozen accepted artifact is re-judged `SAMPLE_REPEATS` times with the
 * composed request, and the per-criterion agreement decides whether the identity is stable enough to
 * raise on. An unstable or missing sample HOLDS the raise; it never refuses a step.
 *
 * The jev call happens HERE, at the awaiting boundary — never inside a store transaction (D12, R24):
 * the due check opens the store and closes it, the three judgments run outside it, and the recorded
 * `rubric.sampled` event is written by a second, short store call. A caller that never samples never
 * raises (fail-safe), which is exactly what a CLI-only run does.
 */
import { readArtifact } from "../store/artifacts.ts";
import { appendEvent } from "../store/events.ts";
import { withStore } from "../runner/engine/support.ts";
import { EVENT, SAMPLE_AGREEMENT_MIN, SAMPLE_RANGE_MAX, SAMPLE_REPEATS } from "../runner/engine/types.ts";
import type { EngineOptions } from "../runner/engine/types.ts";
import type { RubricSampled, SampleAgreement } from "../types/learning.ts";
import type { Probe, Quality } from "../types/quality.ts";
import { compositionKey, unsampledDueScopes } from "./bar.ts";
import type { Scorer } from "./evaluate.ts";

/** The criterion id a criteria-less dimension's statement is sampled under. */
const STATEMENT = "__statement";

/** What one sampling run found: the repeats it took, and each criterion's agreement. */
export interface SampledRun {
  repeats: number;
  criteria: SampleAgreement[];
  stable: boolean;
}

/**
 * One criterion's agreement across repeats (R21). A `choice` agrees when the modal key recurs at
 * least SAMPLE_AGREEMENT_MIN of the time; a `noul`/`score` agrees when the RANGE of its values is at
 * most SAMPLE_RANGE_MAX. Repeat-N is the only instability signal a `noul` can have — its single
 * probability has no distribution to spread. Fewer answers than repeats makes the sample unusable.
 */
export function agreeOn(
  criterion: { dimension: string; criterion: string; type: Probe["type"] },
  answers: readonly (string | number)[],
  repeats: number = SAMPLE_REPEATS,
): SampleAgreement {
  const labelled = criterion;
  if (answers.length < repeats) {
    return { ...labelled, stable: false, answers: answers.slice(0, 9) };
  }
  if (criterion.type === "choice") {
    const counts = new Map<string, number>();
    for (const answer of answers) {
      const key = String(answer);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const agreement = Math.max(...counts.values()) / answers.length;
    return { ...labelled, stable: agreement >= SAMPLE_AGREEMENT_MIN, agreement, answers: [...answers].slice(0, 9) };
  }
  const values = answers.map((answer) => Number(answer));
  const range = Math.max(...values) - Math.min(...values);
  // A float epsilon: 0.9 - 0.6 is 0.30000000000000004, and a numerical near-miss is not instability.
  return { ...labelled, stable: range <= SAMPLE_RANGE_MAX + 1e-9, range, answers: [...answers].slice(0, 9) };
}

/**
 * Re-judge one frozen artifact `SAMPLE_REPEATS` times and report agreement per criterion. Pure over
 * the injected `Scorer`: no store, no clock, no writes — the caller decides what to do with the result.
 */
export async function sampleRubric(args: {
  scorer: Scorer;
  goal: string;
  rubric: Quality["dimensions"];
  artifact: unknown;
  subjectDigest?: string;
  repeats?: number;
}): Promise<SampledRun> {
  const repeats = args.repeats ?? SAMPLE_REPEATS;
  const answers = new Map<string, { dimension: string; criterion: string; type: Probe["type"]; seen: (string | number)[] }>();
  /**
   * A dimension with no criteria is judged by its STATEMENT, and the verdict records that score — so
   * the statement's agreement is measured the same way, on the scores across repeats (O7 keeps those
   * tasks on statement scoring; S3 still refuses to raise a bar nobody has sampled).
   */
  const statements = new Map<string, { dimension: string; criterion: string; type: Probe["type"]; seen: (string | number)[] }>();
  for (const dimension of args.rubric) {
    const probes = dimension.probes ?? [];
    if (probes.length === 0) {
      statements.set(dimension.id, { dimension: dimension.id, criterion: STATEMENT, type: "noul", seen: [] });
      continue;
    }
    for (const probe of probes) {
      answers.set(dimension.id + "\u0000" + probe.id, { dimension: dimension.id, criterion: probe.id, type: probe.type, seen: [] });
    }
  }
  for (let repeat = 0; repeat < repeats; repeat += 1) {
    const judged = await args.scorer.score({
      goal: args.goal,
      rubric: args.rubric,
      artifact: args.artifact,
      ...(args.subjectDigest === undefined ? {} : { subjectDigest: args.subjectDigest }),
    });
    for (const dimension of judged.dimensions) {
      statements.get(dimension.id)?.seen.push(dimension.score);
      for (const entry of dimension.diagnosis ?? []) {
        answers.get(dimension.id + "\u0000" + entry.probe)?.seen.push(entry.answer);
      }
    }
  }
  // Declared order, so the recorded sample reads like the rubric itself.
  const criteria = [...answers.values(), ...statements.values()]
    .filter((entry) => entry.seen.length > 0)
    .map((entry) => agreeOn({ dimension: entry.dimension, criterion: entry.criterion, type: entry.type }, entry.seen, repeats));
  return { repeats, criteria, stable: criteria.length > 0 && criteria.every((criterion) => criterion.stable) };
}

/** Record one sample as its event. The writer the tool boundary and the tests share. */
export function recordRubricSample(args: {
  options: EngineOptions;
  instance: string;
  sample: Omit<RubricSampled, "at">;
  at: string;
}): void {
  const payload = { ...args.sample, at: args.at };
  withStore(args.options, (store) => {
    appendEvent(store, args.instance, { type: EVENT.rubricSampled, payload, at: args.at });
  });
}

/**
 * Sample a rubric identity if — and only if — a raise is due and no sample exists yet (R20, R22).
 * Returns true when a sample was recorded. Any failure (no due scope, no accepted artifact, unreadable
 * bytes) records nothing: a missing sample can only HOLD a raise, never refuse work.
 */
export async function sampleIfDue(args: {
  options: EngineOptions;
  instance: string;
  step: string;
  task: string;
  taskVersion: number;
  quality: Quality;
  scorer: Scorer;
  goal: string;
  at: string;
}): Promise<boolean> {
  const due = withStore(args.options, (store) => unsampledDueScopes(store, args.task, args.taskVersion, args.quality, args.at));
  const first = due[0];
  if (first === undefined) return false;
  let artifact: unknown;
  let artifactDigest: string;
  try {
    const read = withStore(args.options, (store) => readArtifact(store, args.instance, args.step));
    if (read.artifact.state !== "accepted") return false;
    artifactDigest = read.artifact.digest;
    const text = new TextDecoder().decode(read.bytes);
    artifact = JSON.parse(text) as unknown;
  } catch {
    return false;
  }
  const run = await sampleRubric({
    scorer: args.scorer,
    goal: args.goal,
    rubric: args.quality.dimensions,
    artifact,
    repeats: SAMPLE_REPEATS,
  });
  if (run.criteria.length === 0) return false;
  recordRubricSample({
    options: args.options,
    instance: args.instance,
    sample: {
      task: args.task,
      taskVersion: args.taskVersion,
      scope: first.scope,
      ...(first.key === undefined ? {} : { key: first.key }),
      composition: compositionKey(args.quality),
      artifactDigest,
      repeats: run.repeats,
      criteria: run.criteria,
      stable: run.stable,
    },
    at: args.at,
  });
  return true;
}
