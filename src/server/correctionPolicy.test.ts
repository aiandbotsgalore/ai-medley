import assert from "node:assert/strict";
import { bindAutomaticCorrectionPolicy, getAllowedCorrectionPresets } from "./correctionPolicy";

const plan = bindAutomaticCorrectionPolicy({
  schemaVersion: 1,
  arrangementVersion: 1,
  projectId: "correction-policy",
  strategy: "fixture",
  orderedTrackIds: ["track-a", "track-b"],
  transitions: [{
    transitionId: "transition-1",
    fromTrackId: "track-a",
    fromSectionId: "section-a",
    toTrackId: "track-b",
    toSectionId: "section-b",
    fromExitSec: 20,
    toEntrySec: 2,
    duration: 2,
    style: "smooth_blend",
    beatAlign: true,
    executionPermissions: { styleMutable: false, durationMutable: false },
    notes: "",
  }],
  confidence: 1,
  warnings: [],
});

const transition = plan.transitions[0];
assert.equal(transition.executionPermissions?.styleMutable, true);
assert.equal(transition.executionPermissions?.minDuration, 1);
assert.equal(transition.executionPermissions?.maxDuration, 3);
assert.deepEqual(getAllowedCorrectionPresets(transition), [
  "shorter_crossfade",
  "longer_crossfade",
  "beat_aligned",
  "harmonic_blend",
  "energy_ramp",
  "dramatic_cut",
  "reset_moment",
]);
assert.equal(getAllowedCorrectionPresets(transition).includes("mashup_layer"), false);

console.log("correctionPolicy tests passed");
