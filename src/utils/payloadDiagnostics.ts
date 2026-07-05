/**
 * Payload Diagnostics
 * Measures size and composition of data sent to Gemini.
 */

export interface PayloadMetrics {
  totalChars: number;
  estimatedTokens: number;
  breakdown: {
    localFacts: number;
    heuristicGuesses: number;
    sectionScores: number;
    rankedCandidates: number;
    warnings: number;
    other: number;
  };
  trackCount: number;
  sectionCount: number;
}

export function analyzePayload(payload: any): PayloadMetrics {
  const jsonString = JSON.stringify(payload);
  const totalChars = jsonString.length;
  const estimatedTokens = Math.ceil(totalChars / 4);

  const breakdown = {
    localFacts: JSON.stringify(payload.localFacts || []).length,
    heuristicGuesses: JSON.stringify(payload.heuristicGuesses || []).length,
    sectionScores: JSON.stringify(payload.sectionScores || []).length,
    rankedCandidates: JSON.stringify(
      payload.rankedHookCandidates || payload.rankedCandidates || [],
    ).length,
    warnings: JSON.stringify(payload.warnings || []).length,
    other: 0,
  };

  breakdown.other = Math.max(
    0,
    totalChars -
      breakdown.localFacts -
      breakdown.heuristicGuesses -
      breakdown.sectionScores -
      breakdown.rankedCandidates -
      breakdown.warnings,
  );

  return {
    totalChars,
    estimatedTokens,
    breakdown,
    trackCount: payload.tracks?.length || 0,
    sectionCount: payload.sections?.length || 0,
  };
}

export function logPayloadMetrics(
  metrics: PayloadMetrics,
  label = "Gemini Payload",
) {
  console.log(`\n=== ${label} ===`);
  console.log(`Total Characters: ${metrics.totalChars.toLocaleString()}`);
  console.log(`Estimated Tokens: ~${metrics.estimatedTokens.toLocaleString()}`);
  console.log(
    `Tracks: ${metrics.trackCount} | Sections: ${metrics.sectionCount}`,
  );
  console.log("Breakdown (chars):");
  console.log(
    `  localFacts:        ${metrics.breakdown.localFacts.toLocaleString()}`,
  );
  console.log(
    `  heuristicGuesses:  ${metrics.breakdown.heuristicGuesses.toLocaleString()}`,
  );
  console.log(
    `  sectionScores:     ${metrics.breakdown.sectionScores.toLocaleString()}`,
  );
  console.log(
    `  rankedCandidates:  ${metrics.breakdown.rankedCandidates.toLocaleString()}`,
  );
  console.log(
    `  warnings:          ${metrics.breakdown.warnings.toLocaleString()}`,
  );
  console.log(
    `  other:             ${metrics.breakdown.other.toLocaleString()}`,
  );
  console.log("========================\n");
}

export function diagnosePayload(payload: any, label?: string) {
  const metrics = analyzePayload(payload);
  logPayloadMetrics(metrics, label);
  return metrics;
}
