/**
 * The instance row: current state guarded by `revision` (spec R2, R3, R6).
 *
 * `createInstance` refuses a duplicate id with `REQUEST_CONFLICT` and writes nothing, so
 * a repeated request cannot fork an instance. `setStatus` is a compare-and-set on
 * `revision` plus an explicit transition table: a stale writer loses loudly instead of
 * overwriting newer state, and a terminal instance cannot be revived silently.
 *
 * Rows carry the plan's snake_case column names; the exported `Instance` value is
 * camelCase. `toInstance` is the only place that mapping exists.
 */
import { z } from "zod";
import { type Store, storeCall, transact } from "./db.ts";
import { fail } from "../types/errors.ts";
import {
  ActorSchema,
  FlowNameSchema,
  InstanceIdSchema,
  InstanceStatusSchema,
  NonceSchema,
  StepIdSchema,
  TimestampSchema,
  parseWith,
  type Instance,
  type InstanceStatus,
} from "../types/schema.ts";

/** The row exactly as SQLite returns it (plan "Store schema"). */
const InstanceRowSchema = z.strictObject({
  id: InstanceIdSchema,
  flow: FlowNameSchema,
  actor: ActorSchema,
  status: InstanceStatusSchema,
  current_step: StepIdSchema.nullable(),
  revision: z.int().min(0),
  nonce: NonceSchema,
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});

/** Declared transitions (spec R8). `blocked` is not a state; `completed` and `failed` are terminal. */
const TRANSITIONS: Record<InstanceStatus, readonly InstanceStatus[]> = {
  running: ["completed", "failed"],
  completed: [],
  failed: [],
};

const SELECT_ROW =
  "SELECT id, flow, actor, status, current_step, revision, nonce, created_at, updated_at FROM instance WHERE id = ?";

const INSERT_ROW =
  "INSERT INTO instance(id, flow, actor, status, current_step, revision, nonce, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)";

const UPDATE_ROW =
  "UPDATE instance SET status = ?, current_step = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?";

export interface CreateInstanceInput {
  id: string;
  flow: string;
  actor: string;
  status: InstanceStatus;
  currentStep: string;
  nonce: string;
  now: string;
}

/** The fields a status write may change; every other column is immutable here. */
export interface StatusChange {
  status: InstanceStatus;
  currentStep: string;
}

function toInstance(row: unknown, what: string): Instance {
  const parsed = parseWith(InstanceRowSchema, row, "STORE_INVALID", what);
  if (parsed.current_step === null) {
    throw fail("STORE_INVALID", `${what} has no current step`, { id: parsed.id });
  }
  return {
    id: parsed.id,
    flow: parsed.flow,
    actor: parsed.actor,
    status: parsed.status,
    currentStep: parsed.current_step,
    revision: parsed.revision,
    nonce: parsed.nonce,
    createdAt: parsed.created_at,
    updatedAt: parsed.updated_at,
  };
}

/** Load one instance. A missing row is `INSTANCE_NOT_FOUND`, never an empty value. */
export function loadInstance(store: Store, id: string): Instance {
  const instanceId = parseWith(InstanceIdSchema, id, "CONFIG_INVALID", "instance id");
  const row = storeCall("load an instance", () => store.db.prepare(SELECT_ROW).get(instanceId));
  if (row === undefined) {
    throw fail("INSTANCE_NOT_FOUND", `no instance ${instanceId}`, { instance: instanceId });
  }
  return toInstance(row, `instance row ${instanceId}`);
}

