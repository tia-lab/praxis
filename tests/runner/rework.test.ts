import assert from "node:assert/strict";
import test from "node:test";
import { artifactsOf, artifactFile, cli, createInstance, dispose, eventsOf, instanceRow, workspace, writeFlow } from "../testkit.ts";

const PLAN = "praxis.artifact.plan/v1";
const REVIEW = "praxis.artifact.review/v1";

function writeLoopFlow(ws: ReturnType<typeof workspace>, flow: string): void {
  writeFlow(
    ws,
    flow,
    [
      {
        id: "plan",
        capabilities: ["artifact.write", "emit"],
        schema: PLAN,
        requires: { section: "plan", required: ["steps"] },
      },
      {
        id: "review",
        capabilities: ["artifact.read", "artifact.write", "emit"],
        schema: REVIEW,
        requires: { section: "review", required: ["verdict"], equals: { verdict: "PASS" } },
      },
    ],
    [
      { kind: "data", from: "plan", to: "review" },
      { kind: "refuse", from: "review", to: "plan" },
    ],
  );
}

test("a refused review sends the work back to the stage it names", async () => {
  const ws = workspace();
  try {
    writeLoopFlow(ws, "loop");
    const { instance, nonce } = await createInstance(ws, "loop", "req-rework-1");
    const plan = (steps: string[]) => ({ schema: PLAN, nonce, plan: { steps } });

    const first = await cli(ws, ["resume", instance, "--artifact", artifactFile(ws, "plan1.json", plan(["write"]))]);
    assert.equal(first.status, 0, JSON.stringify(first.lines));
    assert.equal(instanceRow(ws, instance)?.current_step, "review");

    const planDigest = () => {
      const rows = artifactsOf(ws, instance).filter((entry) => entry.state === "accepted");
      return rows[rows.length - 1]!.digest;
    };
    const failed = await cli(ws, ["resume", instance, "--artifact", artifactFile(ws, "review1.json", { schema: REVIEW, nonce, derivedFrom: planDigest(), review: { verdict: "FAIL" } })]);
    assert.equal(failed.status, 1);
    const detail = failed.lines.find((line) => line.error !== undefined)?.error as { code: string; detail?: { reworkTo?: string } };
    assert.equal(detail.code, "ARTIFACT_INVALID");
    assert.equal(detail.detail?.reworkTo, "plan");
    assert.equal(instanceRow(ws, instance)?.current_step, "plan", "the refusal moves the work back");
    assert.equal(instanceRow(ws, instance)?.status, "running");

    const amended = await cli(ws, ["resume", instance, "--artifact", artifactFile(ws, "plan2.json", plan(["write", "check"]))]);
    assert.equal(amended.status, 0, JSON.stringify(amended.lines));
    assert.equal(instanceRow(ws, instance)?.current_step, "review");

    const passed = await cli(ws, ["resume", instance, "--artifact", artifactFile(ws, "review2.json", { schema: REVIEW, nonce, derivedFrom: planDigest(), review: { verdict: "PASS" } })]);
    assert.equal(passed.status, 0, JSON.stringify(passed.lines));
    assert.equal(instanceRow(ws, instance)?.status, "completed");
  } finally {
    dispose(ws);
  }
});

test("a stage without onRefuse keeps itself current", async () => {
  const ws = workspace();
  try {
    writeLoopFlow(ws, "loop2");
    const { instance, nonce } = await createInstance(ws, "loop2", "req-rework-2");
    await cli(ws, ["resume", instance, "--artifact", artifactFile(ws, "p.json", { schema: PLAN, nonce, plan: { steps: ["a"] } })]);
    const rows = artifactsOf(ws, instance).filter((entry) => entry.state === "accepted");
    const failed = await cli(ws, ["resume", instance, "--artifact", artifactFile(ws, "r.json", { schema: REVIEW, nonce, derivedFrom: rows[rows.length - 1]!.digest, review: { verdict: "FAIL" } })]);
    assert.equal(failed.status, 1);
    assert.equal(instanceRow(ws, instance)?.current_step, "plan", "declared edge applied");
    const pending = artifactsOf(ws, instance).filter((a) => a.state === "pending").length;
    assert.equal(pending, 1, "the refused review stays as evidence");
    assert.ok(eventsOf(ws, instance).some((e) => e.type === "gate.verdict"));
  } finally {
    dispose(ws);
  }
});
