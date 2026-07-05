import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export class JsonStoreReadError extends Error {
  readonly filePath: string;

  constructor(filePath: string, message: string, cause?: unknown) {
    super(`${message}: ${filePath}`, { cause });
    this.name = "JsonStoreReadError";
    this.filePath = filePath;
  }
}

function syncDirectoryBestEffort(directory: string) {
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(directory, "r");
    fs.fsyncSync(descriptor);
  } catch (error: any) {
    if (!["EISDIR", "EPERM", "EINVAL", "EBADF"].includes(error?.code)) {
      throw error;
    }
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

function writeBytesAtomic(filePath: string, bytes: Buffer | string) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `${path.basename(filePath)}.tmp-${process.pid}-${randomUUID()}`,
  );
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(temporaryPath, "wx");
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporaryPath, filePath);
    syncDirectoryBestEffort(directory);
  } catch (error) {
    if (descriptor !== null) fs.closeSync(descriptor);
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

export function ensureJsonArrayFile(filePath: string) {
  if (fs.existsSync(filePath)) {
    readJsonArrayFile(filePath);
    return;
  }
  writeBytesAtomic(filePath, "[]\n");
}

export function readJsonArrayFile<T = unknown>(filePath: string): T[] {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw new JsonStoreReadError(filePath, "Failed to read JSON store", error);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new JsonStoreReadError(filePath, "Failed to parse JSON store", error);
  }
  if (!Array.isArray(parsed)) {
    throw new JsonStoreReadError(filePath, "JSON store must contain an array");
  }
  return parsed as T[];
}

export function writeJsonArrayFileAtomic<T>(filePath: string, data: T[]) {
  if (!Array.isArray(data)) {
    throw new TypeError("JSON array store writes require an array");
  }

  if (fs.existsSync(filePath)) {
    readJsonArrayFile(filePath);
    const currentBytes = fs.readFileSync(filePath);
    writeBytesAtomic(`${filePath}.bak`, currentBytes);
  }

  writeBytesAtomic(filePath, `${JSON.stringify(data, null, 2)}\n`);
}
