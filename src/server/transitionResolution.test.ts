import assert from "node:assert/strict";
import {
  ArrangementPlanSchema,
  type SpecialistContext,
} from "../types/specialistWorkflow";
import { resolveAutomaticRenderTransitions } from "./transitionResolution";

const plan = ArrangementPlanSchema.parse({
  schemaVersion: 1,
  arrangementVersion: 1,
  projectId: "session-1",
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
  confidence: 0.8,
  warnings: [],
});

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

const resolved = resolveAutomaticRenderTransitions({
  plan,
  executionVersion: 2,
  executionRecords: {
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
      previewPath: "workdir/session-1/transition.mp3",
      error: null,
    },
  },
  context,
});
assert.deepEqual(resolved.errors, []);
assert.equal(resolved.transitions[0].style, "beat_aligned");
assert.equal(resolved.transitions[0].durationUsed, 4);
assert.equal(
  resolved.transitions[0].outputPath,
  "workdir/session-1/transition.mp3",
);

const forged = resolveAutomaticRenderTransitions({
  plan,
  executionVersion: 2,
  executionRecords: {
    t1: {
      request: {
        transitionId: "t1",
        fromTrackId: "a",
        fromSectionId: "a-1",
        toTrackId: "b",
        toSectionId: "b-1",
        style: "dramatic_cut",
        duration: 4,
        beatAlign: true,
      },
      success: true,
      actualFromExitSec: 79,
      actualToEntrySec: 12,
      previewPath: "workdir/session-1/transition.mp3",
      error: null,
    },
  },
  context,
});
assert.match(forged.errors.join("; "), /style: Not allowed/);

const outOfSection = resolveAutomaticRenderTransitions({
  plan,
  executionVersion: 2,
  executionRecords: {
    t1: {
      request: {
        transitionId: "t1",
        fromTrackId: "a",
        fromSectionId: "a-1",
        toTrackId: "b",
        toSectionId: "b-1",
        style: "smooth_blend",
        duration: 5,
        beatAlign: true,
      },
      success: true,
      actualFromExitSec: 95,
      actualToEntrySec: 12,
      previewPath: "workdir/session-1/transition.mp3",
      error: null,
    },
  },
  context,
});
assert.match(outOfSection.errors.join("; "), /outside the selected section/);

console.log("transitionResolution tests passed");
