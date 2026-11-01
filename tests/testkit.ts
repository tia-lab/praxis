/**
 * Test-only helpers: a throwaway workspace, flow fixtures, CLI spawning as a real
 * child process, and raw row reads for assertions.
 *
 * Rows are read with node:sqlite directly rather than through the store API so a
 * failure inside the store cannot mask a bad assertion about what was persisted.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { start } from "../src/runner/engine/index.ts";
import { SAMPLE_REPEATS, advanceEvaluated, compositionKey, recordRubricSample, type Scorer } from "../src/quality/index.ts";
import { recordNote } from "../src/runner/note-gate.ts";
import { appendEvent } from "../src/store/events.ts";
import { withStore } from "../src/runner/engine/support.ts";
import { insertInstance } from "../src/store/instance.ts";
import type { Quality } from "../src/types/quality.ts";

/** A fixed instant, so an assertion never depends on the wall clock. */
export const NOW = "2026-10-29T12:00:00.000Z";

export const CLI_PATH = new URL("../src/cli.ts", import.meta.url).pathname;

export interface Workspace {
  root: string;
  store: string;
  config: string;
  /** The task library the runtime resolves from the workspace root (spec R1). */
  tasks: string;
}

export interface TaskFixture {
  id: string;
  capabilities: string[];
  schema: string;
  /** The NODE's one-of-N router (branch R2); never written into the task document. */
  decide?: unknown;
  /** The NODE's park predicate (flow Unit 2 R2); never written into the task document. */
  wait?: unknown;
  goal?: string;
  requires?: unknown;
  bindsSubject?: boolean;
  role?: string;
  quality?: unknown;
  /** The task's rule-set refs (task-rules S2). */
  rules?: unknown;
  version?: number;
  state?: "draft" | "published";
}

export interface EdgeFixture {
  kind: "data" | "join" | "branch" | "refuse";
  from: string;
  to: string;
  /** The option a `branch` edge carries (R1); present iff the kind is `branch`. */
  label?: string;
}

export function workspace(): Workspace {
  const root = mkdtempSync(join(tmpdir(), "praxis-runner-"));
  return {
    root,
    store: join(root, "state"),
    config: join(root, "flow.json"),
    tasks: join(root, ".pi", "praxis", "tasks"),
  };
}

export function dispose(ws: Workspace): void {
  rmSync(ws.root, { recursive: true, force: true });
}

/** A task reference is a path under the library, never a bare id (spec R1, R2). */
export function taskRef(id: string): string {
  return "tasks/" + id;
}

/** A flow identity is a path under `flows/`, never a bare name (spec R1, R2). */
export function flowRef(name: string): string {
  return "flows/" + name;
}

