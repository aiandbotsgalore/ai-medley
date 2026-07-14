import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG } from "../components/ConfigPanel";
import type { MedleyDesignPayload } from "./medleyIntelligence";
import {
  buildDeterministicArrangementFallback,
  buildDeterministicProjectBrief,
  getAutomaticProviderAttempts,
  normalizeRenderFailureFeedback,
  runAutomaticSpecialistWorkflow,
  type AutomaticWorkflowCheckpoint,
} from "./specialistOrchestrator";
import { SERVER_MANAGED_API_KEY } from "../constants/provider";
import {
  ArrangementPlanSchema,
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
assert.deepEqual(
  getAutomaticProviderAttempts("arrangement", {
    ...DEFAULT_CONFIG,
    geminiApiKey: SERVER_MANAGED_API_KEY,
    openrouterApiKey: SERVER_MANAGED_API_KEY,
    automaticOpenRouterFallbackModel: "test/openrouter-fallback",
  }),
  [
    { provider: "gemini", model: "gemini-3.1-pro-preview" },
    { provider: "openrouter", model: "test/openrouter-fallback" },
  ],
);
assert.deepEqual(
  getAutomaticProviderAttempts("arrangement", DEFAULT_CONFIG),
  [{ provider: "gemini", model: "gemini-3.1-pro-preview" }],
);

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
const reroutedFallback = buildDeterministicArrangementFallback(
  threeTrackDesign,
  { ...threeTrackBrief, recommendedOrderIds: ["b", "a", "c"] },
  {
    trackIds: new Set(["a", "b", "c"]),
    sectionsById: new Map([
      ["a-1", { trackId: "a", startSec: 0, endSec: 90 }],
      ["b-in", { trackId: "b", startSec: 50, endSec: 70 }],
      ["b-out", { trackId: "b", startSec: 50, endSec: 70 }],
      ["c-1", { trackId: "c", startSec: 10, endSec: 60 }],
    ]),
    durationsByTrackId: new Map([["a", 120], ["b", 140], ["c", 100]]),
    targetDurationSec: 100,
    transitionCandidatesById: new Map(threeTrackCandidates),
  },
);
assert.deepEqual(
  reroutedFallback?.orderedTrackIds,
  ["a", "b", "c"],
  "fallback must find a connected order containing every selected track",
);

const longExitCandidates = Array.from({ length: 13 }, (_, index) => ({
  ...design.transitionMatrixSummary[0],
  fromTrackId: "a",
  fromSectionId: "a-long",
  toTrackId: "b",
  toSectionId: "b-long",
  fromExitSec: 157 - index,
  toEntrySec: 0,
  score: 1 - index / 100,
}));
const shortBalancedCandidate = {
  ...longExitCandidates[0],
  fromExitSec: 120,
  score: 0.1,
};
const balancedExitCandidate = {
  ...design.transitionMatrixSummary[0],
  fromTrackId: "b",
  fromSectionId: "b-long",
  toTrackId: "c",
  toSectionId: "c-long",
  fromExitSec: 100,
  toEntrySec: 0,
  score: 0.9,
};
const balanceFallbackDesign: MedleyDesignPayload = {
  ...design,
  tracks: [
    { ...design.tracks[0], trackId: "a", durationSec: 200 },
    { ...design.tracks[1], trackId: "b", durationSec: 140 },
    { ...design.tracks[1], trackId: "c", durationSec: 60 },
  ],
  sections: [
    { ...design.sections[0], sectionId: "a-long", trackId: "a", startSec: 0, endSec: 200 },
    { ...design.sections[1], sectionId: "b-long", trackId: "b", startSec: 0, endSec: 140 },
    { ...design.sections[1], sectionId: "c-long", trackId: "c", startSec: 0, endSec: 60 },
  ],
  transitionMatrixSummary: [
    ...longExitCandidates,
    shortBalancedCandidate,
    balancedExitCandidate,
  ],
};
const balanceFallback = buildDeterministicArrangementFallback(
  balanceFallbackDesign,
  {
    ...projectBrief,
    targetDurationSec: 240,
    recommendedOrderIds: ["a", "b", "c"],
  },
  {
    trackIds: new Set(["a", "b", "c"]),
    sectionsById: new Map([
      ["a-long", { trackId: "a", startSec: 0, endSec: 200 }],
      ["b-long", { trackId: "b", startSec: 0, endSec: 140 }],
      ["c-long", { trackId: "c", startSec: 0, endSec: 60 }],
    ]),
    durationsByTrackId: new Map([["a", 200], ["b", 140], ["c", 60]]),
    targetDurationSec: 240,
    transitionCandidatesById: new Map(
      balanceFallbackDesign.transitionMatrixSummary.map((candidate) => [
        createTransitionCandidateAuthority(candidate),
        candidate,
      ] as const),
    ),
  },
);
assert.equal(
  balanceFallback?.transitions[0].fromExitSec,
  120,
  "fallback must consider the shorter valid candidate even when it ranks below the top 12",
);

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
  if (target === "/api/provider/gemini") {
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
    config: { ...DEFAULT_CONFIG, geminiApiKey: SERVER_MANAGED_API_KEY },
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
  if (target === "/api/provider/gemini") {
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
      geminiApiKey: SERVER_MANAGED_API_KEY,
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

let directGeminiAttempts = 0;
let openRouterFallbackAttempts = 0;
let openRouterFallbackPlanBody = "";
globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  const target = String(url);
  if (target === "/api/session/project-brief")
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  if (target === "/api/provider/gemini") {
    directGeminiAttempts++;
    return new Response(JSON.stringify({ error: "Gemini rejected this request" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (target === "/api/provider/openrouter") {
    openRouterFallbackAttempts++;
    return new Response(
      JSON.stringify({
        choices: [{
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{
              id: "openrouter-arrangement",
              type: "function",
              function: {
                name: "set_design_plan",
                arguments: JSON.stringify(localFallback),
              },
            }],
          },
        }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  if (target === "/api/session/design-plan") {
    openRouterFallbackPlanBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }
  throw new Error(`Unexpected OpenRouter fallback fetch: ${target}`);
}) as typeof fetch;

await assert.rejects(
  runAutomaticSpecialistWorkflow({
    sessionId,
    config: {
      ...DEFAULT_CONFIG,
      geminiApiKey: SERVER_MANAGED_API_KEY,
      openrouterApiKey: SERVER_MANAGED_API_KEY,
      automaticOpenRouterFallbackModel: "test/openrouter-fallback",
    },
    library: [],
    design,
    signal: new AbortController().signal,
    requestSequence: 131,
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
assert.equal(directGeminiAttempts, 1, "Gemini must be attempted once before fallback");
assert.equal(
  openRouterFallbackAttempts,
  1,
  "a Gemini rejection must move immediately to the configured OpenRouter fallback",
);
assert.equal(
  (JSON.parse(openRouterFallbackPlanBody).plan as ArrangementPlan).strategy,
  "Local target-matched fallback",
);

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
      geminiApiKey: SERVER_MANAGED_API_KEY,
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
  if (target === "/api/provider/gemini") {
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
      geminiApiKey: SERVER_MANAGED_API_KEY,
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
  if (target === "/api/provider/gemini") {
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
      geminiApiKey: SERVER_MANAGED_API_KEY,
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

// This is the complete Automatic-mode contract test. It models the provider
// failure the app has seen in practice (Gemini returns no required tool call),
// exercises the configured OpenRouter fallback, and then carries the exact
// browser workflow through transition execution, candidate registration,
// Gemini audio approval, manifest selection, and final promotion. Any request
// not listed below fails the test, so it cannot accidentally contact a real
// provider while this test runs.
const fullWorkflowSessionId = "automatic-full-workflow";
const fullWorkflowDesign: MedleyDesignPayload = {
  ...design,
  userConstraints: { targetDurationMinutes: 1.75 },
};
const fullWorkflowPlan = ArrangementPlanSchema.parse({
  ...arrangementPlan,
  projectId: fullWorkflowSessionId,
  strategy: "Mocked fallback plan",
});
const fullWorkflowCandidate = {
  candidateId: "candidate-full-workflow",
  candidateVersion: 1,
  parentCandidateId: null,
  arrangementVersion: fullWorkflowPlan.arrangementVersion,
  executionVersion: 1,
  resolvedTransitions: fullWorkflowPlan.transitions.map((transition) => ({
    ...transition,
    actualFromExitSec: transition.fromExitSec,
    actualToEntrySec: transition.toEntrySec,
    durationUsed: transition.duration,
    outputPath: "workdir/automatic-full-workflow/transition-t1.mp3",
    executionVersion: 1,
  })),
  outputPath: "workdir/automatic-full-workflow/candidate-1.mp3",
  debugPaths: [],
  previewPaths: ["workdir/automatic-full-workflow/transition-t1.mp3"],
  sizeBytes: 12_345,
  sha256: "a".repeat(64),
  durationSec: 105,
  technicallyValid: true,
  metrics: {
    emotionalArc: 88,
    transitionSmoothness: 91,
    performerIdentity: 87,
    overallScore: 89,
  },
  reviewStatus: "pending" as const,
  warnings: [],
  createdAt: new Date(0).toISOString(),
};
const fullWorkflowReview = {
  schemaVersion: 1,
  reviewSource: "gemini_audio" as const,
  reviewModel: "gemini-3.1-pro-preview",
  candidateId: fullWorkflowCandidate.candidateId,
  candidateVersion: fullWorkflowCandidate.candidateVersion,
  arrangementVersion: fullWorkflowCandidate.arrangementVersion,
  approved: true,
  emotionalArc: 88,
  transitionSmoothness: 91,
  performerIdentity: 87,
  overallScore: 89,
  blockingIssues: [],
  corrections: [],
  warnings: [],
  reviewedAt: new Date(0).toISOString(),
};
const fullWorkflowStages: string[] = [];
const fullWorkflowCheckpoints: AutomaticWorkflowCheckpoint[] = [];
const fullWorkflowRequests: string[] = [];
let fullWorkflowGeminiRequests = 0;
let fullWorkflowOpenRouterRequests = 0;
let fullWorkflowTransitionRequests = 0;
let fullWorkflowRenderRequests = 0;
let fullWorkflowAudioReviewRequests = 0;

globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  const target = String(url);
  fullWorkflowRequests.push(target);
  if (target === "/api/session/project-brief") {
    const body = JSON.parse(String(init?.body ?? ""));
    assert.equal(body.sessionId, fullWorkflowSessionId);
    assert.deepEqual(
      body.brief.trackSummaries.map((track: ProjectBrief["trackSummaries"][number]) => track.trackId),
      ["a", "b"],
      "the automatic plan must contain only the selected tracks",
    );
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }
  if (target === "/api/provider/gemini") {
    fullWorkflowGeminiRequests++;
    // This is a valid Gemini proxy envelope with the actual failure mode:
    // a response was returned, but it did not contain the required tool call.
    return new Response(JSON.stringify({ functionCalls: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (target === "/api/provider/openrouter") {
    fullWorkflowOpenRouterRequests++;
    return openRouterToolCall(
      "openrouter-arrangement",
      "set_design_plan",
      fullWorkflowPlan,
    );
  }
  if (target === "/api/session/design-plan") {
    const body = JSON.parse(String(init?.body ?? ""));
    const parsedPlan = ArrangementPlanSchema.parse(body.plan);
    assert.equal(body.sessionId, fullWorkflowSessionId);
    assert.deepEqual(parsedPlan.orderedTrackIds, ["a", "b"]);
    assert.equal(
      parsedPlan.transitions[0].transitionCandidateId,
      createTransitionCandidateAuthority(design.transitionMatrixSummary[0]),
      "the fallback plan must be tied to a locally measured transition candidate",
    );
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }
  if (target === "/api/apply-transition") {
    fullWorkflowTransitionRequests++;
    const body = JSON.parse(String(init?.body ?? ""));
    assert.equal(body.sessionId, fullWorkflowSessionId);
    assert.equal(body.transitionId, "t1");
    assert.equal(init?.headers && new Headers(init.headers).get("Idempotency-Key"),
      `${fullWorkflowSessionId}:transition:1:t1`);
    return new Response(JSON.stringify({
      success: true,
      outputPath: fullWorkflowCandidate.previewPaths[0],
      actualFromExitSec: 80,
      actualToEntrySec: 10,
      durationUsed: 5,
    }), { status: 200 });
  }
  if (target === "/api/session/execution-report") {
    const body = JSON.parse(String(init?.body ?? ""));
    assert.equal(body.report.attemptedTransitions.length, 1);
    assert.equal(body.report.attemptedTransitions[0].success, true);
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }
  if (target === "/api/render-review-candidate") {
    fullWorkflowRenderRequests++;
    const body = JSON.parse(String(init?.body ?? ""));
    assert.equal(body.sessionId, fullWorkflowSessionId);
    assert.equal(body.executionVersion, 1);
    if (fullWorkflowRenderRequests === 1) {
      return new Response(JSON.stringify({
        success: false,
        registrationPending: true,
        error: "Candidate MP3 was rendered but manifest registration is temporarily unavailable",
      }), { status: 503 });
    }
    return new Response(JSON.stringify({
      success: true,
      candidate: fullWorkflowCandidate,
      quality: { note: "Mock technical quality pass" },
      resolvedTransitions: fullWorkflowCandidate.resolvedTransitions,
    }), { status: 200 });
  }
  if (target === "/api/session/audio-review") {
    fullWorkflowAudioReviewRequests++;
    const body = JSON.parse(String(init?.body ?? ""));
    assert.equal(body.sessionId, fullWorkflowSessionId);
    assert.equal(body.candidateId, fullWorkflowCandidate.candidateId);
    assert.equal(body.mode, "whole_mix");
    return new Response(JSON.stringify({
      success: true,
      model: "gemini-3.1-pro-preview",
      review: fullWorkflowReview,
    }), { status: 200 });
  }
  if (target === "/api/session/quality-review") {
    const body = JSON.parse(String(init?.body ?? ""));
    assert.deepEqual(body.review, fullWorkflowReview);
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }
  if (target === `/api/session/${fullWorkflowSessionId}/candidates`) {
    return new Response(JSON.stringify({
      success: true,
      manifest: {
        candidates: [{ ...fullWorkflowCandidate, reviewStatus: "approved" }],
        selectedCandidateId: fullWorkflowCandidate.candidateId,
      },
    }), { status: 200 });
  }
  if (target === "/api/finalize-medley") {
    const body = JSON.parse(String(init?.body ?? ""));
    assert.equal(body.sessionId, fullWorkflowSessionId);
    assert.equal(body.candidateId, fullWorkflowCandidate.candidateId);
    return new Response(JSON.stringify({
      success: true,
      outputPath: "library/finals/automatic-full-workflow.mp3",
    }), { status: 200 });
  }
  throw new Error(`Unexpected full workflow fetch: ${target}`);
}) as typeof fetch;

const fullWorkflowResult = await runAutomaticSpecialistWorkflow({
  sessionId: fullWorkflowSessionId,
  config: {
    ...DEFAULT_CONFIG,
    geminiApiKey: SERVER_MANAGED_API_KEY,
    openrouterApiKey: SERVER_MANAGED_API_KEY,
    automaticOpenRouterFallbackModel: "test/openrouter-fallback",
  },
  library: [
    { id: "a", originalName: "a.mp3", filename: "a.mp3", path: "library/audio/a.mp3", size: 1, mimeType: "audio/mpeg" },
    { id: "b", originalName: "b.mp3", filename: "b.mp3", path: "library/audio/b.mp3", size: 1, mimeType: "audio/mpeg" },
  ],
  design: fullWorkflowDesign,
  signal: new AbortController().signal,
  requestSequence: 99,
  onLog: () => {},
  onStage: (stage) => fullWorkflowStages.push(stage),
  onCheckpoint: async (checkpoint) => {
    fullWorkflowCheckpoints.push(structuredClone(checkpoint));
  },
  onMetrics: () => {},
});

assert.equal(fullWorkflowResult.manualReviewRequired, false);
assert.equal(fullWorkflowResult.candidateId, fullWorkflowCandidate.candidateId);
assert.equal(fullWorkflowResult.outputPath, "library/finals/automatic-full-workflow.mp3");
assert.equal(fullWorkflowGeminiRequests, 1, "a missing Gemini tool call must move directly to the configured fallback");
assert.equal(fullWorkflowOpenRouterRequests, 1, "the configured OpenRouter fallback must provide the arrangement");
assert.equal(fullWorkflowTransitionRequests, 1);
assert.equal(fullWorkflowRenderRequests, 2, "a pending manifest registration must be retried once without rerendering");
assert.equal(fullWorkflowAudioReviewRequests, 1, "an approved whole-mix review must not make a clip follow-up request");
assert.equal(fullWorkflowRequests.includes("/api/provider/openrouter"), true);
assert.equal(fullWorkflowStages.at(-1), "completed");
assert.equal(fullWorkflowCheckpoints.at(-1)?.stage, "final_render");

globalThis.fetch = originalFetch;
(globalThis as any).window = originalWindow;
fs.rmSync(artifactDir, { recursive: true, force: true });
console.log("specialistOrchestrator checkpoint tests passed");
