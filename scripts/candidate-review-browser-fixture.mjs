import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

const dataRoot = path.resolve(process.argv[2] || "");
if (!dataRoot) throw new Error("Fixture data root is required");
const sessionId = "browser-review-fixture";
const workDir = path.join(dataRoot, "workdir");
const sessionDir = path.join(workDir, sessionId);
fs.mkdirSync(sessionDir, { recursive: true });
fs.mkdirSync(path.join(dataRoot, "library", "audio"), { recursive: true });
for (const fileName of ["library.json", "history.json", "wisdom.json"]) {
  fs.writeFileSync(path.join(dataRoot, "library", fileName), "[]\n", "utf8");
}

const sha256 = (filePath) =>
  crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
const now = "2026-07-14T20:00:00.000Z";
const transition = (duration, style = "smooth_blend") => ({
  transitionId: "transition-001",
  transitionCandidateId: "candidate-option-001",
  fromTrackId: "track-a",
  fromSectionId: "section-a",
  toTrackId: "track-b",
  toSectionId: "section-b",
  fromExitSec: 4,
  toEntrySec: 1,
  duration,
  style,
  beatAlign: true,
  executionPermissions: {
    styleMutable: true,
    allowedStyles: ["smooth_blend", "beat_aligned"],
    durationMutable: true,
    minDuration: 1,
    maxDuration: 3,
    beatAlignMutable: false,
  },
  notes: "browser fixture",
  actualFromExitSec: 4,
  actualToEntrySec: 1,
  durationUsed: duration,
  outputPath: null,
  executionVersion: duration === 2 ? 1 : 2,
});

const makeCandidate = (number, frequency, duration, parentCandidateId) => {
  const candidateId = `candidate-${String(number).padStart(3, "0")}`;
  const outputPath = path.join(sessionDir, `${candidateId}.mp3`);
  execFileSync(ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `sine=frequency=${frequency}:duration=6`,
    "-ar", "48000", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "192k",
    outputPath,
  ]);
  return {
    candidateId,
    candidateVersion: number,
    parentCandidateId,
    arrangementVersion: number,
    executionVersion: number,
    planHash: crypto.createHash("sha256").update(`plan-${number}`).digest("hex"),
    resolvedTransitions: [transition(duration, number === 1 ? "smooth_blend" : "beat_aligned")],
    outputPath,
    debugPaths: [],
    previewPaths: [],
    sizeBytes: fs.statSync(outputPath).size,
    sha256: sha256(outputPath),
    durationSec: 6,
    technicallyValid: true,
    metrics: { overallScore: number === 1 ? 58 : 72 },
    reviewStatus: "changes_requested",
    warnings: [],
    createdAt: new Date(Date.parse(now) + number * 60_000).toISOString(),
  };
};

const first = makeCandidate(1, 440, 2, null);
const second = makeCandidate(2, 554, 2.5, first.candidateId);
const manifest = {
  schemaVersion: 1,
  sessionId,
  workflowMode: "automatic",
  selectedCandidateId: second.candidateId,
  finalizedCandidateId: null,
  finalOutputPath: null,
  candidates: [first, second],
  technicalEvaluations: [first, second].map((candidate) => ({
    candidateId: candidate.candidateId,
    candidateVersion: candidate.candidateVersion,
    technicallyValid: true,
    blockingIssues: [],
    warnings: [],
    policyVersion: 1,
    evaluatedAt: candidate.createdAt,
  })),
  musicalReviews: [
    {
      schemaVersion: 1,
      reviewSource: "openrouter_audio",
      reviewModel: "fixture/free:free",
      candidateId: first.candidateId,
      candidateVersion: 1,
      arrangementVersion: 1,
      approved: false,
      emotionalArc: 55,
      transitionSmoothness: 40,
      performerIdentity: 80,
      overallScore: 58,
      blockingIssues: ["The handoff sounds abrupt."],
      corrections: [{
        transitionId: "transition-001",
        issue: "The handoff sounds abrupt.",
        requestedChange: "Apply bounded preset longer_crossfade.",
        correctionPreset: "longer_crossfade",
      }],
      warnings: [],
      reviewedAt: first.createdAt,
    },
    {
      schemaVersion: 1,
      reviewSource: "openrouter_audio",
      reviewModel: "fixture/free:free",
      candidateId: second.candidateId,
      candidateVersion: 2,
      arrangementVersion: 2,
      approved: false,
      emotionalArc: 68,
      transitionSmoothness: 70,
      performerIdentity: 78,
      overallScore: 72,
      blockingIssues: ["Automatic review ended before approval."],
      corrections: [],
      warnings: [],
      reviewedAt: second.createdAt,
    },
  ],
  humanReviews: [],
  updatedAt: second.createdAt,
};
fs.writeFileSync(
  path.join(sessionDir, "candidate-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
fs.writeFileSync(
  path.join(sessionDir, "session-state.json"),
  `${JSON.stringify({
    schemaVersion: 1,
    workflowVersion: 4,
    sessionId,
    state: "manual_review_required",
    stateRevision: 9,
    selectedTrackIds: ["track-a", "track-b"],
    selectionHash: "a".repeat(64),
    designHash: "b".repeat(64),
    activeArrangementVersion: 2,
    activeExecutionGeneration: 2,
    currentCandidateId: second.candidateId,
    idempotencyRecords: [],
    recoverableError: "Automatic improvements stopped. Choose either preserved draft below.",
    createdAt: now,
    updatedAt: second.createdAt,
  }, null, 2)}\n`,
  "utf8",
);

console.log(JSON.stringify({ dataRoot, sessionId }));
