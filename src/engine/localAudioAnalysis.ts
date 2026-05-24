import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { createRequire } from 'module';
import ffmpegPath from 'ffmpeg-static';
import MusicTempo from 'music-tempo';
import { buildTrackIntelligence } from './medleyIntelligence';

const require = createRequire(import.meta.url);
const ANALYZER_VERSION = 'local-analysis-v2.0.0';
const TARGET_SAMPLE_RATE = 44100;
const FRAME_SIZE = 2048;
const SPECTRAL_HOP_SEC = 0.5;

export interface LocalAnalysisV2 {
  schemaVersion: 'local_audio_analysis_v2';
  analyzerVersion: string;
  createdAt: string;
  fileHash: string;
  advancedAnalysisAvailable: boolean;
  fallbackUsed: boolean;
  engines: {
    ffmpeg: boolean;
    musicTempo: boolean;
    essentiaJs: boolean;
    internalDsp: boolean;
  };
  beatGrid: {
    bpm: number | null;
    confidence: number;
    beats: number[];
    downbeats: number[];
    tempoSegments: Array<{ startSec: number; endSec: number; bpm: number; confidence: number }>;
    warnings: string[];
  };
  onsets: {
    times: number[];
    strongTimes: number[];
    densityPerMinute: number;
    densityWindows: Array<{ startSec: number; endSec: number; density: number; strongCount: number }>;
    confidence: number;
    warnings: string[];
  };
  spectral: {
    centroidHz: { average: number; min: number; max: number; confidence: number };
    rolloffHz: { average: number; min: number; max: number; confidence: number };
    flatness: { average: number; confidence: number };
    flux: { average: number; peak: number; confidence: number };
    brightness: { average: number; confidence: number };
    density: { average: number; confidence: number };
  };
  tonal: {
    chroma: number[];
    keyEstimate: string | null;
    scale: 'major' | 'minor' | null;
    confidence: number;
    source: 'internal_chroma' | 'essentia' | 'unavailable';
    warnings: string[];
  };
  loudness: {
    rmsWindows: Array<{ startSec: number; endSec: number; rms: number; peak: number }>;
    integratedRms: number;
    peak: number;
    dynamicRange: number;
    confidence: number;
  };
  segments: Array<{
    startSec: number;
    endSec: number;
    labels: Array<
      | 'intro_candidate'
      | 'first_strong_entrance'
      | 'chorus_like_candidate'
      | 'breakdown_or_reset_candidate'
      | 'pre_finale_build_candidate'
      | 'finale_candidate'
      | 'clean_exit_candidate'
      | 'beat_aligned_candidate'
    >;
    confidence: number;
    reason: string;
    beatAligned: boolean;
    nearestBeatSec: number | null;
    energy: number;
    spectralBrightness: number;
    onsetDensity: number;
    warnings: string[];
  }>;
  quality: {
    clippingRisk: number;
    lowSignalRisk: number;
    warnings: string[];
  };
}

interface BasicAnalysis {
  source: string;
  duration: number;
  bitrate: number | null;
  sampleRate: number | null;
  meanVolumeDb: number | null;
  maxVolumeDb: number | null;
  silence: Array<{ start?: number; end?: number; duration?: number }>;
  estimatedBpm: number | null;
  energyCurve: number[];
  candidateSections: Array<{ start: number; end: number; energy: number }>;
  localAnalysisV2: LocalAnalysisV2;
}

function round(value: number, places = 3) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const avg = average(values);
  return Math.sqrt(average(values.map(value => (value - avg) ** 2)));
}

function minMaxAverage(values: number[]) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return { average: 0, min: 0, max: 0 };
  return {
    average: round(average(finite)),
    min: round(Math.min(...finite)),
    max: round(Math.max(...finite))
  };
}

function execFfmpeg(args: string[], timeout = 30000): Promise<string> {
  return new Promise(resolve => {
    execFile(ffmpegPath!, args, { timeout, windowsHide: true }, (_err, stdout, stderr) => {
      resolve(`${stdout || ''}${stderr || ''}`);
    });
  });
}

function parseDuration(output: string) {
  const match = output.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
  if (!match) return 0;
  return parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]) + parseInt(match[4]) / 100;
}

function extractNumber(output: string, pattern: RegExp) {
  const match = output.match(pattern);
  return match ? Number(match[1]) : null;
}

