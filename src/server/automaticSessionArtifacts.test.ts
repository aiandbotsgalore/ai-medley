import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDesignSnapshotV4 } from "./automaticDesignV4";
import {
  readArrangementVersionV1,
  writeArrangementVersionV1,
  writeDesignSnapshotV4,
} from "./automaticSessionArtifacts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-medley-session-artifacts-"));
const sessionId = "artifact-test";
const snapshot = createDesignSnapshotV4({
  schemaVersion: 1,
  workflowVersion: 4,
  deterministicAlgorithmVersion: "test",
  sessionId,
  selectedTrackIds: ["track-a", "track-b"],
  selectionHash: "a".repeat(64),
  sourceAudioSha256: { "track-a": "b".repeat(64), "track-b": "c".repeat(64) },
  analysisSchemaVersions: { "track-a": "v1", "track-b": "v1" },
  analyzerVersions: { "track-a": "v1", "track-b": "v1" },
  targetDurationSec: 60,
  maximumTransitions: 1,
  workflowConstraints: { selectedOnly: true },
  transitionScoringPolicyVersion: "test",
  wisdomSnapshotHash: "d".repeat(64),
  canonicalBrief: { selectedTrackIds: ["track-a", "track-b"] },
  canonicalTransitionCandidates: [],
  createdAt: "2026-07-13T00:00:00.000Z",
});

try {
  assert.equal(writeDesignSnapshotV4(root, snapshot).designHash, snapshot.designHash);
  assert.equal(writeDesignSnapshotV4(root, snapshot).designHash, snapshot.designHash);
  assert.throws(
    () => writeDesignSnapshotV4(root, { ...snapshot, targetDurationSec: 61 }),
    /different design snapshot/,
  );

  const arrangement = {
    schemaVersion: 1 as const,
    workflowVersion: 4 as const,
    sessionId,
    arrangementVersion: 1,
    designHash: snapshot.designHash,
    arrangement: {
      schemaVersion: 1 as const,
      arrangementVersion: 1,
      projectId: sessionId,
      strategy: "test arrangement",
      orderedTrackIds: ["track-a", "track-b"],
      transitions: [{
        transitionId: "transition-1",
        fromTrackId: "track-a",
        fromSectionId: "section-a",
        toTrackId: "track-b",
        toSectionId: "section-b",
        fromExitSec: 10,
        toEntrySec: 0,
        duration: 2,
        style: "smooth_blend" as const,
        beatAlign: true,
        notes: "test",
      }],
      confidence: 1,
      warnings: [],
    },
    submittedAt: "2026-07-13T00:00:00.000Z",
  };
  assert.equal(writeArrangementVersionV1(root, arrangement).arrangementVersion, 1);
  assert.equal(readArrangementVersionV1(root, sessionId, 1)?.designHash, snapshot.designHash);
  assert.throws(
    () => writeArrangementVersionV1(root, { ...arrangement, submittedAt: "2026-07-13T00:00:01.000Z" }),
    /immutable/,
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("automaticSessionArtifacts tests passed");
