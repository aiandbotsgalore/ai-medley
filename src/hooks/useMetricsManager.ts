import { useState, useCallback } from 'react';
import type { ExecutionContextSummary } from '../components/ExecutionContextPanel';
import { normalizeMetrics, isTerminationThresholdMet } from '../utils/metrics';
import { EARLY_TERMINATION_SCORE } from '../constants/thresholds';
import type { CanonicalMetrics } from '../types/autonomousSession';

const CONVERGENCE_WINDOW = 4;
const CONVERGENCE_DELTA = 2;

export function useMetricsManager() {
  const [metrics, setMetrics] = useState<any>(null);

  const [iteration, setIteration] = useState<{
    current: number;
    max: number;
  } | null>(null);

  const [executionContext, setExecutionContext] =
    useState<ExecutionContextSummary | null>(null);

  const [renderProgress, setRenderProgress] = useState<{
    stage: string;
    percent: number;
    elapsedSeconds?: number;
    remainingSecondsEstimate?: number | null;
  } | null>(null);

  const [preAnalysisProgress, setPreAnalysisProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);

  const [metricsHistory, setMetricsHistory] = useState<CanonicalMetrics[]>([]);

  // Normalizes raw tool args at ingestion boundary, updates state, appends to history.
  // Returns the normalized value immediately — do not rely on React state being updated synchronously.
  const ingestMetrics = useCallback((raw: any): CanonicalMetrics => {
    const normalized = normalizeMetrics(raw) as CanonicalMetrics;
    setMetrics(normalized);
    setMetricsHistory(prev => [...prev, normalized].slice(-20));
    return normalized;
  }, []);

  // Uses EARLY_TERMINATION_SCORE from thresholds — never hardcoded.
  const shouldTerminateEarly = useCallback((overallScore: number): boolean => {
    return isTerminationThresholdMet(overallScore, EARLY_TERMINATION_SCORE);
  }, []);

  // Accepts latestMetrics so convergence is computed against current data,
  // not stale React state that does not yet include the entry just ingested.
  // Four entries are required to produce three deltas.
  const isConverged = useCallback((latestMetrics: CanonicalMetrics): boolean => {
    const combined = [...metricsHistory, latestMetrics].slice(-CONVERGENCE_WINDOW);
    if (combined.length < CONVERGENCE_WINDOW) return false;
    const deltas = combined.slice(1).map((m, i) =>
      Math.abs(m.overallScore - combined[i].overallScore)
    );
    return deltas.every(d => d < CONVERGENCE_DELTA);
  }, [metricsHistory]);

  const resetMetrics = useCallback(() => {
    setMetrics(null);
    setIteration(null);
    setExecutionContext(null);
    setRenderProgress(null);
    setPreAnalysisProgress(null);
    setMetricsHistory([]);
  }, []);

  return {
    metrics,
    setMetrics,
    iteration,
    setIteration,
    executionContext,
    setExecutionContext,
    renderProgress,
    setRenderProgress,
    preAnalysisProgress,
    setPreAnalysisProgress,
    metricsHistory,
    ingestMetrics,
    shouldTerminateEarly,
    isConverged,
    resetMetrics,
  };
}
