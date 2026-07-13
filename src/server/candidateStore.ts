import crypto from "crypto";
import fs from "fs";
import path from "path";
import { isDeepStrictEqual } from "node:util";
import {
  CandidateManifestSchema,
  CandidateHumanReviewSchema,
  CandidateTechnicalEvaluationSchema,
  MAX_COMPLETE_CANDIDATES,
  RenderCandidateSchema,
  chooseBestCandidate,
  type CandidateManifest,
  type QualityReview,
  type RenderCandidate,
} from "../types/specialistWorkflow";
import { sanitizeResolvedTransitionsForManifest } from "./transitionResolution";
import { withSessionTransaction } from "./sessionTransaction";

const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{3,80}$/;
export const MAX_SESSION_ARTIFACT_BYTES = 2 * 1024 * 1024 * 1024;

export function validateSessionId(sessionId: string) {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error("Invalid session ID");
  }
}

export function getSessionDirectory(workDir: string, sessionId: string) {
  validateSessionId(sessionId);
  const root = path.resolve(workDir);
  const sessionDir = path.resolve(root, sessionId);
  if (sessionDir !== root && !sessionDir.startsWith(root + path.sep)) {
    throw new Error("Session path escapes the work directory");
  }
  return sessionDir;
}

function ensureDirectory(directory: string) {
  fs.mkdirSync(directory, { recursive: true });
}

function manifestPath(workDir: string, sessionId: string) {
  return path.join(
    getSessionDirectory(workDir, sessionId),
    "candidate-manifest.json",
  );
}

export async function withSessionLock<T>(
  sessionId: string,
  operation: () => Promise<T>,
): Promise<T> { return withSessionTransaction(sessionId, operation); }

export function createEmptyManifest(sessionId: string): CandidateManifest {
  return {
    schemaVersion: 1,
    sessionId,
    workflowMode: undefined,
    selectedCandidateId: null,
    finalizedCandidateId: null,
    finalOutputPath: null,
    candidates: [],
    technicalEvaluations: [],
    musicalReviews: [],
    humanReviews: [],
    updatedAt: new Date().toISOString(),
  };
}

export function validateCandidateManifestSemantics(
  workDir: string,
  sessionId: string,
  manifest: CandidateManifest,
) {
  if (manifest.sessionId !== sessionId) {
    throw new Error("Candidate manifest session ID does not match its path");
  }
  const candidateIds = new Set<string>();
  const candidateVersions = new Set<number>();
  for (const candidate of manifest.candidates) {
    if (candidateIds.has(candidate.candidateId)) {
      throw new Error(`Duplicate candidate ID: ${candidate.candidateId}`);
    }
    if (candidateVersions.has(candidate.candidateVersion)) {
      throw new Error(
        `Duplicate candidate version: ${candidate.candidateVersion}`,
      );
    }
    candidateIds.add(candidate.candidateId);
    candidateVersions.add(candidate.candidateVersion);
  }
  for (const candidate of manifest.candidates) {
    if (
      candidate.parentCandidateId &&
      !candidateIds.has(candidate.parentCandidateId)
    ) {
      throw new Error(
        `Candidate parent is not registered: ${candidate.parentCandidateId}`,
      );
    }
    if (candidate.parentCandidateId === candidate.candidateId) {
      throw new Error("Candidate cannot be its own parent");
    }
  }
  if (
    manifest.selectedCandidateId &&
    !candidateIds.has(manifest.selectedCandidateId)
  ) {
    throw new Error("Selected candidate is not registered in the manifest");
  }
  if (
    manifest.finalizedCandidateId &&
    !candidateIds.has(manifest.finalizedCandidateId)
  ) {
    throw new Error("Finalized candidate is not registered in the manifest");
  }
  if (Boolean(manifest.finalizedCandidateId) !== Boolean(manifest.finalOutputPath)) {
    throw new Error(
      "Finalized candidate and final output path must be recorded together",
    );
  }
  if (manifest.finalOutputPath) {
    const expectedFinalPath = path.join(
      getSessionDirectory(workDir, sessionId),
      "medley_final.mp3",
    );
    if (path.resolve(manifest.finalOutputPath) !== path.resolve(expectedFinalPath)) {
      throw new Error("Final output path must be the fixed session final path");
    }
  }
  return manifest;
}

