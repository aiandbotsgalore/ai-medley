export type CandidateQualityInput = {
  actualDurationSec: number;
  expectedDurationSec: number;
  targetDurationSec: number | null;
  quality: {
    integratedLUFS: number | null;
    loudnessRange: number | null;
    truePeak: number | null;
  };
};

export function evaluateCandidateQuality(input: CandidateQualityInput) {
  const blockingIssues: string[] = [];
  const warnings: string[] = [];
  if (!Number.isFinite(input.actualDurationSec) || input.actualDurationSec <= 0) {
    blockingIssues.push("Candidate duration is not finite and positive");
  }
  if (
    Number.isFinite(input.actualDurationSec) &&
    Number.isFinite(input.expectedDurationSec) &&
    input.expectedDurationSec > 0
  ) {
    const tolerance = Math.max(2, input.expectedDurationSec * 0.02);
    if (Math.abs(input.actualDurationSec - input.expectedDurationSec) > tolerance) {
      blockingIssues.push(
        `Rendered duration differs from the compiled timeline by more than ${tolerance.toFixed(2)}s`,
      );
    }
  }
  if (input.targetDurationSec && input.targetDurationSec > 0) {
    const tolerance = Math.max(5, input.targetDurationSec * 0.1);
    if (Math.abs(input.actualDurationSec - input.targetDurationSec) > tolerance) {
      blockingIssues.push(
        `Rendered duration differs from the requested target by more than ${tolerance.toFixed(2)}s`,
      );
    }
  }
  if (!Number.isFinite(input.quality.integratedLUFS)) {
    blockingIssues.push("Integrated loudness could not be measured");
  }
  if (!Number.isFinite(input.quality.truePeak)) {
    blockingIssues.push("True peak could not be measured");
  } else if ((input.quality.truePeak as number) > -0.1) {
    blockingIssues.push("True peak exceeds the -0.1 dB safety ceiling");
  }
  if (!Number.isFinite(input.quality.loudnessRange)) {
    warnings.push("Loudness range could not be measured");
  }
  return {
    contractVersion: 1 as const,
    technicallyValid: blockingIssues.length === 0,
    blockingIssues,
    warnings,
    actualDurationSec: input.actualDurationSec,
    expectedDurationSec: input.expectedDurationSec,
    targetDurationSec: input.targetDurationSec,
  };
}
