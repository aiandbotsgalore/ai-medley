import assert from "node:assert/strict";
import { buildQualityReviewStageData } from "./specialistPayloads";
import type {
  ExecutionReport,
  RenderCandidate,
  ResolvedTransition,
} from "../types/specialistWorkflow";

const resolvedTransitions: ResolvedTransition[] = [
  {
    transitionId: "t1",
    fromTrackId: "a",
    fromSectionId: "a-1",
    toTrackId: "b",
    toSectionId: "b-1",
    fromExitSec: 80,
    toEntrySec: 10,
    duration: 4,
    style: "beat_aligned",
    beatAlign: true,
    notes: "",
    actualFromExitSec: 79,
    actualToEntrySec: 12,
    durationUsed: 4,
    outputPath: "transition-preview.mp3",
    executionVersion: 2,
  },
];

const candidate: RenderCandidate = {
  candidateId: "candidate-001",
  candidateVersion: 1,
  parentCandidateId: null,
  arrangementVersion: 1,
  executionVersion: 2,
  resolvedTransitions,
  outputPath: "candidate-001.mp3",
  debugPaths: [],
  previewPaths: ["transition-preview.mp3"],
  sizeBytes: 10,
  sha256: "a".repeat(64),
  durationSec: 20,
  technicallyValid: true,
  metrics: {},
  reviewStatus: "pending",
  warnings: [],
  createdAt: new Date(0).toISOString(),
};

const report: ExecutionReport = {
  schemaVersion: 1,
  executionVersion: 2,
  arrangementVersion: 1,
  attemptedTransitions: [
    {
      transitionId: "t1",
      fromTrackId: "a",
      fromSectionId: "a-1",
      toTrackId: "b",
      toSectionId: "b-1",
      fromExitSec: 80,
      toEntrySec: 10,
      duration: 5,
      style: "smooth_blend",
      beatAlign: true,
      notes: "",
      success: true,
      actualFromExitSec: 80,
      actualToEntrySec: 10,
      previewPath: "legacy-report-preview.mp3",
      error: null,
    },
  ],
  technicalWarnings: [],
  unresolvedFailures: [],
  completedAt: new Date(0).toISOString(),
};

const payload = buildQualityReviewStageData({
  candidate,
  localQuality: {},
  executionReport: report,
  resolvedTransitions: candidate.resolvedTransitions,
  correctionCount: 0,
});

assert.equal(
  payload.executionReport.attemptedTransitions[0].style,
  "beat_aligned",
);
assert.equal(payload.executionReport.attemptedTransitions[0].duration, 4);
assert.equal(
  payload.executionReport.attemptedTransitions[0].actualFromExitSec,
  79,
);

console.log("specialistPayloads tests passed");
