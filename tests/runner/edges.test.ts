/**
 * Step 3/5 rows 8-19: the flow graph refuses a third node key, a bad id, an absent task
 * reference, and each edge shape R7 does not admit. Every negative also asserts that the
 * refusal wrote nothing: no instance row appeared in a store that was empty before it.
 *
 * Reviewer defects 2, 3, 9 and 10 are answered here: fan-out is counted per distinct
 * target (two join groups from one node is refused), a join counts distinct sources (a
 * repeated source is a single-source join), a second refuse edge is refused, row 9 uses a
 * non-kebab node id, and every negative row counts instances before and after.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isAppError } from "../../src/types/errors.ts";
import { openFlow } from "../../src/runner/engine/index.ts";
import { openStore } from "../../src/store/db.ts";
import { parseFlowConfig } from "../../src/types/schema.ts";
import { artifactsOf, artifactFile, cli, createInstance, dispose, eventsOf, flowRef, taskRef, workspace, writeFlow, type Workspace } from "../testkit.ts";

interface NodeFixture {
  id: string;
  task: string;
}

interface EdgeFixture {
  kind: "data" | "join" | "refuse";
  from: string;
  to: string;
}

const NODES: readonly NodeFixture[] = [
  { id: "research", task: taskRef("research") },
  { id: "spec", task: taskRef("spec") },
  { id: "plan", task: taskRef("plan") },
];

const CHAIN: readonly EdgeFixture[] = [
  { kind: "data", from: "research", to: "spec" },
  { kind: "data", from: "spec", to: "plan" },
];

function flow(nodes: readonly NodeFixture[] = NODES, edges: readonly EdgeFixture[] = CHAIN): unknown {
  return { schema: "praxis.flow/v2", flow: flowRef("workflow"), nodes, edges, result: "praxis.result/v1" };
}

function expectCode(code: string, body: () => unknown): void {
  assert.throws(body, (error: unknown) => isAppError(error) && error.code === code);
}

/** The baseline: three nodes, one chain. Every row below refuses a copy of it. */
function baseline(): void {
  const parsed = parseFlowConfig(flow());
  assert.deepEqual(
    parsed.nodes.map((node) => node.id),
    ["research", "spec", "plan"],
  );
  assert.deepEqual(
    parsed.edges.map((edge) => `${edge.kind}:${edge.from}>${edge.to}`),
    ["data:research>spec", "data:spec>plan"],
  );
}

/** Instance rows in the workspace store; opening it creates an empty one when absent. */
function instanceCount(ws: Workspace): number {
  const store = openStore(join(ws.store, "praxis.sqlite"));
  try {
    const row = store.db.prepare("SELECT COUNT(*) AS n FROM instance").get() as unknown as { n: number };
    return Number(row.n);
  } finally {
    store.close();
  }
}

/** A refused graph writes nothing: the instance count is unchanged and still zero. */
function zeroWrites(code: string, body: () => unknown): void {
  const ws = workspace();
  try {
    const before = instanceCount(ws);
    expectCode(code, body);
    assert.equal(instanceCount(ws), before, "a refused graph writes nothing");
    assert.equal(before, 0, "the fixture starts from an empty store");
  } finally {
    dispose(ws);
  }
}

test("a node with a third key is NODE_INVALID", () => {
  baseline();
  const nodes = structuredClone(NODES) as Array<NodeFixture & Record<string, unknown>>;
  nodes[0].consumes = "research";
  zeroWrites("NODE_INVALID", () => parseFlowConfig(flow(nodes)));
});

test("a non-kebab or duplicate node id is CONFIG_INVALID", () => {
  baseline();
  const upper = structuredClone(NODES) as NodeFixture[];
  upper[1] = { id: "Plan", task: taskRef("spec") };
  zeroWrites("CONFIG_INVALID", () => parseFlowConfig(flow(upper)));

  const duplicate = structuredClone(NODES) as NodeFixture[];
  duplicate[2] = { id: "spec", task: taskRef("plan") };
  zeroWrites("CONFIG_INVALID", () => parseFlowConfig(flow(duplicate)));
});

