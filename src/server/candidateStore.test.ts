import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  cleanupRejectedCandidates,
  createEmptyManifest,
  discardAutomaticSessionFiles,
  nextCandidateIdentity,
  promoteCandidate,
  readCandidateManifest,
  registerCandidate,
  sha256File,
  writeCandidateManifestAtomic,
} from './candidateStore';
import type { RenderCandidate } from '../types/specialistWorkflow';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-medley-candidates-'));
const sessionId = 'session-test';
const sessionDir = path.join(root, sessionId);
fs.mkdirSync(sessionDir, { recursive: true });
writeCandidateManifestAtomic(root, sessionId, createEmptyManifest(sessionId));

function makeCandidate(version: number, contents: string, score: number): RenderCandidate {
  const outputPath = path.join(sessionDir, `candidate-${String(version).padStart(3, '0')}.mp3`);
  fs.writeFileSync(outputPath, contents);
  return {
    candidateId: `candidate-${String(version).padStart(3, '0')}`,
    candidateVersion: version,
    parentCandidateId: version > 1 ? `candidate-${String(version - 1).padStart(3, '0')}` : null,
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
    reviewStatus: version === 2 ? 'approved' : 'changes_requested',
    warnings: [],
    createdAt: new Date(version * 1000).toISOString(),
  };
}

registerCandidate(root, sessionId, makeCandidate(1, 'first candidate', 90));
registerCandidate(root, sessionId, makeCandidate(2, 'approved candidate', 80));
const manifest = readCandidateManifest(root, sessionId);
assert.equal(manifest.candidates.length, 2);

const promoted = promoteCandidate(root, sessionId, 'candidate-002');
assert.equal(fs.readFileSync(promoted.finalPath, 'utf8'), 'approved candidate');
assert.equal(sha256File(promoted.finalPath), manifest.candidates[1].sha256);
cleanupRejectedCandidates(root, sessionId);
assert.equal(fs.existsSync(manifest.candidates[0].outputPath), false);
assert.equal(fs.existsSync(promoted.finalPath), true);
assert.equal(promoteCandidate(root, sessionId, 'candidate-002').idempotent, true);

const tamperSession = 'tamper-test';
const tamperDir = path.join(root, tamperSession);
fs.mkdirSync(tamperDir, { recursive: true });
writeCandidateManifestAtomic(root, tamperSession, createEmptyManifest(tamperSession));
const tampered = makeCandidate(1, 'untampered', 80);
const tamperedPath = path.join(tamperDir, 'candidate-001.mp3');
fs.renameSync(tampered.outputPath, tamperedPath);
registerCandidate(root, tamperSession, {
  ...tampered,
  outputPath: tamperedPath,
  sizeBytes: fs.statSync(tamperedPath).size,
  sha256: sha256File(tamperedPath),
});
fs.appendFileSync(tamperedPath, 'changed');
assert.throws(() => promoteCandidate(root, tamperSession, 'candidate-001'), /integrity check failed/);

const limitSession = 'limit-test';
const limitDir = path.join(root, limitSession);
fs.mkdirSync(limitDir, { recursive: true });
writeCandidateManifestAtomic(root, limitSession, createEmptyManifest(limitSession));
for (let version = 1; version <= 3; version++) {
  const outputPath = path.join(limitDir, `candidate-${String(version).padStart(3, '0')}.mp3`);
  fs.writeFileSync(outputPath, `candidate ${version}`);
  registerCandidate(root, limitSession, {
    ...makeCandidate(version, `source ${version}`, 70 + version),
    outputPath,
    sizeBytes: fs.statSync(outputPath).size,
    sha256: sha256File(outputPath),
  });
}
assert.throws(() => nextCandidateIdentity(readCandidateManifest(root, limitSession)), /Candidate limit reached/);

const discardSession = 'discard-test';
const discardDir = path.join(root, discardSession);
fs.mkdirSync(discardDir, { recursive: true });
const previewPath = path.join(discardDir, 'transition-exec-001-test.mp3');
fs.writeFileSync(previewPath, 'preview');
discardAutomaticSessionFiles(root, discardSession, [previewPath]);
assert.equal(fs.existsSync(previewPath), false);

fs.rmSync(root, { recursive: true, force: true });
console.log('candidateStore tests passed');
