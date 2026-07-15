import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyCandidateReview,
  applyCandidateHumanReview,
  appendCandidateTechnicalEvaluation,
  assertSessionArtifactBudget,
  cleanupRejectedCandidates,
  computeCandidatePlanHash,
  createEmptyManifest,
  discardAutomaticSessionFiles,
  nextCandidateIdentity,
  promoteCandidate,
  readCandidateManifest,
  recoverRegisteredCandidateTechnicalEvaluation,
  recoverUnregisteredRenderedCandidate,
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

assert.equal(MAX_CORRECTION_RETRIES, 2);
assert.equal(MAX_COMPLETE_CANDIDATES, 3);

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
appendCandidateTechnicalEvaluation(root, sessionId, {
  candidateId: "candidate-001",
  candidateVersion: 1,
  technicallyValid: true,
  blockingIssues: [],
  warnings: [],
  policyVersion: 1,
  evaluatedAt: "2026-07-13T00:00:00.000Z",
});
assert.equal(readCandidateManifest(root, sessionId).technicalEvaluations.length, 1);

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
writeCandidateManifestAtomic(root, sessionId, {
  ...manifest,
  technicalEvaluations: readCandidateManifest(root, sessionId).technicalEvaluations,
});

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
assert.throws(
  () =>
    promoteCandidate(root, sessionId, "candidate-002", {
      requireHumanApproval: true,
      requireSelected: true,
    }),
  /explicit human approval/,
  "An AI-approved candidate must still wait for a person to choose it",
);
applyCandidateHumanReview(root, sessionId, {
  candidateId: "candidate-002",
  decision: "approved",
  notes: ["Chosen after listening in Candidate Review."],
  reviewedAt: "2026-07-15T00:00:00.000Z",
});
const promoted = promoteCandidate(root, sessionId, "candidate-002", {
  requireHumanApproval: true,
  requireSelected: true,
});
assert.equal(fs.readFileSync(promoted.finalPath, "utf8"), "approved candidate");
assert.equal(sha256File(promoted.finalPath), manifest.candidates[1].sha256);
cleanupRejectedCandidates(root, sessionId);
assert.equal(
  fs.existsSync(manifest.candidates[0].outputPath),
  true,
  "Rejected candidates must remain available for comparison and recovery",
);
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
assert.throws(
  () => assertSessionArtifactBudget(root, limitSession, 10, 1),
  /SESSION_ARTIFACT_LIMIT/,
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

const recoverySession = "registration-recovery";
const recoveryDir = path.join(root, recoverySession);
fs.mkdirSync(recoveryDir, { recursive: true });
const recoveryOutput = path.join(recoveryDir, "candidate-001.mp3");
fs.writeFileSync(recoveryOutput, "completed render");
const recoveryCandidate: RenderCandidate = {
  candidateId: "candidate-001",
  candidateVersion: 1,
  parentCandidateId: null,
  arrangementVersion: 2,
  executionVersion: 3,
  outputPath: recoveryOutput,
  debugPaths: [],
  previewPaths: [],
  sizeBytes: fs.statSync(recoveryOutput).size,
  sha256: sha256File(recoveryOutput),
  durationSec: 30,
  technicallyValid: true,
  metrics: {},
  reviewStatus: "pending",
  warnings: [],
  createdAt: new Date().toISOString(),
};
const recoveryCandidateWithRenderScratch = {
  ...recoveryCandidate,
  resolvedTransitions: [
    {
      transitionId: "transition-001",
      fromTrackId: "track-a",
      fromSectionId: "track-a-section-001",
      toTrackId: "track-b",
      toSectionId: "track-b-section-001",
      fromExitSec: 20,
      toEntrySec: 2,
      duration: 2,
      style: "smooth_blend",
      beatAlign: true,
      notes: "",
      executionPermissions: {
        styleMutable: true,
        allowedStyles: ["smooth_blend"],
        durationMutable: true,
        minDuration: 1,
        maxDuration: 5,
      },
      actualFromExitSec: 20,
      actualToEntrySec: 2,
      durationUsed: 2,
      outputPath: null,
      executionVersion: 3,
      _resolvedFromExitSec: 20,
      _resolvedToEntrySec: 2,
    },
  ],
};
fs.writeFileSync(
  path.join(recoveryDir, "candidate-001-validation.json"),
  JSON.stringify({
    candidate: recoveryCandidateWithRenderScratch,
    quality: { score: 90 },
  }),
);
const recovered = recoverUnregisteredRenderedCandidate({
  workDir: root,
  sessionId: recoverySession,
  candidateId: "candidate-001",
  candidateVersion: 1,
  arrangementVersion: 2,
  executionVersion: 3,
  parentCandidateId: null,
  workflowMode: "automatic",
});
assert.equal(recovered?.candidate.outputPath, recoveryOutput);
assert.equal(
  "_resolvedFromExitSec" in (recovered?.candidate.resolvedTransitions?.[0] ?? {}),
  false,
);
assert.equal(
  "_resolvedToEntrySec" in (recovered?.candidate.resolvedTransitions?.[0] ?? {}),
  false,
);
assert.equal(readCandidateManifest(root, recoverySession).candidates.length, 1);
const duplicatePlanPath = path.join(recoveryDir, "candidate-002.mp3");
fs.writeFileSync(duplicatePlanPath, "different render bytes");
const recoveredPlanHash = computeCandidatePlanHash(
  recovered?.candidate.resolvedTransitions,
);
assert.ok(recoveredPlanHash);
assert.throws(
  () => registerCandidate(root, recoverySession, {
    ...recovered!.candidate,
    candidateId: "candidate-002",
    candidateVersion: 2,
    parentCandidateId: "candidate-001",
    executionVersion: 4,
    planHash: recoveredPlanHash!,
    outputPath: duplicatePlanPath,
    sizeBytes: fs.statSync(duplicatePlanPath).size,
    sha256: sha256File(duplicatePlanPath),
  }),
  /Duplicate candidate plan rejected/,
);
assert.equal(readCandidateManifest(root, recoverySession).candidates.length, 1);

const technicalRecoverySession = "technical-registration-recovery";
const technicalRecoveryDir = path.join(root, technicalRecoverySession);
fs.mkdirSync(technicalRecoveryDir, { recursive: true });
const technicalRecoveryOutput = path.join(technicalRecoveryDir, "candidate-001.mp3");
fs.writeFileSync(technicalRecoveryOutput, "registered render");
const technicalRecoveryCandidate = {
  ...recoveryCandidate,
  outputPath: technicalRecoveryOutput,
  sizeBytes: fs.statSync(technicalRecoveryOutput).size,
  sha256: sha256File(technicalRecoveryOutput),
};
registerCandidate(root, technicalRecoverySession, technicalRecoveryCandidate, "automatic");
fs.writeFileSync(
  path.join(technicalRecoveryDir, "candidate-001-validation.json"),
  JSON.stringify({
    candidate: technicalRecoveryCandidate,
    quality: { score: 90 },
    qualityGate: { technicallyValid: true, blockingIssues: [], warnings: [] },
  }),
);
const recoveredTechnicalEvaluation = recoverRegisteredCandidateTechnicalEvaluation({
  workDir: root,
  sessionId: technicalRecoverySession,
  arrangementVersion: 2,
  executionVersion: 3,
});
assert.equal(recoveredTechnicalEvaluation?.candidate.candidateId, "candidate-001");
assert.equal(recoveredTechnicalEvaluation?.manifest.technicalEvaluations.length, 1);
assert.equal(
  recoverRegisteredCandidateTechnicalEvaluation({
    workDir: root,
    sessionId: technicalRecoverySession,
    arrangementVersion: 2,
    executionVersion: 3,
  }),
  null,
);
const humanApprovedManifest = applyCandidateHumanReview(
  root,
  technicalRecoverySession,
  {
    candidateId: "candidate-001",
    decision: "approved",
    notes: ["approved after manual review"],
    reviewedAt: "2026-07-13T00:00:00.000Z",
  },
);
assert.equal(humanApprovedManifest.selectedCandidateId, "candidate-001");
assert.equal(humanApprovedManifest.humanReviews.length, 1);

const compatibleRecoverySession = "compatible-registration-recovery";
const compatibleRecoveryDir = path.join(root, compatibleRecoverySession);
fs.mkdirSync(compatibleRecoveryDir, { recursive: true });
const compatibleRecoveryOutput = path.join(
  compatibleRecoveryDir,
  "candidate-001.mp3",
);
fs.writeFileSync(compatibleRecoveryOutput, "completed compatible render");
const compatibleRecoveryCandidate = {
  ...recoveryCandidateWithRenderScratch,
  outputPath: compatibleRecoveryOutput,
  sizeBytes: fs.statSync(compatibleRecoveryOutput).size,
  sha256: sha256File(compatibleRecoveryOutput),
};
fs.writeFileSync(
  path.join(compatibleRecoveryDir, "candidate-001-validation.json"),
  JSON.stringify({ candidate: compatibleRecoveryCandidate }),
);
assert.throws(
  () =>
    recoverUnregisteredRenderedCandidate({
      workDir: root,
      sessionId: compatibleRecoverySession,
      candidateId: "candidate-001",
      candidateVersion: 1,
      arrangementVersion: 2,
      executionVersion: 4,
      parentCandidateId: null,
      workflowMode: "automatic",
    }),
  /does not match the active render request/,
);
const recoveredCompatibleAttempt = recoverUnregisteredRenderedCandidate({
  workDir: root,
  sessionId: compatibleRecoverySession,
  candidateId: "candidate-001",
  candidateVersion: 1,
  arrangementVersion: 2,
  executionVersion: 4,
  parentCandidateId: null,
  workflowMode: "automatic",
  isExecutionVersionCompatible: (candidate) => candidate.executionVersion === 3,
});
assert.equal(
  recoveredCompatibleAttempt?.candidate.executionVersion,
  3,
);

const overwriteSession = "final-overwrite-guard";
const overwriteDir = path.join(root, overwriteSession);
fs.mkdirSync(overwriteDir, { recursive: true });
const overwriteCandidatePath = path.join(overwriteDir, "candidate-001.mp3");
fs.writeFileSync(overwriteCandidatePath, "candidate final bytes");
registerCandidate(root, overwriteSession, {
  ...recoveryCandidate,
  arrangementVersion: 1,
  executionVersion: 1,
  outputPath: overwriteCandidatePath,
  sizeBytes: fs.statSync(overwriteCandidatePath).size,
  sha256: sha256File(overwriteCandidatePath),
});
const guardedFinalPath = path.join(overwriteDir, "medley_final.mp3");
fs.writeFileSync(guardedFinalPath, "different existing final");
assert.throws(
  () => promoteCandidate(root, overwriteSession, "candidate-001"),
  /refusing to overwrite/,
);
assert.equal(fs.readFileSync(guardedFinalPath, "utf8"), "different existing final");
fs.writeFileSync(guardedFinalPath, "candidate final bytes");
assert.equal(
  promoteCandidate(root, overwriteSession, "candidate-001").idempotent,
  true,
);
assert.equal(
  readCandidateManifest(root, overwriteSession).finalizedCandidateId,
  "candidate-001",
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
