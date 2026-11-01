/**
 * The active-step snapshot's shape (design 6).
 *
 * It lives here, in a pure types module, because TWO very different readers need it: the engine writes it (and
the host must be able to read it without importing the engine). The schema is strict, so an unknown key or an
unknown version is refused rather than half-read: a snapshot this file does not understand yields NO domain.
 */
import { z } from "zod";

/** One domain as both the brief and the prompt need it, from the same pinned bytes. */
export const ActiveDomainSchema = z.strictObject({
  id: z.string().min(1),
  version: z.int().min(1),
  digest: z.string().min(1),
  overview: z.string().max(280),
  invariants: z.array(z.string()).max(12),
  prefer: z.array(z.string()).max(12),
  avoid: z.array(z.string()).max(12),
});
export type ActiveDomain = z.infer<typeof ActiveDomainSchema>;

/** The snapshot itself. `running` is the only status that carries domains. */
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

/** The file's name inside the store directory (`.pi/praxis/state/active.json` by default). */
export const ACTIVE_FILE = "active.json";
