import assert from "node:assert/strict";
import "./correctionPolicy.test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AutomaticSessionStateV1 } from "../types/automaticWorkflowV4";
import type { CandidateManifest } from "../types/specialistWorkflow";
import { buildCandidateReviewProjection } from "./candidateReviewProjection";
import type { FinalizationJournal } from "./finalizationTransaction";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-medley-review-projection-"));
const sessionId = "review-projection-test";
const sessionDir = path.join(root, sessionId);
fs.mkdirSync(sessionDir, { recursive: true });
const candidatePath = path.join(sessionDir, "candidate-001.mp3");
const candidateBytes = Buffer.from("synthetic candidate bytes");
fs.writeFileSync(candidatePath, candidateBytes);
const sha256 = crypto.createHash("sha256").update(candidateBytes).digest("hex");
const now = "2026-07-14T12:00:00.000Z";

const state: AutomaticSessionStateV1 = {
  schemaVersion: 1,
  workflowVersion: 4,
  sessionId,
  state: "manual_review_required",
  stateRevision: 9,
  selectedTrackIds: ["track-a", "track-b"],
  selectionHash: "a".repeat(64),
  designHash: "b".repeat(64),
  activeArrangementVersion: 1,
  activeExecutionGeneration: 1,
  currentCandidateId: "candidate-001",
  idempotencyRecords: [],
  recoverableError: "OpenRouter rejected the draft without a permitted correction.",
  createdAt: now,
  updatedAt: now,
};

const manifest: CandidateManifest = {
  schemaVersion: 1,
  sessionId,
  workflowMode: "automatic",
  selectedCandidateId: "candidate-001",
  finalizedCandidateId: null,
  finalOutputPath: null,
  candidates: [{
    candidateId: "candidate-001",
    candidateVersion: 1,
    parentCandidateId: null,
    arrangementVersion: 1,
    executionVersion: 1,
    outputPath: candidatePath,
    debugPaths: [],
    previewPaths: [],
    sizeBytes: candidateBytes.length,
    sha256,
    durationSec: 120,
    technicallyValid: true,
    metrics: { overallScore: 62 },
    reviewStatus: "changes_requested",
    warnings: [],
    createdAt: now,
  }],
  technicalEvaluations: [{
    candidateId: "candidate-001",
    candidateVersion: 1,
    technicallyValid: true,
    blockingIssues: [],
    warnings: [],
    policyVersion: 1,
    evaluatedAt: now,
  }],
  musicalReviews: [{
    schemaVersion: 1,
    reviewSource: "openrouter_audio",
    reviewModel: "test/free:free",
    candidateId: "candidate-001",
    candidateVersion: 1,
    arrangementVersion: 1,
    approved: false,
    emotionalArc: 60,
    transitionSmoothness: 40,
    performerIdentity: 80,
    overallScore: 62,
    blockingIssues: ["The second transition is abrupt."],
    corrections: [],
    warnings: [],
    reviewedAt: now,
  }],
  humanReviews: [],
  updatedAt: now,
};

const empty = buildCandidateReviewProjection({
  workDir: root,
  state: { ...state, state: "planning", stateRevision: 2, currentCandidateId: null },
  manifest: { ...manifest, selectedCandidateId: null, candidates: [], technicalEvaluations: [], musicalReviews: [] },
  journal: null,
});
assert.equal(empty.status, "working");
assert.equal(empty.candidateCount, 0);
assert.equal(empty.actions.includes("retry_arrangement"), true);

const rendered = buildCandidateReviewProjection({
  workDir: root,
  state: { ...state, state: "technical_review", stateRevision: 7 },
  manifest,
  journal: null,
});
assert.equal(rendered.status, "draft_ready");
assert.equal(rendered.candidates[0].actions.includes("play_candidate"), true);

const review = buildCandidateReviewProjection({ workDir: root, state, manifest, journal: null });
assert.equal(review.status, "review_required");
assert.equal(review.title, "Choose what happens to your draft");
assert.equal(review.candidateCount, 1);
assert.equal(review.maximumCandidates, 3);
assert.equal(review.candidates[0].reviewSummary, "The second transition is abrupt.");
assert.equal(review.candidates[0].actions.includes("approve_candidate"), true);
assert.equal(review.candidates[0].audioIntegrityVerified, true);
assert.equal(review.final, null);

fs.appendFileSync(candidatePath, "tampered");
const unavailable = buildCandidateReviewProjection({
  workDir: root,
  state,
  manifest,
  journal: null,
});
assert.equal(unavailable.candidates[0].audioIntegrityVerified, false);
assert.equal(unavailable.candidates[0].actions.includes("play_candidate"), false);
assert.equal(unavailable.candidates[0].actions.includes("approve_candidate"), false);
fs.writeFileSync(candidatePath, candidateBytes);

const finalPath = path.join(sessionDir, "medley_final.mp3");
fs.copyFileSync(candidatePath, finalPath);
const finalizedManifest: CandidateManifest = {
  ...manifest,
  finalizedCandidateId: "candidate-001",
  finalOutputPath: finalPath,
  candidates: [{ ...manifest.candidates[0], reviewStatus: "approved" }],
  humanReviews: [{
    candidateId: "candidate-001",
    decision: "approved",
    notes: ["Chosen by the user."],
    reviewedAt: now,
  }],
};
const journal: FinalizationJournal = {
  schemaVersion: 1,
  sessionId,
  candidateId: "candidate-001",
  summary: "Approved",
  status: "completed",
  finalPath,
  manifestVersion: 1,
  sha256,
  steps: {
    candidatePromoted: true,
    finalAudioVerified: true,
    historyWritten: true,
    wisdomWritten: true,
    checkpointDeleted: true,
  },
  startedAt: now,
  updatedAt: now,
  completedAt: now,
};
const interruptedFinalization = buildCandidateReviewProjection({
  workDir: root,
  state: { ...state, state: "finalizing", stateRevision: 10 },
  manifest: finalizedManifest,
  journal: {
    ...journal,
    status: "in_progress",
    completedAt: null,
    steps: { ...journal.steps, historyWritten: false },
  },
});
assert.equal(interruptedFinalization.status, "finalizing");
assert.equal(
  interruptedFinalization.candidates[0].actions.includes("resume_finalization"),
  true,
);
const completed = buildCandidateReviewProjection({
  workDir: root,
  state: { ...state, state: "completed", stateRevision: 11 },
  manifest: finalizedManifest,
  journal,
});
assert.equal(completed.status, "finalized");
assert.equal(completed.final?.integrityVerified, true);
assert.equal(completed.actions.includes("download_final"), true);

fs.writeFileSync(finalPath, "different bytes");
const inconsistent = buildCandidateReviewProjection({
  workDir: root,
  state: { ...state, state: "completed", stateRevision: 11 },
  manifest: finalizedManifest,
  journal,
});
assert.equal(inconsistent.status, "recoverable_error");
assert.equal(inconsistent.title, "Final verification required");

fs.rmSync(root, { recursive: true, force: true });
console.log("candidateReviewProjection tests passed");
