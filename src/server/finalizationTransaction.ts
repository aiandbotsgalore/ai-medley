import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  getSessionDirectory,
  sha256File,
  validateSessionId,
} from "./candidateStore";

export type FinalizationJournal = {
  schemaVersion: 1;
  sessionId: string;
  candidateId: string;
  summary: string;
  status: "in_progress" | "completed";
  finalPath: string | null;
  manifestVersion: number | null;
  sha256: string | null;
  steps: {
    candidatePromoted: boolean;
    historyWritten: boolean;
    wisdomWritten: boolean;
    checkpointDeleted: boolean;
  };
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type FinalizationEntry = Record<string, any>;

export type FinalizationTransactionInput = {
  workDir: string;
  sessionId: string;
  candidateId: string;
  summary: string;
  promote: () => {
    finalPath: string;
    manifestVersion: number | null;
    sha256: string | null;
  };
  readHistory: () => FinalizationEntry[];
  writeHistory: (entries: FinalizationEntry[]) => void;
  readWisdom: () => FinalizationEntry[];
  writeWisdom: (entries: FinalizationEntry[]) => void;
  createHistoryEntry: (finalPath: string) => FinalizationEntry;
  createWisdomEntry: (finalPath: string) => FinalizationEntry;
  deleteCheckpoint: () => void;
};

function journalPath(workDir: string, sessionId: string) {
  return path.join(
    getSessionDirectory(workDir, sessionId),
    "finalization-transaction.json",
  );
}

function validateJournal(value: unknown, sessionId: string) {
  const journal = value as FinalizationJournal;
  if (
    !journal ||
    journal.schemaVersion !== 1 ||
    journal.sessionId !== sessionId ||
    typeof journal.candidateId !== "string" ||
    typeof journal.summary !== "string" ||
    !["in_progress", "completed"].includes(journal.status) ||
    !journal.steps ||
    typeof journal.steps.candidatePromoted !== "boolean" ||
    typeof journal.steps.historyWritten !== "boolean" ||
    typeof journal.steps.wisdomWritten !== "boolean" ||
    typeof journal.steps.checkpointDeleted !== "boolean"
  ) {
    throw new Error("Finalization transaction journal is corrupt");
  }
  return journal;
}

function writeJournalAtomic(
  workDir: string,
  sessionId: string,
  journal: FinalizationJournal,
) {
  const target = journalPath(workDir, sessionId);
  const directory = path.dirname(target);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  const descriptor = fs.openSync(temporary, "wx");
  try {
    fs.writeFileSync(descriptor, JSON.stringify(journal, null, 2), "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  try {
    fs.renameSync(temporary, target);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

export function readFinalizationJournal(
  workDir: string,
  sessionId: string,
): FinalizationJournal | null {
  validateSessionId(sessionId);
  const target = journalPath(workDir, sessionId);
  if (!fs.existsSync(target)) return null;
  try {
    return validateJournal(
      JSON.parse(fs.readFileSync(target, "utf8")),
      sessionId,
    );
  } catch (error: any) {
    if (/corrupt/.test(error?.message || "")) throw error;
    throw new Error("Finalization transaction journal is corrupt", {
      cause: error,
    });
  }
}

export function listFinalizationJournals(workDir: string) {
  if (!fs.existsSync(workDir)) return [];
  const journals: FinalizationJournal[] = [];
  for (const entry of fs.readdirSync(workDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      validateSessionId(entry.name);
      const journal = readFinalizationJournal(workDir, entry.name);
      if (journal) journals.push(journal);
    } catch (error) {
      console.error(
        `[finalization-reconcile] Skipping invalid journal for ${entry.name}:`,
        error,
      );
    }
  }
  return journals;
}

function assertFinalIntegrity(
  workDir: string,
  sessionId: string,
  finalPath: string,
  expectedSha256: string | null,
) {
  const sessionDir = getSessionDirectory(workDir, sessionId);
  const resolved = path.resolve(finalPath);
  const realSession = fs.realpathSync.native(sessionDir);
  if (!fs.existsSync(resolved)) throw new Error("Final output is missing");
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("Final output must be a regular non-symlink file");
  }
  const realParent = fs.realpathSync.native(path.dirname(resolved));
  if (realParent !== realSession) {
    throw new Error("Final output must be directly inside the session directory");
  }
  if (expectedSha256 && sha256File(resolved) !== expectedSha256) {
    throw new Error("Final output integrity check failed");
  }
}

function updateJournal(
  workDir: string,
  journal: FinalizationJournal,
  updates: Partial<FinalizationJournal>,
) {
  const next: FinalizationJournal = {
    ...journal,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  writeJournalAtomic(workDir, journal.sessionId, next);
  return next;
}

export function executeFinalizationTransaction(
  input: FinalizationTransactionInput,
) {
  validateSessionId(input.sessionId);
  const startedAt = new Date().toISOString();
  let journal = readFinalizationJournal(input.workDir, input.sessionId);
  const wasCompleted = journal?.status === "completed";
  if (journal) {
    if (
      journal.candidateId !== input.candidateId ||
      journal.summary !== input.summary
    ) {
      if (
        journal.status === "in_progress" &&
        !Object.values(journal.steps).some(Boolean)
      ) {
        journal = null;
      } else {
        throw new Error(
          "Finalization retry does not match the persisted transaction",
        );
      }
    }
  }
  if (!journal) {
    journal = {
      schemaVersion: 1,
      sessionId: input.sessionId,
      candidateId: input.candidateId,
      summary: input.summary,
      status: "in_progress",
      finalPath: null,
      manifestVersion: null,
      sha256: null,
      steps: {
        candidatePromoted: false,
        historyWritten: false,
        wisdomWritten: false,
        checkpointDeleted: false,
      },
      startedAt,
      updatedAt: startedAt,
      completedAt: null,
    };
    writeJournalAtomic(input.workDir, input.sessionId, journal);
  }

  if (!journal.steps.candidatePromoted) {
    const promoted = input.promote();
    assertFinalIntegrity(
      input.workDir,
      input.sessionId,
      promoted.finalPath,
      promoted.sha256,
    );
    journal = updateJournal(input.workDir, journal, {
      finalPath: promoted.finalPath,
      manifestVersion: promoted.manifestVersion,
      sha256: promoted.sha256,
      steps: { ...journal.steps, candidatePromoted: true },
    });
  } else {
    if (!journal.finalPath) throw new Error("Finalization journal has no output");
    assertFinalIntegrity(
      input.workDir,
      input.sessionId,
      journal.finalPath,
      journal.sha256,
    );
  }

  const finalPath = journal.finalPath!;
  const history = input.readHistory();
  if (!history.some((entry) => entry.id === input.sessionId)) {
    input.writeHistory([input.createHistoryEntry(finalPath), ...history]);
  }
  if (!journal.steps.historyWritten) {
    journal = updateJournal(input.workDir, journal, {
      steps: { ...journal.steps, historyWritten: true },
    });
  }

  const wisdom = input.readWisdom();
  const hasWisdom = wisdom.some(
    (entry) =>
      entry.type === "completed_medley" &&
      entry.sessionId === input.sessionId &&
      (!entry.candidateId || entry.candidateId === input.candidateId),
  );
  if (!hasWisdom) {
    input.writeWisdom([
      ...wisdom,
      {
        ...input.createWisdomEntry(finalPath),
        recordedAt: new Date().toISOString(),
      },
    ]);
  }
  if (!journal.steps.wisdomWritten) {
    journal = updateJournal(input.workDir, journal, {
      steps: { ...journal.steps, wisdomWritten: true },
    });
  }

  if (!journal.steps.checkpointDeleted) {
    input.deleteCheckpoint();
    journal = updateJournal(input.workDir, journal, {
      steps: { ...journal.steps, checkpointDeleted: true },
    });
  }

  if (journal.status !== "completed") {
    journal = updateJournal(input.workDir, journal, {
      status: "completed",
      completedAt: new Date().toISOString(),
    });
  }
  return { journal, finalPath, idempotent: Boolean(wasCompleted) };
}
