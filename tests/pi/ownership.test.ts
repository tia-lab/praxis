/**
 * Unit F: instance ownership. The actor↔instance binding is enforced only at `start`
 * today; these cases prove `submit` and `read` now refuse an actor that does not own the
 * instance, with the typed `INSTANCE_FORBIDDEN`, while the owner still passes. The check is
 * routed-path authority only — it does not restrict tools and does not protect the store from
 * direct access (the host-seam unit, later).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { executePraxisTool } from "../../src/pi/tool.ts";
import type { PiToolResult } from "../../src/pi/host.ts";
import { artifacts, fakeContext, tempStore } from "./fixtures.ts";

const OWNER = "session-owner";
const INTRUDER = "session-intruder";

const run = (cwd: string, args: unknown, sessionId: string): PiToolResult =>
  executePraxisTool(args, fakeContext({ cwd, sessionId }));
const bag = (result: PiToolResult): any => result.details;

/** Start as OWNER and return the instance id + nonce for the intruder cases. */
function ownerInstance(cwd: string): { instance: string; nonce: string } {
  const started = bag(run(cwd, { op: "start", flow: "flows/architect", requestId: "own-1" }, OWNER));
  return { instance: started.result.instanceId as string, nonce: started.nonce as string };
}

test("the owner can submit into its own instance", () => {
  const cwd = tempStore().cwd;
  const { instance, nonce } = ownerInstance(cwd);
  const owner = run(cwd, { op: "submit", instance, artifact: artifacts.validA(nonce) }, OWNER);
  assert.ok(!owner.isError, "owner submit should succeed");
});

test("a second actor cannot submit into an instance it does not own", () => {
  const cwd = tempStore().cwd;
  const { instance, nonce } = ownerInstance(cwd);
  const intruder = run(cwd, { op: "submit", instance, artifact: artifacts.validA(nonce) }, INTRUDER);
  assert.equal(intruder.isError, true);
  assert.equal(bag(intruder).code, "INSTANCE_FORBIDDEN");
});

test("a second actor cannot read an instance it does not own", () => {
  const cwd = tempStore().cwd;
  const { instance, nonce } = ownerInstance(cwd);
  // owner advances once so there is an accepted artifact to read
  run(cwd, { op: "submit", instance, artifact: artifacts.validA(nonce) }, OWNER);
  const intruder = run(cwd, { op: "read", instance, step: "draft" }, INTRUDER);
  assert.equal(intruder.isError, true);
  assert.equal(bag(intruder).code, "INSTANCE_FORBIDDEN");
});

test("the ownership refusal precedes artifact validation", () => {
  const cwd = tempStore().cwd;
  const { instance } = ownerInstance(cwd);
  // a garbage artifact from a non-owner is refused for ownership, not for its shape
  const intruder = run(cwd, { op: "submit", instance, artifact: { not: "valid" } }, INTRUDER);
  assert.equal(intruder.isError, true);
  assert.equal(bag(intruder).code, "INSTANCE_FORBIDDEN");
});
