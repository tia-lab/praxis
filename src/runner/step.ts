/**
 * One node's step body and the deterministic gate (plan step 5): the declarations moved
 * out of `engine.ts` so that file stays under the cap, as a move and not a rewrite.
 *
 * What changed is only the wiring: `consumes` became an ordered source list, so a `data`
 * node gets one handoff and a `join` node gets every source in declared edge order. The
 * reuse, refusal and digest rules are the ones the slice already proved.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { fail, isAppError, type Code } from "../types/errors.ts";
import { missingFor } from "./requirements.ts";
import { compoundDecision } from "../quality/bar.ts";
import {
  DigestSchema,
  type Artifact,
  type FlowConfig,
  type Instance,
  type Node,
  type QualityVerdict,
  type Requirements,
  type ResolvedNode,
  type TaskConfig,
} from "../types/schema.ts";
import type { Store } from "../store/db.ts";
import { readArtifact, recordArtifact } from "../store/artifacts.ts";
import { listEvents } from "../store/events.ts";
import { call, type Grant } from "./capabilities.ts";
import { canonicalBytes, digest } from "./canonical.ts";

/** The literal handoff a consuming node receives (R7): four fields, no more. */
export interface Handoff {
  artifactRef: string;
  digest: string;
  path: string;
  schema: string;
}

export interface RunStepArgs {
  store: Store;
  storeDir: string;
  instance: Instance;
  node: Node;
  task: TaskConfig;
  grant: Grant;
  /** Ordered source handoffs; empty for the first node, two or more for a join. */
  handoffs: readonly Handoff[];
  payload?: unknown;
  at: string;
}

export interface StepArtifact {
  version: number;
  path: string;
  digest: string;
  value: unknown;
}

/** The step id a handoff came from: `artifactRef` is `<node>@<version>` and nothing else. */
function sourceOf(handoff: Handoff): string {
  const at = handoff.artifactRef.lastIndexOf("@");
  return at < 0 ? handoff.artifactRef : handoff.artifactRef.slice(0, at);
}

/** The version a handoff names, so a re-read opens exactly the version that was handed off. */
function versionOf(handoff: Handoff): number {
  const at = handoff.artifactRef.lastIndexOf("@");
  const version = Number(at < 0 ? "" : handoff.artifactRef.slice(at + 1));
  if (!Number.isInteger(version) || version < 1) {
    throw fail("ARTIFACT_INVALID", "handoff " + JSON.stringify(handoff.artifactRef) + " names no version", {
      artifactRef: handoff.artifactRef,
    });
  }
  return version;
}

/**
 * The node this one hands off to: the earliest node it feeds, never "the first edge as
 * declared". An ambiguous set (two data targets or two join groups) is refused here and
 * again at load, so a flow cannot choose its own successor by edge order (defect 2).
 */
export function successorOf(config: FlowConfig, nodeId: string): string | undefined {
  const outgoing = config.edges.filter(
    (edge) => (edge.kind === "data" || edge.kind === "join") && edge.from === nodeId,
  );
  const targets = [...new Set(outgoing.map((edge) => edge.to))];
  const dataNext = new Set(outgoing.filter((edge) => edge.kind === "data").map((edge) => edge.to));
  const joinNext = new Set(outgoing.filter((edge) => edge.kind === "join").map((edge) => edge.to));
  if (dataNext.size > 1 || joinNext.size > 1) {
    throw fail("CONFIG_INVALID", `node ${nodeId} feeds an ambiguous successor set`, { node: nodeId, targets });
  }
  const indexOf = (id: string): number => config.nodes.findIndex((candidate) => candidate.id === id);
  targets.sort((left, right) => indexOf(left) - indexOf(right));
  return targets[0];
}

/**
 * Build the four-field handoffs for a consuming node, in declared edge order.
 * Without artifact.read there is no handoff at all: fail closed, zero effects (R9).
 * Integrity is verified here, before any dispatch (R10).
 */
