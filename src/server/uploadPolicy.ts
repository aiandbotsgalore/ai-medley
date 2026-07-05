import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { MAX_ANALYSIS_DURATION_SEC } from "./resourcePolicy";

export const MAX_UPLOAD_FILE_BYTES = 500 * 1024 * 1024;
export const MAX_UPLOAD_FILES = 50;
export const MIN_UPLOAD_FREE_SPACE_BYTES = 1024 * 1024 * 1024;
export const SUPPORTED_AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".wav",
  ".flac",
  ".m4a",
  ".aac",
  ".ogg",
]);

export type AudioProbeSummary = {
  durationSec: number;
  audioStreams: number;
  channels: number;
};

export function validateUploadMetadata(file: {
  originalname: string;
  size: number;
}) {
  const extension = path.extname(file.originalname).toLowerCase();
  if (!SUPPORTED_AUDIO_EXTENSIONS.has(extension))
    throw new Error(`Unsupported audio extension: ${extension || "none"}`);
  if (!Number.isFinite(file.size) || file.size <= 0)
    throw new Error("Audio upload must not be empty");
  if (file.size > MAX_UPLOAD_FILE_BYTES)
    throw new Error("Audio upload exceeds the per-file size limit");
}

export function validateAudioProbe(probe: AudioProbeSummary) {
  if (!Number.isFinite(probe.durationSec) || probe.durationSec <= 0)
    throw new Error("Uploaded content has no positive audio duration");
  if (probe.durationSec > MAX_ANALYSIS_DURATION_SEC)
    throw new Error("Uploaded audio exceeds the supported analysis duration limit");
  if (!Number.isInteger(probe.audioStreams) || probe.audioStreams < 1)
    throw new Error("Uploaded content has no audio stream");
  if (!Number.isInteger(probe.channels) || probe.channels < 1 || probe.channels > 8)
    throw new Error("Uploaded audio has an unsupported channel count");
}

export function sha256File(filePath: string) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function assertUploadCapacity(input: {
  availableBytes: number;
  incomingBytes: number;
}) {
  if (
    !Number.isFinite(input.availableBytes) ||
    input.availableBytes - input.incomingBytes < MIN_UPLOAD_FREE_SPACE_BYTES
  ) {
    throw new Error("Insufficient free-space reserve for this upload");
  }
}

export function findDuplicateUpload(
  sha256: string,
  records: Array<{ sha256?: string }>,
) {
  return records.find((record) => record.sha256 === sha256) ?? null;
}
