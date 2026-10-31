/**
 * Replay the bar over a recorded store (quantile-bars S7). NOT part of the suite: it reads a store
 * under /tmp by hand, so it is run for acceptance only.
 *
 *   node tests/manual/replay-bars.mjs /path/to/praxis.sqlite
 *
 * It builds the CARRIED population per dimension (spec 3.1: one observation per instance, the score of
 * the version the instance carried), applies the p25 rule with the ABSOLUTE 0.5 floor, and prints:
 *   - the joint pass rate: instances whose carried verdict clears max(0.5, bar) on EVERY dimension;
 *   - the Q50 flag rate: of those passing instances, the fraction with at least one dimension below
 *     its own Q50 (the learning-flag trigger, A3).
 * Nothing is written and nothing is scored live: this is a read over existing records.
 */
import { DatabaseSync } from "node:sqlite";

const ABSOLUTE_MIN = 0.5;
const PERCENTILE = 25;
const path = process.argv[2];
if (path === undefined) {
  console.error("usage: node tests/manual/replay-bars.mjs <store.sqlite>");
  process.exit(2);
}

const lowerQuantile = (values, percentile) => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.floor((percentile / 100) * (sorted.length - 1));
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
};
const quantizeDown = (value) => Math.floor(value * 100) / 100;

const db = new DatabaseSync(path, { readOnly: true });
const rows = db.prepare("select instance, type, payload, seq from event order by instance, seq").all();

/** Per instance: the accepted version and the verdict of the version it carried. */
const accepted = new Map();
const verdicts = new Map();
for (const row of rows) {
  const payload = JSON.parse(row.payload);
  if (row.type === "artifact.accepted") {
    const current = accepted.get(row.instance);
    const version = Number(payload.version);
    if (current === undefined || version >= current.version) {
      accepted.set(row.instance, { version, failed: payload.failed !== undefined });
    }
    continue;
  }
  if (row.type !== "quality.verdict") continue;
  if (payload.source !== "jev") continue;
  const list = verdicts.get(row.instance) ?? [];
  list.push({ version: Number(payload.version), score: Number(payload.score), dimensions: payload.dimensions ?? [] });
  verdicts.set(row.instance, list);
}

/** One carried observation per instance, grouped by dimension id. */
const carried = [];
for (const [instance, list] of verdicts) {
  const carriedVersion = accepted.get(instance);
  if (carriedVersion === undefined) continue;
  const chosen = carriedVersion.failed
    ? list.reduce((best, entry) => (entry.score > best.score ? entry : best), list[0])
    : list.find((entry) => entry.version === carriedVersion.version);
  if (chosen === undefined) continue;
  carried.push({ instance, dimensions: chosen.dimensions });
}

const populations = new Map();
for (const entry of carried) {
  for (const dimension of entry.dimensions) {
    const values = populations.get(dimension.id) ?? [];
    values.push(Number(dimension.score));
    populations.set(dimension.id, values);
  }
}

const bars = new Map();
const q50 = new Map();
for (const [id, values] of populations) {
  const q = lowerQuantile(values, PERCENTILE);
  bars.set(id, q === undefined ? ABSOLUTE_MIN : Math.max(ABSOLUTE_MIN, quantizeDown(q)));
  q50.set(id, lowerQuantile(values, 50));
}

let passing = 0;
let flagged = 0;
for (const entry of carried) {
  const pass = entry.dimensions.every((dimension) => Number(dimension.score) >= (bars.get(dimension.id) ?? ABSOLUTE_MIN));
  if (!pass) continue;
  passing += 1;
  const anyFlag = entry.dimensions.some((dimension) => {
    const median = q50.get(dimension.id);
    return median !== undefined && Number(dimension.score) < median;
  });
  if (anyFlag) flagged += 1;
}

const rate = (count, total) => (total === 0 ? "n/a" : ((count / total) * 100).toFixed(1) + "%");
console.log("store:", path);
console.log("instances with a carried verdict:", carried.length);
console.log("dimensions:", [...populations.keys()].sort().join(", "));
console.log("bars (p25, floored at 0.5):", [...bars].sort().map(([id, bar]) => id + "=" + bar.toFixed(2)).join(", "));
console.log("joint pass:", passing, "of", carried.length, "=", rate(passing, carried.length));
console.log("Q50 flag among passing:", flagged, "of", passing, "=", rate(flagged, passing));