export function buildHandoffs(store: Store, instance: Instance, resolved: ResolvedNode, grant: Grant): Handoff[] {
  if (resolved.sources.length === 0) return [];
  if (!grant.capabilities.has("artifact.read")) {
    throw fail(
      "ARTIFACT_UNAVAILABLE",
      "node " + JSON.stringify(resolved.node.id) + " may not receive a handoff without artifact.read",
      {
        instance: instance.id,
        step: resolved.node.id,
        consumed: [...resolved.sources],
        granted: [...grant.capabilities],
      },
    );
  }
  return resolved.sources.map((source) => {
    // A handoff is an ACCEPTED artifact, and since the onFailure `continue` policy carries the
    // best-scoring attempt forward, the accepted version need not be the newest row: read the
    // highest accepted version, never merely the latest one.
    const accepted = acceptedVersionOf(store, instance.id, source);
    const found = accepted === undefined ? undefined : probeArtifact(store, instance.id, source, accepted);
    if (found === undefined || found.artifact.state !== "accepted") {
      throw fail("ARTIFACT_UNAVAILABLE", "no accepted artifact from " + JSON.stringify(source) + " to hand off", {
        instance: instance.id,
        step: resolved.node.id,
        consumed: source,
        state: found === undefined ? "absent" : found.artifact.state,
      });
    }
    const observed = digest(found.bytes);
    if (observed !== found.artifact.digest) {
      throw fail("ARTIFACT_DIGEST_MISMATCH", "artifact " + source + " does not match its recorded digest", {
        instance: instance.id,
        artifactRef: source + "@" + found.artifact.version,
        recorded: found.artifact.digest,
        observed,
      });
    }
    return {
      artifactRef: source + "@" + found.artifact.version,
      digest: found.artifact.digest,
      path: found.artifact.path,
      schema: found.artifact.schema,
    };
  });
}

/**
 * Execute the node body under its grant: read the predecessors when consuming,
 * canonicalise and persist this node's artifact. A version left `pending` by a killed
 * attempt is reused, never re-recorded (P8).
 */
export function runStep(args: RunStepArgs): StepArtifact {
  const { store, storeDir, instance, node, task, grant, handoffs, payload, at } = args;
  const existing = probeArtifact(store, instance.id, node.id);
  const value: unknown = payload === undefined ? {} : payload;
  const bytes = canonicalBytes(value);
  const artifactDigest = digest(bytes);
  let version = 1;

  if (existing !== undefined && existing.artifact.digest === artifactDigest) {
    const same = existing.artifact;
    return { version: same.version, path: same.path, digest: same.digest, value: parseStored(store, instance.id, node.id, same.version) };
  }
  if (existing !== undefined) {
    // A pending version nobody refused is a killed attempt: its bytes are not evidence
    // of a decision, so different content may not take its place. An accepted version is
    // a decision, and re-entering the node (rework) legitimately writes the next one.
    if (existing.artifact.state === "pending" && !refused(store, instance.id, node.id, existing.artifact.digest)) {
      throw fail("ARTIFACT_VERSION_CONFLICT", "step " + JSON.stringify(node.id) + " has a recorded attempt with different content", {
        instance: instance.id,
        step: node.id,
        version: existing.artifact.version,
        recorded: existing.artifact.digest,
        offered: artifactDigest,
      });
    }
    // The refused version stays pending with its bytes; the retry takes the next one.
    version = existing.artifact.version + 1;
  }

  const path = join(storeDir, "artifacts", instance.id, node.id, "v" + version + ".json");

  if (handoffs.length > 0) {
    call(grant, "artifact.read", () => {
      for (const handoff of handoffs) {
        // The named version, not the newest row: a hidden change is exactly what the digest
        // check exists to catch (quality loop: a continued artifact may not be the latest).
        const read = readArtifact(store, instance.id, sourceOf(handoff), versionOf(handoff));
        const seen = digest(read.bytes);
        if (seen !== handoff.digest) {
          throw fail("ARTIFACT_DIGEST_MISMATCH", "re-read of " + handoff.artifactRef + " no longer matches", {
            artifactRef: handoff.artifactRef,
            expected: handoff.digest,
            observed: seen,
          });
        }
      }
    });
  }

  call(grant, "artifact.write", () => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    recordArtifact(store, {
      instance: instance.id,
      step: node.id,
      version,
      path,
      digest: artifactDigest,
      schema: task.produces.schema,
      state: "pending",
      derivedFrom: handoffs.length === 1 ? handoffs[0].digest : null,
      at,
    });
  });

  return { version, path, digest: artifactDigest, value };
}