export function readCandidateManifest(
  workDir: string,
  sessionId: string,
): CandidateManifest {
  const file = manifestPath(workDir, sessionId);
  if (!fs.existsSync(file)) return createEmptyManifest(sessionId);
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  const result = CandidateManifestSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Candidate manifest is corrupt: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  return validateCandidateManifestSemantics(workDir, sessionId, result.data);
}

export function writeCandidateManifestAtomic(
  workDir: string,
  sessionId: string,
  manifest: CandidateManifest,
) {
  const sessionDir = getSessionDirectory(workDir, sessionId);
  ensureDirectory(sessionDir);
  const validated = CandidateManifestSchema.parse({
    ...manifest,
    sessionId,
    updatedAt: new Date().toISOString(),
  });
  validateCandidateManifestSemantics(workDir, sessionId, validated);
  const target = manifestPath(workDir, sessionId);
  const temporary = `${target}.tmp`;
  const fd = fs.openSync(temporary, "w");
  try {
    fs.writeFileSync(fd, JSON.stringify(validated, null, 2), "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, target);
}

export function sha256File(filePath: string) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function assertNoReparsePoint(filePath: string) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink())
    throw new Error("Symbolic links are not allowed for candidate files");
}

export function assertRegisteredSafeFile(
  workDir: string,
  sessionId: string,
  filePath: string,
  registeredPaths: string[],
) {
  const sessionDir = getSessionDirectory(workDir, sessionId);
  ensureDirectory(sessionDir);
  const realSessionDir = fs.realpathSync.native(sessionDir);
  const resolved = path.resolve(filePath);
  if (!registeredPaths.some((item) => path.resolve(item) === resolved)) {
    throw new Error("File is not registered in the candidate manifest");
  }
  const parent = path.dirname(resolved);
  const realParent = fs.realpathSync.native(parent);
  if (
    realParent !== realSessionDir &&
    !realParent.startsWith(realSessionDir + path.sep)
  ) {
    throw new Error("Candidate path escapes the session directory");
  }
  if (fs.existsSync(resolved)) assertNoReparsePoint(resolved);
  return resolved;
}

export function getAvailableBytes(directory: string): number | null {
  try {
    const stats = fs.statfsSync(directory);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}

export function assertCandidateStorageAvailable(
  workDir: string,
  sessionId: string,
  estimatedBytes: number,
) {
  const sessionDir = getSessionDirectory(workDir, sessionId);
  ensureDirectory(sessionDir);
  const available = getAvailableBytes(sessionDir);
  const required = Math.max(estimatedBytes * 2, 200 * 1024 * 1024);
  if (available !== null && available < required) {
    throw new Error(
      `INSUFFICIENT_STORAGE: requires ${required} bytes with safety margin, ${available} available`,
    );
  }
}

function sessionArtifactBytes(directory: string): number {
  let total = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) total += sessionArtifactBytes(target);
    else if (entry.isFile()) total += fs.statSync(target).size;
  }
  return total;
}

/** Refuse new artifacts before rendering; never evict existing evidence. */
export function assertSessionArtifactBudget(
  workDir: string,
  sessionId: string,
  estimatedBytes: number,
  maximumBytes = MAX_SESSION_ARTIFACT_BYTES,
) {
  const sessionDir = getSessionDirectory(workDir, sessionId);
  ensureDirectory(sessionDir);
  const existingBytes = sessionArtifactBytes(sessionDir);
  if (!Number.isFinite(estimatedBytes) || estimatedBytes < 0) {
    throw new Error("Session artifact estimate is invalid");
  }
  if (existingBytes + estimatedBytes > maximumBytes) {
    throw new Error(
      `SESSION_ARTIFACT_LIMIT: ${existingBytes + estimatedBytes} bytes would exceed the ${maximumBytes}-byte session limit`,
    );
  }
}

export function validateLegacyFinalOutput(
  workDir: string,
  sessionId: string,
  filePath: string,
) {
  const sessionDir = getSessionDirectory(workDir, sessionId);
  const resolved = path.resolve(
    path.isAbsolute(filePath) ? filePath : path.join(sessionDir, filePath),
  );
  if (path.dirname(resolved) !== sessionDir) {
    throw new Error("Legacy final output must be inside its session directory");
  }
  if (!fs.existsSync(resolved)) throw new Error("Legacy final output is missing");
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("Legacy final output must be a regular non-symlink file");
  }
  const realSession = fs.realpathSync.native(sessionDir);
  const realParent = fs.realpathSync.native(path.dirname(resolved));
  if (realParent !== realSession) {
    throw new Error("Legacy final output escapes its session directory");
  }
  return {
    finalPath: resolved,
    sizeBytes: stat.size,
    sha256: sha256File(resolved),
  };
}

