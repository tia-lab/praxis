/**
 * S2: the composer is pure, so its exact bytes can be pinned. These tests are the contract the hook is judged
 * against: order, the environment nested last and verbatim, the advisory line once, and the marker naming every
 * layer.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { digest } from "../../src/runner/canonical.ts";
import {
  PROMPT_ADVISORY,
  PROMPT_MARKER_PREFIX,
  composeSystemPrompt,
  isComposedPrompt,
} from "../../src/runner/engine/prompt.ts";
import type { PinnedProfile, Profile } from "../../src/types/profile.ts";

const pin = (doc: Partial<Profile> & { id: string; layer: Profile["layer"]; overview: string }): PinnedProfile => ({
  path: doc.id,
  doc: {
    version: 1,
    name: doc.id,
    description: "a profile",
    invariants: [],
    prefer: [],
    avoid: [],
    ...doc,
  } as Profile,
  bytes: new Uint8Array(),
  digest: "sha256:" + "0".repeat(64),
});

const CONDUCT = pin({
  id: "occam",
  layer: "conduct",
  overview: "we lead with evidence",
  body: "the flowing spine",
  invariants: ["one invariant"],
});
const ROLE = pin({ id: "architect", layer: "role", overview: "we design", avoid: ["one avoidance"] });
const DOMAIN = pin({
  id: "code",
  layer: "domain",
  overview: "we read code",
  invariants: ["one invariant", "a domain invariant"],
});

const ENVIRONMENT = "Pi's own prompt.\n\n## Project context\nAGENTS.md";

/** The exact bytes: three layers, the advisory line once, the environment last and verbatim. */
test("conduct, role and domain compose to one document, environment last", () => {
  const composed = composeSystemPrompt({ conduct: CONDUCT, role: ROLE, domains: [DOMAIN], environment: ENVIRONMENT });
  const body = [
    "# Conduct \u2014 occam v1",
    "",
    "we lead with evidence",
    "",
    "the flowing spine",
    "",
    "## Invariants",
    "- one invariant",
    "",
    "# Role \u2014 architect v1",
    "",
    "we design",
    "",
    "## Avoid",
    "- one avoidance",
    "",
    "# Domain \u2014 code v1",
    "",
    "we read code",
    "",
    "## Invariants",
    "- a domain invariant",
    "",
    PROMPT_ADVISORY,
    "",
    "# Environment",
    "",
    ENVIRONMENT,
  ].join("\n");
  assert.equal(composed.text, composed.marker + "\n\n" + body);
  assert.equal(composed.digests.composed, digest(body));
  assert.deepEqual(composed.sections, ["conduct", "role", "domain", "environment"]);
});

/** An obligation stated twice is stated once, and it stays where it first appeared. */
test("a duplicate entry appears once, in the layer that stated it first", () => {
  const composed = composeSystemPrompt({ conduct: CONDUCT, role: ROLE, domains: [DOMAIN], environment: "env" });
  assert.equal(composed.text.split("- one invariant").length - 1, 1, "the shared invariant is stated once");
  assert.equal(composed.text.includes("- a domain invariant"), true);
  assert.ok(composed.text.indexOf("- one invariant") < composed.text.indexOf("# Role"), "in the conduct block");
});

/** No domain: no block, and no empty heading anywhere. */
test("an empty domain list omits the block entirely", () => {
  const composed = composeSystemPrompt({ conduct: CONDUCT, role: ROLE, environment: "env" });
  assert.equal(composed.text.includes("# Domain"), false);
  assert.deepEqual(composed.sections, ["conduct", "role", "environment"]);
  assert.equal(composed.text.includes("## Examples"), false);
});

/** The advisory line: once, after the layers, before the environment (lead ruling Q2). */
test("the advisory line appears exactly once, before the environment block", () => {
  const composed = composeSystemPrompt({ conduct: CONDUCT, role: ROLE, domains: [DOMAIN], environment: "env" });
  assert.equal(composed.text.split(PROMPT_ADVISORY).length - 1, 1);
  assert.ok(composed.text.indexOf(PROMPT_ADVISORY) < composed.text.indexOf("# Environment"));
  assert.ok(composed.text.indexOf("# Environment") < composed.text.indexOf("env", composed.text.indexOf("# Environment")));
});

/** The environment is nested verbatim and LAST: Pi's prompt is never first and never altered. */
test("the environment block is the input prompt, verbatim, and closes the document", () => {
  const composed = composeSystemPrompt({ conduct: CONDUCT, role: ROLE, environment: ENVIRONMENT });
  assert.equal(composed.text.endsWith("# Environment\n\n" + ENVIRONMENT), true);
  assert.equal(composed.text.includes(ENVIRONMENT), true);
  const firstHeading = composed.text.indexOf("# Conduct");
  assert.ok(firstHeading > 0 && firstHeading < composed.text.indexOf("# Environment"));
});

/** The marker: an idempotence handle that also names every layer with its version and the composed digest. */
test("the marker names every layer, its version and the composed digest", () => {
  const composed = composeSystemPrompt({ conduct: CONDUCT, role: ROLE, domains: [DOMAIN], environment: "env" });
  assert.equal(composed.text.startsWith(PROMPT_MARKER_PREFIX), true);
  assert.match(composed.marker, /^<!-- praxis:system-prompt v1 \| conduct=occam@1 role=architect@1 domain=code@1 \| sha256:[0-9a-f]{16} -->$/);
  assert.equal(composed.marker.includes(composed.digests.composed.slice(7, 23)), true);
  assert.equal(isComposedPrompt(composed.text), true);
  assert.equal(isComposedPrompt("Pi's own prompt"), false);
  // A composed prompt is recognised, so a second boundary nests nothing.
  assert.equal(composed.text.split("# Environment").length - 1, 1);
});

/** Determinism: the same input composes byte-identically, which is what the trace line compares. */
test("composition is deterministic and the layer digests are carried through", () => {
  const one = composeSystemPrompt({ conduct: CONDUCT, role: ROLE, domains: [DOMAIN], environment: "env" });
  const two = composeSystemPrompt({ conduct: CONDUCT, role: ROLE, domains: [DOMAIN], environment: "env" });
  assert.equal(one.text, two.text);
  assert.deepEqual(one.digests, two.digests);
  assert.deepEqual(one.digests.domains, [DOMAIN.digest]);
  assert.equal(one.digests.conduct, CONDUCT.digest);
  assert.equal(one.digests.role, ROLE.digest);
});
