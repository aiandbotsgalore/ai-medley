import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG } from "../components/ConfigPanel";
import type { MedleyDesignPayload } from "./medleyIntelligence";
import {
  buildDeterministicArrangementFallback,
  buildDeterministicProjectBrief,
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

const fallbackTransitionBase = design.transitionMatrixSummary[0];
const invalidEntryCandidate = {
  ...fallbackTransitionBase,
  toSectionId: "b-in",
  toEntrySec: 62,
  score: 0.95,
};
const validEntryCandidate = {
  ...fallbackTransitionBase,
  toSectionId: "b-in",
  toEntrySec: 56,
  score: 0.8,
};
const exitCandidate = {
  ...fallbackTransitionBase,
  fromTrackId: "b",
  fromSectionId: "b-out",
  toTrackId: "c",
  toSectionId: "c-1",
  fromExitSec: 60,
  toEntrySec: 10,
  score: 0.9,
};
const threeTrackDesign: MedleyDesignPayload = {
  ...design,
  tracks: [
    ...design.tracks,
    { ...design.tracks[1], trackId: "c", filename: "c.mp3", durationSec: 100 },
  ],
  sections: [
    design.sections[0],
    { ...design.sections[1], sectionId: "b-in", startSec: 50, endSec: 70 },
    { ...design.sections[1], sectionId: "b-out", startSec: 50, endSec: 70 },
    { ...design.sections[1], sectionId: "c-1", trackId: "c" },
  ],
  transitionMatrixSummary: [
    invalidEntryCandidate,
    validEntryCandidate,
    exitCandidate,
  ],
};
const threeTrackBrief: ProjectBrief = {
  ...projectBrief,
  targetDurationSec: 100,
  trackSummaries: [
    ...projectBrief.trackSummaries,
    {
      ...projectBrief.trackSummaries[1],
      trackId: "c",
      filename: "c.mp3",
      durationSec: 100,
      recommendedSectionIds: ["c-1"],
    },
  ],
  recommendedOrderIds: ["a", "b", "c"],
};
const threeTrackCandidates = threeTrackDesign.transitionMatrixSummary.map(
  (transition) => [
    createTransitionCandidateAuthority(transition),
    transition,
  ] as const,
);
const renderableFallback = buildDeterministicArrangementFallback(
  threeTrackDesign,
  threeTrackBrief,
  {
    trackIds: new Set(["a", "b", "c"]),
    sectionsById: new Map([
      ["a-1", { trackId: "a", startSec: 0, endSec: 90 }],
      ["b-in", { trackId: "b", startSec: 50, endSec: 70 }],
      ["b-out", { trackId: "b", startSec: 50, endSec: 70 }],
      ["c-1", { trackId: "c", startSec: 10, endSec: 60 }],
    ]),
    durationsByTrackId: new Map([
      ["a", 120],
      ["b", 140],
      ["c", 100],
    ]),
    targetDurationSec: 100,
    transitionCandidatesById: new Map(threeTrackCandidates),
  },
);
assert.equal(renderableFallback?.transitions[0].toEntrySec, 56);
assert.equal(renderableFallback?.transitions[1].fromExitSec, 60);

function resumeCheckpoint(): AutomaticWorkflowCheckpoint {
  return {
    schemaVersion: 3,
    workflowVersion: 4,
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

const directLocalBrief = buildDeterministicProjectBrief(design, sessionId, 106, {
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
  factsByTrackId: new Map([
    ["a", { trackId: "a", filename: "a.mp3", durationSec: 120, tempoEstimate: 120, keyEstimate: null, confidence: 0.9 }],
    ["b", { trackId: "b", filename: "b.mp3", durationSec: 140, tempoEstimate: 124, keyEstimate: null, confidence: 0.9 }],
  ]),
});
assert.equal(directLocalBrief?.recommendedOrderIds.join(","), "a,b");
assert.equal(directLocalBrief?.trackSummaries.length, 2);

let contextBriefBody = "";
let contextProviderCalls = 0;
globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  const target = String(url);
  if (target === "/api/provider/openrouter") {
    contextProviderCalls++;
    return new Response(
      JSON.stringify({ choices: [{ message: { role: "assistant", content: "plain text" } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  if (target === "/api/session/project-brief") {
    contextBriefBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }
  throw new Error(`Unexpected context fallback fetch: ${target}`);
}) as typeof fetch;

await assert.rejects(
  runAutomaticSpecialistWorkflow({
    sessionId,
    config: { ...DEFAULT_CONFIG, openrouterApiKey: SERVER_MANAGED_API_KEY },
    library: [],
    design,
    signal: new AbortController().signal,
    requestSequence: 16,
    onLog: () => {},
    onStage: () => {},
    onCheckpoint: async (checkpoint) => {
      if (checkpoint.stage === "arrangement")
        throw new DOMException("Test complete", "AbortError");
    },
    onMetrics: () => {},
  }),
  (error: any) => error?.name === "AbortError",
);
assert.equal(
  contextProviderCalls,
  0,
  "automatic v4 must not make a context-brief provider request",
);
const postedLocalBrief = JSON.parse(contextBriefBody).brief as ProjectBrief;
assert.equal(postedLocalBrief.summary, "Locally generated project brief from analyzed selected tracks.");
assert.equal(postedLocalBrief.trackSummaries.length, 2);

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
  (error: any) => /Candidate render failed without an automatic rerender/.test(error?.message || ""),
);
assert.equal(renderCallCount, 1);
assert.equal(providerCall, 0, "production corrections must not call a provider");
assert.equal(
  correctionRequestBody,
  "",
  "a failed unchanged render must not generate a production correction request",
);

globalThis.fetch = originalFetch;
(globalThis as any).window = originalWindow;
fs.rmSync(artifactDir, { recursive: true, force: true });
console.log("specialistOrchestrator checkpoint tests passed");