export function nextCandidateIdentity(manifest: CandidateManifest) {
  if (manifest.candidates.length >= MAX_COMPLETE_CANDIDATES) {
    throw new Error(`Candidate limit reached (${MAX_COMPLETE_CANDIDATES})`);
  }
  const version = manifest.candidates.length + 1;
  return {
    candidateVersion: version,
    candidateId: `candidate-${String(version).padStart(3, "0")}`,
  };
}

export function registerCandidate(
  workDir: string,
  sessionId: string,
  candidate: RenderCandidate,
  workflowMode?: "automatic" | "legacy",
) {
  const manifest = readCandidateManifest(workDir, sessionId);
  if (
    manifest.candidates.some((item) => item.candidateId === candidate.candidateId)
  ) {
    const existing = manifest.candidates.find(
      (item) => item.candidateId === candidate.candidateId,
    );
    if (!isDeepStrictEqual(existing, candidate)) {
      throw new Error(
        `Candidate ID ${candidate.candidateId} is already registered with a different candidate record`,
      );
    }
    return manifest;
  }
  if (manifest.candidates.length >= MAX_COMPLETE_CANDIDATES) {
    throw new Error(`Candidate limit reached (${MAX_COMPLETE_CANDIDATES})`);
  }
  const next: CandidateManifest = {
    ...manifest,
    workflowMode: workflowMode ?? manifest.workflowMode,
    candidates: [...manifest.candidates, candidate],
    updatedAt: new Date().toISOString(),
  };
  writeCandidateManifestAtomic(workDir, sessionId, next);
  return next;
}

export function recoverUnregisteredRenderedCandidate(options: {
  workDir: string;
  sessionId: string;
  candidateId: string;
  candidateVersion: number;
  arrangementVersion: number;
  executionVersion: number;
  parentCandidateId: string | null;
  workflowMode: "automatic" | "legacy";
  isExecutionVersionCompatible?: (candidate: RenderCandidate) => boolean;
}) {
  const {
    workDir,
    sessionId,
    candidateId,
    candidateVersion,
    arrangementVersion,
    executionVersion,
    parentCandidateId,
    workflowMode,
    isExecutionVersionCompatible,
  } = options;
  const sessionDir = getSessionDirectory(workDir, sessionId);
  const outputPath = path.join(sessionDir, `${candidateId}.mp3`);
  const validationPath = path.join(
    sessionDir,
    `${candidateId}-validation.json`,
  );
  if (!fs.existsSync(outputPath) && !fs.existsSync(validationPath)) return null;
  if (!fs.existsSync(outputPath) || !fs.existsSync(validationPath)) {
    throw new Error(
      `Incomplete unregistered candidate ${candidateId} was preserved for inspection`,
    );
  }
  for (const filePath of [outputPath, validationPath]) {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`Unregistered candidate artifact is not a regular file`);
    }
    if (fs.realpathSync.native(path.dirname(filePath)) !== fs.realpathSync.native(sessionDir)) {
      throw new Error("Unregistered candidate artifact escapes its session directory");
    }
  }
  const validation = JSON.parse(fs.readFileSync(validationPath, "utf8"));
  const candidate = validation?.candidate;
  const normalizedCandidate =
    candidate &&
    typeof candidate === "object" &&
    Array.isArray(candidate.resolvedTransitions)
      ? {
          ...candidate,
          resolvedTransitions: sanitizeResolvedTransitionsForManifest(
            candidate.resolvedTransitions,
          ),
        }
      : candidate;
  const parsed = RenderCandidateSchema.parse(normalizedCandidate);
  if (
    parsed.candidateId !== candidateId ||
    parsed.candidateVersion !== candidateVersion ||
    parsed.arrangementVersion !== arrangementVersion ||
    (parsed.executionVersion !== executionVersion &&
      !isExecutionVersionCompatible?.(parsed)) ||
    parsed.parentCandidateId !== parentCandidateId ||
    path.resolve(parsed.outputPath) !== path.resolve(outputPath)
  ) {
    throw new Error(
      `Unregistered candidate ${candidateId} does not match the active render request`,
    );
  }
  const stat = fs.statSync(outputPath);
  if (stat.size !== parsed.sizeBytes || sha256File(outputPath) !== parsed.sha256) {
    throw new Error(`Unregistered candidate ${candidateId} failed integrity validation`);
  }
  const manifest = registerCandidate(
    workDir,
    sessionId,
    parsed,
    workflowMode,
  );
  return {
    candidate: parsed,
    manifest,
    quality: validation?.quality ?? null,
    qualityGate: validation?.qualityGate ?? null,
  };
}

