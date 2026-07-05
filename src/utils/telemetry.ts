export interface IterationTelemetry {
  sessionId: string;
  iteration: number;
  phase: string;
  model: string;
  toolName?: string;
  durationMs?: number;
  metricsBefore?: number; // 0–100
  metricsAfter?: number; // 0–100
  fallbackOccurred?: boolean;
  checkpointSaved?: boolean;
  errorType?: string;
}

let telemetryBuffer: IterationTelemetry[] = [];

export function logIterationTelemetry(entry: IterationTelemetry): void {
  telemetryBuffer.push(entry);
  if (telemetryBuffer.length > 100) {
    telemetryBuffer = telemetryBuffer.slice(-100);
  }
  console.log(
    `[telemetry] iter=${entry.iteration} phase=${entry.phase} model=${entry.model}` +
      `${entry.toolName ? ` tool=${entry.toolName}` : ""}` +
      `${entry.durationMs != null ? ` dur=${entry.durationMs}ms` : ""}` +
      `${entry.metricsAfter != null ? ` score=${entry.metricsAfter}` : ""}` +
      `${entry.fallbackOccurred ? " FALLBACK" : ""}` +
      `${entry.checkpointSaved ? " CHECKPOINT" : ""}`,
  );
}

export function getTelemetryBuffer(): IterationTelemetry[] {
  return [...telemetryBuffer];
}

export function clearTelemetryBuffer(): void {
  telemetryBuffer = [];
}
