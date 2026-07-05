import crypto from "node:crypto";
import fs from "node:fs";

export const LOCAL_ANALYSIS_SCHEMA_VERSION = "local_audio_analysis_v2";
export const LOCAL_ANALYZER_VERSION = "local-analysis-v2.1.0";
export const LOCAL_ANALYSIS_HASH_ALGORITHM = "sha256";

export function hashAnalysisSource(filePath: string) {
  const hash = crypto.createHash(LOCAL_ANALYSIS_HASH_ALGORITHM);
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    let bytes = 0;
    while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytes));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

export function buildLocalAnalysisCacheKey(fileHash: string) {
  return `${LOCAL_ANALYSIS_SCHEMA_VERSION}|${LOCAL_ANALYZER_VERSION}|${fileHash}`;
}

function allNumbersFinite(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(allNumbersFinite);
  if (value && typeof value === "object") {
    return Object.values(value).every(allNumbersFinite);
  }
  return true;
}

export function getLocalAnalysisValidationErrors(
  analysis: any,
  expectedFileHash?: string,
) {
  const errors: string[] = [];
  const v2 = analysis?.localAnalysisV2;
  if (!analysis || typeof analysis !== "object") {
    return ["analysis is not an object"];
  }
  if (v2?.schemaVersion !== LOCAL_ANALYSIS_SCHEMA_VERSION) {
    errors.push("analysis schema version is not current");
  }
  if (v2?.baseAnalyzerVersion !== LOCAL_ANALYZER_VERSION) {
    errors.push("analysis analyzer version is not current");
  }
  if (v2?.fileHashAlgorithm !== LOCAL_ANALYSIS_HASH_ALGORITHM) {
    errors.push("analysis source hash algorithm is not current");
  }
  if (expectedFileHash && v2?.fileHash !== expectedFileHash) {
    errors.push("analysis source hash does not match current bytes");
  }
  if (v2?.cacheKey !== buildLocalAnalysisCacheKey(v2?.fileHash || "")) {
    errors.push("analysis cache key does not match its provenance");
  }
  if (!Number.isFinite(analysis.duration) || analysis.duration <= 0) {
    errors.push("analysis duration is not finite and positive");
  }
  if (!Number.isFinite(analysis.sampleRate) || analysis.sampleRate <= 0) {
    errors.push("analysis sample rate is not finite and positive");
  }
  if (!v2?.advancedAnalysisAvailable || v2?.fallbackUsed) {
    errors.push("analysis has no usable decoded PCM facts");
  }
  if (!Array.isArray(v2?.segments) || v2.segments.length === 0) {
    errors.push("analysis has no usable sections");
  } else if (
    v2.segments.some(
      (segment: any) =>
        !Number.isFinite(segment?.startSec) ||
        !Number.isFinite(segment?.endSec) ||
        segment.startSec < 0 ||
        segment.endSec <= segment.startSec ||
        segment.endSec > analysis.duration + 0.01,
    )
  ) {
    errors.push("analysis contains an invalid section interval");
  }
  if (!allNumbersFinite(analysis)) {
    errors.push("analysis contains NaN or Infinity");
  }
  return errors;
}

export function assertValidLocalAnalysis(
  analysis: unknown,
  expectedFileHash?: string,
) {
  const errors = getLocalAnalysisValidationErrors(analysis, expectedFileHash);
  if (errors.length) {
    throw new Error(`Invalid local analysis: ${errors.join("; ")}`);
  }
}

export function isReusableLocalAnalysis(
  analysis: unknown,
  expectedFileHash: string,
) {
  return getLocalAnalysisValidationErrors(analysis, expectedFileHash).length === 0;
}