/**
 * If registration committed but the immediately following technical-evidence
 * write was interrupted, complete that narrow missing boundary. This avoids
 * treating a valid, registered MP3 as a reason to render candidate N+1.
 */
export function recoverRegisteredCandidateTechnicalEvaluation(options: {
  workDir: string;
  sessionId: string;
  arrangementVersion: number;
  executionVersion: number;
}) {
  const manifest = readCandidateManifest(options.workDir, options.sessionId);
  const candidate = manifest.candidates.at(-1);
  if (!candidate ||
      candidate.arrangementVersion !== options.arrangementVersion ||
      candidate.executionVersion !== options.executionVersion ||
      manifest.technicalEvaluations.some((item) => item.candidateId === candidate.candidateId)) {
    return null;
  }
  const sessionDir = getSessionDirectory(options.workDir, options.sessionId);
  const validationPath = path.join(sessionDir, `${candidate.candidateId}-validation.json`);
  if (!fs.existsSync(validationPath)) {
    throw new Error("Registered candidate is missing its technical validation sidecar");
  }
  const validation = JSON.parse(fs.readFileSync(validationPath, "utf8"));
  const validatedCandidate = RenderCandidateSchema.parse(validation?.candidate);
  if (!isDeepStrictEqual(validatedCandidate, candidate)) {
    throw new Error("Registered candidate validation sidecar does not match the manifest");
  }
  if (!fs.existsSync(candidate.outputPath) || sha256File(candidate.outputPath) !== candidate.sha256) {
    throw new Error("Registered candidate audio failed integrity validation");
  }
  const qualityGate = validation?.qualityGate;
  if (!qualityGate || typeof qualityGate !== "object") {
    throw new Error("Registered candidate validation sidecar has no technical quality result");
  }
  const updatedManifest = appendCandidateTechnicalEvaluation(
    options.workDir,
    options.sessionId,
    {
      candidateId: candidate.candidateId,
      candidateVersion: candidate.candidateVersion,
      technicallyValid: Boolean(qualityGate.technicallyValid),
      blockingIssues: Array.isArray(qualityGate.blockingIssues) ? qualityGate.blockingIssues : [],
      warnings: Array.isArray(qualityGate.warnings) ? qualityGate.warnings : [],
      policyVersion: 1,
      evaluatedAt: new Date().toISOString(),
    },
  );
  return {
    candidate,
    manifest: updatedManifest,
    quality: validation?.quality ?? null,
    qualityGate,
  };
}

export function applyCandidateReview(
  workDir: string,
  sessionId: string,
  review: QualityReview,
) {
  const manifest = readCandidateManifest(workDir, sessionId);
  const index = manifest.candidates.findIndex(
    (item) => item.candidateId === review.candidateId,
  );
  if (index < 0) throw new Error("Reviewed candidate is not registered");
  if (review.approved && !manifest.candidates[index].technicallyValid) {
    throw new Error("A technically invalid candidate cannot be approved");
  }
  const candidates = manifest.candidates.slice();
  candidates[index] = {
    ...candidates[index],
    metrics: {
      emotionalArc: review.emotionalArc,
      transitionSmoothness: review.transitionSmoothness,
      performerIdentity: review.performerIdentity,
      overallScore: review.overallScore,
    },
    reviewStatus: review.approved ? "approved" : "changes_requested",
    warnings: [
      ...new Set([
        ...candidates[index].warnings,
        ...review.warnings,
        ...review.blockingIssues,
      ]),
    ],
  };
  const selected = chooseBestCandidate(candidates);
  const next: CandidateManifest = {
    ...manifest,
    candidates,
    musicalReviews: [...manifest.musicalReviews, review],
    selectedCandidateId: selected?.candidateId ?? null,
    updatedAt: new Date().toISOString(),
  };
  writeCandidateManifestAtomic(workDir, sessionId, next);
  return next;
}

