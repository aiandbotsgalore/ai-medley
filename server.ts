import express from "express";
import http from "node:http";
import multer from "multer";
import fs from "fs";
import path from "path";
import os from "os";
import cors from "cors";
import dotenv from "dotenv";
import { v4 as uuidv4 } from "uuid";
import { exec, execFile, spawn } from "child_process";
import { createServer as createViteServer } from "vite";
import ffmpegPath from "ffmpeg-static";
import MusicTempo from "music-tempo";
import { GoogleGenAI } from "@google/genai";
import {
  ensureJsonArrayFile,
  readJsonArrayFile,
  writeJsonArrayFileAtomic,
} from "./src/server/jsonStore";
import {
  commitUploadedFiles,
  deleteLibraryEntryTransactional,
} from "./src/server/libraryPersistence";
import { recoverOrphanedLibraryAudio } from "./src/server/libraryRecovery";
import {
  buildMedleyDesignPayload,
  buildTrackIntelligence,
  evaluateSectionPair,
} from "./src/engine/medleyIntelligence";
import type { TrackIntelligence } from "./src/engine/medleyIntelligence";
import {
  analyzeLocalAudioFile,
  analyzeMedleyQuality,
} from "./src/engine/localAudioAnalysis";
import {
  ArrangementPlanSchema,
  AutomaticWorkflowCheckpointSchema,
  CandidateHumanReviewSchema,
  ExecutionReportSchema,
  ProjectBriefSchema,
  QualityReviewSchema,
  TransitionExecutionRequestSchema,
  createTransitionCandidateAuthority,
  bindLegacyArrangementAuthority,
  bindLegacyProjectBriefAuthority,
  formatValidationIssues,
  validateArrangementContext,
  validateExecutionContext,
  validateProjectBriefContext,
  validateTransitionExecutionContext,
  type ArrangementPlan,
  type SpecialistContext,
} from "./src/types/specialistWorkflow";
import {
  MANUAL_TOOL_CONTRACT_VERSION,
  parseManualToolCall,
} from "./src/engine/manualToolContracts";
import {
  MAX_MANUAL_TEXT_FILE_BYTES,
  assertContainedDiagnosticCommand,
  resolveContainedExistingFile,
  resolveSessionFileForRead,
  resolveSessionFileForWrite,
} from "./src/server/pathPolicy";
import {
  MAX_UPLOAD_FILE_BYTES,
  MAX_UPLOAD_FILES,
  SUPPORTED_AUDIO_EXTENSIONS,
  assertUploadCapacity,
  findDuplicateUpload,
  sha256File as sha256UploadFile,
  validateAudioProbe,
  validateUploadMetadata,
} from "./src/server/uploadPolicy";
import { moveUploadedAudioFile } from "./src/server/uploadTransfer";
import { redactSensitive } from "./src/server/redaction";
import {
  appendBoundedLog,
  assertProjectResourceBudget,
} from "./src/server/resourcePolicy";
import {
  buildArtifactInventory,
  summarizeArtifactInventory,
  type ArtifactReference,
} from "./src/server/artifactInventory";
import { resolveServerStartupConfig } from "./src/server/startupConfig";
import { selectLibraryEntriesById } from "./src/utils/librarySelection";
import {
  OpenRouterPreflightError,
  runOpenRouterPreflight,
} from "./src/server/openRouterPreflight";
import {
  applyCandidateReview,
  applyCandidateHumanReview,
  appendCandidateTechnicalEvaluation,
  assertRegisteredSafeFile,
  assertCandidateStorageAvailable,
  assertSessionArtifactBudget,
  discardAutomaticSessionFiles,
  getSessionDirectory,
  nextCandidateIdentity,
  promoteCandidate,
  readCandidateManifest,
  recoverRegisteredCandidateTechnicalEvaluation,
  recoverUnregisteredRenderedCandidate,
  registerCandidate,
  sha256File,
  validateLegacyFinalOutput,
  validateSessionId,
  withSessionLock,
  writeCandidateManifestAtomic,
} from "./src/server/candidateStore";
import {
  AUTOMATIC_GEMINI_MODELS,
  GeminiAudioReviewError,
  reviewCandidateAudioWithGemini,
  toQualityReviewFromAudioDecision,
} from "./src/server/geminiAudioReview";
import {
  getLocalAccessDenial,
  isAllowedLocalOrigin,
} from "./src/server/localAccess";
import {
  requiresAutomaticCandidateApproval,
  selectSessionTrackIntelligence,
} from "./src/server/automaticSessionGuard";
import { selectRenderTransitions } from "./src/server/renderTransitionSelection";
import { replayIdempotent, stableHash } from "./src/server/sessionIdempotency";
import {
  AUTOMATIC_WORKFLOW_VERSION,
} from "./src/types/automaticWorkflowV4";
import {
  DETERMINISTIC_DESIGN_ALGORITHM_VERSION,
  TRANSITION_SCORING_POLICY_VERSION,
  canonicalSha256,
  createDesignSnapshotV4,
} from "./src/server/automaticDesignV4";
import {
  readDesignSnapshotV4,
  writeArrangementVersionV1,
  writeDesignSnapshotV4,
} from "./src/server/automaticSessionArtifacts";
import {
  cancelAutomaticSessionState,
  readAutomaticIdempotencyResult,
  readAutomaticSessionState,
  replayAutomaticSessionIdempotent,
  transitionAutomaticSessionState,
  writeAutomaticSessionState,
} from "./src/server/automaticSessionState";
import {
  isRecoveredCandidateCompatibleWithExecution,
  sanitizeResolvedTransitionsForManifest,
} from "./src/server/transitionResolution";
import {
  buildCanonicalAcrossfade,
  getTransitionStyleConfig,
} from "./src/server/transitionGraph";
import { evaluateCandidateQuality } from "./src/server/candidateQualityGate";
import {
  assertExpectedPreviewArtifact,
  parseFfmpegAudioProbe,
} from "./src/server/audioArtifactProbe";
import {
  assertValidLocalAnalysis,
  hashAnalysisSource,
  isReusableLocalAnalysis,
} from "./src/server/analysisContract";
import { AnalysisJobRegistry, type AnalysisJob } from "./src/server/analysisJobRegistry";
import {
  SessionEventJournal,
  encodeSseEvent,
} from "./src/server/sessionEventJournal";
import {
  buildResumeBinding,
  compareResumeBinding,
} from "./src/server/checkpointBinding";
import { persistOpenRouterApiKey } from "./src/server/credentialStore";
import {
  collectTransitionTrackIds,
  executeFinalizationTransaction,
} from "./src/server/finalizationTransaction";
import { reconcileStartupState } from "./src/server/startupReconciliation";

const localEnvPath = path.join(process.cwd(), ".env.local");
dotenv.config({ path: [localEnvPath, path.join(process.cwd(), ".env")] });

const RENDER_CONFIG = {
  DEFAULT_TAIL_SEC: 30,
  MIN_TAIL_SEC: 5,
  MAX_TAIL_SEC: 60,
  FADE_OUT_SECONDS: 3.0,
  TIME_EPSILON: 1e-3, // Prevents off-by-one boundary failures
  TIMING_TOLERANCE: 0.25, // Clamp (not abort) for small float/metadata rounding overruns
  MAX_ERROR_LOG_LINES: 50, // Prevents memory bloating on large logs
  SSE_HEARTBEAT_MS: 15000, // Keeps proxy connections alive
  PROGRESS_RATE_LIMIT_MS: 250, // Prevents UI thread thrashing
};

const app = express();
const startup = resolveServerStartupConfig({
  cwd: process.cwd(),
  port: process.env.PORT,
  dataRoot: process.env.AI_MEDLEY_DATA_ROOT,
  ffmpegPath,
});
const PORT = startup.port;
const HOST = startup.host;

app.use((req, res, next) => {
  const denial = getLocalAccessDenial({
    method: req.method,
    origin: req.get("origin"),
    fetchSite: req.get("sec-fetch-site"),
    host: req.get("host"),
    expectedPort: String(PORT),
  });

  if (denial) {
    res.status(403).json({ error: denial });
    return;
  }

  next();
});
app.use(
  cors({
    origin(origin, callback) {
      callback(
        null,
        isAllowedLocalOrigin(origin, String(PORT)) ? origin || false : false,
      );
    },
  }),
);
app.use(express.json({ limit: "50mb" }));

// Ensure working directory exists
const workDir = startup.workDir;
if (!fs.existsSync(workDir)) {
  fs.mkdirSync(workDir);
}

const libraryDir = startup.libraryDir;
const audioDir = path.join(libraryDir, "audio");
const dbPath = path.join(libraryDir, "db.json");
const historyPath = path.join(libraryDir, "history.json");
const wisdomPath = path.join(libraryDir, "wisdom.json");
const checkpointDir = path.join(libraryDir, "checkpoints");

if (!fs.existsSync(libraryDir)) fs.mkdirSync(libraryDir);
if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir);
if (!fs.existsSync(checkpointDir)) fs.mkdirSync(checkpointDir);
ensureJsonArrayFile(dbPath);
ensureJsonArrayFile(historyPath);
ensureJsonArrayFile(wisdomPath);

function isPathInside(childPath: string, parentPath: string) {
  const child = path.resolve(childPath).toLowerCase();
  const parent = path.resolve(parentPath).toLowerCase();
  return child === parent || child.startsWith(parent + path.sep);
}

function getServerGeneratedPreviewPath(sessionId: string, value: unknown) {
  if (typeof value !== "string") return null;
  const sessionDir = getSessionDirectory(workDir, sessionId);
  const resolved = path.resolve(value);
  const name = path.basename(resolved);
  if (path.dirname(resolved) !== sessionDir) return null;
  if (!/^transition-exec-\d{3}-[a-zA-Z0-9_-]+\.mp3$/.test(name)) return null;
  return resolved;
}

function resolveReadableAudioPath(filePath: string, sessionId?: string) {
  let authorizedWorkRoot = workDir;
  if (sessionId) {
    try {
      validateSessionId(sessionId);
      authorizedWorkRoot = path.join(workDir, sessionId);
    } catch {
      return null;
    }
  }
  const candidates = path.isAbsolute(filePath)
    ? [filePath]
    : [
        sessionId ? path.join(workDir, sessionId, filePath) : "",
        path.join(workDir, filePath),
        path.join(audioDir, filePath),
      ].filter(Boolean);

  for (const candidate of candidates) {
    const resolved = resolveContainedExistingFile(candidate, [
      authorizedWorkRoot,
      audioDir,
    ]);
    if (resolved) return resolved;
  }
  return null;
}

function resolveLibraryAudioEntry(entry: any) {
  return entry?.path
    ? resolveContainedExistingFile(String(entry.path), [audioDir])
    : null;
}

