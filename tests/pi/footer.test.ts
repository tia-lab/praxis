/**
 * The status footer: what it shows for a given active-instance state, that it is blank when the session
 * has none, that it is right-aligned in the width Pi hands it, and that publishing it never changes a
 * call's result. The envelopes below are shaped like the real ones (types/pi.ts:158-200,
 * schema.ts:448-455); no store, engine or tool runs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FOOTER_WIDGET_KEY, flowLabel, footerLabel, nextFooterState, publishFooter, rightAlign, withFooter } from "../../src/pi/footer.ts";
import type { PiFooterUi, PiSessionContext, PiToolDefinition, PiToolResult } from "../../src/pi/host.ts";
import { artifacts, fakeContext, tempStore, useAlignedJudge } from "./fixtures.ts";
import { executePraxisTool } from "../../src/pi/tool.ts";


const flow = "flows/delivery";
const startEnvelope = {
  result: { instanceId: "inst-1", flow, status: "active", artifacts: [], summary: "s", nextAction: "n" },
  step: { id: "research", capabilities: ["artifact.write"], ops: ["submit", "read", "note", "check"], steps: ["research", "spec"] },
  nonce: "n1",
};
const checkEnvelope = { ok: false, missing: ["findings"], step: "spec" };
const readEnvelope = { artifact: { step: "research", version: 1, digest: "sha256:" + "a".repeat(64), schema: null, state: "accepted" }, value: {} };
const failure = { code: "CONFIG_INVALID", message: "praxis arguments is invalid" };

/** Records every setWidget call; the factory is captured, not invoked. */
function fakeUi(): { ui: PiFooterUi; calls: { key: string; content: unknown; options: unknown }[] } {
  const calls: { key: string; content: unknown; options: unknown }[] = [];
  return {
    calls,
    ui: {
      setWidget(key, content, options) {
        calls.push({ key, content, options });
      },
    },
  };
}

type Factory = (tui: unknown, theme: { fg: (c: string, t: string) => string }) => { render: (w: number) => string[]; invalidate: () => void };

test("the footer derives flow and step from a start result", () => {
  assert.deepEqual(nextFooterState(undefined, startEnvelope), { flow, step: "research" });
});

test("submit and note results refresh both halves", () => {
  const previous = { flow, step: "research" };
  const submit = { result: startEnvelope.result, step: { ...startEnvelope.step, id: "spec" } };
  assert.deepEqual(nextFooterState(previous, submit), { flow, step: "spec" });
  const note = { ...submit, result: { ...startEnvelope.result, flow: "flows/bugfix" }, step: { ...startEnvelope.step, id: "implement" } };
  assert.deepEqual(nextFooterState(previous, note), { flow: "flows/bugfix", step: "implement" });
});

test("a check result moves the step and keeps the flow it last saw", () => {
  assert.deepEqual(nextFooterState({ flow, step: "spec" }, checkEnvelope), { flow, step: "spec" });
  assert.deepEqual(nextFooterState({ flow, step: "spec" }, { ok: true, missing: [], step: "plan" }), { flow, step: "plan" });
});

test("a check result on a session with no instance stays blank", () => {
  assert.equal(nextFooterState(undefined, checkEnvelope), undefined);
});

test("read, recall and failure results leave the footer untouched", () => {
  const previous = { flow, step: "research" };
  assert.deepEqual(nextFooterState(previous, readEnvelope), previous);
  assert.deepEqual(nextFooterState(previous, { need: "n", count: 0, truncated: false, cases: [] }), previous);
  assert.deepEqual(nextFooterState(previous, failure), previous);
  assert.equal(nextFooterState(undefined, failure), undefined);
  assert.equal(nextFooterState(undefined, readEnvelope), undefined);
});

test("the label is 'praxis: <flow name> · <step>'", () => {
  assert.equal(flowLabel(flow), "delivery");
  assert.equal(flowLabel("flows/core/review"), "review");
  assert.equal(footerLabel({ flow, step: "research" }), "praxis: delivery · research");
});

test("rightAlign pads to the width and clips when the width is smaller", () => {
  const line = footerLabel({ flow, step: "research" });
  const wide = rightAlign(line, 40);
  assert.equal(wide.length, 40);
  assert.equal(wide.endsWith(line), true);
  assert.equal(wide.startsWith(" "), true);
  assert.equal(rightAlign(line, line.length).length, line.length);
  assert.equal(rightAlign(line, 5), line.slice(0, 5));
  assert.equal(rightAlign(line, 0), "");
  assert.equal(rightAlign(line, Number.NaN), "");
});

test("publishing over the prompt bar passes the aboveEditor placement and renders right-aligned", () => {
  const { ui, calls } = fakeUi();
  publishFooter(ui, { flow, step: "research" });
  assert.equal(calls.length, 1);
  const call = calls[0]!;
  assert.equal(call.key, FOOTER_WIDGET_KEY);
  assert.deepEqual(call.options, { placement: "aboveEditor" });
  const factory = call.content as Factory;
  const theme = { fg: (_color: string, text: string) => text };
  const lines = factory(undefined, theme).render(40);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.length, 40);
  assert.equal(lines[0]!.endsWith("praxis: delivery · research"), true);
  assert.equal(lines[0]!.slice(0, 40 - "praxis: delivery · research".length), " ".repeat(40 - "praxis: delivery · research".length));
});