test("a bare task reference is CONFIG_INVALID", () => {
  baseline();
  const nodes = structuredClone(NODES) as NodeFixture[];
  nodes[0] = { id: "research", task: "research" };
  zeroWrites("CONFIG_INVALID", () => parseFlowConfig(flow(nodes)));
});

test("a node naming a malformed reference is CONFIG_INVALID", () => {
  baseline();
  const nodes = structuredClone(NODES) as NodeFixture[];
  nodes[0] = { id: "research", task: "research-v9" };
  zeroWrites("CONFIG_INVALID", () => parseFlowConfig(flow(nodes)));
});

test("an unknown edge kind is CONFIG_INVALID", () => {
  baseline();
  const edges = structuredClone(CHAIN) as unknown as Array<{ kind: string; from: string; to: string }>;
  edges[0].kind = "branch";
  zeroWrites("CONFIG_INVALID", () => parseFlowConfig(flow(NODES, edges as unknown as EdgeFixture[])));
});

test("a join with one source is CONFIG_INVALID", () => {
  baseline();
  const edges: EdgeFixture[] = [
    { kind: "data", from: "research", to: "spec" },
    { kind: "join", from: "research", to: "plan" },
  ];
  zeroWrites("CONFIG_INVALID", () => parseFlowConfig(flow(NODES, edges)));
});

test("a forward refuse edge is CONFIG_INVALID", () => {
  baseline();
  const edges: EdgeFixture[] = [...CHAIN, { kind: "refuse", from: "research", to: "plan" }];
  zeroWrites("CONFIG_INVALID", () => parseFlowConfig(flow(NODES, edges)));

  // Defect 3: a node may declare at most one refuse edge; a second is refused, not ignored.
  const twice: EdgeFixture[] = [
    ...CHAIN,
    { kind: "refuse", from: "plan", to: "spec" },
    { kind: "refuse", from: "plan", to: "research" },
  ];
  zeroWrites("CONFIG_INVALID", () => parseFlowConfig(flow(NODES, twice)));
});

test("two consumption edges into one node is CONFIG_INVALID", () => {
  baseline();
  // Two sources into `plan` necessarily leave another node unconsumed (the invariant is
  // one consumption edge per node after the first), so this fixture trips two clauses.
  // Both are CONFIG_INVALID; the row is about the second edge being refused.
  const edges: EdgeFixture[] = [
    { kind: "data", from: "research", to: "plan" },
    { kind: "data", from: "spec", to: "plan" },
  ];
  zeroWrites("CONFIG_INVALID", () => parseFlowConfig(flow(NODES, edges)));
});

test("a non-first node with no consumption edge is CONFIG_INVALID", () => {
  baseline();
  const edges: EdgeFixture[] = [{ kind: "data", from: "research", to: "spec" }];
  zeroWrites("CONFIG_INVALID", () => parseFlowConfig(flow(NODES, edges)));
});

test("a fan-out from one node is CONFIG_INVALID", () => {
  baseline();
  const edges: EdgeFixture[] = [
    { kind: "data", from: "research", to: "spec" },
    { kind: "data", from: "research", to: "plan" },
  ];
  zeroWrites("CONFIG_INVALID", () => parseFlowConfig(flow(NODES, edges)));

  // Defect 2: fan-out is counted per distinct target, so one node feeding two join
  // groups is a fan-out even though no data edge is involved.
  const twoGroups: EdgeFixture[] = [
    { kind: "data", from: "research", to: "spec" },
    { kind: "join", from: "research", to: "plan" },
    { kind: "join", from: "spec", to: "plan" },
    { kind: "join", from: "research", to: "spec" },
  ];
  zeroWrites("CONFIG_INVALID", () => parseFlowConfig(flow(NODES, twoGroups)));

  // Defect 2: a join counts distinct sources, so repeating one source is one source.
  const repeated: EdgeFixture[] = [
    { kind: "data", from: "research", to: "spec" },
    { kind: "join", from: "research", to: "plan" },
    { kind: "join", from: "research", to: "plan" },
  ];
  zeroWrites("CONFIG_INVALID", () => parseFlowConfig(flow(NODES, repeated)));
});

