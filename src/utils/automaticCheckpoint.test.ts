import assert from "node:assert/strict";
import { postAutomaticCheckpoint } from "./automaticCheckpoint";
import type { AutomaticWorkflowCheckpoint } from "../types/specialistWorkflow";

const checkpoint: AutomaticWorkflowCheckpoint = {
  schemaVersion: 3,
  sessionId: "session-1",
  workflowMode: "automatic",
  stage: "arrangement",
  activeRole: "arrangement",
  activeModel: "model",
  activeRequestSequence: 1,
  attemptedModels: [],
  repairCount: 0,
  correctionCount: 0,
  projectBrief: null,
  arrangementPlan: null,
  executionReport: null,
  currentCandidate: null,
  qualityReview: null,
  savedAt: new Date(0).toISOString(),
};

let called = 0;
await postAutomaticCheckpoint(checkpoint, {
  isActive: () => true,
  fetchImpl: (async (_url: string, init?: RequestInit) => {
    called++;
    assert.equal(init?.method, "POST");
    assert.equal(JSON.parse(String(init?.body)).workflowMode, "automatic");
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch,
});
assert.equal(called, 1);

await assert.rejects(
  postAutomaticCheckpoint(checkpoint, {
    isActive: () => true,
    fetchImpl: (async () =>
      new Response(JSON.stringify({ ok: true, stale: true }), {
        status: 200,
      })) as typeof fetch,
  }),
  /stale/,
);

await assert.rejects(
  postAutomaticCheckpoint(checkpoint, {
    isActive: () => true,
    fetchImpl: (async () =>
      new Response(JSON.stringify({ error: "invalid checkpoint" }), {
        status: 400,
      })) as typeof fetch,
  }),
  /invalid checkpoint/,
);

await assert.rejects(
  postAutomaticCheckpoint(checkpoint, {
    isActive: () => false,
    fetchImpl: (async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
      })) as typeof fetch,
  }),
  /Superseded checkpoint/,
);

console.log("automaticCheckpoint tests passed");
