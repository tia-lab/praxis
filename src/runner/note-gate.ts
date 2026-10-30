/**
 * The learning note (O3/O4, task-level): the deterministic adequacy gate for the agent's
 * subjective half, the engine-derived OBJECTIVE half (never stored — the events that own those
 * facts already hold them), and the bounded lifecycle that guarantees a note exists for a step
 * that reached its terminal outcome without ever deadlocking the flow.
 *
 * The rules, stated plainly because this module is the enforcement point:
 *  - the artifact is accepted at the quality gate; closure is separate — the instance reaches
 *    `completed` only once the reflection is recorded or stubbed;
 *  - a note is required for a step whose task carries a rubric (that is where a `weakest`
 *    dimension exists to name); a task with no rubric has no note obligation;
 *  - bounded attempts, then the ENGINE writes a `stub: true` note with provenance and the work
 *    proceeds: the omission is recorded against that agent, never a hang.
 */
import {
  LearningNoteSchema,
  LearningNoteSubjectiveSchema,
  ProvenanceSchema,
  type LearningNoteSubjective,
} from "../types/learning.ts";
import { parseWith, type Instance, type Quality } from "../types/schema.ts";
import type { Store } from "../store/db.ts";
import { appendEvent, listEvents } from "../store/events.ts";
import { loadInstance, setStatus } from "../store/instance.ts";
import { fail } from "../types/errors.ts";
import type { EngineOptions, OpenedFlow } from "./engine/index.ts";
import { assertObserver } from "./engine/authority.ts";
import { loadPinnedFlow } from "./engine/flow.ts";
import { payloadOf, withStore } from "./engine/support.ts";
import { DEFAULT_MAX_ATTEMPTS, EVENT } from "./engine/types.ts";
import { barAt, raisesOf } from "../quality/bar.ts";

/** The rubric id the note must name: the weakest dimension of the outcome it reflects on. */
export interface NoteObjective {
  outcome: "pass" | "continued-failed" | "escalated";
  barLevel: number;
  bestScore: number;
  dimensions: { id: string; score: number }[];
  weakest: string;
  /**
   * Dimensions that passed only because of the 5-point tolerance band: they are under their own bar,
   * so the reflection MUST address each of them before the step closes (the learning chain).
   */
  flagged: string[];
  attempts: number;
  artifactDigest: string | undefined;
  scorer: string | undefined;
}

/**
 * The DERIVED objective half of a note (O4): outcome, bar level, scores, weakest dimension,
 * attempts and the judged digest, read back from the events that already own them. Nothing here is
 * stored on the note, so the objective record cannot be duplicated or drift from its source.
 */
export function noteObjective(store: Store, instance: string, step: string, at?: string): NoteObjective | undefined {
  const events = listEvents(store, instance);
  const verdicts = events
    .filter((event) => event.type === EVENT.qualityVerdict && payloadOf(event.payload).step === step)
    .map((event) => payloadOf(event.payload));
  if (verdicts.length === 0) return undefined;
  const best = verdicts.reduce((low, current) => (Number(current.score) > Number(low.score) ? current : low));
  const dimensions = (Array.isArray(best.dimensions) ? best.dimensions : []).map((entry) => {
    const cell = entry as { id?: unknown; score?: unknown };
    return { id: String(cell.id), score: Number(cell.score) };
  });
  if (dimensions.length === 0) return undefined;
  const weakest = dimensions.reduce((low, current) => (current.score < low.score ? current : low)).id;
  const flagged = (Array.isArray(best.flagged) ? best.flagged : []).map(String);
  const accepted = events.find(
    (event) => event.type === EVENT.artifactAccepted && payloadOf(event.payload).step === step,
  );
  const failed = events.find((event) => event.type === EVENT.instanceFailed && payloadOf(event.payload).step === step);
  const acceptedPayload = accepted === undefined ? {} : payloadOf(accepted.payload);
  const outcome: NoteObjective["outcome"] =
    failed !== undefined
      ? "escalated"
      : acceptedPayload.failed !== undefined
        ? "continued-failed"
        : "pass";
  const barLevel = barAt(raisesOf(store, String(acceptedPayload.task ?? "")), Number(best.threshold ?? 0), at);
  return {
    outcome,
    barLevel: Number.isFinite(barLevel) && barLevel > 0 ? barLevel : Number(best.score),
    bestScore: Number(best.score),
    dimensions,
    weakest,
    flagged,
    attempts: verdicts.length,
    artifactDigest: typeof best.artifactDigest === "string" ? best.artifactDigest : undefined,
    scorer: typeof best.scorer === "string" ? best.scorer : undefined,
  };
}

