import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG } from "../components/ConfigPanel";
import type { MedleyDesignPayload } from "./medleyIntelligence";
import {
  buildDeterministicArrangementFallback,
  normalizeRenderFailureFeedback,
  runAutomaticSpecialistWorkflow,
  type AutomaticWorkflowCheckpoint,
} from "./specialistOrchestrator";
import { SERVER_MANAGED_API_KEY } from "../constants/provider";
import {
  createTransitionCandidateAuthority,
  type ArrangementPlan,
  type ProjectBrief,
} from "../types/specialistWorkflow";

const sessionId = "checkpoint-stop";
const projectBrief: ProjectBrief = {
  schemaVersion: 1,
  projectId: sessionId,
  targetDurationSec: 106,
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

arrangementPlan.transitions[0].transitionCandidateId =
  createTransitionCandidateAuthority(design.transitionMatrixSummary[0]);

const localFallback = buildDeterministicArrangementFallback(
  design,
  { ...projectBrief, targetDurationSec: 106 },
  {
    trackIds: new Set(["a", "b"]),
    sectionsById: new Map([
      ["a-1", { trackId: "a", startSec: 0, endSec: 90 }],
      ["b-1", { trackId: "b", startSec: 10, endSec: 60 }],
    ]),
    durationsByTrackId: new Map([
      ["a", 120],
      ["b", 140],
    ]),
    targetDurationSec: 106,
    transitionCandidatesById: new Map([
      [createTransitionCandidateAuthority(design.transitionMatrixSummary[0]), design.transitionMatrixSummary[0]],
    ]),
  },
);
assert.equal(localFallback?.transitions[0].fromSectionId, "a-1");
assert.equal(localFallback?.transitions[0].toSectionId, "b-1");

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

assert.deepEqual(
  normalizeRenderFailureFeedback(
    {
      error: "render failed",
      note: "candidate was not created",
      details: "ffmpeg exited 1",
      logFiles: {
        error: "render-error.json",
        graph: "filtergraph.txt",
        command: "command.txt",
        stderr: "stderr.log",
      },
      renderPath: "pure-clean-mvp-failed",
    },
    new Error("request failed"),
  ),
  [
    "error: render failed",
    "note: candidate was not created",
    "details: ffmpeg exited 1",
    "logFiles.error: render-error.json",
    "logFiles.graph: filtergraph.txt",
    "logFiles.command: command.txt",
    "logFiles.stderr: stderr.log",
    "renderPath: pure-clean-mvp-failed",
  ],
);

const originalWindow = (globalThis as any).window;
(globalThis as any).window = {
  setTimeout,
  clearTimeout,
  location: { origin: "http://localhost" },
};

const fallbackCheckpoint: AutomaticWorkflowCheckpoint = {
  ...resumeCheckpoint(),
  stage: "arrangement",
  arrangementPlan: null,
};
let fallbackPlanBody = "";
let fallbackProviderCalls = 0;
globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  const target = String(url);
  if (target === "/api/session/project-brief")
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  if (target === "/api/provider/openrouter") {
    fallbackProviderCalls++;
    return new Response(JSON.stringify({ error: "gateway timed out" }), {
      status: 504,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (target === "/api/session/design-plan") {
    fallbackPlanBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }
  throw new Error(`Unexpected fallback fetch: ${target}`);
}) as typeof fetch;

await assert.rejects(
  runAutomaticSpecialistWorkflow({
    sessionId,
    config: {
      ...DEFAULT_CONFIG,
      openrouterApiKey: SERVER_MANAGED_API_KEY,
    },
    library: [],
    design,
    signal: new AbortController().signal,
    requestSequence: 13,
    resume: fallbackCheckpoint,
    onLog: () => {},
    onStage: () => {},
    onCheckpoint: async (checkpoint) => {
      if (checkpoint.stage === "production")
        throw new DOMException("Test complete", "AbortError");
    },
    onMetrics: () => {},
  }),
  (error: any) => error?.name === "AbortError",
);
assert.ok(fallbackProviderCalls > 0);
const fallbackPlan = JSON.parse(fallbackPlanBody).plan as ArrangementPlan;
assert.equal(fallbackPlan.strategy, "Local target-matched fallback");
assert.equal(fallbackPlan.transitions[0].fromSectionId, "a-1");
assert.equal(fallbackPlan.transitions[0].toSectionId, "b-1");

const invalidResumedCheckpoint: AutomaticWorkflowCheckpoint = {
  ...resumeCheckpoint(),
  arrangementPlan: {
    ...arrangementPlan,
    transitions: [
      { ...arrangementPlan.transitions[0], fromExitSec: 20 },
    ],
  },
};
const providerCallsBeforeResumeRecovery = fallbackProviderCalls;
await assert.rejects(
  runAutomaticSpecialistWorkflow({
    sessionId,
    config: {
      ...DEFAULT_CONFIG,
      openrouterApiKey: SERVER_MANAGED_API_KEY,
    },
    library: [],
    design,
    signal: new AbortController().signal,
    requestSequence: 14,
    resume: invalidResumedCheckpoint,
    onLog: () => {},
    onStage: () => {},
    onCheckpoint: async (checkpoint) => {
      if (checkpoint.stage === "production")
        throw new DOMException("Test complete", "AbortError");
    },
    onMetrics: () => {},
  }),
  (error: any) => error?.name === "AbortError",
);
assert.equal(fallbackProviderCalls, providerCallsBeforeResumeRecovery);
const recoveredResumePlan = JSON.parse(fallbackPlanBody).plan as ArrangementPlan;
assert.equal(recoveredResumePlan.strategy, "Local target-matched fallback");
assert.equal(recoveredResumePlan.transitions[0].fromExitSec, 80);

const abortedArrangementController = new AbortController();
let abortFallbackPlanPosted = false;
globalThis.fetch = (async (url: RequestInfo | URL) => {
  const target = String(url);
  if (target === "/api/session/project-brief")
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  if (target === "/api/provider/openrouter") {
    abortedArrangementController.abort(new DOMException("Canceled", "AbortError"));
    throw abortedArrangementController.signal.reason;
  }
  if (target === "/api/session/design-plan") abortFallbackPlanPosted = true;
  throw new Error(`Unexpected abort fetch: ${target}`);
}) as typeof fetch;

await assert.rejects(
  runAutomaticSpecialistWorkflow({
    sessionId,
    config: {
      ...DEFAULT_CONFIG,
      openrouterApiKey: SERVER_MANAGED_API_KEY,
    },
    library: [],
    design,
    signal: abortedArrangementController.signal,
    requestSequence: 15,
    resume: fallbackCheckpoint,
    onLog: () => {},
    onStage: () => {},
    onCheckpoint: async () => {},
    onMetrics: () => {},
  }),
  (error: any) => error?.name === "AbortError",
);
assert.equal(abortFallbackPlanPosted, false);

const recoveryController = new AbortController();
const recoveryLogs: string[] = [];
const recoveryCheckpoints: AutomaticWorkflowCheckpoint[] = [];
let providerCall = 0;
let renderCallCount = 0;
let correctionRequestBody = "";

function openRouterToolCall(id: string, name: string, args: unknown) {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id,
                type: "function",
                function: { name, arguments: JSON.stringify(args) },
              },
            ],
          },
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  const target = String(url);
  if (target === "/api/session/project-brief" || target === "/api/session/design-plan") {
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }
  if (target === "/api/provider/openrouter") {
    providerCall++;
    if (providerCall === 1) {
      return openRouterToolCall("transition-call", "apply_musical_transition", {
        transitionId: "t1",
        fromTrackId: "a",
        fromSectionId: "a-1",
        toTrackId: "b",
        toSectionId: "b-1",
        style: "smooth_blend",
        duration: 5,
        beatAlign: true,
        notes: "",
      });
    }
    if (providerCall === 2) {
      return openRouterToolCall("report-call", "submit_execution_report", {
        schemaVersion: 1,
        executionVersion: 1,
        arrangementVersion: 1,
        attemptedTransitions: [
          {
            ...arrangementPlan.transitions[0],
            success: true,
            actualFromExitSec: 80,
            actualToEntrySec: 10,
            previewPath: "transition.mp3",
            error: null,
          },
        ],
        technicalWarnings: [],
        unresolvedFailures: [],
        completedAt: new Date().toISOString(),
      });
    }
    correctionRequestBody = String(init?.body ?? "");
    recoveryController.abort(new DOMException("Test complete", "AbortError"));
    throw recoveryController.signal.reason;
  }
  if (target === "/api/apply-transition") {
    return new Response(
      JSON.stringify({
        success: true,
        previewPath: "transition.mp3",
        actualFromExitSec: 80,
        actualToEntrySec: 10,
        styleUsed: "smooth_blend",
        durationUsed: 5,
      }),
      { status: 200 },
    );
  }
  if (target === "/api/session/execution-report") {
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }
  if (target === "/api/render-review-candidate") {
    renderCallCount++;
    return new Response(
      JSON.stringify({
        success: false,
        error: "FFmpeg render exploded",
        note: "Existing candidates were preserved",
        details: "filter graph rejected",
        logFiles: {
          error: "render-error.json",
          graph: "filtergraph.txt",
          command: "command.txt",
          stderr: "stderr.log",
        },
        renderPath: "pure-clean-mvp-failed",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  throw new Error(`Unexpected recovery fetch: ${target}`);
}) as typeof fetch;

await assert.rejects(
  runAutomaticSpecialistWorkflow({
    sessionId,
    config: {
      ...DEFAULT_CONFIG,
      openrouterApiKey: SERVER_MANAGED_API_KEY,
    },
    library: [],
    design,
    signal: recoveryController.signal,
    requestSequence: 13,
    resume: resumeCheckpoint(),
    onLog: (message) => recoveryLogs.push(message),
    onStage: () => {},
    onCheckpoint: async (checkpoint) => {
      recoveryCheckpoints.push(structuredClone(checkpoint));
    },
    onMetrics: () => {},
  }),
  (error: any) => error?.name === "AbortError",
);
assert.equal(renderCallCount, 1);
assert.ok(
  recoveryLogs.includes(
    "Render candidate failed; starting correction cycle 1/3.",
  ),
);
assert.ok(
  recoveryCheckpoints.some(
    (checkpoint) =>
      checkpoint.stage === "correction" && checkpoint.correctionCount === 1,
  ),
);
const correctionRequest = JSON.parse(correctionRequestBody);
const correctionPrompt = JSON.parse(
  correctionRequest.messages.findLast((message: any) => message.role === "user")
    .content,
);
assert.equal(correctionPrompt.correctionCount, 1);
assert.ok(
  correctionPrompt.repairErrors.some((item: string) =>
    item.includes("FFmpeg render exploded"),
  ),
);
assert.ok(
  correctionPrompt.repairErrors.some((item: string) =>
    item.includes("filtergraph.txt"),
  ),
);

globalThis.fetch = originalFetch;
(globalThis as any).window = originalWindow;
fs.rmSync(artifactDir, { recursive: true, force: true });
console.log("specialistOrchestrator checkpoint tests passed");
