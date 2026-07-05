import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG } from "../components/ConfigPanel";
import type { MedleyDesignPayload } from "./medleyIntelligence";
import {
  runAutomaticSpecialistWorkflow,
  type AutomaticWorkflowCheckpoint,
} from "./specialistOrchestrator";
import type {
  ArrangementPlan,
  ProjectBrief,
} from "../types/specialistWorkflow";

const sessionId = "checkpoint-stop";
const projectBrief: ProjectBrief = {
  schemaVersion: 1,
  projectId: sessionId,
  targetDurationSec: 120,
  trackSummaries: [
    {
      trackId: "a",
      filename: "a.mp3",
      durationSec: 120,
      tempoEstimate: 120,
      keyEstimate: null,
      confidence: 0.9,
      recommendedSectionIds: ["a-1"],
      warnings: [],
    },
    {
      trackId: "b",
      filename: "b.mp3",
      durationSec: 140,
      tempoEstimate: 124,
      keyEstimate: null,
      confidence: 0.9,
      recommendedSectionIds: ["b-1"],
      warnings: [],
    },
  ],
  recommendedOrderIds: ["a", "b"],
  constraints: [],
  warnings: [],
  summary: "Fixture brief",
};

const arrangementPlan: ArrangementPlan = {
  schemaVersion: 1,
  arrangementVersion: 1,
  projectId: sessionId,
  strategy: "Fixture plan",
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
    },
  ],
  confidence: 0.9,
  warnings: [],
};

const design: MedleyDesignPayload = {
  schemaVersion: "medley_design_v1",
  source: "local_medley_intelligence",
  userConstraints: {},
  tracks: [
    {
      trackId: "a",
      filename: "a.mp3",
      durationSec: 120,
      tempoEstimate: 120,
      tempoConfidence: 0.9,
      keyEstimate: null,
      keyConfidence: 0,
      averageEnergy: 0.5,
      peakEnergy: 0.8,
      brightnessProxy: 0.5,
      sonicDensityProxy: 0.5,
      dynamicRangeProxy: 0.5,
      confidence: 0.9,
      warnings: [],
    },
    {
      trackId: "b",
      filename: "b.mp3",
      durationSec: 140,
      tempoEstimate: 124,
      tempoConfidence: 0.9,
      keyEstimate: null,
      keyConfidence: 0,
      averageEnergy: 0.5,
      peakEnergy: 0.8,
      brightnessProxy: 0.5,
      sonicDensityProxy: 0.5,
      dynamicRangeProxy: 0.5,
      confidence: 0.9,
      warnings: [],
    },
  ],
  sections: [
    {
      sectionId: "a-1",
      trackId: "a",
      startSec: 0,
      endSec: 90,
      durationSec: 90,
      labels: ["transition_safe_zone"],
      confidence: 0.9,
      factsUsed: [],
      warnings: [],
    },
    {
      sectionId: "b-1",
      trackId: "b",
      startSec: 10,
      endSec: 60,
      durationSec: 50,
      labels: ["transition_safe_zone"],
      confidence: 0.9,
      factsUsed: [],
      warnings: [],
    },
  ],
  localFacts: [],
  heuristicGuesses: [],
  sectionScores: [],
  transitionMatrixSummary: [
    {
      fromTrackId: "a",
      toTrackId: "b",
      fromSectionId: "a-1",
      toSectionId: "b-1",
      fromExitSec: 80,
      toEntrySec: 10,
      transitionType: "smooth_blend",
      score: 0.9,
      confidence: 0.9,
      scores: {
        smoothBlend: 0.9,
        hardCut: 0.2,
        energyLift: 0.4,
        energyDrop: 0.3,
        resetMoment: 0.2,
        buildTransition: 0.4,
        finaleLaunch: 0.2,
        surpriseContrast: 0.2,
        riskLevel: 0.1,
        energyContinuity: 0.8,
        energyContrast: 0.2,
        tempoCompatibility: 0.9,
        brightnessCompatibility: 0.7,
        sonicDensityCompatibility: 0.7,
        sectionBoundaryQuality: 0.8,
        exitStrength: 0.8,
        entryStrength: 0.8,
      },
      reason: "Fixture",
      warnings: [],
    },
  ],
  recommendedStrategies: [],
  recommendedGlobalIntros: [],
  recommendedGlobalFinales: [],
  warnings: [],
  aiRules: {
    mustUseProvidedTimestamps: true,
    mustDistinguishFactsFromGuesses: true,
    mustNotInventLyrics: true,
    mustNotInventKey: true,
    mustNotInventSongMeaning: true,
  },
};

function resumeCheckpoint(): AutomaticWorkflowCheckpoint {
  return {
    schemaVersion: 3,
    sessionId,
    workflowMode: "automatic",
    stage: "production",
    activeRole: null,
    activeModel: null,
    activeRequestSequence: 1,
    attemptedModels: [],
    repairCount: 0,
    correctionCount: 0,
    projectBrief,
    arrangementPlan,
    executionReport: null,
    currentCandidate: null,
    qualityReview: null,
    savedAt: new Date(0).toISOString(),
  };
}

const originalFetch = globalThis.fetch;
const fetchCalls: string[] = [];
globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  fetchCalls.push(String(url));
  const signal = init?.signal;
  if (signal?.aborted)
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  if (
    String(url) === "/api/session/project-brief" ||
    String(url) === "/api/session/design-plan"
  ) {
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }
  throw new Error(`Unexpected fetch: ${String(url)}`);
}) as typeof fetch;

const artifactDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "ai-medley-artifact-"),
);
const completedArtifact = path.join(artifactDir, "completed.mp3");
fs.writeFileSync(completedArtifact, "completed");

const stages: string[] = [];
await assert.rejects(
  runAutomaticSpecialistWorkflow({
    sessionId,
    config: DEFAULT_CONFIG,
    library: [],
    design,
    signal: new AbortController().signal,
    requestSequence: 11,
    resume: resumeCheckpoint(),
    onLog: () => {},
    onStage: (stage) => stages.push(stage),
    onCheckpoint: async (checkpoint) => {
      if (checkpoint.stage === "production") {
        throw new Error("disk unavailable");
      }
    },
    onMetrics: () => {},
  }),
  /Checkpoint persistence failure: disk unavailable/,
);
assert.equal(stages.includes("production"), false);
assert.equal(fetchCalls.includes("/api/apply-transition"), false);
assert.equal(fs.existsSync(completedArtifact), true);

await assert.rejects(
  runAutomaticSpecialistWorkflow({
    sessionId,
    config: DEFAULT_CONFIG,
    library: [],
    design,
    signal: new AbortController().signal,
    requestSequence: 12,
    resume: resumeCheckpoint(),
    onLog: () => {},
    onStage: () => {},
    onCheckpoint: async (checkpoint) => {
      if (checkpoint.stage === "production") {
        throw new DOMException("Canceled", "AbortError");
      }
    },
    onMetrics: () => {},
  }),
  (error: any) =>
    error?.name === "AbortError" &&
    !/Checkpoint persistence/.test(error.message),
);

globalThis.fetch = originalFetch;
fs.rmSync(artifactDir, { recursive: true, force: true });
console.log("specialistOrchestrator checkpoint tests passed");
