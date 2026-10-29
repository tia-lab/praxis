import assert from "node:assert/strict";
import test from "node:test";
import { missingFor } from "../../src/runner/requirements.ts";

const evidence = { section: "evidence", minItems: 2, each: ["source", "quote"] };
const review = { section: "review", required: ["verdict", "findings"] };

test("an absent section is missing", () => {
  assert.deepEqual(missingFor({}, evidence), ["evidence"]);
});

test("an empty array does not satisfy minItems", () => {
  assert.deepEqual(missingFor({ evidence: [] }, evidence), ["evidence: needs 2 items, has 0"]);
});

test("entries without the required fields are named", () => {
  const doc = { evidence: [{ source: "a", quote: "q" }, { source: "b" }] };
  assert.deepEqual(missingFor(doc, evidence), ["evidence[1].quote"]);
});

test("an empty field counts as missing", () => {
  const doc = { evidence: [{ source: "", quote: "q" }, { source: "b", quote: "q" }] };
  assert.deepEqual(missingFor(doc, evidence), ["evidence[0].source"]);
});

test("a satisfied section passes", () => {
  const doc = { evidence: [{ source: "a", quote: "q" }, { source: "b", quote: "q" }] };
  assert.deepEqual(missingFor(doc, evidence), []);
});

test("an object section needs its required fields", () => {
  assert.deepEqual(missingFor({ review: { verdict: "pass" } }, review), ["review.findings"]);
  assert.deepEqual(missingFor({ review: { verdict: "pass", findings: [] } }, review), []);
});

test("a non-object document is refused", () => {
  assert.deepEqual(missingFor("whatever", evidence), ["document is not an object"]);
});

test("a stage may demand many sections at once and names each gap", () => {
  const clauses = [
    { section: "sources", minItems: 1, each: ["source", "location"] },
    { section: "affected", required: ["path", "declaration"] },
  ];
  assert.deepEqual(missingFor({}, clauses), ["sources", "affected"]);
  const doc = { sources: [{ source: "a", location: "engine.ts:319" }], affected: { path: "engine.ts" } };
  assert.deepEqual(missingFor(doc, clauses), ["affected.declaration"]);
});

test("equals refuses a verdict that is not PASS", () => {
  const verdict = { section: "review", required: ["verdict"], equals: { verdict: "PASS" } };
  assert.deepEqual(missingFor({ review: { verdict: "FAIL" } }, verdict), ['review.verdict: expected "PASS"']);
  assert.deepEqual(missingFor({ review: { verdict: "PASS" } }, verdict), []);
});