test("no active instance removes the element and print mode draws nothing", () => {
  const { ui, calls } = fakeUi();
  publishFooter(ui, undefined);
  assert.deepEqual(calls, [{ key: FOOTER_WIDGET_KEY, content: undefined, options: undefined }]);
  const silent = fakeUi();
  publishFooter(undefined, { flow, step: "research" });
  assert.deepEqual(silent.calls, []);
  publishFooter({}, { flow, step: "research" });
  assert.deepEqual(silent.calls, []);
});

/** A stand-in for the real tool: returns whatever the step under test produces, and records the ctx. */
function fakeDefinition(details: unknown): { definition: PiToolDefinition; calls: { details: unknown; result: PiToolResult }[] } {
  const calls: { details: unknown; result: PiToolResult }[] = [];
  const result: PiToolResult = { content: [{ type: "text", text: JSON.stringify(details) }], details };
  return {
    calls,
    definition: {
      name: "praxis",
      label: "Praxis",
      description: "d",
      parameters: {},
      async execute() {
        calls.push({ details, result });
        return result;
      },
    },
  };
}

function ctxWith(ui: PiFooterUi | undefined, sessionId: string): PiSessionContext {
  return { cwd: "/tmp", sessionManager: { getSessionId: () => sessionId }, ui };
}

test("the wrapper publishes from each result and returns the very same object", async () => {
  const { definition, calls: executed } = fakeDefinition(startEnvelope);
  const { ui, calls } = fakeUi();
  const wrapped = withFooter(definition);
  const result = await wrapped.execute("call-1", {}, undefined, undefined, ctxWith(ui, "s1"));
  assert.equal(result, executed[0]!.result, "the wrapper returns the definition's own result object");
  assert.deepEqual(result.details, startEnvelope);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.key, FOOTER_WIDGET_KEY);
});

test("the wrapper publishes once per changed state and clears on a session switch", async () => {
  const { ui, calls } = fakeUi();
  const start = withFooter(fakeDefinition(startEnvelope).definition);
  const ctx = ctxWith(ui, "s1");
  await start.execute("c1", {}, undefined, undefined, ctx);
  await start.execute("c2", {}, undefined, undefined, ctx);
  assert.equal(calls.length, 1, "an unchanged state does not re-render");
  await start.execute("c3", {}, undefined, undefined, ctxWith(ui, "s2"));
  assert.equal(calls.length, 2, "a new session publishes the new session's state");
});

test("a failure leaves the footer alone and a throwing UI cannot fail the call", async () => {
  const { ui, calls } = fakeUi();
  const wrapped = withFooter(fakeDefinition(failure).definition);
  const result = await wrapped.execute("c1", {}, undefined, undefined, ctxWith(ui, "s1"));
  assert.deepEqual(result.details, failure);
  assert.deepEqual(calls, []);

  const exploding = withFooter(fakeDefinition(startEnvelope).definition);
  const hostile: PiFooterUi = { setWidget() { throw new Error("boom"); } };
  const still = await exploding.execute("c1", {}, undefined, undefined, ctxWith(hostile, "s1"));
  assert.deepEqual(still.details, startEnvelope);
});

/** The real tool, wrapped: the engine actually runs, so the footer is proven against live state. */
test("a real start and submit move the footer with the live instance", async () => {
  useAlignedJudge();
  const project = tempStore().cwd;
  const { ui, calls } = fakeUi();
  const wrapped = withFooter({
    name: "praxis",
    label: "Praxis",
    description: "d",
    parameters: {},
    async execute(_id, params, _signal, _onUpdate, ctx) {
      return executePraxisTool(params, ctx);
    },
  });
  const ctx: PiSessionContext = { ...fakeContext({ cwd: project, sessionId: "session-footer" }), ui };

  const started = await wrapped.execute(
    "c1",
    { op: "start", order: "carry out the task this flow runs", flow: "flows/architect", requestId: "req-1" },
    undefined,
    undefined,
    ctx,
  );
  const first = started.details as { nonce: string; result: { instanceId: string; flow: string }; step: { id: string } };
  assert.equal(calls.length, 1, "start publishes exactly one footer");
  const labelOf = (index: number): string => {
    const factory = calls[index]!.content as Factory;
    return factory(undefined, { fg: (_c: string, t: string) => t }).render(80)[0]!.trim();
  };
  assert.equal(labelOf(0), footerLabel({ flow: first.result.flow, step: first.step.id }));

  const submitted = await wrapped.execute(
    "c2",
    { op: "submit", instance: first.result.instanceId, artifact: artifacts.validA(first.nonce) },
    undefined,
    undefined,
    ctx,
  );
  const second = submitted.details as { result: { flow: string }; step: { id: string } };
  assert.equal(calls.length, 2, "a new step publishes again");
  assert.equal(labelOf(1), footerLabel({ flow: second.result.flow, step: second.step.id }));
  assert.notEqual(labelOf(0), labelOf(1));

  // Reading back the accepted predecessor: a real read that carries no position, so nothing re-renders.
  const read = await wrapped.execute(
    "c3",
    { op: "read", instance: first.result.instanceId, step: first.step.id },
    undefined,
    undefined,
    ctx,
  );
  assert.equal((read.details as { artifact?: { step?: string } }).artifact?.step, first.step.id);
  assert.equal(calls.length, 2, "a read republishes nothing: the position did not change");
});
