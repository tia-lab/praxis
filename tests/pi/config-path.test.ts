import assert from "node:assert/strict";
import test from "node:test";

import { engineOptions } from "../../src/pi/tool.ts";

const ctx = { cwd: "/project", sessionManager: { getSessionId: () => "s" } } as never;

test("the tool reads the accepted flow by default", () => {
  delete process.env.PRAXIS_CONFIG;
  assert.equal(engineOptions(ctx).configPath, "/project/.pi/praxis/config.json");
});

test("PRAXIS_CONFIG selects another flow and is resolved under the host cwd", () => {
  process.env.PRAXIS_CONFIG = ".pi/praxis/flows/delivery.json";
  try {
    assert.equal(engineOptions(ctx).configPath, "/project/.pi/praxis/flows/delivery.json");
    process.env.PRAXIS_CONFIG = "/abs/flow.json";
    assert.equal(engineOptions(ctx).configPath, "/abs/flow.json");
  } finally {
    delete process.env.PRAXIS_CONFIG;
  }
});
