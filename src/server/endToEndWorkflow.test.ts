import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

const workspace = process.cwd();
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ai-medley-e2e-test-"));
const port = 39_000 + Math.floor(Math.random() * 500);
const baseUrl = `http://127.0.0.1:${port}`;
let serverOutput = "";

type OpenRouterModel = {
  id?: unknown;
  supported_parameters?: unknown;
  architecture?: { input_modalities?: unknown };
};

function isFreeAudioToolModel(model: OpenRouterModel): model is {
  id: string;
  supported_parameters: string[];
  architecture: { input_modalities: string[] };
} {
  return (
    typeof model.id === "string" &&
    model.id.endsWith(":free") &&
    Array.isArray(model.supported_parameters) &&
    model.supported_parameters.includes("tools") &&
    Array.isArray(model.architecture?.input_modalities) &&
    model.architecture.input_modalities.includes("audio")
  );
}

async function getLiveFreeAudioToolModel() {
  const requested = process.env.OPENROUTER_LIVE_TEST_MODEL?.trim();
  if (requested) {
    assert.match(
      requested,
      /:free$/,
      "OPENROUTER_LIVE_TEST_MODEL must end in :free so this test cannot spend credits",
    );
  }
  const response = await fetch(
    "https://openrouter.ai/api/v1/models?input_modalities=audio&supported_parameters=tools&sort=throughput-high-to-low",
  );
  assert.equal(response.ok, true, `OpenRouter model catalog failed (${response.status})`);
  const payload = await response.json() as { data?: OpenRouterModel[] };
  const models = Array.isArray(payload.data) ? payload.data : [];
  const model = requested
    ? models.find((item) => item.id === requested && isFreeAudioToolModel(item))
    : models.find(isFreeAudioToolModel);
  assert.ok(
    model,
    requested
      ? `Configured live test model is not currently a free audio/tool model: ${requested}`
      : "OpenRouter currently lists no free model that accepts audio and tool calls",
  );
  return model.id as string;
}

function sha256(filePath: string) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

async function jsonRequest(route: string, init?: RequestInit) {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${route}`, init);
  } catch (error) {
    throw new Error(
      `${init?.method ?? "GET"} ${route} could not reach isolated server: ${String(error)}\n${serverOutput}`,
    );
  }
  const payload = await response.json().catch(() => ({}));
  assert.equal(
    response.ok,
    true,
    `${init?.method ?? "GET"} ${route} failed (${response.status}): ${JSON.stringify(payload)}`,
  );
  return payload as any;
}

function createTone(filename: string, frequency: number) {
  assert.ok(ffmpegPath, "ffmpeg-static path is unavailable");
  const output = path.join(dataRoot, filename);
  execFileSync(
    ffmpegPath,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${frequency}:duration=24`,
      "-c:a",
      "pcm_s16le",
      output,
    ],
    { stdio: "pipe" },
  );
  return output;
}

// This test is deliberately live, but only against a catalog-listed free
// OpenRouter audio/tool model. The model receives a generated test MP3, never
// user audio, and every writable application path remains in dataRoot.
const liveFreeAudioModel = await getLiveFreeAudioToolModel();