const normalize = (text: string): string => text.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * The adequacy gate (O3), deterministic and typed like `missingFor`: the reflection must name what
 * went wrong, what already held, a concrete improvement that is not a restatement of the problem,
 * and at least one lesson on the dimension that actually scored lowest.
 */
export function noteGate(
  subjective: LearningNoteSubjective,
  rubric: readonly { id: string }[],
  weakest: string,
  /** Dimensions that only passed inside the tolerance band: each one needs its own lesson. */
  flagged: readonly string[] = [],
): string[] {
  const missing: string[] = [];
  if (subjective.whatWrong.trim() === "") missing.push("whatWrong: expected what went wrong");
  if (subjective.whatRight.trim() === "") missing.push("whatRight: expected what already held");
  if (subjective.whatBetter.trim() === "") {
    missing.push("whatBetter: expected a concrete improvement for the next attempt");
  } else if (normalize(subjective.whatBetter) === normalize(subjective.whatWrong)) {
    missing.push("whatBetter: must differ from whatWrong, not restate it");
  }
  const ids = new Set(rubric.map((dimension) => dimension.id));
  for (const tag of subjective.tags) {
    if (!ids.has(tag.dimension)) {
      missing.push("tags: " + JSON.stringify(tag.dimension) + " is not a rubric dimension");
    }
  }
  // The weakest dimension always needs a lesson; so does every dimension that passed only by
  // riding the 5-point band. A flagged dimension is under its own bar — silence about it is exactly
  // the mediocrity the compound gate exists to catch, so the note cannot close the step without it.
  for (const dimension of [weakest, ...flagged.filter((id) => id !== weakest)]) {
    if (subjective.tags.some((tag) => tag.dimension === dimension)) continue;
    missing.push(
      dimension === weakest
        ? "tags: expected at least one lesson on the weakest dimension " + JSON.stringify(dimension)
        : "tags: " + JSON.stringify(dimension) + " passed only inside the tolerance band, so it needs a lesson of its own",
    );
  }
  return missing;
}

/** A step that reached its terminal outcome and has no note yet. */
export interface PendingNote {
  step: string;
  task: string;
  taskVersion: number;
  quality: Quality;
  rubric: readonly { id: string }[];
}

/**
 * The note attempt budget for a step: the same bound the quality loop uses, resolved the same way —
 * the task's or flow's own `maxAttempts`, then the project default, then the constant.
 */
export function maxNoteAttempts(quality: Quality | undefined, defaultMaxAttempts?: number): number {
  return quality?.maxAttempts ?? defaultMaxAttempts ?? DEFAULT_MAX_ATTEMPTS;
}

/** The steps that already carry a note, so a pending step is derived and never stored. */
function noteBook(store: Store, instance: string): { noted: Set<string>; accepted: Set<string> } {
  const noted = new Set<string>();
  const accepted = new Set<string>();
  for (const event of listEvents(store, instance)) {
    const payload = payloadOf(event.payload);
    if (event.type === EVENT.learningNote) noted.add(String(payload.step));
    if (event.type === EVENT.artifactAccepted) accepted.add(String(payload.step));
  }
  return { noted, accepted };
}

