import type { FieldSpec, Requirement } from "../types/schema.ts";

/**
 * Does this document contain what the stage demands?
 *
 * A stage names one clause or several; every clause must hold. A clause names one section of
 * the document, an array (a list of entries) or an object (a fixed set of fields). A field is
 * named by a bare string (present and non-empty) or by an object that adds deterministic
 * checks: `type`, `minLength`/`maxLength`, `pattern`, `enum` and a cross-section `references`.
 * `strict` on a clause refuses any field the clause does not name. `minItems`, `required`,
 * `each` and `equals` keep their meanings. No coercion and no partial credit.
 *
 * Returns the list of what is missing or malformed, empty when every clause holds. The strings
 * are path-addressable (`section[i].field: expected number`) so a caller can act without a
 * schema handbook, and so a future field-scoped read can reuse the same addresses.
 */
export function missingFor(value: unknown, requires: Requirement | Requirement[]): string[] {
  const clauses = Array.isArray(requires) ? requires : [requires];
  const missing: string[] = [];
  for (const clause of clauses) {
    const found = missingForOne(value, clause);
    if (found.length > 0 && found[0] === "document is not an object") return found;
    missing.push(...found);
  }
  return missing;
}

/** A field spec reduced to its object form; a bare string is presence-only. */
interface Field {
  field: string;
  type?: "string" | "number" | "boolean" | "object" | "array";
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  enum?: (string | number | boolean)[];
  references?: string;
}

function fieldOf(spec: FieldSpec): Field {
  return typeof spec === "string" ? { field: spec } : spec;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Presence: undefined, null or an empty string is absent (0 and false are present). */
function absent(cell: unknown): boolean {
  return cell === undefined || cell === null || cell === "";
}

function typeOk(cell: unknown, type: Field["type"]): boolean {
  switch (type) {
    case "string":
      return typeof cell === "string";
    case "number":
      return typeof cell === "number";
    case "boolean":
      return typeof cell === "boolean";
    case "array":
      return Array.isArray(cell);
    case "object":
      return isObject(cell);
    default:
      return true;
  }
}

/** The allowed values named by `section.field` across the whole document. */
function referenceSet(doc: Record<string, unknown>, path: string): Set<unknown> {
  const dot = path.indexOf(".");
  const section = path.slice(0, dot);
  const field = path.slice(dot + 1);
  const target = doc[section];
  const set = new Set<unknown>();
  if (Array.isArray(target)) {
    for (const entry of target) if (isObject(entry) && !absent(entry[field])) set.add(entry[field]);
  } else if (isObject(target) && !absent(target[field])) {
    set.add(target[field]);
  }
  return set;
}

/** Deterministic content checks for one present cell; returns the gaps it fails. */
function checkCell(label: string, cell: unknown, spec: Field, doc: Record<string, unknown>): string[] {
  const gaps: string[] = [];
  if (spec.type !== undefined && !typeOk(cell, spec.type)) gaps.push(label + ": expected " + spec.type);
  const len = typeof cell === "string" ? cell.length : Array.isArray(cell) ? cell.length : undefined;
  if (len !== undefined) {
    if (spec.minLength !== undefined && len < spec.minLength) gaps.push(label + ": shorter than " + spec.minLength);
    if (spec.maxLength !== undefined && len > spec.maxLength) gaps.push(label + ": longer than " + spec.maxLength);
  }
  if (spec.pattern !== undefined && typeof cell === "string") {
    let re: RegExp | undefined;
    try {
      re = new RegExp(spec.pattern);
    } catch {
      re = undefined;
    }
    if (re === undefined || !re.test(cell)) gaps.push(label + ": does not match /" + spec.pattern + "/");
  }
  if (spec.enum !== undefined && !spec.enum.includes(cell as string | number | boolean)) {
    gaps.push(label + ": not one of " + JSON.stringify(spec.enum));
  }
  if (spec.references !== undefined && !referenceSet(doc, spec.references).has(cell)) {
    gaps.push(label + ": not a known " + spec.references);
  }
  return gaps;
}

function missingForOne(value: unknown, requires: Requirement): string[] {
  if (!isObject(value)) return ["document is not an object"];
  const section = value[requires.section];
  if (section === undefined || section === null) return [requires.section];
  const missing: string[] = [];

  if (Array.isArray(section)) {
    if (requires.minItems !== undefined && section.length < requires.minItems) {
      missing.push(requires.section + ": needs " + requires.minItems + " items, has " + section.length);
    }
    const specs = (requires.each ?? []).map(fieldOf);
    const names = new Set(specs.map((spec) => spec.field));
    section.forEach((entry, index) => {
      const at = requires.section + "[" + index + "]";
      if (!isObject(entry)) {
        if (specs.length > 0) missing.push(at + ": not an object");
        return;
      }
      for (const spec of specs) {
        const label = at + "." + spec.field;
        const cell = entry[spec.field];
        if (absent(cell)) {
          missing.push(label);
          continue;
        }
        missing.push(...checkCell(label, cell, spec, value));
      }
      if (requires.strict === true) {
        for (const key of Object.keys(entry)) {
          if (!names.has(key)) missing.push(at + "." + key + ": unexpected field");
        }
      }
    });
    return missing;
  }

  if (typeof section !== "object") return [requires.section + ": not a section"];
  const object = section as Record<string, unknown>;
  const specs = (requires.required ?? []).map(fieldOf);
  const names = new Set(specs.map((spec) => spec.field));
  for (const spec of specs) {
    const label = requires.section + "." + spec.field;
    const cell = object[spec.field];
    if (absent(cell)) {
      missing.push(label);
      continue;
    }
    missing.push(...checkCell(label, cell, spec, value));
  }
  for (const [field, expected] of Object.entries(requires.equals ?? {})) {
    const cell = object[field];
    if (cell !== expected) {
      missing.push(requires.section + "." + field + ": expected " + JSON.stringify(expected));
    }
  }
  if (requires.strict === true) {
    for (const key of Object.keys(object)) {
      const declared = names.has(key) || (requires.equals !== undefined && key in requires.equals);
      if (!declared) missing.push(requires.section + "." + key + ": unexpected field");
    }
  }
  return missing;
}
