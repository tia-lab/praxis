/**
 * The hooks registry: the one composition seam a project can bind to the mutating tool ops.
 *
 * Contract, in three rules:
 *  - every binding for one hook runs in REGISTRATION ORDER, sequentially, and the FIRST VETO WINS;
 *  - dispatch receives plain data and returns a verdict; it is handed no Store, no Grant and no
 *    engine handle, so a hook can subtract (veto) or observe, and can never widen authority;
 *  - neither kind of hook ever runs inside a store transaction: this module is called by the tool
 *    boundary before an op acts and after it has produced its outcome.
 *
 * Containment: a throwing `before_` hook is a veto (fail-closed, never a pass); a throwing
 * `after_` hook is caught, named and logged to stderr, and the committed op is untouched.
 */
import { fail } from "../types/errors.ts";
import {
  AFTER_HOOKS,
  BEFORE_HOOKS,
  type AfterHookName,
  type AfterOutcome,
  type BeforeHookName,
  type BeforeOutcome,
  type HookBinding,
  type HookName,
  type HookPayloads,
} from "../types/hooks.ts";

/** One registered binding, as stored. */
type Binding = { id: string; run: (payload: never) => void | Promise<void> };

/** The registry: one ordered list per hook name. Module-level, like the tool's injected seams. */
const registry = new Map<HookName, Binding[]>();

/** Every hook name the registry knows, so a typo cannot create a phantom list. */
const KNOWN: ReadonlySet<HookName> = new Set<HookName>([...BEFORE_HOOKS, ...AFTER_HOOKS]);

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Bind one hook. The returned function unregisters it (idempotent). A duplicate `id` under the same
 * hook name throws HERE — at compose time — never in the middle of an op.
 */
export function registerHook<N extends HookName>(binding: HookBinding<N>): () => void {
  if (!KNOWN.has(binding.name)) {
    throw fail("CONFIG_INVALID", "unknown hook name " + JSON.stringify(binding.name), { name: binding.name });
  }
  if (binding.id === "") throw fail("CONFIG_INVALID", "a hook binding needs an id", { name: binding.name });
  const list = registry.get(binding.name) ?? [];
  if (list.some((existing) => existing.id === binding.id)) {
    throw fail("CONFIG_INVALID", "hook " + binding.name + " already has a binding named " + JSON.stringify(binding.id), {
      name: binding.name,
      id: binding.id,
    });
  }
  const entry: Binding = { id: binding.id, run: binding.run as Binding["run"] };
  registry.set(binding.name, [...list, entry]);
  let live = true;
  return () => {
    if (!live) return;
    live = false;
    const current = registry.get(binding.name) ?? [];
    const next = current.filter((candidate) => candidate !== entry);
    if (next.length === 0) registry.delete(binding.name);
    else registry.set(binding.name, next);
  };
}

/** Drop every binding. Tests only: a hook is host composition, never agent state. */
export function resetHooks(): void {
  registry.clear();
}

/** How many bindings a hook currently has (diagnostics and tests). */
export function hookCount(name: HookName): number {
  return registry.get(name)?.length ?? 0;
}

/** The stderr prefix every contained failure carries, so the line is greppable. */
export const HOOK_LOG_PREFIX = "[praxis] hook ";

/**
 * Run every `before_` binding for this hook, in registration order, sequentially. The first veto
 * stops dispatch; a throwing hook is a veto too, so a broken hook can never read as permission.
 */
export async function dispatchBefore<N extends BeforeHookName>(
  name: N,
  payload: HookPayloads[N],
): Promise<BeforeOutcome> {
  for (const binding of registry.get(name) ?? []) {
    try {
      await binding.run(payload as never);
    } catch (error) {
      return { vetoed: true, reason: "hook threw: " + messageOf(error), hook: name + "/" + binding.id };
    }
  }
  return { vetoed: false };
}

/**
 * Run every `after_` binding for this hook, in registration order, sequentially. A throw is
 * contained: it is named, logged to stderr, and the next binding still runs.
 */
export async function dispatchAfter<N extends AfterHookName>(
  name: N,
  payload: HookPayloads[N],
): Promise<AfterOutcome> {
  const failures: { hook: string; reason: string }[] = [];
  for (const binding of registry.get(name) ?? []) {
    try {
      await binding.run(payload as never);
    } catch (error) {
      const hook = name + "/" + binding.id;
      failures.push({ hook, reason: messageOf(error) });
      process.stderr.write(HOOK_LOG_PREFIX + hook + " failed after " + payload.op + ": " + messageOf(error) + "\n");
    }
  }
  return { failures };
}

/**
 * The tool-side entry for a `before_` hook: dispatch, and turn a veto (or a throwing hook) into the
 * typed refusal this runtime already knows how to deliver. Called BEFORE the op's first write, so a
 * veto leaves nothing behind.
 */
export async function beforeOp<N extends BeforeHookName>(name: N, payload: HookPayloads[N]): Promise<void> {
  const outcome = await dispatchBefore(name, payload);
  if (!outcome.vetoed) return;
  throw fail("HOOK_VETOED", "a " + name + " hook refused this op: " + outcome.reason, {
    hook: outcome.hook,
    name,
    reason: outcome.reason,
  });
}

/**
 * The tool-side entry for an `after_` hook. It cannot fail the op: containment already happened in
 * `dispatchAfter`, and this returns nothing the caller could branch on.
 */
export async function afterOp<N extends AfterHookName>(name: N, payload: HookPayloads[N]): Promise<void> {
  await dispatchAfter(name, payload);
}