function findSessionAudioPath(sessionId: string) {
  const historyEntry = getHistory().find(
    (entry: any) => entry.id === sessionId,
  );
  const session = sessions[sessionId];
  const candidates = [
    session?.finalAudioPath,
    historyEntry?.finalAudioPath,
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const resolved = resolveReadableAudioPath(candidate, sessionId);
    if (resolved) {
      if (!sessions[sessionId]) {
        sessions[sessionId] = {
          status: "completed",
          logs: [],
          finalAudioPath: resolved,
          summary: historyEntry?.summary,
          metrics: historyEntry?.metrics,
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
  const base = path.basename(audioPath).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
  if (base && path.extname(base)) return base;
  return `medley-${sessionId}.mp3`;
}

function retargetTrackIntelligence(
  intelligence: any,
  trackId: string,
  filename: string,
) {
  const oldTrackId = intelligence.profile.trackId;
  const replaceId = (value?: string) =>
    value ? value.replace(oldTrackId, trackId) : value;
  const remapScore = (score: any) => ({
    ...score,
    trackId,
    sectionId: replaceId(score.sectionId),
  });

  return {
    ...intelligence,
    profile: {
      ...intelligence.profile,
      trackId,
      filename,
    },
    localFacts: intelligence.localFacts.map((fact: any) => ({
      ...fact,
      trackId,
    })),
    sections: intelligence.sections.map((section: any) => ({
      ...section,
      trackId,
      sectionId: replaceId(section.sectionId),
    })),
    heuristicGuesses: intelligence.heuristicGuesses.map((guess: any) => ({
      ...guess,
      trackId,
      sectionId: replaceId(guess.sectionId),
    })),
    sectionScores: intelligence.sectionScores.map(remapScore),
    rankedHookCandidates: intelligence.rankedHookCandidates.map(remapScore),
    rankedEntryCandidates: intelligence.rankedEntryCandidates.map(remapScore),
    rankedExitCandidates: intelligence.rankedExitCandidates.map(remapScore),
    rankedResetCandidates: intelligence.rankedResetCandidates.map(remapScore),
    rankedFinaleCandidates: intelligence.rankedFinaleCandidates.map(remapScore),
  };
}

function getLibrary(): any[] {
  return readJsonArrayFile(dbPath);
}

function saveLibrary(data: any[]) {
  writeJsonArrayFileAtomic(dbPath, data);
}

function getHistory(): any[] {
  return readJsonArrayFile(historyPath);
}

function saveHistory(data: any[]) {
  writeJsonArrayFileAtomic(historyPath, data);
}

function getWisdom(): any[] {
  return readJsonArrayFile(wisdomPath);
}

function saveWisdom(data: any[]) {
  writeJsonArrayFileAtomic(wisdomPath, data);
}

// Wisdom entries are NEVER deleted. This is intentional for permanent cumulative learning.
function appendWisdom(entry: any) {
  const wisdom = getWisdom();
  wisdom.push({
    ...entry,
    recordedAt: new Date().toISOString(),
  });
  saveWisdom(wisdom);
}

/**
 * Snaps a time (in seconds) to the nearest beat from the provided beat array.
 * Returns the snapped time and the distance.
 */
function snapToNearestBeat(
  time: number,
  beats: number[],
): { snappedTime: number; distance: number } {
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
  options?: {
    rejectOnError?: boolean;
    onSpawned?: (proc: any) => void;
    signal?: AbortSignal;
  },
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (options?.signal?.aborted) {
      reject(new DOMException("FFmpeg operation cancelled", "AbortError"));
      return;
    }
    let settled = false;
    const proc = execFile(
      ffmpegPath!,
      args,
      { timeout, windowsHide: true },
      (err, stdout, stderr) => {
        if (settled) return;
        settled = true;
        options?.signal?.removeEventListener("abort", onAbort);
        const output = `${stdout || ""}${stderr || ""}`;
        if (err && options?.rejectOnError) {
          const failure = new Error(
            `FFmpeg exited unsuccessfully: ${err.message}`,
          );
          (failure as any).output = output;
          reject(failure);
          return;
        }
        resolve(output);
      },
    );
    const onAbort = () => {
      if (settled) return;
      settled = true;
      proc.kill("SIGKILL");
      reject(new DOMException("FFmpeg operation cancelled", "AbortError"));
    };
    options?.signal?.addEventListener("abort", onAbort, { once: true });
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
  artifactPrefix = "final",
): Promise<{ graphFile: string; commandLog: string; stderrLog: string }> {
  const graphFile = path.join(
    sessionWorkDir,
    `${artifactPrefix}-filtergraph.txt`,
  );
  const cmdLogFile = path.join(sessionWorkDir, `${artifactPrefix}-command.txt`);
  const stderrLogFile = path.join(
    sessionWorkDir,
    `${artifactPrefix}-stderr.log`,
  );

  // 1. Write the filter_complex_script (MANDATORY per production requirements)
  fs.writeFileSync(graphFile, graphScriptContent, "utf8");

  // 2. Write human-readable command log
  const quotedArgs = args.map((a) => {
    if (
      a.includes(" ") ||
      a.includes(":") ||
      a.includes("[") ||
      a.includes("]")
    ) {
      return `"${a}"`;
    }
    return a;
  });
  const humanCmd = `ffmpeg ${quotedArgs.join(" ")}`;
  const cmdLogContent = [
    humanCmd,
    "",
    "# === filter_complex_script contents (temp_filtergraph.txt) ===",
    graphScriptContent,
  ].join("\n");
  fs.writeFileSync(cmdLogFile, cmdLogContent, "utf8");

  // 3. Spawning with -progress pipe:1 and monitoring progress
  return new Promise((resolve, reject) => {
    // Inject auto-multithreading -threads 0 and progress tracking
    const optimizedArgs = [...args];

    // Inject progress pipe
    optimizedArgs.splice(optimizedArgs.length - 1, 0, "-progress", "pipe:1");

    // Inject auto-multithreading threads 0
    const threadsIdx = optimizedArgs.indexOf("-threads");
    if (threadsIdx === -1) {
      optimizedArgs.splice(optimizedArgs.length - 1, 0, "-threads", "0");
    }

    console.log(`[FFmpeg Spawn] Cwd: ${sessionWorkDir}`);
    console.log(`[FFmpeg Spawn] Args: ${optimizedArgs.join(" ")}`);

    const ffmpegProc = spawn(ffmpegPath!, optimizedArgs, {
      cwd: sessionWorkDir,
      windowsHide: true,
    });

    if (onSpawned) {
      onSpawned(ffmpegProc);
    }

    let stderrBuffer = "";
    let stdoutBuffer = "";

    // Watchdog timer
    const watchdogTimer = setTimeout(() => {
      console.error(
        `[Watchdog] Timeout reached (${timeoutMs} ms) for session ${sessionId}. Terminating process.`,
      );
      ffmpegProc.kill("SIGKILL");
      reject(
        new Error(
          JSON.stringify({
            status: "error",
            errorCategory: "RENDER_TIMEOUT",
            systemDescription:
              "FFmpeg rendering process exceeded the maximum execution window.",
            rawSnippet: `Execution timed out after ${timeoutMs}ms.`,
          }),
        ),
      );
    }, timeoutMs);

    // Rate limiting for SSE progress logs
    let lastProgressTime = 0;

    // Parse -progress pipe:1 stdout
    ffmpegProc.stdout.on("data", (chunk) => {
      const dataStr = chunk.toString();
      stdoutBuffer += dataStr;

      if (!sessionId || !expectedDuration || expectedDuration <= 0) return;

      // Extract out_time_us
      const lines = dataStr.split("\n");
      for (const line of lines) {
        if (line.startsWith("out_time_us=")) {
          const us = parseInt(line.substring(12).trim(), 10);
          if (!isNaN(us) && us > 0) {
            const elapsed = us / 1000000;
            const percent = Math.min(
              99,
              Math.round((elapsed / expectedDuration) * 100),
            );
            const now = Date.now();
            if (
              now - lastProgressTime >=
              RENDER_CONFIG.PROGRESS_RATE_LIMIT_MS
            ) {
              lastProgressTime = now;
              const remaining =
                percent > 0
                  ? ((expectedDuration - elapsed) * (100 - percent)) / percent
                  : null;

              // Broadcast progress message
              broadcastToSession(sessionId, "progress", {
                stage: "encoding",
                percent,
                elapsedSeconds: Math.round(elapsed),
                remainingSecondsEstimate: remaining
                  ? Math.round(remaining)
                  : null,
              });
            }
          }
        }
      }
    });

    ffmpegProc.stderr.on("data", (chunk) => {
      stderrBuffer += chunk.toString();
    });

    ffmpegProc.on("close", (code) => {
      clearTimeout(watchdogTimer);

      // Write execution log
      fs.writeFileSync(
        stderrLogFile,
        `${stdoutBuffer}\n=== STDERR ===\n${stderrBuffer}`,
        "utf8",
      );

      if (code !== 0) {
        // Parse diagnostic errors
        const lastLines = stderrBuffer
          .split("\n")
          .slice(-RENDER_CONFIG.MAX_ERROR_LOG_LINES)
          .join("\n");

        let errorCategory = "FFMPEG_EXECUTION_FAILURE";
        let systemDescription =
          "FFmpeg render process failed. See logs for details.";

        if (stderrBuffer.includes("Invalid sample format")) {
          errorCategory = "INVALID_SAMPLE_FORMAT";
          systemDescription =
            "FFmpeg encountered an unsupported audio sample format.";
        } else if (stderrBuffer.includes("No such filter")) {
          errorCategory = "FILTERGRAPH_SYNTAX_ERROR";
          systemDescription =
            "FFmpeg encountered an invalid or missing filter name.";
        } else if (stderrBuffer.includes("Size mismatch")) {
          errorCategory = "SIZE_MISMATCH";
          systemDescription = "Stream size mismatch or buffer overflow.";
        } else if (
          stderrBuffer.includes("atrim") &&
          stderrBuffer.includes("out of bounds")
        ) {
          errorCategory = "ATRIM_OUT_OF_BOUNDS";
          systemDescription =
            "Atrim segment time boundary exceeds track duration.";
        }

        const structuredErr = {
          status: "error",
          errorCategory,
          systemDescription,
          rawSnippet: lastLines,
        };

        // Write structured error artifact
        try {
          fs.writeFileSync(
            path.join(sessionWorkDir, "finalize_error.json"),
            JSON.stringify(structuredErr, null, 2),
            "utf8",
          );
        } catch (e) {}

        reject(new Error(JSON.stringify(structuredErr)));
      } else {
        resolve({
          graphFile,
          commandLog: cmdLogFile,
          stderrLog: stderrLogFile,
        });
      }
    });

    ffmpegProc.on("error", (err) => {
      clearTimeout(watchdogTimer);
      reject(err);
    });
  });
}

function parseDuration(output: string) {
  const match = output.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
  if (!match) return 0;
  return (
    parseInt(match[1]) * 3600 +
    parseInt(match[2]) * 60 +
    parseInt(match[3]) +
    parseInt(match[4]) / 100
  );
}

async function queryTrackDuration(filePath: string): Promise<number> {
  try {
    const output = await execFfmpeg(["-i", filePath]);
    const duration = parseDuration(output);
    if (duration > 0) return duration;
    throw new Error("Parsed duration was 0");
  } catch (e: any) {
    throw new Error(
      `Failed to query container duration via FFmpeg: ${e.message}`,
    );
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

    const end = line.match(
      /silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/,
    );
    if (end) {
      events.push({
        ...(active || {}),
        end: Number(end[1]),
        duration: Number(end[2]),
      });
      active = null;
    }
  }

  return events.slice(0, 40);
}

function analyzePcmEnergy(raw: Buffer, duration: number) {
  if (raw.length < 2 || duration <= 0) {
    return { energyCurve: [], candidateSections: [], estimatedBpm: null };
  }

  const samples = new Int16Array(
    raw.buffer,
    raw.byteOffset,
    Math.floor(raw.byteLength / 2),
  );
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
  const normalized = energies.map((value) =>
    Math.round((value / maxEnergy) * 100),
  );
  const frameSeconds = duration / normalized.length;
  const sections = normalized
    .map((energy, index) => ({
      start: Math.max(0, Number((index * frameSeconds).toFixed(1))),
      end: Number(((index + 1) * frameSeconds).toFixed(1)),
      energy,
    }))
    .filter((section) => section.energy >= 75)
    .sort((a, b) => b.energy - a.energy)
    .slice(0, 8)
    .sort((a, b) => a.start - b.start);

  const peaks = normalized
    .map((energy, index) => ({ energy, index }))
    .filter(
      (point, index, arr) =>
        index > 0 &&
        index < arr.length - 1 &&
        point.energy > arr[index - 1].energy &&
        point.energy >= arr[index + 1].energy &&
        point.energy > 55,
    );
  const intervals = peaks
    .slice(1)
    .map((point, index) => (point.index - peaks[index].index) * frameSeconds)
    .filter((seconds) => seconds > 0.25 && seconds < 2.5);
  const avgInterval = intervals.length
    ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length
    : 0;
  const estimatedBpm = avgInterval ? Math.round(60 / avgInterval) : null;

  return {
    energyCurve: normalized,
    candidateSections: sections,
    estimatedBpm,
  };
}

async function estimateTempo(filePath: string, duration: number) {
  const pcmPath = path.join(workDir, `tempo_${uuidv4()}.f32`);
  try {
    const args = [
      "-y",
      "-hide_banner",
      "-i",
      filePath,
      "-ac",
      "1",
      "-ar",
      "44100",
    ];
    if (duration > 240) args.push("-t", "240");
    args.push("-f", "f32le", "-acodec", "pcm_f32le", pcmPath);
    await execFfmpeg(args, 45000);
    if (!fs.existsSync(pcmPath)) return null;

    const raw = fs.readFileSync(pcmPath);
    const audioData = new Float32Array(
      raw.buffer,
      raw.byteOffset,
      Math.floor(raw.byteLength / 4),
    );
    if (audioData.length < 44100 * 5) return null;

    const detector = new MusicTempo(audioData, {
      minBeatInterval: 0.3,
      maxBeatInterval: 1.2,
      expiryTime: 20,
      maxTempos: 12,
    });
    const tempo = Number(detector.tempo);
    if (!Number.isFinite(tempo) || tempo <= 0) return null;
    return Math.round(tempo);
  } catch (_e) {
    return null;
  } finally {
    try {
      if (fs.existsSync(pcmPath)) fs.unlinkSync(pcmPath);
    } catch (e) {}
  }
}

async function analyzeLocalAudio(filePath: string) {
  const probeOutput = await execFfmpeg(
    ["-hide_banner", "-i", filePath, "-f", "null", "-"],
    15000,
  );
  const duration = parseDuration(probeOutput);
  const bitrate = extractNumber(probeOutput, /bitrate:\s*(\d+)\s*kb\/s/);
  const sampleRate = extractNumber(probeOutput, /(\d+)\s*Hz/);
  const volumeOutput = await execFfmpeg(
    ["-hide_banner", "-i", filePath, "-af", "volumedetect", "-f", "null", "-"],
    30000,
  );
  const silenceOutput = await execFfmpeg(
    [
      "-hide_banner",
      "-i",
      filePath,
      "-af",
      "silencedetect=noise=-35dB:d=0.35",
      "-f",
      "null",
      "-",
    ],
    30000,
  );
  const pcmPath = path.join(workDir, `analysis_${uuidv4()}.raw`);

  let energy = {
    energyCurve: [] as number[],
    candidateSections: [] as Array<{
      start: number;
      end: number;
      energy: number;
    }>,
    estimatedBpm: null as number | null,
  };
  try {
    await execFfmpeg(
      [
        "-y",
        "-hide_banner",
        "-i",
        filePath,
        "-ac",
        "1",
        "-ar",
        "8000",
        "-f",
        "s16le",
        "-acodec",
        "pcm_s16le",
        pcmPath,
      ],
      30000,
    );
    if (fs.existsSync(pcmPath)) {
      energy = analyzePcmEnergy(fs.readFileSync(pcmPath), duration);
    }
  } finally {
    try {
      if (fs.existsSync(pcmPath)) fs.unlinkSync(pcmPath);
    } catch (e) {}
  }

  const detectedBpm = await estimateTempo(filePath, duration);

  const analysis = {
    source: "local-ffmpeg",
    duration,
    bitrate,
    sampleRate,
    meanVolumeDb: extractNumber(volumeOutput, /mean_volume:\s*(-?[\d.]+)\s*dB/),
    maxVolumeDb: extractNumber(volumeOutput, /max_volume:\s*(-?[\d.]+)\s*dB/),
    silence: parseSilences(silenceOutput),
    estimatedBpm: detectedBpm || energy.estimatedBpm,
    energyCurve: energy.energyCurve,
    candidateSections: energy.candidateSections,
  };
  const medleyIntelligence = buildTrackIntelligence({
    trackId: path.basename(filePath, path.extname(filePath)),
    filename: path.basename(filePath),
    analysis,
  });

  const analysisText = [
    "Local FFmpeg analysis only. No audio was sent to an AI provider.",
    "Layer 1 local facts: duration, sample rate, bitrate, loudness, silence, tempo estimate, and energy curve.",
    "Layer 2 heuristic guesses: hook/entry/exit/reset/finale candidates are guesses with confidence and warnings.",
    "Layer 3 scoring/ranking: medley usefulness scores are local heuristics, not musical facts.",
    `Duration: ${duration ? `${duration.toFixed(1)}s` : "unknown"}`,
    `Technical: ${sampleRate || "unknown"} Hz, ${bitrate || "unknown"} kbps`,
    `Volume: mean ${analysis.meanVolumeDb ?? "unknown"} dB, max ${analysis.maxVolumeDb ?? "unknown"} dB`,
    `Estimated BPM from local tempo detection: ${analysis.estimatedBpm ?? "unknown"}`,
    `Silence regions: ${
      analysis.silence.length
        ? analysis.silence
            .map(
              (s) =>
                `${s.start?.toFixed(1) ?? "?"}-${s.end?.toFixed(1) ?? "?"}s`,
            )
            .slice(0, 8)
            .join(", ")
        : "none detected"
    }`,
    `High-energy candidate sections: ${analysis.candidateSections.length ? analysis.candidateSections.map((s) => `${s.start.toFixed(1)}-${s.end.toFixed(1)}s (${s.energy}%)`).join(", ") : "none detected"}`,
    `Top hook candidates: ${
      medleyIntelligence.rankedHookCandidates.length
        ? medleyIntelligence.rankedHookCandidates
            .slice(0, 3)
            .map(
              (s) =>
                `${s.sectionId} (${Math.round(s.scores.hookStrength * 100)}%, confidence ${Math.round(s.confidence * 100)}%)`,
            )
            .join(", ")
        : "none"
    }`,
    `Top entry candidates: ${
      medleyIntelligence.rankedEntryCandidates.length
        ? medleyIntelligence.rankedEntryCandidates
            .slice(0, 3)
            .map(
              (s) =>
                `${s.sectionId} (${Math.round(s.scores.entryQuality * 100)}%)`,
            )
            .join(", ")
        : "none"
    }`,
    `Top exit candidates: ${
      medleyIntelligence.rankedExitCandidates.length
        ? medleyIntelligence.rankedExitCandidates
            .slice(0, 3)
            .map(
              (s) =>
                `${s.sectionId} (${Math.round(s.scores.exitQuality * 100)}%)`,
            )
            .join(", ")
        : "none"
    }`,
    "Key, genre, and mood were not sent to the cloud and are not inferred by this local analyzer.",
  ].join("\n");

  return { analysis, analysisText, medleyIntelligence };
}

async function createAnalysisClips(
  filePath: string,
  sections: Array<{ start: number; end: number; energy: number }>,
  duration: number,
  signal?: AbortSignal,
) {
  const fallbackStarts = [
    duration * 0.2,
    duration * 0.45,
    duration * 0.7,
  ].filter((start) => Number.isFinite(start) && start > 0);
  const starts = (
    sections.length
      ? sections
      : fallbackStarts.map((start) => ({ start, end: start + 12, energy: 50 }))
  )
    .slice()
    .sort((a, b) => b.energy - a.energy)
    .slice(0, 3)
    .map((section) =>
      Math.max(0, Math.min(section.start, Math.max(0, duration - 12))),
    );

  const clips: Array<{
    path: string;
    filename: string;
    start: number;
    duration: number;
    energy: number;
    mimeType: string;
  }> = [];
  const clipDir = path.join(workDir, "analysis-clips");
  if (!fs.existsSync(clipDir)) fs.mkdirSync(clipDir, { recursive: true });

  for (let i = 0; i < starts.length; i++) {
    signal?.throwIfAborted();
    const start = starts[i];
    const outputPath = path.join(clipDir, `${uuidv4()}.mp3`);
    try {
      await execFfmpeg(
        [
          "-y",
          "-hide_banner",
          "-ss",
          String(start.toFixed(2)),
          "-t",
          "12",
          "-i",
          filePath,
          "-ac",
          "1",
          "-ar",
          "22050",
          "-b:a",
          "64k",
          outputPath,
        ],
        30000,
        { rejectOnError: true, signal },
      );
    } catch (error) {
      fs.rmSync(outputPath, { force: true });
      for (const clip of clips) fs.rmSync(clip.path, { force: true });
      throw error;
    }
    if (fs.existsSync(outputPath)) {
      clips.push({
        path: outputPath,
        filename: path.basename(outputPath),
        start: Number(start.toFixed(1)),
        duration: 12,
        energy: sections[i]?.energy ?? 50,
        mimeType: "audio/mpeg",
      });
    }
  }

  return clips;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, os.tmpdir()),
  filename: (req, file, cb) => {
    const id = uuidv4();
    cb(null, `${id}${path.extname(file.originalname)}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_FILE_BYTES, files: MAX_UPLOAD_FILES },
  fileFilter: (_req, file, callback) => {
    const allowed = SUPPORTED_AUDIO_EXTENSIONS.has(
      path.extname(file.originalname).toLowerCase(),
    );
    if (allowed) callback(null, true);
    else callback(new Error("Unsupported audio extension"));
  },
});

async function probeUploadedAudio(filePath: string) {
  const output = await execFfmpeg(["-i", filePath], 30_000);
  const durationSec = parseDuration(output);
  const audioLines = output.split(/\r?\n/).filter((line) => /Audio:/i.test(line));
  const codec = audioLines[0]?.match(/Audio:\s*([^,\s]+)/i)?.[1] || "";
  const layout = audioLines[0]?.match(/\b(mono|stereo|\d+\.\d+)\b/i)?.[1]?.toLowerCase();
  const channels =
    layout === "mono"
      ? 1
      : layout === "stereo"
        ? 2
        : layout?.includes(".")
          ? layout.split(".").reduce((sum, value) => sum + Number(value), 0)
          : 2;
  const probe = { durationSec, audioStreams: audioLines.length, channels, codec };
  validateAudioProbe(probe);
  return probe;
}

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

const sessions: Record<
  string,
  {
    status: "running" | "completed" | "cancelled" | "error";
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
  }
> = {};

// Restore completed sessions from history so /api/audio/:id works after restart
for (const entry of getHistory()) {
  if (entry.finalAudioPath && fs.existsSync(entry.finalAudioPath)) {
    sessions[entry.id] = {
      status: "completed",
      logs: [],
      finalAudioPath: entry.finalAudioPath,
      summary: entry.summary,
      metrics: entry.metrics,
    };
  }
}

// SSE connections for real-time streaming
const sseClients: Record<string, express.Response[]> = {};
const sessionEventJournals: Record<string, SessionEventJournal> = {};

// Active FFmpeg render processes per session — enables cancel support
const activeRenderProcesses: Record<string, any> = {};
const analysisJobs = new AnalysisJobRegistry();
const activeAnalysisJobs: Record<string, Set<AnalysisJob>> = {};

function getCurrentTrackIntelligence(): TrackIntelligence[] {
  return getLibrary()
    .map((entry: any) =>
      entry.medleyIntelligence
        ? entry.medleyIntelligence
        : entry.localAnalysis
          ? buildTrackIntelligence({
              trackId: entry.id,
              filename: entry.originalName || entry.filename || entry.id,
              analysis: entry.localAnalysis,
            })
          : null,
    )
    .filter(Boolean);
}

function getSessionTrackIntelligence(sessionId?: string): TrackIntelligence[] {
  if (sessionId && Array.isArray(sessions[sessionId]?.trackIntelligence)) {
    return sessions[sessionId].trackIntelligence;
  }
  return getCurrentTrackIntelligence();
}

function buildSpecialistContext(sessionId?: string): SpecialistContext {
  const library = getLibrary();
  const authoritativeTracks = getSessionTrackIntelligence(sessionId);
  const trackIds = new Set<string>();
  const durationsByTrackId = new Map<string, number>();
  const factsByTrackId = new Map<string, any>();
  for (const track of authoritativeTracks) {
    const profile = track.profile;
    trackIds.add(profile.trackId);
    if (profile.durationSec > 0)
      durationsByTrackId.set(profile.trackId, profile.durationSec);
    factsByTrackId.set(profile.trackId, {
      trackId: profile.trackId,
      filename: profile.filename,
      durationSec: profile.durationSec,
      tempoEstimate: profile.tempoEstimate,
      keyEstimate: profile.keyEstimate ?? null,
      confidence: profile.confidence,
    });
  }
  const sectionsById = new Map<
    string,
    { trackId: string; startSec: number; endSec: number }
  >();
  for (const track of authoritativeTracks) {
    for (const section of track.sections ?? []) {
      sectionsById.set(section.sectionId, {
        trackId: section.trackId,
        startSec: section.startSec,
        endSec: section.endSec,
      });
    }
  }
  const design = sessionId ? sessions[sessionId]?.medleyDesign : null;
  const transitionCandidatesById = design?.transitionMatrixSummary
    ? new Map<string, any>(
        design.transitionMatrixSummary.map((candidate: any) => [
          createTransitionCandidateAuthority(candidate),
          candidate,
        ] as [string, any]),
      )
    : undefined;
  const targetDurationMinutes = Number(
    design?.userConstraints?.targetDurationMinutes,
  );
  return {
    trackIds,
    durationsByTrackId,
    sectionsById,
    factsByTrackId,
    transitionCandidatesById,
    targetDurationSec:
      targetDurationMinutes > 0 ? targetDurationMinutes * 60 : undefined,
  };
}

function broadcastToSession(sessionId: string, event: string, data: any) {
  const safeData = redactSensitive(data);
  const status = sessions[sessionId]?.status;
  if (
    (status === "cancelled" || status === "completed") &&
    (event === "progress" || event === "metrics")
  ) {
    return;
  }
  // SSE is a projection only. Durable/request-owned code updates the session
  // before publishing an event, so a delayed FFmpeg callback cannot overwrite
  // cancellation or completion state merely by emitting stale progress.
  const journal =
    sessionEventJournals[sessionId] ||
    (sessionEventJournals[sessionId] = new SessionEventJournal());
  const record = journal.append(event, safeData);
  const clients = sseClients[sessionId] || [];
  const msg = encodeSseEvent(record);
  clients.forEach((res) => {
    try {
      res.write(msg);
      if (event === "completed") res.end();
    } catch (e) {}
  });
  if (event === "completed") sseClients[sessionId] = [];
}

const geminiApiKey = process.env.GEMINI_API_KEY || "";
let openrouterApiKey = process.env.OPENROUTER_API_KEY || "";

app.get("/api/config", (req, res) => {
  res.json({
    hasGeminiApiKey: Boolean(geminiApiKey),
    hasOpenrouterApiKey: Boolean(openrouterApiKey),
  });
});

app.put("/api/config/openrouter-key", (req, res) => {
  try {
    openrouterApiKey = persistOpenRouterApiKey(localEnvPath, req.body?.apiKey);
    process.env.OPENROUTER_API_KEY = openrouterApiKey;
    res.json({ success: true, hasOpenrouterApiKey: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/provider/openrouter/preflight", async (_req, res) => {
  try {
    const result = await runOpenRouterPreflight({
      apiKey: openrouterApiKey,
      referer: `http://${HOST}:${PORT}`,
    });
    res.json({ status: "available", ...result });
  } catch (error) {
    if (error instanceof OpenRouterPreflightError)
      return res.status(error.status).json({ status: error.code, error: error.message });
    res.status(502).json({
      status: "unavailable",
      error: "OpenRouter could not complete the connection check.",
    });
  }
});

app.post(
  "/api/provider/openrouter",
  express.text({ type: "text/plain", limit: "105kb" }),
  async (req, res) => {
    if (!openrouterApiKey)
      return res.status(503).json({ error: "Server OpenRouter credential is unavailable" });
    try {
      const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openrouterApiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": `http://${HOST}:${PORT}`,
          "X-Title": "AI Medley Architect",
        },
        body: String(req.body || ""),
        signal: AbortSignal.timeout(120_000),
      });
      const body = await upstream.text();
      const retryAfter = upstream.headers.get("retry-after");
      if (retryAfter) res.setHeader("Retry-After", retryAfter);
      res.status(upstream.status).type("application/json").send(body);
    } catch (error: any) {
      res.status(error?.name === "TimeoutError" ? 504 : 502).json({
        error: "Server provider proxy failed",
      });
    }
  },
);

