/**
 * T3 — the composed scorer (R12-R18, R20).
 *
 * ONE request per submission, exactly today's shape: the composed goal, the WHOLE artifact, and each
 * targeted criterion's own instruction naming the sections it judges. The subject is never sliced and
 * no second call is made, so an untargeted, order-less submission is byte-identical to today (R19).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { JevRequest, JevResponse } from "pi-jev";
import { digest } from "../../src/runner/canonical.ts";
import { qualityHistory, start } from "../../src/runner/engine/index.ts";
import { withStore } from "../../src/runner/engine/support.ts";
import { anchorKey, evaluateArtifact } from "../../src/quality/evaluate.ts";
import { jevScorer } from "../../src/quality/jev-scorer.ts";
import { executePraxisTool, setAlignJudgeForTest, setScorerForTest } from "../../src/pi/tool.ts";
import type { PiToolResult } from "../../src/pi/host.ts";
import type { Quality } from "../../src/types/quality.ts";
import type { TaskConfig } from "../../src/types/schema.ts";
import { isAppError } from "../../src/types/errors.ts";
import {
  clock,
  dispose,
  eventsOf,
  flowRef,
  instanceRow,
  learningOptions,
  sequenceScorer,
  workspace,
  writeFlow,
  type Workspace,
} from "../testkit.ts";
import { advanceEvaluated } from "../../src/quality/evaluate.ts";
import { fakeAlignJudge, fakeContext, tempStore, useAlignedJudge } from "../pi/fixtures.ts";

const ORDER = "research how the append-only event log stores and folds instance state";
const GOAL = "establish what is true from sources and the code";
const RATIONALE = "a design decision made on unverified claims is the expensive failure";
const SCOPE = "claims about this repository and its shipped code";
const SUBJECT = "sha256:" + "b".repeat(64);

const SECTIONS = [
  { section: "findings", goal: "every finding states what the evidence supports", rationale: "a finding without its evidence cannot be re-checked", required: ["text"] },
  { section: "sources", goal: "every source states what it establishes", rationale: "an uncited claim is not evidence", minItems: 1 },
  { section: "affected", required: ["files"] },
];

const QUALITY: Quality = {
  threshold: 0.6,
  policy: "required",
  dimensions: [
    {
      id: "grounded",
      statement: "every claim is tied to a source",
      probes: [
        { id: "cited", type: "noul", instructions: "is every claim cited?", sections: ["findings", "sources"] },
        { id: "whole", type: "noul", instructions: "is the document grounded overall?" },
      ],
    },
  ],
};

const ARTIFACT = {
  findings: { text: "the event log folds state from the append-only record" },
  sources: [{ source: "src/store/events.ts", location: "12-40", establishes: "events append, never mutate" }],
  affected: { files: ["src/store/events.ts"] },
};

/** The assignment the judge is given: an order, the task's intent and the targeted sections' intent. */
const CONTEXT = {
  order: ORDER,
  task: { rationale: RATIONALE, scope: SCOPE },
  sections: SECTIONS.flatMap((clause) =>
    clause.goal === undefined ? [] : [{ id: clause.section, goal: clause.goal, rationale: clause.rationale }],
  ),
};

/** A fake judge that records every request and answers each question by its declared type. */
function capture(overrides: Record<string, unknown> = {}) {
  const seen: JevRequest[] = [];
  const evaluateFn = async (request: JevRequest): Promise<JevResponse> => {
    seen.push(request);
    const answers: Record<string, unknown> = {};
    for (const [id, question] of Object.entries(request.questions)) {
      const override = overrides[id] ?? overrides[id.split(".").at(-1)!];
      if (override !== undefined) {
        answers[id] = override;
        continue;
      }
      if (question.type === "noul") answers[id] = { type: "noul", noul: 0.9 };
      else if (question.type === "score") answers[id] = { type: "score", score: question.criteria.length - 1 };
      else answers[id] = { type: "choice", choice: Object.keys(question.criteria as Record<string, string>)[0] };
    }
    return { model: "fake/jev", answers } as JevResponse;
  };
  return { evaluateFn, seen };
}

async function judged(overrides: Record<string, unknown> = {}, context: typeof CONTEXT | null = CONTEXT) {
  const fake = capture(overrides);
  const verdict = await evaluateArtifact(
    jevScorer({ evaluateFn: fake.evaluateFn }),
    QUALITY,
    { goal: GOAL, artifact: ARTIFACT, subjectDigest: SUBJECT, ...(context === null ? {} : { context }) },
  );
  return { verdict, request: fake.seen[0]!, seen: fake.seen };
}

