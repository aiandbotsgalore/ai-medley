import fs from "node:fs";
import path from "node:path";
import { listFinalizationJournals } from "./finalizationTransaction";
import { readCandidateManifest, validateSessionId } from "./candidateStore";

export type HistoryReconciliationStatus =
  | "available"
  | "output_missing"
  | "candidate_recoverable"
  | "finalization_incomplete"
  | "legacy_unverified";

export type StartupReconciliationRecord = {
  sessionId: string;
  status: HistoryReconciliationStatus;
  detail: string;
};

/**
 * Read-only recovery classification. It deliberately writes nothing, removes
 * nothing, and never upgrades a record to completed based on a single file.
 */
export function reconcileStartupState(input: {
  workDir: string;
  history: Array<{ id?: unknown; finalAudioPath?: unknown }>;
}) {
  const incomplete = new Set(
    listFinalizationJournals(input.workDir)
      .filter((journal) => journal.status !== "completed")
      .map((journal) => journal.sessionId),
  );
  const records: StartupReconciliationRecord[] = [];
  for (const item of input.history) {
    if (typeof item.id !== "string") continue;
    const sessionId = item.id;
    if (incomplete.has(sessionId)) {
      records.push({ sessionId, status: "finalization_incomplete", detail: "Finalization transaction remains in progress." });
      incomplete.delete(sessionId);
      continue;
    }
    const finalPath = typeof item.finalAudioPath === "string" ? item.finalAudioPath : null;
    if (finalPath && fs.existsSync(finalPath)) {
      records.push({ sessionId, status: "available", detail: "Recorded final output exists." });
      continue;
    }
    let hasCandidate = false;
    try {
      hasCandidate = readCandidateManifest(input.workDir, sessionId).candidates.length > 0;
    } catch {
      // A legacy or corrupt manifest is deliberately not repaired here.
    }
    records.push({
      sessionId,
      status: hasCandidate ? "candidate_recoverable" : finalPath ? "output_missing" : "legacy_unverified",
      detail: hasCandidate
        ? "Final output is missing, but registered candidates are preserved."
        : finalPath
          ? "Recorded final output is missing."
          : "Legacy history record has no verifiable final output.",
    });
  }
  for (const sessionId of incomplete) {
    records.push({ sessionId, status: "finalization_incomplete", detail: "Finalization transaction remains in progress without a history projection." });
  }
  return records;
}
