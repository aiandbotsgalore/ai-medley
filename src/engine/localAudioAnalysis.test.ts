import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { analyzeLocalAudioFile } from './localAudioAnalysis';

function writeTestWav(filePath: string) {
  const sampleRate = 44100;
  const durationSec = 12;
  const sampleCount = sampleRate * durationSec;
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < sampleCount; i++) {
    const t = i / sampleRate;
    const beatPulse = (t % 0.5) < 0.035 ? 0.75 * Math.exp(-(t % 0.5) * 38) : 0;
    const tone = Math.sin(2 * Math.PI * 220 * t) * 0.28 + Math.sin(2 * Math.PI * 440 * t) * 0.12;
    const lift = t > 6 ? 0.18 * Math.sin(2 * Math.PI * 880 * t) : 0;
    const value = Math.max(-0.95, Math.min(0.95, beatPulse + tone + lift));
    buffer.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
  }

  fs.writeFileSync(filePath, buffer);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-medley-local-analysis-'));
const wavPath = path.join(tempDir, 'analysis-test.wav');
writeTestWav(wavPath);

try {
  const result = await analyzeLocalAudioFile({
    filePath: wavPath,
    workDir: tempDir,
    trackId: 'test-track',
    filename: 'analysis-test.wav'
  });

  assert.equal(result.analysis.localAnalysisV2.schemaVersion, 'local_audio_analysis_v2');
  assert.equal(result.analysis.localAnalysisV2.engines.ffmpeg, true);
  assert.equal(result.analysis.localAnalysisV2.engines.internalDsp, true);
  assert.ok(result.analysis.duration >= 11.9 && result.analysis.duration <= 12.1);
  assert.ok(result.analysis.energyCurve.length > 0);
  assert.ok(result.analysis.localAnalysisV2.spectral.centroidHz.average > 0);
  assert.ok(result.analysis.localAnalysisV2.spectral.rolloffHz.average > 0);
  assert.ok(result.analysis.localAnalysisV2.spectral.brightness.confidence > 0);
  assert.ok(result.analysis.localAnalysisV2.onsets.densityPerMinute >= 0);
  assert.ok(result.analysis.localAnalysisV2.segments.length > 0);
  assert.ok(result.analysisText.includes('No audio was sent to an AI provider'));
  assert.ok(result.medleyIntelligence.localFacts.some(fact => fact.name === 'spectral_centroid'));
  assert.ok(result.medleyIntelligence.localFacts.some(fact => fact.name === 'beat_grid'));
  assert.ok(result.medleyIntelligence.sectionScores.every(score => typeof score.scores.beatAlignment === 'number'));
  assert.ok(JSON.stringify(result.analysis.localAnalysisV2).length < 500_000);

  console.log('localAudioAnalysis tests passed');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