/**
 * The step a note is owed for: the earliest node of the pinned flow whose artifact was accepted and
 * whose note is still missing, and whose task carries a rubric. Derived from the log on every call,
 * so it survives a restart and adds no column.
 */
export function pendingNote(store: Store, instance: Instance, flow: OpenedFlow): PendingNote | undefined {
  const { noted, accepted } = noteBook(store, instance.id);
  for (const node of flow.config.nodes) {
    if (!accepted.has(node.id) || noted.has(node.id)) continue;
    const task = flow.tasks.get(node.task);
    if (task === undefined) continue;
    const quality = task.quality ?? flow.config.quality;
    if (quality === undefined) continue;
    return { step: node.id, task: node.task, taskVersion: task.version, quality, rubric: quality.dimensions };
  }
  return undefined;
}

/** How many note attempts this step has already spent (refusals plus pending blocks). */
export function noteAttempts(store: Store, instance: string, step: string): number {
  return listEvents(store, instance).filter(
    (event) =>
      event.type === EVENT.gateVerdict &&
      payloadOf(event.payload).kind === "note" &&
      payloadOf(event.payload).step === step,
  ).length;
}

/** Record one refused note attempt as a gate verdict, so the budget is durable and countable. */
export function recordNoteRefusal(
  store: Store,
  instance: string,
  step: string,
  at: string,
  kind: "note" | "note-pending",
  missing: readonly string[],
): number {
  const attempts = noteAttempts(store, instance, step) + 1;
  appendEvent(store, instance, {
    type: EVENT.gateVerdict,
    payload: { step, kind: "note", decision: "reject", note: kind, attempts, missing: [...missing] },
    at,
  });
  return attempts;
}

/** Write one immutable note: the engine-stamped provenance is the only identity it carries. */
export function writeNote(args: {
  store: Store;
  instance: Instance;
  step: string;
  task: string;
  taskVersion: number;
  subjective: LearningNoteSubjective | null;
  stub: boolean;
  agent: string;
  at: string;
}): { noteVersion: number; stub: boolean } {
  const { store, instance, step, at } = args;
  const prior = listEvents(store, instance.id).filter(
    (event) => event.type === EVENT.learningNote && payloadOf(event.payload).step === step,
  ).length;
  const note = parseWith(
    LearningNoteSchema,
    {
      task: args.task,
      taskVersion: args.taskVersion,
      instance: instance.id,
      step,
      noteVersion: prior + 1,
      subjective: args.subjective,
      stub: args.stub,
      provenance: parseWith(ProvenanceSchema, { agent: args.agent }, "CONFIG_INVALID", "note provenance"),
    },
    "RESULT_INVALID",
    "learning note",
  );
  appendEvent(store, instance.id, { type: EVENT.learningNote, payload: note, at });
  return { noteVersion: note.noteVersion, stub: note.stub };
}

/** The engine's own fallback: a note with no lesson, recorded rather than a deadlock (O3). */
export function writeStubNote(store: Store, instance: Instance, pending: PendingNote, at: string) {
  return writeNote({
    store,
    instance,
    step: pending.step,
    task: pending.task,
    taskVersion: pending.taskVersion,
    subjective: null,
    stub: true,
    agent: instance.actor,
    at,
  });
}

/**
 * Close the instance when the flow is finished AND no reflection is owed (O3: acceptance is the
 * artifact, closure is the lesson). The one writer of `instance.completed` plus its event, shared
 * by the advance path and the note path so the two can never disagree.
 */
export function finishInstance(store: Store, instance: Instance, flow: OpenedFlow, at: string): Instance | undefined {
  if (instance.status !== "running") return undefined;
  if (pendingNote(store, instance, flow) !== undefined) return undefined;
  const { accepted } = noteBook(store, instance.id);
  if (flow.config.nodes.some((node) => !accepted.has(node.id))) return undefined;
  const completed = setStatus(store, instance.id, { status: "completed", currentStep: instance.currentStep }, instance.revision);
  appendEvent(store, instance.id, { type: EVENT.instanceCompleted, payload: { step: instance.currentStep }, at });
  return completed;
}

