/**
 * Slice 0 assertions (R1-R5): the pi-jev v0.2.3 answer distribution survives the client, and Praxis
 * reads it AS SHIPPED — keyed by the authored option keys (choice) and in authored level order (score).
 *
 * NO NETWORK: every case drives the real `evaluate` with an injected fetcher that returns a fixture.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "pi-jev";
import type { JevRequest } from "pi-jev";

const KEY = "test-key";

/** Run the real client against a fixture payload and return its parsed answers. */
async function parse(request: JevRequest, payload: unknown) {
  const response = await evaluate(request, {
    apiKey: KEY,
    fetcher: (async () =>
      new Response(JSON.stringify(payload), { status: 200 })) as unknown as typeof fetch,
  });
  return response.answers;
}

const choiceAndScore: JevRequest = {
  state: { artifact: "x" },
  questions: {
    diag: { type: "choice", instructions: "is the diagnosis sound?", criteria: { clean: "sound", other: "not sound" } },
    cover: { type: "score", instructions: "how covered?", criteria: ["none", "partial", "full"] },
  },
};

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

test("S0-R1 choice mass is keyed by option keys and score mass is in level order", async () => {
  const answers = await parse(choiceAndScore, {
    model: "jev-test",
    answers: {
      diag: { type: "choice", choice: "clean", probabilities: { clean: 0.7, other: 0.3 } },
      // The API may key score mass by level number; the client normalizes it to level order.
      cover: { type: "score", score: 2, probabilities: { 0: 0.1, 1: 0.2, 2: 0.7 } },
    },
  });

  assert.deepEqual(answers.diag, {
    type: "choice",
    choice: "clean",
    probabilities: { clean: 0.7, other: 0.3 },
  });
  assert.deepEqual(answers.cover, { type: "score", score: 2, probabilities: [0.1, 0.2, 0.7] });

  const choiceMass = answers.diag as { probabilities: Record<string, number> };
  const scoreMass = answers.cover as { probabilities: number[] };
  assert.deepEqual(Object.keys(choiceMass.probabilities), ["clean", "other"], "keyed by the authored options");
  assert.equal(scoreMass.probabilities.length, 3, "one entry per authored level");
  assert.ok(Math.abs(sum(Object.values(choiceMass.probabilities)) - 1) < 1e-9);
  assert.ok(Math.abs(sum(scoreMass.probabilities) - 1) < 1e-9);
});

test("S0-R2 malformed mass is rejected, never dropped", async () => {
  const cases: { name: string; payload: unknown }[] = [
    {
      name: "a key outside the criteria set",
      payload: { model: "m", answers: {
        diag: { type: "choice", choice: "clean", probabilities: { clean: 0.7, bogus: 0.3 } },
        cover: { type: "score", score: 2, probabilities: [0, 0, 1] },
      } },
    },
    {
      name: "a value outside [0,1]",
      payload: { model: "m", answers: {
        diag: { type: "choice", choice: "clean", probabilities: { clean: 1.4, other: -0.4 } },
        cover: { type: "score", score: 2, probabilities: [0, 0, 1] },
      } },
    },
    {
      name: "a wrong score length",
      payload: { model: "m", answers: {
        diag: { type: "choice", choice: "clean", probabilities: { clean: 1, other: 0 } },
        cover: { type: "score", score: 2, probabilities: [0.5] },
      } },
    },
  ];

  for (const { name, payload } of cases) {
    await assert.rejects(
      () => parse(choiceAndScore, payload),
      /malformed probabilities/,
      `${name} must throw at the client boundary, not degrade`,
    );
  }
});

test("S0-R3 a noul answer carries no mass and no confidence", async () => {
  const answers = await parse(
    { state: {}, questions: { ok: { type: "noul", instructions: "is it true?" } } },
    // Even if a server sent mass for a noul, the client keeps {type, noul} only.
    { model: "m", answers: { ok: { type: "noul", noul: 0.9, confidence: 0.8, probabilities: { true: 1 } } } },
  );
  assert.deepEqual(answers.ok, { type: "noul", noul: 0.9 });
  assert.deepEqual(Object.keys(answers.ok).sort(), ["noul", "type"]);
});

test("S0-R4 a response without mass behaves exactly as today", async () => {
  const answers = await parse(choiceAndScore, {
    model: "jev-new",
    answers: {
      diag: { type: "choice", choice: "other", confidence: 0.6 },
      cover: { type: "score", score: 1 },
    },
  });
  assert.deepEqual(answers.diag, { type: "choice", choice: "other", confidence: 0.6 });
  assert.deepEqual(answers.cover, { type: "score", score: 1 });
  assert.equal("probabilities" in answers.diag, false, "absent mass stays absent, never zero-filled");
  assert.equal("probabilities" in answers.cover, false);
});

test("S0-R5 Praxis reads the map as shipped", async () => {
  // The keys Praxis will read are its OWN authored criterion ids, in authored order — the client
  // re-keys nothing and Praxis re-derives nothing.
  const criteria = { cited: "every claim is cited", bounded: "claims stay bounded" };
  const answers = await parse(
    { state: {}, questions: { grounded: { type: "choice", instructions: "is it grounded?", criteria } } },
    { model: "m", answers: { grounded: {
      type: "choice", choice: "cited", probabilities: { cited: 0.62, bounded: 0.38 },
    } } },
  );
  const mass = (answers.grounded as { probabilities?: Record<string, number> }).probabilities;
  assert.deepEqual(mass, { cited: 0.62, bounded: 0.38 });
  assert.deepEqual(Object.keys(mass ?? {}), Object.keys(criteria), "keys follow the authored declaration");
});
