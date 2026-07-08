import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyCandidateReview,
  cleanupRejectedCandidates,
  createEmptyManifest,
  discardAutomaticSessionFiles,
  nextCandidateIdentity,
  promoteCandidate,
  readCandidateManifest,
  registerCandidate,
  sha256File,
  validateLegacyFinalOutput,
  writeCandidateManifestAtomic,
} from "./candidateStore";
import {
  MAX_COMPLETE_CANDIDATES,
  MAX_CORRECTION_RETRIES,
  type RenderCandidate,
} from "../types/specialistWorkflow";

assert.equal(MAX_CORRECTION_RETRIES, 3);
assert.equal(MAX_COMPLETE_CANDIDATES, 4);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-medley-candidates-"));
const sessionId = "session-test";
const sessionDir = path.join(root, sessionId);
fs.mkdirSync(sessionDir, { recursive: true });
writeCandidateManifestAtomic(root, sessionId, createEmptyManifest(sessionId));

function makeCandidate(
  version: number,
  contents: string,
  score: number,
): RenderCandidate {
  const outputPath = path.join(
    sessionDir,
    `candidate-${String(version).padStart(3, "0")}.mp3`,
  );
  fs.writeFileSync(outputPath, contents);
  return {
    candidateId: `candidate-${String(version).padStart(3, "0")}`,
    candidateVersion: version,
    parentCandidateId:
      version > 1 ? `candidate-${String(version - 1).padStart(3, "0")}` : null,
    arrangementVersion: 1,
    executionVersion: version,
    outputPath,
    debugPaths: [],
    previewPaths: [],
    sizeBytes: fs.statSync(outputPath).size,
    sha256: sha256File(outputPath),
    durationSec: 10,
    technicallyValid: true,
    metrics: { overallScore: score },
    reviewStatus: version === 2 ? "approved" : "changes_requested",
    warnings: [],
    createdAt: new Date(version * 1000).toISOString(),
  };
}

registerCandidate(root, sessionId, makeCandidate(1, "first candidate", 90));
registerCandidate(
  root,
  sessionId,
  makeCandidate(2, "approved candidate", 80),
  "automatic",
);
const manifest = readCandidateManifest(root, sessionId);
assert.equal(manifest.candidates.length, 2);
assert.equal(manifest.workflowMode, "automatic");

writeCandidateManifestAtomic(root, sessionId, {
  ...manifest,
  candidates: manifest.candidates.map((candidate, index) =>
    index === 0 ? { ...candidate, technicallyValid: false } : candidate,
  ),
});
assert.throws(
  () =>
    applyCandidateReview(root, sessionId, {
      schemaVersion: 1,
      candidateId: "candidate-001",
      candidateVersion: 1,
      arrangementVersion: 1,
      approved: true,
      emotionalArc: 90,
      transitionSmoothness: 90,
      performerIdentity: 90,
      overallScore: 90,
      blockingIssues: [],
      corrections: [],
      warnings: [],
      reviewedAt: new Date().toISOString(),
    }),
  /technically invalid candidate cannot be approved/,
);
writeCandidateManifestAtomic(root, sessionId, manifest);

assert.throws(
  () =>
    promoteCandidate(root, sessionId, "candidate-001", {
      requireApproved: true,
      requireSelected: true,
    }),
  /approved candidate/,
);
assert.throws(
  () =>
    promoteCandidate(root, sessionId, "candidate-002", {
      requireApproved: true,
      requireSelected: true,
    }),
  /selected candidate/,
);

writeCandidateManifestAtomic(root, sessionId, {
  ...manifest,
  selectedCandidateId: "candidate-002",
});
const promoted = promoteCandidate(root, sessionId, "candidate-002", {
  requireApproved: true,
  requireSelected: true,
});
assert.equal(fs.readFileSync(promoted.finalPath, "utf8"), "approved candidate");
assert.equal(sha256File(promoted.finalPath), manifest.candidates[1].sha256);
cleanupRejectedCandidates(root, sessionId);
assert.equal(fs.existsSync(manifest.candidates[0].outputPath), false);
assert.equal(fs.existsSync(promoted.finalPath), true);
assert.equal(
  promoteCandidate(root, sessionId, "candidate-002").idempotent,
  true,
);
fs.writeFileSync(promoted.finalPath, "replaced final bytes", "utf8");
assert.throws(
  () => promoteCandidate(root, sessionId, "candidate-002"),
  /Final output integrity check failed/,
  "Idempotent promotion must reject replaced final bytes",
);
fs.writeFileSync(promoted.finalPath, "approved candidate", "utf8");