/** What one `op=note` call did: the step it closed, whether it was a stub, and what was missing. */
export interface NoteOutcome {
  step: string;
  noteVersion: number;
  stub: boolean;
  missing?: string[];
  instance: Instance;
  flow: OpenedFlow;
}

/**
 * Record the agent's reflection for the step that is owed one: gate it, refuse with typed gaps
 * while the budget lasts, and stub it once the budget is spent. Ownership is the same observer
 * rule as every other routed call — no new authority is invented here.
 */
export function recordNote(args: {
  options: EngineOptions & { instance: string };
  actor: string;
  subjective: unknown;
  at: string;
}): NoteOutcome {
  return withStore(args.options, (store) => {
    const instance = loadInstance(store, args.options.instance);
    assertObserver(store, instance, args.actor);
    const flow = loadPinnedFlow(store, instance);
    const pending = pendingNote(store, instance, flow);
    if (pending === undefined) {
      throw fail("INSTANCE_STATE_INVALID", "no step of instance " + instance.id + " is awaiting a learning note", {
        instance: instance.id,
        status: instance.status,
        step: instance.currentStep,
      });
    }
    const objective = noteObjective(store, instance.id, pending.step);
    if (objective === undefined) {
      throw fail("INSTANCE_STATE_INVALID", "step " + JSON.stringify(pending.step) + " has no recorded judgment to reflect on", {
        instance: instance.id,
        step: pending.step,
      });
    }
    const parsed = LearningNoteSubjectiveSchema.safeParse(args.subjective);
    const missing = parsed.success
      ? noteGate(parsed.data, pending.rubric, objective.weakest, objective.flagged)
      : ["subjective: expected whatWrong, whatRight, whatBetter and tags"];
    if (missing.length > 0) {
      const attempts = recordNoteRefusal(store, instance.id, pending.step, args.at, "note", missing);
      const budget = maxNoteAttempts(pending.quality, args.options.defaultMaxAttempts);
      if (attempts < budget) {
        throw fail("ARTIFACT_INVALID", "the learning note for step " + JSON.stringify(pending.step) + " is not adequate", {
          instance: instance.id,
          step: pending.step,
          attempts,
          maxAttempts: budget,
          missing,
        });
      }
      // Bounded attempts spent: the engine records the omission and the work proceeds (O3).
      const stub = writeStubNote(store, instance, pending, args.at);
      const closed = finishInstance(store, instance, flow, args.at) ?? instance;
      return { step: pending.step, noteVersion: stub.noteVersion, stub: true, missing, instance: closed, flow };
    }
    const written = writeNote({
      store,
      instance,
      step: pending.step,
      task: pending.task,
      taskVersion: pending.taskVersion,
      subjective: parsed.success ? parsed.data : null,
      stub: false,
      agent: args.actor,
      at: args.at,
    });
    const closed = finishInstance(store, instance, flow, args.at) ?? instance;
    return { step: pending.step, noteVersion: written.noteVersion, stub: false, instance: closed, flow };
  });
}

/**
 * What the brief needs to know about the note obligation, in one read: which step is owed a note
 * and how much of its budget is spent, so the descriptor can offer `note` instead of `submit`.
 */
export function noteStanding(
  options: EngineOptions,
  instance: Instance,
  flow: OpenedFlow,
): { pending?: PendingNote; attempts: number; budget: number } {
  return withStore(options, (store) => {
    const pending = pendingNote(store, instance, flow);
    if (pending === undefined) return { attempts: 0, budget: 0 };
    return {
      pending,
      attempts: noteAttempts(store, instance.id, pending.step),
      budget: maxNoteAttempts(pending.quality, options.defaultMaxAttempts),
    };
  });
}
