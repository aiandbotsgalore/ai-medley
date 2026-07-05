import assert from "node:assert/strict";
import {
  ArrangementPlanSchema,
  ProjectBriefSchema,
  TransitionExecutionRequestSchema,
  chooseBestCandidate,
  formatValidationIssues,
  measureProviderRequest,
  validateArrangementContext,
  validateProjectBriefContext,
  validateTransitionExecutionContext,
  type RenderCandidate,
  createTrackFactAuthority,
  createTransitionCandidateAuthority,
  bindLegacyArrangementAuthority,
  bindLegacyProjectBriefAuthority,
} from "./specialistWorkflow";

const brief = ProjectBriefSchema.parse({
  schemaVersion: 1,
  projectId: "session-1",
  targetDurationSec: 300,
  trackSummaries: [
    {
      trackId: "a",
      factId: createTrackFactAuthority({ trackId: "a", filename: "a.mp3", durationSec: 120, tempoEstimate: 120, keyEstimate: null, confidence: 0.8 }),
      filename: "a.mp3",
      durationSec: 120,
      tempoEstimate: 120,
      keyEstimate: null,
      confidence: 0.8,
      recommendedSectionIds: ["a-1"],
      warnings: [],
    },
    {
      trackId: "b",
      factId: createTrackFactAuthority({ trackId: "b", filename: "b.mp3", durationSec: 140, tempoEstimate: 124, keyEstimate: null, confidence: 0.8 }),
      filename: "b.mp3",
      durationSec: 140,
      tempoEstimate: 124,
      keyEstimate: null,
      confidence: 0.8,
      recommendedSectionIds: ["b-1"],
      warnings: [],
    },
  ],
  recommendedOrderIds: ["a", "b"],
  constraints: [],
  warnings: [],
  summary: "Two-track brief",
});
const authoritativeFacts = new Map([
  ["a", { trackId: "a", filename: "a.mp3", durationSec: 120, tempoEstimate: 120, keyEstimate: null, confidence: 0.8 }],
  ["b", { trackId: "b", filename: "b.mp3", durationSec: 140, tempoEstimate: 124, keyEstimate: null, confidence: 0.8 }],
]);
assert.equal(brief.projectId, "session-1");
assert.deepEqual(
  validateProjectBriefContext(brief, {
    trackIds: new Set(["a", "b"]),
    sectionsById: new Map([
      ["a-1", { trackId: "a", startSec: 0, endSec: 90 }],
      ["b-1", { trackId: "b", startSec: 10, endSec: 60 }],
    ]),
    durationsByTrackId: new Map([
      ["a", 120],
      ["b", 140],
    ]),
    targetDurationSec: 300,
    factsByTrackId: authoritativeFacts,
  }),
  [],
);

const unknownField = ProjectBriefSchema.safeParse({ ...brief, extra: true });
assert.equal(unknownField.success, false);
if (!unknownField.success) {
  assert.match(
    formatValidationIssues(unknownField.error)[0],
    /Unrecognized key/,
  );
}

