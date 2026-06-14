import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  CandidateManifestSchema,
  MAX_COMPLETE_CANDIDATES,
  chooseBestCandidate,
  type CandidateManifest,
  type QualityReview,
  type RenderCandidate,
} from '../types/specialistWorkflow';

const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{3,80}$/;
const manifestLocks = new Map<string, Promise<void>>();

export function validateSessionId(sessionId: string) {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error('Invalid session ID');
  }
}

export function getSessionDirectory(workDir: string, sessionId: string) {
  validateSessionId(sessionId);
  const root = path.resolve(workDir);
  const sessionDir = path.resolve(root, sessionId);
  if (sessionDir !== root && !sessionDir.startsWith(root + path.sep)) {
    throw new Error('Session path escapes the work directory');
  }
  return sessionDir;
}

function ensureDirectory(directory: string) {
  fs.mkdirSync(directory, { recursive: true });
}

function manifestPath(workDir: string, sessionId: string) {
  return path.join(getSessionDirectory(workDir, sessionId), 'candidate-manifest.json');
}

export async function withSessionLock<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
  const previous = manifestLocks.get(sessionId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  manifestLocks.set(sessionId, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (manifestLocks.get(sessionId) === queued) manifestLocks.delete(sessionId);
  }
}

export function createEmptyManifest(sessionId: string): CandidateManifest {
  return {
    schemaVersion: 1,
    sessionId,
    selectedCandidateId: null,
    finalizedCandidateId: null,
    finalOutputPath: null,
    candidates: [],
    updatedAt: new Date().toISOString(),
  };
}

export function readCandidateManifest(workDir: string, sessionId: string): CandidateManifest {
  const file = manifestPath(workDir, sessionId);
  if (!fs.existsSync(file)) return createEmptyManifest(sessionId);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const result = CandidateManifestSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Candidate manifest is corrupt: ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  return result.data;
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
  const target = manifestPath(workDir, sessionId);
  const temporary = `${target}.tmp`;
  const fd = fs.openSync(temporary, 'w');
  try {
    fs.writeFileSync(fd, JSON.stringify(validated, null, 2), 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, target);
}

export function sha256File(filePath: string) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
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
  return hash.digest('hex');
}

function assertNoReparsePoint(filePath: string) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink()) throw new Error('Symbolic links are not allowed for candidate files');
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
  if (!registeredPaths.some(item => path.resolve(item) === resolved)) {
    throw new Error('File is not registered in the candidate manifest');
  }
  const parent = path.dirname(resolved);
  const realParent = fs.realpathSync.native(parent);
  if (realParent !== realSessionDir && !realParent.startsWith(realSessionDir + path.sep)) {
    throw new Error('Candidate path escapes the session directory');
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
    throw new Error(`INSUFFICIENT_STORAGE: requires ${required} bytes with safety margin, ${available} available`);
  }
}

export function nextCandidateIdentity(manifest: CandidateManifest) {
  if (manifest.candidates.length >= MAX_COMPLETE_CANDIDATES) {
    throw new Error(`Candidate limit reached (${MAX_COMPLETE_CANDIDATES})`);
  }
  const version = manifest.candidates.length + 1;
  return {
    candidateVersion: version,
    candidateId: `candidate-${String(version).padStart(3, '0')}`,
  };
}

export function registerCandidate(
  workDir: string,
  sessionId: string,
  candidate: RenderCandidate,
) {
  const manifest = readCandidateManifest(workDir, sessionId);
  if (manifest.candidates.some(item => item.candidateId === candidate.candidateId)) {
    return manifest;
  }
  if (manifest.candidates.length >= MAX_COMPLETE_CANDIDATES) {
    throw new Error(`Candidate limit reached (${MAX_COMPLETE_CANDIDATES})`);
  }
  const next: CandidateManifest = {
    ...manifest,
    candidates: [...manifest.candidates, candidate],
    updatedAt: new Date().toISOString(),
  };
  writeCandidateManifestAtomic(workDir, sessionId, next);
  return next;
}

