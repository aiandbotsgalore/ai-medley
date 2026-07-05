import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import {
  SUPPORTED_TRANSITION_STYLES,
  buildCanonicalAcrossfade,
  getTransitionStyleConfig,
} from "./transitionGraph";

for (const style of SUPPORTED_TRANSITION_STYLES) {
  const filter = buildCanonicalAcrossfade({
    leftLabel: "left",
    rightLabel: "right",
    outputLabel: "joined",
    duration: 5,
    style,
  });
  assert.match(filter, /^\[left\]\[right\]acrossfade=d=5:/);
  assert.match(filter, /\[joined\]$/);
  assert.equal(filter, buildCanonicalAcrossfade({
    leftLabel: "left",
    rightLabel: "right",
    outputLabel: "joined",
    duration: 5,
    style,
  }));
  assert.ok(ffmpegPath, "Bundled FFmpeg must be available");
  const execution = spawnSync(
    ffmpegPath,
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=3:sample_rate=48000",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=660:duration=3:sample_rate=48000",
      "-filter_complex",
      `[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[left];` +
        `[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[right];` +
        filter,
      "-map",
      "[joined]",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8" },
  );
  assert.equal(execution.status, 0, `${style}: ${execution.stderr}`);
}

assert.match(
  buildCanonicalAcrossfade({
    leftLabel: "left",
    rightLabel: "right",
    outputLabel: "joined",
    duration: 4,
    style: "energy_ramp",
  }),
  /acrossfade=.*?,highpass=f=80\[joined\]$/,
  "Style processing must occur after the shared acrossfade in preview and final",
);
assert.throws(
  () => getTransitionStyleConfig("mashup_layer"),
  /disabled until canonical timeline parity is implemented/,
);
assert.throws(() => getTransitionStyleConfig("invented"), /Unsupported/);

console.log("transitionGraph tests passed");
