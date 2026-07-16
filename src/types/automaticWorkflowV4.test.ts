import assert from "node:assert/strict";
import {
  AUTOMATIC_WORKFLOW_VERSION,
  AutomaticSessionStateV1Schema,
  CandidateManifestV4Schema,
  IdempotencyRecordV1Schema,
  ManualReviewStateV1Schema,
} from "./automaticWorkflowV4";

const hash = "a".repeat(64);
const now = "2026-07-13T00:00:00.000Z";

const state = AutomaticSessionStateV1Schema.parse({
  schemaVersion: 1,
  workflowVersion: AUTOMATIC_WORKFLOW_VERSION,
  sessionId: "session-1",
  state: "created",
  stateRevision: 0,
  selectedTrackIds: ["track-a", "track-b"],
  selectionHash: hash,
  designHash: null,
  activeArrangementVersion: null,
  activeExecutionGeneration: 0,
  currentCandidateId: null,
  idempotencyRecords: [],
  recoverableError: null,
  createdAt: now,
  updatedAt: now,
});
assert.equal(state.workflowVersion, 4);
assert.equal(AutomaticSessionStateV1Schema.safeParse({ ...state, stateRevision: -1 }).success, false);

assert.equal(
  IdempotencyRecordV1Schema.safeParse({
    operation: "candidate_rendering",
    key: "render-1",
    requestHash: hash,
    responseHash: hash,
    response: { success: true },
    completedAt: now,
  }).success,
  true,
);
assert.equal(
  CandidateManifestV4Schema.safeParse({
    schemaVersion: 1,
    workflowVersion: 4,
    sessionId: "session-1",
    candidates: [],
    technicalEvaluations: [],
    musicalReviews: [],
    humanReviews: [],
    correctionEvents: [],
    selectedCandidateId: null,
    finalizedCandidateId: null,
    updatedAt: now,
  }).success,
  true,
);
assert.equal(
  ManualReviewStateV1Schema.safeParse({
    schemaVersion: 1,
    sessionId: "session-1",
    stateRevision: 2,
    reason: "Candidate limit reached",
    eligibleCandidateIds: ["candidate-001"],
    enteredAt: now,
    resolvedAt: null,
  }).success,
  true,
);

console.log("automaticWorkflowV4 schema tests passed");
