/**
 * The append-only event log (spec R3).
 *
 * This module exposes append and list only; there is no update and no delete, and the
 * database refuses both by trigger (see ./db.ts). Payloads are stored in canonical JSON
 * so the same fact cannot appear in two byte forms, and a payload that cannot be
 * canonicalised is refused before anything is written.
 */
import { z } from "zod";
import { type Store, storeCall, transact } from "./db.ts";
import { canonicalText } from "../runner/canonical.ts";
import { asAppError, fail } from "../types/errors.ts";
import {
  EventTypeSchema,
  InstanceIdSchema,
  TimestampSchema,
  parseWith,
  type StoredEvent,
} from "../types/schema.ts";

const SeqRowSchema = z.strictObject({ seq: z.int().min(0) });

/** The row as stored: the payload is canonical JSON text, not a value. */
const EventRowSchema = z.strictObject({
  instance: InstanceIdSchema,
  seq: z.int().min(1),
  type: EventTypeSchema,
  payload: z.string(),
  at: TimestampSchema,
});

export interface AppendEventInput {
  type: string;
  payload?: unknown;
  at: string;
}

/** Append one event, allocating the next sequence number inside the transaction. */
export function appendEvent(store: Store, instance: string, event: AppendEventInput): StoredEvent {
  const instanceId = parseWith(InstanceIdSchema, instance, "CONFIG_INVALID", "instance id");
  const type = parseWith(EventTypeSchema, event.type, "CONFIG_INVALID", "event type");
  const at = parseWith(TimestampSchema, event.at, "CONFIG_INVALID", "event timestamp");
  const payload: unknown = event.payload ?? null;
  const text = canonicalText(payload);

  return transact(store, () => {
    const head = storeCall("read the event sequence", () =>
      store.db.prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM event WHERE instance = ?").get(instanceId),
    );
    const seq = parseWith(SeqRowSchema, head, "STORE_INVALID", "event sequence").seq + 1;
    storeCall("append an event", () =>
      store.db.prepare("INSERT INTO event(instance, seq, type, payload, at) VALUES(?, ?, ?, ?, ?)").run(
        instanceId,
        seq,
        type,
        text,
        at,
      ),
    );
    return { instance: instanceId, seq, type, payload, at };
  });
}

/** List one instance's events in append order, optionally after a sequence cursor. */
export function listEvents(store: Store, instance: string, after = 0): StoredEvent[] {
  const instanceId = parseWith(InstanceIdSchema, instance, "CONFIG_INVALID", "instance id");
  const rows = storeCall("list events", () =>
    store.db
      .prepare("SELECT instance, seq, type, payload, at FROM event WHERE instance = ? AND seq > ? ORDER BY seq ASC")
      .all(instanceId, after),
  );
  return rows.map((row) => {
    const parsed = parseWith(EventRowSchema, row, "STORE_INVALID", "event row");
    return {
      instance: parsed.instance,
      seq: parsed.seq,
      type: parsed.type,
      payload: parsePayload(parsed.payload, parsed.seq),
      at: parsed.at,
    };
  });
}

function parsePayload(text: string, seq: number): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw fail("STORE_INVALID", `event ${seq} carries a payload that is not JSON`, {
      seq,
      cause: asAppError(error).message,
    });
  }
}
