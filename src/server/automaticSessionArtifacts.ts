import fs from "node:fs";
import path from "node:path";
import {
  ArrangementVersionV1Schema,
  DesignSnapshotV4Schema,
  type ArrangementVersionV1,
  type DesignSnapshotV4,
} from "../types/automaticWorkflowV4";
import { canonicalJson } from "./automaticDesignV4";
import { writeAutomaticStateAtomic } from "./automaticSessionState";
import { getSessionDirectory, validateSessionId } from "./candidateStore";

function sessionArtifactPath(
  workDir: string,
  sessionId: string,
  filename: string,
) {
  validateSessionId(sessionId);
  return path.join(getSessionDirectory(workDir, sessionId), filename);
}

export function designSnapshotPath(workDir: string, sessionId: string) {
  return sessionArtifactPath(workDir, sessionId, "design-v4.json");
}

export function arrangementVersionPath(
  workDir: string,
  sessionId: string,
  arrangementVersion: number,
) {
  if (!Number.isInteger(arrangementVersion) || arrangementVersion < 1) {
    throw new Error("Arrangement version must be a positive integer");
  }
  return sessionArtifactPath(
    workDir,
    sessionId,
    `arrangement-v${arrangementVersion}.json`,
  );
}

export function readDesignSnapshotV4(workDir: string, sessionId: string) {
  const target = designSnapshotPath(workDir, sessionId);
  if (!fs.existsSync(target)) return null;
  return DesignSnapshotV4Schema.parse(JSON.parse(fs.readFileSync(target, "utf8")));
}

/**
 * A design snapshot is immutable source-derived evidence. The exact same
 * canonical snapshot may be replayed after a restart, but a different one
 * must start a new session rather than silently rewriting its provenance.
 */
export function writeDesignSnapshotV4(workDir: string, snapshot: DesignSnapshotV4) {
  const parsed = DesignSnapshotV4Schema.parse(snapshot);
  const target = designSnapshotPath(workDir, parsed.sessionId);
  const existing = readDesignSnapshotV4(workDir, parsed.sessionId);
  if (existing) {
    if (canonicalJson(existing) !== canonicalJson(parsed)) {
      throw new Error("A different design snapshot is already pinned for this session");
    }
    return existing;
  }
  writeAutomaticStateAtomic(target, parsed);
  return parsed;
}

export function readArrangementVersionV1(
  workDir: string,
  sessionId: string,
  arrangementVersion: number,
) {
  const target = arrangementVersionPath(workDir, sessionId, arrangementVersion);
  if (!fs.existsSync(target)) return null;
  return ArrangementVersionV1Schema.parse(JSON.parse(fs.readFileSync(target, "utf8")));
}

/** Arrangement versions are append-only. A retry can return the same file. */
export function writeArrangementVersionV1(
  workDir: string,
  artifact: ArrangementVersionV1,
) {
  const parsed = ArrangementVersionV1Schema.parse(artifact);
  const target = arrangementVersionPath(
    workDir,
    parsed.sessionId,
    parsed.arrangementVersion,
  );
  const existing = readArrangementVersionV1(
    workDir,
    parsed.sessionId,
    parsed.arrangementVersion,
  );
  if (existing) {
    if (canonicalJson(existing) !== canonicalJson(parsed)) {
      throw new Error("Arrangement version is already immutable for this session");
    }
    return existing;
  }
  writeAutomaticStateAtomic(target, parsed);
  return parsed;
}
