/**
 * Regression for finding F1 (lead, from P1), extended after reviewer-1's rework verdict.
 *
 * The implementation under guard, src/runner/canonical.ts, is claim B's, so its
 * owner-side check lives here. Claim A's src/store/canonical.test.ts covers the shared
 * module from the store's side.
 *
 * The first version of this test asserted only that a *plain* sparse array is refused.
 * That passed a key-count guard that a decorated hole (`[1,,3]` with one extra own
 * property) slips past, so the hole guard had no red test. The cases below are written
 * to be red under that weak guard: they assert the hole guard itself fires, not merely
 * that some refusal happened.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isAppError } from "../types/errors.ts";
import { canonicalBytes, canonicalText, digestOf } from "./canonical.ts";

const refusesCanonical = (error: unknown): boolean => isAppError(error) && error.code === "CANONICAL_INVALID";

interface TypedRefusal {
  code: string;
  message: string;
}

function refusalOf(body: () => unknown): TypedRefusal {
  try {
    body();
  } catch (error) {
    assert.ok(isAppError(error), "a refusal must be a typed AppError, not a string throw");
    return { code: error.code, message: error.message };
  }
  assert.fail("expected a typed refusal, the value was accepted");
}

test("F1: a plain sparse array is refused with CANONICAL_INVALID, never rendered with a hole or a null", () => {
  const sparse = [1, , 3];
  assert.equal(sparse.length, 3, "the fixture really has a hole");
  assert.equal(1 in sparse, false);

  assert.throws(() => canonicalText(sparse), refusesCanonical);
  assert.throws(() => canonicalBytes(sparse), refusesCanonical);
  assert.throws(() => digestOf(sparse), refusesCanonical);

  // Not only at the root: the refusal survives nesting, where a coercion would hide.
  assert.throws(() => canonicalText({ a: [1, , 3] }), refusesCanonical);
  assert.throws(() => canonicalText([[1], , [3]]), refusesCanonical);
});

test("F1: a sparse array carrying an extra own property is refused by the hole guard, not by a key count", () => {
  // reviewer-1's counter-case: three own keys, length three, so a key-count guard passes
  // while the hole survives map() and the text becomes "[1,,3]".
  const decorated: unknown[] & { extra?: number } = [1, , 3];
  decorated.extra = 0;
  assert.equal(Object.keys(decorated).length, decorated.length, "the weak guard would accept this");

  const refusal = refusalOf(() => canonicalText(decorated));
  assert.equal(refusal.code, "CANONICAL_INVALID");
  assert.match(refusal.message, /hole/, "the hole guard must be the one that fires");

  // The same shape without the extra property must report the same hole, so the two
  // paths cannot drift back into one another.
  assert.match(refusalOf(() => canonicalText([1, , 3])).message, /hole|indices/);
});

test("F1: an array with a non-index own property is refused, not silently dropped", () => {
  const decorated: unknown[] & { note?: string } = [1, 2];
  decorated.note = "extra";
  assert.throws(() => canonicalText(decorated), refusesCanonical);
});

test("F1: members JSON cannot carry are refused, never dropped", () => {
  // A hidden (non-enumerable) member would vanish from the canonical text.
  const hidden: unknown[] = [1, 2];
  Object.defineProperty(hidden, "secret", { value: 3, enumerable: false });
  assert.throws(() => canonicalText(hidden), refusesCanonical);

  // A symbol-keyed member would vanish too.
  const withSymbol: unknown[] = [1];
  Object.defineProperty(withSymbol, Symbol("s"), { value: 2, enumerable: true });
  assert.throws(() => canonicalText(withSymbol), refusesCanonical);

  const objectWithSymbol = { a: 1, [Symbol("s")]: 2 };
  assert.throws(() => canonicalText(objectWithSymbol), refusesCanonical);

  const objectWithHiddenMember = { a: 1 };
  Object.defineProperty(objectWithHiddenMember, "hidden", { value: 2, enumerable: false });
  assert.throws(() => canonicalText(objectWithHiddenMember), refusesCanonical);

  // An accessor can return a different value on every read: its digest would not be stable.
  const accessor = {
    get a(): number {
      return 1;
    },
  };
  assert.throws(() => canonicalText(accessor), refusesCanonical);
});

test("F1: representable values still canonicalise, so the refusal stayed narrow", () => {
  assert.equal(canonicalText([1, 2, 3]), "[1,2,3]");
  assert.equal(canonicalText([[1], [2]]), "[[1],[2]]");
  assert.equal(canonicalText([null, false, 0]), "[null,false,0]");
  assert.equal(canonicalText({ b: [], a: 1 }), `{"a":1,"b":[]}`);
  assert.equal(canonicalText({ b: 2, a: 1, nested: { d: [3, 1], c: null } }), canonicalText({ nested: { c: null, d: [3, 1] }, a: 1, b: 2 }));
  assert.equal(canonicalText("é"), `"é"`);
});
