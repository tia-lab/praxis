/**
 * Canonical JSON and digest (R4, P1).
 *
 * A canonical form is the only form an artifact may be persisted in: parsed JSON
 * values, arrays in order, object keys sorted by UTF-16 code unit, UTF-8, no BOM,
 * no insignificant whitespace.
 *
 * The form is total: a value that JSON cannot carry exactly is a typed refusal, never
 * a coercion and never a silent drop. Refused members are holes in arrays, extra
 * properties and other members beyond an array's indices, symbol-keyed members,
 * non-enumerable members, accessor (getter/setter) members, cycles, `undefined`,
 * functions, symbols, non-finite numbers, class instances and `toJSON` objects.
 *
 * Known limit, stated plainly: duplicate keys in *text* are undetectable here, because
 * this module only ever sees parsed values. Enforcing R4's duplicate-key clause needs a
 * text parser, which this slice does not have.
 */
import { createHash } from "node:crypto";
import { fail } from "../types/errors.ts";

const encoder = new TextEncoder();
const INDEX = /^(0|[1-9][0-9]*)$/;

function invalid(message: string, detail?: unknown): never {
  throw fail("CANONICAL_INVALID", message, detail);
}

function encodeArray(object: readonly unknown[], seen: Set<object>, path: string): string {
  const enumerable = Object.keys(object);
  if (enumerable.length !== object.length) {
    invalid(
      `array is not exactly its indices at ${path}`,
      enumerable.filter((key) => !INDEX.test(key)),
    );
  }
  // getOwnPropertyNames counts `length` too; anything more is a member JSON cannot carry.
  if (Object.getOwnPropertyNames(object).length !== object.length + 1) {
    invalid(`array carries a hidden member at ${path}`);
  }
  if (Object.getOwnPropertySymbols(object).length > 0) {
    invalid(`array carries a symbol-keyed member at ${path}`);
  }

  seen.add(object);
  const parts: string[] = [];
  // An index loop, not map(): map() skips holes, which is exactly the coercion to avoid.
  for (let index = 0; index < object.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(object, index);
    if (descriptor === undefined || !descriptor.enumerable) invalid(`hole at ${path}[${index}]`);
    if (descriptor.get !== undefined || descriptor.set !== undefined) {
      invalid(`accessor at ${path}[${index}]`);
    }
    parts.push(encode(object[index], seen, `${path}[${index}]`));
  }
  seen.delete(object);
  return `[${parts.join(",")}]`;
}

function encodeObject(object: object, seen: Set<object>, path: string): string {
  if (Object.getOwnPropertySymbols(object).length > 0) {
    invalid(`symbol-keyed member at ${path}`);
  }
  const keys = Object.keys(object);
  const names = Object.getOwnPropertyNames(object);
  if (names.length !== keys.length) {
    invalid(
      `non-enumerable member at ${path}`,
      names.filter((name) => !keys.includes(name)),
    );
  }

  seen.add(object);
  const parts: string[] = [];
  for (const key of keys.sort()) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (descriptor === undefined) invalid(`member vanished at ${path}.${key}`);
    if (descriptor.get !== undefined || descriptor.set !== undefined) {
      invalid(`accessor at ${path}.${key}`);
    }
    parts.push(`${JSON.stringify(key)}:${encode((object as Record<string, unknown>)[key], seen, `${path}.${key}`)}`);
  }
  seen.delete(object);
  return `{${parts.join(",")}}`;
}

function encode(value: unknown, seen: Set<object>, path: string): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid(`non-finite number at ${path}`, value);
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value !== "object") invalid(`unsupported ${typeof value} at ${path}`);

  const object = value as object;
  if (seen.has(object)) invalid(`cycle at ${path}`);

  if (Array.isArray(object)) return encodeArray(object, seen, path);

  const proto = Object.getPrototypeOf(object);
  if (proto !== Object.prototype && proto !== null) {
    invalid(`non-plain object at ${path}`, Object.prototype.toString.call(object));
  }
  if (typeof (object as { toJSON?: unknown }).toJSON === "function") {
    invalid(`object with toJSON at ${path}`);
  }
  return encodeObject(object, seen, path);
}

/** Canonical JSON text for a parsed value; the single accepted byte form. */
export function canonicalText(value: unknown): string {
  return encode(value, new Set(), "$");
}

/** Canonical UTF-8 bytes: no BOM, no insignificant whitespace. */
export function canonicalBytes(value: unknown): Uint8Array {
  return encoder.encode(canonicalText(value));
}

/** `sha256:` + lowercase hex over the given bytes. */
export function digest(bytes: Uint8Array | string): string {
  const data = typeof bytes === "string" ? encoder.encode(bytes) : bytes;
  return `sha256:${createHash("sha256").update(data).digest("hex")}`;
}

/** Digest of the canonical form of a value. */
export function digestOf(value: unknown): string {
  return digest(canonicalBytes(value));
}

/** Byte equality, used where a digest match must be confirmed on the bytes themselves. */
export function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