export function applyCandidateReview(
  workDir: string,
  sessionId: string,
  review: QualityReview,
) {
  const manifest = readCandidateManifest(workDir, sessionId);
  const index = manifest.candidates.findIndex(item => item.candidateId === review.candidateId);
  if (index < 0) throw new Error('Reviewed candidate is not registered');
  const candidates = manifest.candidates.slice();
  candidates[index] = {
    ...candidates[index],
    metrics: {
      emotionalArc: review.emotionalArc,
      transitionSmoothness: review.transitionSmoothness,
      performerIdentity: review.performerIdentity,
      overallScore: review.overallScore,
    },
    reviewStatus: review.approved ? 'approved' : 'changes_requested',
    warnings: [...new Set([...candidates[index].warnings, ...review.warnings, ...review.blockingIssues])],
  };
  const selected = chooseBestCandidate(candidates);
  const next: CandidateManifest = {
    ...manifest,
    candidates,
    selectedCandidateId: selected?.candidateId ?? null,
    updatedAt: new Date().toISOString(),
  };
  writeCandidateManifestAtomic(workDir, sessionId, next);
  return next;
}

export function promoteCandidate(
  workDir: string,
  sessionId: string,
  candidateId: string,
) {
  const manifest = readCandidateManifest(workDir, sessionId);
  if (
    manifest.finalizedCandidateId === candidateId &&
    manifest.finalOutputPath &&
    fs.existsSync(manifest.finalOutputPath)
  ) {
    return { manifest, finalPath: manifest.finalOutputPath, idempotent: true };
  }
  const candidate = manifest.candidates.find(item => item.candidateId === candidateId);
  if (!candidate || !candidate.technicallyValid) {
    throw new Error('Candidate is missing or technically invalid');
  }
  const registered = manifest.candidates.flatMap(item => [
    item.outputPath,
    ...item.debugPaths,
    ...item.previewPaths,
  ]);
  const source = assertRegisteredSafeFile(workDir, sessionId, candidate.outputPath, registered);
  if (!fs.existsSync(source)) throw new Error('Candidate file is missing');
  const sizeBytes = fs.statSync(source).size;
  const sourceHash = sha256File(source);
  if (sizeBytes !== candidate.sizeBytes || sourceHash !== candidate.sha256) {
    throw new Error('Candidate integrity check failed');
  }
  const sessionDir = getSessionDirectory(workDir, sessionId);
  const partPath = path.join(sessionDir, 'medley_final.mp3.part');
  const finalPath = path.join(sessionDir, 'medley_final.mp3');
  fs.copyFileSync(source, partPath);
  const copiedSize = fs.statSync(partPath).size;
  const copiedHash = sha256File(partPath);
  if (copiedSize !== sizeBytes || copiedHash !== sourceHash) {
    fs.rmSync(partPath, { force: true });
    throw new Error('Final copy integrity check failed');
  }
  fs.renameSync(partPath, finalPath);
  const next: CandidateManifest = {
    ...manifest,
    selectedCandidateId: candidateId,
    finalizedCandidateId: candidateId,
    finalOutputPath: finalPath,
    updatedAt: new Date().toISOString(),
  };
  writeCandidateManifestAtomic(workDir, sessionId, next);
  return { manifest: next, finalPath, idempotent: false };
}

export function cleanupRejectedCandidates(workDir: string, sessionId: string) {
  const manifest = readCandidateManifest(workDir, sessionId);
  const selected = manifest.finalizedCandidateId;
  for (const candidate of manifest.candidates) {
    if (candidate.candidateId === selected) continue;
    const registered = [candidate.outputPath, ...candidate.debugPaths, ...candidate.previewPaths];
    for (const filePath of registered) {
      try {
        const safe = assertRegisteredSafeFile(workDir, sessionId, filePath, registered);
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
    ...manifest.candidates.flatMap(candidate => [
      candidate.outputPath,
      ...candidate.debugPaths,
      ...candidate.previewPaths,
    ]),
    ...additionalRegisteredPaths,
  ];
  for (const filePath of registered) {
    if (historyProtected && path.resolve(filePath) === path.resolve(historyProtected)) continue;
    try {
      const safe = assertRegisteredSafeFile(workDir, sessionId, filePath, registered);
      fs.rmSync(safe, { force: true });
    } catch {
      // Idempotent discard tolerates already missing files.
    }
  }
  if (fs.existsSync(sessionDir)) {
    for (const name of fs.readdirSync(sessionDir)) {
      if (!name.endsWith('.part')) continue;
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