/** Was this content refused by the gate for this node? A refusal is durable, so retryable. */
function refused(store: Store, instance: string, step: string, artifactDigest: string): boolean {
  return listEvents(store, instance).some((event) => {
    const payload = event.type === "gate.verdict" ? payloadOf(event.payload) : {};
    return payload.step === step && payload.decision === "reject" && payload.artifactDigest === artifactDigest;
  });
}

/** The payload of a stored event, as a record; anything else carries no fields here. */
function payloadOf(payload: unknown): Record<string, unknown> {
  if (typeof payload === "object" && payload !== null) return payload as Record<string, unknown>;
  return {};
}

function parseStored(store: Store, instance: string, step: string, version: number): unknown {
  const read = readArtifact(store, instance, step, version);
  try {
    return JSON.parse(Buffer.from(read.bytes).toString("utf8")) as unknown;
  } catch (error) {
    throw fail("ARTIFACT_INVALID", "recorded artifact " + step + " is not JSON", {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

function probeArtifact(
  store: Store,
  instance: string,
  step: string,
  version?: number,
): { artifact: Artifact; bytes: Uint8Array } | undefined {
  try {
    return readArtifact(store, instance, step, version);
  } catch (error) {
    if (isAppError(error) && error.code === "ARTIFACT_UNAVAILABLE") return undefined;
    throw error;
  }
}

/** The highest accepted version of a step, from its own `artifact.accepted` events. */
function acceptedVersionOf(store: Store, instance: string, step: string): number | undefined {
  let accepted: number | undefined;
  for (const event of listEvents(store, instance)) {
    if (event.type !== "artifact.accepted") continue;
    const payload = payloadOf(event.payload);
    if (payload.step !== step) continue;
    const version = Number(payload.version);
    if (Number.isInteger(version) && (accepted === undefined || version > accepted)) accepted = version;
  }
  return accepted;
}

const GateSubject = z.looseObject({
  schema: z.string().min(1),
  nonce: z.string().min(1),
  derivedFrom: z.string().min(1).optional(),
  /** The digest of the artifact a review judged (spec R6). */
  subject: z.string().min(1).optional(),
});

export interface Verdict {
  decision: "accept" | "reject";
  checks: Record<string, boolean>;
  /** The typed code for the first failing check (A10). */
  code?: Code;
  /** What the document was missing, when a section requirement failed. */
  missing?: string[];
  /** The quality judgment recorded for this artifact, when a quality floor applies. */
  quality?: QualityVerdict;
}

/**
 * The deterministic gate: object, schema, nonce, subject presence, the subject-vs-derivedFrom
 * pair, the retained derivedFrom comparison, then the section requirements (R5, R6, A10).
 * The first failing check decides the code.
 */
export function gate(
  value: unknown,
  expected: {
    schema: string;
    nonce: string;
    derivedFrom?: string;
    requires?: Requirements;
    /** The task declares `bindsSubject`, so the payload must carry a current `subject`. */
    subject?: boolean;
    /**
     * An optional quality floor: policy, the global MEAN bar (`threshold`), the per-dimension bars
     * (`floors`) and the pre-computed verdict. The check is the compound: every dimension within its
     * tolerance band AND the MEAN at the global bar.
     */
    quality?: {
      policy: "required" | "advisory";
      threshold: number;
      floors?: Record<string, number>;
      verdict?: QualityVerdict;
    };
  },
): Verdict {
  const parsed = GateSubject.safeParse(value);
  const subject = parsed.success ? parsed.data : undefined;
  const checks: Record<string, boolean> = {
    object: parsed.success,
    schemaMatches: subject !== undefined && subject.schema === expected.schema,
    noncePresent: subject !== undefined && subject.nonce === expected.nonce,
  };
  let code: Code | undefined;
  const decide = (failed: boolean, failure: Code): void => {
    if (failed && code === undefined) code = failure;
  };
  decide(!checks.object, "ARTIFACT_INVALID");
  decide(!checks.schemaMatches, "ARTIFACT_INVALID");
  decide(!checks.noncePresent, "ARTIFACT_INVALID");

  if (expected.subject === true) {
    // `SUBJECT_MISSING` is reserved for an absent subject; a present but malformed one is
    // the code R6 already names for a bad payload, never "missing" (reviewer defect 4).
    checks.subjectPresent = subject?.subject !== undefined;
    decide(!checks.subjectPresent, "SUBJECT_MISSING");
    if (checks.subjectPresent) {
      checks.subjectWellFormed = DigestSchema.safeParse(subject?.subject).success;
      decide(!checks.subjectWellFormed, "ARTIFACT_INVALID");
      checks.subjectMatchesDerived = subject?.derivedFrom !== undefined && subject.subject === subject.derivedFrom;
      decide(!checks.subjectMatchesDerived, "ARTIFACT_INVALID");
    }
  }
  if (expected.derivedFrom !== undefined) {
    checks.derivedFromMatches = subject !== undefined && subject.derivedFrom === expected.derivedFrom;
    decide(!checks.derivedFromMatches, expected.subject === true ? "SUBJECT_STALE" : "ARTIFACT_INVALID");
  }
  let missing: string[] | undefined;
  if (expected.requires !== undefined) {
    missing = missingFor(value, expected.requires);
    checks.sectionRequirement = missing.length === 0;
    decide(!checks.sectionRequirement, "ARTIFACT_INVALID");
  }
  // Quality floor (quality eval). The verdict is pre-computed outside any transaction and passed
  // in; the gate only enforces it. An advisory floor never blocks; a required floor blocks when no
  // score is available (QUALITY_REQUIRED) or the score is below the threshold (QUALITY_BELOW_THRESHOLD).
  const qualityVerdict = expected.quality?.verdict;
  if (expected.quality?.policy === "required") {
    if (qualityVerdict === undefined || qualityVerdict.decision === "unavailable") {
      checks.qualityAvailable = false;
      decide(true, "QUALITY_REQUIRED");
    } else {
      // The compound accept (per-dimension bars + HARD mean bar), computed here from the verdict's
      // own scores, so the recorded decision is checked rather than trusted.
      const compound = compoundDecision(qualityVerdict.dimensions, {
        global: expected.quality.threshold,
        perDimension: new Map(Object.entries(expected.quality.floors ?? {})),
      });
      checks.qualityPerDimension = compound.refused.length === 0;
      checks.qualityMean = compound.mean >= expected.quality.threshold;
      checks.qualityFloor = checks.qualityPerDimension && checks.qualityMean;
      decide(!checks.qualityFloor, "QUALITY_BELOW_THRESHOLD");
    }
  }
  const accepted = Object.values(checks).every(Boolean);
  const verdict: Verdict = { decision: accepted ? "accept" : "reject", checks };
  if (code !== undefined) verdict.code = code;
  if (missing !== undefined && missing.length > 0) verdict.missing = missing;
  if (qualityVerdict !== undefined) verdict.quality = qualityVerdict;
  return verdict;
}