function parseSilences(output: string) {
  const events: Array<{ start?: number; end?: number; duration?: number }> = [];
  let active: { start?: number; end?: number; duration?: number } | null = null;

  for (const line of output.split(/\r?\n/)) {
    const start = line.match(/silence_start:\s*([\d.]+)/);
    if (start) {
      active = { start: Number(start[1]) };
      continue;
    }

    const end = line.match(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/);
    if (end) {
      events.push({ ...(active || {}), end: Number(end[1]), duration: Number(end[2]) });
      active = null;
    }
  }

  return events.slice(0, 40);
}

function readFloat32File(filePath: string) {
  const raw = fs.readFileSync(filePath);
  return new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4));
}

function hashFile(filePath: string) {
  const hash = crypto.createHash('sha1');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    let bytes = 0;
    while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytes));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

async function decodeMonoFloat(filePath: string, workDir: string) {
  const pcmPath = path.join(workDir, `analysis_v2_${crypto.randomUUID()}.f32`);
  try {
    await execFfmpeg([
      '-y',
      '-hide_banner',
      '-i', filePath,
      '-ac', '1',
      '-ar', String(TARGET_SAMPLE_RATE),
      '-f', 'f32le',
      '-acodec', 'pcm_f32le',
      pcmPath
    ], 90000);
    if (!fs.existsSync(pcmPath)) return new Float32Array();
    return readFloat32File(pcmPath);
  } finally {
    try { if (fs.existsSync(pcmPath)) fs.unlinkSync(pcmPath); } catch (_e) {}
  }
}

function computeEnergy(raw: Float32Array, duration: number) {
  if (raw.length < 2 || duration <= 0) {
    return { energyCurve: [] as number[], candidateSections: [] as Array<{ start: number; end: number; energy: number }> };
  }

  const frameCount = 120;
  const frameSize = Math.max(1, Math.floor(raw.length / frameCount));
  const energies: number[] = [];

  for (let i = 0; i < frameCount && i * frameSize < raw.length; i++) {
    let sumSquares = 0;
    let peak = 0;
    const start = i * frameSize;
    const end = Math.min(raw.length, start + frameSize);
    for (let j = start; j < end; j++) {
      const abs = Math.abs(raw[j]);
      peak = Math.max(peak, abs);
      sumSquares += abs * abs;
    }
    const rms = Math.sqrt(sumSquares / Math.max(1, end - start));
    energies.push(Math.max(rms, peak * 0.65));
  }

  const maxEnergy = Math.max(...energies, 0.0001);
  const normalized = energies.map(value => Math.round((value / maxEnergy) * 100));
  const frameSeconds = duration / normalized.length;
  const sections = normalized
    .map((energy, index) => ({
      start: Math.max(0, Number((index * frameSeconds).toFixed(1))),
      end: Number(((index + 1) * frameSeconds).toFixed(1)),
      energy
    }))
    .filter(section => section.energy >= 75)
    .sort((a, b) => b.energy - a.energy)
    .slice(0, 8)
    .sort((a, b) => a.start - b.start);

  return { energyCurve: normalized, candidateSections: sections };
}

function hanning(size: number) {
  return Array.from({ length: size }, (_, index) => 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (size - 1)));
}

function fftMagnitude(samples: number[]) {
  const n = samples.length;
  const real = samples.slice();
  const imag = new Array(n).fill(0);

  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wlenReal = Math.cos(angle);
    const wlenImag = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wReal = 1;
      let wImag = 0;
      for (let j = 0; j < len / 2; j++) {
        const uReal = real[i + j];
        const uImag = imag[i + j];
        const vReal = real[i + j + len / 2] * wReal - imag[i + j + len / 2] * wImag;
        const vImag = real[i + j + len / 2] * wImag + imag[i + j + len / 2] * wReal;
        real[i + j] = uReal + vReal;
        imag[i + j] = uImag + vImag;
        real[i + j + len / 2] = uReal - vReal;
        imag[i + j + len / 2] = uImag - vImag;
        const nextReal = wReal * wlenReal - wImag * wlenImag;
        wImag = wReal * wlenImag + wImag * wlenReal;
        wReal = nextReal;
      }
    }
  }

  return real.slice(0, n / 2).map((value, index) => Math.sqrt(value * value + imag[index] * imag[index]));
}