const instructionOf = (request: JevRequest, id: string): string => {
  const question = request.questions[id];
  assert.ok(question, "the question " + id + " exists");
  return String(question.instructions);
};

test("R12: the composed goal carries the order, the rationale and the scope", async () => {
  const { request } = await judged();
  const goal = String((request.state as { goal: unknown }).goal);
  assert.ok(goal.startsWith(ORDER), "the order comes first: " + goal.slice(0, 60));
  assert.match(goal, /Task: establish what is true from sources and the code/);
  assert.match(goal, /Why: a design decision made on unverified claims/);
  assert.match(goal, /Scope: claims about this repository/);
  // With nothing to compose the goal is the task's own sentence, byte for byte (R19's premise).
  const plain = await judged({}, null);
  assert.equal((plain.request.state as { goal: string }).goal, GOAL);
});

test("R13: a targeted criterion's question names only its sections", async () => {
  const { request } = await judged();
  const instruction = instructionOf(request, "grounded.cited");
  assert.ok(instruction.includes("findings+sources"), "the ids, joined: " + instruction);
  assert.ok(instruction.includes("every finding states what the evidence supports"), "the section goal");
  assert.ok(instruction.includes("every source states what it establishes"));
  assert.ok(instruction.includes("a finding without its evidence cannot be re-checked"), "and its rationale");
  assert.ok(instruction.includes("is every claim cited?"), "and the criterion itself");
  assert.equal(instruction.includes("affected"), false, "a section it does not judge is never named");
  assert.ok(instruction.startsWith("Judge ONLY the "), "the question says what to judge");
});

test("R14: one request per submission, every targeted question names its sections", async () => {
  const { request, seen } = await judged();
  assert.equal(seen.length, 1, "exactly ONE evaluate per submission");
  assert.deepEqual(Object.keys(request.state as object).sort(), ["artifact", "goal", "subjectDigest"], "state keeps its three keys");
  // The subject is the WHOLE artifact - never sliced to the targeted sections.
  assert.deepEqual((request.state as { artifact: unknown }).artifact, ARTIFACT, "the whole artifact is sent");
  assert.ok(instructionOf(request, "grounded.cited").includes("findings+sources"));
  // An untargeted question is today's text, byte for byte.
  assert.equal(instructionOf(request, "grounded.whole"), "is the document grounded overall?");
});

test("R15: the witness is asked once per composed dimension", async () => {
  const { request, verdict } = await judged();
  const witnesses = Object.keys(request.questions).filter((id) => id.endsWith(".__statement"));
  assert.deepEqual(witnesses, ["grounded.__statement"], "one witness, in the same request");
  assert.ok(instructionOf(request, "grounded.__statement").startsWith("Judge the artifact strictly against this standard"));
  const composed = verdict.dimensions[0]!;
  assert.equal(composed.statementScore, 0.9, "the witness is recorded");
  // Altering ONLY the witness changes nothing that decides.
  const altered = await judged({ "grounded.__statement": { type: "noul", noul: 0.2 } });
  assert.deepEqual(
    [altered.verdict.decision, altered.verdict.score, altered.verdict.mean, altered.verdict.flagged],
    [verdict.decision, verdict.score, verdict.mean, verdict.flagged],
  );
  assert.equal(altered.verdict.dimensions[0]!.score, composed.score);
});

test("R16: a failing request degrades the verdict, never fabricates", async () => {
  const verdict = await evaluateArtifact(
    jevScorer({ evaluateFn: (async () => { throw new Error("jev is down"); }) as never }),
    QUALITY,
    { goal: GOAL, artifact: ARTIFACT, subjectDigest: SUBJECT, context: CONTEXT },
  );
  assert.equal(verdict.source, "error");
  assert.equal(verdict.decision, "unavailable");
  assert.deepEqual(verdict.dimensions, [], "no score is invented");
  assert.match(verdict.rationale, /jev is down/);
});

test("R17: the verdict records the plan and the anchor", async () => {
  const { verdict } = await judged();
  assert.equal(verdict.anchored, true);
  assert.equal(verdict.anchorDigest, digest(ORDER));
  const diagnosis = verdict.dimensions[0]!.diagnosis!;
  assert.deepEqual(diagnosis.find((entry) => entry.probe === "cited")!.sections, ["findings", "sources"]);
  assert.equal(diagnosis.find((entry) => entry.probe === "whole")!.sections, undefined, "an untargeted criterion records none");
  // An unanchored verdict records no anchor at all.
  const plain = await judged({}, null);
  assert.equal(plain.verdict.anchored, undefined);
  assert.equal(plain.verdict.anchorDigest, undefined);
});

