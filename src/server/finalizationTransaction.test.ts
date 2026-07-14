import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  collectTransitionTrackIds,
  executeFinalizationTransaction,
  readFinalizationJournal,
} from "./finalizationTransaction";

assert.deepEqual(
  collectTransitionTrackIds([
    { fromTrackId: "a", toTrackId: "b" },
    { fromTrackId: "b", toTrackId: "c" },
  ]),
  ["a", "b", "c"],
);

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
let finalAudioVerifications = 0;
let failWisdomOnce = true;
const commitOrder: string[] = [];

const input = {
  workDir: root,
  sessionId,
  candidateId: "candidate-001",
  summary: "Transaction fixture",
  promote: () => {
    const intent = readFinalizationJournal(root, sessionId)!;
    assert.equal(intent.status, "in_progress");
    assert.deepEqual(intent.steps, {
      candidatePromoted: false,
      finalAudioVerified: false,
      historyWritten: false,
      wisdomWritten: false,
      checkpointDeleted: false,
    });
    commitOrder.push("candidate_promoted");
    promoteCalls++;
    return {
      finalPath,
      manifestVersion: 1,
      sha256: finalSha256,
    };
  },
  verifyFinalAudio: (resolvedPath: string) => {
    assert.equal(resolvedPath, finalPath);
    assert.equal(readFinalizationJournal(root, sessionId)?.steps.candidatePromoted, true);
    commitOrder.push("final_audio_verified");
    finalAudioVerifications++;
  },
  readHistory: () => structuredClone(history),
  writeHistory: (next: any[]) => {
    assert.equal(readFinalizationJournal(root, sessionId)?.steps.candidatePromoted, true);
    commitOrder.push("history_written");
    historyWrites++;
    history.splice(0, history.length, ...structuredClone(next));
  },
  readWisdom: () => structuredClone(wisdom),
  writeWisdom: (next: any[]) => {
    assert.equal(readFinalizationJournal(root, sessionId)?.steps.historyWritten, true);
    commitOrder.push("wisdom_written");
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
    assert.equal(readFinalizationJournal(root, sessionId)?.steps.wisdomWritten, true);
    commitOrder.push("checkpoint_deleted");
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
  assert.equal(finalAudioVerifications, 1, "The exact promoted audio is probed once");
  assert.equal(historyWrites, 1);
  assert.equal(wisdomWrites, 2);
  assert.equal(checkpointDeletes, 1);
  assert.deepEqual(commitOrder, [
    "candidate_promoted",
    "final_audio_verified",
    "history_written",
    "wisdom_written",
    "wisdom_written",
    "checkpoint_deleted",
  ]);

  const repeated = executeFinalizationTransaction(input);
  assert.equal(repeated.idempotent, true);
  assert.equal(history.length, 1);
  assert.equal(wisdom.length, 1);
  assert.equal(checkpointDeletes, 1);

  const probeSessionId = "final-probe-failure";
  const probeSessionDir = path.join(root, probeSessionId);
  const probeFinalPath = path.join(probeSessionDir, "medley_final.mp3");
  fs.mkdirSync(probeSessionDir, { recursive: true });
  fs.writeFileSync(probeFinalPath, "undecodable bytes", "utf8");
  const probeHash = createHash("sha256")
    .update(fs.readFileSync(probeFinalPath))
    .digest("hex");
  assert.throws(
    () => executeFinalizationTransaction({
      ...input,
      sessionId: probeSessionId,
      summary: "Probe failure fixture",
      promote: () => ({
        finalPath: probeFinalPath,
        manifestVersion: 1,
        sha256: probeHash,
      }),
      verifyFinalAudio: () => {
        throw new Error("audio probe rejected final");
      },
      readHistory: () => [],
      writeHistory: () => assert.fail("History must not be written before audio verification"),
      readWisdom: () => [],
      writeWisdom: () => assert.fail("Wisdom must not be written before audio verification"),
      createHistoryEntry: () => ({}),
      createWisdomEntry: () => ({}),
      deleteCheckpoint: () => assert.fail("Checkpoint must remain after audio verification failure"),
    }),
    /audio probe rejected final/,
  );
  const probeFailure = readFinalizationJournal(root, probeSessionId)!;
  assert.equal(probeFailure.status, "in_progress");
  assert.equal(probeFailure.steps.candidatePromoted, true);
  assert.equal(probeFailure.steps.finalAudioVerified, false);
  assert.equal(probeFailure.steps.historyWritten, false);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("finalizationTransaction tests passed");
