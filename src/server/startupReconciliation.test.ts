import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createEmptyManifest, writeCandidateManifestAtomic } from "./candidateStore";
import { reconcileStartupState } from "./startupReconciliation";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-medley-reconcile-"));
try {
  const outputSession = "available-session";
  const outputDir = path.join(root, outputSession);
  fs.mkdirSync(outputDir, { recursive: true });
  const output = path.join(outputDir, "medley_final.mp3");
  fs.writeFileSync(output, "final");
  const candidateSession = "candidate-session";
  writeCandidateManifestAtomic(root, candidateSession, {
    ...createEmptyManifest(candidateSession),
    candidates: [{
      candidateId: "candidate-001", candidateVersion: 1, parentCandidateId: null,
      arrangementVersion: 1, executionVersion: 1, outputPath: path.join(root, candidateSession, "candidate-001.mp3"),
      debugPaths: [], previewPaths: [], sizeBytes: 1, sha256: "a".repeat(64), durationSec: 1,
      technicallyValid: true, metrics: {}, reviewStatus: "pending", warnings: [], createdAt: "2026-07-13T00:00:00.000Z",
    }],
  });
  const before = fs.readdirSync(root, { recursive: true }).sort();
  const records = reconcileStartupState({
    workDir: root,
    history: [
      { id: outputSession, finalAudioPath: output },
      { id: candidateSession, finalAudioPath: path.join(root, candidateSession, "missing.mp3") },
      { id: "legacy-session" },
    ],
  });
  assert.deepEqual(records.map((record) => record.status), ["available", "candidate_recoverable", "legacy_unverified"]);
  assert.deepEqual(fs.readdirSync(root, { recursive: true }).sort(), before, "reconciliation must not mutate artifacts");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log("startupReconciliation tests passed");
