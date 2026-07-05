import fs from "fs";
import path from "path";
import {
  AutomaticWorkflowCheckpointSchema,
  type AutomaticWorkflowCheckpoint,
  type CandidateManifest,
} from "../types/specialistWorkflow";
import { validateSessionId } from "./candidateStore";

export type SessionWorkflowHints = {
  [key: string]: unknown;
  projectBrief?: unknown;
  workflowMode?: unknown;
};

export function readAutomaticWorkflowCheckpoint(
  checkpointDir: string,
  sessionId: string,
): AutomaticWorkflowCheckpoint | null {
  validateSessionId(sessionId);
  const filePath = path.join(checkpointDir, `${sessionId}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = AutomaticWorkflowCheckpointSchema.safeParse(
      JSON.parse(fs.readFileSync(filePath, "utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function hasPersistedAutomaticWorkflow(
  checkpointDir: string,
  sessionId: string,
) {
  return readAutomaticWorkflowCheckpoint(checkpointDir, sessionId) !== null;
}

export function requiresAutomaticCandidateApproval(input: {
  sessionId: string;
  session?: SessionWorkflowHints | null;
  manifest?: CandidateManifest | null;
  checkpointDir: string;
}) {
  const { sessionId, session, manifest, checkpointDir } = input;
  if (session?.projectBrief || session?.workflowMode === "automatic")
    return true;
  if (manifest?.workflowMode === "automatic") return true;
  if (hasPersistedAutomaticWorkflow(checkpointDir, sessionId)) return true;
  if (manifest?.workflowMode === "legacy") return false;
  // Older automatic manifests did not persist workflow mode. Treat any
  // unclassified manifest with candidates as automatic instead of silently
  // allowing an unreviewed promotion after restart.
  return Array.isArray(manifest?.candidates) && manifest.candidates.length > 0;
}
