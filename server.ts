import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import { exec, execFile, spawn } from 'child_process';
import { createServer as createViteServer } from 'vite';
import ffmpegPath from 'ffmpeg-static';
import MusicTempo from 'music-tempo';
import { buildMedleyDesignPayload, buildTrackIntelligence, evaluateSectionPair } from './src/engine/medleyIntelligence';
import type { TrackIntelligence } from './src/engine/medleyIntelligence';
import { analyzeLocalAudioFile, analyzeMedleyQuality } from './src/engine/localAudioAnalysis';
import {
  ArrangementPlanSchema,
  AutomaticWorkflowCheckpointSchema,
  ExecutionReportSchema,
  ProjectBriefSchema,
  QualityReviewSchema,
  TransitionExecutionRequestSchema,
  formatValidationIssues,
  validateArrangementContext,
  validateExecutionContext,
  validateProjectBriefContext,
  validateTransitionExecutionContext,
  type ArrangementPlan,
  type SpecialistContext,
} from './src/types/specialistWorkflow';
import {
  applyCandidateReview,
  assertCandidateStorageAvailable,
  cleanupRejectedCandidates,
  discardAutomaticSessionFiles,
  getSessionDirectory,
  nextCandidateIdentity,
  promoteCandidate,
  readCandidateManifest,
  registerCandidate,
  sha256File,
  validateSessionId,
  withSessionLock,
  writeCandidateManifestAtomic,
} from './src/server/candidateStore';

dotenv.config();

const RENDER_CONFIG = {
  DEFAULT_TAIL_SEC: 30,
  MIN_TAIL_SEC: 5,
  MAX_TAIL_SEC: 60,
  FADE_OUT_SECONDS: 3.0,
  TIME_EPSILON: 1e-3,          // Prevents off-by-one boundary failures
  TIMING_TOLERANCE: 0.25,       // Clamp (not abort) for small float/metadata rounding overruns
  MAX_ERROR_LOG_LINES: 50,      // Prevents memory bloating on large logs
  SSE_HEARTBEAT_MS: 15000,      // Keeps proxy connections alive
  PROGRESS_RATE_LIMIT_MS: 250,  // Prevents UI thread thrashing
};

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Ensure working directory exists
const workDir = path.join(process.cwd(), 'workdir');
if (!fs.existsSync(workDir)) {
  fs.mkdirSync(workDir);
}

const libraryDir = path.join(process.cwd(), 'library');
const audioDir = path.join(libraryDir, 'audio');
const dbPath = path.join(libraryDir, 'db.json');
const historyPath = path.join(libraryDir, 'history.json');
const wisdomPath = path.join(libraryDir, 'wisdom.json');
const checkpointDir = path.join(libraryDir, 'checkpoints');

if (!fs.existsSync(libraryDir)) fs.mkdirSync(libraryDir);
if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir);
if (!fs.existsSync(checkpointDir)) fs.mkdirSync(checkpointDir);
if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify([]));
if (!fs.existsSync(historyPath)) fs.writeFileSync(historyPath, JSON.stringify([]));
if (!fs.existsSync(wisdomPath)) fs.writeFileSync(wisdomPath, JSON.stringify([]));

function isPathInside(childPath: string, parentPath: string) {
  const child = path.resolve(childPath).toLowerCase();
  const parent = path.resolve(parentPath).toLowerCase();
  return child === parent || child.startsWith(parent + path.sep);
}

function getServerGeneratedPreviewPath(sessionId: string, value: unknown) {
  if (typeof value !== 'string') return null;
  const sessionDir = getSessionDirectory(workDir, sessionId);
  const resolved = path.resolve(value);
  const name = path.basename(resolved);
  if (path.dirname(resolved) !== sessionDir) return null;
  if (!/^transition-exec-\d{3}-[a-zA-Z0-9_-]+\.mp3$/.test(name)) return null;
  return resolved;
}

function resolveReadableAudioPath(filePath: string, sessionId?: string) {
  const candidates = path.isAbsolute(filePath)
    ? [filePath]
    : [
        sessionId ? path.join(workDir, sessionId, filePath) : '',
        path.join(workDir, filePath),
        path.join(audioDir, filePath)
      ].filter(Boolean);

  return candidates
    .map(candidate => path.resolve(candidate))
    .find(candidate => {
      const allowed = isPathInside(candidate, workDir) || isPathInside(candidate, libraryDir);
      return allowed && fs.existsSync(candidate);
    }) || null;
}

function findSessionAudioPath(sessionId: string) {
  const historyEntry = getHistory().find((entry: any) => entry.id === sessionId);
  const session = sessions[sessionId];
  const candidates = [
    session?.finalAudioPath,
    historyEntry?.finalAudioPath
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const resolved = resolveReadableAudioPath(candidate, sessionId);
    if (resolved) {
      if (!sessions[sessionId]) {
        sessions[sessionId] = {
          status: 'completed',
          logs: [],
          finalAudioPath: resolved,
          summary: historyEntry?.summary,
          metrics: historyEntry?.metrics
        };
      } else {
        sessions[sessionId].finalAudioPath = resolved;
      }
      return resolved;
    }
  }

  return null;
}

function downloadFilenameFor(audioPath: string, sessionId: string) {
  const base = path.basename(audioPath).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
  if (base && path.extname(base)) return base;
  return `medley-${sessionId}.mp3`;
}

function retargetTrackIntelligence(intelligence: any, trackId: string, filename: string) {
  const oldTrackId = intelligence.profile.trackId;
  const replaceId = (value?: string) => value ? value.replace(oldTrackId, trackId) : value;
  const remapScore = (score: any) => ({
    ...score,
    trackId,
    sectionId: replaceId(score.sectionId)
  });

  return {
    ...intelligence,
    profile: {
      ...intelligence.profile,
      trackId,
      filename
    },
    localFacts: intelligence.localFacts.map((fact: any) => ({ ...fact, trackId })),
    sections: intelligence.sections.map((section: any) => ({ ...section, trackId, sectionId: replaceId(section.sectionId) })),
    heuristicGuesses: intelligence.heuristicGuesses.map((guess: any) => ({ ...guess, trackId, sectionId: replaceId(guess.sectionId) })),
    sectionScores: intelligence.sectionScores.map(remapScore),
    rankedHookCandidates: intelligence.rankedHookCandidates.map(remapScore),
    rankedEntryCandidates: intelligence.rankedEntryCandidates.map(remapScore),
    rankedExitCandidates: intelligence.rankedExitCandidates.map(remapScore),
    rankedResetCandidates: intelligence.rankedResetCandidates.map(remapScore),
    rankedFinaleCandidates: intelligence.rankedFinaleCandidates.map(remapScore),
  };
}