function spectralStats(magnitudes: number[], sampleRate: number) {
  const nyquist = sampleRate / 2;
  const binHz = nyquist / Math.max(1, magnitudes.length);
  const total = magnitudes.reduce((sum, value) => sum + value, 0) || 1e-12;
  const centroid = magnitudes.reduce((sum, value, index) => sum + value * index * binHz, 0) / total;
  let cumulative = 0;
  let rolloff = 0;
  for (let i = 0; i < magnitudes.length; i++) {
    cumulative += magnitudes[i];
    if (cumulative >= total * 0.85) {
      rolloff = i * binHz;
      break;
    }
  }
  const nonzero = magnitudes.map(value => Math.max(value, 1e-12));
  const flatness = Math.exp(average(nonzero.map(Math.log))) / average(nonzero);
  return { centroid, rolloff, flatness };
}

function pitchClassForFrequency(freq: number) {
  if (freq < 80 || freq > 5000) return null;
  const midi = Math.round(69 + 12 * Math.log2(freq / 440));
  return ((midi % 12) + 12) % 12;
}

function analyzeSpectral(raw: Float32Array, duration: number) {
  const hop = Math.max(1, Math.floor(TARGET_SAMPLE_RATE * SPECTRAL_HOP_SEC));
  const window = hanning(FRAME_SIZE);
  const centroids: number[] = [];
  const rolloffs: number[] = [];
  const flatnesses: number[] = [];
  const fluxes: number[] = [];
  const chroma = new Array(12).fill(0);
  let previous: number[] | null = null;

  for (let offset = 0; offset + FRAME_SIZE < raw.length; offset += hop) {
    const frame = new Array(FRAME_SIZE);
    for (let i = 0; i < FRAME_SIZE; i++) frame[i] = raw[offset + i] * window[i];
    const magnitudes = fftMagnitude(frame);
    const stats = spectralStats(magnitudes, TARGET_SAMPLE_RATE);
    centroids.push(stats.centroid);
    rolloffs.push(stats.rolloff);
    flatnesses.push(stats.flatness);

    const norm = magnitudes.map(value => value / (Math.max(...magnitudes) || 1));
    if (previous) {
      fluxes.push(Math.sqrt(average(norm.map((value, index) => Math.max(0, value - previous![index]) ** 2))));
    }
    previous = norm;

    const binHz = (TARGET_SAMPLE_RATE / 2) / Math.max(1, magnitudes.length);
    for (let i = 1; i < magnitudes.length; i++) {
      const pitchClass = pitchClassForFrequency(i * binHz);
      if (pitchClass !== null) chroma[pitchClass] += magnitudes[i];
    }
  }

  const centroidStats = minMaxAverage(centroids);
  const rolloffStats = minMaxAverage(rolloffs);
  const fluxAverage = average(fluxes);
  const fluxPeak = Math.max(...fluxes, 0);
  const brightness = clamp01(centroidStats.average / 4500 * 0.7 + rolloffStats.average / 11000 * 0.3);
  const density = clamp01(fluxAverage * 3 + average(flatnesses) * 0.4);
  const chromaMax = Math.max(...chroma, 1e-12);
  const normalizedChroma = chroma.map(value => round(value / chromaMax));

  return {
    centroidStats,
    rolloffStats,
    flatnessAverage: round(average(flatnesses)),
    fluxAverage: round(fluxAverage),
    fluxPeak: round(fluxPeak),
    brightness: round(brightness),
    density: round(density),
    chroma: normalizedChroma,
    frameCount: centroids.length,
    confidence: duration > 0 && centroids.length >= 8 ? 0.72 : 0.25,
    fluxes
  };
}

function estimateKey(chroma: number[]) {
  const keys = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const major = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const minor = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  const scores: Array<{ key: string; scale: 'major' | 'minor'; score: number }> = [];
  const centeredChroma = chroma.map(value => value - average(chroma));

  for (let root = 0; root < 12; root++) {
    for (const [scale, profile] of [['major', major], ['minor', minor]] as const) {
      const centeredProfile = profile.map(value => value - average(profile));
      const score = centeredChroma.reduce((sum, value, index) => {
        const profileIndex = (index - root + 12) % 12;
        return sum + value * centeredProfile[profileIndex];
      }, 0);
      scores.push({ key: keys[root], scale, score });
    }
  }

  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  const second = scores[1];
  const confidence = clamp01((best.score - second.score) / (Math.abs(best.score) + 1e-6));
  if (!best || confidence < 0.08) return { keyEstimate: null, scale: null, confidence: 0.12 };
  return {
    keyEstimate: `${best.key} ${best.scale}`,
    scale: best.scale,
    confidence: round(Math.min(0.72, confidence + 0.18))
  };
}

