import assert from "node:assert/strict";
import {
  canonicalJson,
  createDesignHash,
  createDesignSnapshotV4,
  createTransitionCandidateIdV4,
} from "./automaticDesignV4";

assert.equal(canonicalJson({ b: [2, { z: 1, a: 2 }], a: 1 }), canonicalJson({ a: 1, b: [2, { a: 2, z: 1 }] }));
assert.equal(
  createTransitionCandidateIdV4({ fromTrackId: "a", fromSectionId: "a1", toTrackId: "b", toSectionId: "b1", fromExitSec: 12.34501, toEntrySec: 4.00049 }),
  createTransitionCandidateIdV4({ fromTrackId: "a", fromSectionId: "a1", toTrackId: "b", toSectionId: "b1", fromExitSec: 12.34549, toEntrySec: 4.0004 }),
  "sub-millisecond float noise must not change transition identity",
);
const input = {
  schemaVersion: 1 as const,
  workflowVersion: 4 as const,
  deterministicAlgorithmVersion: "automatic-v4-design-1",
  sessionId: "session-a",
  selectedTrackIds: ["a", "b"],
  selectionHash: "a".repeat(64),
  sourceAudioSha256: { b: "b".repeat(64), a: "a".repeat(64) },
  analysisSchemaVersions: { a: "analysis-1", b: "analysis-1" },
  analyzerVersions: { a: "analyzer-1", b: "analyzer-1" },
  targetDurationSec: 240,
  maximumTransitions: 1,
  workflowConstraints: { selectedOnly: true },
  transitionScoringPolicyVersion: "local-transition-score-1",
  wisdomSnapshotHash: "c".repeat(64),
  canonicalBrief: { order: ["a", "b"] },
  canonicalTransitionCandidates: [{ id: "candidate" }],
};
assert.equal(createDesignHash(input), createDesignHash({ ...input, sourceAudioSha256: { a: "a".repeat(64), b: "b".repeat(64) } }));
assert.notEqual(createDesignHash(input), createDesignHash({ ...input, targetDurationSec: 241 }));
const snapshot = createDesignSnapshotV4({ ...input, createdAt: "2026-07-13T00:00:00.000Z" });
assert.equal(snapshot.designHash, createDesignHash(input));
console.log("automaticDesignV4 tests passed");
