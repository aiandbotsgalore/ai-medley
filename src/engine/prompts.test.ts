import assert from "node:assert/strict";
import { buildSystemPrompt } from "./prompts";
import { MAX_PROVIDER_REQUEST_BYTES } from "../types/specialistWorkflow";

const repeatedScores = Object.fromEntries(
  Array.from({ length: 20 }, (_, index) => [`score${index}`, index / 20]),
);
const design: any = {
  schemaVersion: "medley_design_v1",
  source: "local_medley_intelligence",
  userConstraints: {},
  tracks: Array.from({ length: 4 }, (_, index) => ({
    trackId: `track-${index}`,
    filename: `track-${index}.mp3`,
    durationSec: 227.45,
    tempoEstimate: 120,
    tempoConfidence: 0.8,
    keyEstimate: null,
    keyConfidence: 0,
    averageEnergy: 0.5,
    peakEnergy: 0.9,
    confidence: 0.8,
    warnings: [],
  })),
  sections: Array.from({ length: 40 }, (_, index) => ({
    sectionId: `section-${index}`,
    trackId: `track-${index % 4}`,
    startSec: index,
    endSec: index + 12,
    labels: ["transition_safe_zone"],
    confidence: 0.8,
    factsUsed: [],
    warnings: [],
  })),
  localFacts: Array.from({ length: 500 }, () => ({ marker: "OMIT_LOCAL_FACT" })),
  heuristicGuesses: Array.from({ length: 500 }, () => ({ marker: "OMIT_GUESS" })),
  sectionScores: [],
  transitionMatrixSummary: Array.from({ length: 24 }, (_, index) => ({
    fromTrackId: `track-${index % 4}`,
    toTrackId: `track-${(index + 1) % 4}`,
    fromSectionId: `section-${index}`,
    toSectionId: `section-${index + 1}`,
    fromExitSec: 30 + index,
    toEntrySec: 10 + index,
    transitionType: "smooth_blend",
    score: 0.8,
    confidence: 0.8,
    scores: repeatedScores,
    reason: "compatible",
    warnings: [],
  })),
  recommendedStrategies: [],
  recommendedGlobalIntros: [],
  recommendedGlobalFinales: [],
  warnings: [],
  aiRules: {},
};

const prompt = buildSystemPrompt(
  design.tracks.map((track: any) => ({
    id: track.trackId,
    originalName: track.filename,
  })),
  { style: "smooth-transitions" } as any,
  design,
  "test-session",
);

assert.ok(Buffer.byteLength(prompt, "utf8") < MAX_PROVIDER_REQUEST_BYTES / 2);
assert.ok(prompt.includes('"sectionId":"section-0"'));
assert.ok(prompt.includes('"fromExitSec":30'));
assert.ok(!prompt.includes("OMIT_LOCAL_FACT"));
assert.ok(!prompt.includes("OMIT_GUESS"));

console.log("prompts tests passed");
