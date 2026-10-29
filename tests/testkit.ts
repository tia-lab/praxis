/**
 * Test-only helpers: a throwaway workspace, flow fixtures, CLI spawning as a real
 * child process, and raw row reads for assertions.
 *
 * Rows are read with node:sqlite directly rather than through the store API so a
 * failure inside the store cannot mask a bad assertion about what was persisted.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** A fixed instant, so an assertion never depends on the wall clock. */
export const NOW = "2026-10-29T12:00:00.000Z";

export const CLI_PATH = new URL("../src/cli.ts", import.meta.url).pathname;

export interface Workspace {
  root: string;
  store: string;
  config: string;
}

export interface StepFixture {
  id: string;
  capabilities: string[];
  schema: string;
  consumes?: string;
}

export function workspace(): Workspace {
  const root = mkdtempSync(join(tmpdir(), "praxis-runner-"));
  return { root, store: join(root, "state"), config: join(root, "config.json") };
}

export function dispose(ws: Workspace): void {
  rmSync(ws.root, { recursive: true, force: true });
}

/** Write a flow fixture. The runtime pins the digest of exactly these bytes. */
export function writeFlow(ws: Workspace, flow: string, steps: readonly StepFixture[]): void {
  const config = {
    schema: "praxis.config/v1",
    flow,
    steps: steps.map((step) => {
      const declared: Record<string, unknown> = {
        id: step.id,
        capabilities: step.capabilities,
        produces: { schema: step.schema },
        gate: "schema-valid-and-nonce",
      };
      if (step.consumes !== undefined) declared.consumes = step.consumes;
      return declared;
    }),
    result: "praxis.result/v1",
  };
  writeFileSync(ws.config, JSON.stringify(config, null, 2) + "\n");
}

/** The flow this slice proves: draft writes, derive consumes draft and writes. */
export const MAIN_STEPS: readonly StepFixture[] = [
  { id: "draft", capabilities: ["artifact.write", "emit"], schema: "praxis.artifact.architecture/v1" },
  {
    id: "derive",
    capabilities: ["artifact.read", "artifact.write", "emit"],
    schema: "praxis.artifact.derive/v1",
    consumes: "draft",
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
  const run = await cli(ws, ["run", flow, "--request", requestId]);
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