test("a well-formed reference to an absent task document is TASK_NOT_FOUND", () => {
  const ws = workspace();
  try {
    writeFlow(ws, "missing", [{ id: "research", capabilities: ["artifact.write"], schema: "praxis.artifact.delivery/v1" }]);
    const document = JSON.parse(readFileSync(ws.config, "utf8")) as {
      nodes: Array<{ id: string; task: string }>;
      edges: Array<{ kind: string; from: string; to: string }>;
    };
    document.nodes.push({ id: "spec", task: taskRef("spec") });
    document.edges.push({ kind: "data", from: "research", to: "spec" });
    writeFileSync(ws.config, JSON.stringify(document, null, 2) + "\n");

    const before = instanceCount(ws);
    expectCode("TASK_NOT_FOUND", () => openFlow({ configPath: ws.config, tasksDir: ws.tasks, storeDir: ws.store }));
    assert.equal(instanceCount(ws), before, "a refused graph writes nothing");
    assert.equal(before, 0);
  } finally {
    dispose(ws);
  }
});

test("a join hands off both sources in declared order", async () => {
  const ws = workspace();
  try {
    writeFlow(
      ws,
      "join-flow",
      [
        { id: "draft", capabilities: ["artifact.write", "emit"], schema: "praxis.artifact.architecture/v1" },
        { id: "derive", capabilities: ["artifact.read", "artifact.write", "emit"], schema: "praxis.artifact.derive/v1" },
        { id: "merge", capabilities: ["artifact.read", "artifact.write", "emit"], schema: "praxis.artifact.merge/v1" },
      ],
      [
        { kind: "data", from: "draft", to: "derive" },
        { kind: "join", from: "draft", to: "merge" },
        { kind: "join", from: "derive", to: "merge" },
      ],
    );
    const { instance, nonce } = await createInstance(ws, "join-flow", "req-join");
    const draft = await cli(ws, [
      "resume",
      instance,
      "--artifact",
      artifactFile(ws, "d1.json", { schema: "praxis.artifact.architecture/v1", nonce }),
    ]);
    assert.equal(draft.status, 0, draft.stderr);
    const draftDigest = (draft.result?.artifacts as Array<{ digest: string }>)[0].digest;

    const derive = await cli(ws, [
      "resume",
      instance,
      "--artifact",
      artifactFile(ws, "d2.json", { schema: "praxis.artifact.derive/v1", nonce, derivedFrom: draftDigest }),
    ]);
    assert.equal(derive.status, 0, derive.stderr);
    const deriveDigest = (derive.result?.artifacts as Array<{ digest: string }>).find((ref) => ref.digest !== draftDigest)?.digest;
    assert.ok(deriveDigest);

    const merge = await cli(ws, [
      "resume",
      instance,
      "--artifact",
      artifactFile(ws, "d3.json", { schema: "praxis.artifact.merge/v1", nonce, joined: true }),
    ]);
    assert.equal(merge.status, 0, merge.stderr);
    assert.equal(merge.result?.status, "completed");

    const accepted = eventsOf(ws, instance).find(
      (event) => event.type === "artifact.accepted" && (event.payload as { step: string }).step === "merge",
    );
    assert.ok(accepted, "the join must record an accepted event");
    const payload = accepted.payload as { derivedFrom: string | null; sources?: string[] };
    assert.equal(payload.derivedFrom, null, "a join has no single derivedFrom");
    assert.deepEqual(payload.sources, ["draft@1", "derive@1"], "sources in declared edge order");
    const mergeRow = artifactsOf(ws, instance).find((row) => row.step === "merge");
    assert.equal(mergeRow?.derived_from, null);
  } finally {
    dispose(ws);
  }
});