function getLibrary(): any[] {
  try {
    return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveLibrary(data: any[]) {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
}

function getHistory(): any[] {
  try {
    return JSON.parse(fs.readFileSync(historyPath, 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveHistory(data: any[]) {
  fs.writeFileSync(historyPath, JSON.stringify(data, null, 2));
}

function getWisdom(): any[] {
  try {
    return JSON.parse(fs.readFileSync(wisdomPath, 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveWisdom(data: any[]) {
  const tmpPath = wisdomPath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    fs.renameSync(tmpPath, wisdomPath);
  } catch (e) {
    console.error('[saveWisdom] Failed to write atomically:', e);
    // Fallback in case of permissions or locks
    fs.writeFileSync(wisdomPath, JSON.stringify(data, null, 2));
  }
}

// Wisdom entries are NEVER deleted. This is intentional for permanent cumulative learning.
function appendWisdom(entry: any) {
  const wisdom = getWisdom();
  wisdom.push({
    ...entry,
    recordedAt: new Date().toISOString()
  });
  saveWisdom(wisdom);
}

/**
 * Snaps a time (in seconds) to the nearest beat from the provided beat array.
 * Returns the snapped time and the distance.
 */
function snapToNearestBeat(time: number, beats: number[]): { snappedTime: number; distance: number } {
  if (!beats || beats.length === 0) {
    return { snappedTime: time, distance: 0 };
  }

  let closest = beats[0];
  let minDist = Math.abs(time - closest);

  for (const beat of beats) {
    const dist = Math.abs(time - beat);
    if (dist < minDist) {
      minDist = dist;
      closest = beat;
    }
  }

  return { snappedTime: closest, distance: minDist };
}

function execFfmpeg(
  args: string[],
  timeout = 30000,
  options?: { rejectOnError?: boolean; onSpawned?: (proc: any) => void },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = execFile(ffmpegPath!, args, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      const output = `${stdout || ''}${stderr || ''}`;
      if (err && options?.rejectOnError) {
        const failure = new Error(`FFmpeg exited unsuccessfully: ${err.message}`);
        (failure as any).output = output;
        reject(failure);
        return;
      }
      resolve(output);
    });
    options?.onSpawned?.(proc);
  });
}

/**
 * Robust FFmpeg runner for the strict MVP finalize_medley path.
 * - Always writes the three required debug artifacts in the session dir:
 *     ffmpeg_command.txt (human-readable command)
 *     temp_filtergraph.txt (the script passed to -filter_complex_script)
 *     ffmpeg_stderr.log (full combined output for diagnosis)
 * - Rejects on non-zero exit (hard fail, no silent fallback).
 * - Safe for Windows (execFile array form, no shell).
 */
async function runFfmpegWithStrictLogging(
  args: string[],
  sessionWorkDir: string,
  graphScriptContent: string,
  timeoutMs = 300000,
  sessionId?: string,
  expectedDuration?: number,
  onSpawned?: (proc: any) => void,
  artifactPrefix = 'final'
): Promise<{ graphFile: string; commandLog: string; stderrLog: string }> {
  const graphFile = path.join(sessionWorkDir, `${artifactPrefix}-filtergraph.txt`);
  const cmdLogFile = path.join(sessionWorkDir, `${artifactPrefix}-command.txt`);
  const stderrLogFile = path.join(sessionWorkDir, `${artifactPrefix}-stderr.log`);

  // 1. Write the filter_complex_script (MANDATORY per production requirements)
  fs.writeFileSync(graphFile, graphScriptContent, 'utf8');

  // 2. Write human-readable command log
  const quotedArgs = args.map(a => {
    if (a.includes(' ') || a.includes(':') || a.includes('[') || a.includes(']')) {
      return `"${a}"`;
    }
    return a;
  });
  const humanCmd = `ffmpeg ${quotedArgs.join(' ')}`;
  const cmdLogContent = [
    humanCmd,
    '',
    '# === filter_complex_script contents (temp_filtergraph.txt) ===',
    graphScriptContent
  ].join('\n');
  fs.writeFileSync(cmdLogFile, cmdLogContent, 'utf8');

  // 3. Spawning with -progress pipe:1 and monitoring progress
  return new Promise((resolve, reject) => {
    // Inject auto-multithreading -threads 0 and progress tracking
    const optimizedArgs = [...args];
    
    // Inject progress pipe
    optimizedArgs.splice(optimizedArgs.length - 1, 0, '-progress', 'pipe:1');
    
    // Inject auto-multithreading threads 0
    const threadsIdx = optimizedArgs.indexOf('-threads');
    if (threadsIdx === -1) {
      optimizedArgs.splice(optimizedArgs.length - 1, 0, '-threads', '0');
    }

    console.log(`[FFmpeg Spawn] Cwd: ${sessionWorkDir}`);
    console.log(`[FFmpeg Spawn] Args: ${optimizedArgs.join(' ')}`);

    const ffmpegProc = spawn(ffmpegPath!, optimizedArgs, {
      cwd: sessionWorkDir,
      windowsHide: true
    });

    if (onSpawned) {
      onSpawned(ffmpegProc);
    }

    let stderrBuffer = '';
    let stdoutBuffer = '';

    // Watchdog timer
    const watchdogTimer = setTimeout(() => {
      console.error(`[Watchdog] Timeout reached (${timeoutMs} ms) for session ${sessionId}. Terminating process.`);
      ffmpegProc.kill('SIGKILL');
      reject(new Error(JSON.stringify({
        status: 'error',
        errorCategory: 'RENDER_TIMEOUT',
        systemDescription: 'FFmpeg rendering process exceeded the maximum execution window.',
        rawSnippet: `Execution timed out after ${timeoutMs}ms.`
      })));
    }, timeoutMs);

    // Rate limiting for SSE progress logs
    let lastProgressTime = 0;

    // Parse -progress pipe:1 stdout
    ffmpegProc.stdout.on('data', (chunk) => {
      const dataStr = chunk.toString();
      stdoutBuffer += dataStr;

      if (!sessionId || !expectedDuration || expectedDuration <= 0) return;

      // Extract out_time_us
      const lines = dataStr.split('\n');
      for (const line of lines) {
        if (line.startsWith('out_time_us=')) {
          const us = parseInt(line.substring(12).trim(), 10);
          if (!isNaN(us) && us > 0) {
            const elapsed = us / 1000000;
            const percent = Math.min(99, Math.round((elapsed / expectedDuration) * 100));
            const now = Date.now();
            if (now - lastProgressTime >= RENDER_CONFIG.PROGRESS_RATE_LIMIT_MS) {
              lastProgressTime = now;
              const remaining = percent > 0 ? ((expectedDuration - elapsed) * (100 - percent)) / percent : null;
              
              // Broadcast progress message
              broadcastToSession(sessionId, 'progress', {
                stage: 'encoding',
                percent,
                elapsedSeconds: Math.round(elapsed),
                remainingSecondsEstimate: remaining ? Math.round(remaining) : null
              });
            }
          }
        }
      }
    });

    ffmpegProc.stderr.on('data', (chunk) => {
      stderrBuffer += chunk.toString();
    });

    ffmpegProc.on('close', (code) => {
      clearTimeout(watchdogTimer);

      // Write execution log
      fs.writeFileSync(stderrLogFile, `${stdoutBuffer}\n=== STDERR ===\n${stderrBuffer}`, 'utf8');

      if (code !== 0) {
        // Parse diagnostic errors
        const lastLines = stderrBuffer.split('\n').slice(-RENDER_CONFIG.MAX_ERROR_LOG_LINES).join('\n');
        
        let errorCategory = 'FFMPEG_EXECUTION_FAILURE';
        let systemDescription = 'FFmpeg render process failed. See logs for details.';
        
        if (stderrBuffer.includes('Invalid sample format')) {
          errorCategory = 'INVALID_SAMPLE_FORMAT';
          systemDescription = 'FFmpeg encountered an unsupported audio sample format.';
        } else if (stderrBuffer.includes('No such filter')) {
          errorCategory = 'FILTERGRAPH_SYNTAX_ERROR';
          systemDescription = 'FFmpeg encountered an invalid or missing filter name.';
        } else if (stderrBuffer.includes('Size mismatch')) {
          errorCategory = 'SIZE_MISMATCH';
          systemDescription = 'Stream size mismatch or buffer overflow.';
        } else if (stderrBuffer.includes('atrim') && stderrBuffer.includes('out of bounds')) {
          errorCategory = 'ATRIM_OUT_OF_BOUNDS';
          systemDescription = 'Atrim segment time boundary exceeds track duration.';
        }

        const structuredErr = {
          status: 'error',
          errorCategory,
          systemDescription,
          rawSnippet: lastLines
        };

        // Write structured error artifact
        try {
          fs.writeFileSync(path.join(sessionWorkDir, 'finalize_error.json'), JSON.stringify(structuredErr, null, 2), 'utf8');
        } catch (e) {}

        reject(new Error(JSON.stringify(structuredErr)));
      } else {
      resolve({ graphFile, commandLog: cmdLogFile, stderrLog: stderrLogFile });
      }
    });

    ffmpegProc.on('error', (err) => {
      clearTimeout(watchdogTimer);
      reject(err);
    });
  });
}

function parseDuration(output: string) {
  const match = output.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
  if (!match) return 0;
  return parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]) + parseInt(match[4]) / 100;
}

async function queryTrackDuration(filePath: string): Promise<number> {
  try {
    const output = await execFfmpeg(['-i', filePath]);
    const duration = parseDuration(output);
    if (duration > 0) return duration;
    throw new Error('Parsed duration was 0');
  } catch (e: any) {
    throw new Error(`Failed to query container duration via FFmpeg: ${e.message}`);
  }
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

function analyzePcmEnergy(raw: Buffer, duration: number) {
  if (raw.length < 2 || duration <= 0) {
    return { energyCurve: [], candidateSections: [], estimatedBpm: null };
  }

  const samples = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 2));
  const frameCount = 120;
  const frameSize = Math.max(1, Math.floor(samples.length / frameCount));
  const energies: number[] = [];

  for (let i = 0; i < frameCount && i * frameSize < samples.length; i++) {
    let sumSquares = 0;
    let peak = 0;
    const start = i * frameSize;
    const end = Math.min(samples.length, start + frameSize);
    for (let j = start; j < end; j++) {
      const abs = Math.abs(samples[j]) / 32768;
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

  const peaks = normalized
    .map((energy, index) => ({ energy, index }))
    .filter((point, index, arr) => index > 0 && index < arr.length - 1 && point.energy > arr[index - 1].energy && point.energy >= arr[index + 1].energy && point.energy > 55);
  const intervals = peaks.slice(1).map((point, index) => (point.index - peaks[index].index) * frameSeconds).filter(seconds => seconds > 0.25 && seconds < 2.5);
  const avgInterval = intervals.length ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length : 0;
  const estimatedBpm = avgInterval ? Math.round(60 / avgInterval) : null;

  return {
    energyCurve: normalized,
    candidateSections: sections,
    estimatedBpm
  };
}

async function estimateTempo(filePath: string, duration: number) {
  const pcmPath = path.join(workDir, `tempo_${uuidv4()}.f32`);
  try {
    const args = ['-y', '-hide_banner', '-i', filePath, '-ac', '1', '-ar', '44100'];
    if (duration > 240) args.push('-t', '240');
    args.push('-f', 'f32le', '-acodec', 'pcm_f32le', pcmPath);
    await execFfmpeg(args, 45000);
    if (!fs.existsSync(pcmPath)) return null;

    const raw = fs.readFileSync(pcmPath);
    const audioData = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4));
    if (audioData.length < 44100 * 5) return null;

    const detector = new MusicTempo(audioData, {
      minBeatInterval: 0.3,
      maxBeatInterval: 1.2,
      expiryTime: 20,
      maxTempos: 12
    });
    const tempo = Number(detector.tempo);
    if (!Number.isFinite(tempo) || tempo <= 0) return null;
    return Math.round(tempo);
  } catch (_e) {
    return null;
  } finally {
    try { if (fs.existsSync(pcmPath)) fs.unlinkSync(pcmPath); } catch(e) {}
  }
}

async function analyzeLocalAudio(filePath: string) {
  const probeOutput = await execFfmpeg(['-hide_banner', '-i', filePath, '-f', 'null', '-'], 15000);
  const duration = parseDuration(probeOutput);
  const bitrate = extractNumber(probeOutput, /bitrate:\s*(\d+)\s*kb\/s/);
  const sampleRate = extractNumber(probeOutput, /(\d+)\s*Hz/);
  const volumeOutput = await execFfmpeg(['-hide_banner', '-i', filePath, '-af', 'volumedetect', '-f', 'null', '-'], 30000);
  const silenceOutput = await execFfmpeg(['-hide_banner', '-i', filePath, '-af', 'silencedetect=noise=-35dB:d=0.35', '-f', 'null', '-'], 30000);
  const pcmPath = path.join(workDir, `analysis_${uuidv4()}.raw`);

  let energy = { energyCurve: [] as number[], candidateSections: [] as Array<{ start: number; end: number; energy: number }>, estimatedBpm: null as number | null };
  try {
    await execFfmpeg(['-y', '-hide_banner', '-i', filePath, '-ac', '1', '-ar', '8000', '-f', 's16le', '-acodec', 'pcm_s16le', pcmPath], 30000);
    if (fs.existsSync(pcmPath)) {
      energy = analyzePcmEnergy(fs.readFileSync(pcmPath), duration);
    }
  } finally {
    try { if (fs.existsSync(pcmPath)) fs.unlinkSync(pcmPath); } catch(e) {}
  }

  const detectedBpm = await estimateTempo(filePath, duration);

  const analysis = {
    source: 'local-ffmpeg',
    duration,
    bitrate,
    sampleRate,
    meanVolumeDb: extractNumber(volumeOutput, /mean_volume:\s*(-?[\d.]+)\s*dB/),
    maxVolumeDb: extractNumber(volumeOutput, /max_volume:\s*(-?[\d.]+)\s*dB/),
    silence: parseSilences(silenceOutput),
    estimatedBpm: detectedBpm || energy.estimatedBpm,
    energyCurve: energy.energyCurve,
    candidateSections: energy.candidateSections
  };
  const medleyIntelligence = buildTrackIntelligence({
    trackId: path.basename(filePath, path.extname(filePath)),
    filename: path.basename(filePath),
    analysis
  });

  const analysisText = [
    'Local FFmpeg analysis only. No audio was sent to an AI provider.',
    'Layer 1 local facts: duration, sample rate, bitrate, loudness, silence, tempo estimate, and energy curve.',
    'Layer 2 heuristic guesses: hook/entry/exit/reset/finale candidates are guesses with confidence and warnings.',
    'Layer 3 scoring/ranking: medley usefulness scores are local heuristics, not musical facts.',
    `Duration: ${duration ? `${duration.toFixed(1)}s` : 'unknown'}`,
    `Technical: ${sampleRate || 'unknown'} Hz, ${bitrate || 'unknown'} kbps`,
    `Volume: mean ${analysis.meanVolumeDb ?? 'unknown'} dB, max ${analysis.maxVolumeDb ?? 'unknown'} dB`,
    `Estimated BPM from local tempo detection: ${analysis.estimatedBpm ?? 'unknown'}`,
    `Silence regions: ${analysis.silence.length ? analysis.silence.map(s => `${s.start?.toFixed(1) ?? '?'}-${s.end?.toFixed(1) ?? '?'}s`).slice(0, 8).join(', ') : 'none detected'}`,
    `High-energy candidate sections: ${analysis.candidateSections.length ? analysis.candidateSections.map(s => `${s.start.toFixed(1)}-${s.end.toFixed(1)}s (${s.energy}%)`).join(', ') : 'none detected'}`,
    `Top hook candidates: ${medleyIntelligence.rankedHookCandidates.length ? medleyIntelligence.rankedHookCandidates.slice(0, 3).map(s => `${s.sectionId} (${Math.round(s.scores.hookStrength * 100)}%, confidence ${Math.round(s.confidence * 100)}%)`).join(', ') : 'none'}`,
    `Top entry candidates: ${medleyIntelligence.rankedEntryCandidates.length ? medleyIntelligence.rankedEntryCandidates.slice(0, 3).map(s => `${s.sectionId} (${Math.round(s.scores.entryQuality * 100)}%)`).join(', ') : 'none'}`,
    `Top exit candidates: ${medleyIntelligence.rankedExitCandidates.length ? medleyIntelligence.rankedExitCandidates.slice(0, 3).map(s => `${s.sectionId} (${Math.round(s.scores.exitQuality * 100)}%)`).join(', ') : 'none'}`,
    'Key, genre, and mood were not sent to the cloud and are not inferred by this local analyzer.'
  ].join('\n');

  return { analysis, analysisText, medleyIntelligence };
}

async function createAnalysisClips(filePath: string, sections: Array<{ start: number; end: number; energy: number }>, duration: number) {
  const fallbackStarts = [duration * 0.2, duration * 0.45, duration * 0.7].filter(start => Number.isFinite(start) && start > 0);
  const starts = (sections.length ? sections : fallbackStarts.map(start => ({ start, end: start + 12, energy: 50 })))
    .slice()
    .sort((a, b) => b.energy - a.energy)
    .slice(0, 3)
    .map(section => Math.max(0, Math.min(section.start, Math.max(0, duration - 12))));

  const clips: Array<{ path: string; filename: string; start: number; duration: number; energy: number; mimeType: string }> = [];
  const clipDir = path.join(workDir, 'analysis-clips');
  if (!fs.existsSync(clipDir)) fs.mkdirSync(clipDir, { recursive: true });

  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const outputPath = path.join(clipDir, `${uuidv4()}.mp3`);
    await execFfmpeg([
      '-y',
      '-hide_banner',
      '-ss', String(start.toFixed(2)),
      '-t', '12',
      '-i', filePath,
      '-ac', '1',
      '-ar', '22050',
      '-b:a', '64k',
      outputPath
    ], 30000);
    if (fs.existsSync(outputPath)) {
      clips.push({
        path: outputPath,
        filename: path.basename(outputPath),
        start: Number(start.toFixed(1)),
        duration: 12,
        energy: sections[i]?.energy ?? 50,
        mimeType: 'audio/mpeg'
      });
    }
  }

  return clips;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, audioDir),
  filename: (req, file, cb) => {
    const id = uuidv4();
    cb(null, `${id}${path.extname(file.originalname)}`);
  }
});
const upload = multer({ storage });

// Helper to update a library entry
function updateLibraryEntry(id: string, updates: Partial<any>) {
  const library = getLibrary();
  const index = library.findIndex((f: any) => f.id === id);
  if (index !== -1) {
    library[index] = { ...library[index], ...updates };
    saveLibrary(library);
    return true;
  }
  return false;
}

const sessions: Record<string, {
  status: 'running' | 'completed' | 'error';
  logs: string[];

  finalAudioPath?: string;
  summary?: string;
  metrics?: {
    emotionalArc?: number;
    transitionSmoothness?: number;
    performerIdentity?: number;
    overallScore?: number;
    iteration?: number;
  };
  designPlan?: any;
  enrichedTimings?: Record<string, any>; // keyed by "fromTrackId:fromSectionId:toTrackId:toSectionId"
  [key: string]: any; // allow dynamic wisdom-related fields
}> = {};

// Cache of the last computed TrackIntelligence[] for on-demand section pair evaluation
let cachedTrackIntelligence: { key: string; tracks: TrackIntelligence[] } | null = null;

// Restore completed sessions from history so /api/audio/:id works after restart
for (const entry of getHistory()) {
  if (entry.finalAudioPath && fs.existsSync(entry.finalAudioPath)) {
    sessions[entry.id] = {
      status: 'completed',
      logs: [],
      finalAudioPath: entry.finalAudioPath,
      summary: entry.summary,
      metrics: entry.metrics
    };
  }
}

// SSE connections for real-time streaming
const sseClients: Record<string, express.Response[]> = {};

// Active FFmpeg render processes per session — enables cancel support
const activeRenderProcesses: Record<string, any> = {};

function buildSpecialistContext(): SpecialistContext {
  const library = getLibrary();
  const trackIds = new Set<string>();
  const durationsByTrackId = new Map<string, number>();
  for (const entry of library) {
    if (!entry?.id) continue;
    trackIds.add(entry.id);
    const duration = Number(
      entry.localAnalysis?.localAnalysisV2?.durationSec ??
      entry.localAnalysis?.duration ??
      entry.analysis?.duration ??
      0
    );
    if (duration > 0) durationsByTrackId.set(entry.id, duration);
  }
  const sectionsById = new Map<string, { trackId: string; startSec: number; endSec: number }>();
  for (const track of cachedTrackIntelligence?.tracks ?? []) {
    for (const section of track.sections ?? []) {
      sectionsById.set(section.sectionId, {
        trackId: section.trackId,
        startSec: section.startSec,
        endSec: section.endSec,
      });
    }
  }
  return { trackIds, durationsByTrackId, sectionsById };
}