app.post("/api/provider/gemini", async (req, res) => {
  if (!geminiApiKey)
    return res.status(503).json({ error: "Server Gemini credential is unavailable" });
  try {
    const { model, contents, config } = req.body || {};
    if (!model || !Array.isArray(contents) || !config)
      return res.status(400).json({ error: "Invalid Gemini proxy request" });
    const ai = new GoogleGenAI({ apiKey: geminiApiKey });
    const result = await ai.models.generateContent({ model, contents, config });
    res.json({
      text: result.text ?? "",
      functionCalls: result.functionCalls ?? [],
      candidateContent: (result as any)?.candidates?.[0]?.content ?? null,
    });
  } catch (error: any) {
    // Keep the exact provider reason available to this local UI. It is vital
    // for distinguishing a malformed tool schema from a quota/model-account
    // issue, but redact and bound it so provider errors cannot disclose keys.
    const providerDetail = String(redactSensitive(String(error?.message ?? "")))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);
    res.status(Number(error?.status) || 502).json({
      error: providerDetail
        ? `Gemini provider request failed: ${providerDetail}`
        : "Gemini provider request failed",
    });
  }
});

/**
 * Automatic v4 audio review. This endpoint is deliberately server-only: it
 * accepts a registered candidate identity, not an arbitrary browser path, and
 * uploads only that candidate (or its registered transition previews) using
 * the server-managed Gemini credential.
 */
app.post("/api/session/audio-review", async (req, res) => {
  const { sessionId, candidateId, mode, transitionIds } = req.body || {};
  try {
    validateSessionId(sessionId);
    if (!geminiApiKey) {
      return res.status(503).json({
        error: "Automatic audio review needs a server Gemini credential. The candidate was preserved for manual review.",
      });
    }
    if (mode !== "whole_mix" && mode !== "targeted") {
      return res.status(400).json({ error: "Audio review mode must be whole_mix or targeted" });
    }
    return await withSessionLock(sessionId, async () => {
      const manifest = readCandidateManifest(workDir, sessionId);
      const candidate = manifest.candidates.find(
        (item) => item.candidateId === candidateId,
      );
      if (!candidate) throw new Error("Candidate is not registered");
      if (!candidate.technicallyValid) {
        throw new Error("A technically invalid candidate cannot be sent for audio approval");
      }
      const registeredPaths = [
        candidate.outputPath,
        ...candidate.debugPaths,
        ...candidate.previewPaths,
      ];
      const candidatePath = assertRegisteredSafeFile(
        workDir,
        sessionId,
        candidate.outputPath,
        registeredPaths,
      );
      if (!fs.existsSync(candidatePath)) throw new Error("Registered candidate audio is missing");
      const resolvedTransitions = candidate.resolvedTransitions ?? [];
      const knownTransitions = resolvedTransitions.map((transition) => ({
        transitionId: transition.transitionId,
        fromTrackId: transition.fromTrackId,
        toTrackId: transition.toTrackId,
        style: transition.style,
      }));
      if (!knownTransitions.length) {
        throw new Error("Automatic audio review requires the candidate's locked transition evidence");
      }
      const requestedIds = Array.isArray(transitionIds)
        ? [...new Set(transitionIds.map((value) => String(value)))].slice(0, 3)
        : [];
      if (mode === "targeted" && !requestedIds.length) {
        throw new Error("Targeted audio review requires one to three locked transition IDs");
      }
      const clips = requestedIds.map((transitionId) => {
        const transition = resolvedTransitions.find(
          (item) => item.transitionId === transitionId,
        );
        if (!transition?.outputPath) {
          throw new Error("Requested transition preview is not registered");
        }
        return {
          transitionId,
          filePath: assertRegisteredSafeFile(
            workDir,
            sessionId,
            transition.outputPath,
            registeredPaths,
          ),
        };
      });
      const model = mode === "whole_mix"
        ? AUTOMATIC_GEMINI_MODELS.wholeMixReview
        : AUTOMATIC_GEMINI_MODELS.targetedReview;
      const decision = await reviewCandidateAudioWithGemini({
        client: new GoogleGenAI({ apiKey: geminiApiKey }) as any,
        model,
        candidate,
        candidateFilePath: mode === "whole_mix" ? candidatePath : undefined,
        transitions: knownTransitions,
        mode,
        transitionClips: clips,
      });
      return res.json({
        review: toQualityReviewFromAudioDecision({ candidate, decision, model }),
        model,
      });
    });
  } catch (error: any) {
    const message = error instanceof GeminiAudioReviewError
      ? error.message
      : String(error?.message || "Automatic audio review failed");
    res.status(400).json({ error: message });
  }
});

function logToSession(sessionId: string, msg: string) {
  if (!sessions[sessionId]) return;
  const safeMessage = String(redactSensitive(msg));
  const logEntry = `[${new Date().toISOString()}] ${safeMessage}`;
  appendBoundedLog(sessions[sessionId].logs, logEntry);
  broadcastToSession(sessionId, "log", { message: logEntry });
  console.log(`[Session ${sessionId}] ${safeMessage}`);
}

// SSE endpoint for real-time session streaming
app.get("/api/session/:id/stream", async (req, res) => {
  const sessionId = req.params.id;
  try {
    validateSessionId(sessionId);
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
  // The UI intentionally opens progress streaming before its first workflow
  // request. Establish the pending session here so startup order cannot race
  // the design/tool endpoints and produce a spurious 404.
  await withSessionLock(sessionId, async () => {
    if (!sessions[sessionId]) sessions[sessionId] = { status: "running", logs: [] };
  });
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": req.get("origin") || "http://localhost:3000",
  });
  const journal =
    sessionEventJournals[sessionId] ||
    (sessionEventJournals[sessionId] = new SessionEventJournal());
  const requestedLastId = Number(req.get("last-event-id") || req.query.lastEventId || 0);
  res.write(
    `event: connected\ndata: ${JSON.stringify({
      sessionId,
      sequence: journal.currentSequence,
      snapshot: {
        status: sessions[sessionId].status,
        metrics: sessions[sessionId].metrics || null,
        renderProgress: sessions[sessionId].renderProgress || null,
        summary: sessions[sessionId].summary || null,
        workflowStage: sessions[sessionId].workflowStage || null,
      },
    })}\n\n`,
  );
  if (Number.isFinite(requestedLastId) && requestedLastId >= 0) {
    for (const event of journal.replayAfter(requestedLastId)) {
      res.write(encodeSseEvent(event));
    }
  }
  if (sessions[sessionId].status === "completed") {
    res.end();
    return;
  }

  if (!sseClients[sessionId]) sseClients[sessionId] = [];
  sseClients[sessionId].push(res);

  // Heartbeat loop to keep connections alive through reverse proxies
  const heartbeat = setInterval(() => {
    try {
      res.write(
        `event: heartbeat\ndata: ${JSON.stringify({
          at: new Date().toISOString(),
          sequence: journal.currentSequence,
        })}\n\n`,
      );
    } catch (e) {
      clearInterval(heartbeat);
    }
  }, RENDER_CONFIG.SSE_HEARTBEAT_MS);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients[sessionId] = (sseClients[sessionId] || []).filter(
      (c) => c !== res,
    );
  });
});

