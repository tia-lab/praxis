/**
 * Profile resolution for the domain layer (domain-injection unit).
 *
 * A 1:1 mirror of the rule-set path: two loaders feed one shape (`openFlow` reads from the library,
 * `loadPinnedFlow` reads the instance's own `profile` definition rows), one resolver picks the refs, and one
 * composer unions them.
 *
 * ONLY THE DOMAIN LAYER IS COMPOSED HERE. `conduct` and `role` are the agent's fixed system identity and stay
 * with the host (gate #2); this module never reads them, and a domain reference cannot name another layer.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fail } from "../../types/errors.ts";
import type { FlowConfig } from "../../types/schema.ts";
import { parseWith } from "../../types/schema.ts";
import {
  DOMAINS_PER_NODE_MAX,
  ProfileSchema,
  type ComposedDomains,
  type PinnedProfile,
} from "../../types/profile.ts";
import { digest } from "../canonical.ts";
import { messageOf } from "./support.ts";

/** The layer this unit resolves. A domain reference cannot reach another one. */
export const DOMAIN_LAYER = "domain";

/**
 * Read one domain profile from the library: `<profileDir>/domain/<id>.json`, parsed, with `id` equal to the
 * reference and `layer` equal to the folder it came from. A missing file is `PROFILE_NOT_FOUND`; bad bytes, a
 * bad shape, a wrong layer or a mismatched id is `PROFILE_INVALID`. Every refusal fires before anything is
 * written.
 */
export function loadProfile(profileDir: string, ref: string): PinnedProfile {
  const path = join(profileDir, DOMAIN_LAYER, ref + ".json");
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    throw fail("PROFILE_NOT_FOUND", "domain profile " + ref + " is not readable", {
      reason: "profile-missing",
      profile: ref,
      layer: DOMAIN_LAYER,
      path,
      cause: messageOf(error),
    });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch (error) {
    throw fail("PROFILE_INVALID", "domain profile " + ref + " is not JSON", { profile: ref, path, reason: messageOf(error) });
  }
  const doc = parseWith(ProfileSchema, raw, "PROFILE_INVALID", "domain profile " + ref);
  if (doc.layer !== DOMAIN_LAYER) {
    throw fail("PROFILE_INVALID", "domain profile " + ref + " declares another layer", { profile: ref, layer: doc.layer, path });
  }
  if (doc.id !== ref) {
    throw fail("PROFILE_INVALID", "domain profile " + ref + " declares a different identity", { profile: ref, id: doc.id, path });
  }
  return { path: ref, doc, bytes, digest: digest(bytes) };
}

/**
 * The domains in force for one node: the NODE's own `domains` when it declares them, otherwise the flow-level
 * default. A node that declares none and a flow that declares none yields an empty list, so a project with no
 * domains behaves exactly as it did before this unit.
 */
export function domainRefsOf(node: { id: string; domains?: readonly string[] }, flow: FlowConfig): string[] {
  const own = node.domains;
  const refs = own !== undefined ? [...own] : (flow.domains !== undefined ? [...flow.domains] : []);
  if (refs.length > DOMAINS_PER_NODE_MAX) {
    throw fail("PROFILE_INVALID", "node " + node.id + " declares more domains than a brief may carry", {
      node: node.id,
      count: refs.length,
      max: DOMAINS_PER_NODE_MAX,
    });
  }
  return refs;
}

/** Resolve a node's effective domains through a loader (the library or the pins). Order is declaration order. */
export function resolveDomains(
  node: { id: string; domains?: readonly string[] },
  flow: FlowConfig,
  load: (ref: string) => PinnedProfile,
): PinnedProfile[] {
  return domainRefsOf(node, flow).map((ref) => load(ref));
}

/**
 * Compose the declared domains into ONE block: the union of `overview`, `invariants`, `prefer` and `avoid` in
 * declaration order, deduplicated entry by entry. Two profiles that state the same obligation state it once.
 * Nothing is weighted, summarised or model-chosen: the union is deterministic and the entries are authored.
 */
export function composeDomains(profiles: readonly PinnedProfile[]): ComposedDomains {
  const compose = (pick: (profile: PinnedProfile) => readonly string[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const profile of profiles) {
      for (const entry of pick(profile)) {
        if (seen.has(entry)) continue;
        seen.add(entry);
        out.push(entry);
      }
    }
    return out;
  };
  return {
    overview: compose((profile) => [profile.doc.overview]),
    invariants: compose((profile) => profile.doc.invariants),
    prefer: compose((profile) => profile.doc.prefer),
    avoid: compose((profile) => profile.doc.avoid),
  };
}
