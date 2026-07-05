/**
 * All quality metrics in this app use a 0–100 integer scale.
 * Only call normalization at ingestion boundaries — never during rendering.
 */

export function clampMetric(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/**
 * Normalizes a raw metric value to the 0–100 scale.
 * Handles the case where the model returns a 0–1 decimal despite instructions.
 * Only call this at ingestion boundaries (tool responses, SSE events, checkpoint loading).
 */
export function normalizeMetricScore(value: unknown): number {
  const n = Number(value);
  if (!isFinite(n) || isNaN(n)) return 0;
  if (n < 0) {
    console.warn(`[metrics] Negative score (${n}) clamped to 0`);
    return 0;
  }
  if (n > 100) {
    console.warn(`[metrics] Score ${n} exceeds 100, clamped to 100`);
    return 100;
  }
  if (n > 0 && n <= 1) {
    console.warn(
      `[metrics] 0-1 scale input detected (${n}), converting to ${n * 100} — update LLM to use 0-100 scale`,
    );
    return n * 100;
  }
  return n;
}

export function assertMetricRange(value: number, name: string): number {
  const normalized = normalizeMetricScore(value);
  if (value < 0 || value > 100) {
    console.warn(
      `[metrics] Out-of-range metric "${name}": ${value}. Clamped to ${normalized}.`,
    );
  }
  return normalized;
}

export function isTerminationThresholdMet(
  overallScore: number,
  threshold = 88,
): boolean {
  return normalizeMetricScore(overallScore) >= threshold;
}

export function normalizeMetrics(raw: {
  emotionalArc: number;
  transitionSmoothness: number;
  performerIdentity: number;
  overallScore: number;
  iteration: number;
  phase?: string;
}) {
  return {
    emotionalArc: assertMetricRange(raw.emotionalArc, "emotionalArc"),
    transitionSmoothness: assertMetricRange(
      raw.transitionSmoothness,
      "transitionSmoothness",
    ),
    performerIdentity: assertMetricRange(
      raw.performerIdentity,
      "performerIdentity",
    ),
    overallScore: assertMetricRange(raw.overallScore, "overallScore"),
    iteration: raw.iteration,
    phase: raw.phase ?? "unknown",
  };
}
