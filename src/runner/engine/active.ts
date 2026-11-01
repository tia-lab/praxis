/**
 * The active-step snapshot: the ONE fact the Pi host needs to compose a prompt for the current step.
 *
 * The store owns the instance and the pinned definition rows own the profile bytes; this file is a DERIVED HINT,
 * rewritten at every boundary and marked `closed` when the instance stops running. Choosing this over having the
 * host open the SQLite store keeps the host free of engine reasoning and off the store's write lock (design 6).
 *
 * A stale, absent, unreadable or malformed file yields NO domain, never a guess, and a snapshot that cannot be
 * written never fails a step: the file is a convenience, so its failure is a warning.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { resolveDomains } from "./profile.ts";
import type { Instance } from "../../types/schema.ts";
import type { OpenedFlow } from "./types.ts";

/** The file's name inside the store directory (`.pi/praxis/state/active.json` by default). */
export const ACTIVE_FILE = "active.json";

/** One domain as the prompt needs it: what the brief carried, from the same pinned bytes. */
const ActiveDomainSchema = z.strictObject({
  id: z.string().min(1),
  version: z.int().min(1),
  digest: z.string().min(1),
  overview: z.string().max(280),
  invariants: z.array(z.string()).max(12),
  prefer: z.array(z.string()).max(12),
  avoid: z.array(z.string()).max(12),
});

/** The snapshot's shape. `running` is the only status that carries domains. */
export const ActiveSnapshotSchema = z.strictObject({
  v: z.literal(1),
  instance: z.string().min(1),
  flow: z.string().min(1),
  step: z.string().min(1),
  task: z.string().min(1),
  status: z.enum(["running", "closed"]),
  domains: z.array(ActiveDomainSchema).max(6),
  at: z.string().min(1),
});
export type ActiveSnapshot = z.infer<typeof ActiveSnapshotSchema>;

/** Where the snapshot lives for one store root. */
export function activePath(storeDir: string): string {
  return join(storeDir, ACTIVE_FILE);
}

/**
 * Write the snapshot atomically: temp file then rename, so a reader never sees half a document. Returns false
 * when the write failed - the caller treats that as a warning, never as a step failure.
 */
export function writeActiveStep(storeDir: string, snapshot: ActiveSnapshot): boolean {
  const path = activePath(storeDir);
  const temp = path + ".tmp";
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(temp, JSON.stringify(snapshot) + "\n");
    renameSync(temp, path);
    return true;
  } catch {
    return false;
  }
}

/** Read it back. Every failure mode is `undefined`: the host then composes conduct+role only. */
export function readActiveStep(storeDir: string): ActiveSnapshot | undefined {
  try {
    const parsed = ActiveSnapshotSchema.safeParse(JSON.parse(readFileSync(activePath(storeDir), "utf8")) as unknown);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The domains in force for the instance's CURRENT step, resolved from the pinned flow exactly as the brief did -
 * so the prompt and the pin can never disagree. A node that is not in the flow yields an empty list rather than
 * an exception: the snapshot is not allowed to break a step.
 */
export function snapshotActive(instance: Instance, flow: OpenedFlow, storeDir: string, at?: string): boolean {
  try {
    const running = instance.status === "running";
    const node = flow.config.nodes.find((candidate) => candidate.id === instance.currentStep);
    const domains =
      running && node !== undefined
        ? resolveDomains(node, flow.config, (ref) => {
            const pinned = flow.profiles.get(ref);
            if (pinned === undefined) throw new Error("unresolved domain " + ref);
            return pinned;
          })
        : [];
    return writeActiveStep(storeDir, {
      v: 1,
      instance: instance.id,
      flow: flow.config.flow,
      step: instance.currentStep,
      task: node?.task ?? "",
      status: running && domains.length >= 0 ? "running" : "closed",
      domains: domains.map((profile) => ({
        id: profile.path,
        version: profile.doc.version,
        digest: profile.digest,
        overview: profile.doc.overview,
        invariants: profile.doc.invariants,
        prefer: profile.doc.prefer,
        avoid: profile.doc.avoid,
      })),
      at: at ?? new Date().toISOString(),
    });
  } catch {
    return false;
  }
}
