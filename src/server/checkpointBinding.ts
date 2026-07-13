import crypto from "node:crypto";

export type ResumeBinding = {
  version: 1;
  sourceFingerprint: string;
  designFingerprint: string;
};

function digest(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function buildResumeBinding(checkpoint: any, library: any[]): ResumeBinding {
  const trackIds = [
    ...(checkpoint?.selectedTrackIds ||
      checkpoint?.projectBrief?.recommendedOrderIds ||
      checkpoint?.arrangementPlan?.orderedTrackIds ||
      []),
  ].sort();
  const sources = trackIds.map((trackId) => {
    const entry = library.find((item) => item?.id === trackId);
    return {
      trackId,
      fileHash: entry?.localAnalysis?.localAnalysisV2?.fileHash || null,
      cacheKey: entry?.localAnalysis?.localAnalysisV2?.cacheKey || null,
    };
  });
  return {
    version: 1,
    sourceFingerprint: digest(sources),
    designFingerprint: digest({
      projectBrief: checkpoint?.projectBrief || null,
      arrangementPlan: checkpoint?.arrangementPlan || null,
    }),
  };
}

export function compareResumeBinding(
  stored: ResumeBinding | null | undefined,
  current: ResumeBinding,
) {
  if (!stored) {
    return { compatible: false, reason: "legacy-unbound" as const };
  }
  if (stored.sourceFingerprint !== current.sourceFingerprint) {
    return { compatible: false, reason: "source-changed" as const };
  }
  if (stored.designFingerprint !== current.designFingerprint) {
    return { compatible: false, reason: "design-changed" as const };
  }
  return { compatible: true, reason: "match" as const };
}
