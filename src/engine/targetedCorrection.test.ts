import assert from "node:assert/strict";
import { buildTargetedCorrectionPlan } from "./specialistOrchestrator";
import type { ArrangementPlan, QualityReview } from "../types/specialistWorkflow";

const plan: ArrangementPlan = {
  schemaVersion: 1, arrangementVersion: 1, projectId: "correction-test",
  strategy: "test", orderedTrackIds: ["track-a", "track-b", "track-c"], confidence: 0.9, warnings: [],
  transitions: [
    { transitionId: "transition-a", fromTrackId: "track-a", fromSectionId: "section-a", toTrackId: "track-b", toSectionId: "section-b", fromExitSec: 20, toEntrySec: 2, duration: 2, style: "smooth_blend", beatAlign: true, executionPermissions: { styleMutable: true, allowedStyles: ["smooth_blend", "beat_aligned"], durationMutable: true, minDuration: 1, maxDuration: 4 }, notes: "first" },
    { transitionId: "transition-b", fromTrackId: "track-b", fromSectionId: "section-b", toTrackId: "track-c", toSectionId: "section-c", fromExitSec: 20, toEntrySec: 2, duration: 2, style: "smooth_blend", beatAlign: true, notes: "unaffected" },
  ],
};
const review: QualityReview = {
  schemaVersion: 1, candidateId: "candidate-001", candidateVersion: 1, arrangementVersion: 1,
  approved: false, emotionalArc: 60, transitionSmoothness: 50, performerIdentity: 60, overallScore: 55,
  blockingIssues: ["transition needs a beat-aligned 3s blend"],
  corrections: [{ transitionId: "transition-a", issue: "timing", requestedChange: "Use a beat-aligned 3s transition." }],
  warnings: [], reviewedAt: "2026-07-13T00:00:00.000Z",
};
const corrected = buildTargetedCorrectionPlan(plan, review);
assert.equal(corrected, null, "free-form correction text must never mutate a plan");
assert.equal(buildTargetedCorrectionPlan(plan, { ...review, corrections: [{ ...review.corrections[0], requestedChange: "Make it nicer." }] }), null);
const boundedPreset = buildTargetedCorrectionPlan(plan, {
  ...review,
  corrections: [{
    transitionId: "transition-a",
    issue: "The vocal handoff needs more room.",
    requestedChange: "Apply bounded preset longer_crossfade.",
    correctionPreset: "longer_crossfade",
  }],
});
assert.equal(boundedPreset?.transitions[0].duration, 2.5);
assert.deepEqual(boundedPreset?.transitions[1], plan.transitions[1]);
assert.equal(
  buildTargetedCorrectionPlan(plan, {
    ...review,
    corrections: [
      {
        transitionId: "transition-a",
        issue: "first",
        requestedChange: "Apply bounded preset longer_crossfade.",
        correctionPreset: "longer_crossfade",
      },
      {
        transitionId: "transition-b",
        issue: "second",
        requestedChange: "Apply bounded preset shorter_crossfade.",
        correctionPreset: "shorter_crossfade",
      },
    ],
  }),
  null,
  "One correction cycle must never mutate multiple transitions",
);
console.log("targetedCorrection tests passed");
