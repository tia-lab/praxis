/**
 * The composed system prompt: conduct -> role -> domain? -> environment, as ONE document.
 *
 * Pure by construction: no I/O, no clock, no store, no engine state. It takes the layers it was handed and
 * returns text, so a golden test pins the exact bytes and the host path cannot drift from the test.
 *
 * Order is the contract (design 7): conduct leads, role follows, the current step's domains come third, and Pi's
 * own prompt is nested LAST under `# Environment` - never first, never twice.
 *
 * The advisory line appears exactly ONCE, at the end of the composed layers and BEFORE the environment block
 * (lead ruling Q2): it is a property of OUR conduct, not of Pi's host prompt.
 */
import { digest } from "../canonical.ts";
import type { PinnedProfile } from "../../types/profile.ts";

/** The idempotence and audit handle. A prompt that starts with this was composed by us already. */
export const PROMPT_MARKER_PREFIX = "<!-- praxis:system-prompt v1";

/** Appended once, after the layers and before the environment. */
export const PROMPT_ADVISORY =
  "This composition guides behavior. It does not enforce gates, prove truth, install hooks, or grant any permission.";

/** What the composer needs: two fixed layers, the dynamic one, and Pi's own prompt to wrap. */
export interface ComposeSystemPromptInput {
  readonly conduct: PinnedProfile;
  readonly role: PinnedProfile;
  /** The current step's domain profiles, in node order. Empty means this step declares none. */
  readonly domains?: readonly PinnedProfile[];
  /** `event.systemPrompt`: the prompt Pi rendered for this run, nested verbatim. */
  readonly environment: string;
}

/** The composed document, its marker, the section order and every digest a trace line reports. */
export interface ComposedSystemPrompt {
  readonly text: string;
  readonly marker: string;
  /** The sections actually rendered, in order: "conduct", "role", "domain"?, "environment". */
  readonly sections: readonly string[];
  readonly digests: {
    readonly conduct: string;
    readonly role: string;
    readonly domains: readonly string[];
    /** `digest(body)`: the composition itself, without the marker line. */
    readonly composed: string;
  };
}

/** Carry a line: entries keep their authored text and gain only a bullet. */
const bullet = (entry: string): string => "- " + entry;

/** One layer's block, minus any entry an earlier layer already stated. */
function block(
  title: string,
  profile: PinnedProfile,
  seen: Set<string>,
  includeBody: boolean,
): string[] {
  const doc = profile.doc;
  const lines: string[] = ["# " + title + " \u2014 " + doc.id + " v" + doc.version, "", doc.overview];
  if (includeBody && doc.body !== undefined) lines.push("", doc.body);
  const groups: readonly (readonly [string, readonly string[]])[] = [
    ["Invariants", doc.invariants],
    ["Prefer", doc.prefer],
    ["Avoid", doc.avoid],
  ];
  for (const [heading, entries] of groups) {
    const fresh: string[] = [];
    for (const entry of entries) {
      if (seen.has(entry)) continue;
      seen.add(entry);
      fresh.push(entry);
    }
    if (fresh.length === 0) continue;
    lines.push("", "## " + heading, ...fresh.map(bullet));
  }
  const examples = (doc.examples ?? []).filter((example) => {
    const key = JSON.stringify(example);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (examples.length > 0) {
    lines.push("", "## Examples");
    for (const example of examples) {
      if (example.good !== undefined) lines.push("- good: " + example.good);
      if (example.bad !== undefined) lines.push("- bad: " + example.bad);
      if (example.note !== undefined) lines.push("- note: " + example.note);
    }
  }
  return lines;
}

/**
 * Compose the whole prompt. Deterministic: the same layers and the same environment produce the same bytes, which
 * is what makes the golden test and the trace line comparable across runs.
 */
export function composeSystemPrompt(input: ComposeSystemPromptInput): ComposedSystemPrompt {
  const domains = input.domains ?? [];
  // One set across every layer: an obligation stated twice is stated once, and it stays where it first appeared.
  const seen = new Set<string>();
  const lines: string[] = [...block("Conduct", input.conduct, seen, true), ""];
  lines.push(...block("Role", input.role, seen, false), "");
  for (const domain of domains) lines.push(...block("Domain", domain, seen, false), "");
  lines.push(PROMPT_ADVISORY, "", "# Environment", "", input.environment);

  const body = lines.join("\n");
  const composed = digest(body);
  const layers = [
    "conduct=" + input.conduct.doc.id + "@" + input.conduct.doc.version,
    "role=" + input.role.doc.id + "@" + input.role.doc.version,
    ...(domains.length === 0 ? [] : ["domain=" + domains.map((d) => d.doc.id + "@" + d.doc.version).join(",")]),
  ];
  const marker = PROMPT_MARKER_PREFIX + " | " + layers.join(" ") + " | sha256:" + composed.slice(7, 23) + " -->";
  const sections = [
    "conduct",
    "role",
    ...(domains.length === 0 ? [] : ["domain"]),
    "environment",
  ];
  return {
    text: marker + "\n\n" + body,
    marker,
    sections,
    digests: { conduct: input.conduct.digest, role: input.role.digest, domains: domains.map((d) => d.digest), composed },
  };
}

/** True when this text was composed by us already, so a boundary must nest nothing further. */
export function isComposedPrompt(text: string): boolean {
  return text.startsWith(PROMPT_MARKER_PREFIX);
}
