import assert from "node:assert/strict";
import test from "node:test";
import { cpSync, readFileSync, writeFileSync } from "node:fs";

import { artifactFile, cli, createInstance, dispose, instanceRow, workspace } from "../testkit.ts";

/**
 * Layer 1: the shipped `v2` flow judges real documents, good and deficient. The frozen
 * `delivery.json` is no longer loadable after the default-path ruling, so the fixture
 * copies the emitted nodes/edges document and the task library it composes.
 */
function writeDeliveryFlow(ws: ReturnType<typeof workspace>): void {
  const text = readFileSync(new URL("../praxis-schemas/flows/workflow.json", import.meta.url), "utf8");
  const document = JSON.parse(text) as { flow: string };
  document.flow = "flows/delivery";
  writeFileSync(ws.config, JSON.stringify(document, null, 2) + "\n");
  cpSync(new URL("../praxis-schemas/tasks", import.meta.url), ws.tasks, { recursive: true });
}

const SCHEMA = "praxis.artifact.delivery/v1";

const goodResearch = {
  contract: { task: "gate the delivery documents", scope: "src/runner", acceptance: "gates refuse incomplete documents" },
  question: { question: "does the gate catch what a reader misses?", boundary: "runner and schema only" },
  sources: [
    { source: "engine.ts", location: "src/runner/engine.ts:355", establishes: "the gate receives step.requires", freshness: "read today" },
    { source: "requirements.ts", location: "src/runner/requirements.ts:17", establishes: "missingFor reports every gap", freshness: "read today" },
    { source: "WORKFLOW.md", location: "docs/WORKFLOW.md:74", establishes: "G1 demands sources at path:line", freshness: "read today" },
  ],
  explanations: [
    { explanation: "the gate is too weak", evidence: "one section per step", distinguishing: "a multi-clause stage still accepts", status: "leading" },
    { explanation: "the documents were never complete", evidence: "no template check existed", distinguishing: "the template enumerates sections", status: "eliminated" },
  ],
  findings: ["the shipped flow demanded four sections of eight"],
  affected: [{ path: "src/runner/engine.ts", declaration: "advance", callers: "src/pi/tool.ts", effect: "gate input widens" }],
  uncertainty: ["no measurement of authoring cost yet"],
};

/** The same document as an agent writes it to markdown: prose, URLs, no analysis. */
const markdownGradeResearch = {
  contract: { task: "gate the delivery documents" },
  question: { question: "does the gate catch what a reader misses?" },
  sources: [{ source: "stripe docs", url: "https://docs.stripe.com/api" }],
  findings: ["looks fine"],
};

test("a document that satisfies every clause of the templates passes", async () => {
  const ws = workspace();
  try {
    writeDeliveryFlow(ws);
    const { instance, nonce } = await createInstance(ws, "delivery", "req-layer1-good");
    const run = await cli(ws, ["resume", instance, "--artifact", artifactFile(ws, "research.json", { schema: SCHEMA, nonce, ...goodResearch })]);
    assert.equal(run.status, 0, JSON.stringify(run.lines));
    assert.equal(instanceRow(ws, instance)?.current_step, "spec");
  } finally {
    dispose(ws);
  }
});

test("a markdown-grade document is refused at submit with the exact gaps", async () => {
  const ws = workspace();
  try {
    writeDeliveryFlow(ws);
    const { instance, nonce } = await createInstance(ws, "delivery", "req-layer1-bad");
    const run = await cli(ws, ["resume", instance, "--artifact", artifactFile(ws, "research.md.json", { schema: SCHEMA, nonce, ...markdownGradeResearch })]);
    assert.equal(run.status, 1, "an incomplete document cannot advance");
    const error = run.lines.find((line) => line.error !== undefined)?.error as { code: string; detail?: { missing?: string[] } };
    assert.equal(error.code, "ARTIFACT_INVALID");
    const missing = error.detail?.missing ?? [];
    for (const gap of ["contract.scope", "contract.acceptance", "question.boundary", "sources: needs 3 items, has 1", "sources[0].location", "explanations", "affected", "uncertainty"]) {
      assert.ok(missing.includes(gap), "expected gap " + gap + " in " + JSON.stringify(missing));
    }
    assert.equal(instanceRow(ws, instance)?.current_step, "research", "the instance does not move");
  } finally {
    dispose(ws);
  }
});