function broadcastToSession(sessionId: string, event: string, data: any) {
  const clients = sseClients[sessionId] || [];
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(res => {
    try { res.write(msg); } catch(e) {}
  });
}

const geminiApiKey = process.env.GEMINI_API_KEY || '';
const openrouterApiKey = process.env.OPENROUTER_API_KEY || '';

app.get('/api/config', (req, res) => {
  res.json({ geminiApiKey, openrouterApiKey });
});

function logToSession(sessionId: string, msg: string) {
  if (!sessions[sessionId]) return;
  const logEntry = `[${new Date().toISOString()}] ${msg}`;
  sessions[sessionId].logs.push(logEntry);
  broadcastToSession(sessionId, 'log', { message: logEntry });
  console.log(`[Session ${sessionId}] ${msg}`);
}

// SSE endpoint for real-time session streaming
app.get('/api/session/:id/stream', (req, res) => {
  const sessionId = req.params.id;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  res.write(`event: connected\ndata: {"sessionId":"${sessionId}"}\n\n`);

  if (!sseClients[sessionId]) sseClients[sessionId] = [];
  sseClients[sessionId].push(res);

  // Heartbeat loop to keep connections alive through reverse proxies
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch (e) {
      clearInterval(heartbeat);
    }
  }, RENDER_CONFIG.SSE_HEARTBEAT_MS);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients[sessionId] = (sseClients[sessionId] || []).filter(c => c !== res);
  });
});

// Cancel active render for a session
app.post('/api/session/:id/cancel', (req, res) => {
  const sessionId = req.params.id;
  const proc = activeRenderProcesses[sessionId];
  if (proc && !proc.killed) {
    console.log(`[Cancel] Killing active FFmpeg render for session ${sessionId}`);
    proc.kill('SIGKILL');
    delete activeRenderProcesses[sessionId];
    if (sessions[sessionId]) {
      sessions[sessionId].status = 'error';
      logToSession(sessionId, '[finalize-medley] Render cancelled by user.');
    }
    return res.json({ success: true, message: 'Render process terminated.' });
  }
  res.json({ success: false, message: 'No active render process found for this session.' });
});

app.get('/api/library', (req, res) => {
  res.json(getLibrary());
});

app.post('/api/library', (req, res) => {
  upload.array('files')(req, res, (err) => {
    if (err) return res.status(500).json({ error: 'Upload error: ' + String(err) });
    const library = getLibrary();
    const files = req.files as Express.Multer.File[];
    if (!files) return res.json({ success: true, files: [] });
    
    const newEntries = files.map(f => ({
      id: f.filename.split('.')[0],
      originalName: f.originalname,
      filename: f.filename,
      path: f.path,
      size: f.size,
      mimeType: f.mimetype,
      uploadedAt: new Date().toISOString()
    }));
    
    library.push(...newEntries);
    saveLibrary(library);
    res.json({ success: true, files: newEntries });
  });
});

// Reorder library endpoint
app.put('/api/library/reorder', (req, res) => {
  const { orderedIds } = req.body;
  if (!orderedIds || !Array.isArray(orderedIds)) {
    return res.status(400).json({ error: 'orderedIds array required' });
  }
  const library = getLibrary();
  const reordered = orderedIds.map((id: string) => library.find((e: any) => e.id === id)).filter(Boolean);
  // Add any items not in the ordered list at the end
  const remainingItems = library.filter((e: any) => !orderedIds.includes(e.id));
  saveLibrary([...reordered, ...remainingItems]);
  res.json({ success: true });
});

app.delete('/api/library/:id', (req, res) => {
  const library = getLibrary();
  const id = req.params.id;
  const index = library.findIndex((e: any) => e.id === id);
  if (index !== -1) {
    const entry = library[index];
    if (fs.existsSync(entry.path)) fs.unlinkSync(entry.path);
    library.splice(index, 1);
    saveLibrary(library);
  }
  res.json({ success: true });
});

// ── Checkpoint endpoints ──────────────────────────────────────────────────────

app.post('/api/checkpoint', express.json({ limit: '50mb' }), (req: any, res: any) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  try {
    validateSessionId(sessionId);
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
  if (getHistory().some((entry: any) => entry.id === sessionId)) {
    return res.json({ ok: true, ignored: 'completed' });
  }
  const filePath = path.join(checkpointDir, `${sessionId}.json`);
  let checkpoint = { ...req.body, savedAt: req.body.savedAt || new Date().toISOString() };
  if (req.body.schemaVersion === 3) {
    const parsed = AutomaticWorkflowCheckpointSchema.safeParse(checkpoint);
    if (!parsed.success) {
      return res.status(400).json({ error: formatValidationIssues(parsed.error).join('; ') });
    }
    checkpoint = parsed.data;
    if (fs.existsSync(filePath)) {
      try {
        const existing = AutomaticWorkflowCheckpointSchema.safeParse(
          JSON.parse(fs.readFileSync(filePath, 'utf8')),
        );
        if (
          existing.success &&
          (
            existing.data.activeRequestSequence > checkpoint.activeRequestSequence ||
            (
              existing.data.activeRequestSequence === checkpoint.activeRequestSequence &&
              existing.data.savedAt > checkpoint.savedAt
            )
          )
        ) {
          return res.json({ ok: true, stale: true });
        }
      } catch {
        // A corrupt older checkpoint is replaced by the validated new checkpoint.
      }
    }
  }
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(checkpoint));
  fs.renameSync(temporary, filePath);
  res.json({ ok: true });
});

app.get('/api/checkpoints', (_req: any, res: any) => {
  const checkpoints = fs.readdirSync(checkpointDir)
    .filter((f: string) => f.endsWith('.json'))
    .map((f: string) => {
      try { return JSON.parse(fs.readFileSync(path.join(checkpointDir, f), 'utf8')); }
      catch { return null; }
    })
    .filter(Boolean);
  res.json(checkpoints);
});

app.get('/api/checkpoint/:sessionId', (req: any, res: any) => {
  try {
    validateSessionId(req.params.sessionId);
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
  const p = path.join(checkpointDir, `${req.params.sessionId}.json`);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'not found' });
  res.json(JSON.parse(fs.readFileSync(p, 'utf8')));
});