test("R18: the score-cache is keyed by the anchor", async () => {
  const ruler = "sha256:" + "c".repeat(64);
  const first = anchorKey(ruler, digest("order one"));
  const second = anchorKey(ruler, digest("order two"));
  assert.notEqual(first, second, "two orders are two cache keys: the second submission is a miss");
  assert.equal(anchorKey(ruler, digest("order one")), first, "the same order is the same key");
  assert.notEqual(anchorKey(ruler, undefined), first, "an unanchored verdict never serves an anchored run");
  assert.equal(anchorKey(ruler, undefined), anchorKey(ruler, undefined));
  const ws = workspace();
  try {
    writeFlow(ws, "learn", [
      {
        id: "draft",
        capabilities: ["artifact.write", "emit", "evaluate"],
        schema: "praxis.artifact.research/v1",
        goal: GOAL,
        requires: SECTIONS,
        quality: QUALITY as unknown,
      },
    ]);
    const tick = clock().next;
    const options = learningOptions(ws, tick());
    const run = start({ ...options, flow: flowRef("learn"), requestId: "anchored", actor: "a", order: ORDER });
    // The REAL composed scorer over a fake judge that answers BELOW the floor, so the instance keeps
    // running and the same bytes can be submitted twice.
    const fake = capture({ cited: { type: "noul", noul: 0.2 }, whole: { type: "noul", noul: 0.2 } });
    const scorer = jevScorer({ evaluateFn: fake.evaluateFn });
    const artifact = { schema: "praxis.artifact.research/v1", nonce: run.instance.nonce, attempt: 1, ...ARTIFACT };
    await assert.rejects(advanceEvaluated({ ...options, instance: run.instance.id, actor: "a", artifact, scorer }), (error: unknown) => isAppError(error));
    await advanceEvaluated({ ...options, instance: run.instance.id, actor: "a", artifact, scorer });
    assert.equal(fake.seen.length, 1, "the same bytes under the same order are a cache HIT");
    // The recorded verdict carries the anchor, which is what makes a DIFFERENT order a miss.
    const recorded = withStore(options, (store) => qualityHistory(store, run.instance.id, "draft"));
    assert.ok(recorded.length >= 1);
    assert.equal(recorded[0]!.verdict.anchored, true, "the re-read keeps the anchor (F7)");
    assert.equal(recorded[0]!.verdict.anchorDigest, digest(ORDER));
    assert.deepEqual(recorded[0]!.verdict.dimensions[0]!.diagnosis?.[0]?.sections, ["findings", "sources"], "and the sections");
  } finally {
    dispose(ws);
  }
});

test("R20: op=check writes nothing and scores nothing", async () => {
  useAlignedJudge();
  setAlignJudgeForTest(fakeAlignJudge("aligned"));
  const project = tempStore({
    config: {
      schema: "praxis.flow/v2",
      flow: "flows/research",
      nodes: [{ id: "draft", task: "tasks/draft" }],
      edges: [],
      result: "praxis.result/v1",
    },
    tasks: [
      { id: "draft", version: 1, state: "published", goal: GOAL, capabilities: ["artifact.write", "emit", "evaluate"], produces: { schema: "praxis.artifact.research/v1" }, gate: "section-requirements", requires: SECTIONS, quality: QUALITY } as unknown as TaskConfig,
    ],
  });
  const call = (args: unknown): Promise<PiToolResult> => executePraxisTool(args, fakeContext({ cwd: project.cwd, sessionId: "check-anchored" }));
  const bag = (result: PiToolResult): any => result.details;
  try {
    const scorer = sequenceScorer([0.9]);
    setScorerForTest(scorer as never);
    const started = bag(await call({ op: "start", flow: "flows/research", order: ORDER, requestId: "check" }));
    assert.equal(started.code, undefined, JSON.stringify(started).slice(0, 300));
    assert.deepEqual(started.step.brief.requires[0].goal, "every finding states what the evidence supports", "the brief carries the section intent");
    const ws = { store: project.storeDir } as Workspace;
    const before = eventsOf(ws, started.result.instanceId).length;
    const rowBefore = instanceRow(ws, started.result.instanceId);
    const checked = bag(await call({ op: "check", instance: started.result.instanceId, artifact: { ...ARTIFACT, schema: "praxis.artifact.research/v1" } }));
    assert.equal(checked.code, undefined, JSON.stringify(checked).slice(0, 300));
    assert.equal(scorer.calls, 0, "check scores nothing");
    assert.equal(eventsOf(ws, started.result.instanceId).length, before, "check records nothing");
    assert.deepEqual(instanceRow(ws, started.result.instanceId), rowBefore, "check changes no state");
  } finally {
    setScorerForTest(undefined);
    setAlignJudgeForTest(undefined);
    project.dispose();
  }
});