function estimateTempo(raw: Float32Array) {
  try {
    if (raw.length < TARGET_SAMPLE_RATE * 5) return { bpm: null, beats: [] as number[], confidence: 0, source: 'unavailable' };
    const limit = raw.length > TARGET_SAMPLE_RATE * 360 ? raw.slice(0, TARGET_SAMPLE_RATE * 360) : raw;
    const detector = new MusicTempo(limit, {
      minBeatInterval: 0.3,
      maxBeatInterval: 1.2,
      expiryTime: 20,
      maxTempos: 12
    });
    const tempo = Number(detector.tempo);
    const beats = Array.isArray(detector.beats) ? detector.beats.filter((beat: number) => Number.isFinite(beat) && beat >= 0) : [];
    if (!Number.isFinite(tempo) || tempo <= 0) return { bpm: null, beats: [], confidence: 0.1, source: 'music-tempo' };
    const intervalStd = beats.length > 3 ? standardDeviation(beats.slice(1).map((beat, index) => beat - beats[index])) : 1;
    const confidence = clamp01(0.35 + Math.min(beats.length, 80) / 160 + Math.max(0, 0.3 - intervalStd) * 0.6);
    return { bpm: Math.round(tempo), beats: beats.slice(0, 600).map(beat => round(beat, 3)), confidence: round(confidence), source: 'music-tempo' };
  } catch (_e) {
    return { bpm: null, beats: [] as number[], confidence: 0, source: 'music-tempo_failed' };
  }
}

function findOnsets(fluxes: number[], duration: number) {
  if (!fluxes.length || duration <= 0) return { times: [] as number[], strongTimes: [] as number[], confidence: 0 };
  const mean = average(fluxes);
  const std = standardDeviation(fluxes);
  const threshold = mean + std * 0.85;
  const strongThreshold = mean + std * 1.45;
  const frameSec = duration / Math.max(1, fluxes.length);
  const times: number[] = [];
  const strongTimes: number[] = [];
  let lastTime = -1;

  for (let i = 1; i < fluxes.length - 1; i++) {
    const isPeak = fluxes[i] >= fluxes[i - 1] && fluxes[i] >= fluxes[i + 1] && fluxes[i] >= threshold;
    const time = i * frameSec;
    if (isPeak && time - lastTime >= 0.12) {
      times.push(round(time, 3));
      lastTime = time;
      if (fluxes[i] >= strongThreshold) strongTimes.push(round(time, 3));
    }
  }

  return {
    times: times.slice(0, 500),
    strongTimes: strongTimes.slice(0, 250),
    confidence: round(clamp01(0.35 + Math.min(times.length, 120) / 240))
  };
}

function buildDensityWindows(onsetTimes: number[], duration: number) {
  const windowSec = 15;
  const windows: Array<{ startSec: number; endSec: number; density: number; strongCount: number }> = [];
  for (let start = 0; start < duration; start += windowSec) {
    const end = Math.min(duration, start + windowSec);
    const count = onsetTimes.filter(time => time >= start && time < end).length;
    windows.push({
      startSec: round(start, 1),
      endSec: round(end, 1),
      density: round(count / Math.max(1, (end - start) / 60)),
      strongCount: count
    });
  }
  return windows;
}

function buildRmsWindows(raw: Float32Array, duration: number) {
  const windowSec = 5;
  const samplesPerWindow = Math.max(1, Math.floor(TARGET_SAMPLE_RATE * windowSec));
  const windows: Array<{ startSec: number; endSec: number; rms: number; peak: number }> = [];
  let globalPeak = 0;
  let sumSquares = 0;

  for (let start = 0; start < raw.length; start += samplesPerWindow) {
    const end = Math.min(raw.length, start + samplesPerWindow);
    let localSquares = 0;
    let localPeak = 0;
    for (let i = start; i < end; i++) {
      const abs = Math.abs(raw[i]);
      localPeak = Math.max(localPeak, abs);
      globalPeak = Math.max(globalPeak, abs);
      localSquares += abs * abs;
      sumSquares += abs * abs;
    }
    windows.push({
      startSec: round(start / TARGET_SAMPLE_RATE, 1),
      endSec: round(Math.min(duration, end / TARGET_SAMPLE_RATE), 1),
      rms: round(Math.sqrt(localSquares / Math.max(1, end - start))),
      peak: round(localPeak)
    });
  }

  const integratedRms = Math.sqrt(sumSquares / Math.max(1, raw.length));
  const rmsValues = windows.map(window => window.rms);
  return {
    windows,
    integratedRms: round(integratedRms),
    peak: round(globalPeak),
    dynamicRange: round(Math.max(...rmsValues, 0) - Math.min(...rmsValues, 0))
  };
}