/** The validated columns of a new row. Pure: nothing is written and no transaction opens. */
function newInstanceFields(input: CreateInstanceInput): {
  id: string;
  flow: string;
  actor: string;
  status: InstanceStatus;
  currentStep: string;
  nonce: string;
  now: string;
} {
  const id = parseWith(InstanceIdSchema, input.id, "CONFIG_INVALID", "instance id");
  const flow = parseWith(FlowNameSchema, input.flow, "CONFIG_INVALID", "flow name");
  const actor = parseWith(ActorSchema, input.actor, "CONFIG_INVALID", "actor");
  const nonce = parseWith(NonceSchema, input.nonce, "CONFIG_INVALID", "instance nonce");
  const currentStep = parseWith(StepIdSchema, input.currentStep, "CONFIG_INVALID", "current step");
  const now = parseWith(TimestampSchema, input.now, "CONFIG_INVALID", "created-at timestamp");
  const status = parseWith(InstanceStatusSchema, input.status, "INSTANCE_STATE_INVALID", "initial status");
  if (status !== "running") {
    throw fail("INSTANCE_STATE_INVALID", `an instance starts running, not ${status}`, { instance: id, status });
  }
  return { id, flow, actor, status, currentStep, nonce, now };
}

/**
 * Insert the row without opening a transaction, so one caller can pin the flow and every
 * task version in the same transaction as the instance row (spec R4). A duplicate id is
 * `REQUEST_CONFLICT` and writes nothing.
 */
export function insertInstance(store: Store, input: CreateInstanceInput): Instance {
  const fields = newInstanceFields(input);
  insertRow(store, fields);
  return loadInstance(store, fields.id);
}

function insertRow(store: Store, fields: ReturnType<typeof newInstanceFields>): void {
  const existing = storeCall("check for a duplicate instance", () =>
    store.db.prepare("SELECT id FROM instance WHERE id = ?").get(fields.id),
  );
  if (existing !== undefined) {
    throw fail("REQUEST_CONFLICT", `instance ${fields.id} already exists for this request`, { instance: fields.id });
  }
  storeCall("insert an instance", () =>
    store.db
      .prepare(INSERT_ROW)
      .run(fields.id, fields.flow, fields.actor, fields.status, fields.currentStep, 0, fields.nonce, fields.now, fields.now),
  );
}

/** Create an instance at revision 0 in its own transaction. A duplicate id writes nothing. */
export function createInstance(store: Store, input: CreateInstanceInput): Instance {
  const fields = newInstanceFields(input);
  return transact(store, () => {
    insertRow(store, fields);
    return loadInstance(store, fields.id);
  });
}

/**
 * Compare-and-set the current state. `expectRevision` must equal the stored revision;
 * the write bumps it by one. `updated_at` is the store's own clock, so a caller cannot
 * backdate a transition.
 */
export function setStatus(store: Store, id: string, change: StatusChange, expectRevision: number): Instance {
  const instanceId = parseWith(InstanceIdSchema, id, "CONFIG_INVALID", "instance id");
  const status = parseWith(InstanceStatusSchema, change.status, "INSTANCE_STATE_INVALID", "target status");
  const currentStep = parseWith(StepIdSchema, change.currentStep, "INSTANCE_STATE_INVALID", "current step");
  if (!Number.isInteger(expectRevision) || expectRevision < 0) {
    throw fail("REVISION_CONFLICT", "expected revision must be a non-negative integer", { expected: expectRevision });
  }

  return transact(store, () => {
    const current = loadInstance(store, instanceId);
    if (current.revision !== expectRevision) {
      throw fail("REVISION_CONFLICT", `instance ${instanceId} is at revision ${current.revision}, expected ${expectRevision}`, {
        instance: instanceId,
        expected: expectRevision,
        stored: current.revision,
      });
    }
    if (status !== current.status && !TRANSITIONS[current.status].includes(status)) {
      throw fail("INSTANCE_STATE_INVALID", `instance ${instanceId} cannot move from ${current.status} to ${status}`, {
        instance: instanceId,
        from: current.status,
        to: status,
      });
    }
    const stamp = new Date().toISOString();
    const info = storeCall("update the instance status", () =>
      store.db.prepare(UPDATE_ROW).run(status, currentStep, stamp, instanceId, expectRevision),
    );
    if (Number(info.changes) !== 1) {
      throw fail("REVISION_CONFLICT", `instance ${instanceId} changed while it was being updated`, {
        instance: instanceId,
        expected: expectRevision,
      });
    }
    return loadInstance(store, instanceId);
  });
}