/** Write one task unit at `<library>/<id>.json`. The runtime reads exactly these bytes. */
export function writeTask(ws: Workspace, task: TaskFixture): void {
  const version = task.version ?? 1;
  const document: Record<string, unknown> = {
    id: task.id,
    version,
    state: task.state ?? "published",
    goal: task.goal ?? `do ${task.id}`,
    capabilities: task.capabilities,
    produces: { schema: task.schema },
    gate: "schema-valid-and-nonce",
  };
  if (task.requires !== undefined) document.requires = task.requires;
  if (task.bindsSubject !== undefined) document.bindsSubject = task.bindsSubject;
  if (task.role !== undefined) document.role = task.role;
  if (task.quality !== undefined) document.quality = task.quality;
  if (task.rules !== undefined) document.rules = task.rules;
  // The document owns its version; the reference names only the path (spec R1, R5).
  const path = join(ws.tasks, `${task.id}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(document, null, 2) + "\n");
}

/**
 * Write a flow fixture and the task units it names. The default wiring is a `data`
 * chain in node order; a row that proves an edge refusal passes its own `edges`.
 */
export function writeFlow(
  ws: Workspace,
  flow: string,
  nodes: readonly TaskFixture[],
  edges?: readonly EdgeFixture[],
  flowQuality?: unknown,
  nodeDomains?: Readonly<Record<string, readonly string[]>>,
  flowDomains?: readonly string[],
): void {
  for (const node of nodes) writeTask(ws, node);
  const wiring =
    edges?.slice() ??
    nodes.slice(1).map((node, index) => ({ kind: "data" as const, from: nodes[index].id, to: node.id }));
  const document: Record<string, unknown> = {
    schema: "praxis.flow/v2",
    flow: flowRef(flow),
    // A DOMAIN declaration lives on the flow NODE (or the flow), never on the task atom: the node is the
    // composition point, the task stays reusable (domain injection).
    ...(flowDomains === undefined ? {} : { domains: [...flowDomains] }),
    nodes: nodes.map((node) => ({
      id: node.id,
      task: taskRef(node.id),
      // The router is a NODE attribute: the task atom stays reusable and unaware of the wiring.
      ...(node.decide === undefined ? {} : { decide: node.decide }),
      // So is the park predicate: a task never declares a wait (flow Unit 2 D1).
      ...(node.wait === undefined ? {} : { wait: node.wait }),
      ...(nodeDomains?.[node.id] === undefined ? {} : { domains: [...nodeDomains[node.id]] }),
    })),
    edges: wiring,
    result: "praxis.result/v1",
  };
  if (flowQuality !== undefined) document.quality = flowQuality;
  writeFileSync(ws.config, JSON.stringify(document, null, 2) + "\n");
}

/** The flow this slice proves: draft writes, derive consumes draft and writes. */
export const MAIN_TASKS: readonly TaskFixture[] = [
  { id: "draft", capabilities: ["artifact.write", "emit"], schema: "praxis.artifact.architecture/v1" },
  {
    id: "derive",
    capabilities: ["artifact.read", "artifact.write", "emit"],
    schema: "praxis.artifact.derive/v1",
  },
];

export interface CliRun {
  pid?: number;
  status: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  result?: Record<string, unknown>;
  failure?: { code: string; message: string };
  lines: Array<Record<string, unknown>>;
}

function parseLines(stderr: string): Array<Record<string, unknown>> {
  return stderr
    .split("\n")
    .filter((line) => line.trim().startsWith("{"))
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return {};
      }
    });
}

function finish(run: CliRun): CliRun {
  run.lines = parseLines(run.stderr);
  for (const line of run.lines) {
    if (line.error !== undefined) run.failure = line.error as { code: string; message: string };
  }
  try {
    const parsed = JSON.parse(run.stdout.trim()) as Record<string, unknown>;
    if (parsed.error === undefined) run.result = parsed;
  } catch {
    /* stdout is not JSON; the assertions read the raw text instead. */
  }
  return run;
}

/// Spawn one CLI process; the caller decides whether to wait or to kill it.
export function spawnCli(ws: Workspace, args: readonly string[]): { child: ChildProcess; done: Promise<CliRun> } {
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", CLI_PATH, ...args, "--store", ws.store, "--config", ws.config, "--now", NOW],
    { cwd: ws.root, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const done = new Promise<CliRun>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (status, signal) => {
      resolve(finish({ pid: child.pid, status, signal, stdout, stderr, lines: [] }));
    });
  });
  return { child, done };
}

export async function cli(ws: Workspace, args: readonly string[]): Promise<CliRun> {
  return spawnCli(ws, args).done;
}

/**
 * Kill the process with SIGKILL once it reports it is about to run a step.
 * This is a real process death, not a simulated one; where inside the step it
 * lands is a race, which is why the assertions are about durable invariants.
 */
export async function cliKilledAtStepStart(ws: Workspace, args: readonly string[]): Promise<CliRun> {
  const { child, done } = spawnCli(ws, args);
  await new Promise<void>((resolve) => {
    let seen = false;
    const scan = (chunk: Buffer) => {
      if (seen) return;
      if (chunk.toString("utf8").includes("step.start")) {
        seen = true;
        child.kill("SIGKILL");
        resolve();
      }
    };
    child.stderr?.on("data", scan);
    child.on("close", () => resolve());
  });
  return done;
}

/** Create the instance and return its id plus the nonce the caller must carry. */
export async function createInstance(ws: Workspace, flow: string, requestId: string): Promise<{ instance: string; nonce: string }> {
  const run = await cli(ws, ["run", flowRef(flow), "--request", requestId]);
  if (run.status !== 0) {
    throw new Error("create failed: " + run.stderr + run.stdout);
  }
  const created = run.lines.find((line) => line.event === "instance");
  if (created === undefined) throw new Error("no instance line: " + run.stderr);
  return { instance: String(created.instance), nonce: String(created.nonce) };
}

/** Write an artifact payload to a file and return the path. */
export function artifactFile(ws: Workspace, name: string, payload: unknown): string {
  const path = join(ws.root, name);
  writeFileSync(path, (typeof payload === "string" ? payload : JSON.stringify(payload)) as string);
  return path;
}

export function query(ws: Workspace, sql: string, params: readonly unknown[] = []): Array<Record<string, unknown>> {
  const db = new DatabaseSync(join(ws.store, "praxis.sqlite"));
  try {
    return db.prepare(sql).all(...(params as never[])) as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

export function artifactsOf(ws: Workspace, instance: string): Array<Record<string, unknown>> {
  return query(
    ws,
    "SELECT step, version, digest, schema, state, path, derived_from FROM artifact WHERE instance = ? ORDER BY step, version",
    [instance],
  );
}

export function eventsOf(ws: Workspace, instance: string): Array<Record<string, unknown>> {
  return query(ws, "SELECT seq, type, payload FROM event WHERE instance = ? ORDER BY seq", [instance]).map((row) => {
    let payload: unknown = row.payload;
    try {
      payload = JSON.parse(String(row.payload));
    } catch {
      payload = row.payload;
    }
    return { seq: row.seq, type: row.type, payload };
  });
}

export function instanceRow(ws: Workspace, instance: string): Record<string, unknown> | undefined {
  return query(ws, "SELECT * FROM instance WHERE id = ?", [instance])[0];
}

/* ---------------------------------------------------------------------------------------------
 * Execution-learning helpers (O1/O2/O3): a judged single-step flow, a monotonic clock (the bar and
 * recall fold the log in time order, so one fixed instant would not exercise them), fake scorers
 * that can vary per dimension, and the note a judged step owes.
 * ------------------------------------------------------------------------------------------- */

/** The rubric every learning fixture uses; `solves` is weakest on a tie (it is listed first). */
export const LEARNING_RUBRIC = [
  { id: "solves", statement: "it solves the stated goal" },
  { id: "evidence", statement: "every claim carries evidence" },
  { id: "trace", statement: "the reasoning traces back to its sources" },
];

export const JUDGED_SCHEMA = "praxis.artifact.make/v1";

/** A monotonic clock: each call is one second later, so log order is the order of the calls. */
export function clock(from: string = NOW): { next: () => string } {
  let tick = 0;
  const base = Date.parse(from);
  return {
    next() {
      tick += 1;
      return new Date(base + tick * 1000).toISOString();
    },
  };
}

/** One judged step whose task carries the learning rubric; `extra` sets policy/budget. */
export function judgedFlow(ws: Workspace, extra: Record<string, unknown> = {}): void {
  writeFlow(ws, "learn", [
    {
      id: "make",
      capabilities: ["artifact.write", "emit", "evaluate"],
      schema: JUDGED_SCHEMA,
      quality: { dimensions: LEARNING_RUBRIC, threshold: 0.6, policy: "required", ...extra },
    },
  ]);
}

/** The engine options every learning call uses, stamped with the call's own instant. */
export function learningOptions(ws: Workspace, at: string) {
  return { configPath: ws.config, storeDir: ws.store, tasksDir: ws.tasks, now: at };
}

/** A started instance of the learning flow. */
export interface JudgedRun {
  instance: string;
  nonce: string;
}

/**
 * Seed the stable rubric sample the ratchet requires before its first raise (S3, R20), read from the
 * flow's own task files so a test never restates the rubric it is testing. Engine-level callers
 * (`submitJudged`) use this; the Pi tool path samples for real through `sampleIfDue`.
 */
function seedSamplesOnce(ws: Workspace, instance: string, at: string): void {
  const seen = SEEDED.get(ws) ?? new Set<string>();
  SEEDED.set(ws, seen);
  let flow: { nodes?: { task?: string }[] };
  try {
    flow = JSON.parse(readFileSync(ws.config, "utf8")) as { nodes?: { task?: string }[] };
  } catch {
    return;
  }
  for (const node of flow.nodes ?? []) {
    if (typeof node.task !== "string") continue;
    const file = join(ws.root, ".pi", "praxis", node.task + ".json");
    let task: { quality?: { dimensions?: { id: string }[] }; version?: number };
    try {
      task = JSON.parse(readFileSync(file, "utf8")) as { quality?: { dimensions?: { id: string }[] }; version?: number };
    } catch {
      continue;
    }
    if (task.quality === undefined) continue;
    const quality = task.quality as unknown as Parameters<typeof compositionKey>[0];
    // One sample per (task, composition): a republished rubric needs its own, exactly as in production.
    const marker = node.task + "@" + compositionKey(quality);
    if (seen.has(marker)) continue;
    seen.add(marker);
    recordRubricSample({
      options: learningOptions(ws, at),
      instance,
      sample: {
        task: node.task,
        taskVersion: task.version ?? 1,
        scope: "global",
        key: compositionKey(quality),
        composition: compositionKey(quality),
        artifactDigest: "sha256:" + "0".repeat(64),
        repeats: SAMPLE_REPEATS,
        criteria: [{ dimension: task.quality.dimensions?.[0]?.id ?? "d", criterion: "seed", type: "noul", stable: true, range: 0, answers: [0.9, 0.9, 0.9] }],
        stable: true,
      },
      at,
    });
  }
}

/** Which (task, composition) samples each workspace has seeded, so a test log stays readable. */
const SEEDED = new WeakMap<Workspace, Set<string>>();

export function startJudged(ws: Workspace, requestId: string, at: string, actor = "a"): JudgedRun {
  const started = start({ ...learningOptions(ws, at), flow: flowRef("learn"), requestId, actor });
  return { instance: started.instance.id, nonce: started.instance.nonce };
}

/** One judged submit of a distinct payload, so every attempt is different bytes. */
export function submitJudged(ws: Workspace, run: JudgedRun, at: string, attempt: number, scorer: Scorer, actor = "a") {
  seedSamplesOnce(ws, run.instance, at);
  return advanceEvaluated({
    ...learningOptions(ws, at),
    instance: run.instance,
    actor,
    artifact: { schema: JUDGED_SCHEMA, nonce: run.nonce, attempt },
    scorer,
  });
}

/** A fake scorer returning one score for every dimension, one entry per call. */
export function sequenceScorer(scores: readonly number[]): Scorer & { calls: number } {
  const scorer: { calls: number; score: (input: { rubric: readonly { id: string }[] }) => Promise<unknown> } = {
    calls: 0,
    async score(input) {
      const index = Math.min(scorer.calls, scores.length - 1);
      const score = scores[index];
      scorer.calls += 1;
      return {
        dimensions: input.rubric.map((dimension) => ({ id: dimension.id, score })),
        rationale: "fake scorer",
        scorer: "fake/v1",
      };
    },
  };
  return scorer as unknown as Scorer & { calls: number };
}

/** A fake scorer whose per-dimension scores are declared frame by frame. */
export function dimensionScorer(frames: ReadonlyArray<Record<string, number>>): Scorer & { calls: number } {
  const scorer: { calls: number; score: (input: { rubric: readonly { id: string }[] }) => Promise<unknown> } = {
    calls: 0,
    async score(input) {
      const index = Math.min(scorer.calls, frames.length - 1);
      const frame = frames[index];
      scorer.calls += 1;
      return {
        dimensions: input.rubric.map((dimension) => ({ id: dimension.id, score: frame[dimension.id] ?? 0 })),
        rationale: "fake scorer",
        scorer: "fake/v1",
      };
    },
  };
  return scorer as unknown as Scorer & { calls: number };
}

/** The subjective half a judged step owes; `overrides` targets another dimension or a defect. */
export function noteBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    whatWrong: "the first attempt did not clear the floor",
    whatRight: "the artifact carried the nonce and its declared schema",
    whatBetter: "answer the goal before the supporting detail",
    tags: [{ dimension: "solves", lesson: "state the answer to the goal first" }],
    ...overrides,
  };
}

/** Record the note a judged step owes, as this session's actor. */
export function recordNoteFor(ws: Workspace, instance: string, at: string, body: unknown = noteBody(), actor = "a") {
  return recordNote({ options: { ...learningOptions(ws, at), instance }, actor, subjective: body, at });
}


/**
 * A host instance for a seeded event: the event table has a foreign key to `instance`, and a
 * fixture only needs a row that parses. Deterministic per index so a store stays reproducible.
 */
function eventHost(store: Parameters<Parameters<typeof withStore>[1]>[0], index: number, at: string): string {
  const id = "i" + String(index).padStart(32, "0");
  try {
    insertInstance(store, { id, flow: "flows/fixture", actor: "a", status: "running", currentStep: "draft", nonce: String(index).padStart(32, "0"), now: at });
  } catch {
    // Already there: a fixture may seed twice against the same store.
  }
  return id;
}

/**
 * Seed one recorded raise for a dimension, so a gate test can SET a bar in one line instead of
 * building a population that reaches it. An omitted key writes a key-less raise, which the fold
 * accepts under any current identity - the fixture form of a legacy record.
 */
export function raiseBar(store: Parameters<Parameters<typeof withStore>[1]>[0], task: string, dimension: string, to: number, key?: string, at: string = NOW): void {
  const host = eventHost(store, 900, at);
  appendEvent(store, host, {
    type: "bar.raised",
    payload: {
      task,
      taskVersion: 1,
      scope: dimension,
      ...(key === undefined ? {} : { key }),
      from: 0.5,
      to,
      formulaId: "praxis.bar.quantile/v1",
      at,
    },
    at,
  });
}

/**
 * Seed `values.length` carried observations of one dimension: one instance each, an accepted
 * version and its verdict, which is exactly what the quantile population reads (spec 3.1).
 */
export function population(store: Parameters<Parameters<typeof withStore>[1]>[0], task: string, dimension: string, values: readonly number[], at: string = NOW): void {
  values.forEach((score, index) => {
    const host = eventHost(store, 1000 + index, at);
    appendEvent(store, host, {
      type: "quality.verdict",
      payload: {
        step: "draft",
        version: 1,
        artifactDigest: "sha256:" + String(index).padStart(64, "a"),
        task,
        taskVersion: 1,
        decision: "pass",
        score,
        dimensions: [{ id: dimension, score }],
        rationale: "fixture",
        rubricDigest: "sha256:" + "b".repeat(64),
        scorer: "fixture/v1",
        source: "jev",
      },
      at,
    });
    appendEvent(store, host, {
      type: "artifact.accepted",
      payload: {
        step: "draft",
        version: 1,
        path: "x",
        digest: "sha256:" + String(index).padStart(64, "a"),
        schema: "praxis.artifact.fixture/v1",
        task,
        taskVersion: 1,
      },
      at,
    });
  });
}
/**
 * Seed the stable rubric sample a raise requires (the S3 guard): one sample per composition,
 * recorded the way the sampler records it, so a ratchet test exercises the raise and not the guard.
 */
export function stableSample(store: Parameters<Parameters<typeof withStore>[1]>[0], task: string, quality: Quality, at: string = NOW): void {
  const host = eventHost(store, 950, at);
  const composition = compositionKey(quality);
  appendEvent(store, host, {
    type: "rubric.sampled",
    payload: {
      task,
      taskVersion: 1,
      scope: "global",
      key: composition,
      composition,
      artifactDigest: "sha256:" + "c".repeat(64),
      repeats: 3,
      criteria: [{ dimension: quality.dimensions[0]!.id, criterion: "seed", type: "noul", stable: true, range: 0, answers: [0.9, 0.9, 0.9] }],
      stable: true,
      at,
    },
    at,
  });
}