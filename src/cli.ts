/**
 * The process interface (plan: Process interface, R6, R7).
 *
 * Two invocations are two processes: that is what makes the handoff claim mean
 * something. stdout carries exactly one JSON document — the six-key result on
 * success, or a typed failure object. Progress lines go to stderr, so the caller can
 * see the PID (and, at creation, the nonce) without polluting the result.
 *
 * Creation and step execution are separate calls on purpose: the caller needs the
 * nonce the instance pinned before it can write an artifact that the gate accepts.
 * `run` without `--artifact` therefore creates only; `run --artifact` and `resume`
 * execute the step the store says is current.
 */
import { readFileSync } from "node:fs";
import { asAppError, fail } from "./types/errors.ts";
import { advance, inspect, readStepArtifact, start, type EngineOptions } from "./runner/engine.ts";

interface Parsed {
  positionals: string[];
  flags: Record<string, string>;
}

function parseArgs(argv: readonly string[]): Parsed {
  const positionals: string[] = [];
  const flags: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith("--")) {
      const [name, inline] = arg.slice(2).split("=");
      if (inline !== undefined) {
        flags[name] = inline;
      } else {
        const next = argv[index + 1];
        if (next === undefined || next.startsWith("--")) {
          throw fail("CONFIG_INVALID", "flag --" + name + " needs a value");
        }
        flags[name] = next;
        index += 1;
      }
      continue;
    }
    positionals.push(arg);
  }
  return { positionals, flags };
}

function optionsOf(flags: Record<string, string>): EngineOptions {
  const options: EngineOptions = {};
  if (flags.store !== undefined) options.storeDir = flags.store;
  if (flags.config !== undefined) options.configPath = flags.config;
  if (flags.now !== undefined) options.now = flags.now;
  if (flags.actor !== undefined) options.actor = flags.actor;
  return options;
}

function progress(event: string, fields: Record<string, unknown>): void {
  process.stderr.write(JSON.stringify({ event, pid: process.pid, ...fields }) + "\n");
}

function artifactPayload(flags: Record<string, string>): unknown {
  const path = flags.artifact;
  if (path === undefined) return undefined;
  const text = readFileSync(path, "utf8");
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw fail("CONFIG_INVALID", "artifact file is not JSON", { path, reason: asAppError(error).message });
  }
}

function emit(value: unknown): void {
  process.stdout.write(JSON.stringify(value) + "\n");
}

function requireFlag(flags: Record<string, string>, name: string): string {
  const value = flags[name];
  if (value === undefined) throw fail("CONFIG_INVALID", "missing required flag --" + name);
  return value;
}

function main(argv: readonly string[]): number {
  const { positionals, flags } = parseArgs(argv);
  const command = positionals[0];
  const options = optionsOf(flags);

  if (command === "run") {
    const flow = positionals[1];
    if (flow === undefined) throw fail("CONFIG_INVALID", "usage: run <flow> --request <id> [--artifact <file>]");
    const started = start({ ...options, flow, requestId: requireFlag(flags, "request") });
    progress("instance", {
      instance: started.instance.id,
      created: started.created,
      nonce: started.instance.nonce,
      status: started.instance.status,
      step: started.instance.currentStep,
    });
    if (flags.artifact === undefined) {
      emit(inspect({ ...options, instance: started.instance.id }).result);
      return 0;
    }
    progress("step.start", { instance: started.instance.id, step: started.instance.currentStep });
    emit(advance({ ...options, instance: started.instance.id, artifact: artifactPayload(flags) }).result);
    return 0;
  }

  if (command === "resume") {
    const instance = positionals[1];
    if (instance === undefined) throw fail("CONFIG_INVALID", "usage: resume <instance> [--artifact <file>]");
    const current = inspect({ ...options, instance }).instance;
    if (current.status === "completed") {
      emit(inspect({ ...options, instance }).result);
      return 0;
    }
    if (current.status !== "running") {
      // A failed or blocked instance is not silently resumable: the caller must see it.
      throw fail("INSTANCE_STATE_INVALID", "instance " + instance + " is " + current.status, {
        instance,
        status: current.status,
        step: current.currentStep,
      });
    }
    if (flags.artifact === undefined) {
      throw fail("CONFIG_INVALID", "resume needs --artifact <file> for step " + current.currentStep, {
        instance,
        step: current.currentStep,
      });
    }
    progress("step.start", { instance, step: current.currentStep, status: current.status });
    emit(advance({ ...options, instance, artifact: artifactPayload(flags) }).result);
    return 0;
  }

  if (command === "status") {
    const instance = positionals[1];
    if (instance === undefined) throw fail("CONFIG_INVALID", "usage: status <instance>");
    emit(inspect({ ...options, instance }).result);
    return 0;
  }

  if (command === "artifact" && positionals[1] === "read") {
    const instance = positionals[2];
    const step = positionals[3];
    if (instance === undefined || step === undefined) {
      throw fail("CONFIG_INVALID", "usage: artifact read <instance> <step>");
    }
    const read = readStepArtifact({ ...options, instance, step });
    progress("artifact.read", {
      instance,
      step,
      digest: read.artifact.digest,
      schema: read.artifact.schema,
      version: read.artifact.version,
      state: read.artifact.state,
    });
    emit(read.value);
    return 0;
  }

  throw fail("CONFIG_INVALID", "usage: run | resume | status | artifact read");
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  const failure = asAppError(error);
  process.stderr.write(
    JSON.stringify({ error: { code: failure.code, message: failure.message, detail: failure.detail ?? null } }) + "\n",
  );
  process.exitCode = 1;
}
