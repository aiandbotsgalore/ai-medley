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

function sha256(filePath: string) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

async function jsonRequest(route: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${route}`, init);
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

const server = spawn(
  process.execPath,
  [path.join(workspace, "node_modules", "tsx", "dist", "cli.mjs"), "server.ts"],
  {
    cwd: workspace,
    env: {
      ...process.env,
      AI_MEDLEY_DATA_ROOT: dataRoot,
      NODE_ENV: "development",
      PORT: String(port),
      GEMINI_API_KEY: "",
      OPENROUTER_API_KEY: "",
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
server.stdout.on("data", (chunk) => (serverOutput += String(chunk)));
server.stderr.on("data", (chunk) => (serverOutput += String(chunk)));

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
        targetDurationMinutes: 1,
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
  const repeatedDesign = await jsonRequest("/api/medley-intelligence/design", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "isolated-session-create" },
    body: JSON.stringify({
      sessionId,
      trackIds: selectedIds,
      userConstraints: {
        style: "smooth",
        targetDurationMinutes: 1,
        crossfadeDurationSeconds: 2,
      },
    }),
  });
  assert.equal(repeatedDesign.idempotent, true);
  assert.deepEqual(repeatedDesign.design, designResult.design);

  const transition = {
    fromTrackId: selectedIds[0],
    fromSectionId: "synthetic-a",
    toTrackId: selectedIds[1],
    toSectionId: "synthetic-b",
    fromExitSec: 18,
    toEntrySec: 2,
    style: "smooth_blend",
    duration: 2,
    beatAlign: true,
    notes: "isolated end-to-end test",
  };
  await jsonRequest("/api/session/design-plan", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "isolated-arrangement" },
    body: JSON.stringify({ sessionId, plan: { transitions: [transition] } }),
  });
  const repeatedArrangement = await jsonRequest("/api/session/design-plan", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "isolated-arrangement" },
    body: JSON.stringify({ sessionId, plan: { transitions: [transition] } }),
  });
  assert.equal(repeatedArrangement.idempotent, true);

  const transitionExecutionRequest = {
    sessionId,
    transitionId: "isolated-transition-001",
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

  const render = await jsonRequest("/api/render-review-candidate", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "isolated-render" },
    body: JSON.stringify({ sessionId, legacy: true }),
  });
  assert.equal(render.candidate.candidateId, "candidate-001");
  assert.equal(render.manifest.candidates.length, 1);
  assert.equal(fs.existsSync(render.candidate.outputPath), true);
  const repeatedRender = await jsonRequest("/api/render-review-candidate", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "isolated-render" },
    body: JSON.stringify({ sessionId, legacy: true }),
  });
  assert.equal(repeatedRender.idempotent, true);
  assert.equal(repeatedRender.candidate.candidateId, render.candidate.candidateId);

  const reviewRequest = {
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
      blockingIssues: ["mocked review rejection"],
      corrections: [],
      warnings: [],
      reviewedAt: "2026-07-13T00:00:00.000Z",
    },
  };
  const review = await jsonRequest("/api/session/quality-review", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "isolated-review" },
    body: JSON.stringify(reviewRequest),
  });
  assert.equal(review.idempotent, false);
  const repeatedReview = await jsonRequest("/api/session/quality-review", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "isolated-review" },
    body: JSON.stringify(reviewRequest),
  });
  assert.equal(repeatedReview.idempotent, true);
  assert.equal(repeatedReview.manifest.musicalReviews.length, 1);

  const finalizeBody = JSON.stringify({
    sessionId,
    candidateId: render.candidate.candidateId,
    summary: "Isolated end-to-end verification",
  });
  const finalized = await jsonRequest("/api/finalize-medley", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: finalizeBody,
  });
  assert.equal(finalized.idempotent, false);
  assert.equal(sha256(render.candidate.outputPath), sha256(finalized.outputPath));

  const repeated = await jsonRequest("/api/finalize-medley", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: finalizeBody,
  });
  assert.equal(repeated.idempotent, true);

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
  assert.equal(history[0].candidateId, "candidate-001");
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
