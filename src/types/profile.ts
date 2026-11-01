/**
 * The profile atom: one JSON file under `.pi/praxis/profile/<layer>/<name>.json`, holding a named, versioned
 * conduct profile. Three layers exist - `conduct` (occam), `role`, `domain` - and only `domain` is dynamic in
 * this unit: it is declared on the FLOW NODE and injected into the step brief.
 *
 * The shape is locked (docs/tasks/profiles-286ce77d/design.md 2.0): nine required fields and two optional ones, a
 * strict object, and a refine that requires content. `description` is metadata (the catalogue line) and is
 * never injected; `overview` is what the agent reads first. No `extends`, no `tools`, no `capabilities`, no
 * `priority`: a profile states obligations and must never be able to name a permission.
 */
import { z } from "zod";
import { KEBAB } from "./paths.ts";

/** The three layers. Only `domain` is composed per step by this unit. */
export const PROFILE_LAYERS = ["conduct", "role", "domain"] as const;
/** One layer name. */
export type ProfileLayer = (typeof PROFILE_LAYERS)[number];

/** How many profiles one node may declare (and how many a brief may carry). */
export const DOMAINS_PER_NODE_MAX = 6;
/** One entry in `invariants`, `prefer` or `avoid`. */
export const PROFILE_ENTRY_MAX = 280;
/** How many entries each of the three arrays may carry. */
export const PROFILE_ENTRIES_MAX = 12;

/**
 * A domain reference is a BARE id: the folder is implied by the layer, so `"code"` means
 * `.pi/praxis/profile/domain/code.json`. A reference cannot name another layer or leave the directory.
 */
export const DomainRefSchema = z.string().regex(KEBAB, "expected a lower-case kebab domain id");
export type DomainRef = z.infer<typeof DomainRefSchema>;

/** One worked example inside a profile: what not to do, what to do, or why. */
export const ProfileExampleSchema = z.strictObject({
  bad: z.string().max(PROFILE_ENTRY_MAX).optional(),
  good: z.string().max(PROFILE_ENTRY_MAX).optional(),
  note: z.string().max(PROFILE_ENTRY_MAX).optional(),
});

/**
 * One profile document. `id` must equal the file's last path segment and `layer` must equal the folder it sits
 * in; the loader refuses a disagreement (as `loadTask` does for a task). The refine requires content: at least
 * one entry across the three arrays, or a `body`.
 */
export const ProfileSchema = z
  .strictObject({
    id: z.string().regex(KEBAB, "expected a lower-case kebab profile id"),
    version: z.int().min(1),
    layer: z.enum(PROFILE_LAYERS),
    name: z.string().min(1).max(64),
    /** META ONLY - the selection/catalogue line. Never injected as conduct. */
    description: z.string().min(1).max(240),
    /** Injected first: the one-or-two-line intent the agent reads before the entries. */
    overview: z.string().min(1).max(280),
    /** Always-hold obligations. */
    invariants: z.array(z.string().min(1).max(PROFILE_ENTRY_MAX)).max(PROFILE_ENTRIES_MAX),
    /** What to do. */
    prefer: z.array(z.string().min(1).max(PROFILE_ENTRY_MAX)).max(PROFILE_ENTRIES_MAX),
    /** What not to do, with the reason stated calmly. */
    avoid: z.array(z.string().min(1).max(PROFILE_ENTRY_MAX)).max(PROFILE_ENTRIES_MAX),
    examples: z.array(ProfileExampleSchema).max(6).optional(),
    /** Optional flowing prose spine; `conduct/occam` uses it, roles and domains usually omit it. */
    body: z.string().min(1).max(4000).optional(),
  })
  .refine(
    (profile) => profile.invariants.length + profile.prefer.length + profile.avoid.length > 0 || profile.body !== undefined,
    { message: "a profile must carry content: at least one invariant, prefer or avoid entry, or a body" },
  );
export type Profile = z.infer<typeof ProfileSchema>;

/** One profile as read (library) or as pinned (instance): the document, its exact bytes and the digest. */
export interface PinnedProfile {
  /** The reference it answers: the domain id, e.g. `code`. */
  readonly path: string;
  readonly doc: Profile;
  /** The exact bytes read (library) or pinned (instance). */
  readonly bytes: Uint8Array;
  /** `digest(bytes)`: the value `start` pins, so a later read can prove nothing moved. */
  readonly digest: string;
}

/** The composed block: the union across the declared domains, in declaration order, deduplicated. */
export interface ComposedDomains {
  /** Each profile's overview, in declaration order. */
  overview: string[];
  invariants: string[];
  prefer: string[];
  avoid: string[];
}
