import { z } from "zod";
import { ArrangementPlanSchema, RenderCandidateSchema } from "./specialistWorkflow";

const Id = z.string().trim().min(1).max(200);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const IsoDate = z.string().datetime();
const Note = z.string().trim().min(1).max(2_000);

export const AUTOMATIC_WORKFLOW_VERSION = 4 as const;

export const AutomaticSessionStatusV1Schema = z.enum([
  "created",
  "analyzing",
  "planning",
  "validating_arrangement",
  "executing_transitions",
  "rendering_candidate",
  "technical_review",
  "musical_review",
  "correcting",
  "manual_review_required",
  "finalizing",
  "completed",
  "cancelled",
  "failed",
  "recoverable_error",
]);

export const IdempotencyOperationV1Schema = z.enum([
  "session_creation",
  "arrangement_submission",
  "execution_compilation",
  "transition_execution",
  "candidate_rendering",
  "candidate_registration",
  "technical_review",
  "musical_review",
  "correction_submission",
  "human_approval",
  "finalization",
]);

export const IdempotencyRecordV1Schema = z.strictObject({
  operation: IdempotencyOperationV1Schema,
  key: Id,
  requestHash: Hash,
  responseHash: Hash,
  completedAt: IsoDate,
});

export const AutomaticSessionStateV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  workflowVersion: z.literal(AUTOMATIC_WORKFLOW_VERSION),
  sessionId: Id,
  state: AutomaticSessionStatusV1Schema,
  stateRevision: z.number().int().nonnegative(),
  selectedTrackIds: z.array(Id).min(2).max(25),
  selectionHash: Hash,
  designHash: Hash.nullable(),
  activeArrangementVersion: z.number().int().positive().nullable(),
  activeExecutionGeneration: z.number().int().nonnegative(),
  currentCandidateId: Id.nullable(),
  idempotencyRecords: z.array(IdempotencyRecordV1Schema).max(200),
  recoverableError: Note.nullable(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});

export const DesignSnapshotV4Schema = z.strictObject({
  schemaVersion: z.literal(1),
  workflowVersion: z.literal(AUTOMATIC_WORKFLOW_VERSION),
  deterministicAlgorithmVersion: Id,
  sessionId: Id,
  selectedTrackIds: z.array(Id).min(2).max(25),
  selectionHash: Hash,
  sourceAudioSha256: z.record(Id, Hash),
  analysisSchemaVersions: z.record(Id, Id),
  analyzerVersions: z.record(Id, Id),
  targetDurationSec: z.number().positive(),
  maximumTransitions: z.number().int().positive(),
  workflowConstraints: z.record(z.string(), z.unknown()),
  transitionScoringPolicyVersion: Id,
  wisdomSnapshotHash: Hash,
  canonicalBrief: z.record(z.string(), z.unknown()),
  canonicalTransitionCandidates: z.array(z.record(z.string(), z.unknown())),
  designHash: Hash,
  createdAt: IsoDate,
});

export const ArrangementVersionV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  workflowVersion: z.literal(AUTOMATIC_WORKFLOW_VERSION),
  sessionId: Id,
  arrangementVersion: z.number().int().positive(),
  designHash: Hash,
  arrangement: ArrangementPlanSchema,
  submittedAt: IsoDate,
});

export const TechnicalEvaluationV1Schema = z.strictObject({
  evaluationId: Id,
  candidateId: Id,
  approved: z.boolean(),
  metrics: z.record(z.string(), z.number()),
  blockingIssues: z.array(Note).max(50),
  evaluatedAt: IsoDate,
});

export const MusicalReviewV1Schema = z.strictObject({
  reviewId: Id,
  candidateId: Id,
  approved: z.boolean(),
  provider: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(300),
  blockingIssues: z.array(Note).max(50),
  requestedCorrections: z.array(Note).max(50),
  reviewedAt: IsoDate,
});

export const HumanReviewV1Schema = z.strictObject({
  reviewId: Id,
  candidateId: Id,
  decision: z.enum(["approved", "changes_requested"]),
  notes: z.array(Note).max(50),
  reviewedAt: IsoDate,
});

export const CorrectionEventV1Schema = z.strictObject({
  correctionId: Id,
  candidateId: Id,
  executionGeneration: z.number().int().nonnegative(),
  requestedTransitionIds: z.array(Id).min(1).max(99),
  reason: Note,
  createdAt: IsoDate,
});

export const CandidateManifestV4Schema = z.strictObject({
  schemaVersion: z.literal(1),
  workflowVersion: z.literal(AUTOMATIC_WORKFLOW_VERSION),
  sessionId: Id,
  candidates: z.array(RenderCandidateSchema).max(100),
  technicalEvaluations: z.array(TechnicalEvaluationV1Schema).max(500),
  musicalReviews: z.array(MusicalReviewV1Schema).max(500),
  humanReviews: z.array(HumanReviewV1Schema).max(500),
  correctionEvents: z.array(CorrectionEventV1Schema).max(500),
  selectedCandidateId: Id.nullable(),
  finalizedCandidateId: Id.nullable(),
  updatedAt: IsoDate,
});

export const ManualReviewStateV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  sessionId: Id,
  stateRevision: z.number().int().nonnegative(),
  reason: Note,
  eligibleCandidateIds: z.array(Id).min(1).max(100),
  enteredAt: IsoDate,
  resolvedAt: IsoDate.nullable(),
});

export type AutomaticSessionStateV1 = z.infer<typeof AutomaticSessionStateV1Schema>;
export type DesignSnapshotV4 = z.infer<typeof DesignSnapshotV4Schema>;
export type ArrangementVersionV1 = z.infer<typeof ArrangementVersionV1Schema>;
export type CandidateManifestV4 = z.infer<typeof CandidateManifestV4Schema>;
export type ManualReviewStateV1 = z.infer<typeof ManualReviewStateV1Schema>;
