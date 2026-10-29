/**
 * The closed capability registry and the per-step grant (R7, R9, P11).
 *
 * The registry itself is declared once, in `src/types/schema.ts`; this module adds
 * the per-step grant and the refusal path. An unknown name is a config error at
 * load (CONFIG_INVALID); a known name the step was not granted is
 * CAPABILITY_DENIED, thrown *before* the body runs, so a denial leaves no effect.
 *
 * Limit, stated plainly: this is a broker boundary inside one Node process. The
 * process still has OS access; nothing here is an isolation guarantee (gate #1).
 */
import { fail } from "../types/errors.ts";
import { CapabilitySchema, type Capability } from "../types/schema.ts";

/** The closed registry, taken from the schema so there is one authority for it. */
export const CAPABILITY_NAMES: readonly Capability[] = CapabilitySchema.options;

/** The config-declared face of a step: its id and the capabilities it asks for. */
export interface CapabilityStep {
  readonly id: string;
  readonly capabilities: readonly string[];
}

/** The runtime grant for one step execution, with its ordered call trace. */
export interface Grant {
  readonly step: string;
  readonly capabilities: ReadonlySet<Capability>;
  readonly calls: Capability[];
}

export function isCapabilityName(name: string): name is Capability {
  return (CAPABILITY_NAMES as readonly string[]).includes(name);
}

/**
 * Build a step's grant, refusing any name outside the closed registry.
 * Unknown names are invalid config, not runtime denials.
 */
export function grantFor(step: CapabilityStep): Grant {
  const declared: Capability[] = [];
  for (const name of step.capabilities) {
    if (!isCapabilityName(name)) {
      throw fail("CONFIG_INVALID", `unknown capability ${JSON.stringify(name)} on step ${JSON.stringify(step.id)}`, {
        step: step.id,
        capability: name,
        registry: [...CAPABILITY_NAMES],
      });
    }
    declared.push(name);
  }
  return { step: step.id, capabilities: new Set(declared), calls: [] };
}

/** Refuse unless the grant carries the named capability; record the call. */
export function requireGrant(grant: Grant, name: string): Capability {
  if (!isCapabilityName(name)) {
    throw fail("CONFIG_INVALID", `unknown capability ${JSON.stringify(name)}`, {
      registry: [...CAPABILITY_NAMES],
    });
  }
  if (!grant.capabilities.has(name)) {
    throw fail("CAPABILITY_DENIED", `step ${JSON.stringify(grant.step)} may not use ${name}`, {
      step: grant.step,
      capability: name,
      granted: [...grant.capabilities],
    });
  }
  grant.calls.push(name);
  return name;
}

/**
 * Run `body` under the step's grant for `name`.
 * A denial throws CAPABILITY_DENIED before `body` is entered: zero effects.
 */
export function call<T>(step: Grant, name: string, body: () => T): T {
  requireGrant(step, name);
  return body();
}

/** A copy of the ordered capability calls made through this grant. */
export function traceOf(grant: Grant): Capability[] {
  return [...grant.calls];
}
