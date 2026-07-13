import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AUTOMATIC_WORKFLOW_VERSION } from "../types/automaticWorkflowV4";
import { assertLegalSessionTransition, readAutomaticIdempotencyResult, readAutomaticSessionState, replayAutomaticSessionIdempotent, transitionAutomaticSessionState, withAutomaticSessionTransaction, writeAutomaticSessionState } from "./automaticSessionState";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-medley-v4-state-"));
const now = "2026-07-13T00:00:00.000Z";
const base = { schemaVersion: 1 as const, workflowVersion: AUTOMATIC_WORKFLOW_VERSION, sessionId: "session-1", state: "created" as const, stateRevision: -1, selectedTrackIds: ["a", "b"], selectionHash: "a".repeat(64), designHash: null, activeArrangementVersion: null, activeExecutionGeneration: 0, currentCandidateId: null, idempotencyRecords: [], recoverableError: null, createdAt: now, updatedAt: now };
try {
  const first = writeAutomaticSessionState(root, base, -1);
  assert.equal(first.stateRevision, 0);
  assert.throws(() => writeAutomaticSessionState(root, first, -1), /revision conflict/);
  assert.equal(readAutomaticSessionState(root, "session-1")?.stateRevision, 0);
  assert.throws(
    () => writeAutomaticSessionState(root, first, 0, () => { throw new Error("injected atomic write failure"); }),
    /injected atomic write failure/,
  );
  assert.equal(
    readAutomaticSessionState(root, "session-1")?.stateRevision,
    0,
    "a failed write must preserve the prior durable state",
  );
  assert.doesNotThrow(() => assertLegalSessionTransition("created", "analyzing"));
  assert.throws(() => assertLegalSessionTransition("completed", "planning"), /Illegal/);
  const analyzing = transitionAutomaticSessionState({
    workDir: root,
    sessionId: "session-1",
    to: "analyzing",
  });
  assert.equal(analyzing.state, "analyzing");
  const planning = transitionAutomaticSessionState({
    workDir: root,
    sessionId: "session-1",
    to: "planning",
  });
  assert.equal(planning.stateRevision, 2);
  const order: number[] = [];
  await Promise.all([withAutomaticSessionTransaction("session-1", async () => { order.push(1); }), withAutomaticSessionTransaction("session-1", async () => { order.push(2); })]);
  assert.deepEqual(order, [1, 2]);
  const nested: string[] = [];
  await withAutomaticSessionTransaction("session-1", async () => {
    nested.push("outer");
    await withAutomaticSessionTransaction("session-1", async () => {
      nested.push("inner");
    });
  });
  assert.deepEqual(nested, ["outer", "inner"]);
  let simultaneous = 0;
  await Promise.all([
    withAutomaticSessionTransaction("session-1", async () => { simultaneous += 1; await new Promise((resolve) => setTimeout(resolve, 5)); simultaneous -= 1; }),
    withAutomaticSessionTransaction("session-2", async () => { simultaneous += 1; assert.equal(simultaneous, 2); simultaneous -= 1; }),
  ]);
  let calls = 0;
  const replayFirst = await replayAutomaticSessionIdempotent({
    workDir: root, sessionId: "session-1", operation: "candidate_rendering", key: "render-1", request: { candidate: 1 }, execute: async () => ({ rendered: ++calls }),
  });
  const replaySecond = await replayAutomaticSessionIdempotent({
    workDir: root, sessionId: "session-1", operation: "candidate_rendering", key: "render-1", request: { candidate: 1 }, execute: async () => ({ rendered: ++calls }),
  });
  assert.equal(replayFirst.replayed, false);
  assert.equal(replaySecond.replayed, true);
  assert.deepEqual(replaySecond.result, { rendered: 1 });
  assert.equal(calls, 1);
  assert.deepEqual(
    readAutomaticIdempotencyResult({ workDir: root, sessionId: "session-1", operation: "candidate_rendering", key: "render-1", request: { candidate: 1 } }),
    { rendered: 1 },
  );
  assert.equal(readAutomaticSessionState(root, "session-1")?.idempotencyRecords.length, 1);
  await assert.rejects(
    () => replayAutomaticSessionIdempotent({ workDir: root, sessionId: "session-1", operation: "candidate_rendering", key: "render-1", request: { candidate: 2 }, execute: async () => ({}) }),
    /different request/,
  );
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log("automaticSessionState tests passed");
