/**
 * The composed system prompt, at the run boundary.
 *
 * `before_agent_start` hands us the prompt Pi rendered for this run. We replace it with ONE document: conduct,
 * role, the current step's domain when there is one, then Pi's own prompt nested verbatim as `# Environment`.
 *
 * Two rules keep it honest. It composes nothing when it cannot know the role (fail closed to Pi's own prompt,
 * one warning), and it composes nothing when the prompt is already composed (the marker guard), so a second
 * boundary can never nest an environment inside another.
 *
 * Dependency direction: this module imports the PURE composer and the PURE profile loader, and reads two small
 * files itself. It imports no engine module, opens no store and calls no engine reasoning.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { BeforeAgentStartEvent, BeforeAgentStartResult } from "./host.ts";
import { loadProfileLayer } from "../runner/engine/profile.ts";
import { composeSystemPrompt, isComposedPrompt } from "../runner/engine/prompt.ts";
import { ACTIVE_FILE, ActiveSnapshotSchema } from "../types/active.ts";
import { ProjectConfigSchema } from "../types/project.ts";
import type { PinnedProfile } from "../types/profile.ts";

/** The conduct profile that leads every composed prompt. One project, one conduct document. */
export const CONDUCT_ID = "occam";

/** The role seat this process claims: `PRAXIS_ROLE`, then the project's `defaults.role`. */
export interface PromptHookOptions {
  /** The project root the extension was loaded in. */
  readonly cwd: string;
  /** `process.env`, injected so a test can claim a seat without mutating the process. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Where the snapshot lives. Defaults to the project's store root. */
  readonly storeDir?: string;
  /** Where the profiles live. Defaults to `<cwd>/.pi/praxis/profile`. */
  readonly profileDir?: string;
  /** The warning sink. Defaults to stderr; a test asserts the ONE line. */
  readonly warn?: (line: string) => void;
  /** The trace sink, used only when `PRAXIS_PROMPT_TRACE` is set. Defaults to stderr. */
  readonly trace?: (line: string) => void;
}

/** One loaded layer, cached by path and mtime: a boundary costs one `stat`, not a parse. */
const cache = new Map<string, { mtimeMs: number; profile: PinnedProfile }>();

function loadCached(dir: string, layer: "conduct" | "role", id: string): PinnedProfile {
  const path = join(dir, layer, id + ".json");
  const mtimeMs = statSync(path).mtimeMs;
  const hit = cache.get(path);
  if (hit !== undefined && hit.mtimeMs === mtimeMs) return hit.profile;
  const profile = loadProfileLayer(dir, layer, id);
  cache.set(path, { mtimeMs, profile });
  return profile;
}

/** The project config's optional role, read without an engine import. A broken file claims no seat. */
function projectRole(cwd: string): string | undefined {
  try {
    const parsed = ProjectConfigSchema.safeParse(JSON.parse(readFileSync(join(cwd, ".pi/praxis/config.json"), "utf8")) as unknown);
    return parsed.success ? parsed.data.defaults?.role : undefined;
  } catch {
    return undefined;
  }
}

/** The store root the engine writes into, resolved the same way it resolves it. */
function storeDirOf(options: PromptHookOptions): string {
  if (options.storeDir !== undefined) return options.storeDir;
  const env = options.env ?? process.env;
  if (env.PRAXIS_STORE_DIR !== undefined) return env.PRAXIS_STORE_DIR;
  return join(options.cwd, ".pi/praxis/state");
}

/** The current step's domains, or none at all: a stale, absent or malformed snapshot is NO domain, never a guess. */
function domainsOf(storeDir: string): PinnedProfile[] {
  try {
    const parsed = ActiveSnapshotSchema.safeParse(JSON.parse(readFileSync(join(storeDir, ACTIVE_FILE), "utf8")) as unknown);
    if (!parsed.success || parsed.data.status !== "running") return [];
    return parsed.data.domains.map((domain) => ({
      path: domain.id,
      doc: {
        id: domain.id,
        version: domain.version,
        layer: "domain" as const,
        name: domain.id,
        description: domain.id,
        overview: domain.overview,
        invariants: domain.invariants,
        prefer: domain.prefer,
        avoid: domain.avoid,
      },
      bytes: new Uint8Array(),
      digest: domain.digest,
    }));
  } catch {
    return [];
  }
}

/**
 * Build the handler. It returns `{ systemPrompt }` to replace the whole prompt, or `undefined` to leave Pi's own
 * prompt untouched - never a partial composition.
 */
export function createPromptHook(options: PromptHookOptions): (event: BeforeAgentStartEvent) => BeforeAgentStartResult | undefined {
  const env = options.env ?? process.env;
  const warn = options.warn ?? ((line: string) => process.stderr.write(line + "\n"));
  const trace = options.trace ?? ((line: string) => process.stderr.write(line + "\n"));
  const profileDir = options.profileDir ?? join(options.cwd, ".pi/praxis/profile");

  return (event: BeforeAgentStartEvent): BeforeAgentStartResult | undefined => {
    // Already ours: a second boundary must nest nothing.
    if (isComposedPrompt(event.systemPrompt)) return undefined;
    const role = env.PRAXIS_ROLE ?? projectRole(options.cwd);
    if (role === undefined || role.length === 0) {
      warn("praxis: no role claimed (PRAXIS_ROLE unset and no defaults.role) - passing Pi's own prompt through");
      return undefined;
    }
    let conduct: PinnedProfile;
    let seat: PinnedProfile;
    try {
      conduct = loadCached(profileDir, "conduct", CONDUCT_ID);
      seat = loadCached(profileDir, "role", role);
    } catch (error) {
      warn("praxis: cannot compose the system prompt - " + (error as { message?: string }).message);
      return undefined;
    }
    const composed = composeSystemPrompt({
      conduct,
      role: seat,
      domains: domainsOf(storeDirOf(options)),
      environment: event.systemPrompt,
    });
    if ((env.PRAXIS_PROMPT_TRACE ?? process.env.PRAXIS_PROMPT_TRACE) !== undefined) {
      trace(
        "praxis-prompt " +
          JSON.stringify({
            bytes: Buffer.byteLength(composed.text),
            sha256: composed.digests.composed,
            sections: composed.sections,
            role,
          }),
      );
    }
    return { systemPrompt: composed.text };
  };
}