// Cancel active render for a session
app.post("/api/session/:id/cancel", async (req, res) => {
  const sessionId = req.params.id;
  try {
    validateSessionId(sessionId);
    const idempotencyKey = String(
      req.get("Idempotency-Key") || req.body?.idempotencyKey || "",
    ).trim();
    return await withSessionLock(sessionId, async () => {
      const execute = async () => {
      const proc = activeRenderProcesses[sessionId];
      const activeAnalyses = activeAnalysisJobs[sessionId];
      const automaticState = readAutomaticSessionState(workDir, sessionId);
      if (sessions[sessionId]?.status === "completed" || automaticState?.state === "completed") {
        return { success: true, message: "Session is already completed; cancellation was not applied." };
      }
      if (proc && !proc.killed) {
        console.log(`[Cancel] Killing active FFmpeg render for session ${sessionId}`);
        proc.kill("SIGKILL");
        delete activeRenderProcesses[sessionId];
      }
      if (activeAnalyses?.size) {
        for (const job of activeAnalyses) analysisJobs.cancel(job);
      }
      if (automaticState) cancelAutomaticSessionState({ workDir, sessionId });
      if (sessions[sessionId]) {
        sessions[sessionId].status = "cancelled";
        sessions[sessionId].workflowStage = "cancelled";
        logToSession(sessionId, "[session] Cancelled by user.");
      }
      broadcastToSession(sessionId, "cancelled", { sessionId });
      return {
        success: true,
        message: proc
          ? "Render process terminated."
          : activeAnalyses?.size
            ? "Active local analysis cancelled."
            : "Session cancelled.",
      };
      };
      const automaticState = readAutomaticSessionState(workDir, sessionId);
      const replay = idempotencyKey && automaticState
        ? await replayAutomaticSessionIdempotent({
            workDir,
            sessionId,
            operation: "cancellation",
            key: idempotencyKey,
            request: {},
            execute,
          })
        : idempotencyKey
          ? await replayIdempotent({
              sessionId,
              operation: "cancellation",
              key: idempotencyKey,
              request: {},
              execute,
            })
          : { replayed: false, result: await execute() };
      return res.json({ ...replay.result, idempotent: replay.replayed });
    });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

app.get("/api/library", (req, res) => {
  res.json(getLibrary());
});

app.post("/api/library/recover", (_req, res) => {
  try {
    const recovered = recoverOrphanedLibraryAudio({
      audioDir,
      store: { read: getLibrary, write: saveLibrary },
    });
    res.json({ success: true, recovered });
  } catch (error: any) {
    res.status(500).json({ error: `Could not recover saved tracks: ${error?.message || String(error)}` });
  }
});

app.post("/api/library", (req, res) => {
  upload.array("files")(req, res, async (err) => {
    if (err)
      return res.status(err instanceof multer.MulterError ? 413 : 400).json({
        error: "Upload rejected: " + String(err?.message || err),
      });
    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length === 0) return res.json({ success: true, files: [] });
    const cleanup = () => {
      for (const file of files) {
        try {
          if (fs.existsSync(file.path)) fs.rmSync(file.path, { force: true });
        } catch {}
      }
    };
    try {
      const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
      const disk = fs.statfsSync(audioDir);
      assertUploadCapacity({
        availableBytes: Number(disk.bavail) * Number(disk.bsize),
        incomingBytes: totalBytes,
      });
      const existing = getLibrary();
      const incomingHashes = new Set<string>();
      for (const file of files) {
        validateUploadMetadata(file);
        await probeUploadedAudio(file.path);
        const sha256 = sha256UploadFile(file.path);
        if (findDuplicateUpload(sha256, existing) || incomingHashes.has(sha256))
          throw new Error(`Duplicate audio content: ${file.originalname}`);
        incomingHashes.add(sha256);
        const permanentPath = path.join(audioDir, file.filename);
        moveUploadedAudioFile(file.path, permanentPath);
        file.path = permanentPath;
        (file as any).sha256 = sha256;
      }
      const newEntries = commitUploadedFiles({
        files,
        store: { read: getLibrary, write: saveLibrary },
      });
      res.json({ success: true, files: newEntries });
    } catch (error: any) {
      cleanup();
      res.status(400).json({
        error: `Upload validation or persistence failed: ${error?.message || String(error)}`,
      });
    }
  });
});

// Reorder library endpoint
app.put("/api/library/reorder", (req, res) => {
  const { orderedIds } = req.body;
  if (!orderedIds || !Array.isArray(orderedIds)) {
    return res.status(400).json({ error: "orderedIds array required" });
  }
  const library = getLibrary();
  const reordered = orderedIds
    .map((id: string) => library.find((e: any) => e.id === id))
    .filter(Boolean);
  // Add any items not in the ordered list at the end
  const remainingItems = library.filter((e: any) => !orderedIds.includes(e.id));
  saveLibrary([...reordered, ...remainingItems]);
  res.json({ success: true });
});

app.delete("/api/library/:id", (req, res) => {
  try {
    const result = deleteLibraryEntryTransactional({
      id: req.params.id,
      dbPath,
    });
    res.json({ success: true, deleted: result.deleted });
  } catch (error: any) {
    res.status(500).json({
      error: `Library deletion failed: ${error?.message || String(error)}`,
    });
  }
});

// ── Checkpoint endpoints ──────────────────────────────────────────────────────

app.post(
  "/api/checkpoint",
  express.json({ limit: "50mb" }),
  (req: any, res: any) => {
    const { sessionId } = req.body;
    if (!sessionId)
      return res.status(400).json({ error: "sessionId required" });
    try {
      validateSessionId(sessionId);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
    if (getHistory().some((entry: any) => entry.id === sessionId)) {
      return res.json({ ok: true, ignored: "completed" });
    }
    const filePath = path.join(checkpointDir, `${sessionId}.json`);
    let checkpoint = {
      ...req.body,
      savedAt: req.body.savedAt || new Date().toISOString(),
    };
    if (req.body.schemaVersion === 3) {
      checkpoint.resumeBinding = buildResumeBinding(checkpoint, getLibrary());
      const parsed = AutomaticWorkflowCheckpointSchema.safeParse(checkpoint);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: formatValidationIssues(parsed.error).join("; ") });
      }
      checkpoint = parsed.data;
      if (fs.existsSync(filePath)) {
        try {
          const existing = AutomaticWorkflowCheckpointSchema.safeParse(
            JSON.parse(fs.readFileSync(filePath, "utf8")),
          );
          if (
            existing.success &&
            (existing.data.activeRequestSequence >
              checkpoint.activeRequestSequence ||
              (existing.data.activeRequestSequence ===
                checkpoint.activeRequestSequence &&
                existing.data.savedAt > checkpoint.savedAt))
          ) {
            return res.json({ ok: true, stale: true });
          }
        } catch {
          // A corrupt older checkpoint is replaced by the validated new checkpoint.
        }
      }
    }
    checkpoint = redactSensitive(checkpoint);
    const temporary = `${filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(checkpoint));
    fs.renameSync(temporary, filePath);
    res.json({ ok: true });
  },
);

app.get("/api/checkpoints", (_req: any, res: any) => {
  const checkpoints = fs
    .readdirSync(checkpointDir)
    .filter((f: string) => f.endsWith(".json"))
    .map((f: string) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(checkpointDir, f), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  res.json(checkpoints);
});

app.get("/api/checkpoint/:sessionId", (req: any, res: any) => {
  try {
    validateSessionId(req.params.sessionId);
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
  const p = path.join(checkpointDir, `${req.params.sessionId}.json`);
  if (!fs.existsSync(p)) return res.status(404).json({ error: "not found" });
  res.json(JSON.parse(fs.readFileSync(p, "utf8")));
});

app.get("/api/checkpoint/:sessionId/compatibility", (req: any, res: any) => {
  try {
    validateSessionId(req.params.sessionId);
    const filePath = path.join(checkpointDir, `${req.params.sessionId}.json`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ compatible: false, reason: "missing" });
    }
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const parsed = AutomaticWorkflowCheckpointSchema.safeParse(raw);
    if (!parsed.success) {
      return res.json({ compatible: false, reason: "legacy-or-invalid" });
    }
    const current = buildResumeBinding(parsed.data, getLibrary());
    return res.json(compareResumeBinding(parsed.data.resumeBinding, current));
  } catch (error: any) {
    return res.status(400).json({ compatible: false, reason: error.message });
  }
});

app.delete("/api/checkpoint/:sessionId", (req: any, res: any) => {
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

app.get("/api/audio-raw/:id", (req, res) => {
  const library = getLibrary();
  const entry = library.find((e: any) => e.id === req.params.id);
  const audioPath = resolveLibraryAudioEntry(entry);
  if (!audioPath) {
    return res.status(404).json({ error: "File not found" });
  }
  res.sendFile(audioPath);
});

// Audio probe endpoint — get duration/format info via ffmpeg
app.get("/api/audio-probe/:id", (req, res) => {
  const library = getLibrary();
  const entry = library.find((e: any) => e.id === req.params.id);
  const audioPath = resolveLibraryAudioEntry(entry);
  if (!audioPath) {
    return res.status(404).json({ error: "File not found" });
  }
  const cmd = `"${ffmpegPath}" -i "${audioPath}" -hide_banner -f null - 2>&1`;
  exec(cmd, { timeout: 10000 }, (err, stdout, stderr) => {
    const output = stdout + (stderr || "");
    const durationMatch = output.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
    let durationSecs = 0;
    if (durationMatch) {
      durationSecs =
        parseInt(durationMatch[1]) * 3600 +
        parseInt(durationMatch[2]) * 60 +
        parseInt(durationMatch[3]) +
        parseInt(durationMatch[4]) / 100;
    }
    const bitrateMatch = output.match(/bitrate:\s*(\d+)\s*kb\/s/);
    const sampleRateMatch = output.match(/(\d+)\s*Hz/);
    res.json({
      duration: durationSecs,
      bitrate: bitrateMatch ? parseInt(bitrateMatch[1]) : null,
      sampleRate: sampleRateMatch ? parseInt(sampleRateMatch[1]) : null,
      raw: output.substring(0, 500),
    });
  });
});

// Waveform data endpoint — generate peaks for visualization
app.get("/api/waveform/:id", (req, res) => {
  const library = getLibrary();
  const entry = library.find((e: any) => e.id === req.params.id);
  const audioPath = resolveLibraryAudioEntry(entry);
  if (!audioPath) {
    return res.status(404).json({ error: "File not found" });
  }

  const peaksFile = path.join(workDir, `peaks_${entry.id}.raw`);
  // Downsample to 8kHz mono, output raw PCM
  const cmd = `"${ffmpegPath}" -y -i "${audioPath}" -ac 1 -ar 8000 -f s16le -acodec pcm_s16le "${peaksFile}"`;
  exec(cmd, { timeout: 30000 }, (err) => {
    if (err || !fs.existsSync(peaksFile)) {
      return res.json({ peaks: [] });
    }
    try {
      const raw = fs.readFileSync(peaksFile);
      const samples = new Int16Array(
        raw.buffer,
        raw.byteOffset,
        raw.byteLength / 2,
      );
      // Downsample to ~200 peaks
      const numPeaks = 200;
      const chunkSize = Math.max(1, Math.floor(samples.length / numPeaks));
      const peaks: number[] = [];
      for (let i = 0; i < numPeaks && i * chunkSize < samples.length; i++) {
        let max = 0;
        for (
          let j = 0;
          j < chunkSize && i * chunkSize + j < samples.length;
          j++
        ) {
          const val = Math.abs(samples[i * chunkSize + j]);
          if (val > max) max = val;
        }
        peaks.push(max / 32768);
      }
      // Clean up temp file
      try {
        fs.unlinkSync(peaksFile);
      } catch (e) {}
      res.json({ peaks });
    } catch (e) {
      res.json({ peaks: [] });
    }
  });
});

app.post("/api/session/finish", async (req, res) => {
  const { sessionId, finalAudioPath, summary } = req.body;
  if (!sessionId || !finalAudioPath) {
    return res
      .status(400)
      .json({ error: "sessionId and finalAudioPath are required" });
  }
  try {
    validateSessionId(sessionId);
    return await withSessionLock(sessionId, async () => {
      const manifest = readCandidateManifest(workDir, sessionId);
      if (
        requiresAutomaticCandidateApproval({
          sessionId,
          session: sessions[sessionId],
          manifest,
          checkpointDir,
        })
      ) {
        return res.status(409).json({
          error:
            "Automatic sessions must finalize through an approved selected candidate.",
        });
      }
      const validated = validateLegacyFinalOutput(
        workDir,
        sessionId,
        finalAudioPath,
      );
      const normalizedSummary = typeof summary === "string" ? summary : "";
      const sessionData = sessions[sessionId] || ({} as any);
      let finalQuality: any = null;
      try {
        finalQuality = await analyzeMedleyQuality(validated.finalPath, workDir);
      } catch {
        // The contained regular file is authoritative; quality remains optional here.
      }
      const transaction = executeFinalizationTransaction({
        workDir,
        sessionId,
        candidateId: "legacy-output",
        summary: normalizedSummary,
        promote: () => ({
          finalPath: validated.finalPath,
          manifestVersion: null,
          sha256: validated.sha256,
        }),
        readHistory: getHistory,
        writeHistory: saveHistory,
        readWisdom: getWisdom,
        writeWisdom: saveWisdom,
        createHistoryEntry: (resolvedPath) => ({
          id: sessionId,
          completedAt: new Date().toISOString(),
          summary: normalizedSummary,
          finalAudioPath: resolvedPath,
          metrics: sessionData.metrics,
          designPlan: sessionData.designPlan || null,
          candidateId: "legacy-output",
        }),
        createWisdomEntry: (resolvedPath) => ({
          type: "completed_medley",
          sessionId,
          summary: normalizedSummary,
          metrics: sessionData.metrics || null,
          designPlan: sessionData.designPlan || null,
          finalAudioPath: resolvedPath,
          candidateId: "legacy-output",
          tracksInvolved: collectTransitionTrackIds(
            sessionData.designPlan?.transitions,
          ),
          ...(finalQuality ? { finalQuality } : {}),
        }),
        deleteCheckpoint: () =>
          fs.rmSync(path.join(checkpointDir, `${sessionId}.json`), {
            force: true,
          }),
      });
      sessions[sessionId] = {
        ...(sessions[sessionId] || { logs: [] }),
        status: "completed",
        finalAudioPath: transaction.finalPath,
        summary: normalizedSummary,
        workflowStage: "completed",
      };
      broadcastToSession(sessionId, "completed", {
        summary: normalizedSummary,
      });
      return res.json({ success: true, idempotent: transaction.idempotent });
    });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
});

// Update metrics endpoint
app.post("/api/session/metrics", async (req, res) => {
  const { sessionId, metrics } = req.body;
  try {
    validateSessionId(sessionId);
    return await withSessionLock(sessionId, async () => {
  if (sessions[sessionId]) {
    sessions[sessionId].metrics = {
      ...sessions[sessionId].metrics,
      ...metrics,
    };
    broadcastToSession(sessionId, "metrics", sessions[sessionId].metrics);

    // Accumulate evaluation wisdom permanently without failing the primary update.
    try {
      appendWisdom({
        type: "evaluation",
        sessionId,
        metrics,
        designPlan: sessions[sessionId].designPlan || null,
      });
    } catch (wisdomError) {
      console.warn("[session-metrics] Wisdom logging failed:", wisdomError);
    }
  }
  return res.json({ success: true });
    });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

app.get("/api/session/:id", (req, res) => {
  const session = sessions[req.params.id];
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json({
    status: session.status,
    logs: session.logs,
    summary: session.summary,
    metrics: session.metrics,
  });
});

app.get("/api/audio/:id", (req, res) => {
  const audioPath = findSessionAudioPath(req.params.id);
  if (!audioPath) {
    res.status(404).json({ error: "Audio not found" });
    return;
  }
  res.type(path.extname(audioPath) || "mp3");
  res.sendFile(audioPath);
});

app.get("/api/audio/:id/download", (req, res) => {
  const audioPath = findSessionAudioPath(req.params.id);
  if (!audioPath) {
    res.status(404).json({ error: "Audio not found" });
    return;
  }

  res.download(
    audioPath,
    downloadFilenameFor(audioPath, req.params.id),
    (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({ error: "Audio download failed" });
      }
    },
  );
});

app.get("/api/audio-file", (req, res) => {
  const { filePath, sessionId } = req.query;
  if (!filePath || typeof filePath !== "string") {
    return res.status(400).json({ error: "filePath is required" });
  }

  const resolvedPath = resolveReadableAudioPath(
    filePath,
    typeof sessionId === "string" ? sessionId : undefined,
  );
  if (!resolvedPath) {
    return res
      .status(404)
      .json({ error: "Audio file not found or not allowed" });
  }

  res.sendFile(resolvedPath);
});

app.post("/api/audio-analysis/local", async (req, res) => {
  const {
    fileId,
    filePath,
    sessionId,
    saveToLibrary,
    includeClips,
    analysisGeneration,
  } = req.body;
  const library = getLibrary();
  const entry = fileId ? library.find((item: any) => item.id === fileId) : null;
  const resolvedPath =
    resolveLibraryAudioEntry(entry) ||
    (filePath ? resolveReadableAudioPath(filePath, sessionId) : null);

  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return res
      .status(404)
      .json({ error: "Audio file not found or not allowed" });
  }

  let job;
  try {
    job = analysisJobs.begin(
      entry?.id || resolvedPath,
      String(analysisGeneration || uuidv4()),
    );
  } catch (error: any) {
    return res.status(429).json({ error: error.message });
  }
  if (typeof sessionId === "string") {
    try {
      validateSessionId(sessionId);
      (activeAnalysisJobs[sessionId] ||= new Set()).add(job);
    } catch (error: any) {
      analysisJobs.finish(job);
      return res.status(400).json({ error: error.message });
    }
  }
  const cancelDisconnectedRequest = () => {
    if (!res.writableEnded) analysisJobs.cancel(job);
  };
  req.once("aborted", cancelDisconnectedRequest);
  res.once("close", cancelDisconnectedRequest);

  try {
    const sourceHash = hashAnalysisSource(resolvedPath);
    if (
      entry &&
      typeof entry.analysis === "string" &&
      entry.medleyIntelligence &&
      isReusableLocalAnalysis(entry.localAnalysis, sourceHash)
    ) {
      if (!analysisJobs.isCurrent(job)) {
        throw new DOMException("Analysis superseded", "AbortError");
      }
      return res.json({
        analysis: entry.localAnalysis,
        analysisText: entry.analysis,
        medleyIntelligence: entry.medleyIntelligence,
        clips: entry.analysisClips || [],
        cacheStatus: "current",
      });
    }
    const result = await analyzeLocalAudioFile({
      filePath: resolvedPath,
      workDir,
      trackId: entry?.id,
      filename: entry?.originalName,
      signal: job.controller.signal,
      sourceHash,
    });
    assertValidLocalAnalysis(result.analysis, sourceHash);
    const clips = includeClips
      ? await createAnalysisClips(
          resolvedPath,
          result.analysis.candidateSections || [],
          result.analysis.duration || 0,
          job.controller.signal,
        )
      : [];
    const medleyIntelligence = entry
      ? retargetTrackIntelligence(
          result.medleyIntelligence,
          entry.id,
          entry.originalName,
        )
      : result.medleyIntelligence;
    if (!analysisJobs.isCurrent(job)) {
      for (const clip of clips) fs.rmSync(clip.path, { force: true });
      throw new DOMException("Analysis superseded", "AbortError");
    }
    if (entry && saveToLibrary) {
      updateLibraryEntry(entry.id, {
        analysis: result.analysisText,
        localAnalysis: result.analysis,
        medleyIntelligence,
        analysisClips: clips.map((clip) => ({
          path: clip.path,
          start: clip.start,
          duration: clip.duration,
          energy: clip.energy,
          mimeType: clip.mimeType,
        })),
        localAnalysisUpdatedAt: new Date().toISOString(),
        localAnalysisStatus: {
          state: "valid",
          cacheKey: result.analysis.localAnalysisV2.cacheKey,
          updatedAt: new Date().toISOString(),
        },
      });
    }
    res.json({ ...result, medleyIntelligence, clips, cacheStatus: "refreshed" });
  } catch (e: any) {
    if (e?.name === "AbortError" || !analysisJobs.isCurrent(job)) {
      if (!res.headersSent) res.status(499).json({ error: "Analysis cancelled" });
      return;
    }
    if (entry && saveToLibrary) {
      updateLibraryEntry(entry.id, {
        localAnalysisStatus: {
          state: "failed",
          error: e?.name || "AnalysisError",
          updatedAt: new Date().toISOString(),
        },
      });
    }
    res.status(422).json({ error: e.message });
  } finally {
    req.removeListener("aborted", cancelDisconnectedRequest);
    res.removeListener("close", cancelDisconnectedRequest);
    analysisJobs.finish(job);
    if (typeof sessionId === "string") {
      const active = activeAnalysisJobs[sessionId];
      active?.delete(job);
      if (active?.size === 0) delete activeAnalysisJobs[sessionId];
    }
  }
});

app.post("/api/medley-intelligence/design", async (req, res) => {
  const {
    library: requestLibrary,
    trackIds: requestedTrackIds,
    userConstraints,
    sessionId,
  } = req.body || {};
  const persistedLibrary = getLibrary();
  let source =
    sessionId || !Array.isArray(requestLibrary)
      ? persistedLibrary
      : requestLibrary;
  if (sessionId && !Array.isArray(requestedTrackIds)) {
    return res.status(400).json({
      error: "Automatic design requires explicit selected track IDs.",
    });
  }
  if (sessionId) {
    const trackIds: string[] = (requestedTrackIds as unknown[]).filter(
      (value: unknown): value is string => typeof value === "string",
    );
    const uniqueIds = [...new Set(trackIds)];
    if (
      uniqueIds.length !== requestedTrackIds.length ||
      uniqueIds.length < 2 ||
      uniqueIds.length > 25
    ) {
      return res.status(400).json({
        error: "Automatic design requires 2 to 25 unique selected track IDs.",
      });
    }
    source = selectLibraryEntriesById(persistedLibrary, uniqueIds);
    if (source.length !== uniqueIds.length) {
      return res.status(400).json({
        error: "One or more selected tracks are no longer in the library.",
      });
    }
  }
  const tracks = source
    .map((entry: any) => {
      if (entry.medleyIntelligence) return entry.medleyIntelligence;
      if (entry.localAnalysis) {
        return buildTrackIntelligence({
          trackId: entry.id,
          filename: entry.originalName || entry.filename || entry.id,
          analysis: entry.localAnalysis,
        });
      }
      return null;
    })
    .filter(Boolean);

  if (tracks.length === 0) {
    return res.status(400).json({
      error:
        "No local medley intelligence is available. Run local analysis first.",
    });
  }
  try {
    assertProjectResourceBudget(
      tracks.map((track: any) => ({ durationSec: track.profile?.durationSec })),
    );
  } catch (error: any) {
    return res.status(413).json({ error: error.message });
  }

  const design = buildMedleyDesignPayload({
    tracks,
    userConstraints: userConstraints || {},
    maxTransitions: 32,
    wisdom: getWisdom(),
  });

  if (sessionId) {
    validateSessionId(sessionId);
    try {
      await withSessionLock(sessionId, async () => {
        const existingState = readAutomaticSessionState(workDir, sessionId);
        const selectedTrackIds = source.map((entry: any) => String(entry.id));
        const selectionHash = stableHash(selectedTrackIds);
        if (existingState && existingState.selectionHash !== selectionHash) {
          throw new Error("Session is already pinned to a different selected-track set.");
        }
      const sourceAudioSha256 = Object.fromEntries(
        source.map((entry: any) => [
          entry.id,
          typeof entry.sha256 === "string" && /^[a-f0-9]{64}$/.test(entry.sha256)
            ? entry.sha256
            : sha256UploadFile(String(entry.path)),
        ]),
      );
      const now = new Date().toISOString();
        const existingSnapshot = readDesignSnapshotV4(workDir, sessionId);
        const snapshot = existingSnapshot || createDesignSnapshotV4({
          schemaVersion: 1,
          workflowVersion: AUTOMATIC_WORKFLOW_VERSION,
          deterministicAlgorithmVersion: DETERMINISTIC_DESIGN_ALGORITHM_VERSION,
          sessionId,
          selectedTrackIds,
          selectionHash,
          sourceAudioSha256,
          analysisSchemaVersions: Object.fromEntries(source.map((entry: any) => [
            entry.id,
            String(entry.localAnalysis?.schemaVersion || "local_audio_analysis_v2"),
          ])),
          analyzerVersions: Object.fromEntries(source.map((entry: any) => [
            entry.id,
            String(entry.localAnalysis?.analyzerVersion || "local-audio-analysis-v2"),
          ])),
          targetDurationSec: Math.max(1, Number(userConstraints?.targetDurationMinutes || 3) * 60),
          maximumTransitions: 32,
          workflowConstraints: {
            selectedTracksOnly: true,
            crossfadeDurationSeconds: Number(userConstraints?.crossfadeDurationSeconds || 0),
          },
          transitionScoringPolicyVersion: TRANSITION_SCORING_POLICY_VERSION,
          wisdomSnapshotHash: canonicalSha256(getWisdom()),
          canonicalBrief: {
            selectedTrackIds,
            userConstraints: userConstraints || {},
            designSchemaVersion: design.schemaVersion,
          },
          canonicalTransitionCandidates: Array.isArray(design.transitionMatrixSummary)
            ? design.transitionMatrixSummary.map((candidate: any) => ({ ...candidate }))
            : [],
          createdAt: now,
        });
        writeDesignSnapshotV4(workDir, snapshot);
        if (!existingState) {
          writeAutomaticSessionState(workDir, {
            schemaVersion: 1,
            workflowVersion: AUTOMATIC_WORKFLOW_VERSION,
            sessionId,
            state: "created",
            stateRevision: 0,
            selectedTrackIds,
            selectionHash,
            designHash: snapshot.designHash,
            activeArrangementVersion: null,
            activeExecutionGeneration: 0,
            currentCandidateId: null,
            idempotencyRecords: [],
            recoverableError: null,
            createdAt: now,
            updatedAt: now,
          }, -1);
          // The local analysis is already complete when this route is called,
          // but preserve the state-machine boundaries rather than jumping from
          // creation directly into planning.
          transitionAutomaticSessionState({ workDir, sessionId, to: "analyzing" });
          transitionAutomaticSessionState({ workDir, sessionId, to: "planning" });
        } else if (existingState.designHash !== snapshot.designHash) {
          writeAutomaticSessionState(workDir, {
            ...existingState,
            designHash: snapshot.designHash,
          }, existingState.stateRevision);
        }
      });
    } catch (error: any) {
      return res.status(409).json({ error: error.message });
    }
    if (!sessions[sessionId]) sessions[sessionId] = { status: "running", logs: [] };
    // v4 is automatic even though it deliberately has no legacy,
    // model-authored project brief. Preserve that authority boundary for the
    // in-memory portion of the workflow until server restart reconciliation.
    sessions[sessionId].workflowMode = "automatic";
    sessions[sessionId].trackIntelligence = structuredClone(tracks);
    sessions[sessionId].medleyDesign = structuredClone(design);
  }

  const responsePayload = {
    success: true,
    design,
  };
  const idempotencyKey = String(
    req.get("Idempotency-Key") || req.body?.idempotencyKey || "",
  ).trim();
  if (sessionId && idempotencyKey) {
    try {
      const replay = await replayAutomaticSessionIdempotent({
        workDir,
        sessionId,
        operation: "session_creation",
        key: idempotencyKey,
        request: {
          selectedTrackIds: source.map((entry: any) => entry.id),
          userConstraints: userConstraints || {},
        },
        execute: async () => responsePayload,
      });
      return res.json({ ...replay.result, idempotent: replay.replayed });
    } catch (error: any) {
      return res.status(409).json({ success: false, error: error.message });
    }
  }
  return res.json(responsePayload);
});

// Section pair evaluation (uses the cache populated by the design route)
app.post("/api/section-pair-evaluate", (req, res) => {
  const { fromTrackId, fromSectionId, toTrackId, toSectionId, sessionId } = req.body || {};
  if (!fromTrackId || !fromSectionId || !toTrackId || !toSectionId) {
    return res.status(400).json({
      error:
        "fromTrackId, fromSectionId, toTrackId, toSectionId are all required.",
    });
  }
  const authoritativeTracks = getSessionTrackIntelligence(sessionId);
  if (!authoritativeTracks.length) {
    return res.status(400).json({
      error:
        "No track intelligence available. Run /api/medley-intelligence/design first.",
    });
  }
  const fromTrack = authoritativeTracks.find(
    (t: TrackIntelligence) => t.profile.trackId === fromTrackId,
  );
  const toTrack = authoritativeTracks.find(
    (t: TrackIntelligence) => t.profile.trackId === toTrackId,
  );
  if (!fromTrack)
    return res.status(404).json({ error: `Track not found: ${fromTrackId}` });
  if (!toTrack)
    return res.status(404).json({ error: `Track not found: ${toTrackId}` });
  const result = evaluateSectionPair(
    fromTrack,
    toTrack,
    fromSectionId,
    toSectionId,
  );
  if (!result) {
    return res.status(404).json({
      error: `One or both section IDs not found (fromSectionId=${fromSectionId}, toSectionId=${toSectionId}).`,
    });
  }
  res.json({ success: true, transition: result });
});

app.post("/api/medley-quality", async (req, res) => {
  const { filePath, sessionId } = req.body || {};
  if (!filePath) {
    return res.status(400).json({ error: "filePath is required" });
  }
  try {
    const result = await analyzeMedleyQuality(
      filePath,
      sessionId ? path.join(workDir, sessionId) : workDir,
    );
    res.json({ success: true, quality: result });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/session/project-brief", async (req, res) => {
  const { sessionId, brief } = req.body || {};
  try {
    validateSessionId(sessionId);
    const idempotencyKey = String(
      req.get("Idempotency-Key") || req.body?.idempotencyKey || "",
    ).trim();
    return await withSessionLock(sessionId, async () => {
      const execute = async () => {
      let parsed = ProjectBriefSchema.parse(brief);
      if (parsed.projectId !== sessionId) {
        throw new Error("projectId must match sessionId");
      }
      const specialistContext = buildSpecialistContext(sessionId);
      parsed = bindLegacyProjectBriefAuthority(parsed, specialistContext);
      const contextualErrors = validateProjectBriefContext(parsed, specialistContext);
      if (contextualErrors.length) {
        throw new Error(contextualErrors.join("; "));
      }
      if (!sessions[sessionId])
        sessions[sessionId] = { status: "running", logs: [] };
      sessions[sessionId].projectBrief = parsed;
      const existingSessionTracks = getSessionTrackIntelligence(sessionId);
      sessions[sessionId].trackIntelligence = selectSessionTrackIntelligence(
        existingSessionTracks,
        getCurrentTrackIntelligence(),
        parsed.recommendedOrderIds,
      );
      sessions[sessionId].workflowMode = "automatic";
      sessions[sessionId].workflowStage = "arrangement";
      return { success: true, brief: parsed };
      };
      const automaticState = readAutomaticSessionState(workDir, sessionId);
      const replay = idempotencyKey && automaticState
        ? await replayAutomaticSessionIdempotent({
            workDir,
            sessionId,
            operation: "project_brief",
            key: idempotencyKey,
            request: brief,
            execute,
          })
        : idempotencyKey
          ? await replayIdempotent({
              sessionId,
              operation: "project_brief",
              key: idempotencyKey,
              request: brief,
              execute,
            })
          : { replayed: false, result: await execute() };
      return res.json({ ...replay.result, idempotent: replay.replayed });
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/session/execution-report", async (req, res) => {
  const { sessionId, report } = req.body || {};
  try {
    validateSessionId(sessionId);
    const idempotencyKey = String(
      req.get("Idempotency-Key") || req.body?.idempotencyKey || "",
    ).trim();
    return await withSessionLock(sessionId, async () => {
    const execute = async () => {
    const parsed = ExecutionReportSchema.parse(report);
    const planResult = ArrangementPlanSchema.safeParse(
      sessions[sessionId]?.designPlan,
    );
    if (!planResult.success) {
      throw new Error("No valid locked arrangement exists for this session");
    }
    const contextualErrors = validateExecutionContext(parsed, planResult.data);
    if (contextualErrors.length)
      throw new Error(contextualErrors.join("; "));
    if (sessions[sessionId]?.projectBrief) {
      const authoritative =
        sessions[sessionId]?.executionResults?.[parsed.executionVersion] || {};
      const authorityErrors: string[] = [];
      for (const [index, attempt] of parsed.attemptedTransitions.entries()) {
        const actual = authoritative[attempt.transitionId];
        if (!actual) {
          authorityErrors.push(
            `attemptedTransitions[${index}]: No server execution exists for ${attempt.transitionId}`,
          );
          continue;
        }
        if (attempt.success !== actual.success) {
          authorityErrors.push(
            `attemptedTransitions[${index}].success: Does not match server execution`,
          );
        }
        if (attempt.previewPath !== actual.previewPath) {
          authorityErrors.push(
            `attemptedTransitions[${index}].previewPath: Does not match server execution`,
          );
        }
        for (const field of [
          "fromTrackId",
          "fromSectionId",
          "toTrackId",
          "toSectionId",
          "style",
          "duration",
          "beatAlign",
        ] as const) {
          if (attempt[field] !== actual.request[field]) {
            authorityErrors.push(
              `attemptedTransitions[${index}].${field}: Does not match server execution`,
            );
          }
        }
        for (const field of [
          "actualFromExitSec",
          "actualToEntrySec",
        ] as const) {
          const reported = attempt[field];
          const recorded = actual[field];
          if (
            reported !== recorded &&
            !(
              typeof reported === "number" &&
              typeof recorded === "number" &&
              Math.abs(reported - recorded) < 0.001
            )
          ) {
            authorityErrors.push(
              `attemptedTransitions[${index}].${field}: Does not match server execution`,
            );
          }
        }
      }
      if (authorityErrors.length)
        throw new Error(authorityErrors.join("; "));
    }
    sessions[sessionId].executionReport = parsed;
    sessions[sessionId].workflowStage = "review_candidate";
    return { success: true, report: parsed };
    };
    const automaticState = readAutomaticSessionState(workDir, sessionId);
    const replay = idempotencyKey && automaticState
      ? await replayAutomaticSessionIdempotent({
          workDir,
          sessionId,
          operation: "execution_compilation",
          key: idempotencyKey,
          request: report,
          execute,
        })
      : idempotencyKey
        ? await replayIdempotent({
            sessionId,
            operation: "execution_compilation",
            key: idempotencyKey,
            request: report,
            execute,
          })
        : { replayed: false, result: await execute() };
    return res.json({ ...replay.result, idempotent: replay.replayed });
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/session/quality-review", async (req, res) => {
  const { sessionId, review } = req.body || {};
  try {
    validateSessionId(sessionId);
    const idempotencyKey = String(
      req.get("Idempotency-Key") || req.body?.idempotencyKey || "",
    ).trim();
    return await withSessionLock(sessionId, async () => {
      const execute = async () => {
      const parsed = QualityReviewSchema.parse(review);
      const existingManifest = readCandidateManifest(workDir, sessionId);
      const reviewedCandidate = existingManifest.candidates.find(
        (item) => item.candidateId === parsed.candidateId,
      );
      if (!reviewedCandidate) {
        throw new Error("Reviewed candidate is not registered");
      }
      if (
        reviewedCandidate.candidateVersion !== parsed.candidateVersion ||
        reviewedCandidate.arrangementVersion !== parsed.arrangementVersion
      ) {
        throw new Error("Review version does not match the registered candidate");
      }
      if (parsed.approved && parsed.blockingIssues.length) {
        throw new Error("An approved review cannot contain blocking issues");
      }
      const plan = ArrangementPlanSchema.safeParse(
        sessions[sessionId]?.designPlan,
      );
      if (plan.success) {
        const transitionIds = new Set(
          plan.data.transitions.map((item) => item.transitionId),
        );
        const unknownCorrection = parsed.corrections.find(
          (item) => !transitionIds.has(item.transitionId),
        );
        if (unknownCorrection) {
          throw new Error(
            `Unknown correction transition: ${unknownCorrection.transitionId}`,
          );
        }
      }
      const automaticState = existingManifest.workflowMode === "automatic"
        ? readAutomaticSessionState(workDir, sessionId)
        : null;
      if (automaticState) {
        if (automaticState.state === "technical_review") {
          transitionAutomaticSessionState({ workDir, sessionId, to: "musical_review" });
        }
        const musicalState = readAutomaticSessionState(workDir, sessionId)!;
        if (musicalState.state !== "musical_review") {
          throw new Error(`Musical review is not valid while session state is ${musicalState.state}`);
        }
      }
      const manifest = applyCandidateReview(workDir, sessionId, parsed);
      sessions[sessionId].qualityReview = parsed;
      sessions[sessionId].workflowStage = parsed.approved
        ? "final_render"
        : "correction";
      const postReviewState = existingManifest.workflowMode === "automatic"
        ? readAutomaticSessionState(workDir, sessionId)
        : null;
      if (postReviewState) {
        transitionAutomaticSessionState({
          workDir,
          sessionId,
          to: parsed.approved ? "finalizing" : "correcting",
        });
      }
      return { success: true, review: parsed, manifest };
      };
      const automaticState = readAutomaticSessionState(workDir, sessionId);
      const replay = idempotencyKey && automaticState
        ? await replayAutomaticSessionIdempotent({
            workDir,
            sessionId,
            operation: "musical_review",
            key: idempotencyKey,
            request: review,
            execute,
          })
        : idempotencyKey
          ? await replayIdempotent({
              sessionId,
              operation: "musical_review",
              key: idempotencyKey,
              request: review,
              execute,
            })
          : { replayed: false, result: await execute() };
      return res.json({ ...replay.result, idempotent: replay.replayed });
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/session/:sessionId/candidates", (req, res) => {
  try {
    const manifest = readCandidateManifest(workDir, req.params.sessionId);
    res.json({ success: true, manifest });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/session/:sessionId/state", (req, res) => {
  try {
    validateSessionId(req.params.sessionId);
    const state = readAutomaticSessionState(workDir, req.params.sessionId);
    if (!state) return res.status(404).json({ error: "Automatic v4 session state not found" });
    return res.json({
      success: true,
      state,
      manifest: readCandidateManifest(workDir, req.params.sessionId),
    });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
});

app.post("/api/session/manual-review-required", async (req, res) => {
  const { sessionId, reason } = req.body || {};
  try {
    validateSessionId(sessionId);
    const normalizedReason = String(reason || "Manual review is required")
      .trim()
      .slice(0, 2_000);
    if (!normalizedReason) throw new Error("Manual review reason is required");
    const idempotencyKey = String(
      req.get("Idempotency-Key") || req.body?.idempotencyKey || "",
    ).trim();
    return await withSessionLock(sessionId, async () => {
      const execute = async () => {
        const state = readAutomaticSessionState(workDir, sessionId);
        if (!state) throw new Error("Automatic v4 session state is missing");
        if (state.state === "manual_review_required") {
          return { success: true, state, alreadyRequired: true };
        }
        if (state.state !== "correcting") {
          throw new Error(`Manual review cannot be entered while session state is ${state.state}`);
        }
        const next = transitionAutomaticSessionState({
          workDir,
          sessionId,
          to: "manual_review_required",
          recoverableError: normalizedReason,
        });
        return { success: true, state: next, alreadyRequired: false };
      };
      const replay = idempotencyKey
        ? await replayAutomaticSessionIdempotent({
            workDir,
            sessionId,
            operation: "correction_submission",
            key: idempotencyKey,
            request: { reason: normalizedReason },
            execute,
          })
        : { replayed: false, result: await execute() };
      return res.json({ ...replay.result, idempotent: replay.replayed });
    });
  } catch (error: any) {
    return res.status(409).json({ success: false, error: error.message });
  }
});

app.post("/api/session/human-review", async (req, res) => {
  const { sessionId, review, expectedRevision } = req.body || {};
  try {
    validateSessionId(sessionId);
    const parsedReview = CandidateHumanReviewSchema.parse(review);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new Error("expectedRevision is required for human approval");
    }
    const idempotencyKey = String(
      req.get("Idempotency-Key") || req.body?.idempotencyKey || "",
    ).trim();
    return await withSessionLock(sessionId, async () => {
      const execute = async () => {
        const state = readAutomaticSessionState(workDir, sessionId);
        if (!state) throw new Error("Automatic v4 session state is missing");
        if (state.stateRevision !== expectedRevision) {
          throw new Error(
            `State revision conflict: expected ${expectedRevision}, found ${state.stateRevision}`,
          );
        }
        if (state.state !== "manual_review_required") {
          throw new Error("Human approval is allowed only while manual review is required");
        }
        const manifest = applyCandidateHumanReview(workDir, sessionId, parsedReview);
        if (parsedReview.decision === "approved") {
          transitionAutomaticSessionState({
            workDir,
            sessionId,
            to: "finalizing",
          });
        }
        return {
          success: true,
          manifest,
          state: readAutomaticSessionState(workDir, sessionId),
        };
      };
      const replay = idempotencyKey
        ? await replayAutomaticSessionIdempotent({
            workDir,
            sessionId,
            operation: "human_approval",
            key: idempotencyKey,
            request: { review: parsedReview, expectedRevision },
            execute,
          })
        : { replayed: false, result: await execute() };
      return res.json({ ...replay.result, idempotent: replay.replayed });
    });
  } catch (error: any) {
    return res.status(409).json({ success: false, error: error.message });
  }
});

app.post("/api/session/design-plan", async (req, res) => {
  const { sessionId, plan, contractVersion } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: "sessionId required" });
  if (!plan || !Array.isArray(plan.transitions)) {
    return res.status(400).json({ error: "plan.transitions must be an array" });
  }
  try {
    validateSessionId(sessionId);
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
  const idempotencyKey = String(
    req.get("Idempotency-Key") || req.body?.idempotencyKey || "",
  ).trim();
  try {
  return await withSessionLock(sessionId, async () => {
  const execute = async () => {
  if (!sessions[sessionId]) {
    sessions[sessionId] = { status: "running", logs: [] };
  }
  if (
    !sessions[sessionId].projectBrief &&
    sessions[sessionId].workflowMode !== "automatic"
  ) {
    try {
      parseManualToolCall(
        "set_design_plan",
        { contractVersion, transitions: plan.transitions },
        { allowLegacy: contractVersion === undefined },
      );
    } catch (error: any) {
      throw error;
    }
  }

  // Merge enriched timing fields from the previous design plan (if any) and from
  // session.enrichedTimings (populated by apply_musical_transition even before set_design_plan).
  // This prevents set_design_plan from destroying actualFromExitSec / actualToEntrySec.
  const existingPlan = sessions[sessionId].designPlan;
  const enrichedTimings = sessions[sessionId].enrichedTimings || {};
  const ENRICHED_FIELDS = [
    "actualFromExitSec",
    "actualToEntrySec",
    "actualOverlapSec",
    "durationUsed",
    "beatSnapApplied",
    "outputPath",
  ];

  if (
    !sessions[sessionId].projectBrief &&
    sessions[sessionId].workflowMode !== "automatic"
  ) {
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
        const old = existingPlan.transitions.find(
          (t: any) =>
            t.fromTrackId === incoming.fromTrackId &&
            t.fromSectionId === incoming.fromSectionId &&
            t.toTrackId === incoming.toTrackId &&
            t.toSectionId === incoming.toSectionId,
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
    const specialistContext = buildSpecialistContext(sessionId);
    const authoritativePlan = bindLegacyArrangementAuthority(
      specialistPlan.data,
      specialistContext,
    );
    if (authoritativePlan.projectId !== sessionId) {
      throw new Error("projectId must match sessionId");
    }
    const contextualErrors = validateArrangementContext(
      authoritativePlan,
      specialistContext,
    );
    const expectedTrackIds = new Set<string>(
      (sessions[sessionId].projectBrief?.recommendedOrderIds ||
        authoritativePlan.orderedTrackIds) as string[],
    );
    const actualTrackIds = new Set(authoritativePlan.orderedTrackIds);
    if (
      expectedTrackIds.size !== actualTrackIds.size ||
      [...expectedTrackIds].some((trackId) => !actualTrackIds.has(trackId))
    ) {
      contextualErrors.push(
        "orderedTrackIds: Must include every track from the project brief",
      );
    }
    if (contextualErrors.length) {
      throw new Error(contextualErrors.join("; "));
    }
    const automaticState = readAutomaticSessionState(workDir, sessionId);
    if (automaticState) {
      const snapshot = readDesignSnapshotV4(workDir, sessionId);
      if (!snapshot || snapshot.designHash !== automaticState.designHash) {
        throw new Error("Automatic v4 design snapshot is missing or does not match session state");
      }
      if (automaticState.state === "correcting") {
        transitionAutomaticSessionState({ workDir, sessionId, to: "planning" });
      }
      transitionAutomaticSessionState({
        workDir,
        sessionId,
        to: "validating_arrangement",
      });
      writeArrangementVersionV1(workDir, {
        schemaVersion: 1,
        workflowVersion: AUTOMATIC_WORKFLOW_VERSION,
        sessionId,
        arrangementVersion: authoritativePlan.arrangementVersion,
        designHash: snapshot.designHash,
        arrangement: authoritativePlan,
        submittedAt: new Date().toISOString(),
      });
      const validatingState = readAutomaticSessionState(workDir, sessionId)!;
      writeAutomaticSessionState(workDir, {
        ...validatingState,
        activeArrangementVersion: authoritativePlan.arrangementVersion,
      }, validatingState.stateRevision);
      transitionAutomaticSessionState({
        workDir,
        sessionId,
        to: "executing_transitions",
      });
    }
    sessions[sessionId].designPlan = authoritativePlan;
    sessions[sessionId].workflowStage = "production";
  } else if (sessions[sessionId].projectBrief) {
    throw new Error(formatValidationIssues(specialistPlan.error).join("; "));
  } else {
    // Legacy/manual sessions retain their existing loose plan format.
    sessions[sessionId].designPlan = plan;
  }

  // Soft validation: warn about any low-score pairs
  const warnings: string[] = [];
  const authoritativeTracks = getSessionTrackIntelligence(sessionId);
  if (authoritativeTracks.length) {
    for (const t of plan.transitions) {
      const fromTrack = authoritativeTracks.find(
        (tr: TrackIntelligence) => tr.profile.trackId === t.fromTrackId,
      );
      const toTrack = authoritativeTracks.find(
        (tr: TrackIntelligence) => tr.profile.trackId === t.toTrackId,
      );
      if (fromTrack && toTrack && t.fromSectionId && t.toSectionId) {
        const score = evaluateSectionPair(
          fromTrack,
          toTrack,
          t.fromSectionId,
          t.toSectionId,
        );
        if (score && score.score < 0.35) {
          warnings.push(
            `Low-score transition (${score.score.toFixed(2)}): ${t.fromSectionId} → ${t.toSectionId}. Consider reviewing.`,
          );
        }
      }
    }
  }
  return {
    success: true,
    storedTransitions: plan.transitions.length,
    warnings,
  };
  };
  const automaticState = readAutomaticSessionState(workDir, sessionId);
  const replay = idempotencyKey && automaticState
    ? await replayAutomaticSessionIdempotent({
        workDir,
        sessionId,
        operation: "arrangement_submission",
        key: idempotencyKey,
        request: { plan, contractVersion },
        execute,
      })
    : idempotencyKey
      ? await replayIdempotent({
          sessionId,
          operation: "arrangement_submission",
          key: idempotencyKey,
          request: { plan, contractVersion },
          execute,
        })
      : { replayed: false, result: await execute() };
  return res.json({ ...replay.result, idempotent: replay.replayed });
  });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

// Musical transition endpoint (high-quality blending tool for the agent)
app.post("/api/apply-transition", async (req, res) => {
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
    contractVersion,
  } = req.body || {};

  if (!fromTrackId || !fromSectionId || !toTrackId || !toSectionId || !style) {
    return res.status(400).json({
      error:
        "fromTrackId, fromSectionId, toTrackId, toSectionId, and style are required.",
    });
  }

  if (sessionId) {
    try {
      validateSessionId(sessionId);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  }
  const idempotencyKey = String(
    req.get("Idempotency-Key") || req.body?.idempotencyKey || "",
  ).trim();
  const idempotencyRequest = {
    transitionId: transitionId || null,
    fromTrackId,
    fromSectionId,
    toTrackId,
    toSectionId,
    style,
    duration: duration ?? null,
    intensity: intensity ?? null,
    beatAlign: beatAlign ?? null,
    notes: notes ?? null,
    executionVersion: Number(executionVersion) || 1,
    contractVersion: contractVersion ?? null,
  };
  const fail = (statusCode: number, message: string): never => {
    const error: any = new Error(message);
    error.statusCode = statusCode;
    throw error;
  };
  const runTransition = async () => {

  // --- Basic implementation of musical transition ---
  console.log(
    `[apply-transition] Processing: ${fromTrackId}:${fromSectionId} → ${toTrackId}:${toSectionId} [${style}]`,
  );

  const session = sessionId ? sessions[sessionId] : null;
  const designPlan = session?.designPlan;
  let validatedExecutionRequest: any = null;
  const automaticExecution = Boolean(
    session?.projectBrief ||
      session?.workflowMode === "automatic" ||
      (sessionId && readAutomaticSessionState(workDir, sessionId)),
  );
  if (automaticExecution) {
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
      fail(400, formatValidationIssues(parsedRequest.error).join("; "));
    }
    const lockedPlan = ArrangementPlanSchema.safeParse(designPlan);
    if (!lockedPlan.success) {
      fail(400, "No valid locked arrangement exists for this session");
    }
    const contextualErrors = validateTransitionExecutionContext(
      parsedRequest.data,
      lockedPlan.data,
    );
    if (contextualErrors.length) {
      fail(400, contextualErrors.join("; "));
    }
    validatedExecutionRequest = parsedRequest.data;
  } else {
    try {
      parseManualToolCall(
        "apply_musical_transition",
        {
          contractVersion,
          fromTrackId,
          fromSectionId,
          toTrackId,
          toSectionId,
          style,
          duration,
          intensity,
          beatAlign,
          notes,
        },
        { allowLegacy: contractVersion === undefined },
      );
    } catch (error: any) {
      fail(400, error.message);
    }
  }

  // Try to find the planned transition details
  let plannedTransition = null;
  if (designPlan && designPlan.transitions) {
    plannedTransition = designPlan.transitions.find(
      (t: any) =>
        t.fromTrackId === fromTrackId &&
        t.fromSectionId === fromSectionId &&
        t.toTrackId === toTrackId &&
        t.toSectionId === toSectionId,
    );
  }

  const transitionDuration = duration || plannedTransition?.duration || 5;
  const useBeatAlign = beatAlign ?? true;

  const fromEntry = getLibrary().find((e: any) => e.id === fromTrackId);
  const toEntry = getLibrary().find((e: any) => e.id === toTrackId);

    if (!fromEntry || !toEntry) {
    fail(404, "One or both tracks not found in library");
  }

  const sessionWorkDir = path.join(workDir, sessionId || "default");
  if (!fs.existsSync(sessionWorkDir))
    fs.mkdirSync(sessionWorkDir, { recursive: true });

  const safeTransitionKey = `${fromSectionId}_to_${toSectionId}`
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 140);
  const outputTransitionPath = path.join(
    sessionWorkDir,
    `transition-exec-${String(Number(executionVersion) || 1).padStart(3, "0")}-${safeTransitionKey}.mp3`,
  );
  const stagedTransitionPath = `${outputTransitionPath}.${uuidv4()}.part.mp3`;

  try {
    // Load rich intelligence data if available (for beats, energy, etc.)
    let fromIntelligence: TrackIntelligence | null = null;
    let toIntelligence: TrackIntelligence | null = null;

    const authoritativeTracks = getSessionTrackIntelligence(sessionId);
    if (authoritativeTracks.length) {
      fromIntelligence =
        authoritativeTracks.find(
          (t: TrackIntelligence) => t.profile.trackId === fromTrackId,
        ) || null;
      toIntelligence =
        authoritativeTracks.find(
          (t: TrackIntelligence) => t.profile.trackId === toTrackId,
        ) || null;
    }

    // Determine base cut points from design plan or defaults
    let fromStart = plannedTransition?.fromExitSec
      ? Math.max(0, plannedTransition.fromExitSec - transitionDuration)
      : 0;
    let toStart = plannedTransition?.toEntrySec || 0;

    // === Beat Snapping (if requested and we have beat data) ===
    let beatSnapNotes = "";
    if (useBeatAlign) {
      const fromBeats =
        fromIntelligence?.localFacts?.find((f: any) => f.name === "beat_grid")
          ?.value || [];
      const toBeats =
        toIntelligence?.localFacts?.find((f: any) => f.name === "beat_grid")
          ?.value || [];

      const fromBeatsArray = Array.isArray(fromBeats) ? fromBeats : [];
      if (fromBeatsArray.length > 0) {
        const snap = snapToNearestBeat(
          fromStart + transitionDuration,
          fromBeatsArray,
        );
        if (snap.distance < 0.25) {
          // only snap if reasonably close
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
    const extraFilters = styleConfig.postJoinFilters;

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
        beatSnapApplied: useBeatAlign && beatSnapNotes.length > 0,
        style,
      };
      // Legacy manual sessions still expect execution details on the loose plan.
      if (
        !automaticExecution &&
        session.designPlan &&
        Array.isArray(session.designPlan.transitions)
      ) {
        const matchingTransition = session.designPlan.transitions.find(
          (t: any) =>
            t.fromTrackId === fromTrackId &&
            t.fromSectionId === fromSectionId &&
            t.toTrackId === toTrackId &&
            t.toSectionId === toSectionId,
        );
        if (matchingTransition) {
          matchingTransition.actualFromExitSec = actualFromExit;
          matchingTransition.actualToEntrySec = actualToEntry;
          matchingTransition.durationUsed = transitionDuration;
          matchingTransition.beatSnapApplied =
            useBeatAlign && beatSnapNotes.length > 0;
          matchingTransition.style = style;
        }
      }
    }

    // Build improved filter chain for PREVIEW only
    const previewJoin = buildCanonicalAcrossfade({
      leftLabel: "a0",
      rightLabel: "a1",
      outputLabel: "joined",
      duration: transitionDuration,
      style,
    });
    const filterComplex =
      `[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,atrim=start=${fromStart}:duration=${transitionDuration},asetpts=PTS-STARTPTS[a0];` +
      `[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,atrim=start=${toStart}:duration=${transitionDuration},asetpts=PTS-STARTPTS[a1];` +
      `${previewJoin};[joined]loudnorm=I=-14:TP=-1.5,alimiter=limit=0.891:level=off[out]`;

    const cmd = [
      "-y",
      "-i",
      fromPath,
      "-i",
      toPath,
      "-filter_complex",
      filterComplex,
      "-map",
      "[out]",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "320k",
      stagedTransitionPath,
    ];

    await execFfmpeg(cmd, 120000, {
      rejectOnError: true,
      onSpawned: (proc) => {
        if (sessionId) activeRenderProcesses[sessionId] = proc;
      },
    });
    if (sessionId) delete activeRenderProcesses[sessionId];
    const previewSize = fs.existsSync(stagedTransitionPath)
      ? fs.statSync(stagedTransitionPath).size
      : 0;
    const previewProbeOutput = await execFfmpeg(["-i", stagedTransitionPath]);
    assertExpectedPreviewArtifact({
      sizeBytes: previewSize,
      probe: parseFfmpegAudioProbe(previewProbeOutput),
      expectedDurationSec: transitionDuration,
    });
    fs.renameSync(stagedTransitionPath, outputTransitionPath);

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
    if (
      !automaticExecution &&
      session?.designPlan &&
      Array.isArray(session.designPlan.transitions)
    ) {
      const matchingTransition = session.designPlan.transitions.find(
        (t: any) =>
          t.fromTrackId === fromTrackId &&
          t.fromSectionId === fromSectionId &&
          t.toTrackId === toTrackId &&
          t.toSectionId === toSectionId,
      );
      if (matchingTransition) {
        matchingTransition.outputPath = outputTransitionPath;
      }
    }

    const finalNotes = `Applied ${style} transition (${transitionDuration}s).${beatSnapNotes} ${notes ? "Notes: " + notes : ""}`;
    if (automaticExecution && transitionId) {
      if (!session.executionResults) session.executionResults = {};
      if (!session.executionResults[executionVersion])
        session.executionResults[executionVersion] = {};
      session.executionResults[executionVersion][transitionId] = {
        request: validatedExecutionRequest,
        success: true,
        actualFromExitSec: actualFromExit,
        actualToEntrySec: actualToEntry,
        previewPath: outputTransitionPath,
        error: null,
      };
    }

    try {
      appendWisdom({
        type: "transition_applied",
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
        beatSnapApplied: useBeatAlign && beatSnapNotes.length > 0,
        curvesUsed: { curve1, curve2 },
        extraProcessing: extraFilters ? [extraFilters] : [],
        estimatedQuality: Math.round(
          75 + (useBeatAlign ? 8 : 0) + (style === "mashup_layer" ? -5 : 5),
        ),
      });
    } catch (wisdomError) {
      console.warn("[apply-transition] Wisdom logging failed:", wisdomError);
    }

    // Build rich return data for the agent and future evaluation
    const curvesUsed = { curve1, curve2 };
    const extraProcessingApplied = extraFilters ? [extraFilters] : [];

    return {
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
      beatSnapApplied: useBeatAlign && beatSnapNotes.length > 0,
      beatSnapDistance: useBeatAlign
        ? Math.max(
            0,
            parseFloat(beatSnapNotes.match(/offset ([\d.]+)/)?.[1] || "0"),
          )
        : 0,
      curvesUsed,
      extraProcessing: extraProcessingApplied,
      notes: finalNotes.trim(),
      estimatedQuality: Math.round(
        75 + (useBeatAlign ? 8 : 0) + (style === "mashup_layer" ? -5 : 5),
      ),
      assemblyHint:
        "Use actualFromExitSec / actualToEntrySec (or the recommended* fields) to trim the main snippets before concatenating with this transition file. Do NOT concat the full original snippets + this transition file.",
    };
  } catch (err: any) {
    fs.rmSync(stagedTransitionPath, { force: true });
    if (sessionId) delete activeRenderProcesses[sessionId];
    if (session?.projectBrief && transitionId) {
      if (!session.executionResults) session.executionResults = {};
      if (!session.executionResults[executionVersion])
        session.executionResults[executionVersion] = {};
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
    console.error("[apply-transition] Error:", err);
    err.statusCode = err.statusCode || 500;
    err.responsePayload = {
      success: false,
      error: "Failed to apply transition",
      details: err.message,
      style: style,
      from: `${fromTrackId}:${fromSectionId}`,
      to: `${toTrackId}:${toSectionId}`,
      attemptedDuration: transitionDuration,
      stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
    };
    throw err;
  }
  };
  try {
    const execute = async () => runTransition();
    const result = sessionId
      ? await withSessionLock(sessionId, async () => {
          const automaticState = readAutomaticSessionState(workDir, sessionId);
          const replay = idempotencyKey && automaticState
            ? await replayAutomaticSessionIdempotent({
                workDir,
                sessionId,
                operation: "transition_execution",
                key: idempotencyKey,
                request: idempotencyRequest,
                execute,
              })
            : idempotencyKey
              ? await replayIdempotent({
                  sessionId,
                  operation: "transition_execution",
                  key: idempotencyKey,
                  request: idempotencyRequest,
                  execute,
                })
              : { replayed: false, result: await execute() };
          return { ...replay.result, idempotent: replay.replayed };
        })
      : await execute();
    return res.json(result);
  } catch (error: any) {
    return res.status(error.statusCode || 500).json(
      error.responsePayload || {
        success: false,
        error: error.message || "Failed to apply transition",
      },
    );
  }
});

// === PURE CLEAN RENDER ===
// Original sources only + single-pass filter_complex_script.
// Supports the six canonical sequential crossfade styles shared with previews.
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
app.post("/api/render-review-candidate", async (req, res) => {
  const {
    sessionId,
    parentCandidateId = null,
    legacy = false,
    contractVersion,
  } = req.body || {};
  let arrangementVersion = Number(req.body?.arrangementVersion || 0);
  let executionVersion = Number(req.body?.executionVersion || 0);

  if (!sessionId || (!legacy && (!arrangementVersion || !executionVersion))) {
    return res.status(400).json({
      success: false,
      error: "sessionId, arrangementVersion, and executionVersion are required",
    });
  }
  if (
    legacy &&
    contractVersion !== undefined &&
    contractVersion !== MANUAL_TOOL_CONTRACT_VERSION
  ) {
    return res.status(400).json({
      success: false,
      error: `Unsupported manual contract version: ${contractVersion}`,
    });
  }

  try {
    validateSessionId(sessionId);
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error.message });
  }
  const idempotencyKey = String(
    req.get("Idempotency-Key") || req.body?.idempotencyKey || "",
  ).trim();
  const idempotencyRequest = {
    parentCandidateId,
    legacy,
    arrangementVersion,
    executionVersion,
    contractVersion: contractVersion ?? null,
  };

  return withSessionLock(sessionId, async () => {
    if (idempotencyKey) {
      const replayed = readAutomaticIdempotencyResult<{
        success: boolean;
        [key: string]: unknown;
      }>({
        workDir,
        sessionId,
        operation: "candidate_rendering",
        key: idempotencyKey,
        request: idempotencyRequest,
      });
      if (replayed) return res.json({ ...replayed, idempotent: true });
    }
    const session = sessions[sessionId];
    if (!session || !session.designPlan) {
      return res.status(400).json({
        success: false,
        error:
          "No design plan found for this session. Call set_design_plan first.",
      });
    }
    if (legacy) {
      arrangementVersion = 1;
      executionVersion = 1;
      const transitions = (session.designPlan.transitions || []).map(
        (transition: any, index: number) => ({
          transitionId:
            transition.transitionId || `legacy-transition-${index + 1}`,
          fromTrackId: transition.fromTrackId,
          fromSectionId: transition.fromSectionId,
          toTrackId: transition.toTrackId,
          toSectionId: transition.toSectionId,
          fromExitSec: Number(
            transition.actualFromExitSec ??
              transition.fromExitSec ??
              transition.exitSec ??
              0,
          ),
          toEntrySec: Number(
            transition.actualToEntrySec ??
              transition.toEntrySec ??
              transition.entrySec ??
              0,
          ),
          duration: Number(transition.durationUsed ?? transition.duration ?? 5),
          style: transition.style || "smooth_blend",
          beatAlign: transition.beatAlign ?? true,
          notes: transition.notes || "",
          ...transition,
        }),
      );
      session.designPlan = {
        schemaVersion: 1,
        arrangementVersion,
        projectId: sessionId,
        strategy: "Legacy manual workflow",
        orderedTrackIds: [
          transitions[0]?.fromTrackId,
          ...transitions.map((transition: any) => transition.toTrackId),
        ].filter(Boolean),
        transitions,
        confidence: 0.5,
        warnings: ["Generated from a legacy manual session"],
      };
      session.executionReport = {
        schemaVersion: 1,
        executionVersion,
        arrangementVersion,
        attemptedTransitions: transitions.map((transition: any) => ({
          ...transition,
          success: true,
          actualFromExitSec:
            transition.actualFromExitSec ?? transition.fromExitSec,
          actualToEntrySec:
            transition.actualToEntrySec ?? transition.toEntrySec,
          previewPath: transition.outputPath ?? null,
          error: null,
        })),
        technicalWarnings: ["Legacy manual execution report"],
        unresolvedFailures: [],
        completedAt: new Date().toISOString(),
      };
    }
    if (!session.executionReport) {
      return res.status(400).json({
        success: false,
        error: "No validated execution report found for this session.",
      });
    }
    if (
      session.designPlan.arrangementVersion !== arrangementVersion ||
      session.executionReport.executionVersion !== executionVersion
    ) {
      return res.status(400).json({
        success: false,
        error: "Arrangement or execution version mismatch.",
      });
    }

    const designPlan = session.designPlan;
    const sessionWorkDir = getSessionDirectory(workDir, sessionId);
    if (!fs.existsSync(sessionWorkDir)) {
      fs.mkdirSync(sessionWorkDir, { recursive: true });
    }
    const manifest = readCandidateManifest(workDir, sessionId);
    const renderState = !legacy
      ? readAutomaticSessionState(workDir, sessionId)
      : null;
    if (renderState?.state === "executing_transitions") {
      transitionAutomaticSessionState({
        workDir,
        sessionId,
        to: "rendering_candidate",
      });
    }
    const recoveredTechnicalEvaluation = recoverRegisteredCandidateTechnicalEvaluation({
      workDir,
      sessionId,
      arrangementVersion,
      executionVersion,
    });
      if (recoveredTechnicalEvaluation) {
      sessions[sessionId].workflowStage = "quality_review";
      sessions[sessionId].currentCandidate = recoveredTechnicalEvaluation.candidate;
      const recoveredState = readAutomaticSessionState(workDir, sessionId);
      if (recoveredState?.state === "rendering_candidate") {
        transitionAutomaticSessionState({ workDir, sessionId, to: "technical_review" });
      }
      const responsePayload = {
        success: true,
        candidate: recoveredTechnicalEvaluation.candidate,
        manifest: recoveredTechnicalEvaluation.manifest,
        quality: recoveredTechnicalEvaluation.quality,
        outputPath: recoveredTechnicalEvaluation.candidate.outputPath,
        renderPath: "recovered-technical-evaluation",
        recoveredAfterRegistrationFailure: true,
        message: "Recovered the registered candidate's missing technical evaluation without rerendering audio.",
      };
      if (idempotencyKey && readAutomaticSessionState(workDir, sessionId)) {
        const replay = await replayAutomaticSessionIdempotent({
          workDir,
          sessionId,
          operation: "candidate_rendering",
          key: idempotencyKey,
          request: idempotencyRequest,
          execute: async () => responsePayload,
        });
        return res.json({ ...replay.result, idempotent: replay.replayed });
      }
      return res.json(responsePayload);
    }
    const { candidateId, candidateVersion } = nextCandidateIdentity(manifest);
    const immutableOutputPath = path.join(
      sessionWorkDir,
      `${candidateId}.mp3`,
    );
    const validationPath = path.join(
      sessionWorkDir,
      `${candidateId}-validation.json`,
    );
    assertCandidateStorageAvailable(workDir, sessionId, 150 * 1024 * 1024);
    assertSessionArtifactBudget(workDir, sessionId, 150 * 1024 * 1024);
    const safeMp3Name = `${candidateId}.mp3.part`;
    const outputPath = path.join(sessionWorkDir, safeMp3Name);
    const artifactPrefix = candidateId;
    const graphName = `${artifactPrefix}-filtergraph.txt`;

    // Clean up any old confusing filtergraph.txt from previous code paths
    const oldGraph = path.join(sessionWorkDir, "filtergraph.txt");
    if (fs.existsSync(oldGraph)) {
      try {
        fs.unlinkSync(oldGraph);
      } catch {}
    }

    console.log(
      `[finalize-medley] >>> ENTERING PURE-CLEAN-MVP ONLY PATH (no fallbacks) for session ${sessionId}`,
    );
    console.log(
      `[finalize-medley] This handler will ONLY produce output via the single-pass filter_complex_script route. Any other output is from outside this path.`,
    );

    if (sessionId) {
      logToSession(
        sessionId,
        `[candidate-render] Starting review render for ${candidateId}`,
      );
    }

    try {
      const recovered = recoverUnregisteredRenderedCandidate({
        workDir,
        sessionId,
        candidateId,
        candidateVersion,
        arrangementVersion,
        executionVersion,
        parentCandidateId,
        workflowMode: legacy ? "legacy" : "automatic",
        isExecutionVersionCompatible: legacy
          ? undefined
          : (candidate) =>
              candidate.executionVersion < executionVersion &&
              isRecoveredCandidateCompatibleWithExecution(
                candidate,
                session.executionReport,
              ),
      });
      if (recovered) {
        const recoveredManifest = recovered.qualityGate
          ? appendCandidateTechnicalEvaluation(workDir, sessionId, {
              candidateId: recovered.candidate.candidateId,
              candidateVersion: recovered.candidate.candidateVersion,
              technicallyValid: Boolean(recovered.qualityGate.technicallyValid),
              blockingIssues: Array.isArray(recovered.qualityGate.blockingIssues)
                ? recovered.qualityGate.blockingIssues
                : [],
              warnings: Array.isArray(recovered.qualityGate.warnings)
                ? recovered.qualityGate.warnings
                : [],
              policyVersion: 1,
              evaluatedAt: new Date().toISOString(),
            })
          : recovered.manifest;
        const recoveredState = !legacy
          ? readAutomaticSessionState(workDir, sessionId)
          : null;
        if (recoveredState?.state === "rendering_candidate") {
          transitionAutomaticSessionState({ workDir, sessionId, to: "technical_review" });
        }
        sessions[sessionId].workflowStage = "quality_review";
        sessions[sessionId].currentCandidate = recovered.candidate;
        logToSession(
          sessionId,
          `[candidate-render] Recovered completed ${candidateId} after interrupted manifest registration.`,
        );
        const responsePayload = {
          success: true,
          candidate: recovered.candidate,
          manifest: recoveredManifest,
          quality: recovered.quality,
          resolvedTransitions: recovered.candidate.resolvedTransitions,
          outputPath: recovered.candidate.outputPath,
          renderPath: "recovered-candidate-registration",
          recoveredAfterRegistrationFailure: true,
          message:
            "Recovered the existing rendered candidate without rerendering audio.",
        };
        if (idempotencyKey && readAutomaticSessionState(workDir, sessionId)) {
          const replay = await replayAutomaticSessionIdempotent({
            workDir,
            sessionId,
            operation: "candidate_rendering",
            key: idempotencyKey,
            request: idempotencyRequest,
            execute: async () => responsePayload,
          });
          return res.json({ ...replay.result, idempotent: replay.replayed });
        }
        return res.json(responsePayload);
      }
      const selectedTransitions = selectRenderTransitions({
        sessionId,
        session,
        legacy,
        arrangementVersion,
        executionVersion,
        manifest,
        checkpointDir,
        context: buildSpecialistContext(sessionId),
      });
      const { automaticSession } = selectedTransitions;
      const transitions: any[] = selectedTransitions.transitions;
      if (transitions.length === 0) {
        throw new Error(
          "MVP finalize_medley requires at least one transition to establish deterministic track ordering and crossfade points. Single-track support is out of current strict scope.",
        );
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
          if (isFinite(Number(t.actualFromExitSec)))
            return Number(t.actualFromExitSec);
          if (isFinite(Number(t.fromExitSec))) {
            logToSession(
              sessionId,
              `[finalize-medley] Using planned timing fallback (fromExitSec) for transition[${idx}]`,
            );
            console.log(
              `[finalize-medley] Timing fallback: transition[${idx}] actualFromExitSec missing, using fromExitSec=${t.fromExitSec}`,
            );
            return Number(t.fromExitSec);
          }
          if (isFinite(Number(t.exitSec))) {
            logToSession(
              sessionId,
              `[finalize-medley] Using planned timing fallback (exitSec) for transition[${idx}]`,
            );
            console.log(
              `[finalize-medley] Timing fallback: transition[${idx}] actualFromExitSec missing, using exitSec=${t.exitSec}`,
            );
            return Number(t.exitSec);
          }
          return undefined;
        };
        const resolveTo = (): number | undefined => {
          if (isFinite(Number(t.actualToEntrySec)))
            return Number(t.actualToEntrySec);
          if (isFinite(Number(t.toEntrySec))) {
            logToSession(
              sessionId,
              `[finalize-medley] Using planned timing fallback (toEntrySec) for transition[${idx}]`,
            );
            console.log(
              `[finalize-medley] Timing fallback: transition[${idx}] actualToEntrySec missing, using toEntrySec=${t.toEntrySec}`,
            );
            return Number(t.toEntrySec);
          }
          if (isFinite(Number(t.entrySec))) {
            logToSession(
              sessionId,
              `[finalize-medley] Using planned timing fallback (entrySec) for transition[${idx}]`,
            );
            console.log(
              `[finalize-medley] Timing fallback: transition[${idx}] actualToEntrySec missing, using entrySec=${t.entrySec}`,
            );
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
              `Call apply_musical_transition for this pair before calling finalize_medley.`,
          );
        } else {
          // Store resolved values for uniform use in preflight and segment derivation
          t._resolvedFromExitSec = fromExit;
          t._resolvedToEntrySec = toEntry;
        }
      });

      if (badTransitions.length > 0) {
        throw new Error(
          "PURE-CLEAN-MVP ABORT: One or more transitions have no usable timing from any field.\n" +
            "Call apply_musical_transition for each transition before finalize_medley.\n\n" +
            badTransitions.join("\n"),
        );
      }

      if (sessionId) {
        logToSession(
          sessionId,
          `[finalize-medley] Progress: Validation passed. Building segments for ${transitions.length} transitions...`,
        );
      }

      // Library → file path lookup (also builds duration map for preflight)
      const library = getLibrary();
      const trackPathMap: Record<string, string> = {};
      const trackDurationMap: Record<string, number> = {};
      library.forEach((entry: any) => {
        if (entry && entry.id) {
          const resolved = resolveLibraryAudioEntry(entry);
          if (resolved) trackPathMap[entry.id] = resolved;
          // Use localAnalysis duration if available from pre-analysis
          if (
            entry.localAnalysis?.duration &&
            entry.localAnalysis.duration > 0
          ) {
            trackDurationMap[entry.id] = entry.localAnalysis.duration;
          } else if (
            entry.analysis &&
            typeof entry.analysis === "object" &&
            entry.analysis.duration > 0
          ) {
            trackDurationMap[entry.id] = entry.analysis.duration;
          }
        }
      });

      // === PREFLIGHT: Validate all timestamps against actual track durations ===
      if (sessionId) {
        logToSession(
          sessionId,
          `[finalize-medley] Preflight: Validating timestamps against actual track durations...`,
        );
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
                console.log(
                  `[finalize-medley] Preflight: Probed duration for ${trackId} = ${probedDuration.toFixed(2)}s`,
                );
              }
            } catch (e: any) {
              console.warn(
                `[finalize-medley] Preflight: Could not probe duration for ${trackId}: ${e.message}`,
              );
            }
          }
        }
      }

      // Path traversal validation
      for (const trackId of uniqueTrackIds) {
        const trackPath = trackPathMap[trackId];
        if (trackPath) {
          if (
            !isPathInside(trackPath, libraryDir) &&
            !isPathInside(trackPath, workDir)
          ) {
            preflightErrors.push(
              `PATH_TRAVERSAL: Track ${trackId} path "${trackPath}" is outside allowed directories.`,
            );
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
              `TIMING_OUT_OF_BOUNDS: transition[${i}] fromTrackId=${t.fromTrackId} exitSec=${fromExit} exceeds actual duration=${fromDuration.toFixed(2)}s by more than ${RENDER_CONFIG.TIMING_TOLERANCE}s tolerance`,
            );
          } else if (fromExit > fromDuration) {
            // Small float/metadata rounding — clamp to actual duration
            const clamped = fromDuration;
            console.log(
              `[finalize-medley] Clamped transition[${i}] exitSec from ${fromExit} to actual duration ${clamped.toFixed(3)}s`,
            );
            logToSession(
              sessionId,
              `[finalize-medley] Clamped transition[${i}] exitSec from ${fromExit} to actual duration ${clamped.toFixed(3)}s`,
            );
            t._resolvedFromExitSec = clamped;
            fromExit = clamped;
          }
        }
        if (toDuration !== undefined) {
          if (toEntry < 0) {
            if (Math.abs(toEntry) <= RENDER_CONFIG.TIMING_TOLERANCE) {
              console.log(
                `[finalize-medley] Clamped transition[${i}] entrySec from ${toEntry} to 0`,
              );
              logToSession(
                sessionId,
                `[finalize-medley] Clamped transition[${i}] entrySec from ${toEntry} to 0`,
              );
              t._resolvedToEntrySec = 0;
            } else {
              preflightErrors.push(
                `TIMING_OUT_OF_BOUNDS: transition[${i}] toTrackId=${t.toTrackId} entrySec=${toEntry} is negative beyond tolerance`,
              );
            }
          } else if (toEntry > toDuration + RENDER_CONFIG.TIMING_TOLERANCE) {
            preflightErrors.push(
              `TIMING_OUT_OF_BOUNDS: transition[${i}] toTrackId=${t.toTrackId} entrySec=${toEntry} exceeds actual duration=${toDuration.toFixed(2)}s by more than ${RENDER_CONFIG.TIMING_TOLERANCE}s tolerance`,
            );
          } else if (toEntry > toDuration) {
            const clamped = toDuration;
            console.log(
              `[finalize-medley] Clamped transition[${i}] entrySec from ${toEntry} to actual duration ${clamped.toFixed(3)}s`,
            );
            logToSession(
              sessionId,
              `[finalize-medley] Clamped transition[${i}] entrySec from ${toEntry} to actual duration ${clamped.toFixed(3)}s`,
            );
            t._resolvedToEntrySec = clamped;
          }
        }
      }

      if (preflightErrors.length > 0) {
        throw new Error(
          "PREFLIGHT VALIDATION FAILED — render aborted before FFmpeg execution.\n" +
            preflightErrors.join("\n"),
        );
      }

      if (sessionId) {
        logToSession(
          sessionId,
          `[finalize-medley] Preflight: All ${uniqueTrackIds.size} tracks passed validation. Proceeding to segment derivation...`,
        );
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
      const joinStyles: string[] = [];

      console.log(
        `[finalize-medley] Building pure-clean segments for ${transitions.length} transitions (session ${sessionId})`,
      );
      if (sessionId) {
        logToSession(
          sessionId,
          `[finalize-medley] Progress: Deriving segments and timings...`,
        );
      }

      for (let i = 0; i < transitions.length; i++) {
        const t = transitions[i];

        // Use resolved values (set by normalization step — actual* or planned fallback, clamped if needed).
        const fromExit = Number(t._resolvedFromExitSec);
        const toEntry = Number(t._resolvedToEntrySec);
        const dur = Number(
          t.durationUsed ?? t.duration ?? t.crossfadeDuration ?? 4.0,
        );

        console.log(
          `[finalize-medley]   seg${i}: from=${t.fromTrackId} exit=${fromExit}s → to=${t.toTrackId} entry=${toEntry}s (xfade=${dur}s)`,
        );

        if (i === 0) {
          const fromPath = trackPathMap[t.fromTrackId];
          if (!fromPath || !fs.existsSync(fromPath)) {
            throw new Error(
              `Source audio file MISSING for first track ${t.fromTrackId}: ${fromPath || "(no path in library)"}`,
            );
          }
          segments.push({
            trackId: t.fromTrackId,
            srcPath: fromPath,
            start: 0,
            end: fromExit,
            label: "seg_0",
          });
        }

        const toPath = trackPathMap[t.toTrackId];
        if (!toPath || !fs.existsSync(toPath)) {
          throw new Error(
            `Source audio file MISSING for track ${t.toTrackId}: ${toPath || "(no path in library)"}`,
          );
        }

        const nextT = transitions[i + 1];
        let nextExit: number | null = nextT
          ? Number(nextT._resolvedFromExitSec)
          : null;

        // === ADAPTIVE TAIL: For the LAST segment (no subsequent transition), cap the tail ===
        if (nextExit === null) {
          const toDuration = trackDurationMap[t.toTrackId];
          const tailLimit = Math.max(
            RENDER_CONFIG.MIN_TAIL_SEC,
            Math.min(
              RENDER_CONFIG.MAX_TAIL_SEC,
              RENDER_CONFIG.DEFAULT_TAIL_SEC,
            ),
          );
          if (toDuration !== undefined && toDuration > 0) {
            // Cap at entry + tailLimit, but don't exceed the track's actual duration
            const cappedEnd = Math.min(toDuration, toEntry + tailLimit);
            nextExit = cappedEnd;
            console.log(
              `[finalize-medley] Adaptive tail: last segment ${t.toTrackId} capped at ${cappedEnd.toFixed(2)}s ` +
                `(entry=${toEntry}s + tailLimit=${tailLimit}s, trackDuration=${toDuration.toFixed(2)}s)`,
            );
          } else {
            // No duration info — apply a hard tail cap from entry point
            nextExit = toEntry + tailLimit;
            console.warn(
              `[finalize-medley] Adaptive tail: no duration for ${t.toTrackId}, hard-capping at entry+${tailLimit}s = ${nextExit.toFixed(2)}s`,
            );
          }

          if (sessionId) {
            logToSession(
              sessionId,
              `[finalize-medley] Adaptive tail: final segment capped at ${nextExit.toFixed(2)}s`,
            );
          }
        }

        segments.push({
          trackId: t.toTrackId,
          srcPath: toPath,
          start: toEntry,
          end: nextExit,
          label: `seg_${segments.length}`,
        });

        xfadeDurations.push(dur);
        joinStyles.push(t.style || "smooth_blend");
      }

      console.log(
        `[finalize-medley] Derived ${segments.length} segments with validated timings.`,
      );
      const mashupCount = joinStyles.filter((s) => s === "mashup_layer").length;
      if (mashupCount > 0) {
        throw new Error(
          "mashup_layer is disabled until canonical timeline parity is implemented",
        );
      }

      const numSegments = segments.length;
      if (numSegments < 2) {
        throw new Error(
          "MVP requires at least two segments to form a crossfade chain",
        );
      }

      // === 2. Hard validation (fail fast, structured, no silent recovery) ===
      for (let i = 0; i < numSegments; i++) {
        const s = segments[i];
        if (s.end !== null && s.start >= s.end) {
          throw new Error(
            `INVALID TRIM on ${s.label} (track ${s.trackId}): start=${s.start} >= end=${s.end}`,
          );
        }
        if (s.start < 0) {
          throw new Error(
            `INVALID TRIM on ${s.label}: negative start time ${s.start}`,
          );
        }
      }
      for (let i = 0; i < xfadeDurations.length; i++) {
        const d = xfadeDurations[i];
        if (!(d > 0 && d <= 30)) {
          throw new Error(
            `INVALID ACROSSFADE duration ${d}s at join ${i} (must be 0 < d <= 30)`,
          );
        }
        const prevAvail = (segments[i].end ?? 999999) - segments[i].start;
        const nextAvail =
          (segments[i + 1].end ?? 999999) - segments[i + 1].start;
        if (d > prevAvail || d > nextAvail) {
          throw new Error(
            `ACROSSFADE d=${d}s EXCEEDS available audio at join ${i}: prevSeg=${prevAvail.toFixed(2)}s, nextSeg=${nextAvail.toFixed(2)}s`,
          );
        }
      }

      // === 3. Build deterministic filter graph (linear chain only) ===
      const filterLines: string[] = [];
      const inputArgs: string[] = ["-y"];

      // One -i per segment (deterministic ordering, simple labels, original sources only)
      segments.forEach((seg) => {
        inputArgs.push("-i", seg.srcPath);
      });

      // Per-input: mandatory normalization chain + atrim (exactly as specified)
      // For the LAST segment, inject afade fade-out for clean ending
      segments.forEach((seg, idx) => {
        const normChain =
          "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,aresample=async=0,asetpts=PTS-STARTPTS";
        let atrim = `atrim=start=${seg.start}`;
        if (seg.end !== null && seg.end !== undefined) {
          atrim += `:end=${seg.end}`;
        }

        // Inject afade on the last segment for clean ending
        let fadeFilter = "";
        if (
          idx === segments.length - 1 &&
          seg.end !== null &&
          seg.end !== undefined
        ) {
          const segDuration = seg.end - seg.start;
          const fadeDur = Math.min(
            RENDER_CONFIG.FADE_OUT_SECONDS,
            segDuration * 0.5,
          );
          const fadeStart = Math.max(0, segDuration - fadeDur);
          fadeFilter = `,afade=t=out:st=${fadeStart.toFixed(3)}:d=${fadeDur.toFixed(3)}`;
        }

        filterLines.push(
          `[${idx}:a]${normChain},${atrim}${fadeFilter}[${seg.label}]`,
        );
      });

      // Compile the same canonical sequential join graph used by transition previews.
      let currentLabel = "seg_0";
      for (let i = 0; i < xfadeDurations.length; i++) {
        const d = xfadeDurations[i];
        const nextLabel = `seg_${i + 1}`;
        const style = joinStyles[i] || "smooth_blend";
        const xfadeLabel = `xfade_${i}`;
        filterLines.push(
          buildCanonicalAcrossfade({
            leftLabel: currentLabel,
            rightLabel: nextLabel,
            outputLabel: xfadeLabel,
            duration: d,
            style,
          }),
        );
        currentLabel = xfadeLabel;
      }

      // SINGLE final master processing (loudnorm + limiter) applied exactly once to the end of the chain
      filterLines.push(
        `[${currentLabel}]loudnorm=I=-14:TP=-1.5,alimiter=limit=0.891:level=off[master_out]`,
      );

      const fullGraph = filterLines.join(";\n");

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
        logToSession(
          sessionId,
          `[finalize-medley] Progress: Filter graph constructed (${filterLines.length} lines). Expected duration: ${expectedDuration.toFixed(1)}s. Starting FFmpeg...`,
        );
      }

      // === 4. Command using -filter_complex_script (MANDATORY) ===
      const finalArgs = [
        ...inputArgs,
        "-filter_complex_script",
        graphName,
        "-map",
        "[master_out]",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "320k",
        "-f",
        "mp3",
        safeMp3Name, // write inside sessionWorkDir (cwd for the run); safeMp3Name is already the basename
      ];

      // === 5. Execute with full artifact logging + hard failure + progress tracking ===
      // Compute watchdog timeout: 8x expected duration or minimum 5 minutes
      const watchdogTimeout = Math.max(
        300000,
        Math.round(expectedDuration * 8000),
      );
      const renderStartTime = Date.now();

      const renderArtifacts = await runFfmpegWithStrictLogging(
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
        artifactPrefix,
      ).catch((ffErr: any) => {
        delete activeRenderProcesses[sessionId];
        // Hard fail — caller sees the three log files + clear cause
        throw new Error(
          `FFmpeg render failed: ${ffErr.message}. Inspect temp_filtergraph.txt, ffmpeg_command.txt, and ffmpeg_stderr.log in the session folder.`,
        );
      });

      delete activeRenderProcesses[sessionId];
      const renderElapsed = (Date.now() - renderStartTime) / 1000;

      if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size <= 0) {
        throw new Error("Candidate render produced no usable audio file");
      }
      const durationSec = await queryTrackDuration(outputPath);
      if (!(durationSec > 0))
        throw new Error("Candidate duration validation failed");
      const quality = await analyzeMedleyQuality(outputPath, sessionWorkDir);
      const requestedTargetDuration = Number(
        sessions[sessionId]?.projectBrief?.targetDurationSec,
      );
      const qualityGate = evaluateCandidateQuality({
        actualDurationSec: durationSec,
        expectedDurationSec: expectedDuration,
        targetDurationSec:
          Number.isFinite(requestedTargetDuration) && requestedTargetDuration > 0
            ? requestedTargetDuration
            : null,
        quality,
      });
      fs.renameSync(outputPath, immutableOutputPath);
      const sizeBytes = fs.statSync(immutableOutputPath).size;
      const sha256 = sha256File(immutableOutputPath);
      const previewPaths = transitions
        .map((item: any) => item.outputPath)
        .map((item: unknown) => getServerGeneratedPreviewPath(sessionId, item))
        .filter((item: string | null): item is string => item !== null);
      const candidate = {
        candidateId,
        candidateVersion,
        parentCandidateId,
        arrangementVersion,
        executionVersion,
        resolvedTransitions: automaticSession
          ? sanitizeResolvedTransitionsForManifest(transitions)
          : undefined,
        outputPath: immutableOutputPath,
        debugPaths: [
          renderArtifacts.graphFile,
          renderArtifacts.commandLog,
          renderArtifacts.stderrLog,
          validationPath,
        ],
        previewPaths,
        sizeBytes,
        sha256,
        durationSec,
        technicallyValid: qualityGate.technicallyValid,
        metrics: {},
        reviewStatus: "pending" as const,
        warnings: [
          quality.overallQualityNote,
          ...qualityGate.warnings,
          ...qualityGate.blockingIssues,
        ],
        createdAt: new Date().toISOString(),
      };
      fs.writeFileSync(
        validationPath,
        JSON.stringify({ candidate, quality, qualityGate }, null, 2),
        "utf8",
      );
      registerCandidate(
        workDir,
        sessionId,
        candidate,
        automaticSession ? "automatic" : "legacy",
      );
      const updatedManifest = appendCandidateTechnicalEvaluation(
        workDir,
        sessionId,
        {
          candidateId,
          candidateVersion,
          technicallyValid: qualityGate.technicallyValid,
          blockingIssues: qualityGate.blockingIssues,
          warnings: qualityGate.warnings,
          policyVersion: 1,
          evaluatedAt: new Date().toISOString(),
        },
      );
      const technicalState = !legacy
        ? readAutomaticSessionState(workDir, sessionId)
        : null;
      if (technicalState?.state === "rendering_candidate") {
        transitionAutomaticSessionState({ workDir, sessionId, to: "technical_review" });
      }
      sessions[sessionId].workflowStage = "quality_review";
      sessions[sessionId].currentCandidate = candidate;

      console.log(
        `[candidate-render] SUCCESS. Output: ${immutableOutputPath} (render took ${renderElapsed.toFixed(1)}s)`,
      );

      // === Wisdom logging: Record successful render metrics ===
      try {
        appendWisdom({
          type: "candidate_render_success",
          sessionId,
          renderDurationSec: Math.round(renderElapsed),
          expectedMedleyDurationSec: Math.round(expectedDuration),
          segmentCount: numSegments,
          crossfadeCount: xfadeDurations.length,
          mashupBranches: mashupCount,
          styleMix: joinStyles.reduce((acc: Record<string, number>, s) => {
            acc[s] = (acc[s] || 0) + 1;
            return acc;
          }, {}),
          outputFile: path.basename(immutableOutputPath),
        });
      } catch (e) {
        console.warn("[finalize-medley] Could not log wisdom:", e);
      }

      if (sessionId) {
        logToSession(
          sessionId,
          `[candidate-render] Review candidate ${candidateId} complete in ${renderElapsed.toFixed(1)}s.`,
        );
        broadcastToSession(sessionId, "progress", {
          stage: "quality_review",
          percent: 100,
        });
      }

      const responsePayload = {
        success: true,
        candidate,
        manifest: updatedManifest,
        quality,
        resolvedTransitions: automaticSession ? transitions : undefined,
        outputPath: immutableOutputPath,
        renderPath: "pure-clean-mvp-single-pass", // unambiguous marker
        mashupBranches: mashupCount,
        renderDurationSec: Math.round(renderElapsed),
        expectedMedleyDurationSec: Math.round(expectedDuration),
        message:
          "Review candidate rendered through the deterministic pure-clean single-pass path.",
        usedPureCleanMVP: true,
        graphFile: renderArtifacts.graphFile,
        commandLog: renderArtifacts.commandLog,
        stderrLog: renderArtifacts.stderrLog,
        segments: numSegments,
        crossfades: xfadeDurations.length,
      };
      if (idempotencyKey && readAutomaticSessionState(workDir, sessionId)) {
        const replay = await replayAutomaticSessionIdempotent({
          workDir,
          sessionId,
          operation: "candidate_rendering",
          key: idempotencyKey,
          request: idempotencyRequest,
          execute: async () => responsePayload,
        });
        return res.json({ ...replay.result, idempotent: replay.replayed });
      }
      return res.json(responsePayload);
    } catch (err: any) {
      fs.rmSync(outputPath, { force: true });
      const registrationPending =
        fs.existsSync(immutableOutputPath) && fs.existsSync(validationPath);
      const requiresManualReview =
        /Candidate limit reached|INSUFFICIENT_STORAGE|SESSION_ARTIFACT_LIMIT/.test(String(err?.message || ""));
      const failedRenderState = !legacy
        ? readAutomaticSessionState(workDir, sessionId)
        : null;
      if (!registrationPending && failedRenderState?.state === "rendering_candidate") {
        transitionAutomaticSessionState({
          workDir,
          sessionId,
          to: "recoverable_error",
          recoverableError: String(err?.message || "Candidate rendering failed").slice(0, 2_000),
        });
      }
      if (requiresManualReview && sessions[sessionId]) {
        sessions[sessionId].workflowStage = "manual_review_required";
        sessions[sessionId].manualReviewReason = String(err.message);
        broadcastToSession(sessionId, "manual_review_required", {
          sessionId,
          reason: String(err.message),
        });
      }
      console.error(
        "[candidate-render] HARD FAIL (no fallback, no silent concat):",
        err.message,
      );

      // Always attempt to leave a structured error artifact for the user/agent
      try {
        const errJsonPath = path.join(
          sessionWorkDir,
          `${artifactPrefix}-error.json`,
        );
        fs.writeFileSync(
          errJsonPath,
          JSON.stringify(
            {
              timestamp: new Date().toISOString(),
              sessionId,
              error: err.message,
              stack: err.stack,
              note: "This was a hard failure while rendering a review candidate. Existing valid candidates were preserved.",
            },
            null,
            2,
          ),
          "utf8",
        );
      } catch (logErr) {
        console.error(
          "[finalize-medley] Could not write finalize_error.json:",
          logErr,
        );
      }

      res.status(requiresManualReview ? 409 : 500).json({
        success: false,
        error: err.message || "Failed to render review candidate",
        manualReviewRequired: requiresManualReview,
        renderSucceeded: registrationPending,
        registrationPending,
        noFallback: true,
        renderPath: "pure-clean-mvp-failed",
        note: registrationPending
          ? "The rendered candidate was preserved and can be recovered by retrying this same registration request."
          : "No new candidate MP3 was completed by this request.",
        logFiles: {
          error: path.join(sessionWorkDir, `${artifactPrefix}-error.json`),
          graph: path.join(sessionWorkDir, `${artifactPrefix}-filtergraph.txt`),
          command: path.join(sessionWorkDir, `${artifactPrefix}-command.txt`),
          stderr: path.join(sessionWorkDir, `${artifactPrefix}-stderr.log`),
        },
        details: process.env.NODE_ENV === "development" ? err.stack : undefined,
      });
    }
  });
});

function finalizeRegisteredCandidate(
  sessionId: string,
  candidateId: string,
  summary: string,
) {
  const manifest = readCandidateManifest(workDir, sessionId);
  const requireApproval = requiresAutomaticCandidateApproval({
    sessionId,
    manifest,
    session: sessions[sessionId],
    checkpointDir,
  });
  const session = sessions[sessionId] ?? { status: "running", logs: [] };
  const transaction = executeFinalizationTransaction({
    workDir,
    sessionId,
    candidateId,
    summary,
    promote: () => {
      const promoted = promoteCandidate(workDir, sessionId, candidateId, {
        requireApproved: requireApproval,
        requireSelected: requireApproval,
      });
      const candidate = promoted.manifest.candidates.find(
        (item) => item.candidateId === candidateId,
      )!;
      return {
        finalPath: promoted.finalPath,
        manifestVersion: promoted.manifest.schemaVersion,
        sha256: candidate.sha256,
      };
    },
    readHistory: getHistory,
    writeHistory: saveHistory,
    readWisdom: getWisdom,
    writeWisdom: saveWisdom,
    createHistoryEntry: (finalAudioPath) => ({
      id: sessionId,
      completedAt: new Date().toISOString(),
      summary,
      finalAudioPath,
      metrics: session.metrics,
      designPlan: session.designPlan || null,
      candidateId,
      candidateManifestVersion: manifest.schemaVersion,
    }),
    createWisdomEntry: (finalAudioPath) => ({
      type: "completed_medley",
      sessionId,
      summary,
      metrics: session.metrics || null,
      designPlan: session.designPlan || null,
      finalAudioPath,
      candidateId,
      tracksInvolved: collectTransitionTrackIds(
        session.designPlan?.transitions,
      ),
    }),
    deleteCheckpoint: () =>
      fs.rmSync(path.join(checkpointDir, `${sessionId}.json`), { force: true }),
  });
  sessions[sessionId] = session;
  session.status = "completed";
  session.finalAudioPath = transaction.finalPath;
  session.summary = summary;
  session.workflowStage = "completed";
  return transaction;
}

app.post("/api/finalize-medley", async (req, res) => {
  const { sessionId, candidateId, summary } = req.body || {};
  const idempotencyKey = req.get("Idempotency-Key") || req.body?.idempotencyKey;
  if (!sessionId || !candidateId || typeof summary !== "string") {
    return res.status(400).json({
      success: false,
      error: "sessionId, candidateId, and summary are required",
    });
  }
  try {
    validateSessionId(sessionId);
    const performFinalization = async () => {
      const transaction = finalizeRegisteredCandidate(
        sessionId,
        candidateId,
        summary,
      );
      const finalizingState = readAutomaticSessionState(workDir, sessionId);
      if (finalizingState?.state === "finalizing") {
        transitionAutomaticSessionState({
          workDir,
          sessionId,
          to: "completed",
        });
      }
      broadcastToSession(sessionId, "completed", { summary });
      return {
        success: true,
        outputPath: transaction.finalPath,
        candidateId,
        sha256: transaction.journal.sha256,
        idempotent: transaction.idempotent,
        cleanupWarning: null,
      };
    };
    const execute = () => withSessionLock(sessionId, performFinalization);
    const automaticState = readAutomaticSessionState(workDir, sessionId);
    const replay = idempotencyKey && automaticState
      ? await replayAutomaticSessionIdempotent({
          workDir,
          sessionId,
          operation: "finalization",
          key: idempotencyKey,
          request: { candidateId, summary },
          execute: performFinalization,
        })
      : idempotencyKey
        ? await replayIdempotent({
            sessionId,
            operation: "finalization",
            key: idempotencyKey,
            request: { candidateId, summary },
            execute,
          })
        : { replayed: false, result: await execute() };
    return res.json({ ...replay.result, idempotent: replay.replayed || replay.result.idempotent });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

app.delete("/api/session/:sessionId/discard", async (req, res) => {
  const sessionId = req.params.sessionId;
  try {
    validateSessionId(sessionId);
    return await withSessionLock(sessionId, async () => {
      const proc = activeRenderProcesses[sessionId];
      if (proc && !proc.killed) proc.kill("SIGKILL");
      delete activeRenderProcesses[sessionId];
      const completedEntry = getHistory().find(
        (entry: any) => entry.id === sessionId,
      );
      if (!completedEntry) {
        const registeredPreviews = new Set<string>(
          (sessions[sessionId]?.registeredFiles || [])
            .map((item: unknown) =>
              getServerGeneratedPreviewPath(sessionId, item),
            )
            .filter((item: string | null): item is string => item !== null),
        );
        const checkpointPath = path.join(checkpointDir, `${sessionId}.json`);
        if (fs.existsSync(checkpointPath)) {
          try {
            const checkpoint = JSON.parse(
              fs.readFileSync(checkpointPath, "utf8"),
            );
            for (const attempt of checkpoint.executionReport
              ?.attemptedTransitions || []) {
              const preview = getServerGeneratedPreviewPath(
                sessionId,
                attempt.previewPath,
              );
              if (preview) registeredPreviews.add(preview);
            }
          } catch {
            // A corrupt checkpoint must not broaden the set of files eligible for deletion.
          }
        }
        try {
          discardAutomaticSessionFiles(workDir, sessionId, [
            ...registeredPreviews,
          ]);
        } catch (error: any) {
          if (!String(error.message).includes("manifest")) throw error;
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
app.get("/api/history", (req, res) => {
  res.json(getHistory());
});

app.delete("/api/history/:id", (req, res) => {
  const history = getHistory();
  const filtered = history.filter((h: any) => h.id !== req.params.id);
  saveHistory(filtered);
  res.json({ success: true });
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.get("/api/storage/inventory", (_req, res) => {
  const references: ArtifactReference[] = [];
  for (const entry of getLibrary()) {
    if (entry?.path)
      references.push({ filePath: entry.path, reason: "source" });
  }
  for (const entry of getHistory()) {
    if (entry?.finalAudioPath)
      references.push({
        filePath: entry.finalAudioPath,
        reason: "completed-output",
      });
  }
  if (fs.existsSync(checkpointDir)) {
    for (const name of fs.readdirSync(checkpointDir)) {
      references.push({
        filePath: path.join(checkpointDir, name),
        reason: "checkpoint",
      });
    }
  }
  if (fs.existsSync(workDir)) {
    for (const name of fs.readdirSync(workDir, { withFileTypes: true })) {
      if (!name.isDirectory()) continue;
      const manifestPath = path.join(workDir, name.name, "candidate-manifest.json");
      if (!fs.existsSync(manifestPath)) continue;
      references.push({ filePath: manifestPath, reason: "manifest" });
      try {
        const manifest = readCandidateManifest(workDir, name.name);
        for (const candidate of manifest.candidates) {
          references.push({ filePath: candidate.outputPath, reason: "candidate" });
          for (const candidatePath of [
            ...candidate.previewPaths,
            ...candidate.debugPaths,
          ]) {
            references.push({ filePath: candidatePath, reason: "candidate" });
          }
        }
        if (manifest.finalOutputPath)
          references.push({
            filePath: manifest.finalOutputPath,
            reason: "completed-output",
          });
      } catch {
        // Corrupt/unknown manifests remain unclassified and therefore preserved.
      }
    }
  }
  const items = buildArtifactInventory({
    roots: [workDir, audioDir, checkpointDir],
    references,
    activeSessionIds: Object.entries(sessions)
      .filter(([, session]) => session.status === "running")
      .map(([sessionId]) => sessionId),
  });
  res.json({
    ...summarizeArtifactInventory(items),
    items,
    note: "Inventory only. No artifact is selected for deletion or quarantine.",
  });
});

app.post("/api/exec", (req, res) => {
  const { command, sessionId, capabilityMode = "contained" } = req.body;
  if (!command) return res.status(400).json({ error: "Command is required" });
  try {
    validateSessionId(sessionId);
    if (capabilityMode !== "expert") assertContainedDiagnosticCommand(command);
    if (capabilityMode !== "contained" && capabilityMode !== "expert")
      throw new Error("Unknown manual capability mode");
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
  const sessionDir = getSessionDirectory(workDir, sessionId);
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

  const session = sessionId ? sessions[sessionId] : null;
  const designPlan = session?.designPlan;

  // Lightweight plan awareness (personal project style — advisory, not hard blocking)
  let planNote = "";
  if (
    designPlan &&
    designPlan.transitions &&
    Array.isArray(designPlan.transitions)
  ) {
    // Very simple heuristic: look for -ss and -t / -to in the command
    const ssMatch = command.match(/-ss\s+([\d.]+)/);
    const tMatch =
      command.match(/-t\s+([\d.]+)/) || command.match(/-to\s+([\d.]+)/);

    if (ssMatch) {
      const ss = parseFloat(ssMatch[1]);
      // Find if this looks like it's cutting one of the planned transitions
      const relevant = designPlan.transitions.find(
        (t: any) =>
          Math.abs((t.fromExitSec || 0) - ss) < 3 ||
          Math.abs((t.toEntrySec || 0) - ss) < 3,
      );
      if (relevant) {
        planNote = ` [Plan reference: ${relevant.fromSectionId || ""} → ${relevant.toSectionId || ""}]`;
      }
    }
  }

  // Replace ffmpeg references with the bundled binary path
  const sanitizedCmd = command.replace(/\bffmpeg\b/g, `"${ffmpegPath}"`);

  exec(
    sanitizedCmd,
    { cwd: sessionDir, timeout: 120000, maxBuffer: 10 * 1024 * 1024 },
    (err, stdout, stderr) => {
      const exitCode = err?.code ?? (err ? 1 : 0);
      const success = !err;

      const structuredResponse = {
        success,
        command: command,
        exitCode,
        stdout: stdout || "",
        stderr: stderr || "",
        error: err ? err.message || String(err) : null,
        planNote: planNote ? planNote.trim() : undefined,
        // Helpful for debugging weak models
        wasSuccessful: success,
        hasOutput: !!(stdout || stderr),
      };

      if (sessionId && sessions[sessionId]) {
        const shortLog = `CMD: ${command.substring(0, 70)}... ${success ? "OK" : "FAILED"}${planNote}`;
        logToSession(sessionId, shortLog);
      }

      // Always return rich structured data so the agent (and logs) can see exactly what happened
      res.json(structuredResponse);
    },
  );
});

app.get("/api/file-read", (req, res) => {
  const { filePath, sessionId } = req.query;
  if (!filePath || !sessionId)
    return res.status(400).json({ error: "filePath and sessionId are required" });
  try {
    const resolved = resolveSessionFileForRead({
      workRoot: workDir,
      sessionId: String(sessionId),
      filePath: String(filePath),
    });
    const content = fs.readFileSync(resolved, "utf-8");
    res.json({ content });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/file-write", (req, res) => {
  const { filePath, content, sessionId } = req.body;
  if (!filePath || content === undefined || !sessionId)
    return res.status(400).json({ error: "filePath, content, and sessionId are required" });
  try {
    if (Buffer.byteLength(String(content), "utf8") > MAX_MANUAL_TEXT_FILE_BYTES)
      throw new Error("Content exceeds the manual write limit");
    const resolved = resolveSessionFileForWrite({
      workRoot: workDir,
      sessionId: String(sessionId),
      filePath: String(filePath),
    });
    fs.writeFileSync(resolved, String(content), "utf-8");
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/library/analysis", (req, res) => {
  const { fileId, analysisText, sessionId } = req.body;
  if (!fileId || !analysisText)
    return res
      .status(400)
      .json({ error: "fileId and analysisText are required" });

  const library = getLibrary();
  const index = library.findIndex((f: any) => f.id === fileId);
  if (index !== -1) {
    library[index].analysis = analysisText;
    // Also keep a history of text analyses for this track (permanent)
    if (!library[index].analysisHistory) library[index].analysisHistory = [];
    library[index].analysisHistory.push({
      text: analysisText,
      at: new Date().toISOString(),
      sessionId: sessionId || null,
    });
    saveLibrary(library);

    // Contribute to cross-session wisdom if we have context
    if (sessionId && sessions[sessionId]?.designPlan) {
      appendWisdom({
        type: "file_analysis",
        fileId,
        analysisText: analysisText.substring(0, 800), // keep it reasonable size
        sessionId,
        designPlan: sessions[sessionId].designPlan,
      });
    }

    res.json({ success: true });
  } else {
    res.status(404).json({ error: "File not found" });
  }
});

app.post("/api/library/cache", (req, res) => {
  const { fileId, geminiFileUri, geminiFileExpires } = req.body;
  if (!fileId || !geminiFileUri || !geminiFileExpires)
    return res.status(400).json({ error: "Missing fields" });

  if (updateLibraryEntry(fileId, { geminiFileUri, geminiFileExpires })) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "File not found" });
  }
});

// Explicitly handle 404 for any other /api routes to avoid returning HTML
// This MUST be the last API route defined
app.all("/api/*", (req, res) => {
  res
    .status(404)
    .json({ error: `API route ${req.method} ${req.path} not found` });
});

for (const record of reconcileStartupState({ workDir, history: getHistory() })) {
  console.warn(`[startup-reconcile] ${record.sessionId}: ${record.status} — ${record.detail}`);
}

async function startServer() {
  const httpServer = http.createServer(app);
  // Vite integration
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: { server: httpServer } },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(process.cwd(), "dist", "index.html"));
    });
  }

  httpServer.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
  });
}

startServer();
