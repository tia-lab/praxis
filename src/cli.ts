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
import { advance, inspect, readStepArtifact, resume, start, type EngineOptions, type WaitEvent } from "./runner/engine/index.ts";
import { projectMaxAttempts } from "./runner/engine/support.ts";
import { formatMetrics, metricsFor } from "./quality/metrics.ts";

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
  // The project's own defaults are loaded at this boundary and threaded in as a value; a task or
  // flow that declares its own bound still wins over it, and a broken config falls back to code.
  const defaultMaxAttempts = projectMaxAttempts(process.cwd());
  if (defaultMaxAttempts !== undefined) options.defaultMaxAttempts = defaultMaxAttempts;
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

/**
 * The outside event a resume delivers (flow Unit 2 R5, R9): a JSON file with a `type` and optional
 * `fields`. It is transport only — the engine decides whether it satisfies the park.
 */
function eventPayload(flags: Record<string, string>): WaitEvent | undefined {
  const path = flags.event;
  if (path === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    throw fail("CONFIG_INVALID", "event file is not JSON", { path, reason: asAppError(error).message });
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw fail("CONFIG_INVALID", "event file must be a JSON object", { path });
  }
  const record = value as Record<string, unknown>;
  if (typeof record.type !== "string") throw fail("CONFIG_INVALID", "event file needs a string type", { path });
  const fields = record.fields;
  if (fields !== undefined && (typeof fields !== "object" || fields === null || Array.isArray(fields))) {
    throw fail("CONFIG_INVALID", "event fields must be an object", { path });
  }
  return { type: record.type, ...(fields === undefined ? {} : { fields: fields as Record<string, string | number | boolean> }) };
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
    if (instance === undefined) throw fail("CONFIG_INVALID", "usage: resume <instance> [--artifact <file> | --event <file>]");
    const event = eventPayload(flags);
    if (event !== undefined) {
      emit(resume({ ...options, instance, event }).result);
      return 0;
    }
    const current = inspect({ ...options, instance }).instance;
    if (current.status === "completed") {
      emit(inspect({ ...options, instance }).result);
      return 0;
    }
    if (current.status !== "running") {
      // A failed instance is not silently resumable, and a PARKED one waits for an event, not for an
      // artifact: the refusal names the flag that would release it (flow Unit 2 R5, R11).
      throw fail(
        "INSTANCE_STATE_INVALID",
        current.status === "waiting"
          ? "instance " + instance + " is waiting at " + current.currentStep + "; resume it with --event <file>"
          : "instance " + instance + " is " + current.status,
        { instance, status: current.status, step: current.currentStep },
      );
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

  // The metrics read-model: a READ-ONLY projection over the events already stored. It prints tables
  // (not the six-key result), because its whole purpose is to be read by a person. `metrics [task]`
  // narrows to one task ref such as `tasks/research`.
  if (command === "metrics") {
    process.stdout.write(formatMetrics(metricsFor(options, positionals[1])));
    return 0;
  }
  throw fail("CONFIG_INVALID", "usage: run | resume | status | artifact read | metrics [task]");
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