function nearestBeat(time: number, beats: number[]) {
  if (!beats.length) return { time: null as number | null, distance: Infinity };
  let best = beats[0];
  let distance = Math.abs(time - best);
  for (const beat of beats) {
    const nextDistance = Math.abs(time - beat);
    if (nextDistance < distance) {
      best = beat;
      distance = nextDistance;
    }
  }
  return { time: round(best, 3), distance };
}

function tempoSegments(beats: number[], duration: number) {
  if (beats.length < 8) return [];
  const segments: Array<{ startSec: number; endSec: number; bpm: number; confidence: number }> = [];
  const windowBeats = 16;
  for (let i = 0; i + windowBeats < beats.length; i += windowBeats) {
    const slice = beats.slice(i, i + windowBeats);
    const intervals = slice.slice(1).map((beat, index) => beat - slice[index]).filter(value => value > 0);
    const bpm = Math.round(60 / average(intervals));
    segments.push({
      startSec: round(slice[0], 1),
      endSec: round(Math.min(duration, slice[slice.length - 1]), 1),
      bpm,
      confidence: round(clamp01(0.75 - standardDeviation(intervals)))
    });
  }
  return segments.slice(0, 24);
}

function buildSegments(input: {
  duration: number;
  energySections: Array<{ start: number; end: number; energy: number }>;
  silence: Array<{ start?: number; end?: number; duration?: number }>;
  beats: number[];
  densityWindows: Array<{ startSec: number; endSec: number; density: number; strongCount: number }>;
  spectralBrightness: number;
}) {
  const { duration, energySections, silence, beats, densityWindows, spectralBrightness } = input;
  const segments: LocalAnalysisV2['segments'] = [];
  const addSegment = (
    startSec: number,
    endSec: number,
    labels: LocalAnalysisV2['segments'][number]['labels'],
    confidence: number,
    reason: string,
    energy: number,
    warnings: string[] = []
  ) => {
    const startBeat = nearestBeat(startSec, beats);
    const endBeat = nearestBeat(endSec, beats);
    const beatAligned = startBeat.distance <= 0.12 || endBeat.distance <= 0.12;
    const density = average(densityWindows.filter(window => window.startSec < endSec && window.endSec > startSec).map(window => window.density));
    segments.push({
      startSec: round(startBeat.distance <= 0.18 && startBeat.time !== null ? startBeat.time : startSec, 1),
      endSec: round(endBeat.distance <= 0.18 && endBeat.time !== null ? endBeat.time : endSec, 1),
      labels: beatAligned ? Array.from(new Set([...labels, 'beat_aligned_candidate'])) : labels,
      confidence: round(beatAligned ? Math.min(1, confidence + 0.08) : confidence),
      reason,
      beatAligned,
      nearestBeatSec: startBeat.time,
      energy,
      spectralBrightness,
      onsetDensity: round(density || 0),
      warnings
    });
  };

  if (duration > 0) {
    addSegment(0, Math.min(duration, Math.max(12, duration * 0.1)), ['intro_candidate'], 0.68, 'Opening span from file start; useful as a controlled entry candidate.', 45);
    addSegment(Math.max(0, duration - Math.max(12, duration * 0.1)), duration, ['clean_exit_candidate'], 0.68, 'Ending span from file end; useful as a clean exit/outro candidate.', 45);
  }

  const strongest = [...energySections].sort((a, b) => b.energy - a.energy);
  for (const [index, section] of strongest.slice(0, 8).entries()) {
    const labels: LocalAnalysisV2['segments'][number]['labels'] = ['chorus_like_candidate'];
    if (index === 0 || section.start > duration * 0.58) labels.push('finale_candidate');
    if (section.start > duration * 0.45 && section.energy >= 85) labels.push('pre_finale_build_candidate');
    if (section.start < duration * 0.25 && section.energy >= 82) labels.push('first_strong_entrance');
    addSegment(
      section.start,
      Math.min(duration || section.end, Math.max(section.end, section.start + 12)),
      labels,
      0.62 + clamp01(section.energy / 100) * 0.22,
      'High local energy plus spectral/onset support; chorus/hook label is heuristic, not lyric-confirmed.',
      section.energy,
      ['section_label_is_heuristic']
    );
  }

  for (const silenceRegion of silence) {
    if (silenceRegion.start === undefined || silenceRegion.end === undefined || (silenceRegion.duration || 0) < 0.45) continue;
    addSegment(
      Math.max(0, silenceRegion.start - 4),
      Math.min(duration, silenceRegion.end + 4),
      ['breakdown_or_reset_candidate'],
      0.76,
      'Silence-adjacent span can work as a reset or transition moment.',
      20,
      []
    );
  }

  return segments
    .filter(segment => segment.endSec > segment.startSec)
    .sort((a, b) => a.startSec - b.startSec)
    .slice(0, 18);
}

