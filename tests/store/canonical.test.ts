/**
 * P1: one digest for two key orders, and the canonical form refuses what JSON cannot
 * represent (spec R4). The implementation under test is `src/runner/canonical.ts`, the
 * plan's declared location for it; this file is claim A's check of that shared module.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { canonicalBytes, canonicalText, digest } from "../../src/runner/canonical.ts";
import { isAppError } from "../../src/types/errors.ts";

const orderA = { b: 2, a: 1, nested: { d: [3, 1], c: null } };
const orderB = { nested: { c: null, d: [3, 1] }, a: 1, b: 2 };

function expectCanonicalRefusal(value: unknown): void {
  assert.throws(
    () => canonicalText(value),
    (error: unknown) => isAppError(error) && error.code === "CANONICAL_INVALID",
  );
}

test("P1: one digest for two key orders", () => {
  const left = canonicalBytes(orderA);
  const right = canonicalBytes(orderB);
  assert.deepEqual([...left], [...right]);
  assert.equal(digest(left), digest(right));
  assert.match(digest(left), /^sha256:[0-9a-f]{64}$/);
});

test("keys sort by UTF-16 code unit, arrays keep their order", () => {
  assert.equal(canonicalText({ "é": 1, z: 2, Z: 3, "": 4 }), '{"":4,"Z":3,"z":2,"é":1}');
  assert.equal(canonicalText({ b: [3, 1, 2], a: 1 }), '{"a":1,"b":[3,1,2]}');
});

test("canonical bytes are UTF-8 without BOM and without insignificant whitespace", () => {
  const bytes = canonicalBytes({ a: 1 });
  assert.equal(bytes[0], 0x7b);
  assert.notEqual(bytes[0], 0xef);
  assert.equal(canonicalText({ a: 1 }), '{"a":1}');
  assert.deepEqual([...canonicalBytes("é")].slice(1, 3), [0xc3, 0xa9]);
});

test("digest is sha256 over the bytes, with a known vector", () => {
  assert.equal(
    digest(new Uint8Array(0)),
    "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  assert.equal(digest(canonicalBytes({ a: 1 })), digest(canonicalBytes({ a: 1 })));
  assert.notEqual(digest(canonicalBytes({ a: 1 })), digest(canonicalBytes({ a: 2 })));
});

test("values JSON cannot represent are typed refusals", () => {
  expectCanonicalRefusal({ a: Number.NaN });
  expectCanonicalRefusal({ a: Number.POSITIVE_INFINITY });
  expectCanonicalRefusal({ a: undefined });
  expectCanonicalRefusal({ a: () => 1 });
  expectCanonicalRefusal({ a: new Date(0) });
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  expectCanonicalRefusal(cycle);
});

test("a sparse array is not canonical JSON", () => {
  const sparse = [1, , 3];
  expectCanonicalRefusal(sparse);
});