/** Append a human decision without replacing any AI or technical evidence. */
export function applyCandidateHumanReview(
  workDir: string,
  sessionId: string,
  review: unknown,
) {
  const parsed = CandidateHumanReviewSchema.parse(review);
  const manifest = readCandidateManifest(workDir, sessionId);
  const candidate = manifest.candidates.find(
    (item) => item.candidateId === parsed.candidateId,
  );
  if (!candidate) throw new Error("Human-reviewed candidate is not registered");
  if (parsed.decision === "approved" && !candidate.technicallyValid) {
    throw new Error("A technically invalid candidate cannot be human-approved");
  }
  if (manifest.humanReviews.some(
    (item) => item.candidateId === parsed.candidateId && item.reviewedAt === parsed.reviewedAt,
  )) return manifest;
  const candidates = manifest.candidates.map((item) => {
    if (item.candidateId !== parsed.candidateId) return item;
    const reviewStatus: RenderCandidate["reviewStatus"] =
      parsed.decision === "approved" ? "approved" : "changes_requested";
    return { ...item, reviewStatus };
  });
  const next: CandidateManifest = {
    ...manifest,
    candidates,
    humanReviews: [...manifest.humanReviews, parsed],
    selectedCandidateId:
      parsed.decision === "approved" ? parsed.candidateId : manifest.selectedCandidateId,
    updatedAt: new Date().toISOString(),
  };
  writeCandidateManifestAtomic(workDir, sessionId, next);
  return next;
}

export function appendCandidateTechnicalEvaluation(
  workDir: string,
  sessionId: string,
  evaluation: unknown,
) {
  const parsed = CandidateTechnicalEvaluationSchema.parse(evaluation);
  const manifest = readCandidateManifest(workDir, sessionId);
  if (!manifest.candidates.some((candidate) => candidate.candidateId === parsed.candidateId)) {
    throw new Error("Technical evaluation candidate is not registered");
  }
  if (manifest.technicalEvaluations.some(
    (item) => item.candidateId === parsed.candidateId && item.evaluatedAt === parsed.evaluatedAt,
  )) {
    return manifest;
  }
  const next: CandidateManifest = {
    ...manifest,
    technicalEvaluations: [...manifest.technicalEvaluations, parsed],
    updatedAt: new Date().toISOString(),
  };
  writeCandidateManifestAtomic(workDir, sessionId, next);
  return next;
}

