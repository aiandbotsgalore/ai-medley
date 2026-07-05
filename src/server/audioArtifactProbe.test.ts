import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import {
  assertExpectedPreviewArtifact,
  parseFfmpegAudioProbe,
} from "./audioArtifactProbe";

assert.ok(ffmpegPath, "Bundled FFmpeg must be available");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-medley-probe-"));
try {
  const outputPath = path.join(root, "preview.mp3");
  const render = spawnSync(
    ffmpegPath,
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=2:sample_rate=48000",
      "-ac",
      "2",
      "-c:a",
      "libmp3lame",
      outputPath,
    ],
    { encoding: "utf8" },
  );
  assert.equal(render.status, 0, render.stderr);
  const inspect = spawnSync(ffmpegPath, ["-i", outputPath], {
    encoding: "utf8",
  });
  const probe = parseFfmpegAudioProbe(`${inspect.stdout}\n${inspect.stderr}`);
  assertExpectedPreviewArtifact({
    sizeBytes: fs.statSync(outputPath).size,
    probe,
    expectedDurationSec: 2,
  });
  assert.equal(probe.sampleRateHz, 48000);
  assert.match(probe.channels, /stereo/);

  assert.throws(() => parseFfmpegAudioProbe("not audio"), /not decodable/);
  assert.throws(
    () =>
      assertExpectedPreviewArtifact({
        sizeBytes: 10,
        probe,
        expectedDurationSec: 2,
      }),
    /too small/,
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("audioArtifactProbe tests passed");