const server = spawn(
  process.execPath,
  [path.join(workspace, "node_modules", "tsx", "dist", "cli.mjs"), "server.ts"],
  {
    cwd: workspace,
    env: {
      ...process.env,
      AI_MEDLEY_DATA_ROOT: dataRoot,
      NODE_ENV: "test",
      PORT: String(port),
      GEMINI_API_KEY: "",
      OPENROUTER_LIVE_TEST_MODEL: liveFreeAudioModel,
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
server.stdout?.on("data", (chunk) => (serverOutput += String(chunk)));
server.stderr?.on("data", (chunk) => (serverOutput += String(chunk)));

try {
  let healthy = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null)
      throw new Error(`Isolated server exited (${server.exitCode}): ${serverOutput}`);
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) {
        healthy = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(healthy, true, `Isolated server did not start: ${serverOutput}`);

  const tones = [
    createTone("tone-a.wav", 440),
    createTone("tone-b.wav", 554),
    createTone("tone-c.wav", 659),
  ];
  for (const tone of tones) {
    const form = new FormData();
    form.append(
      "files",
      new Blob([fs.readFileSync(tone)], { type: "audio/wav" }),
      path.basename(tone),
    );
    await jsonRequest("/api/library", { method: "POST", body: form });
  }

  const library = (await jsonRequest("/api/library")) as Array<any>;
  assert.equal(library.length, 3);
  const selectedIds = [library[0].id, library[1].id];
  for (const fileId of selectedIds) {
    const analysis = await jsonRequest("/api/audio-analysis/local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileId,
        saveToLibrary: true,
        analysisGeneration: "isolated-e2e",
      }),
    });
    assert.equal(
      analysis.analysis.localAnalysisV2.schemaVersion,
      "local_audio_analysis_v2",
    );
  }

  const sessionId = "isolated-e2e";
  const designResult = await jsonRequest("/api/medley-intelligence/design", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "isolated-session-create" },
    body: JSON.stringify({
      sessionId,
      trackIds: selectedIds,
      userConstraints: {
        style: "smooth",
        // Two 24-second fixtures cannot legitimately satisfy a 60-second
        // target. Keep the acceptance case within its available source range.
        targetDurationMinutes: 46 / 60,
        crossfadeDurationSeconds: 2,
      },
    }),
  });
  assert.deepEqual(
    new Set(designResult.design.tracks.map((track: any) => track.trackId)),
    new Set(selectedIds),
  );
  const sessionState = JSON.parse(
    fs.readFileSync(
      path.join(dataRoot, "workdir", sessionId, "session-state.json"),
      "utf8",
    ),
  );
  assert.equal(sessionState.workflowVersion, 4);
  assert.deepEqual(sessionState.selectedTrackIds, selectedIds);
  const designSnapshot = JSON.parse(
    fs.readFileSync(
      path.join(dataRoot, "workdir", sessionId, "design-v4.json"),
      "utf8",
    ),
  );
  assert.equal(designSnapshot.designHash, sessionState.designHash);
  assert.deepEqual(designSnapshot.selectedTrackIds, selectedIds);
  const repeatedDesign = await jsonRequest("/api/medley-intelligence/design", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "isolated-session-create" },
    body: JSON.stringify({
      sessionId,
      trackIds: selectedIds,
      userConstraints: {
        style: "smooth",
        targetDurationMinutes: 46 / 60,
        crossfadeDurationSeconds: 2,
      },
    }),
  });
  assert.equal(repeatedDesign.idempotent, true);
  assert.deepEqual(repeatedDesign.design, designResult.design);

  const authoritativeCandidate = designResult.design.transitionMatrixSummary.find(
    (candidate: any) =>
      candidate.fromTrackId !== candidate.toTrackId &&
      selectedIds.includes(candidate.fromTrackId) &&
      selectedIds.includes(candidate.toTrackId),
  );
  assert.ok(authoritativeCandidate, "Deterministic design did not produce a transition candidate");
  const transition = {
    transitionId: "isolated-transition-001",
    fromTrackId: authoritativeCandidate.fromTrackId,
    fromSectionId: authoritativeCandidate.fromSectionId,
    toTrackId: authoritativeCandidate.toTrackId,
    toSectionId: authoritativeCandidate.toSectionId,
    fromExitSec: authoritativeCandidate.fromExitSec,
    toEntrySec: authoritativeCandidate.toEntrySec,
    style: "smooth_blend",
    duration: 2,
    beatAlign: true,
    notes: "isolated end-to-end test",
  };
  const plan = {
    schemaVersion: 1,
    arrangementVersion: 1,
    projectId: sessionId,
    strategy: "isolated deterministic v4 acceptance",
    orderedTrackIds: [transition.fromTrackId, transition.toTrackId],
    transitions: [transition],
    confidence: 1,
    warnings: [],
  };
  await jsonRequest("/api/session/design-plan", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "isolated-arrangement" },
    body: JSON.stringify({ sessionId, plan }),
  });
  const repeatedArrangement = await jsonRequest("/api/session/design-plan", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "isolated-arrangement" },
    body: JSON.stringify({ sessionId, plan }),
  });
  assert.equal(repeatedArrangement.idempotent, true);

  const transitionExecutionRequest = {
    sessionId,
    transitionId: transition.transitionId,
    fromTrackId: transition.fromTrackId,
    fromSectionId: transition.fromSectionId,
    toTrackId: transition.toTrackId,
    toSectionId: transition.toSectionId,
    style: transition.style,
    duration: transition.duration,
    beatAlign: transition.beatAlign,
    notes: transition.notes,
    executionVersion: 1,
  };
  const transitionExecution = await jsonRequest("/api/apply-transition", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "isolated-transition-execution",
    },
    body: JSON.stringify(transitionExecutionRequest),
  });
  assert.equal(transitionExecution.idempotent, false);
  assert.equal(fs.existsSync(transitionExecution.outputPath), true);
  const repeatedTransitionExecution = await jsonRequest("/api/apply-transition", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "isolated-transition-execution",
    },
    body: JSON.stringify(transitionExecutionRequest),
  });
  assert.equal(repeatedTransitionExecution.idempotent, true);
  assert.equal(repeatedTransitionExecution.outputPath, transitionExecution.outputPath);

  const executionReport = await jsonRequest("/api/session/execution-report", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "isolated-execution-report" },
    body: JSON.stringify({
      sessionId,
      report: {
        schemaVersion: 1,
        executionVersion: 1,
        arrangementVersion: 1,
        attemptedTransitions: [{
          ...transition,
          success: true,
          actualFromExitSec: transitionExecution.actualFromExitSec,
          actualToEntrySec: transitionExecution.actualToEntrySec,
          previewPath: transitionExecution.outputPath,
          error: null,
        }],
        technicalWarnings: [],
        unresolvedFailures: [],
        completedAt: "2026-07-13T00:00:00.000Z",
      },
    }),
  });
  assert.equal(executionReport.idempotent, false);

  const render = await jsonRequest("/api/render-review-candidate", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "isolated-render" },
    body: JSON.stringify({ sessionId, arrangementVersion: 1, executionVersion: 1 }),
  });
  assert.equal(render.candidate.candidateId, "candidate-001");
  assert.equal(render.manifest.candidates.length, 1);
  assert.match(render.candidate.planHash, /^[a-f0-9]{64}$/);
  assert.equal(fs.existsSync(render.candidate.outputPath), true);
  const repeatedRender = await jsonRequest("/api/render-review-candidate", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "isolated-render" },
    body: JSON.stringify({ sessionId, arrangementVersion: 1, executionVersion: 1 }),
  });
  assert.equal(repeatedRender.idempotent, true);
  assert.equal(repeatedRender.candidate.candidateId, render.candidate.candidateId);

  const candidateRange = await fetch(
    `${baseUrl}/api/session/${sessionId}/candidates/${render.candidate.candidateId}/audio`,
    { headers: { Range: "bytes=0-31" } },
  );
  assert.equal(candidateRange.status, 206);
  assert.equal(candidateRange.headers.get("accept-ranges"), "bytes");
  assert.match(candidateRange.headers.get("content-range") ?? "", /^bytes 0-31\//);
  assert.equal((await candidateRange.arrayBuffer()).byteLength, 32);
  const renderedView = await jsonRequest(`/api/session/${sessionId}/state`);
  assert.equal(renderedView.review.candidateCount, 1);
  assert.equal(renderedView.review.candidates[0].audioUrl.includes("candidate-001"), true);
  const reviewableAfterFirstDraft = await jsonRequest("/api/sessions/reviewable");
  assert.equal(reviewableAfterFirstDraft.sessions[0].sessionId, sessionId);
  assert.equal(reviewableAfterFirstDraft.sessions[0].candidateCount, 1);

  // Send the MP3 FFmpeg just rendered to a real catalog-listed free OpenRouter
  // model. Approval is not asserted because synthetic tones are not music;
  // the contract is that the provider can hear the candidate and return the
  // required structured review without changing the registered artifact.
  const audioReview = await jsonRequest("/api/session/audio-review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      candidateId: render.candidate.candidateId,
      mode: "whole_mix",
    }),
  });
  assert.equal(audioReview.model, liveFreeAudioModel);
  assert.equal(audioReview.review.reviewSource, "openrouter_audio");
  assert.equal(audioReview.review.candidateId, render.candidate.candidateId);
  assert.equal(fs.existsSync(render.candidate.outputPath), true);
  console.log(`Live OpenRouter audio review passed using ${liveFreeAudioModel}`);

  const rejectedReviewRequest = {
    sessionId,
    review: {
      schemaVersion: 1,
      candidateId: render.candidate.candidateId,
      candidateVersion: render.candidate.candidateVersion,
      arrangementVersion: render.candidate.arrangementVersion,
      approved: false,
      emotionalArc: 50,
      transitionSmoothness: 50,
      performerIdentity: 50,
      overallScore: 50,
      blockingIssues: ["The crossfade needs a little more room."],
      corrections: [{
        transitionId: transition.transitionId,
        issue: "The handoff is abrupt.",
        requestedChange: "Apply bounded preset longer_crossfade.",
        correctionPreset: "longer_crossfade",
      }],
      warnings: [],
      reviewedAt: "2026-07-13T00:00:00.000Z",
    },
  };
  const rejectedReview = await jsonRequest("/api/session/quality-review", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "isolated-review-rejected" },
    body: JSON.stringify(rejectedReviewRequest),
  });
  assert.equal(rejectedReview.idempotent, false);

  const correctedTransition = { ...transition, duration: 2.5 };
  const correctedPlan = {
    ...plan,
    arrangementVersion: 2,
    transitions: [correctedTransition],
  };
  await jsonRequest("/api/session/design-plan", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "isolated-correction-plan" },
    body: JSON.stringify({ sessionId, plan: correctedPlan }),
  });
  const correctedExecutionRequest = {
    ...transitionExecutionRequest,
    duration: 2.5,
    executionVersion: 2,
  };
  const correctedExecution = await jsonRequest("/api/apply-transition", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "isolated-correction-transition",
    },
    body: JSON.stringify(correctedExecutionRequest),
  });
  await jsonRequest("/api/session/execution-report", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "isolated-correction-execution-report" },
    body: JSON.stringify({
      sessionId,
      report: {
        schemaVersion: 1,
        executionVersion: 2,
        arrangementVersion: 2,
        attemptedTransitions: [{
          ...correctedTransition,
          success: true,
          actualFromExitSec: correctedExecution.actualFromExitSec,
          actualToEntrySec: correctedExecution.actualToEntrySec,
          previewPath: correctedExecution.outputPath,
          error: null,
        }],
        technicalWarnings: [],
        unresolvedFailures: [],
        completedAt: "2026-07-13T00:01:00.000Z",
      },
    }),
  });
  const correctedRender = await jsonRequest("/api/render-review-candidate", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "isolated-correction-render" },
    body: JSON.stringify({
      sessionId,
      arrangementVersion: 2,
      executionVersion: 2,
      parentCandidateId: render.candidate.candidateId,
    }),
  });
  assert.equal(correctedRender.candidate.candidateId, "candidate-002");
  assert.notEqual(correctedRender.candidate.planHash, render.candidate.planHash);
  assert.equal(correctedRender.manifest.candidates.length, 2);
  assert.equal(fs.existsSync(render.candidate.outputPath), true);
  assert.equal(fs.existsSync(correctedRender.candidate.outputPath), true);

  const reviewRequest = {
    sessionId,
    review: {
      schemaVersion: 1,
      candidateId: correctedRender.candidate.candidateId,
      candidateVersion: correctedRender.candidate.candidateVersion,
      arrangementVersion: correctedRender.candidate.arrangementVersion,
      approved: true,
      emotionalArc: 50,
      transitionSmoothness: 50,
      performerIdentity: 50,
      overallScore: 50,
      blockingIssues: [],
      corrections: [],
      warnings: [],
      reviewedAt: "2026-07-13T00:02:00.000Z",
    },
  };
  const review = await jsonRequest("/api/session/quality-review", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "isolated-review-approved" },
    body: JSON.stringify(reviewRequest),
  });
  assert.equal(review.idempotent, false);

  const finalizeBody = JSON.stringify({
    sessionId,
    candidateId: correctedRender.candidate.candidateId,
    summary: "Isolated end-to-end verification",
  });
  const finalized = await jsonRequest("/api/finalize-medley", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: finalizeBody,
  });
  assert.equal(finalized.idempotent, false);
  assert.equal(sha256(correctedRender.candidate.outputPath), sha256(finalized.outputPath));

  const repeated = await jsonRequest("/api/finalize-medley", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: finalizeBody,
  });
  assert.equal(repeated.idempotent, true);
  const finalizedView = await jsonRequest(`/api/session/${sessionId}/state`);
  assert.equal(finalizedView.review.status, "finalized");
  assert.equal(finalizedView.review.final.integrityVerified, true);
  assert.equal(finalizedView.review.candidateCount, 2);
  assert.equal(finalizedView.review.candidates[0].audioUrl.includes("candidate-001"), true);
  assert.equal(finalizedView.review.candidates[1].audioUrl.includes("candidate-002"), true);
  const reviewableAfterRestart = await jsonRequest("/api/sessions/reviewable");
  assert.equal(reviewableAfterRestart.sessions[0].sessionId, sessionId);
  assert.equal(reviewableAfterRestart.sessions[0].status, "finalized");
  assert.equal(reviewableAfterRestart.sessions[0].final.integrityVerified, true);

  const cancel = await jsonRequest(`/api/session/${sessionId}/cancel`, {
    method: "POST",
    headers: { "Idempotency-Key": "isolated-cancel" },
  });
  assert.equal(cancel.idempotent, false);
  assert.match(cancel.message, /already completed/);
  const repeatedCancel = await jsonRequest(`/api/session/${sessionId}/cancel`, {
    method: "POST",
    headers: { "Idempotency-Key": "isolated-cancel" },
  });
  assert.equal(repeatedCancel.idempotent, true);
  assert.equal(repeatedCancel.message, cancel.message);

  const history = (await jsonRequest("/api/history")) as Array<any>;
  assert.equal(history.length, 1);
  assert.equal(history[0].candidateId, "candidate-002");
  const wisdom = JSON.parse(
    fs.readFileSync(path.join(dataRoot, "library", "wisdom.json"), "utf8"),
  );
  const completionWisdom = wisdom.find(
    (entry: any) => entry.type === "completed_medley",
  );
  assert.ok(completionWisdom, "Completed-medley wisdom entry is missing");
  assert.deepEqual(
    new Set(completionWisdom.tracksInvolved),
    new Set(selectedIds),
  );

  const download = await fetch(`${baseUrl}/api/audio/${sessionId}/download`);
  assert.equal(download.ok, true);
  assert.match(download.headers.get("content-type") ?? "", /^audio\/mpeg/);
  const downloadedHash = crypto
    .createHash("sha256")
    .update(Buffer.from(await download.arrayBuffer()))
    .digest("hex");
  assert.equal(downloadedHash, sha256(finalized.outputPath));

  console.log("endToEndWorkflow tests passed");
} finally {
  if (server.exitCode === null) server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (server.exitCode === null) server.kill("SIGKILL");
  fs.rmSync(dataRoot, { recursive: true, force: true });
}