export function promoteCandidate(
  workDir: string,
  sessionId: string,
  candidateId: string,
  options: {
    requireApproved?: boolean;
    requireSelected?: boolean;
  } = {},
) {
  const manifest = readCandidateManifest(workDir, sessionId);
  const candidate = manifest.candidates.find(
    (item) => item.candidateId === candidateId,
  );
  if (!candidate) {
    throw new Error("Candidate is missing or technically invalid");
  }
  if (
    manifest.finalizedCandidateId &&
    manifest.finalizedCandidateId !== candidateId
  ) {
    throw new Error(
      `Session is already finalized with ${manifest.finalizedCandidateId}`,
    );
  }
  if (options.requireApproved && candidate.reviewStatus !== "approved") {
    throw new Error("Automatic finalization requires an approved candidate");
  }
  if (options.requireSelected && manifest.selectedCandidateId !== candidateId) {
    throw new Error("Automatic finalization requires the selected candidate");
  }
  if (!candidate.technicallyValid) {
    throw new Error("Candidate is missing or technically invalid");
  }
  const registered = manifest.candidates.flatMap((item) => [
    item.outputPath,
    ...item.debugPaths,
    ...item.previewPaths,
  ]);
  const source = assertRegisteredSafeFile(
    workDir,
    sessionId,
    candidate.outputPath,
    registered,
  );
  if (!fs.existsSync(source)) throw new Error("Candidate file is missing");
  const sizeBytes = fs.statSync(source).size;
  const sourceHash = sha256File(source);
  if (sizeBytes !== candidate.sizeBytes || sourceHash !== candidate.sha256) {
    throw new Error("Candidate integrity check failed");
  }
  const sessionDir = getSessionDirectory(workDir, sessionId);
  const finalPath = path.join(sessionDir, "medley_final.mp3");
  if (
    manifest.finalizedCandidateId === candidateId &&
    manifest.finalOutputPath
  ) {
    if (path.resolve(manifest.finalOutputPath) !== path.resolve(finalPath)) {
      throw new Error("Final output path must be the fixed session final path");
    }
    if (!fs.existsSync(finalPath)) throw new Error("Final output is missing");
    assertNoReparsePoint(finalPath);
    const finalStat = fs.statSync(finalPath);
    if (
      !finalStat.isFile() ||
      finalStat.size !== candidate.sizeBytes ||
      sha256File(finalPath) !== candidate.sha256
    ) {
      throw new Error("Final output integrity check failed");
    }
    return { manifest, finalPath, idempotent: true };
  }
  const partPath = path.join(sessionDir, "medley_final.mp3.part");
  let recoveredInterruptedPromotion = false;
  if (fs.existsSync(finalPath)) {
    const existing = fs.lstatSync(finalPath);
    if (
      existing.isSymbolicLink() ||
      !existing.isFile() ||
      existing.size !== sizeBytes ||
      sha256File(finalPath) !== sourceHash
    ) {
      throw new Error(
        "A different final output already exists; refusing to overwrite it",
      );
    }
    recoveredInterruptedPromotion = true;
  } else {
    fs.copyFileSync(source, partPath);
    const copiedSize = fs.statSync(partPath).size;
    const copiedHash = sha256File(partPath);
    if (copiedSize !== sizeBytes || copiedHash !== sourceHash) {
      fs.rmSync(partPath, { force: true });
      throw new Error("Final copy integrity check failed");
    }
    fs.renameSync(partPath, finalPath);
  }
  const next: CandidateManifest = {
    ...manifest,
    selectedCandidateId: candidateId,
    finalizedCandidateId: candidateId,
    finalOutputPath: finalPath,
    updatedAt: new Date().toISOString(),
  };
  writeCandidateManifestAtomic(workDir, sessionId, next);
  return {
    manifest: next,
    finalPath,
    idempotent: recoveredInterruptedPromotion,
  };
}

export function cleanupRejectedCandidates(workDir: string, sessionId: string) {
  const manifest = readCandidateManifest(workDir, sessionId);
  const selected = manifest.finalizedCandidateId;
  for (const candidate of manifest.candidates) {
    if (candidate.candidateId === selected) continue;
    const registered = [
      candidate.outputPath,
      ...candidate.debugPaths,
      ...candidate.previewPaths,
    ];
    for (const filePath of registered) {
      try {
        const safe = assertRegisteredSafeFile(
          workDir,
          sessionId,
          filePath,
          registered,
        );
        fs.rmSync(safe, { force: true });
      } catch {
        // Cleanup is best-effort and must not invalidate successful finalization.
      }
    }
  }
}

export function discardAutomaticSessionFiles(
  workDir: string,
  sessionId: string,
  additionalRegisteredPaths: string[] = [],
) {
  const sessionDir = getSessionDirectory(workDir, sessionId);
  const manifest = readCandidateManifest(workDir, sessionId);
  const historyProtected = manifest.finalOutputPath;
  const registered = [
    ...manifest.candidates.flatMap((candidate) => [
      candidate.outputPath,
      ...candidate.debugPaths,
      ...candidate.previewPaths,
    ]),
    ...additionalRegisteredPaths,
  ];
  for (const filePath of registered) {
    if (
      historyProtected &&
      path.resolve(filePath) === path.resolve(historyProtected)
    )
      continue;
    try {
      const safe = assertRegisteredSafeFile(
        workDir,
        sessionId,
        filePath,
        registered,
      );
      fs.rmSync(safe, { force: true });
    } catch {
      // Idempotent discard tolerates already missing files.
    }
  }
  if (fs.existsSync(sessionDir)) {
    for (const name of fs.readdirSync(sessionDir)) {
      if (!name.endsWith(".part")) continue;
      const filePath = path.join(sessionDir, name);
      try {
        const realParent = fs.realpathSync.native(path.dirname(filePath));
        const realSession = fs.realpathSync.native(sessionDir);
        if (realParent === realSession) fs.rmSync(filePath, { force: true });
      } catch {}
    }
  }
  fs.rmSync(manifestPath(workDir, sessionId), { force: true });
}
