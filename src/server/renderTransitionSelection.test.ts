import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createEmptyManifest } from "./candidateStore";
import { selectRenderTransitions } from "./renderTransitionSelection";
import type {
  AutomaticWorkflowCheckpoint,
  CandidateManifest,
  SpecialistContext,
} from "../types/specialistWorkflow";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-medley-render-select-"));
const checkpointDir = path.join(root, "checkpoints");
fs.mkdirSync(checkpointDir, { recursive: true });

const sessionId = "render-session";
const plan = {
  schemaVersion: 1,
  arrangementVersion: 7,
  projectId: sessionId,
  strategy: "Fixture",
  orderedTrackIds: ["a", "b"],
  transitions: [
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
      executionPermissions: {
        styleMutable: true,
        allowedStyles: ["smooth_blend", "beat_aligned"],
        durationMutable: true,
        minDuration: 3,
        maxDuration: 6,
      },
    },
  ],
  confidence: 0.9,
  warnings: [],
} as const;

const executionReport = {
  schemaVersion: 1,
  executionVersion: 3,
  arrangementVersion: 7,
  attemptedTransitions: [
    {
      ...plan.transitions[0],
      success: true,
      actualFromExitSec: 79,
      actualToEntrySec: 12,
      previewPath: "transition-preview.mp3",
      error: null,
    },
  ],
  technicalWarnings: [],
  unresolvedFailures: [],
  completedAt: new Date(0).toISOString(),
} as const;

const executionResults = {
  3: {
    t1: {
      request: {
        transitionId: "t1",
        fromTrackId: "a",
        fromSectionId: "a-1",
        toTrackId: "b",
        toSectionId: "b-1",
        style: "beat_aligned",
        duration: 4,
        beatAlign: true,
      },
      success: true,
      actualFromExitSec: 79,
      actualToEntrySec: 12,
      previewPath: "transition-preview.mp3",
      error: null,
    },
  },
};

const context: SpecialistContext = {
  trackIds: new Set(["a", "b"]),
  sectionsById: new Map([
    ["a-1", { trackId: "a", startSec: 0, endSec: 90 }],
    ["b-1", { trackId: "b", startSec: 10, endSec: 60 }],
  ]),
  durationsByTrackId: new Map([
    ["a", 120],
    ["b", 140],
  ]),
};

const automaticManifest: CandidateManifest = {
  ...createEmptyManifest(sessionId),
  workflowMode: "automatic",
};
const automatic = selectRenderTransitions({
  sessionId,
  session: { designPlan: plan, executionReport, executionResults },
  legacy: false,
  arrangementVersion: 7,
  executionVersion: 3,
  manifest: automaticManifest,
  checkpointDir,
  context,
});
assert.equal(automatic.automaticSession, true);
assert.equal(automatic.transitions[0].style, "beat_aligned");
assert.equal(automatic.transitions[0].durationUsed, 4);

const checkpointOnlySession = "checkpoint-only";
const checkpoint: AutomaticWorkflowCheckpoint = {
  schemaVersion: 3,
  sessionId: checkpointOnlySession,
  workflowMode: "automatic",
  stage: "final_render",
  activeRole: null,
  activeModel: null,
  activeRequestSequence: 5,
  attemptedModels: [],
  repairCount: 0,
  correctionCount: 0,
  projectBrief: null,
  arrangementPlan: null,
  executionReport: null,
  currentCandidate: null,
  qualityReview: null,
  savedAt: new Date(0).toISOString(),
};
fs.writeFileSync(
  path.join(checkpointDir, `${checkpointOnlySession}.json`),
  JSON.stringify(checkpoint),
  "utf8",
);
const checkpointDetected = selectRenderTransitions({
  sessionId: checkpointOnlySession,
  session: {
    designPlan: { ...plan, projectId: checkpointOnlySession },
    executionReport,
    executionResults,
  },
  legacy: false,
  arrangementVersion: 7,
  executionVersion: 3,
  manifest: createEmptyManifest(checkpointOnlySession),
  checkpointDir,
  context,
});
assert.equal(checkpointDetected.automaticSession, true);
assert.equal(checkpointDetected.transitions[0].style, "beat_aligned");

assert.throws(
  () =>
    selectRenderTransitions({
      sessionId: checkpointOnlySession,
      session: {
        designPlan: { ...plan, projectId: checkpointOnlySession },
        executionReport,
        executionResults: {},
      },
      legacy: false,
      arrangementVersion: 7,
      executionVersion: 3,
      manifest: createEmptyManifest(checkpointOnlySession),
      checkpointDir,
      context,
    }),
  /Missing server execution record/,
);

const legacyManifest: CandidateManifest = {
  ...createEmptyManifest("legacy-render"),
  workflowMode: "legacy",
};
const legacy = selectRenderTransitions({
  sessionId: "legacy-render",
  session: { designPlan: plan, executionReport },
  legacy: false,
  arrangementVersion: 7,
  executionVersion: 3,
  manifest: legacyManifest,
  checkpointDir,
  context,
});
assert.equal(legacy.automaticSession, false);
assert.equal(legacy.transitions[0].style, "smooth_blend");

fs.rmSync(root, { recursive: true, force: true });
console.log("renderTransitionSelection tests passed");
