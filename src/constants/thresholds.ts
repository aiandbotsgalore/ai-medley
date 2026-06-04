// ── Storage Keys ──
export const CONFIG_STORAGE_KEY = 'ai-medley-config-v1';

// ── Audio Analysis ──
export const AUDIO_ANALYSIS_PROMPT =
  'Analyze this audio file and provide BPM if discernible, musical key, genre or mood, energy level from 1 to 10, and a concise 2 to 3 sentence structural summary. If this is a medley output, also mention any obvious transition or loudness issues.';
export const AUDIO_UPLOAD_FILE_LIMIT_MB = 50;

// ── Orchestration Loop ──
export const MAX_ITERATIONS = 50;
export const MAX_TOOL_FAILURE_STREAK = 3;
export const MAX_EVALUATE_CALLS_PER_RUN = 25;
export const MAX_LLM_CALLS_PER_RUN = 40;
export const EARLY_TERMINATION_SCORE = 88;
export const LOCAL_REJECTION_THRESHOLD = 0.45;
export const LOCAL_AUTO_ACCEPT_THRESHOLD = 0.80;
export const TOP_N_PER_SECTION = 5;

// ── Retry / Backoff ──
export const LLM_RETRY_MAX_ATTEMPTS = 5;
export const LLM_RETRY_BASE_DELAY_MS = 2000;

// ── Gemini Rate Limiting ──
// Gemini 2.5 Pro free tier: 2 RPM. Paid/developer tier: 10 RPM.
// Enforced as a minimum gap between consecutive Gemini API calls.
export const GEMINI_MIN_CALL_INTERVAL_MS = 31000; // 2 RPM free tier (one call every 30s + 1s buffer)

// ── Heartbeat ──
export const HEARTBEAT_INTERVAL_MS = 8000;
export const HEARTBEAT_TIMEOUT_MS = 10000;

// ── Pre-analysis ──
export const PRE_ANALYSIS_CONCURRENCY = 1;

// ── Health Check ──
export const HEALTH_CHECK_RETRIES = 5;
export const HEALTH_CHECK_DELAY_MS = 2000;
export const HEALTH_CHECK_MAX_DELAY_MS = 16000;

// ── Checkpoint ──
export const CHECKPOINT_DISCARD_DELAY_MS = 600;

// ── SSE ──
export const SSE_TRANSITION_HEARTBEAT_MS = 6000;