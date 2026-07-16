import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  MAX_EVALUATE_CALLS_PER_RUN,
  MAX_LLM_CALLS_PER_RUN,
  MAX_TOOL_FAILURE_STREAK,
} from "./constants/thresholds";
import { PRODUCTION_MAX_TURNS } from "./engine/specialistOrchestrator";
import { selectSessionTrackIntelligence } from "./server/automaticSessionGuard";

assert.equal(PRODUCTION_MAX_TURNS, 48);
assert.equal(MAX_TOOL_FAILURE_STREAK, 5);
assert.equal(MAX_EVALUATE_CALLS_PER_RUN, 40);
assert.equal(MAX_LLM_CALLS_PER_RUN, 60);

const existingTracks = [
  { profile: { trackId: "session-a" }, payload: { source: "session" } },
  { profile: { trackId: "session-b" }, payload: { source: "session" } },
];
const changedGlobalTracks = [
  { profile: { trackId: "session-a" }, payload: { source: "global" } },
  { profile: { trackId: "global-only" }, payload: { source: "global" } },
];
const selected = selectSessionTrackIntelligence(
  existingTracks,
  changedGlobalTracks,
  ["session-a"],
);
assert.deepEqual(selected, [existingTracks[0]]);
assert.notEqual(selected[0], existingTracks[0]);
selected[0].payload.source = "mutated-clone";
assert.equal(existingTracks[0].payload.source, "session");
assert.deepEqual(
  selectSessionTrackIntelligence([], changedGlobalTracks, ["global-only"]),
  [changedGlobalTracks[1]],
);

const appSource = fs.readFileSync(path.join(process.cwd(), "src/App.tsx"), "utf8");
assert.match(appSource, /const MAX_LOOP_TURNS = 30;/);
assert.doesNotMatch(
  appSource,
  /if \(snapshot\.status === "completed"\) setStatus\("completed"\)/,
  "SSE must not report completion without refreshing authoritative final integrity",
);
assert.ok(
  (appSource.match(/onManualReviewRequired:/g) ?? []).length >= 2,
  "Both Manual and Automatic workflows must restore Candidate Review from SSE",
);

const serverSource = fs.readFileSync(path.join(process.cwd(), "server.ts"), "utf8");
assert.match(serverSource, /maxBuffer:\s*10 \* 1024 \* 1024/);
assert.match(serverSource, /\[apply-transition\] Wisdom logging failed:/);
assert.match(serverSource, /\[session-metrics\] Wisdom logging failed:/);
assert.match(serverSource, /const renderArtifacts = await runFfmpegWithStrictLogging/);
assert.match(
  serverSource,
  /const httpServer = http\.createServer\(app\);[\s\S]*createViteServer\(\{[\s\S]*hmr:\s*\{\s*server:\s*httpServer\s*\}/,
  "Vite middleware HMR must share the owned loopback HTTP server instead of using fallback port 24678",
);

console.log("reliabilityHardening tests passed");
