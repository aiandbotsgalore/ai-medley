import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import { exec, execFile } from 'child_process';
import { createServer as createViteServer } from 'vite';
import ffmpegPath from 'ffmpeg-static';
import MusicTempo from 'music-tempo';
import { buildMedleyDesignPayload, buildTrackIntelligence, evaluateSectionPair } from './src/engine/medleyIntelligence';
import type { TrackIntelligence } from './src/engine/medleyIntelligence';
import { analyzeLocalAudioFile, analyzeMedleyQuality } from './src/engine/localAudioAnalysis';

dotenv.config();

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

if (!fs.existsSync(libraryDir)) fs.mkdirSync(libraryDir);
if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir);
if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify([]));
if (!fs.existsSync(historyPath)) fs.writeFileSync(historyPath, JSON.stringify([]));

function isPathInside(childPath: string, parentPath: string) {
  const child = path.resolve(childPath).toLowerCase();
  const parent = path.resolve(parentPath).toLowerCase();
  return child === parent || child.startsWith(parent + path.sep);
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

function execFfmpeg(args: string[], timeout = 30000): Promise<string> {
  return new Promise((resolve) => {
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

  req.on('close', () => {
    sseClients[sessionId] = (sseClients[sessionId] || []).filter(c => c !== res);
  });
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

app.post('/api/session/finish', (req, res) => {
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
  
  // Save to history
  const history = getHistory();
  history.unshift({
    id: sessionId,
    completedAt: new Date().toISOString(),
    summary,
    finalAudioPath: resolvedAudioPath,
    metrics: sessions[sessionId]?.metrics
  });
  // Keep last 50 entries
  if (history.length > 50) history.length = 50;
  saveHistory(history);
  
  broadcastToSession(sessionId, 'completed', { summary });
  res.json({ success: true });
});

// Update metrics endpoint
app.post('/api/session/metrics', (req, res) => {
  const { sessionId, metrics } = req.body;
  if (sessions[sessionId]) {
    sessions[sessionId].metrics = { ...sessions[sessionId].metrics, ...metrics };
    broadcastToSession(sessionId, 'metrics', sessions[sessionId].metrics);
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

  res.json({
    success: true,
    design: buildMedleyDesignPayload({
      tracks,
      userConstraints: userConstraints || {},
      maxTransitions: 32
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

app.post('/api/session/design-plan', (req, res) => {
  const { sessionId, plan } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  if (!plan || !Array.isArray(plan.transitions)) {
    return res.status(400).json({ error: 'plan.transitions must be an array' });
  }
  if (!sessions[sessionId]) {
    sessions[sessionId] = { status: 'running', logs: [] };
  }
  sessions[sessionId].designPlan = plan;

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
    let output = '';
    if (stdout) output += `STDOUT:\n${stdout}\n`;
    if (stderr) output += `STDERR:\n${stderr}\n`;
    if (err) output += `ERROR:\n${err.message}\n`;
    
    if (sessionId && sessions[sessionId]) {
      logToSession(sessionId, `CMD: ${command.substring(0, 80)}...${planNote}`);
    }
    
    const response: any = { output: output || 'Success with no output.' };
    if (planNote) response.planNote = planNote.trim();
    
    res.json(response);
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
  const { fileId, analysisText } = req.body;
  if (!fileId || !analysisText) return res.status(400).json({ error: 'fileId and analysisText are required' });
  
  const library = getLibrary();
  const index = library.findIndex((f: any) => f.id === fileId);
  if (index !== -1) {
    library[index].analysis = analysisText;
    saveLibrary(library);
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
