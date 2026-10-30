import assert from "node:assert/strict";
import test from "node:test";
import { missingFor } from "../../src/runner/requirements.ts";

test("a typed field rejects the wrong type with a path-addressable gap", () => {
  const clause = { section: "meta", required: [{ field: "count", type: "number" as const }] };
  assert.deepEqual(missingFor({ meta: { count: "ten" } }, clause), ["meta.count: expected number"]);
  assert.deepEqual(missingFor({ meta: { count: 10 } }, clause), []);
});

test("minLength and maxLength bound a string", () => {
  const clause = { section: "alternatives", minItems: 1, each: [{ field: "rejected", type: "string" as const, minLength: 40 }] };
  assert.deepEqual(missingFor({ alternatives: [{ rejected: "too short" }] }, clause), ["alternatives[0].rejected: shorter than 40"]);
  const ok = "a genuinely considered option rejected for a stated concrete tradeoff";
  assert.deepEqual(missingFor({ alternatives: [{ rejected: ok }] }, clause), []);
});

test("a pattern constrains a field", () => {
  const clause = { section: "requirements", minItems: 1, each: [{ field: "id", type: "string" as const, pattern: "^R[0-9]+$" }] };
  assert.deepEqual(missingFor({ requirements: [{ id: "req-1" }] }, clause), ["requirements[0].id: does not match /^R[0-9]+$/"]);
  assert.deepEqual(missingFor({ requirements: [{ id: "R1" }] }, clause), []);
});

test("an enum restricts allowed values", () => {
  const clause = { section: "review", required: [{ field: "verdict", enum: ["PASS", "FAIL"] as (string | number | boolean)[] }] };
  assert.deepEqual(missingFor({ review: { verdict: "MAYBE" } }, clause), ['review.verdict: not one of ["PASS","FAIL"]']);
  assert.deepEqual(missingFor({ review: { verdict: "PASS" } }, clause), []);
});

test("references binds a field to a set declared elsewhere in the document", () => {
  const clause = { section: "model", minItems: 1, each: [{ field: "requirement", references: "requirements.id" }] };
  const doc = { requirements: [{ id: "R1" }, { id: "R2" }], model: [{ requirement: "R3" }] };
  assert.deepEqual(missingFor(doc, clause), ["model[0].requirement: not a known requirements.id"]);
  const good = { requirements: [{ id: "R1" }], model: [{ requirement: "R1" }] };
  assert.deepEqual(missingFor(good, clause), []);
});

test("strict refuses a field the clause does not name", () => {
  const objectClause = { section: "meta", strict: true, required: [{ field: "author", type: "string" as const }] };
  assert.deepEqual(missingFor({ meta: { author: "a", sneaky: 1 } }, objectClause), ["meta.sneaky: unexpected field"]);
  const arrayClause = { section: "changes", minItems: 1, strict: true, each: [{ field: "path" }, { field: "what" }] };
  assert.deepEqual(missingFor({ changes: [{ path: "p", what: "w", extra: "x" }] }, arrayClause), ["changes[0].extra: unexpected field"]);
});

test("an untyped clause keeps the shipped presence-only behaviour", () => {
  const clause = { section: "evidence", minItems: 2, each: ["source", "quote"] };
  assert.deepEqual(missingFor({ evidence: [{ source: "a", quote: "q" }] }, clause), ["evidence: needs 2 items, has 2".replace("2 items, has 2", "2 items, has 1")]);
  assert.deepEqual(missingFor({ evidence: [{ source: "a", quote: "q" }, { source: "b", quote: "q" }] }, clause), []);
});
