import assert from "node:assert/strict";
import test from "node:test";
import { canonicalBlock, hash8, taskFolder } from "../../src/runner/task.ts";

const contract = { task: "loop-back for review", scope: "src/runner", acceptance: "78 tests pass" };

test("the canonical block is three physical lines", () => {
  assert.equal(canonicalBlock(contract), "task: loop-back for review\nscope: src/runner\nacceptance: 78 tests pass\n");
});

test("trailing whitespace does not change the hash", () => {
  const padded = { ...contract, acceptance: "78 tests pass   " };
  assert.equal(hash8(padded), hash8(contract));
});

test("a changed contract is a different task", () => {
  assert.notEqual(hash8({ ...contract, acceptance: "79 tests pass" }), hash8(contract));
  assert.equal(hash8(contract).length, 8);
});

test("the folder is slug plus hash and never leaves docs", () => {
  assert.equal(taskFolder("Loop-back for review", contract), "docs/tasks/loop-back-for-review-" + hash8(contract));
  assert.throws(() => taskFolder("---", contract));
});
