import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  executeFinalizationTransaction,
  readFinalizationJournal,
} from "./finalizationTransaction";

const root = fs.mkdtempSync(
  path.join(os.tmpdir(), "ai-medley-finalization-transaction-"),
);
const sessionId = "transaction-test";
const sessionDir = path.join(root, sessionId);
const finalPath = path.join(sessionDir, "medley_final.mp3");
fs.mkdirSync(sessionDir, { recursive: true });
fs.writeFileSync(finalPath, "final bytes", "utf8");
const finalSha256 = createHash("sha256")
  .update(fs.readFileSync(finalPath))
  .digest("hex");

const history: any[] = [];
const wisdom: any[] = [];
let promoteCalls = 0;
let historyWrites = 0;
let wisdomWrites = 0;
let checkpointDeletes = 0;
let failWisdomOnce = true;

const input = {
  workDir: root,
  sessionId,
  candidateId: "candidate-001",
  summary: "Transaction fixture",
  promote: () => {
    promoteCalls++;
    return {
      finalPath,
      manifestVersion: 1,
      sha256: finalSha256,
    };
  },
  readHistory: () => structuredClone(history),
  writeHistory: (next: any[]) => {
    historyWrites++;
    history.splice(0, history.length, ...structuredClone(next));
  },
  readWisdom: () => structuredClone(wisdom),
  writeWisdom: (next: any[]) => {
    wisdomWrites++;
    if (failWisdomOnce) {
      failWisdomOnce = false;
      throw new Error("wisdom unavailable");
    }
    wisdom.splice(0, wisdom.length, ...structuredClone(next));
  },
  createHistoryEntry: (resolvedPath: string) => ({
    id: sessionId,
    finalAudioPath: resolvedPath,
    candidateId: "candidate-001",
  }),
  createWisdomEntry: (resolvedPath: string) => ({
    type: "completed_medley",
    sessionId,
    finalAudioPath: resolvedPath,
    candidateId: "candidate-001",
  }),
  deleteCheckpoint: () => {
    checkpointDeletes++;
  },
};

try {
  assert.throws(() => executeFinalizationTransaction(input), /wisdom unavailable/);
  assert.equal(history.length, 1);
  assert.equal(wisdom.length, 0);
  const interrupted = readFinalizationJournal(root, sessionId)!;
  assert.equal(interrupted.steps.historyWritten, true);
  assert.equal(interrupted.steps.wisdomWritten, false);
  assert.equal(interrupted.status, "in_progress");

  const completed = executeFinalizationTransaction(input);
  assert.equal(completed.journal.status, "completed");
  assert.equal(history.length, 1, "Retry must not duplicate history");
  assert.equal(wisdom.length, 1, "Retry must repair the missing wisdom projection");
  assert.equal(promoteCalls, 1, "Retry must reuse the promoted final");
  assert.equal(historyWrites, 1);
  assert.equal(wisdomWrites, 2);
  assert.equal(checkpointDeletes, 1);

  const repeated = executeFinalizationTransaction(input);
  assert.equal(repeated.idempotent, true);
  assert.equal(history.length, 1);
  assert.equal(wisdom.length, 1);
  assert.equal(checkpointDeletes, 1);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("finalizationTransaction tests passed");
