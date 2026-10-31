/**
 * Slice 4, provenance scoping (R28, D15): a lesson belongs to the rubric identity it was judged
 * under. After a criterion edit the old case disappears for that dimension - and stays for the one
 * whose identity did not change - with the exclusion recorded once per recall set.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { join } from "node:path";
import { openStore } from "../../src/store/db.ts";
import { collectCases, excludedFor, rubricKeys } from "../../src/quality/index.ts";
import type { Quality } from "../../src/types/schema.ts";
import { clock, dispose, judgedFlow, sequenceScorer, startJudged, submitJudged, workspace, type Workspace } from "../testkit.ts";
import { recordNoteFor } from "../testkit.ts";

const RUBRIC = [
  { id: "solves", statement: "it solves the stated goal", floor: 0.6 },
  { id: "evidence", statement: "every claim carries evidence", floor: 0.6 },
];
const QUALITY: Quality = { dimensions: RUBRIC, threshold: 0.6, policy: "required" };

/** One solved case tagged on both dimensions, with a note so it is evidence. */
async function seed(ws: Workspace, tick: () => string): Promise<void> {
  const run = startJudged(ws, "prov", tick());
  await submitJudged(ws, run, tick(), 1, sequenceScorer([0.95]));
  recordNoteFor(ws, run.instance, tick(), {
    whatWrong: "the draft drifted",
    whatRight: "the answer was grounded",
    whatBetter: "keep to one issue",
    tags: [
      { dimension: "solves", lesson: "keep to one issue" },
      { dimension: "evidence", lesson: "cite the line" },
    ],
  });
}

const casesOf = (ws: Workspace, keys?: ReadonlyMap<string, string>) => {
  const store = openStore(join(ws.store, "praxis.sqlite"));
  try {
    return collectCases(store, keys);
  } finally {
    store.close();
  }
};

test("R28: a lesson is not recalled for a dimension whose identity changed", async () => {
  const ws = workspace();
  try {
    judgedFlow(ws, { dimensions: RUBRIC });
    const tick = clock().next;
    await seed(ws, tick);

    const stable = rubricKeys(QUALITY);
    const before = casesOf(ws, stable);
    assert.equal(before.length, 1);
    assert.deepEqual(before[0]!.lesson.tags.map((tag) => tag.dimension).sort(), ["evidence", "solves"]);

    // Republish with `solves` reworded: only that dimension's identity moved.
    const edited = rubricKeys({
      ...QUALITY,
      dimensions: [{ ...RUBRIC[0]!, statement: "it answers the question that was asked" }, RUBRIC[1]!],
    });
    assert.notEqual(edited.get("solves"), stable.get("solves"), "the edited dimension has a new key");
    assert.equal(edited.get("evidence"), stable.get("evidence"), "the untouched dimension keeps its key");

    const after = casesOf(ws, edited);
    assert.equal(after.length, 1, "the case survives for the unchanged dimension");
    assert.deepEqual(after[0]!.lesson.tags.map((tag) => tag.dimension), ["evidence"], "and loses only the changed one");
    // The exclusion is recorded once for the set, not repeated per case.
    assert.deepEqual(excludedFor(casesOf(ws), after, edited), ["solves"]);
    assert.deepEqual(excludedFor(casesOf(ws), before, stable), [], "nothing is excluded while nothing changed");
  } finally {
    dispose(ws);
  }
});