function tryEssentia(raw: Float32Array) {
  try {
    const { Essentia, EssentiaWASM } = require('essentia.js') as any;
    const essentia = new Essentia(EssentiaWASM);
    const signal = essentia.arrayToVector(raw.length > TARGET_SAMPLE_RATE * 180 ? raw.slice(0, TARGET_SAMPLE_RATE * 180) : raw);
    const version = String(essentia.version || 'unknown');
    try {
      const tonal = essentia.TonalExtractor(signal, 4096, 2048, 440);
      return { available: true, version, tonal };
    } catch (_e) {
      return { available: true, version, tonal: null };
    }
  } catch (_e) {
    return { available: false, version: null, tonal: null };
  }
}

function buildAnalysisText(analysis: BasicAnalysis, medleyIntelligence: ReturnType<typeof buildTrackIntelligence>) {
  const v2 = analysis.localAnalysisV2;
  return [
    'Local analysis only. No audio was sent to an AI provider.',
    `Analyzer: ${v2.schemaVersion} (${v2.analyzerVersion}); advanced local analysis ${v2.advancedAnalysisAvailable ? 'available' : 'fell back to basic mode'}.`,
    'Layer 1 local facts: duration, sample rate, bitrate, loudness, silence, tempo estimate, beat grid, onset density, spectral descriptors, and key estimate.',
    'Layer 2 heuristic guesses: hook/entry/exit/reset/finale/chorus-like candidates are guesses with confidence and warnings.',
    'Layer 3 scoring/ranking: medley usefulness scores are local heuristics, not musical facts.',
    `Duration: ${analysis.duration ? `${analysis.duration.toFixed(1)}s` : 'unknown'}`,
    `Technical: ${analysis.sampleRate || 'unknown'} Hz, ${analysis.bitrate || 'unknown'} kbps`,
    `Volume: mean ${analysis.meanVolumeDb ?? 'unknown'} dB, max ${analysis.maxVolumeDb ?? 'unknown'} dB`,
    `Estimated BPM: ${analysis.estimatedBpm ?? 'unknown'} (beat confidence ${Math.round(v2.beatGrid.confidence * 100)}%)`,
    `Estimated key: ${v2.tonal.keyEstimate ?? 'unknown'} (confidence ${Math.round(v2.tonal.confidence * 100)}%; estimate only)`,
    `Spectral: centroid ${Math.round(v2.spectral.centroidHz.average)} Hz, rolloff ${Math.round(v2.spectral.rolloffHz.average)} Hz, brightness ${Math.round(v2.spectral.brightness.average * 100)}%, flux ${Math.round(v2.spectral.flux.average * 100)}%`,
    `Onsets: ${v2.onsets.times.length} detected, ${v2.onsets.strongTimes.length} strong, density ${v2.onsets.densityPerMinute}/min`,
    `Beat-snapped candidate sections: ${v2.segments.length ? v2.segments.slice(0, 8).map(s => `${s.startSec.toFixed(1)}-${s.endSec.toFixed(1)}s ${s.labels[0]} (${Math.round(s.confidence * 100)}%)`).join(', ') : 'none detected'}`,
    `Silence regions: ${analysis.silence.length ? analysis.silence.map(s => `${s.start?.toFixed(1) ?? '?'}-${s.end?.toFixed(1) ?? '?'}s`).slice(0, 8).join(', ') : 'none detected'}`,
    `Top hook candidates: ${medleyIntelligence.rankedHookCandidates.length ? medleyIntelligence.rankedHookCandidates.slice(0, 3).map(s => `${s.sectionId} (${Math.round(s.scores.hookStrength * 100)}%, confidence ${Math.round(s.confidence * 100)}%)`).join(', ') : 'none'}`,
    `Top entry candidates: ${medleyIntelligence.rankedEntryCandidates.length ? medleyIntelligence.rankedEntryCandidates.slice(0, 3).map(s => `${s.sectionId} (${Math.round(s.scores.entryQuality * 100)}%)`).join(', ') : 'none'}`,
    `Top exit candidates: ${medleyIntelligence.rankedExitCandidates.length ? medleyIntelligence.rankedExitCandidates.slice(0, 3).map(s => `${s.sectionId} (${Math.round(s.scores.exitQuality * 100)}%)`).join(', ') : 'none'}`,
    'Key, chorus, hook, and mood labels are estimates unless confirmed by user notes or explicitly allowed cloud listening.'
  ].join('\n');
}

