/**
 * The rubric lifecycle under a quantile bar (S2): identity is (dimension id + criteria), so editing a
 * criterion re-keys exactly that dimension and an unchanged one inherits its bar. There is no global
 * scope and no authored seed any more: an unknown identity starts at the floor.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { withStore } from "../../src/runner/engine/support.ts";
import { ABSOLUTE_MIN, dimensionKey, quantileBars } from "../../src/quality/index.ts";
import type { Quality } from "../../src/types/quality.ts";
import { dispose, learningOptions, raiseBar, workspace } from "../testkit.ts";

const TASK = "tasks/make";
const AT = "2026-10-31T00:00:00.000Z";

const GROUNDED = { id: "grounded", statement: "every claim is tied to a source" };
const COVERS = { id: "covers-question", statement: "it answers the question that was asked" };
const TRACE = { id: "trace", statement: "every step leaves a trace" };
const qualityOf = (...dimensions: object[]): Quality => ({ dimensions, threshold: 0.6, policy: "required" } as Quality);

test("an edited criterion re-keys only that dimension; the others inherit", () => {
  const ws = workspace();
  try {
    const options = learningOptions(ws, AT);
    withStore(options, (store) => {
      raiseBar(store, TASK, "grounded", 0.75, dimensionKey(GROUNDED));
      raiseBar(store, TASK, "covers-question", 0.7, dimensionKey(COVERS));
    });
    const before = withStore(options, (store) => quantileBars(store, TASK, qualityOf(GROUNDED, COVERS)));
    assert.equal(before.perDimension.get("grounded"), 0.75);
    assert.equal(before.perDimension.get("covers-question"), 0.7);

    // Rewording a STATEMENT changes the identity (a statement-only dimension is keyed by it).
    const edited = withStore(options, (store) =>
      quantileBars(store, TASK, qualityOf({ ...GROUNDED, statement: "every claim names its source" }, COVERS)),
    );
    assert.equal(edited.perDimension.get("grounded"), ABSOLUTE_MIN, "the edited identity starts at the floor");
    assert.equal(edited.perDimension.get("covers-question"), 0.7, "the untouched dimension inherits");
    assert.notEqual(edited.keys.get("grounded"), before.keys.get("grounded"));
  } finally {
    dispose(ws);
  }
});

test("a new dimension starts at the floor while the others keep their bars", () => {
  const ws = workspace();
  try {
    const options = learningOptions(ws, AT);
    withStore(options, (store) => raiseBar(store, TASK, "grounded", 0.75, dimensionKey(GROUNDED)));
    const wider = withStore(options, (store) => quantileBars(store, TASK, qualityOf(GROUNDED, COVERS, TRACE)));
    assert.equal(wider.perDimension.get("grounded"), 0.75, "an unchanged identity inherits");
    assert.equal(wider.perDimension.get("covers-question"), ABSOLUTE_MIN, "a new one starts at the floor");
    assert.equal(wider.perDimension.get("trace"), ABSOLUTE_MIN);
  } finally {
    dispose(ws);
  }
});

test("a removed dimension takes its bar with it, and a restored one starts at the floor", () => {
  const ws = workspace();
  try {
    const options = learningOptions(ws, AT);
    withStore(options, (store) => raiseBar(store, TASK, "covers-question", 0.7, dimensionKey(COVERS)));
    const without = withStore(options, (store) => quantileBars(store, TASK, qualityOf(GROUNDED)));
    assert.equal(without.perDimension.has("covers-question"), false, "a dimension not in the rubric has no bar");
    const restored = withStore(options, (store) => quantileBars(store, TASK, qualityOf(GROUNDED, COVERS)));
    assert.equal(restored.perDimension.get("covers-question"), 0.7, "its identity never changed, so its bar returns");
  } finally {
    dispose(ws);
  }
});
