import crypto from "node:crypto";
import type { DesignSnapshotV4 } from "../types/automaticWorkflowV4";

export const DETERMINISTIC_DESIGN_ALGORITHM_VERSION = "automatic-v4-design-1";
export const TRANSITION_SCORING_POLICY_VERSION = "local-transition-score-1";

type CanonicalValue = null | boolean | number | string | CanonicalValue[] | {
  [key: string]: CanonicalValue;
};

function canonicalize(value: unknown): CanonicalValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value as null | string | boolean;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical data cannot contain non-finite numbers");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]),
    );
  }
  throw new Error("Canonical data must be JSON serializable");
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

export function canonicalSha256(value: unknown) {
  return crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function milliseconds(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error("Transition timing must be a finite non-negative number");
  }
  return Math.round(seconds * 1000);
}

/**
 * The v4 candidate identity intentionally excludes mutable execution choices
 * such as style and duration. It names the authoritative musical boundary in
 * integer milliseconds so minor floating-point noise cannot produce a new
 * transition identity.
 */
export function createTransitionCandidateIdV4(input: {
  fromTrackId: string;
  fromSectionId: string;
  toTrackId: string;
  toSectionId: string;
  fromExitSec: number;
  toEntrySec: number;
}) {
  return `transition-candidate-v4-${canonicalSha256({
    fromTrackId: input.fromTrackId,
    fromSectionId: input.fromSectionId,
    toTrackId: input.toTrackId,
    toSectionId: input.toSectionId,
    fromExitMs: milliseconds(input.fromExitSec),
    toEntryMs: milliseconds(input.toEntrySec),
  })}`;
}

export type DesignHashInput = Omit<DesignSnapshotV4, "designHash" | "createdAt">;

/**
 * Hash only deterministic, source-derived inputs. UI state, temporary paths,
 * and provider response text never enter this identity.
 */
export function createDesignHash(input: DesignHashInput) {
  return canonicalSha256({
    schemaVersion: input.schemaVersion,
    workflowVersion: input.workflowVersion,
    deterministicAlgorithmVersion: input.deterministicAlgorithmVersion,
    selectedTrackIds: input.selectedTrackIds,
    selectionHash: input.selectionHash,
    sourceAudioSha256: input.sourceAudioSha256,
    analysisSchemaVersions: input.analysisSchemaVersions,
    analyzerVersions: input.analyzerVersions,
    targetDurationSec: input.targetDurationSec,
    maximumTransitions: input.maximumTransitions,
    workflowConstraints: input.workflowConstraints,
    transitionScoringPolicyVersion: input.transitionScoringPolicyVersion,
    wisdomSnapshotHash: input.wisdomSnapshotHash,
    canonicalBrief: input.canonicalBrief,
    canonicalTransitionCandidates: input.canonicalTransitionCandidates,
  });
}

export function createDesignSnapshotV4(
  input: DesignHashInput & { createdAt: string },
): DesignSnapshotV4 {
  const { createdAt, ...hashInput } = input;
  return { ...input, designHash: createDesignHash(hashInput), createdAt };
}
