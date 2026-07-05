export const MAX_PROJECT_TRACKS = 25;
export const MAX_PROJECT_TOTAL_DURATION_SEC = 24 * 60 * 60;
export const MAX_ANALYSIS_DURATION_SEC = 30 * 60;
export const MAX_SESSION_LOG_ENTRIES = 500;
export const MAX_SESSION_LOG_MESSAGE_CHARS = 8_000;

export function assertProjectResourceBudget(
  tracks: Array<{ durationSec?: number }>,
) {
  if (tracks.length < 2)
    throw new Error("A medley requires at least two analyzed tracks");
  if (tracks.length > MAX_PROJECT_TRACKS)
    throw new Error(
      `Project exceeds the supported ${MAX_PROJECT_TRACKS}-track limit`,
    );
  const totalDurationSec = tracks.reduce(
    (sum, track) => sum + Math.max(0, Number(track.durationSec) || 0),
    0,
  );
  if (totalDurationSec > MAX_PROJECT_TOTAL_DURATION_SEC)
    throw new Error("Project exceeds the supported total source-duration limit");
}

export function assertAnalysisDuration(durationSec: number) {
  if (!Number.isFinite(durationSec) || durationSec <= 0)
    throw new Error("Audio duration is invalid");
  if (durationSec > MAX_ANALYSIS_DURATION_SEC)
    throw new Error(
      `Audio exceeds the supported ${MAX_ANALYSIS_DURATION_SEC}-second analysis limit`,
    );
}

export function appendBoundedLog(logs: string[], message: string) {
  const bounded = message.slice(0, MAX_SESSION_LOG_MESSAGE_CHARS);
  logs.push(bounded);
  if (logs.length > MAX_SESSION_LOG_ENTRIES) {
    logs.splice(0, logs.length - MAX_SESSION_LOG_ENTRIES);
  }
}
