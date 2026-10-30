/**
 * The project's global attempt budget (`.pi/praxis/config.json`, `praxis.project/v1`).
 *
 * Precedence, proved here end to end: the task's or flow's own `maxAttempts` wins, then the
 * project default, then the code constant (3). The value is loaded at a boundary and threaded in,
 * so the engine never reads configuration; absent, unreadable or invalid config falls through.
 *
 * A fake scorer drives every case: nothing here reaches the network.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { advanceEvaluated } from "../../src/quality/index.ts";
import { projectMaxAttempts } from "../../src/runner/engine/support.ts";
import { engineOptions } from "../../src/pi/tool.ts";
import { isAppError, type AppError } from "../../src/types/errors.ts";
import { ProjectConfigSchema } from "../../src/types/project.ts";
import {
  JUDGED_SCHEMA,
  clock,
  dispose,
  judgedFlow,
  learningOptions,
  sequenceScorer,
  startJudged,
  workspace,
  type JudgedRun,
  type Workspace,
} from "../testkit.ts";

/** The repository root, so the committed project config can be parsed for real. */
const REPO = new URL("../../", import.meta.url).pathname;

async function rejectionOf(body: () => Promise<unknown>): Promise<AppError> {
  try {
    await body();
  } catch (error) {
    assert.ok(isAppError(error), "the refusal must be a typed AppError");
    return error;
  }
  throw new Error("expected a typed refusal, the call succeeded");
}

/** One judged attempt, scoring `score` for every dimension. */
function attempt(ws: Workspace, run: JudgedRun, at: string, n: number, score: number, defaultMaxAttempts?: number) {
  return advanceEvaluated({
    ...learningOptions(ws, at),
    instance: run.instance,
    actor: "a",
    artifact: { schema: JUDGED_SCHEMA, nonce: run.nonce, attempt: n },
    scorer: sequenceScorer([score]),
    ...(defaultMaxAttempts === undefined ? {} : { defaultMaxAttempts }),
  });
}

/** The budget the escalation reports, which is the one the engine actually applied. */
async function budgetAtEscalation(ws: Workspace, run: JudgedRun, tick: () => string, scores: readonly number[], defaultMaxAttempts?: number): Promise<number> {
  let last: AppError | undefined;
  for (let index = 0; index < scores.length; index += 1) {
    last = await rejectionOf(() => attempt(ws, run, tick(), index + 1, scores[index], defaultMaxAttempts));
  }
  assert.ok(last, "at least one attempt was made");
  assert.equal(last.code, "QUALITY_BLOCKED");
  return (last.detail as { maxAttempts: number }).maxAttempts;
}

test("the project default budget applies when the resolved quality declares none", async () => {
  const ws = workspace();
  try {
    judgedFlow(ws, { onFailure: "escalate" });
    const tick = clock().next;
    const run = startJudged(ws, "proj-default", tick());
    // Two improving failures are enough: the project says two, not the code default of three.
    const used = await budgetAtEscalation(ws, run, tick, [0.2, 0.3], 2);
    assert.equal(used, 2, "the project default is the budget in force");
  } finally {
    dispose(ws);
  }
});

test("a task's own maxAttempts still overrides the project default", async () => {
  const ws = workspace();
  try {
    judgedFlow(ws, { onFailure: "escalate", maxAttempts: 4 });
    const tick = clock().next;
    const run = startJudged(ws, "proj-task", tick());
    const used = await budgetAtEscalation(ws, run, tick, [0.1, 0.2, 0.3, 0.4], 2);
    assert.equal(used, 4, "the task's declaration wins over the project default");
  } finally {
    dispose(ws);
  }
});

test("an absent project config falls through to the code default of three", async () => {
  const ws = workspace();
  try {
    assert.equal(projectMaxAttempts(ws.root), undefined, "no project config in this workspace");
    judgedFlow(ws, { onFailure: "escalate" });
    const tick = clock().next;
    const run = startJudged(ws, "proj-none", tick());
    const used = await budgetAtEscalation(ws, run, tick, [0.1, 0.2, 0.3]);
    assert.equal(used, 3, "the constant is the last fallback");
  } finally {
    dispose(ws);
  }
});

test("the committed config parses as praxis.project/v1 and a broken one falls through", async () => {
  const parsed = ProjectConfigSchema.parse(JSON.parse(readFileSync(join(REPO, ".pi/praxis/config.json"), "utf8")));
  assert.equal(parsed.schema, "praxis.project/v1");
  assert.equal(parsed.defaults?.maxAttempts, 10, "the project declares its global budget");
  assert.equal(projectMaxAttempts(REPO), 10);

  const broken = workspace();
  try {
    mkdirSync(join(broken.root, ".pi", "praxis"), { recursive: true });
    writeFileSync(join(broken.root, ".pi", "praxis", "config.json"), "{ not json");
    assert.equal(projectMaxAttempts(broken.root), undefined, "an unreadable config never throws");
    writeFileSync(join(broken.root, ".pi", "praxis", "config.json"), JSON.stringify({ schema: "praxis.project/v2" }));
    assert.equal(projectMaxAttempts(broken.root), undefined, "a config of another schema is ignored");
    writeFileSync(join(broken.root, ".pi", "praxis", "config.json"), JSON.stringify({ schema: "praxis.project/v1", defaults: { maxAttempts: 0 } }));
    assert.equal(projectMaxAttempts(broken.root), undefined, "an out-of-range budget is refused, not coerced");
    writeFileSync(join(broken.root, ".pi", "praxis", "config.json"), JSON.stringify({ schema: "praxis.project/v1", defaults: { maxAttempts: 7 } }));
    assert.equal(projectMaxAttempts(broken.root), 7, "and a valid one is read once the file is right");
  } finally {
    dispose(broken);
  }
});

test("the tool boundary loads the project default into its engine options", () => {
  const ws = workspace();
  try {
    mkdirSync(join(ws.root, ".pi", "praxis"), { recursive: true });
    writeFileSync(join(ws.root, ".pi", "praxis", "config.json"), JSON.stringify({ schema: "praxis.project/v1", defaults: { maxAttempts: 10 } }));
    const options = engineOptions({ cwd: ws.root, sessionManager: { getSessionId: () => "session-proj" } });
    assert.equal(options.defaultMaxAttempts, 10);
    assert.equal(options.configPath, join(ws.root, ".pi/praxis/flows/engineering/feature.json"), "the default FLOW path is unchanged");
    dispose(ws);
    const bare = workspace();
    try {
      assert.equal(engineOptions({ cwd: bare.root, sessionManager: { getSessionId: () => "s" } }).defaultMaxAttempts, undefined);
    } finally {
      dispose(bare);
    }
  } finally {
    /* the second workspace is disposed above */
  }
});