app.delete('/api/checkpoint/:sessionId', (req: any, res: any) => {
  try {
    validateSessionId(req.params.sessionId);
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
  const p = path.join(checkpointDir, `${req.params.sessionId}.json`);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/audio-raw/:id', (req, res) => {
  const library = getLibrary();
  const entry = library.find((e: any) => e.id === req.params.id);
  if (!entry || !fs.existsSync(entry.path)) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.sendFile(entry.path);
});

// Audio probe endpoint — get duration/format info via ffmpeg
app.get('/api/audio-probe/:id', (req, res) => {
  const library = getLibrary();
  const entry = library.find((e: any) => e.id === req.params.id);
  if (!entry || !fs.existsSync(entry.path)) {
    return res.status(404).json({ error: 'File not found' });
  }
  const cmd = `"${ffmpegPath}" -i "${entry.path}" -hide_banner -f null - 2>&1`;
  exec(cmd, { timeout: 10000 }, (err, stdout, stderr) => {
    const output = stdout + (stderr || '');
    const durationMatch = output.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
    let durationSecs = 0;
    if (durationMatch) {
      durationSecs = parseInt(durationMatch[1]) * 3600 + parseInt(durationMatch[2]) * 60 + parseInt(durationMatch[3]) + parseInt(durationMatch[4]) / 100;
    }
    const bitrateMatch = output.match(/bitrate:\s*(\d+)\s*kb\/s/);
    const sampleRateMatch = output.match(/(\d+)\s*Hz/);
    res.json({
      duration: durationSecs,
      bitrate: bitrateMatch ? parseInt(bitrateMatch[1]) : null,
      sampleRate: sampleRateMatch ? parseInt(sampleRateMatch[1]) : null,
      raw: output.substring(0, 500)
    });
  });
});

// Waveform data endpoint — generate peaks for visualization
app.get('/api/waveform/:id', (req, res) => {
  const library = getLibrary();
  const entry = library.find((e: any) => e.id === req.params.id);
  if (!entry || !fs.existsSync(entry.path)) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  const peaksFile = path.join(workDir, `peaks_${entry.id}.raw`);
  // Downsample to 8kHz mono, output raw PCM
  const cmd = `"${ffmpegPath}" -y -i "${entry.path}" -ac 1 -ar 8000 -f s16le -acodec pcm_s16le "${peaksFile}"`;
  exec(cmd, { timeout: 30000 }, (err) => {
    if (err || !fs.existsSync(peaksFile)) {
      return res.json({ peaks: [] });
    }
    try {
      const raw = fs.readFileSync(peaksFile);
      const samples = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
      // Downsample to ~200 peaks
      const numPeaks = 200;
      const chunkSize = Math.max(1, Math.floor(samples.length / numPeaks));
      const peaks: number[] = [];
      for (let i = 0; i < numPeaks && i * chunkSize < samples.length; i++) {
        let max = 0;
        for (let j = 0; j < chunkSize && (i * chunkSize + j) < samples.length; j++) {
          const val = Math.abs(samples[i * chunkSize + j]);
          if (val > max) max = val;
        }
        peaks.push(max / 32768);
      }
      // Clean up temp file
      try { fs.unlinkSync(peaksFile); } catch(e) {}
      res.json({ peaks });
    } catch(e) {
      res.json({ peaks: [] });
    }
  });
});

app.post('/api/session/finish', async (req, res) => {
  const { sessionId, finalAudioPath, summary } = req.body;
  if (!sessionId || !finalAudioPath) {
    return res.status(400).json({ error: 'sessionId and finalAudioPath are required' });
  }

  // Resolve relative paths against the session workdir so res.sendFile always gets an absolute path
  const resolvedAudioPath = path.isAbsolute(finalAudioPath)
    ? finalAudioPath
    : path.join(workDir, sessionId, finalAudioPath);
  if (sessions[sessionId]) {
    sessions[sessionId].status = 'completed';
    sessions[sessionId].finalAudioPath = resolvedAudioPath;
    sessions[sessionId].summary = summary;
  } else {
    sessions[sessionId] = {
      status: 'completed',
      logs: [],
      finalAudioPath: resolvedAudioPath,
      summary
    };
  }
  
  // Save to history - intentionally never truncated (permanent record of every medley)
  const history = getHistory();
  history.unshift({
    id: sessionId,
    completedAt: new Date().toISOString(),
    summary,
    finalAudioPath: resolvedAudioPath,
    metrics: sessions[sessionId]?.metrics,
    designPlan: sessions[sessionId]?.designPlan || null
  });
  saveHistory(history);
  
  broadcastToSession(sessionId, 'completed', { summary });

  // Permanently record cross-medley wisdom from this generation
  // This data is never deleted and is used to make future medleys smarter.
  const sessionData = sessions[sessionId] || ({} as any);
  const wisdomEntry: any = {
    type: 'completed_medley',
    sessionId,
    summary,
    metrics: sessionData.metrics || null,
    designPlan: sessionData.designPlan || null,
    finalAudioPath: resolvedAudioPath,
    tracksInvolved: sessionData.designPlan?.transitions?.map((t: any) => t.fromTrackId) || []
  };

  // Run objective quality analysis on the final output and include it (permanent)
  try {
    const quality = await analyzeMedleyQuality(resolvedAudioPath, workDir);
    wisdomEntry.finalQuality = quality;
  } catch (e) {
    // best effort
  }

  appendWisdom(wisdomEntry);

  res.json({ success: true });
});

// Update metrics endpoint
app.post('/api/session/metrics', (req, res) => {
  const { sessionId, metrics } = req.body;
  if (sessions[sessionId]) {
    sessions[sessionId].metrics = { ...sessions[sessionId].metrics, ...metrics };
    broadcastToSession(sessionId, 'metrics', sessions[sessionId].metrics);

    // Accumulate evaluation wisdom permanently
    appendWisdom({
      type: 'evaluation',
      sessionId,
      metrics,
      designPlan: sessions[sessionId].designPlan || null
    });
  }
  res.json({ success: true });
});

app.get('/api/session/:id', (req, res) => {
  const session = sessions[req.params.id];
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json({
    status: session.status,
    logs: session.logs,
    summary: session.summary,
    metrics: session.metrics
  });
});

app.get('/api/audio/:id', (req, res) => {
  const audioPath = findSessionAudioPath(req.params.id);
  if (!audioPath) {
    res.status(404).json({ error: 'Audio not found' });
    return;
  }
  res.type(path.extname(audioPath) || 'mp3');
  res.sendFile(audioPath);
});

app.get('/api/audio/:id/download', (req, res) => {
  const audioPath = findSessionAudioPath(req.params.id);
  if (!audioPath) {
    res.status(404).json({ error: 'Audio not found' });
    return;
  }

  res.download(audioPath, downloadFilenameFor(audioPath, req.params.id), err => {
    if (err && !res.headersSent) {
      res.status(500).json({ error: 'Audio download failed' });
    }
  });
});

app.get('/api/audio-file', (req, res) => {
  const { filePath, sessionId } = req.query;
  if (!filePath || typeof filePath !== 'string') {
    return res.status(400).json({ error: 'filePath is required' });
  }

  const resolvedPath = resolveReadableAudioPath(filePath, typeof sessionId === 'string' ? sessionId : undefined);
  if (!resolvedPath) {
    return res.status(404).json({ error: 'Audio file not found or not allowed' });
  }

  res.sendFile(resolvedPath);
});

app.post('/api/audio-analysis/local', async (req, res) => {
  const { fileId, filePath, sessionId, saveToLibrary, includeClips } = req.body;
  const library = getLibrary();
  const entry = fileId ? library.find((item: any) => item.id === fileId) : null;
  const resolvedPath = entry?.path || (filePath ? resolveReadableAudioPath(filePath, sessionId) : null);

  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return res.status(404).json({ error: 'Audio file not found or not allowed' });
  }

  try {
    const result = await analyzeLocalAudioFile({
      filePath: resolvedPath,
      workDir,
      trackId: entry?.id,
      filename: entry?.originalName
    });
    const clips = includeClips
      ? await createAnalysisClips(resolvedPath, result.analysis.candidateSections || [], result.analysis.duration || 0)
      : [];
    const medleyIntelligence = entry
      ? retargetTrackIntelligence(result.medleyIntelligence, entry.id, entry.originalName)
      : result.medleyIntelligence;
    if (entry && saveToLibrary) {
      updateLibraryEntry(entry.id, {
        analysis: result.analysisText,
        localAnalysis: result.analysis,
        medleyIntelligence,
        analysisClips: clips.map(clip => ({
          path: clip.path,
          start: clip.start,
          duration: clip.duration,
          energy: clip.energy,
          mimeType: clip.mimeType
        })),
        localAnalysisUpdatedAt: new Date().toISOString()
      });
    }
    res.json({ ...result, medleyIntelligence, clips });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/medley-intelligence/design', (req, res) => {
  const { library: requestLibrary, userConstraints } = req.body || {};
  const source = Array.isArray(requestLibrary) ? requestLibrary : getLibrary();
  const tracks = source
    .map((entry: any) => {
      if (entry.medleyIntelligence) return entry.medleyIntelligence;
      if (entry.localAnalysis) {
        return buildTrackIntelligence({
          trackId: entry.id,
          filename: entry.originalName || entry.filename || entry.id,
          analysis: entry.localAnalysis
        });
      }
      return null;
    })
    .filter(Boolean);

  // Cache for evaluate-section-pair route
  if (tracks.length > 0) {
    const cacheKey = tracks.map((t: any) => t.profile.trackId).join(',');
    cachedTrackIntelligence = { key: cacheKey, tracks };
  }

  if (tracks.length === 0) {
    return res.status(400).json({ error: 'No local medley intelligence is available. Run local analysis first.' });
  }

  // Load permanent accumulated wisdom so the system gets smarter over time
  const wisdom = getWisdom();

  res.json({
    success: true,
    design: buildMedleyDesignPayload({
      tracks,
      userConstraints: userConstraints || {},
      maxTransitions: 32,
      wisdom
    })
  });
});

// Section pair evaluation (uses the cache populated by the design route)
app.post('/api/section-pair-evaluate', (req, res) => {
  const { fromTrackId, fromSectionId, toTrackId, toSectionId } = req.body || {};
  if (!fromTrackId || !fromSectionId || !toTrackId || !toSectionId) {
    return res.status(400).json({ error: 'fromTrackId, fromSectionId, toTrackId, toSectionId are all required.' });
  }
  if (!cachedTrackIntelligence) {
    return res.status(400).json({ error: 'No track intelligence available. Run /api/medley-intelligence/design first.' });
  }
  const fromTrack = cachedTrackIntelligence.tracks.find((t: TrackIntelligence) => t.profile.trackId === fromTrackId);
  const toTrack = cachedTrackIntelligence.tracks.find((t: TrackIntelligence) => t.profile.trackId === toTrackId);
  if (!fromTrack) return res.status(404).json({ error: `Track not found: ${fromTrackId}` });
  if (!toTrack) return res.status(404).json({ error: `Track not found: ${toTrackId}` });
  const result = evaluateSectionPair(fromTrack, toTrack, fromSectionId, toSectionId);
  if (!result) {
    return res.status(404).json({ error: `One or both section IDs not found (fromSectionId=${fromSectionId}, toSectionId=${toSectionId}).` });
  }
  res.json({ success: true, transition: result });
});

app.post('/api/medley-quality', async (req, res) => {
  const { filePath, sessionId } = req.body || {};
  if (!filePath) {
    return res.status(400).json({ error: 'filePath is required' });
  }
  try {
    const result = await analyzeMedleyQuality(filePath, sessionId ? path.join(workDir, sessionId) : workDir);
    res.json({ success: true, quality: result });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/session/project-brief', (req, res) => {
  const { sessionId, brief } = req.body || {};
  try {
    validateSessionId(sessionId);
    const parsed = ProjectBriefSchema.parse(brief);
    if (parsed.projectId !== sessionId) {
      return res.status(400).json({ error: 'projectId must match sessionId' });
    }
    const contextualErrors = validateProjectBriefContext(parsed, buildSpecialistContext());
    if (contextualErrors.length) {
      return res.status(400).json({ error: contextualErrors.join('; ') });
    }
    if (!sessions[sessionId]) sessions[sessionId] = { status: 'running', logs: [] };
    sessions[sessionId].projectBrief = parsed;
    sessions[sessionId].workflowStage = 'arrangement';
    res.json({ success: true, brief: parsed });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/session/execution-report', (req, res) => {
  const { sessionId, report } = req.body || {};
  try {
    validateSessionId(sessionId);
    const parsed = ExecutionReportSchema.parse(report);
    const planResult = ArrangementPlanSchema.safeParse(sessions[sessionId]?.designPlan);
    if (!planResult.success) {
      return res.status(400).json({ error: 'No valid locked arrangement exists for this session' });
    }
    const contextualErrors = validateExecutionContext(parsed, planResult.data);
    if (contextualErrors.length) return res.status(400).json({ error: contextualErrors.join('; ') });
    if (sessions[sessionId]?.projectBrief) {
      const authoritative = sessions[sessionId]?.executionResults?.[parsed.executionVersion] || {};
      const authorityErrors: string[] = [];
      for (const [index, attempt] of parsed.attemptedTransitions.entries()) {
        const actual = authoritative[attempt.transitionId];
        if (!actual) {
          authorityErrors.push(`attemptedTransitions[${index}]: No server execution exists for ${attempt.transitionId}`);
          continue;
        }
        if (attempt.success !== actual.success) {
          authorityErrors.push(`attemptedTransitions[${index}].success: Does not match server execution`);
        }
        if (attempt.previewPath !== actual.previewPath) {
          authorityErrors.push(`attemptedTransitions[${index}].previewPath: Does not match server execution`);
        }
        for (const field of [
          'fromTrackId',
          'fromSectionId',
          'toTrackId',
          'toSectionId',
          'style',
          'duration',
          'beatAlign',
        ] as const) {
          if (attempt[field] !== actual.request[field]) {
            authorityErrors.push(`attemptedTransitions[${index}].${field}: Does not match server execution`);
          }
        }
        for (const field of ['actualFromExitSec', 'actualToEntrySec'] as const) {
          const reported = attempt[field];
          const recorded = actual[field];
          if (
            reported !== recorded &&
            !(typeof reported === 'number' && typeof recorded === 'number' && Math.abs(reported - recorded) < 0.001)
          ) {
            authorityErrors.push(`attemptedTransitions[${index}].${field}: Does not match server execution`);
          }
        }
      }
      if (authorityErrors.length) return res.status(400).json({ error: authorityErrors.join('; ') });
    }
    sessions[sessionId].executionReport = parsed;
    sessions[sessionId].workflowStage = 'review_candidate';
    res.json({ success: true, report: parsed });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/session/quality-review', (req, res) => {
  const { sessionId, review } = req.body || {};
  try {
    validateSessionId(sessionId);
    const parsed = QualityReviewSchema.parse(review);
    const existingManifest = readCandidateManifest(workDir, sessionId);
    const reviewedCandidate = existingManifest.candidates.find(item => item.candidateId === parsed.candidateId);
    if (!reviewedCandidate) {
      return res.status(400).json({ error: 'Reviewed candidate is not registered' });
    }
    if (
      reviewedCandidate.candidateVersion !== parsed.candidateVersion ||
      reviewedCandidate.arrangementVersion !== parsed.arrangementVersion
    ) {
      return res.status(400).json({ error: 'Review version does not match the registered candidate' });
    }
    if (parsed.approved && parsed.blockingIssues.length) {
      return res.status(400).json({ error: 'An approved review cannot contain blocking issues' });
    }
    const plan = ArrangementPlanSchema.safeParse(sessions[sessionId]?.designPlan);
    if (plan.success) {
      const transitionIds = new Set(plan.data.transitions.map(item => item.transitionId));
      const unknownCorrection = parsed.corrections.find(item => !transitionIds.has(item.transitionId));
      if (unknownCorrection) {
        return res.status(400).json({ error: `Unknown correction transition: ${unknownCorrection.transitionId}` });
      }
    }
    const manifest = applyCandidateReview(workDir, sessionId, parsed);
    sessions[sessionId].qualityReview = parsed;
    sessions[sessionId].workflowStage = parsed.approved ? 'final_render' : 'correction';
    res.json({ success: true, review: parsed, manifest });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/session/:sessionId/candidates', (req, res) => {
  try {
    const manifest = readCandidateManifest(workDir, req.params.sessionId);
    res.json({ success: true, manifest });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/session/design-plan', (req, res) => {
  const { sessionId, plan } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  if (!plan || !Array.isArray(plan.transitions)) {
    return res.status(400).json({ error: 'plan.transitions must be an array' });
  }
  if (!sessions[sessionId]) {
    sessions[sessionId] = { status: 'running', logs: [] };
  }

  // Merge enriched timing fields from the previous design plan (if any) and from
  // session.enrichedTimings (populated by apply_musical_transition even before set_design_plan).
  // This prevents set_design_plan from destroying actualFromExitSec / actualToEntrySec.
  const existingPlan = sessions[sessionId].designPlan;
  const enrichedTimings = sessions[sessionId].enrichedTimings || {};
  const ENRICHED_FIELDS = ['actualFromExitSec', 'actualToEntrySec', 'actualOverlapSec', 'durationUsed', 'beatSnapApplied', 'outputPath'];

  if (!sessions[sessionId].projectBrief) {
    for (const incoming of plan.transitions) {
      const key = `${incoming.fromTrackId}:${incoming.fromSectionId}:${incoming.toTrackId}:${incoming.toSectionId}`;

      // 1. Merge from session.enrichedTimings (populated by apply_musical_transition)
      const cached = enrichedTimings[key];
      if (cached) {
        for (const f of ENRICHED_FIELDS) {
          if (cached[f] !== undefined && incoming[f] === undefined) {
            incoming[f] = cached[f];
          }
        }
      }

      // 2. Merge from old designPlan if transition identity matches
      if (existingPlan && Array.isArray(existingPlan.transitions)) {
        const old = existingPlan.transitions.find((t: any) =>
          t.fromTrackId === incoming.fromTrackId &&
          t.fromSectionId === incoming.fromSectionId &&
          t.toTrackId === incoming.toTrackId &&
          t.toSectionId === incoming.toSectionId
        );
        if (old) {
          for (const f of ENRICHED_FIELDS) {
            if (old[f] !== undefined && incoming[f] === undefined) {
              incoming[f] = old[f];
            }
          }
        }
      }
    }
  }

  const specialistPlan = ArrangementPlanSchema.safeParse(plan);
  if (specialistPlan.success) {
    if (specialistPlan.data.projectId !== sessionId) {
      return res.status(400).json({ error: 'projectId must match sessionId' });
    }
    const contextualErrors = validateArrangementContext(specialistPlan.data, buildSpecialistContext());
    const expectedTrackIds = new Set<string>(
      (sessions[sessionId].projectBrief?.recommendedOrderIds || specialistPlan.data.orderedTrackIds) as string[],
    );
    const actualTrackIds = new Set(specialistPlan.data.orderedTrackIds);
    if (
      expectedTrackIds.size !== actualTrackIds.size ||
      [...expectedTrackIds].some(trackId => !actualTrackIds.has(trackId))
    ) {
      contextualErrors.push('orderedTrackIds: Must include every track from the project brief');
    }
    if (contextualErrors.length) {
      return res.status(400).json({ error: contextualErrors.join('; ') });
    }
    sessions[sessionId].designPlan = specialistPlan.data;
    sessions[sessionId].workflowStage = 'production';
  } else if (sessions[sessionId].projectBrief) {
    return res.status(400).json({
      error: formatValidationIssues(specialistPlan.error).join('; '),
    });
  } else {
    // Legacy/manual sessions retain their existing loose plan format.
    sessions[sessionId].designPlan = plan;
  }

  // Soft validation: warn about any low-score pairs
  const warnings: string[] = [];
  if (cachedTrackIntelligence) {
    for (const t of plan.transitions) {
      const fromTrack = cachedTrackIntelligence.tracks.find((tr: TrackIntelligence) => tr.profile.trackId === t.fromTrackId);
      const toTrack = cachedTrackIntelligence.tracks.find((tr: TrackIntelligence) => tr.profile.trackId === t.toTrackId);
      if (fromTrack && toTrack && t.fromSectionId && t.toSectionId) {
        const score = evaluateSectionPair(fromTrack, toTrack, t.fromSectionId, t.toSectionId);
        if (score && score.score < 0.35) {
          warnings.push(`Low-score transition (${score.score.toFixed(2)}): ${t.fromSectionId} → ${t.toSectionId}. Consider reviewing.`);
        }
      }
    }
  }
  res.json({ success: true, storedTransitions: plan.transitions.length, warnings });
});

// Musical transition endpoint (high-quality blending tool for the agent)
app.post('/api/apply-transition', async (req, res) => {
  const { 
    transitionId,
    fromTrackId, 
    fromSectionId, 
    toTrackId, 
    toSectionId, 
    style, 
    duration, 
    intensity, 
    beatAlign, 
    notes,
    sessionId,
    executionVersion = 1,
  } = req.body || {};

  if (!fromTrackId || !fromSectionId || !toTrackId || !toSectionId || !style) {
    return res.status(400).json({ 
      error: 'fromTrackId, fromSectionId, toTrackId, toSectionId, and style are required.' 
    });
  }

  // --- Basic implementation of musical transition ---
  console.log(`[apply-transition] Processing: ${fromTrackId}:${fromSectionId} → ${toTrackId}:${toSectionId} [${style}]`);

  const session = sessionId ? sessions[sessionId] : null;
  const designPlan = session?.designPlan;
  let validatedExecutionRequest: any = null;
  if (session?.projectBrief) {
    const parsedRequest = TransitionExecutionRequestSchema.safeParse({
      transitionId,
      fromTrackId,
      fromSectionId,
      toTrackId,
      toSectionId,
      style,
      duration,
      beatAlign,
      notes,
    });
    if (!parsedRequest.success) {
      return res.status(400).json({ error: formatValidationIssues(parsedRequest.error).join('; ') });
    }
    const lockedPlan = ArrangementPlanSchema.safeParse(designPlan);
    if (!lockedPlan.success) {
      return res.status(400).json({ error: 'No valid locked arrangement exists for this session' });
    }
    const contextualErrors = validateTransitionExecutionContext(parsedRequest.data, lockedPlan.data);
    if (contextualErrors.length) {
      return res.status(400).json({ error: contextualErrors.join('; ') });
    }
    validatedExecutionRequest = parsedRequest.data;
  }

  // Try to find the planned transition details
  let plannedTransition = null;
  if (designPlan && designPlan.transitions) {
    plannedTransition = designPlan.transitions.find((t: any) =>
      t.fromTrackId === fromTrackId && t.fromSectionId === fromSectionId &&
      t.toTrackId === toTrackId && t.toSectionId === toSectionId
    );
  }

  const transitionDuration = duration || (plannedTransition?.duration) || 5;
  const useBeatAlign = beatAlign ?? true;

  const fromEntry = getLibrary().find((e: any) => e.id === fromTrackId);
  const toEntry = getLibrary().find((e: any) => e.id === toTrackId);

  if (!fromEntry || !toEntry) {
    return res.status(404).json({ error: 'One or both tracks not found in library' });
  }

  const sessionWorkDir = path.join(workDir, sessionId || 'default');
  if (!fs.existsSync(sessionWorkDir)) fs.mkdirSync(sessionWorkDir, { recursive: true });

  const safeTransitionKey = `${fromSectionId}_to_${toSectionId}`
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 140);
  const outputTransitionPath = path.join(
    sessionWorkDir,
    `transition-exec-${String(Number(executionVersion) || 1).padStart(3, '0')}-${safeTransitionKey}.mp3`,
  );
  if (session) {
    if (!Array.isArray(session.registeredFiles)) session.registeredFiles = [];
    if (!session.registeredFiles.includes(outputTransitionPath)) {
      session.registeredFiles.push(outputTransitionPath);
    }
  }

  try {
    // Load rich intelligence data if available (for beats, energy, etc.)
    let fromIntelligence: TrackIntelligence | null = null;
    let toIntelligence: TrackIntelligence | null = null;

    if (cachedTrackIntelligence) {
      fromIntelligence = cachedTrackIntelligence.tracks.find((t: TrackIntelligence) => t.profile.trackId === fromTrackId) || null;
      toIntelligence = cachedTrackIntelligence.tracks.find((t: TrackIntelligence) => t.profile.trackId === toTrackId) || null;
    }

    // Determine base cut points from design plan or defaults
    let fromStart = plannedTransition?.fromExitSec ? Math.max(0, plannedTransition.fromExitSec - transitionDuration) : 0;
    let toStart = plannedTransition?.toEntrySec || 0;

    // === Beat Snapping (if requested and we have beat data) ===
    let beatSnapNotes = '';
    if (useBeatAlign) {
      const fromBeats = fromIntelligence?.localFacts?.find((f: any) => f.name === 'beat_grid')?.value || [];
      const toBeats = toIntelligence?.localFacts?.find((f: any) => f.name === 'beat_grid')?.value || [];

      const fromBeatsArray = Array.isArray(fromBeats) ? fromBeats : [];
      if (fromBeatsArray.length > 0) {
        const snap = snapToNearestBeat(fromStart + transitionDuration, fromBeatsArray);
        if (snap.distance < 0.25) { // only snap if reasonably close
          fromStart = snap.snappedTime - transitionDuration;
          beatSnapNotes += ` Snapped exit to nearest beat (offset ${snap.distance.toFixed(3)}s).`;
        }
      }

      const toBeatsArray = Array.isArray(toBeats) ? toBeats : [];
      if (toBeatsArray.length > 0) {
        const snap = snapToNearestBeat(toStart, toBeatsArray);
        if (snap.distance < 0.25) {
          toStart = snap.snappedTime;
          beatSnapNotes += ` Snapped entry to nearest beat (offset ${snap.distance.toFixed(3)}s).`;
        }
      }
    }

    // === Style-aware processing (now uses the pluggable config) ===
    const styleConfig = getTransitionStyleConfig(style);
    const curve1 = styleConfig.curve1;
    const curve2 = styleConfig.curve2;
    const extraFilters = styleConfig.extraFilters;

    const fromPath = fromEntry.path;
    const toPath = toEntry.path;

    const actualFromExit = fromStart + transitionDuration;
    const actualToEntry = toStart;

    // === SEPARATED: Enrichment (for finalize_medley pure-clean path) happens independently of preview render ===
    // This decouples the "preview concern" (temporary audition file) from the enrichment needed by the final renderer.
    // Always store enriched timings in session.enrichedTimings keyed by transition identity,
    // so they survive even if apply_musical_transition runs before set_design_plan.
    if (session) {
      if (!session.enrichedTimings) session.enrichedTimings = {};
      const timingKey = `${fromTrackId}:${fromSectionId}:${toTrackId}:${toSectionId}`;
      session.enrichedTimings[timingKey] = {
        actualFromExitSec: actualFromExit,
        actualToEntrySec: actualToEntry,
        durationUsed: transitionDuration,
        beatSnapApplied: useBeatAlign && (beatSnapNotes.length > 0),
        style,
      };
      // Legacy manual sessions still expect execution details on the loose plan.
      if (!session.projectBrief && session.designPlan && Array.isArray(session.designPlan.transitions)) {
        const matchingTransition = session.designPlan.transitions.find((t: any) =>
          t.fromTrackId === fromTrackId &&
          t.fromSectionId === fromSectionId &&
          t.toTrackId === toTrackId &&
          t.toSectionId === toSectionId
        );
        if (matchingTransition) {
          matchingTransition.actualFromExitSec = actualFromExit;
          matchingTransition.actualToEntrySec = actualToEntry;
          matchingTransition.durationUsed = transitionDuration;
          matchingTransition.beatSnapApplied = useBeatAlign && (beatSnapNotes.length > 0);
          matchingTransition.style = style;
        }
      }
    }

    // Build improved filter chain for PREVIEW only
    const filterComplex =
      `[0:a]atrim=start=${fromStart}:duration=${transitionDuration},loudnorm=I=-14:TP=-1.5${extraFilters}[a0];` +
      `[1:a]atrim=start=${toStart}:duration=${transitionDuration},loudnorm=I=-14:TP=-1.5${extraFilters}[a1];` +
      `[a0][a1]acrossfade=d=${transitionDuration}:curve1=${curve1}:curve2=${curve2}[out]`;

    const cmd = [
      '-y',
      '-i', fromPath,
      '-i', toPath,
      '-filter_complex', filterComplex,
      '-map', '[out]',
      '-c:a', 'libmp3lame',
      '-b:a', '320k',
      outputTransitionPath
    ];

    await execFfmpeg(cmd, 120000, {
      rejectOnError: true,
      onSpawned: proc => {
        if (sessionId) activeRenderProcesses[sessionId] = proc;
      },
    });
    if (sessionId) delete activeRenderProcesses[sessionId];

    if (session) {
      if (!Array.isArray(session.registeredFiles)) session.registeredFiles = [];
      if (!session.registeredFiles.includes(outputTransitionPath)) {
        session.registeredFiles.push(outputTransitionPath);
      }
      const timingKey = `${fromTrackId}:${fromSectionId}:${toTrackId}:${toSectionId}`;
      if (session.enrichedTimings?.[timingKey]) {
        session.enrichedTimings[timingKey].outputPath = outputTransitionPath;
      }
    }

    // Only after successful preview render, set the outputPath (preview concern separated)
    if (!session?.projectBrief && session?.designPlan && Array.isArray(session.designPlan.transitions)) {
      const matchingTransition = session.designPlan.transitions.find((t: any) =>
        t.fromTrackId === fromTrackId &&
        t.fromSectionId === fromSectionId &&
        t.toTrackId === toTrackId &&
        t.toSectionId === toSectionId
      );
      if (matchingTransition) {
        matchingTransition.outputPath = outputTransitionPath;
      }
    }

    const finalNotes = `Applied ${style} transition (${transitionDuration}s).${beatSnapNotes} ${notes ? 'Notes: ' + notes : ''}`;
    if (session?.projectBrief && transitionId) {
      if (!session.executionResults) session.executionResults = {};
      if (!session.executionResults[executionVersion]) session.executionResults[executionVersion] = {};
      session.executionResults[executionVersion][transitionId] = {
        request: validatedExecutionRequest,
        success: true,
        actualFromExitSec: actualFromExit,
        actualToEntrySec: actualToEntry,
        previewPath: outputTransitionPath,
        error: null,
      };
    }

    appendWisdom({
      type: 'transition_applied',
      sessionId,
      style,
      fromTrackId,
      fromSectionId,
      toTrackId,
      toSectionId,
      duration: transitionDuration,
      beatAlign: useBeatAlign,
      intensity: intensity || 0.6,
      notes: notes || null,
      actualFromExitSec: actualFromExit,
      actualToEntrySec: actualToEntry,
      beatSnapApplied: useBeatAlign && (beatSnapNotes.length > 0),
      curvesUsed: { curve1, curve2 },
      extraProcessing: extraFilters ? [extraFilters] : [],
      estimatedQuality: Math.round(75 + (useBeatAlign ? 8 : 0) + (style === 'mashup_layer' ? -5 : 5))
    });

    // Build rich return data for the agent and future evaluation
    const curvesUsed = { curve1, curve2 };
    const extraProcessingApplied = extraFilters ? [extraFilters] : [];

    res.json({
      success: true,
      outputPath: outputTransitionPath,
      actualFromExitSec: fromStart + transitionDuration,
      actualToEntrySec: toStart,
      // These two fields are the safest values to use when trimming the "main" snippets
      // for the final concatenation command (to avoid double audio or gaps)
      recommendedMainSnippetAEndSec: fromStart + transitionDuration,
      recommendedMainSnippetBStartSec: toStart,
      styleUsed: style,
      durationUsed: transitionDuration,
      beatAligned: useBeatAlign,
      beatSnapApplied: useBeatAlign && (beatSnapNotes.length > 0),
      beatSnapDistance: useBeatAlign ? Math.max(0, parseFloat(beatSnapNotes.match(/offset ([\d.]+)/)?.[1] || '0')) : 0,
      curvesUsed,
      extraProcessing: extraProcessingApplied,
      notes: finalNotes.trim(),
      estimatedQuality: Math.round(75 + (useBeatAlign ? 8 : 0) + (style === 'mashup_layer' ? -5 : 5)),
      assemblyHint: "Use actualFromExitSec / actualToEntrySec (or the recommended* fields) to trim the main snippets before concatenating with this transition file. Do NOT concat the full original snippets + this transition file."
    });

  } catch (err: any) {
    if (sessionId) delete activeRenderProcesses[sessionId];
    if (session?.projectBrief && transitionId) {
      if (!session.executionResults) session.executionResults = {};
      if (!session.executionResults[executionVersion]) session.executionResults[executionVersion] = {};
      session.executionResults[executionVersion][transitionId] = {
        request: {
          transitionId,
          fromTrackId,
          fromSectionId,
          toTrackId,
          toSectionId,
          style,
          duration: transitionDuration,
          beatAlign: useBeatAlign,
          notes,
        },
        success: false,
        actualFromExitSec: null,
        actualToEntrySec: null,
        previewPath: null,
        error: err.message,
      };
    }
    console.error('[apply-transition] Error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to apply transition',
      details: err.message,
      style: style,
      from: `${fromTrackId}:${fromSectionId}`,
      to: `${toTrackId}:${toSectionId}`,
      attemptedDuration: transitionDuration,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

// === Style Configuration (Pluggable - Phase 1 of Refinements) ===

export interface TransitionStyleConfig {
  curve1: string;
  curve2: string;
  extraFilters: string;
  isMashup: boolean;
  // Future extensibility: layerMixRatio, automationHints, etc.
}

/**
 * Central pluggable configuration for transition styles.
 * Used by both preview rendering (apply_musical_transition) and final render (finalize_medley).
 * Adding new styles or tuning existing ones only requires changes here.
 */
export function getTransitionStyleConfig(style: string): TransitionStyleConfig {
  switch (style) {
    case 'smooth_blend':
      return { curve1: 'tri', curve2: 'tri', extraFilters: '', isMashup: false };

    case 'beat_aligned':
      return { curve1: 'log', curve2: 'log', extraFilters: '', isMashup: false };

    case 'energy_ramp':
      return { curve1: 'exp', curve2: 'exp', extraFilters: ',highpass=f=80', isMashup: false };

    case 'harmonic_blend':
      return { curve1: 'tri', curve2: 'tri', extraFilters: ',equalizer=f=200:width_type=h:width=1:g=-2', isMashup: false };

    case 'dramatic_cut':
      return { curve1: 'exp', curve2: 'exp', extraFilters: '', isMashup: false };

    case 'reset_moment':
      return { curve1: 'log', curve2: 'log', extraFilters: '', isMashup: false };

    case 'mashup_layer':
      // Current conservative values (inherited from preview path).
      // Will be tuned in the next refinement step.
      return {
        curve1: 'tri',
        curve2: 'tri',
        extraFilters: ',equalizer=f=250:width_type=h:width=2:g=-4,equalizer=f=4000:width_type=h:width=2:g=-3',
        isMashup: true
      };

    default:
      return { curve1: 'tri', curve2: 'tri', extraFilters: '', isMashup: false };
  }
}

// === PURE CLEAN RENDER (with Phase 4 mashup_layer branching) ===
// Original sources only + single-pass filter_complex_script.
// Supports normal sequential crossfades + branched simultaneous layering for style === 'mashup_layer'.
// - Single final loudnorm=I=-14:TP=-1.5 + alimiter=limit=0.891:level=off on master (once)
// - Deterministic labels: seg_0, seg_1, ..., xfade_0, xfade_1, ..., master_out
// - MANDATORY -filter_complex_script → temp_filtergraph.txt
// - Always writes ffmpeg_command.txt + ffmpeg_stderr.log (plus the graph)
// - Hard fail + structured error (NO fallback, NO silent output via any other path)
// - Success response always includes renderPath: "pure-clean-mvp-single-pass" for unambiguous traceability
//
// TEST PROCEDURE (2-3 track case for verification):
// 1. Start the app normally (npm run dev or equivalent that runs tsx server.ts + frontend).
// 2. In the UI, pick 2 or 3 tracks from your library.
// 3. Let the autonomous loop run through ANALYZE → DESIGN → set_design_plan → BUILD (it will call apply_musical_transition for previews only).
// 4. The loop MUST end by calling finalize_medley (the prompt already requires this).
// 5. After it finishes, go to workdir/<sessionId>/ and inspect:
//    - temp_filtergraph.txt   (the exact filter_complex script that was used)
//    - ffmpeg_command.txt     (the full command line)
//    - ffmpeg_stderr.log      (full output — should be clean on success)
//    - The final .mp3
// 6. Listen to the output. There must be ZERO silent gaps at the joins, continuous audio, proper crossfades.
//    If any gap or glitch appears, the three log files + the graph file give the exact cause (bad trim, duration too long, source missing, etc.).
// 7. On any failure the route returns 500 + finalize_error.json with noFallback: true.
//
// This is the ONLY production render path for the final medley now.
app.post('/api/render-review-candidate', async (req, res) => {
  const { sessionId, parentCandidateId = null, legacy = false } = req.body || {};
  let arrangementVersion = Number(req.body?.arrangementVersion || 0);
  let executionVersion = Number(req.body?.executionVersion || 0);

  if (!sessionId || (!legacy && (!arrangementVersion || !executionVersion))) {
    return res.status(400).json({ success: false, error: 'sessionId, arrangementVersion, and executionVersion are required' });
  }

  try {
    validateSessionId(sessionId);
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error.message });
  }

  return withSessionLock(sessionId, async () => {

  const session = sessions[sessionId];
  if (!session || !session.designPlan) {
    return res.status(400).json({ success: false, error: 'No design plan found for this session. Call set_design_plan first.' });
  }
  if (legacy) {
    arrangementVersion = 1;
    executionVersion = 1;
    const transitions = (session.designPlan.transitions || []).map((transition: any, index: number) => ({
      transitionId: transition.transitionId || `legacy-transition-${index + 1}`,
      fromTrackId: transition.fromTrackId,
      fromSectionId: transition.fromSectionId,
      toTrackId: transition.toTrackId,
      toSectionId: transition.toSectionId,
      fromExitSec: Number(transition.actualFromExitSec ?? transition.fromExitSec ?? transition.exitSec ?? 0),
      toEntrySec: Number(transition.actualToEntrySec ?? transition.toEntrySec ?? transition.entrySec ?? 0),
      duration: Number(transition.durationUsed ?? transition.duration ?? 5),
      style: transition.style || 'smooth_blend',
      beatAlign: transition.beatAlign ?? true,
      notes: transition.notes || '',
      ...transition,
    }));
    session.designPlan = {
      schemaVersion: 1,
      arrangementVersion,
      projectId: sessionId,
      strategy: 'Legacy manual workflow',
      orderedTrackIds: [
        transitions[0]?.fromTrackId,
        ...transitions.map((transition: any) => transition.toTrackId),
      ].filter(Boolean),
      transitions,
      confidence: 0.5,
      warnings: ['Generated from a legacy manual session'],
    };
    session.executionReport = {
      schemaVersion: 1,
      executionVersion,
      arrangementVersion,
      attemptedTransitions: transitions.map((transition: any) => ({
        ...transition,
        success: true,
        actualFromExitSec: transition.actualFromExitSec ?? transition.fromExitSec,
        actualToEntrySec: transition.actualToEntrySec ?? transition.toEntrySec,
        previewPath: transition.outputPath ?? null,
        error: null,
      })),
      technicalWarnings: ['Legacy manual execution report'],
      unresolvedFailures: [],
      completedAt: new Date().toISOString(),
    };
  }
  if (!session.executionReport) {
    return res.status(400).json({ success: false, error: 'No validated execution report found for this session.' });
  }
  if (session.designPlan.arrangementVersion !== arrangementVersion ||
      session.executionReport.executionVersion !== executionVersion) {
    return res.status(400).json({ success: false, error: 'Arrangement or execution version mismatch.' });
  }

  const designPlan = session.designPlan;
  const sessionWorkDir = getSessionDirectory(workDir, sessionId);
  if (!fs.existsSync(sessionWorkDir)) {
    fs.mkdirSync(sessionWorkDir, { recursive: true });
  }
  const manifest = readCandidateManifest(workDir, sessionId);
  const { candidateId, candidateVersion } = nextCandidateIdentity(manifest);
  assertCandidateStorageAvailable(workDir, sessionId, 150 * 1024 * 1024);
  const safeMp3Name = `${candidateId}.mp3.part`;
  const outputPath = path.join(sessionWorkDir, safeMp3Name);
  const artifactPrefix = candidateId;
  const graphName = `${artifactPrefix}-filtergraph.txt`;

  // Clean up any old confusing filtergraph.txt from previous code paths
  const oldGraph = path.join(sessionWorkDir, 'filtergraph.txt');
  if (fs.existsSync(oldGraph)) {
    try { fs.unlinkSync(oldGraph); } catch {}
  }

  console.log(`[finalize-medley] >>> ENTERING PURE-CLEAN-MVP ONLY PATH (no fallbacks) for session ${sessionId}`);
  console.log(`[finalize-medley] This handler will ONLY produce output via the single-pass filter_complex_script route. Any other output is from outside this path.`);

  if (sessionId) {
    logToSession(sessionId, `[candidate-render] Starting review render for ${candidateId}`);
  }

  try {
    const executionByTransitionId = new Map(
      session.executionReport.attemptedTransitions.map((item: any) => [item.transitionId, item]),
    );
    const transitions: any[] = Array.isArray(designPlan.transitions)
      ? designPlan.transitions.map((planned: any) => {
          const executed: any = executionByTransitionId.get(planned.transitionId);
          return {
            ...planned,
            actualFromExitSec: executed?.actualFromExitSec ?? planned.actualFromExitSec,
            actualToEntrySec: executed?.actualToEntrySec ?? planned.actualToEntrySec,
            durationUsed: executed?.duration ?? planned.durationUsed,
            outputPath: executed?.previewPath ?? planned.outputPath,
          };
        })
      : [];
    if (transitions.length === 0) {
      throw new Error('MVP finalize_medley requires at least one transition to establish deterministic track ordering and crossfade points. Single-track support is out of current strict scope.');
    }

    // === TIMING NORMALIZATION: resolve final timing values with fallback chain ===
    // Priority: actualFromExitSec → fromExitSec → exitSec (and same for entry side).
    // apply_musical_transition may have been called before set_design_plan, so actual* fields
    // may be absent from the plan object but the planned fields may still be usable.
    // We resolve once here and mutate each transition with _resolvedFromExitSec / _resolvedToEntrySec
    // so all downstream code (preflight + segment derivation) uses a single consistent value.
    const badTransitions: string[] = [];
    transitions.forEach((t: any, idx: number) => {
      const resolveFrom = (): number | undefined => {
        if (isFinite(Number(t.actualFromExitSec))) return Number(t.actualFromExitSec);
        if (isFinite(Number(t.fromExitSec))) {
          logToSession(sessionId, `[finalize-medley] Using planned timing fallback (fromExitSec) for transition[${idx}]`);
          console.log(`[finalize-medley] Timing fallback: transition[${idx}] actualFromExitSec missing, using fromExitSec=${t.fromExitSec}`);
          return Number(t.fromExitSec);
        }
        if (isFinite(Number(t.exitSec))) {
          logToSession(sessionId, `[finalize-medley] Using planned timing fallback (exitSec) for transition[${idx}]`);
          console.log(`[finalize-medley] Timing fallback: transition[${idx}] actualFromExitSec missing, using exitSec=${t.exitSec}`);
          return Number(t.exitSec);
        }
        return undefined;
      };
      const resolveTo = (): number | undefined => {
        if (isFinite(Number(t.actualToEntrySec))) return Number(t.actualToEntrySec);
        if (isFinite(Number(t.toEntrySec))) {
          logToSession(sessionId, `[finalize-medley] Using planned timing fallback (toEntrySec) for transition[${idx}]`);
          console.log(`[finalize-medley] Timing fallback: transition[${idx}] actualToEntrySec missing, using toEntrySec=${t.toEntrySec}`);
          return Number(t.toEntrySec);
        }
        if (isFinite(Number(t.entrySec))) {
          logToSession(sessionId, `[finalize-medley] Using planned timing fallback (entrySec) for transition[${idx}]`);
          console.log(`[finalize-medley] Timing fallback: transition[${idx}] actualToEntrySec missing, using entrySec=${t.entrySec}`);
          return Number(t.entrySec);
        }
        return undefined;
      };

      const fromExit = resolveFrom();
      const toEntry = resolveTo();

      if (fromExit === undefined || toEntry === undefined) {
        badTransitions.push(
          `transition[${idx}] ${t.fromTrackId}:${t.fromSectionId} → ${t.toTrackId}:${t.toSectionId} ` +
          `has no usable exit timing (tried actualFromExitSec, fromExitSec, exitSec=${t.actualFromExitSec}/${t.fromExitSec}/${t.exitSec}) ` +
          `or entry timing (tried actualToEntrySec, toEntrySec, entrySec=${t.actualToEntrySec}/${t.toEntrySec}/${t.entrySec}). ` +
          `Call apply_musical_transition for this pair before calling finalize_medley.`
        );
      } else {
        // Store resolved values for uniform use in preflight and segment derivation
        t._resolvedFromExitSec = fromExit;
        t._resolvedToEntrySec = toEntry;
      }
    });

    if (badTransitions.length > 0) {
      throw new Error(
        'PURE-CLEAN-MVP ABORT: One or more transitions have no usable timing from any field.\n' +
        'Call apply_musical_transition for each transition before finalize_medley.\n\n' +
        badTransitions.join('\n')
      );
    }

    if (sessionId) {
      logToSession(sessionId, `[finalize-medley] Progress: Validation passed. Building segments for ${transitions.length} transitions...`);
    }

    // Library → file path lookup (also builds duration map for preflight)
    const library = getLibrary();
    const trackPathMap: Record<string, string> = {};
    const trackDurationMap: Record<string, number> = {};
    library.forEach((entry: any) => {
      if (entry && entry.id) {
        trackPathMap[entry.id] = entry.path;
        // Use localAnalysis duration if available from pre-analysis
        if (entry.localAnalysis?.duration && entry.localAnalysis.duration > 0) {
          trackDurationMap[entry.id] = entry.localAnalysis.duration;
        } else if (entry.analysis && typeof entry.analysis === 'object' && entry.analysis.duration > 0) {
          trackDurationMap[entry.id] = entry.analysis.duration;
        }
      }
    });

    // === PREFLIGHT: Validate all timestamps against actual track durations ===
    if (sessionId) {
      logToSession(sessionId, `[finalize-medley] Preflight: Validating timestamps against actual track durations...`);
    }

    const preflightErrors: string[] = [];
    const uniqueTrackIds = new Set<string>();
    transitions.forEach((t: any) => {
      uniqueTrackIds.add(t.fromTrackId);
      uniqueTrackIds.add(t.toTrackId);
    });

    // Dynamic ffprobe fallback: query duration for any track missing from library metadata
    for (const trackId of uniqueTrackIds) {
      if (!trackDurationMap[trackId]) {
        const trackPath = trackPathMap[trackId];
        if (trackPath && fs.existsSync(trackPath)) {
          try {
            const probedDuration = await queryTrackDuration(trackPath);
            if (probedDuration > 0) {
              trackDurationMap[trackId] = probedDuration;
              console.log(`[finalize-medley] Preflight: Probed duration for ${trackId} = ${probedDuration.toFixed(2)}s`);
            }
          } catch (e: any) {
            console.warn(`[finalize-medley] Preflight: Could not probe duration for ${trackId}: ${e.message}`);
          }
        }
      }
    }

    // Path traversal validation
    for (const trackId of uniqueTrackIds) {
      const trackPath = trackPathMap[trackId];
      if (trackPath) {
        if (!isPathInside(trackPath, libraryDir) && !isPathInside(trackPath, workDir)) {
          preflightErrors.push(`PATH_TRAVERSAL: Track ${trackId} path "${trackPath}" is outside allowed directories.`);
        }
      }
    }

    // Timing bounds validation against actual durations (using resolved values from normalization step)
    for (let i = 0; i < transitions.length; i++) {
      const t = transitions[i];
      let fromExit = t._resolvedFromExitSec as number;
      let toEntry = t._resolvedToEntrySec as number;
      const fromDuration = trackDurationMap[t.fromTrackId];
      const toDuration = trackDurationMap[t.toTrackId];

      if (fromDuration !== undefined) {
        if (fromExit > fromDuration + RENDER_CONFIG.TIMING_TOLERANCE) {
          preflightErrors.push(
            `TIMING_OUT_OF_BOUNDS: transition[${i}] fromTrackId=${t.fromTrackId} exitSec=${fromExit} exceeds actual duration=${fromDuration.toFixed(2)}s by more than ${RENDER_CONFIG.TIMING_TOLERANCE}s tolerance`
          );
        } else if (fromExit > fromDuration) {
          // Small float/metadata rounding — clamp to actual duration
          const clamped = fromDuration;
          console.log(`[finalize-medley] Clamped transition[${i}] exitSec from ${fromExit} to actual duration ${clamped.toFixed(3)}s`);
          logToSession(sessionId, `[finalize-medley] Clamped transition[${i}] exitSec from ${fromExit} to actual duration ${clamped.toFixed(3)}s`);
          t._resolvedFromExitSec = clamped;
          fromExit = clamped;
        }
      }
      if (toDuration !== undefined) {
        if (toEntry < 0) {
          if (Math.abs(toEntry) <= RENDER_CONFIG.TIMING_TOLERANCE) {
            console.log(`[finalize-medley] Clamped transition[${i}] entrySec from ${toEntry} to 0`);
            logToSession(sessionId, `[finalize-medley] Clamped transition[${i}] entrySec from ${toEntry} to 0`);
            t._resolvedToEntrySec = 0;
          } else {
            preflightErrors.push(
              `TIMING_OUT_OF_BOUNDS: transition[${i}] toTrackId=${t.toTrackId} entrySec=${toEntry} is negative beyond tolerance`
            );
          }
        } else if (toEntry > toDuration + RENDER_CONFIG.TIMING_TOLERANCE) {
          preflightErrors.push(
            `TIMING_OUT_OF_BOUNDS: transition[${i}] toTrackId=${t.toTrackId} entrySec=${toEntry} exceeds actual duration=${toDuration.toFixed(2)}s by more than ${RENDER_CONFIG.TIMING_TOLERANCE}s tolerance`
          );
        } else if (toEntry > toDuration) {
          const clamped = toDuration;
          console.log(`[finalize-medley] Clamped transition[${i}] entrySec from ${toEntry} to actual duration ${clamped.toFixed(3)}s`);
          logToSession(sessionId, `[finalize-medley] Clamped transition[${i}] entrySec from ${toEntry} to actual duration ${clamped.toFixed(3)}s`);
          t._resolvedToEntrySec = clamped;
        }
      }
    }

    if (preflightErrors.length > 0) {
      throw new Error(
        'PREFLIGHT VALIDATION FAILED — render aborted before FFmpeg execution.\n' +
        preflightErrors.join('\n')
      );
    }

    if (sessionId) {
      logToSession(sessionId, `[finalize-medley] Preflight: All ${uniqueTrackIds.size} tracks passed validation. Proceeding to segment derivation...`);
    }

    // === 1. Derive deterministic ordered segments (using ONLY the validated actual* values) ===
    const segments: Array<{
      trackId: string;
      srcPath: string;
      start: number;
      end: number | null;
      label: string;
    }> = [];
    const xfadeDurations: number[] = [];
    const joinStyles: string[] = [];  // Phase 4: per-join style for branching (mashup_layer etc.)

    console.log(`[finalize-medley] Building pure-clean segments for ${transitions.length} transitions (session ${sessionId})`);
    if (sessionId) {
      logToSession(sessionId, `[finalize-medley] Progress: Deriving segments and timings...`);
    }

    for (let i = 0; i < transitions.length; i++) {
      const t = transitions[i];

      // Use resolved values (set by normalization step — actual* or planned fallback, clamped if needed).
      const fromExit = Number(t._resolvedFromExitSec);
      const toEntry = Number(t._resolvedToEntrySec);
      const dur = Number(t.durationUsed ?? t.duration ?? t.crossfadeDuration ?? 4.0);

      console.log(
        `[finalize-medley]   seg${i}: from=${t.fromTrackId} exit=${fromExit}s → to=${t.toTrackId} entry=${toEntry}s (xfade=${dur}s)`
      );

      if (i === 0) {
        const fromPath = trackPathMap[t.fromTrackId];
        if (!fromPath || !fs.existsSync(fromPath)) {
          throw new Error(`Source audio file MISSING for first track ${t.fromTrackId}: ${fromPath || '(no path in library)'}`);
        }
        segments.push({
          trackId: t.fromTrackId,
          srcPath: fromPath,
          start: 0,
          end: fromExit,
          label: 'seg_0'
        });
      }

      const toPath = trackPathMap[t.toTrackId];
      if (!toPath || !fs.existsSync(toPath)) {
        throw new Error(`Source audio file MISSING for track ${t.toTrackId}: ${toPath || '(no path in library)'}`);
      }

      const nextT = transitions[i + 1];
      let nextExit: number | null = nextT ? Number(nextT._resolvedFromExitSec) : null;

      // === ADAPTIVE TAIL: For the LAST segment (no subsequent transition), cap the tail ===
      if (nextExit === null) {
        const toDuration = trackDurationMap[t.toTrackId];
        const tailLimit = Math.max(
          RENDER_CONFIG.MIN_TAIL_SEC,
          Math.min(RENDER_CONFIG.MAX_TAIL_SEC, RENDER_CONFIG.DEFAULT_TAIL_SEC)
        );
        if (toDuration !== undefined && toDuration > 0) {
          // Cap at entry + tailLimit, but don't exceed the track's actual duration
          const cappedEnd = Math.min(toDuration, toEntry + tailLimit);
          nextExit = cappedEnd;
          console.log(
            `[finalize-medley] Adaptive tail: last segment ${t.toTrackId} capped at ${cappedEnd.toFixed(2)}s ` +
            `(entry=${toEntry}s + tailLimit=${tailLimit}s, trackDuration=${toDuration.toFixed(2)}s)`
          );
        } else {
          // No duration info — apply a hard tail cap from entry point
          nextExit = toEntry + tailLimit;
          console.warn(
            `[finalize-medley] Adaptive tail: no duration for ${t.toTrackId}, hard-capping at entry+${tailLimit}s = ${nextExit.toFixed(2)}s`
          );
        }

        if (sessionId) {
          logToSession(sessionId, `[finalize-medley] Adaptive tail: final segment capped at ${nextExit.toFixed(2)}s`);
        }
      }

      segments.push({
        trackId: t.toTrackId,
        srcPath: toPath,
        start: toEntry,
        end: nextExit,
        label: `seg_${segments.length}`
      });

      xfadeDurations.push(dur);
      joinStyles.push(t.style || 'smooth_blend');
    }

    console.log(`[finalize-medley] Derived ${segments.length} segments with validated timings.`);
    const mashupCount = joinStyles.filter(s => s === 'mashup_layer').length;
    if (mashupCount > 0) {
      console.log(`[finalize-medley] Phase 4 mashup_layer branching active on ${mashupCount} join(s).`);
    }

    const numSegments = segments.length;
    if (numSegments < 2) {
      throw new Error('MVP requires at least two segments to form a crossfade chain');
    }

    // === 2. Hard validation (fail fast, structured, no silent recovery) ===
    for (let i = 0; i < numSegments; i++) {
      const s = segments[i];
      if (s.end !== null && s.start >= s.end) {
        throw new Error(`INVALID TRIM on ${s.label} (track ${s.trackId}): start=${s.start} >= end=${s.end}`);
      }
      if (s.start < 0) {
        throw new Error(`INVALID TRIM on ${s.label}: negative start time ${s.start}`);
      }
    }
    for (let i = 0; i < xfadeDurations.length; i++) {
      const d = xfadeDurations[i];
      if (!(d > 0 && d <= 30)) {
        throw new Error(`INVALID ACROSSFADE duration ${d}s at join ${i} (must be 0 < d <= 30)`);
      }
      const prevAvail = (segments[i].end ?? 999999) - segments[i].start;
      const nextAvail = (segments[i + 1].end ?? 999999) - segments[i + 1].start;
      if (d > prevAvail || d > nextAvail) {
        throw new Error(
          `ACROSSFADE d=${d}s EXCEEDS available audio at join ${i}: prevSeg=${prevAvail.toFixed(2)}s, nextSeg=${nextAvail.toFixed(2)}s`
        );
      }
    }

    // === 3. Build deterministic filter graph (linear chain only) ===
    const filterLines: string[] = [];
    const inputArgs: string[] = ['-y'];

    // One -i per segment (deterministic ordering, simple labels, original sources only)
    segments.forEach(seg => {
      inputArgs.push('-i', seg.srcPath);
    });

    // Per-input: mandatory normalization chain + atrim (exactly as specified)
    // For the LAST segment, inject afade fade-out for clean ending
    segments.forEach((seg, idx) => {
      const normChain = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,aresample=async=0,asetpts=PTS-STARTPTS';
      let atrim = `atrim=start=${seg.start}`;
      if (seg.end !== null && seg.end !== undefined) {
        atrim += `:end=${seg.end}`;
      }

      // Inject afade on the last segment for clean ending
      let fadeFilter = '';
      if (idx === segments.length - 1 && seg.end !== null && seg.end !== undefined) {
        const segDuration = seg.end - seg.start;
        const fadeDur = Math.min(RENDER_CONFIG.FADE_OUT_SECONDS, segDuration * 0.5);
        const fadeStart = Math.max(0, segDuration - fadeDur);
        fadeFilter = `,afade=t=out:st=${fadeStart.toFixed(3)}:d=${fadeDur.toFixed(3)}`;
      }

      filterLines.push(`[${idx}:a]${normChain},${atrim}${fadeFilter}[${seg.label}]`);
    });

    // === Phase 4+: Style-aware join graph construction (now powered by pluggable getTransitionStyleConfig) ===
    // Default is linear sequential acrossfade.
    // When styleConfig.isMashup, we generate branched simultaneous layering.
    let currentLabel = 'seg_0';
    for (let i = 0; i < xfadeDurations.length; i++) {
      const d = xfadeDurations[i];
      const nextLabel = `seg_${i + 1}`;
      const style = joinStyles[i] || 'smooth_blend';
      const styleConfig = getTransitionStyleConfig(style);

      if (styleConfig.isMashup) {
        // Phase 4: True simultaneous layering (mashup) — now driven by pluggable config
        const layerLabel = `layer_${i}`;
        const mixedLabel = `mixed_${i}`;

        // Use the extraFilters from the style config for the layer
        filterLines.push(`[${nextLabel}]${styleConfig.extraFilters.replace(/^,/, '')}[${layerLabel}]`);

        // Layer it simultaneously with the current main using amix
        filterLines.push(`[${currentLabel}][${layerLabel}]amix=inputs=2:duration=first:dropout_transition=0[${mixedLabel}]`);

        // The mixed result becomes the new current for subsequent joins
        currentLabel = mixedLabel;
      } else {
        // Standard sequential crossfade (original MVP behavior)
        const xfadeLabel = `xfade_${i}`;
        const extra = styleConfig.extraFilters ? styleConfig.extraFilters : '';
        filterLines.push(`[${currentLabel}][${nextLabel}]acrossfade=d=${d}:curve1=${styleConfig.curve1}:curve2=${styleConfig.curve2}${extra}[${xfadeLabel}]`);
        currentLabel = xfadeLabel;
      }
    }

    // SINGLE final master processing (loudnorm + limiter) applied exactly once to the end of the chain
    filterLines.push(`[${currentLabel}]loudnorm=I=-14:TP=-1.5,alimiter=limit=0.891:level=off[master_out]`);

    const fullGraph = filterLines.join(';\n');

    // === Compute expected medley duration for progress tracking ===
    let expectedDuration = 0;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const segDur = (seg.end ?? 999) - seg.start;
      expectedDuration += segDur;
    }
    // Subtract crossfade overlaps
    for (const xd of xfadeDurations) {
      expectedDuration -= xd;
    }
    expectedDuration = Math.max(1, expectedDuration);

    if (sessionId) {
      logToSession(sessionId, `[finalize-medley] Progress: Filter graph constructed (${filterLines.length} lines). Expected duration: ${expectedDuration.toFixed(1)}s. Starting FFmpeg...`);
    }

    // === 4. Command using -filter_complex_script (MANDATORY) ===
    const finalArgs = [
      ...inputArgs,
      '-filter_complex_script', graphName,
      '-map', '[master_out]',
      '-c:a', 'libmp3lame',
      '-b:a', '320k',
      '-f', 'mp3',
      safeMp3Name   // write inside sessionWorkDir (cwd for the run); safeMp3Name is already the basename
    ];

    // === 5. Execute with full artifact logging + hard failure + progress tracking ===
    // Compute watchdog timeout: 8x expected duration or minimum 5 minutes
    const watchdogTimeout = Math.max(300000, Math.round(expectedDuration * 8000));
    const renderStartTime = Date.now();

    try {
      var renderArtifacts = await runFfmpegWithStrictLogging(
        finalArgs,
        sessionWorkDir,
        fullGraph,
        watchdogTimeout,
        sessionId,
        expectedDuration,
        (proc) => {
          // Store for cancel support
          activeRenderProcesses[sessionId] = proc;
        },
        artifactPrefix
      );
    } catch (ffErr: any) {
      delete activeRenderProcesses[sessionId];
      // Hard fail — caller sees the three log files + clear cause
      throw new Error(`FFmpeg render failed: ${ffErr.message}. Inspect temp_filtergraph.txt, ffmpeg_command.txt, and ffmpeg_stderr.log in the session folder.`);
    }

    delete activeRenderProcesses[sessionId];
    const renderElapsed = (Date.now() - renderStartTime) / 1000;

    const immutableOutputPath = path.join(sessionWorkDir, `${candidateId}.mp3`);
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size <= 0) {
      throw new Error('Candidate render produced no usable audio file');
    }
    const durationSec = await queryTrackDuration(outputPath);
    if (!(durationSec > 0)) throw new Error('Candidate duration validation failed');
    const quality = await analyzeMedleyQuality(outputPath, sessionWorkDir);
    fs.renameSync(outputPath, immutableOutputPath);
    const sizeBytes = fs.statSync(immutableOutputPath).size;
    const sha256 = sha256File(immutableOutputPath);
    const previewPaths = session.executionReport.attemptedTransitions
      .map((item: any) => item.previewPath)
      .map((item: unknown) => getServerGeneratedPreviewPath(sessionId, item))
      .filter((item: string | null): item is string => item !== null);
    const validationPath = path.join(sessionWorkDir, `${candidateId}-validation.json`);
    const candidate = {
      candidateId,
      candidateVersion,
      parentCandidateId,
      arrangementVersion,
      executionVersion,
      outputPath: immutableOutputPath,
      debugPaths: [renderArtifacts.graphFile, renderArtifacts.commandLog, renderArtifacts.stderrLog, validationPath],
      previewPaths,
      sizeBytes,
      sha256,
      durationSec,
      technicallyValid: true,
      metrics: {},
      reviewStatus: 'pending' as const,
      warnings: [quality.overallQualityNote],
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      validationPath,
      JSON.stringify({ candidate, quality }, null, 2),
      'utf8',
    );
    const updatedManifest = registerCandidate(workDir, sessionId, candidate);
    sessions[sessionId].workflowStage = 'quality_review';
    sessions[sessionId].currentCandidate = candidate;

    console.log(`[candidate-render] SUCCESS. Output: ${immutableOutputPath} (render took ${renderElapsed.toFixed(1)}s)`);

    // === Wisdom logging: Record successful render metrics ===
    try {
      appendWisdom({
        type: 'candidate_render_success',
        sessionId,
        renderDurationSec: Math.round(renderElapsed),
        expectedMedleyDurationSec: Math.round(expectedDuration),
        segmentCount: numSegments,
        crossfadeCount: xfadeDurations.length,
        mashupBranches: mashupCount,
        styleMix: joinStyles.reduce((acc: Record<string, number>, s) => { acc[s] = (acc[s] || 0) + 1; return acc; }, {}),
        outputFile: path.basename(immutableOutputPath)
      });
    } catch (e) {
      console.warn('[finalize-medley] Could not log wisdom:', e);
    }

    if (sessionId) {
      logToSession(sessionId, `[candidate-render] Review candidate ${candidateId} complete in ${renderElapsed.toFixed(1)}s.`);
      broadcastToSession(sessionId, 'progress', { stage: 'quality_review', percent: 100 });
    }

    return res.json({
      success: true,
      candidate,
      manifest: updatedManifest,
      quality,
      outputPath: immutableOutputPath,
      renderPath: "pure-clean-mvp-single-pass",   // unambiguous marker
      mashupBranches: mashupCount,
      renderDurationSec: Math.round(renderElapsed),
      expectedMedleyDurationSec: Math.round(expectedDuration),
      message: 'Review candidate rendered through the deterministic pure-clean single-pass path.',
      usedPureCleanMVP: true,
      graphFile: renderArtifacts.graphFile,
      commandLog: renderArtifacts.commandLog,
      stderrLog: renderArtifacts.stderrLog,
      segments: numSegments,
      crossfades: xfadeDurations.length
    });

  } catch (err: any) {
    fs.rmSync(outputPath, { force: true });
    console.error('[candidate-render] HARD FAIL (no fallback, no silent concat):', err.message);

    // Always attempt to leave a structured error artifact for the user/agent
    try {
      const errJsonPath = path.join(sessionWorkDir, `${artifactPrefix}-error.json`);
      fs.writeFileSync(errJsonPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        sessionId,
        error: err.message,
        stack: err.stack,
        note: 'This was a hard failure while rendering a review candidate. Existing valid candidates were preserved.'
      }, null, 2), 'utf8');
    } catch (logErr) {
      console.error('[finalize-medley] Could not write finalize_error.json:', logErr);
    }

    res.status(500).json({
      success: false,
      error: err.message || 'Failed to render review candidate',
      noFallback: true,
      renderPath: "pure-clean-mvp-failed",
      note: "No medley file was written by this handler. Any existing .mp3 in the folder came from outside the pure-clean path.",
      logFiles: {
        error: path.join(sessionWorkDir, `${artifactPrefix}-error.json`),
        graph: path.join(sessionWorkDir, `${artifactPrefix}-filtergraph.txt`),
        command: path.join(sessionWorkDir, `${artifactPrefix}-command.txt`),
        stderr: path.join(sessionWorkDir, `${artifactPrefix}-stderr.log`)
      },
      details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
  });
});

app.post('/api/finalize-medley', async (req, res) => {
  const { sessionId, candidateId, summary } = req.body || {};
  if (!sessionId || !candidateId || typeof summary !== 'string') {
    return res.status(400).json({ success: false, error: 'sessionId, candidateId, and summary are required' });
  }
  try {
    validateSessionId(sessionId);
    return await withSessionLock(sessionId, async () => {
      const promoted = promoteCandidate(workDir, sessionId, candidateId);
      const finalAudioPath = promoted.finalPath;
      const existingHistory = getHistory();
      const existingEntry = existingHistory.find((entry: any) => entry.id === sessionId);
      if (!existingEntry) {
        const session = sessions[sessionId] ?? { status: 'running', logs: [] };
        sessions[sessionId] = session;
        session.status = 'completed';
        session.finalAudioPath = finalAudioPath;
        session.summary = summary;
        session.workflowStage = 'completed';
        existingHistory.unshift({
          id: sessionId,
          completedAt: new Date().toISOString(),
          summary,
          finalAudioPath,
          metrics: session.metrics,
          designPlan: session.designPlan || null,
          candidateId,
          candidateManifestVersion: promoted.manifest.schemaVersion,
        });
        saveHistory(existingHistory);
        appendWisdom({
          type: 'completed_medley',
          sessionId,
          summary,
          metrics: session.metrics || null,
          designPlan: session.designPlan || null,
          finalAudioPath,
          candidateId,
          tracksInvolved: session.designPlan?.transitions?.map((t: any) => t.fromTrackId) || [],
        });
      } else {
        if (!sessions[sessionId]) sessions[sessionId] = { status: 'completed', logs: [] };
        sessions[sessionId].status = 'completed';
        sessions[sessionId].finalAudioPath = finalAudioPath;
        sessions[sessionId].summary = summary;
        sessions[sessionId].workflowStage = 'completed';
      }
      const checkpointPath = path.join(checkpointDir, `${sessionId}.json`);
      fs.rmSync(checkpointPath, { force: true });
      let cleanupWarning: string | null = null;
      try {
        cleanupRejectedCandidates(workDir, sessionId);
      } catch (error: any) {
        cleanupWarning = error.message;
      }
      broadcastToSession(sessionId, 'completed', { summary });
      return res.json({
        success: true,
        outputPath: finalAudioPath,
        candidateId,
        sha256: promoted.manifest.candidates.find(item => item.candidateId === candidateId)?.sha256,
        idempotent: promoted.idempotent,
        cleanupWarning,
      });
    });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

app.delete('/api/session/:sessionId/discard', async (req, res) => {
  const sessionId = req.params.sessionId;
  try {
    validateSessionId(sessionId);
    return await withSessionLock(sessionId, async () => {
      const proc = activeRenderProcesses[sessionId];
      if (proc && !proc.killed) proc.kill('SIGKILL');
      delete activeRenderProcesses[sessionId];
      const completedEntry = getHistory().find((entry: any) => entry.id === sessionId);
      if (!completedEntry) {
        const registeredPreviews = new Set<string>(
          (sessions[sessionId]?.registeredFiles || [])
            .map((item: unknown) => getServerGeneratedPreviewPath(sessionId, item))
            .filter((item: string | null): item is string => item !== null),
        );
        const checkpointPath = path.join(checkpointDir, `${sessionId}.json`);
        if (fs.existsSync(checkpointPath)) {
          try {
            const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
            for (const attempt of checkpoint.executionReport?.attemptedTransitions || []) {
              const preview = getServerGeneratedPreviewPath(sessionId, attempt.previewPath);
              if (preview) registeredPreviews.add(preview);
            }
          } catch {
            // A corrupt checkpoint must not broaden the set of files eligible for deletion.
          }
        }
        try {
          discardAutomaticSessionFiles(workDir, sessionId, [...registeredPreviews]);
        } catch (error: any) {
          if (!String(error.message).includes('manifest')) throw error;
        }
      }
      fs.rmSync(path.join(checkpointDir, `${sessionId}.json`), { force: true });
      delete sessions[sessionId];
      return res.json({ success: true });
    });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

// History endpoints
app.get('/api/history', (req, res) => {
  res.json(getHistory());
});

app.delete('/api/history/:id', (req, res) => {
  const history = getHistory();
  const filtered = history.filter((h: any) => h.id !== req.params.id);
  saveHistory(filtered);
  res.json({ success: true });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});


app.post('/api/exec', (req, res) => {
  const { command, sessionId } = req.body;
  if (!command) return res.status(400).json({ error: 'Command is required' });
  
  const sessionDir = path.join(workDir, sessionId || 'default');
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

  const session = sessionId ? sessions[sessionId] : null;
  const designPlan = session?.designPlan;

  // Lightweight plan awareness (personal project style — advisory, not hard blocking)
  let planNote = '';
  if (designPlan && designPlan.transitions && Array.isArray(designPlan.transitions)) {
    // Very simple heuristic: look for -ss and -t / -to in the command
    const ssMatch = command.match(/-ss\s+([\d.]+)/);
    const tMatch = command.match(/-t\s+([\d.]+)/) || command.match(/-to\s+([\d.]+)/);

    if (ssMatch) {
      const ss = parseFloat(ssMatch[1]);
      // Find if this looks like it's cutting one of the planned transitions
      const relevant = designPlan.transitions.find((t: any) => 
        Math.abs((t.fromExitSec || 0) - ss) < 3 || Math.abs((t.toEntrySec || 0) - ss) < 3
      );
      if (relevant) {
        planNote = ` [Plan reference: ${relevant.fromSectionId || ''} → ${relevant.toSectionId || ''}]`;
      }
    }
  }

  // Replace ffmpeg references with the bundled binary path
  const sanitizedCmd = command.replace(/\bffmpeg\b/g, `"${ffmpegPath}"`);

  exec(sanitizedCmd, { cwd: sessionDir, timeout: 120000 }, (err, stdout, stderr) => {
    const exitCode = err?.code ?? (err ? 1 : 0);
    const success = !err;

    const structuredResponse = {
      success,
      command: command,
      exitCode,
      stdout: stdout || '',
      stderr: stderr || '',
      error: err ? (err.message || String(err)) : null,
      planNote: planNote ? planNote.trim() : undefined,
      // Helpful for debugging weak models
      wasSuccessful: success,
      hasOutput: !!(stdout || stderr),
    };

    if (sessionId && sessions[sessionId]) {
      const shortLog = `CMD: ${command.substring(0, 70)}... ${success ? 'OK' : 'FAILED'}${planNote}`;
      logToSession(sessionId, shortLog);
    }

    // Always return rich structured data so the agent (and logs) can see exactly what happened
    res.json(structuredResponse);
  });
});

app.get('/api/file-read', (req, res) => {
  const { filePath } = req.query;
  if (!filePath) return res.status(400).json({ error: 'filePath is required' });
  try {
    const content = fs.readFileSync(filePath as string, 'utf-8');
    res.json({ content });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/file-write', (req, res) => {
  const { filePath, content } = req.body;
  if (!filePath || content === undefined) return res.status(400).json({ error: 'filePath and content are required' });
  try {
    fs.writeFileSync(filePath, content, 'utf-8');
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/library/analysis', (req, res) => {
  const { fileId, analysisText, sessionId } = req.body;
  if (!fileId || !analysisText) return res.status(400).json({ error: 'fileId and analysisText are required' });
  
  const library = getLibrary();
  const index = library.findIndex((f: any) => f.id === fileId);
  if (index !== -1) {
    library[index].analysis = analysisText;
    // Also keep a history of text analyses for this track (permanent)
    if (!library[index].analysisHistory) library[index].analysisHistory = [];
    library[index].analysisHistory.push({
      text: analysisText,
      at: new Date().toISOString(),
      sessionId: sessionId || null
    });
    saveLibrary(library);

    // Contribute to cross-session wisdom if we have context
    if (sessionId && sessions[sessionId]?.designPlan) {
      appendWisdom({
        type: 'file_analysis',
        fileId,
        analysisText: analysisText.substring(0, 800), // keep it reasonable size
        sessionId,
        designPlan: sessions[sessionId].designPlan
      });
    }

    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

app.post('/api/library/cache', (req, res) => {
  const { fileId, geminiFileUri, geminiFileExpires } = req.body;
  if (!fileId || !geminiFileUri || !geminiFileExpires) return res.status(400).json({ error: 'Missing fields' });
  
  if (updateLibraryEntry(fileId, { geminiFileUri, geminiFileExpires })) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

// Explicitly handle 404 for any other /api routes to avoid returning HTML
// This MUST be the last API route defined
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: `API route ${req.method} ${req.path} not found` });
});

async function startServer() {
  // Vite integration
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(process.cwd(), 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
