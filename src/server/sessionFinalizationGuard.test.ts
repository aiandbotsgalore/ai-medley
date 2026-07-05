import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {
  readAutomaticWorkflowCheckpoint,
  requiresAutomaticCandidateApproval,
} from "./automaticSessionGuard";
import {
  createEmptyManifest,
  readCandidateManifest,
  validateLegacyFinalOutput,
  validateSessionId,
  writeCandidateManifestAtomic,
} from "./candidateStore";
import type { AutomaticWorkflowCheckpoint } from "../types/specialistWorkflow";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-medley-finish-"));
const workDir = path.join(root, "workdir");
const checkpointDir = path.join(root, "checkpoints");
fs.mkdirSync(workDir, { recursive: true });
fs.mkdirSync(checkpointDir, { recursive: true });

function automaticCheckpoint(sessionId: string): AutomaticWorkflowCheckpoint {
  return {
    schemaVersion: 3,
    sessionId,
    workflowMode: "automatic",
    stage: "context_brief",
    activeRole: null,
    activeModel: null,
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
}

function writeCheckpoint(sessionId: string, value: unknown) {
  fs.writeFileSync(
    path.join(checkpointDir, `${sessionId}.json`),
    JSON.stringify(value),
    "utf8",
  );
}

async function startFinishRoute() {
  const app = express();
  app.use(express.json());
  app.post("/api/session/finish", (req, res) => {
    const { sessionId, finalAudioPath } = req.body || {};
    if (!sessionId || !finalAudioPath) {
      return res
        .status(400)
        .json({ error: "sessionId and finalAudioPath are required" });
    }
    try {
      validateSessionId(sessionId);
      const manifest = readCandidateManifest(workDir, sessionId);
      if (
        requiresAutomaticCandidateApproval({
          sessionId,
          session: null,
          manifest,
          checkpointDir,
        })
      ) {
        return res.status(409).json({
          error:
            "Automatic sessions must finalize through an approved selected candidate.",
        });
      }
      validateLegacyFinalOutput(workDir, sessionId, finalAudioPath);
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const automaticAfterRestart = "auto-restart";
writeCheckpoint(
  automaticAfterRestart,
  automaticCheckpoint(automaticAfterRestart),
);
assert.ok(
  readAutomaticWorkflowCheckpoint(checkpointDir, automaticAfterRestart),
);
assert.equal(
  requiresAutomaticCandidateApproval({
    sessionId: automaticAfterRestart,
    session: null,
    manifest: readCandidateManifest(workDir, automaticAfterRestart),
    checkpointDir,
  }),
  true,
);

const route = await startFinishRoute();
try {
  const blocked = await fetch(`${route.url}/api/session/finish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: automaticAfterRestart,
      finalAudioPath: "medley.mp3",
    }),
  });
  assert.equal(blocked.status, 409);
  assert.match(await blocked.text(), /approved selected candidate/);

  const legacySession = "legacy-manual";
  writeCandidateManifestAtomic(workDir, legacySession, {
    ...createEmptyManifest(legacySession),
    workflowMode: "legacy",
  });
  const legacyDir = path.join(workDir, legacySession);
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, "medley.mp3"), "legacy", "utf8");
  const allowed = await fetch(`${route.url}/api/session/finish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: legacySession,
      finalAudioPath: "medley.mp3",
    }),
  });
  assert.equal(allowed.status, 200);

  const missingLegacy = await fetch(`${route.url}/api/session/finish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: legacySession,
      finalAudioPath: "missing.mp3",
    }),
  });
  assert.equal(missingLegacy.status, 400);
  assert.match(await missingLegacy.text(), /missing/);

  const oldCheckpoint = "old-checkpoint";
  writeCheckpoint(oldCheckpoint, {
    schemaVersion: 1,
    sessionId: oldCheckpoint,
  });
  assert.equal(
    readAutomaticWorkflowCheckpoint(checkpointDir, oldCheckpoint),
    null,
  );
  const oldDir = path.join(workDir, oldCheckpoint);
  fs.mkdirSync(oldDir, { recursive: true });
  fs.writeFileSync(path.join(oldDir, "medley.mp3"), "old legacy", "utf8");
  const oldAllowed = await fetch(`${route.url}/api/session/finish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: oldCheckpoint,
      finalAudioPath: "medley.mp3",
    }),
  });
  assert.equal(oldAllowed.status, 200);
} finally {
  await route.close();
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("sessionFinalizationGuard tests passed");
