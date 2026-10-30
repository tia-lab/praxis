/**
 * The extension entry point (R1, R11): one tool, no hook, and a parameter document
 * that the host's validator will accept for a real call and refuse for an unknown key.
 *
 * Limitation, stated rather than hidden: the Pi host package and TypeBox are not
 * resolvable from this project (R9 forbids adding them), so `accepts()` below checks
 * the three keywords the generated document actually declares (`required`,
 * `additionalProperties:false`, per-property `enum`) instead of compiling it with the
 * host's own validator. The document itself is asserted separately, so the test cannot
 * pass on a hand-written schema that drifted from the Zod authority.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import praxisExtension from "../../src/pi/extension.ts";
import { PRAXIS_TOOL_NAME, PRAXIS_TOOL_PARAMETERS } from "../../src/pi/tool.ts";
import type { PiHost, PiToolDefinition } from "../../src/pi/host.ts";

interface FakeHost {
  host: PiHost;
  tools: PiToolDefinition[];
  otherRegistrations: string[];
}

/** A host that records tool registrations and every other surface a hook would use. */
function fakeHost(): FakeHost {
  const tools: PiToolDefinition[] = [];
  const otherRegistrations: string[] = [];
  const record = (name: string) => (...args: unknown[]): void => {
    otherRegistrations.push(name + ":" + String(args[0]));
  };
  const host = {
    registerTool: (tool: PiToolDefinition): void => {
      tools.push(tool);
    },
    on: record("on"),
    registerCommand: record("registerCommand"),
    registerShortcut: record("registerShortcut"),
    registerProvider: record("registerProvider"),
  } as unknown as PiHost;
  return { host, tools, otherRegistrations };
}

const document: any = PRAXIS_TOOL_PARAMETERS as any;

/** The declared validation surface: required, additionalProperties:false and enum. */
function accepts(parameters: any, value: Record<string, unknown>): boolean {
  const properties = parameters.properties ?? {};
  const required: string[] = parameters.required ?? [];
  if (required.some((key) => !(key in value))) return false;
  if (parameters.additionalProperties === false && Object.keys(value).some((key) => !(key in properties))) return false;
  return Object.keys(value).every((key) => {
    const spec = properties[key];
    return spec?.enum === undefined || spec.enum.includes(value[key]);
  });
}

test("one registerTool", () => {
  const { host, tools } = fakeHost();
  praxisExtension(host);
  assert.equal(tools.length, 1);
  const [tool] = tools;
  assert.equal(tool.name, PRAXIS_TOOL_NAME);
  assert.equal(tool.name, "praxis");
  assert.equal(typeof tool.label, "string");
  assert.equal(typeof tool.description, "string");
  assert.equal(tool.executionMode, "sequential");
  assert.equal(typeof tool.execute, "function");
  assert.equal(tool.execute.length, 5);
  assert.equal(tool.parameters, PRAXIS_TOOL_PARAMETERS);
});

test("no tool_call registration", () => {
  const { host, otherRegistrations } = fakeHost();
  praxisExtension(host);
  assert.deepEqual([...otherRegistrations], []);
  assert.equal(otherRegistrations.length, 0);
});

test("parameters accept start", () => {
  assert.deepEqual(document.required, ["op"]);
  assert.equal(document.additionalProperties, false);
  assert.deepEqual(document.properties.op.enum, ["start", "submit", "read", "note", "check", "issue.template", "issue.open"]);
  assert.deepEqual(Object.keys(document.properties).sort(), [
    "affected", "artifact", "category", "categoryFields", "evidence", "flow",
    "instance", "op", "requestId", "roles", "severity", "step", "subjective", "summary", "title",
  ]);
  assert.equal(accepts(document, { op: "start", flow: "flows/architect", requestId: "pi-e2e-1" }), true);
  assert.equal(accepts(document, { op: "start", flow: "flows/architect" }), true);
});

test("parameters reject unknown key", () => {
  assert.equal(accepts(document, { op: "start", flow: "flows/architect", requestId: "r1", actor: "cli" }), false);
  assert.equal(accepts(document, { op: "status" }), false);
});
