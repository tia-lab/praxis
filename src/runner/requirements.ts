import type { Requirement } from "../types/schema.ts";

/**
 * Does this document contain what the stage demands?
 *
 * A stage names one clause or several; every clause must hold. A clause names one
 * section of the document. A section may be an array (a list of entries) or an
 * object (a fixed set of fields):
 *   - minItems applies to an array section;
 *   - required names fields that must be present (and non-empty) on the section;
 *   - each names fields every array entry must carry;
 *   - equals names fields that must carry an exact value, e.g. verdict: "PASS".
 *
 * Returns the list of what is missing, empty when every clause holds. No partial
 * credit and no coercion: a section that is absent, empty or shallow does not pass.
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

function missingForOne(value: unknown, requires: Requirement): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return ["document is not an object"];
  }
  const section = (value as Record<string, unknown>)[requires.section];
  if (section === undefined || section === null) return [requires.section];
  const missing: string[] = [];

  if (Array.isArray(section)) {
    if (requires.minItems !== undefined && section.length < requires.minItems) {
      missing.push(requires.section + ": needs " + requires.minItems + " items, has " + section.length);
    }
    if (requires.each !== undefined) {
      section.forEach((entry, index) => {
        if (entry === null || typeof entry !== "object") {
          missing.push(requires.section + "[" + index + "]: not an object");
          return;
        }
        for (const field of requires.each!) {
          const cell = (entry as Record<string, unknown>)[field];
          if (cell === undefined || cell === null || cell === "") {
            missing.push(requires.section + "[" + index + "]." + field);
          }
        }
      });
    }
    return missing;
  }

  if (typeof section !== "object") return [requires.section + ": not a section"];
  for (const field of requires.required ?? []) {
    const cell = (section as Record<string, unknown>)[field];
    if (cell === undefined || cell === null || cell === "") {
      missing.push(requires.section + "." + field);
    }
  }
  for (const [field, expected] of Object.entries(requires.equals ?? {})) {
    const cell = (section as Record<string, unknown>)[field];
    if (cell !== expected) {
      missing.push(requires.section + "." + field + ": expected " + JSON.stringify(expected));
    }
  }
  return missing;
}
