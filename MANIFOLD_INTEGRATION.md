# Manifold integration — deferred escalation routing

**Status: Manifold is NOT integrated with Praxis yet.** This file records the one place where the
quality design depends on Manifold, so it is not missed when Manifold is plugged in.

## The quality `onFailure` policy
When a task exhausts its quality attempt budget (default 3), Praxis records the artifact as **FAILED**
(durable verdict + per-dimension scores + attempt history) and then applies the task's configured
`onFailure` policy:

- **`escalate`** — halt the instance at the failed step and emit a durable `needs-guidance` signal for a
  higher-order authority to pick up and act on. The agent cannot change its own runtime, so it stops and
  hands the decision up.
- **`continue`** — record FAILED and advance the flow anyway; the failure stays on the durable record.

## ⚠ CURRENT OPERATIONAL REALITY (until Manifold is integrated)

- **Only `continue` is fully operational.**
- **`escalate` cannot route.** It can record FAILED, halt, and emit the `needs-guidance` event, but
  **nothing automatically notifies or assigns a decider**, because Manifold — the assignment/routing
  authority — is not connected. An instance set to `escalate` will stop with a durable FAILED /
  `needs-guidance` record that **no one is automatically told about**; it is discoverable only by manual
  inspection of the store.
- Therefore, until Manifold is plugged in, treat `escalate` as “hallt + log, manual discovery only.”
  **Do not rely on automatic escalation delivery.** For unattended / days-long flows that must keep
  moving, use `continue` and review the FAILED records afterward.

## What Manifold must provide when integrated (the deferred work)

- Pick up Praxis `needs-guidance` events and **route** them to an authorized decider. Manifold assigns;
  Praxis only records the FAILED fact and the needs-guidance signal.
- Carry the decider's response (guidance / decision / resume authorization) back through an **authorized,
  identity-bound transition**. Praxis honors it; Praxis does not invent the decider identity or the
  routing.

## Boundary (keep the layering)

Praxis **records** the FAILED fact + the `needs-guidance` signal and **honors** the `escalate`/`continue`
policy. **Routing, assignment, and the trusted decider identity are Manifold's job.** Praxis must never
become the router or an identity authority.

> Manifold assigns · Occam reasons · Praxis executes and preserves work · Jung synthesizes.