assert.throws(
  () =>
    writeCandidateManifestAtomic(root, sessionId, {
      ...readCandidateManifest(root, sessionId),
      selectedCandidateId: "candidate-999",
    }),
  /selected candidate/i,
);

assert.throws(
  () =>
    registerCandidate(root, sessionId, {
      ...manifest.candidates[1],
      outputPath: manifest.candidates[0].outputPath,
    }),
  /different candidate record/,
);

const tamperSession = "tamper-test";
const tamperDir = path.join(root, tamperSession);
fs.mkdirSync(tamperDir, { recursive: true });
writeCandidateManifestAtomic(
  root,
  tamperSession,
  createEmptyManifest(tamperSession),
);
const tampered = makeCandidate(1, "untampered", 80);
const tamperedPath = path.join(tamperDir, "candidate-001.mp3");
fs.renameSync(tampered.outputPath, tamperedPath);
registerCandidate(root, tamperSession, {
  ...tampered,
  outputPath: tamperedPath,
  sizeBytes: fs.statSync(tamperedPath).size,
  sha256: sha256File(tamperedPath),
});
fs.appendFileSync(tamperedPath, "changed");
assert.throws(
  () => promoteCandidate(root, tamperSession, "candidate-001"),
  /integrity check failed/,
);

const limitSession = "limit-test";
const limitDir = path.join(root, limitSession);
fs.mkdirSync(limitDir, { recursive: true });
writeCandidateManifestAtomic(
  root,
  limitSession,
  createEmptyManifest(limitSession),
);
for (let version = 1; version <= MAX_COMPLETE_CANDIDATES; version++) {
  const outputPath = path.join(
    limitDir,
    `candidate-${String(version).padStart(3, "0")}.mp3`,
  );
  fs.writeFileSync(outputPath, `candidate ${version}`);
  registerCandidate(root, limitSession, {
    ...makeCandidate(version, `source ${version}`, 70 + version),
    outputPath,
    sizeBytes: fs.statSync(outputPath).size,
    sha256: sha256File(outputPath),
  });
}
assert.throws(
  () => nextCandidateIdentity(readCandidateManifest(root, limitSession)),
  /Candidate limit reached/,
);
const fifthCandidatePath = path.join(limitDir, "candidate-005.mp3");
fs.writeFileSync(fifthCandidatePath, "candidate 5");
assert.throws(
  () =>
    registerCandidate(root, limitSession, {
      ...makeCandidate(5, "source 5", 75),
      outputPath: fifthCandidatePath,
      sizeBytes: fs.statSync(fifthCandidatePath).size,
      sha256: sha256File(fifthCandidatePath),
    }),
  /Candidate limit reached/,
);

const discardSession = "discard-test";
const discardDir = path.join(root, discardSession);
fs.mkdirSync(discardDir, { recursive: true });
const previewPath = path.join(discardDir, "transition-exec-001-test.mp3");
fs.writeFileSync(previewPath, "preview");
discardAutomaticSessionFiles(root, discardSession, [previewPath]);
assert.equal(fs.existsSync(previewPath), false);

const legacySession = "legacy-output-test";
const legacyDir = path.join(root, legacySession);
fs.mkdirSync(legacyDir, { recursive: true });
const legacyOutput = path.join(legacyDir, "legacy.mp3");
fs.writeFileSync(legacyOutput, "legacy bytes", "utf8");
assert.equal(
  validateLegacyFinalOutput(root, legacySession, "legacy.mp3").sha256,
  sha256File(legacyOutput),
);
assert.throws(
  () => validateLegacyFinalOutput(root, legacySession, "missing.mp3"),
  /missing/,
);
assert.throws(
  () => validateLegacyFinalOutput(root, legacySession, "..\\outside.mp3"),
  /inside its session directory/,
);

fs.rmSync(root, { recursive: true, force: true });
console.log("candidateStore tests passed");
