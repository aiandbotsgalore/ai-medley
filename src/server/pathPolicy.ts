import fs from "node:fs";
import path from "node:path";
import { validateSessionId } from "./candidateStore";

export const MAX_MANUAL_TEXT_FILE_BYTES = 1 * 1024 * 1024;

function normalized(value: string) {
  return path.resolve(value).toLowerCase();
}

export function isPathWithin(childPath: string, parentPath: string) {
  const child = normalized(childPath);
  const parent = normalized(parentPath);
  return child === parent || child.startsWith(parent + path.sep);
}

function assertNoReparseSegments(root: string, target: string, includeLeaf: boolean) {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("Path is outside the authorized root");
  const parts = relative.split(path.sep).filter(Boolean);
  const count = includeLeaf ? parts.length : Math.max(0, parts.length - 1);
  let current = root;
  for (let index = 0; index < count; index++) {
    current = path.join(current, parts[index]);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink())
      throw new Error("Symbolic links and junctions are not authorized");
  }
}

export function resolveContainedExistingFile(
  candidatePath: string,
  allowedRoots: string[],
) {
  if (!candidatePath || !allowedRoots.length) return null;
  const candidate = path.resolve(candidatePath);
  for (const rootValue of allowedRoots) {
    if (!fs.existsSync(rootValue) || !isPathWithin(candidate, rootValue)) continue;
    const root = fs.realpathSync(rootValue);
    try {
      assertNoReparseSegments(path.resolve(rootValue), candidate, true);
      if (!fs.existsSync(candidate)) continue;
      const realCandidate = fs.realpathSync(candidate);
      if (!isPathWithin(realCandidate, root)) continue;
      const stat = fs.statSync(realCandidate);
      if (!stat.isFile()) continue;
      return realCandidate;
    } catch {
      continue;
    }
  }
  return null;
}

export function resolveSessionFileForRead(input: {
  workRoot: string;
  sessionId: string;
  filePath: string;
}) {
  validateSessionId(input.sessionId);
  const sessionRoot = path.join(input.workRoot, input.sessionId);
  const candidate = path.isAbsolute(input.filePath)
    ? input.filePath
    : path.join(sessionRoot, input.filePath);
  const resolved = resolveContainedExistingFile(candidate, [sessionRoot]);
  if (!resolved) throw new Error("File is outside the authorized session or unavailable");
  const stat = fs.statSync(resolved);
  if (stat.size > MAX_MANUAL_TEXT_FILE_BYTES)
    throw new Error("File exceeds the manual read limit");
  return resolved;
}

export function resolveSessionFileForWrite(input: {
  workRoot: string;
  sessionId: string;
  filePath: string;
}) {
  validateSessionId(input.sessionId);
  const sessionRoot = path.join(input.workRoot, input.sessionId);
  if (!fs.existsSync(sessionRoot)) fs.mkdirSync(sessionRoot, { recursive: true });
  const candidate = path.resolve(
    path.isAbsolute(input.filePath)
      ? input.filePath
      : path.join(sessionRoot, input.filePath),
  );
  if (!isPathWithin(candidate, sessionRoot))
    throw new Error("File is outside the authorized session");
  const parent = path.dirname(candidate);
  if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
  assertNoReparseSegments(path.resolve(sessionRoot), candidate, false);
  const realRoot = fs.realpathSync(sessionRoot);
  const realParent = fs.realpathSync(parent);
  if (!isPathWithin(realParent, realRoot))
    throw new Error("File parent escapes the authorized session");
  if (fs.existsSync(candidate)) {
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink() || !stat.isFile())
      throw new Error("Write target must be a regular non-link file");
  }
  return candidate;
}

export function assertContainedDiagnosticCommand(command: string) {
  const trimmed = command.trim();
  if (!trimmed || trimmed.length > 4_000)
    throw new Error("Command is empty or exceeds the command limit");
  if (/[;&|><`$()]/.test(trimmed))
    throw new Error("Shell operators require explicit expert capability mode");
  const executable = trimmed.split(/\s+/)[0].toLowerCase();
  if (!new Set(["dir", "ls", "pwd", "get-location", "get-childitem"]).has(executable))
    throw new Error("Command is not available in contained capability mode");
}
