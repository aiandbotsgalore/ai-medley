export type AudioArtifactProbe = {
  durationSec: number;
  codec: string;
  sampleRateHz: number;
  channels: string;
};

export function parseFfmpegAudioProbe(output: string): AudioArtifactProbe {
  const durationMatch = output.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
  const audioMatch = output.match(
    /Audio:\s*([^,\s]+)[^\r\n]*?,\s*(\d+)\s*Hz,\s*([^,\r\n]+)/,
  );
  if (!durationMatch || !audioMatch) {
    throw new Error("Audio artifact is not decodable or has no audio stream");
  }
  const durationSec =
    Number(durationMatch[1]) * 3600 +
    Number(durationMatch[2]) * 60 +
    Number(durationMatch[3]) +
    Number(`0.${durationMatch[4]}`);
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error("Audio artifact duration is not finite and positive");
  }
  return {
    durationSec,
    codec: audioMatch[1].toLowerCase(),
    sampleRateHz: Number(audioMatch[2]),
    channels: audioMatch[3].trim().toLowerCase(),
  };
}

export function assertExpectedPreviewArtifact(input: {
  sizeBytes: number;
  probe: AudioArtifactProbe;
  expectedDurationSec: number;
}) {
  const tolerance = Math.max(0.25, input.expectedDurationSec * 0.05);
  if (input.sizeBytes < 1024) throw new Error("Preview artifact is too small");
  if (!input.probe.codec.startsWith("mp3")) {
    throw new Error(`Preview codec is ${input.probe.codec}, expected MP3`);
  }
  if (input.probe.sampleRateHz !== 48000) {
    throw new Error("Preview sample rate is not 48000 Hz");
  }
  if (!input.probe.channels.includes("stereo")) {
    throw new Error("Preview channel layout is not stereo");
  }
  if (
    Math.abs(input.probe.durationSec - input.expectedDurationSec) > tolerance
  ) {
    throw new Error("Preview duration is outside the expected tolerance");
  }
}
