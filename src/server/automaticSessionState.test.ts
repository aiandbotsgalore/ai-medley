import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AUTOMATIC_WORKFLOW_VERSION } from "../types/automaticWorkflowV4";
import { assertLegalSessionTransition, readAutomaticSessionState, withAutomaticSessionTransaction, writeAutomaticSessionState } from "./automaticSessionState";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-medley-v4-state-"));
const now = "2026-07-13T00:00:00.000Z";
const base = { schemaVersion: 1 as const, workflowVersion: AUTOMATIC_WORKFLOW_VERSION, sessionId: "session-1", state: "created" as const, stateRevision: -1, selectedTrackIds: ["a", "b"], selectionHash: "a".repeat(64), designHash: null, activeArrangementVersion: null, activeExecutionGeneration: 0, currentCandidateId: null, idempotencyRecords: [], recoverableError: null, createdAt: now, updatedAt: now };
try {
  const first = writeAutomaticSessionState(root, base, -1);
  assert.equal(first.stateRevision, 0);
  assert.throws(() => writeAutomaticSessionState(root, first, -1), /revision conflict/);
  assert.equal(readAutomaticSessionState(root, "session-1")?.stateRevision, 0);
  assert.doesNotThrow(() => assertLegalSessionTransition("created", "analyzing"));
  assert.throws(() => assertLegalSessionTransition("completed", "planning"), /Illegal/);
  const order: number[] = [];
  await Promise.all([withAutomaticSessionTransaction("session-1", async () => { order.push(1); }), withAutomaticSessionTransaction("session-1", async () => { order.push(2); })]);
  assert.deepEqual(order, [1, 2]);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log("automaticSessionState tests passed");