const plan = ArrangementPlanSchema.parse({
  schemaVersion: 1,
  arrangementVersion: 1,
  projectId: "session-1",
  strategy: "Smooth",
  orderedTrackIds: ["a", "b"],
  transitions: [
    {
      transitionId: "t1",
      transitionCandidateId: createTransitionCandidateAuthority({
        fromTrackId: "a", fromSectionId: "a-1", toTrackId: "b", toSectionId: "b-1",
        fromExitSec: 80, toEntrySec: 10,
      }),
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
  confidence: 0.8,
  warnings: [],
});
assert.deepEqual(
  validateArrangementContext(plan, {
    trackIds: new Set(["a", "b"]),
    sectionsById: new Map([
      ["a-1", { trackId: "a", startSec: 0, endSec: 90 }],
      ["b-1", { trackId: "b", startSec: 10, endSec: 60 }],
    ]),
    durationsByTrackId: new Map([
      ["a", 120],
      ["b", 140],
    ]),
    transitionCandidatesById: new Map([
      [plan.transitions[0].transitionCandidateId!, {
        fromTrackId: "a", fromSectionId: "a-1", toTrackId: "b", toSectionId: "b-1",
        fromExitSec: 80, toEntrySec: 10,
      }],
    ]),
  }),
  [],
);
assert.match(
  validateProjectBriefContext(
    { ...brief, trackSummaries: [{ ...brief.trackSummaries[0], durationSec: 121 }, brief.trackSummaries[1]] },
    {
      trackIds: new Set(["a", "b"]),
      sectionsById: new Map([
        ["a-1", { trackId: "a", startSec: 0, endSec: 90 }],
        ["b-1", { trackId: "b", startSec: 10, endSec: 60 }],
      ]),
      durationsByTrackId: new Map([["a", 120], ["b", 140]]),
      targetDurationSec: 300,
      factsByTrackId: authoritativeFacts,
    },
  ).join("; "),
  /durationSec.*authoritative/i,
);
const legacyBrief = {
  ...brief,
  trackSummaries: brief.trackSummaries.map(({ factId: _factId, ...track }) => track),
};
assert.equal(
  bindLegacyProjectBriefAuthority(legacyBrief, {
    trackIds: new Set(["a", "b"]),
    sectionsById: new Map(),
    durationsByTrackId: new Map(),
    factsByTrackId: authoritativeFacts,
  }).trackSummaries.every((track) => Boolean(track.factId)),
  true,
);
const legacyPlan = {
  ...plan,
  transitions: plan.transitions.map(
    ({ transitionCandidateId: _candidateId, ...transition }) => transition,
  ),
};
assert.equal(
  bindLegacyArrangementAuthority(legacyPlan, {
    trackIds: new Set(["a", "b"]),
    sectionsById: new Map(),
    durationsByTrackId: new Map(),
    transitionCandidatesById: new Map([
      [plan.transitions[0].transitionCandidateId!, {
        fromTrackId: "a", fromSectionId: "a-1", toTrackId: "b", toSectionId: "b-1",
        fromExitSec: 80, toEntrySec: 10,
      }],
    ]),
  }).transitions[0].transitionCandidateId,
  plan.transitions[0].transitionCandidateId,
);
assert.match(
  validateArrangementContext(
    { ...plan, transitions: [{ ...plan.transitions[0], transitionCandidateId: "invented" }] },
    {
      trackIds: new Set(["a", "b"]),
      sectionsById: new Map([
        ["a-1", { trackId: "a", startSec: 0, endSec: 90 }],
        ["b-1", { trackId: "b", startSec: 10, endSec: 60 }],
      ]),
      durationsByTrackId: new Map([["a", 120], ["b", 140]]),
      transitionCandidatesById: new Map(),
    },
  ).join("; "),
  /candidate.*authoritative/i,
);
const executionRequest = TransitionExecutionRequestSchema.parse({
  transitionId: "t1",
  fromTrackId: "a",
  fromSectionId: "a-1",
  toTrackId: "b",
  toSectionId: "b-1",
  style: "smooth_blend",
  duration: 5,
  beatAlign: true,
});
assert.deepEqual(
  validateTransitionExecutionContext(executionRequest, plan),
  [],
);
assert.match(
  validateTransitionExecutionContext(
    { ...executionRequest, toTrackId: "a" },
    plan,
  )[0],
  /Does not match locked transition/,
);
assert.match(
  validateTransitionExecutionContext(
    { ...executionRequest, style: "beat_aligned" },
    plan,
  )[0],
  /style: Does not match locked transition/,
);
assert.match(
  validateTransitionExecutionContext(
    { ...executionRequest, duration: 3 },
    plan,
  )[0],
  /duration: Does not match locked transition/,
);
assert.match(
  validateTransitionExecutionContext(
    { ...executionRequest, beatAlign: false },
    plan,
  )[0],
  /beatAlign: Does not match locked transition/,
);

const mutablePlan = ArrangementPlanSchema.parse({
  ...plan,
  transitions: [
    {
      ...plan.transitions[0],
      executionPermissions: {
        styleMutable: true,
        allowedStyles: ["smooth_blend", "beat_aligned"],
        durationMutable: true,
        minDuration: 3,
        maxDuration: 6,
        beatAlignMutable: true,
      },
    },
  ],
});
assert.deepEqual(
  validateTransitionExecutionContext(
    {
      ...executionRequest,
      style: "beat_aligned",
      duration: 3,
      beatAlign: false,
    },
    mutablePlan,
  ),
  [],
);
assert.match(
  validateTransitionExecutionContext(
    { ...executionRequest, style: "dramatic_cut" },
    mutablePlan,
  )[0],
  /style: Not allowed/,
);
assert.match(
  validateTransitionExecutionContext(
    { ...executionRequest, duration: 8 },
    mutablePlan,
  )[0],
  /duration: Outside allowed bounds/,
);

const tooLarge = measureProviderRequest({ text: "x".repeat(110 * 1024) });
assert.equal(tooLarge.withinLimits, false);

const candidate = (
  version: number,
  score: number | undefined,
  approved = false,
): RenderCandidate => ({
  candidateId: `candidate-${version}`,
  candidateVersion: version,
  parentCandidateId: null,
  arrangementVersion: 1,
  executionVersion: version,
  outputPath: `candidate-${version}.mp3`,
  debugPaths: [],
  previewPaths: [],
  sizeBytes: 10,
  sha256: "a".repeat(64),
  durationSec: 10,
  technicallyValid: true,
  metrics: score === undefined ? {} : { overallScore: score },
  reviewStatus: approved ? "approved" : "changes_requested",
  warnings: [],
  createdAt: new Date(version * 1000).toISOString(),
});
assert.equal(
  chooseBestCandidate([candidate(1, 90), candidate(2, 80, true)])
    ?.candidateVersion,
  2,
);
assert.equal(
  chooseBestCandidate([candidate(1, 90), candidate(2, 90)])?.candidateVersion,
  2,
);

console.log("specialistWorkflow tests passed");