export async function analyzeLocalAudioFile(input: {
  filePath: string;
  workDir: string;
  trackId?: string;
  filename?: string;
}) {
  const { filePath, workDir } = input;
  const probeOutput = await execFfmpeg(['-hide_banner', '-i', filePath, '-f', 'null', '-'], 15000);
  const duration = parseDuration(probeOutput);
  const bitrate = extractNumber(probeOutput, /bitrate:\s*(\d+)\s*kb\/s/);
  const sampleRate = extractNumber(probeOutput, /(\d+)\s*Hz/);
  const volumeOutput = await execFfmpeg(['-hide_banner', '-i', filePath, '-af', 'volumedetect', '-f', 'null', '-'], 30000);
  const silenceOutput = await execFfmpeg(['-hide_banner', '-i', filePath, '-af', 'silencedetect=noise=-35dB:d=0.35', '-f', 'null', '-'], 30000);
  const silence = parseSilences(silenceOutput);
  const raw = await decodeMonoFloat(filePath, workDir);
  const energy = computeEnergy(raw, duration);
  const tempo = estimateTempo(raw);
  const spectral = analyzeSpectral(raw, duration);
  const onsets = findOnsets(spectral.fluxes, duration);
  const densityWindows = buildDensityWindows(onsets.times, duration);
  const rms = buildRmsWindows(raw, duration);
  const key = estimateKey(spectral.chroma);
  const essentia = tryEssentia(raw);
  const keyEstimate = key.keyEstimate;
  const tonalWarnings = [
    'key_is_local_chroma_estimate_not_confirmed_fact',
    key.confidence < 0.35 ? 'key_confidence_low' : ''
  ].filter(Boolean);
  const beatWarnings = [
    tempo.confidence < 0.45 ? 'beat_grid_confidence_low' : '',
    tempo.source === 'music-tempo_failed' ? 'music_tempo_failed' : ''
  ].filter(Boolean);
  const segments = buildSegments({
    duration,
    energySections: energy.candidateSections,
    silence,
    beats: tempo.beats,
    densityWindows,
    spectralBrightness: spectral.brightness
  });
  const clippingRisk = clamp01(rms.peak > 0.99 ? 0.9 : rms.peak > 0.94 ? 0.55 : 0.1);
  const lowSignalRisk = clamp01(rms.integratedRms < 0.015 ? 0.8 : rms.integratedRms < 0.035 ? 0.45 : 0.1);
  const v2: LocalAnalysisV2 = {
    schemaVersion: 'local_audio_analysis_v2',
    analyzerVersion: `${ANALYZER_VERSION}${essentia.available ? `+essentia-${essentia.version}` : ''}`,
    createdAt: new Date().toISOString(),
    fileHash: hashFile(filePath),
    advancedAnalysisAvailable: raw.length > 0 && spectral.frameCount > 0,
    fallbackUsed: raw.length === 0 || spectral.frameCount === 0,
    engines: {
      ffmpeg: true,
      musicTempo: tempo.source === 'music-tempo',
      essentiaJs: essentia.available,
      internalDsp: true
    },
    beatGrid: {
      bpm: tempo.bpm,
      confidence: tempo.confidence,
      beats: tempo.beats,
      downbeats: tempo.beats.filter((_beat, index) => index % 4 === 0).slice(0, 160),
      tempoSegments: tempoSegments(tempo.beats, duration),
      warnings: beatWarnings
    },
    onsets: {
      times: onsets.times,
      strongTimes: onsets.strongTimes,
      densityPerMinute: round(onsets.times.length / Math.max(1, duration / 60)),
      densityWindows,
      confidence: onsets.confidence,
      warnings: onsets.confidence < 0.4 ? ['onset_detection_confidence_low'] : []
    },
    spectral: {
      centroidHz: { ...spectral.centroidStats, confidence: spectral.confidence },
      rolloffHz: { ...spectral.rolloffStats, confidence: spectral.confidence },
      flatness: { average: spectral.flatnessAverage, confidence: spectral.confidence },
      flux: { average: spectral.fluxAverage, peak: spectral.fluxPeak, confidence: spectral.confidence },
      brightness: { average: spectral.brightness, confidence: spectral.confidence },
      density: { average: spectral.density, confidence: spectral.confidence }
    },
    tonal: {
      chroma: spectral.chroma,
      keyEstimate,
      scale: key.scale,
      confidence: key.confidence,
      source: 'internal_chroma',
      warnings: tonalWarnings
    },
    loudness: {
      rmsWindows: rms.windows.slice(0, 180),
      integratedRms: rms.integratedRms,
      peak: rms.peak,
      dynamicRange: rms.dynamicRange,
      confidence: raw.length ? 0.78 : 0
    },
    segments,
    quality: {
      clippingRisk: round(clippingRisk),
      lowSignalRisk: round(lowSignalRisk),
      warnings: [
        clippingRisk > 0.5 ? 'possible_clipping_or_limiter_ceiling' : '',
        lowSignalRisk > 0.5 ? 'low_signal_level' : '',
        'chorus_hook_and_key_labels_are_estimates'
      ].filter(Boolean)
    }
  };

  const analysis: BasicAnalysis = {
    source: 'local-ffmpeg-essentia-v2',
    duration,
    bitrate,
    sampleRate,
    meanVolumeDb: extractNumber(volumeOutput, /mean_volume:\s*(-?[\d.]+)\s*dB/),
    maxVolumeDb: extractNumber(volumeOutput, /max_volume:\s*(-?[\d.]+)\s*dB/),
    silence,
    estimatedBpm: tempo.bpm,
    energyCurve: energy.energyCurve,
    candidateSections: energy.candidateSections,
    localAnalysisV2: v2
  };
  const medleyIntelligence = buildTrackIntelligence({
    trackId: input.trackId || path.basename(filePath, path.extname(filePath)),
    filename: input.filename || path.basename(filePath),
    analysis
  });
  const analysisText = buildAnalysisText(analysis, medleyIntelligence);

  return { analysis, analysisText, medleyIntelligence };
}

/**
 * Analyzes an assembled medley file for professional quality metrics.
 * Focused on what actually matters for a good-sounding medley:
 * - Loudness compliance (EBU R128 style via loudnorm)
 * - True peak safety
 * - Basic dynamic range information
 * 
 * Designed for personal project use — pragmatic and informative rather than over-engineered.
 */
export async function analyzeMedleyQuality(filePath: string, workDir: string): Promise<{
  integratedLUFS: number | null;
  loudnessRange: number | null;
  truePeak: number | null;
  overallQualityNote: string;
  rawOutput?: string;
}> {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(workDir, filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Medley file not found for quality analysis: ${absolutePath}`);
  }

  // Use ffmpeg loudnorm in measurement mode (most reliable for this use case)
  const loudnormOutput = await execFfmpeg(
    [
      '-hide_banner',
      '-i', absolutePath,
      '-af', 'loudnorm=print_format=json',
      '-f', 'null',
      '-'
    ],
    180000
  );

  let stats: any = null;
  try {
    const jsonMatch = loudnormOutput.match(/\{[\s\S]*"input_i"[\s\S]*?\}/);
    if (jsonMatch) stats = JSON.parse(jsonMatch[0]);
  } catch (_) {
    // best effort
  }

  const integrated = stats?.input_i ? Number(stats.input_i) : null;
  const lra = stats?.input_lra ? Number(stats.input_lra) : null;
  const truePeak = stats?.input_tp ? Number(stats.input_tp) : null;

  let note = 'Quality analysis completed.';
  if (integrated !== null) {
    if (integrated > -11) note = 'Quite loud — watch for fatigue.';
    else if (integrated < -16) note = 'On the quiet side.';
    else note = 'Loudness in a comfortable modern range.';
  }
  if (truePeak !== null && truePeak > -0.8) {
    note += ' True peak is high — consider limiting.';
  }

  return {
    integratedLUFS: integrated !== null ? round(integrated, 2) : null,
    loudnessRange: lra !== null ? round(lra, 2) : null,
    truePeak: truePeak !== null ? round(truePeak, 2) : null,
    overallQualityNote: note,
    rawOutput: loudnormOutput
  };
}
