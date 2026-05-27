import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { LibraryFile } from '../components/LibrarySidebar';
import type { MedleyConfig } from '../components/ConfigPanel';
import type { CheckpointData } from '../types/checkpoint';
import type { MedleyDesignPayload } from '../engine/medleyIntelligence';
import { deriveExecutionContext } from '../engine/executionContext';
import { buildSystemPrompt, getOpenRouterTools, getToolDeclarations } from '../engine/prompts';
import { createProviderSession } from '../engine/providers';
import { analyzeAudioWithProvider } from '../engine/providers';
import {
  CONFIG_STORAGE_KEY,
  AUDIO_ANALYSIS_PROMPT,
  MAX_ITERATIONS,
  MAX_TOOL_FAILURE_STREAK,
  MAX_EVALUATE_CALLS_PER_RUN,
  MAX_LLM_CALLS_PER_RUN,
  EARLY_TERMINATION_SCORE,
  LOCAL_REJECTION_THRESHOLD,
  LOCAL_AUTO_ACCEPT_THRESHOLD,
  TOP_N_PER_SECTION,
  LLM_RETRY_MAX_ATTEMPTS,
  LLM_RETRY_BASE_DELAY_MS,
  GEMINI_MIN_CALL_INTERVAL_MS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  PRE_ANALYSIS_CONCURRENCY,
  HEALTH_CHECK_RETRIES,
  HEALTH_CHECK_DELAY_MS,
  HEALTH_CHECK_MAX_DELAY_MS,
  CHECKPOINT_DISCARD_DELAY_MS,
  SSE_TRANSITION_HEARTBEAT_MS,
} from '../constants/thresholds';
import type { ExecutionContextSummary } from '../components/ExecutionContextPanel';
import { normalizeMetricScore } from '../utils/metrics';

export type AppStatus = 'idle' | 'uploading' | 'running' | 'completed' | 'error';

interface UseAutonomousLoopOptions {
  library: LibraryFile[];
  config: MedleyConfig;
  hasProviderKey: boolean;
  fetchLibrary: () => Promise<void>;
  setLibrary: (lib: LibraryFile[]) => void;
  addLog: (msg: string) => void;
  logDetailedError: (context: string, error: any, extra?: any) => void;
}

interface UseAutonomousLoopReturn {
  status: AppStatus;
  setStatus: (s: AppStatus) => void;
  errorMessage: string | null;
  setErrorMessage: (msg: string | null) => void;
  summary: string | null;
  setSummary: (s: string | null) => void;
  metrics: any;
  setMetrics: (m: any) => void;
  sessionId: string | null;
  iteration: { current: number; max: number } | null;
  runStartedAt: number | null;
  currentPhase: string;
  executionContext: ExecutionContextSummary | null;
  activeModel: string;
  renderProgress: { stage: string; percent: number; elapsedSeconds?: number; remainingSecondsEstimate?: number | null } | null;
  preAnalysisProgress: { current: number; total: number } | null;
  medleyDesign: MedleyDesignPayload | null;
  checkpoints: CheckpointData[];
  fetchCheckpoints: () => Promise<void>;
  startMedley: () => Promise<void>;
  handleCancel: () => void;
  resumeFromCheckpoint: (checkpoint: CheckpointData) => Promise<void>;
  discardCheckpoint: (sessionId: string) => Promise<void>;
  forceModelSwitchRef: React.MutableRefObject<(() => void) | null>;
  activeModelState: string;
  setActiveModel: (m: string) => void;
  loadFromHistory: (entry: any) => void;
  cloudAnalysisPrompt: { trackName: string; respond: (choice: 'upload' | 'local' | 'upload-all' | 'local-all') => void } | null;
  reset: () => void;
}

export function useAutonomousLoop({
  library,
  config,
  hasProviderKey,
  fetchLibrary,
  setLibrary,
  addLog,
  logDetailedError,
}: UseAutonomousLoopOptions): UseAutonomousLoopReturn {
  const [status, setStatus] = useState<AppStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<any>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [iteration, setIteration] = useState<{ current: number; max: number } | null>(null);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [currentPhase, setCurrentPhaseState] = useState<string>('');
  const [executionContext, setExecutionContext] = useState<ExecutionContextSummary | null>(null);
  const [activeModel, setActiveModel] = useState<string>('');
  const [renderProgress, setRenderProgress] = useState<{ stage: string; percent: number; elapsedSeconds?: number; remainingSecondsEstimate?: number | null } | null>(null);
  const [preAnalysisProgress, setPreAnalysisProgress] = useState<{ current: number; total: number } | null>(null);
  const [medleyDesign, setMedleyDesign] = useState<MedleyDesignPayload | null>(null);
  const [checkpoints, setCheckpoints] = useState<CheckpointData[]>([]);
  const [cloudAnalysisPrompt, setCloudAnalysisPrompt] = useState<{ trackName: string; respond: (choice: 'upload' | 'local' | 'upload-all' | 'local-all') => void } | null>(null);

  // Refs for use within async loop
  const statusRef = useRef<AppStatus>('idle');
  const currentPhaseRef = useRef<string>('');
  const abortRef = useRef<AbortController | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const forceModelSwitchRef = useRef<(() => void) | null>(null);
  const batchCloudChoiceRef = useRef<'all' | 'none' | null>(null);

  useEffect(() => { statusRef.current = status; }, [status]);

  const setCurrentPhase = useCallback((phase: string) => {
    currentPhaseRef.current = phase;
    setCurrentPhaseState(phase);
  }, []);

  // ── Local Analysis ──
  const getLocalAnalysis = useCallback(async (
    payload: { fileId?: string; filePath?: string; sessionId?: string; saveToLibrary?: boolean },
    signal: AbortSignal
  ) => {
    const res = await fetch('/api/audio-analysis/local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Local audio analysis failed.');
    return data as { analysisText: string; analysis: unknown; medleyIntelligence?: unknown };
  }, []);

  const shouldUploadAudioForAnalysis = useCallback((displayName: string): Promise<boolean> => {
    if (config.audioAnalysisMode === 'cloud') return Promise.resolve(true);
    if (config.audioAnalysisMode !== 'ask') return Promise.resolve(false);
    // Honour batch choice from a previous prompt in this run
    if (batchCloudChoiceRef.current === 'all') return Promise.resolve(true);
    if (batchCloudChoiceRef.current === 'none') return Promise.resolve(false);
    return new Promise(resolve => {
      setCloudAnalysisPrompt({
        trackName: displayName,
        respond: (choice) => {
          setCloudAnalysisPrompt(null);
          if (choice === 'upload-all') { batchCloudChoiceRef.current = 'all'; resolve(true); }
          else if (choice === 'local-all') { batchCloudChoiceRef.current = 'none'; resolve(false); }
          else { resolve(choice === 'upload'); }
        },
      });
    });
  }, [config.audioAnalysisMode]);

  // ── Medley Intelligence Design ──
  const buildMedleyDesign = useCallback(async (lib: LibraryFile[], signal?: AbortSignal) => {
    const res = await fetch('/api/medley-intelligence/design', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        library: lib,
        userConstraints: {
          style: config.style,
          targetDurationMinutes: config.targetDuration,
          crossfadeDurationSeconds: config.crossfadeDuration,
          customInstructions: config.customInstructions || undefined
        }
      }),
      signal
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Medley intelligence design failed.');
    setMedleyDesign(data.design);
    return data.design as MedleyDesignPayload;
  }, [config.style, config.targetDuration, config.crossfadeDuration, config.customInstructions]);

  // ── Pre-Analyze Library ──
  const preAnalyzeLibrary = useCallback(async (lib: LibraryFile[], signal: AbortSignal): Promise<void> => {
    const unanalyzed = lib.filter(f => !f.analysis || !f.localAnalysis || !(f.localAnalysis as any)?.localAnalysisV2 || !f.medleyIntelligence);
    if (unanalyzed.length === 0) return;

    setPreAnalysisProgress({ current: 0, total: unanalyzed.length });
    setCurrentPhase('ANALYZE — Pre-analyzing Library');
    addLog(`🔬 Pre-analyzing ${unanalyzed.length} track(s) before session starts...`);

    let completedCount = 0;

    const analyzeOne = async (entry: typeof unanalyzed[0]) => {
      if (signal.aborted) return;
      addLog(`  📡 Analyzing: ${entry.originalName}`);

      try {
        const local = await getLocalAnalysis({ fileId: entry.id, saveToLibrary: true }, signal);
        let analysisText = local.analysisText;

        if (await shouldUploadAudioForAnalysis(entry.originalName)) {
          addLog(`  ☁️ Cloud audio upload allowed for ${entry.originalName}`);
          const audioRes = await fetch(`/api/audio-raw/${entry.id}`, { signal });
          if (!audioRes.ok) {
            addLog(`  ⚠️ Cloud audio fetch failed (HTTP ${audioRes.status}) for ${entry.originalName} — using local analysis only`);
          } else {
            const audioBlob = await audioRes.blob();
            const cloudAnalysisText = await analyzeAudioWithProvider({
              config,
              file: new File([audioBlob], entry.originalName, { type: entry.mimeType }),
              mimeType: entry.mimeType,
              displayName: entry.originalName,
              prompt: AUDIO_ANALYSIS_PROMPT,
              signal
            });
            analysisText = `${local.analysisText}\n\nOptional cloud audio analysis:\n${cloudAnalysisText}`;
          }
        }

        if (analysisText) {
          if (config.audioAnalysisMode !== 'local') {
            await fetch('/api/library/analysis', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fileId: entry.id, analysisText }),
              signal
            });
          }
          addLog(`  ✅ Analyzed: ${entry.originalName}`);
        }
      } catch (e: any) {
        if (e.name === 'AbortError') return;
        addLog(`  ⚠️ Pre-analysis failed for ${entry.originalName}: ${e.message}`);
      }

      completedCount++;
      setPreAnalysisProgress({ current: completedCount, total: unanalyzed.length });
    };

    for (let i = 0; i < unanalyzed.length; i += PRE_ANALYSIS_CONCURRENCY) {
      if (signal.aborted) { setPreAnalysisProgress(null); return; }
      const wave = unanalyzed.slice(i, i + PRE_ANALYSIS_CONCURRENCY);
      await Promise.all(wave.map(analyzeOne));
    }

    await fetchLibrary();
    setPreAnalysisProgress(null);
    setCurrentPhase('');
    addLog('✅ Pre-analysis complete. Handing off to Architect...');
  }, [config, getLocalAnalysis, shouldUploadAudioForAnalysis, addLog, fetchLibrary, setCurrentPhase]);

  // ── SSE Stream ──
  useEffect(() => {
    if (!sessionId) return;

    // Close any stale stream before opening a new one
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }

    const sse = new EventSource(`/api/session/${sessionId}/stream`);
    sseRef.current = sse;

    sse.addEventListener('log', (e: MessageEvent) => {
      try { const data = JSON.parse(e.data); if (data.message) addLog(`📡 ${data.message}`); }
      catch {}
    });

    sse.addEventListener('progress', (e: MessageEvent) => {
      try { setRenderProgress(JSON.parse(e.data)); } catch {}
    });

    sse.addEventListener('completed', (e: MessageEvent) => {
      try { const data = JSON.parse(e.data); if (data.summary) setSummary(data.summary); } catch {}
    });

    sse.addEventListener('metrics', (e: MessageEvent) => {
      try { setMetrics(JSON.parse(e.data)); } catch {}
    });

    sse.onerror = (err) => {
      console.warn('SSE connection error, attempting automatic reconnection...', err);
    };

    return () => {
      sse.close();
      if (sseRef.current === sse) sseRef.current = null;
    };
  }, [sessionId, addLog]);

  // ── Fetch Checkpoints ──
  const fetchCheckpoints = useCallback(async () => {
    try {
      const res = await fetch('/api/checkpoints');
      if (res.ok) setCheckpoints(await res.json());
    } catch {}
  }, []);

  useEffect(() => { fetchCheckpoints(); }, [fetchCheckpoints]);

  // ── Start Medley ──
  const startMedley = useCallback(async () => {
    if (library.length < 2) return;
    if (!hasProviderKey) {
      setStatus('error');
      setErrorMessage(config.provider === 'gemini' ? 'Add a Gemini API key in Configuration before starting.' : 'Add an OpenRouter API key in Configuration before starting.');
      return;
    }

    batchCloudChoiceRef.current = null; // Reset batch upload choice for new run
    abortRef.current = new AbortController();
    setStatus('running');
    setRunStartedAt(Date.now());
    addLog('🔍 Checking system integrity...');

    const healthSignal = abortRef.current!.signal;
    const abortSleep = (ms: number) => new Promise<void>((resolve, reject) => {
      if (healthSignal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
      const t = setTimeout(resolve, ms);
      healthSignal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    });

    let healthy = false;
    let attempts = 0;
    while (!healthy && attempts < HEALTH_CHECK_RETRIES) {
      try {
        const res = await fetch('/api/health', { signal: healthSignal });
        if (res.ok) { healthy = true; }
        else { throw new Error('Not ready'); }
      } catch (e: any) {
        if (e?.name === 'AbortError') throw e;
        attempts++;
        const jitter = Math.floor(Math.random() * 500);
        const delay = Math.min(HEALTH_CHECK_MAX_DELAY_MS, HEALTH_CHECK_DELAY_MS * Math.pow(2, attempts - 1)) + jitter;
        addLog(`⚠️ Backend warming up (Attempt ${attempts}/${HEALTH_CHECK_RETRIES}, retry in ${Math.round(delay / 1000)}s)...`);
        await abortSleep(delay);
      }
    }

    if (!healthy) {
      setErrorMessage('Backend failed to respond. Please refresh the page.');
      setStatus('error');
      return;
    }

    addLog('✅ System online. Initializing Architect...');
    addLog(`   Config snapshot: provider=${config.provider} model=${config.model} style=${config.style} target=${config.targetDuration ?? 'default'}min audioMode=${config.audioAnalysisMode}`);
    setCurrentPhase('ANALYZE — Library Analysis');
    addLog('📚 Loading library from server...');
    const freshLibForAnalysis: LibraryFile[] = await fetch('/api/library').then(r => r.json()).catch(() => library);
    setLibrary(freshLibForAnalysis);
    await preAnalyzeLibrary(freshLibForAnalysis, abortRef.current.signal);
    if (!abortRef.current || abortRef.current.signal.aborted) return;
    const freshLib: LibraryFile[] = await fetch('/api/library').then(r => r.json()).catch(() => freshLibForAnalysis);
    let design: MedleyDesignPayload | null = null;
    try {
      setCurrentPhase('DESIGN — Building Structure');
      addLog('🧠 Building Medley Intelligence match scores...');
      design = await buildMedleyDesign(freshLib, abortRef.current.signal);
      addLog(`✅ Medley Intelligence ready: ${design.recommendedStrategies.length} strategies, ${design.transitionMatrixSummary.length} transition scores.`);
    } catch (e: any) {
      addLog(`⚠️ Medley Intelligence unavailable: ${e.message}`);
    }
    setCurrentPhase('BUILD — Constructing Medley');
    runAutonomousLoop(freshLib, abortRef.current.signal, design);
  }, [library, hasProviderKey, config, addLog, preAnalyzeLibrary, setLibrary, buildMedleyDesign]);

  // ── Autonomous Loop ──
  const runAutonomousLoop = useCallback(async (lib: LibraryFile[], signal: AbortSignal, design: MedleyDesignPayload | null, resumeState?: CheckpointData) => {
    if (!hasProviderKey) {
      setErrorMessage(config.provider === 'gemini' ? 'Gemini API key is not set.' : 'OpenRouter API key is not set.');
      setStatus('error');
      return;
    }

    const sid = resumeState?.sessionId ?? Math.random().toString(36).substring(7);
    setSessionId(sid);
    sessionIdRef.current = sid;
    if (!resumeState) {
      // Clear all state for a fresh run
      setSummary(null);
      setMetrics(null);
      setIteration(null);
      setExecutionContext(null);
      setRenderProgress(null);
    } else {
      addLog(`🔁 Resuming session ${sid} from iteration ${resumeState.iterations}`);
    }

    // ── Model Fallback System ──
    const fallbackModels = (config.provider === 'gemini'
      ? [config.model, 'gemini-2.5-flash', 'gemini-2.5-pro']
      : [config.model, 'qwen/qwen3-coder:free', 'deepseek/deepseek-v4-flash:free', 'nousresearch/hermes-3-llama-3.1-405b:free', 'nvidia/nemotron-3-super-120b-a12b:free', 'meta-llama/llama-3.3-70b-instruct:free']
    ).filter((m, i, arr) => arr.indexOf(m) === i);

    let currentModelIndex = resumeState?.currentModelIndex ?? 0;
    let toolFailureStreakLocal = 0;

    let evaluateCallCount = resumeState?.evaluateCallCount ?? 0;
    let llmCallCount = resumeState?.llmCallCount ?? 0;
    let refinementPassCount = resumeState?.refinementPassCount ?? 0;
    let expensiveLLMCalls = resumeState?.expensiveLLMCalls ?? 0;
    let cheapLLMCalls = resumeState?.cheapLLMCalls ?? 0;
    let autoAcceptedCount = resumeState?.autoAcceptedCount ?? 0;
    let autoRejectedCount = resumeState?.autoRejectedCount ?? 0;

    const sectionPairCache = new Map<string, any>(resumeState?.sectionPairCacheEntries ?? []);
    const evaluationsPerFromSection = new Map<string, number>(resumeState?.evaluationsPerFromSectionEntries ?? []);

    const getCurrentModel = () => fallbackModels[Math.min(currentModelIndex, fallbackModels.length - 1)];

    const createSessionForModel = (model: string, history?: unknown[]) => {
      const tempConfig = { ...config, model };
      return createProviderSession(
        tempConfig,
        buildSystemPrompt(lib, tempConfig, design, sid),
        tempConfig.provider === 'gemini' ? getToolDeclarations() : getOpenRouterTools(),
        tempConfig.temperature,
        history
      );
    };

    let session = createSessionForModel(getCurrentModel(), resumeState?.chatHistory);
    setActiveModel(getCurrentModel());

    // Wire up force model switch
    let forceModelSwitchPending = false;
    forceModelSwitchRef.current = () => {
      if (statusRef.current === 'running') {
        forceModelSwitchPending = true;
        addLog('⚡ Manual model switch requested from header');
      }
    };

    const switchToNextModel = async (reason: string) => {
      if (currentModelIndex >= fallbackModels.length - 1) {
        addLog(`⚠️ All fallback models exhausted. Last failure reason: ${reason}`);
        return false;
      }
      const previousModel = getCurrentModel();

      // Capture history before creating new session
      let history: unknown[] | undefined;
      let historyTransferred = false;
      try {
        const h = session.getHistory();
        if (Array.isArray(h) && h.length > 0) { history = h; historyTransferred = true; }
      } catch (e) {
        addLog(`   ⚠️ Could not retrieve chat history for transfer: ${e}`);
      }

      currentModelIndex++;
      const nextModel = getCurrentModel();
      addLog(`🔄 Model switch: ${previousModel} → ${nextModel}`);
      addLog(`   Reason: ${reason} | History transfer: ${historyTransferred ? `${(history as any[]).length} turns` : 'unavailable'}`);
      setActiveModel(nextModel);
      session = createSessionForModel(nextModel, history);

      const recoveryMsg = `Model switched from ${previousModel} to ${nextModel}. Reason: ${reason}. Current phase: "${currentPhaseRef.current}". ${historyTransferred ? 'Full conversation history transferred above — continue from where we left off.' : 'No prior history available — assess current state from system prompt and continue.'} Use valid tool calls to make progress.`;
      try {
        await (_sendWithRetry ?? session.send.bind(session))(recoveryMsg);
      } catch (e) { logDetailedError('Model Switch Recovery Message', e); }

      _checkpointFn?.(); // Record updated currentModelIndex in checkpoint
      toolFailureStreakLocal = 0;
      return true;
    };

    let _checkpointFn: (() => void) | null = null;
    let _sendWithRetry: ((msg: any) => Promise<any>) | null = null;

    try {
      const withHeartbeat = <T,>(label: string, promise: Promise<T>, intervalMs = HEARTBEAT_INTERVAL_MS): Promise<T> => {
        const start = Date.now();
        const timer = setInterval(() => {
          addLog(`   ⏳ ${label}... (${Math.round((Date.now() - start) / 1000)}s elapsed)`);
        }, intervalMs);
        const abortPromise = new Promise<never>((_, rej) => {
          if (signal.aborted) return rej(new DOMException('Aborted', 'AbortError'));
          signal.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError')), { once: true });
        });
        return Promise.race([promise, abortPromise]).finally(() => clearInterval(timer));
      };

      let lastGeminiCallAt = 0;

      const sendWithRetry = async (msg: any, retries = 0): Promise<any> => {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

        // Enforce minimum inter-call interval for Gemini to avoid rate limits
        if (config.provider === 'gemini') {
          const elapsed = Date.now() - lastGeminiCallAt;
          const wait = GEMINI_MIN_CALL_INTERVAL_MS - elapsed;
          if (wait > 0 && lastGeminiCallAt > 0) {
            addLog(`   ⏱ Gemini rate-limit guard: waiting ${(wait / 1000).toFixed(1)}s before next call...`);
            await new Promise<void>((res, rej) => {
              const t = setTimeout(res, wait);
              signal.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Aborted', 'AbortError')); }, { once: true });
            });
          }
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
          lastGeminiCallAt = Date.now();
        }

        try {
          return await withHeartbeat(`Waiting for ${getCurrentModel()}`, session.send(msg), HEARTBEAT_TIMEOUT_MS);
        } catch (err: any) {
          const errText = String(err?.message || err);
          const isRateLimit = errText.includes('429') || errText.includes('RESOURCE_EXHAUSTED') || errText.includes('rate limit');
          const isPaymentError = err?.status === 402 || errText.includes('402') || errText.includes('insufficient_quota') || errText.includes('Out of credits');
          const isModelUnsupported = errText.includes('No endpoints found') || errText.includes('no endpoints found');

          if (isRateLimit && retries < LLM_RETRY_MAX_ATTEMPTS) {
            const delay = Math.pow(2, retries) * LLM_RETRY_BASE_DELAY_MS + Math.random() * 1000;
            addLog(`⏳ Rate limited on ${getCurrentModel()} (attempt ${retries + 1}/${LLM_RETRY_MAX_ATTEMPTS}). Retrying in ${Math.round(delay / 1000)}s...`);
            await new Promise<void>((res, rej) => {
              const t = setTimeout(res, delay);
              signal.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Aborted', 'AbortError')); }, { once: true });
            });
            return sendWithRetry(msg, retries + 1);
          }

          if (isPaymentError) {
            logDetailedError('LLM Send Failed (Payment Required)', err, {
              model: getCurrentModel(), provider: config.provider,
              messagePreview: typeof msg === 'string' ? msg.substring(0, 300) : '[tool results]',
              retriesAttempted: retries, note: 'This is a quota/credits issue on the free tier.'
            });
            addLog(`💳 OpenRouter 402 — This free model ran out of credits. Model: ${getCurrentModel()}`);
            const switched = await switchToNextModel(`OpenRouter returned 402 (out of credits) on model ${getCurrentModel()}`);
            if (switched) return sendWithRetry(msg, 0);
            throw err;
          }

          if (isModelUnsupported) {
            addLog(`🚫 Model "${getCurrentModel()}" is not supported or doesn't support tool calling on OpenRouter.`);
            const switched = await switchToNextModel(`OpenRouter returned 404 — model "${getCurrentModel()}" has no compatible endpoints`);
            if (switched) return sendWithRetry(msg, 0);
            throw err;
          }

          toolFailureStreakLocal++;
          logDetailedError('LLM Send Failed', err, {
            model: getCurrentModel(), provider: config.provider,
            messagePreview: typeof msg === 'string' ? msg.substring(0, 300) : '[tool results]',
            retriesAttempted: retries, toolFailureStreak: toolFailureStreakLocal
          });

          if (toolFailureStreakLocal >= MAX_TOOL_FAILURE_STREAK) {
            const switched = await switchToNextModel(`Repeated LLM failures when sending messages (${toolFailureStreakLocal} times)`);
            if (switched) return sendWithRetry(msg, 0);
          }
          throw err;
        }
      };

      const allAnalyzed = lib.every(f => f.analysis && f.medleyIntelligence);
      const initialMessage = resumeState
        ? `Session resumed from checkpoint at iteration ${resumeState.iterations}. The conversation history above contains all previous work. Please assess the current state and continue immediately from where we left off.`
        : allAnalyzed
          ? `All ${lib.length} tracks are pre-analyzed. Complete analysis and Medley Intelligence JSON for every track is already in your system prompt. IMPORTANT: Do NOT call listen_to_audio for any track — all data is already loaded. Proceed immediately to Phase 2: DESIGN. Start by studying the transitionMatrixSummary and calling evaluate_section_pair on your top candidate transitions. Target duration: ${config.targetDuration ?? 6} minutes.`
          : 'Begin the medley architect process. Analyze any tracks marked [Not yet analyzed] first, then design and build the medley.';

      let result = await sendWithRetry(initialMessage);
      llmCallCount++;
      expensiveLLMCalls++;

      if (result.usage?.total_tokens) {
        addLog(`   [Tokens] Prompt: ${result.usage.prompt_tokens ?? '?'}, Completion: ${result.usage.completion_tokens ?? '?'}, Total: ${result.usage.total_tokens}`);
      }

      let loopFinished = false;
      let iterations = resumeState?.iterations ?? 0;

      const saveCheckpoint = () => {
        const data: CheckpointData = {
          sessionId: sid, savedAt: new Date().toISOString(), provider: config.provider,
          model: getCurrentModel(), iterations, currentModelIndex, llmCallCount,
          refinementPassCount, evaluateCallCount, expensiveLLMCalls, cheapLLMCalls,
          autoAcceptedCount, autoRejectedCount, currentPhase: currentPhaseRef.current,
          design, chatHistory: session.getHistory(),
          sectionPairCacheEntries: [...sectionPairCache.entries()],
          evaluationsPerFromSectionEntries: [...evaluationsPerFromSection.entries()],
        };
        fetch('/api/checkpoint', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
        }).catch(() => {});
      };
      _checkpointFn = saveCheckpoint;
      _sendWithRetry = sendWithRetry;

      while (!loopFinished && iterations < MAX_ITERATIONS) {
        if (signal.aborted) break;

        // Immediate manual model switch
        if (forceModelSwitchPending) {
          forceModelSwitchPending = false;
          await switchToNextModel('Manual switch requested by user');
        }

        if (llmCallCount >= MAX_LLM_CALLS_PER_RUN) {
          addLog(`   ⛔ Hard limit reached: maxLLMCallsPerRun (${MAX_LLM_CALLS_PER_RUN}). The model used ${llmCallCount} LLM calls without finishing.`);
          setStatus('error');
          setErrorMessage(`LLM call limit (${MAX_LLM_CALLS_PER_RUN}) reached without producing a final medley.`);
          break;
        }

        iterations++;
        refinementPassCount++;
        setIteration({ current: iterations, max: MAX_ITERATIONS });
        if (result.text) addLog(`🤖 ${result.text}`);

        setExecutionContext(deriveExecutionContext(currentPhase, null, result.text || null, iterations));

        const functionCalls = result.functionCalls;
        if (!functionCalls || functionCalls.length === 0) {
          if (!result.text) {
            toolFailureStreakLocal++;
            addLog(`⚠️ Model returned no tool calls and no text (streak: ${toolFailureStreakLocal}/${MAX_TOOL_FAILURE_STREAK})`);
            if (toolFailureStreakLocal >= MAX_TOOL_FAILURE_STREAK) {
              const switched = await switchToNextModel(`Model returned empty responses ${toolFailureStreakLocal} times`);
              if (!switched) break;
            }
            result = await sendWithRetry('Please proceed with the next step. You must call a tool.');
            llmCallCount++;
            cheapLLMCalls++;
            if (result.usage?.total_tokens) {
              addLog(`   [Tokens] Prompt: ${result.usage.prompt_tokens ?? '?'}, Completion: ${result.usage.completion_tokens ?? '?'}, Total: ${result.usage.total_tokens}`);
            }
            continue;
          }
          toolFailureStreakLocal++;
          addLog(`⚠️ Model returned text without a tool call (streak: ${toolFailureStreakLocal}/${MAX_TOOL_FAILURE_STREAK}). May not support function calling.`);
          if (toolFailureStreakLocal >= MAX_TOOL_FAILURE_STREAK) {
            const switched = await switchToNextModel(`Model returned text-only responses ${toolFailureStreakLocal} times — likely no tool/function-calling support`);
            if (switched) {
              result = await sendWithRetry('Please continue. You must use tool calls to make progress.');
              llmCallCount++;
              cheapLLMCalls++;
              continue;
            }
          }
          break;
        }

        if (functionCalls.length > 0) {
          addLog(`   → Model requested ${functionCalls.length} tool call(s): ${functionCalls.map((c: any) => c.name).join(', ')}`);
          saveCheckpoint(); // Capture LLM response with tool calls before executing them
        }

        const toolResponses: any[] = [];

        for (const call of functionCalls) {
          addLog(`🔧 Tool: ${call.name}`);
          const args = call.args as any;
          let toolRes: any = null;

          try {
            if (call.name === 'execute_shell_command') {
              addLog(`  ➜ ${(args.command || '').substring(0, 100)}...`);
              const res = await fetch('/api/exec', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command: args.command, sessionId: sid }), signal
              });
              toolRes = { functionResponse: { name: call.name, id: call.id, response: await res.json() } };
            }
            else if (call.name === 'listen_to_audio') {
              setCurrentPhase('EVALUATE — Analyzing Audio');
              const argPath = String(args.filePath || '');
              const argBasename = argPath.split(/[\\/]/).pop()?.toLowerCase() || '';
              const entry = lib.find(f =>
                f.path === argPath || f.path.replace(/\\/g, '/') === argPath.replace(/\\/g, '/') ||
                f.originalName?.toLowerCase() === argBasename || f.filename?.toLowerCase() === argBasename ||
                f.id === argBasename.replace(/\.[^.]+$/, '')
              );
              const displayName = entry?.originalName || argBasename || 'audio-output';
              if (!entry) {
                addLog(`⚠️ listen_to_audio: no library match for "${argBasename}"`);
                addLog(`   Library (${lib.length} files): ${lib.map(f => f.originalName || f.filename || f.id).join(' | ')}`);
              }
              addLog(`  🎧 Analyzing: ${displayName}${entry ? '' : ' (no library entry — using raw path)'}`);
              const local = await getLocalAnalysis(
                entry ? { fileId: entry.id, saveToLibrary: true } : { filePath: args.filePath, sessionId: sid }, signal
              );
              if (!(await shouldUploadAudioForAnalysis(displayName))) {
                toolRes = { functionResponse: { name: call.name, id: call.id, response: { analysisText: local.analysisText, medleyIntelligence: local.medleyIntelligence, source: 'local', cloudAudioSent: false } } };
              } else {
                const audioUrl = entry ? `/api/audio-raw/${entry.id}` : `/api/audio-file?filePath=${encodeURIComponent(args.filePath)}&sessionId=${encodeURIComponent(sid)}`;
                const audioResp = await fetch(audioUrl, { signal });
                if (!audioResp.ok) {
                  addLog(`❌ Audio fetch failed for "${displayName}" — HTTP ${audioResp.status}`);
                  toolRes = { functionResponse: { name: call.name, id: call.id, response: { error: `Audio file not found or unreadable: ${args.filePath} (HTTP ${audioResp.status})` } } };
                } else {
                  addLog(`  ☁️ Cloud audio upload allowed for ${displayName}`);
                  const blob = await audioResp.blob();
                  const mimeType = entry?.mimeType || audioResp.headers.get('content-type') || 'audio/mpeg';
                  const analysisText = await analyzeAudioWithProvider({
                    config, file: new File([blob], displayName, { type: mimeType }), mimeType,
                    displayName, prompt: AUDIO_ANALYSIS_PROMPT, signal
                  });
                  toolRes = { functionResponse: { name: call.name, id: call.id, response: { analysisText, localAnalysisText: local.analysisText, medleyIntelligence: local.medleyIntelligence, source: 'cloud', cloudAudioSent: true } } };
                }
              }
            }
            else if (call.name === 'evaluate_section_pair') {
              addLog(`  🔬 Evaluating pair: ${args.fromSectionId} → ${args.toSectionId}`);
              const cacheKey = `${args.fromSectionId}:${args.toSectionId}`;
              if (sectionPairCache.has(cacheKey)) {
                addLog(`   ♻️ Cache hit for pair ${args.fromSectionId} → ${args.toSectionId}`);
                toolRes = { functionResponse: { name: call.name, id: call.id, response: sectionPairCache.get(cacheKey) } };
                continue;
              }
              const fromKey = args.fromSectionId;
              const currentCount = evaluationsPerFromSection.get(fromKey) || 0;
              if (currentCount >= TOP_N_PER_SECTION) {
                addLog(`   ⛔ Top-N=${TOP_N_PER_SECTION} limit reached for ${fromKey}. Rejecting additional candidates locally.`);
                const rejectedResponse = { success: true, locallyRejected: true, localHeuristicScore: 0.0, reason: `Top-N=${TOP_N_PER_SECTION} per source section reached` };
                sectionPairCache.set(cacheKey, rejectedResponse);
                toolRes = { functionResponse: { name: call.name, id: call.id, response: rejectedResponse } };
                continue;
              }
              evaluationsPerFromSection.set(fromKey, currentCount + 1);
              if (evaluateCallCount >= MAX_EVALUATE_CALLS_PER_RUN) {
                addLog(`   ⛔ Hard limit reached: maxEvaluateCallsPerRun (${MAX_EVALUATE_CALLS_PER_RUN}).`);
                toolRes = { functionResponse: { name: call.name, id: call.id, response: { error: 'Evaluation limit reached for this run' } } };
                continue;
              }
              evaluateCallCount++;
              cheapLLMCalls++;
              const res = await fetch('/api/section-pair-evaluate', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fromTrackId: args.fromTrackId, fromSectionId: args.fromSectionId, toTrackId: args.toTrackId, toSectionId: args.toSectionId }),
                signal
              });
              if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                addLog(`❌ evaluate_section_pair failed: ${errData.error || `HTTP ${res.status}`}`);
                toolRes = { functionResponse: { name: call.name, id: call.id, response: { error: errData.error || `HTTP ${res.status}` } } };
              } else {
                const data = await res.json();
                if (!data.error) sectionPairCache.set(cacheKey, data);
                const localScore: number | undefined = data.transition?.score;
                if (data.locallyRejected) { autoRejectedCount++; addLog(`   🚫 Locally rejected — no LLM cost.`); }
                else if (localScore !== undefined) {
                  if (localScore >= LOCAL_AUTO_ACCEPT_THRESHOLD) { autoAcceptedCount++; addLog(`   ✅ High local confidence (${localScore.toFixed(2)}) — auto-accepted.`); }
                  else if (localScore <= LOCAL_REJECTION_THRESHOLD) { autoRejectedCount++; addLog(`   🚫 Low local confidence (${localScore.toFixed(2)}) — auto-rejected.`); }
                  else { addLog(`   ⚖️ Ambiguous score (${localScore.toFixed(2)}) — proceeding with full evaluation.`); }
                }
                toolRes = { functionResponse: { name: call.name, id: call.id, response: data } };
              }
            }
            else if (call.name === 'set_design_plan') {
              addLog(`   Locking design plan: ${(args.transitions || []).length} transitions`);
              const res = await fetch('/api/session/design-plan', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: sid, plan: { transitions: args.transitions } }), signal
              });
              const data = await res.json();
              toolRes = { functionResponse: { name: call.name, id: call.id, response: data } };
            }
            else if (call.name === 'apply_musical_transition') {
              addLog(`   Applying ${args.style} transition: ${args.fromSectionId} → ${args.toSectionId}`);
              saveCheckpoint(); // Before long-running render
              const transStart = Date.now();
              const res = await withHeartbeat(
                `FFmpeg ${args.style} render (${args.fromSectionId} → ${args.toSectionId})`,
                fetch('/api/apply-transition', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ fromTrackId: args.fromTrackId, fromSectionId: args.fromSectionId, toTrackId: args.toTrackId, toSectionId: args.toSectionId, style: args.style, duration: args.duration, intensity: args.intensity, beatAlign: args.beatAlign, notes: args.notes, sessionId: sid }),
                  signal
                }), SSE_TRANSITION_HEARTBEAT_MS
              );
              const data = await res.json();
              toolRes = { functionResponse: { name: call.name, id: call.id, response: data } };
              addLog(`   ✓ Transition rendered in ${((Date.now() - transStart) / 1000).toFixed(1)}s`);
            }
            else if (call.name === 'analyze_medley_quality') {
              addLog(`   Analyzing medley quality: ${args.filePath}`);
              const res = await fetch('/api/medley-quality', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filePath: args.filePath, sessionId: sid }), signal
              });
              const data = await res.json();
              toolRes = { functionResponse: { name: call.name, id: call.id, response: data } };
            }
            else if (call.name === 'read_file') {
              const res = await fetch(`/api/file-read?filePath=${encodeURIComponent(args.filePath)}`, { signal });
              toolRes = { functionResponse: { name: call.name, id: call.id, response: await res.json() } };
            }
            else if (call.name === 'write_file') {
              const res = await fetch('/api/file-write', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filePath: args.filePath, content: args.content }), signal
              });
              toolRes = { functionResponse: { name: call.name, id: call.id, response: await res.json() } };
            }
            else if (call.name === 'save_file_analysis') {
              addLog(`  📊 Saving analysis for ${args.fileId}`);
              const res = await fetch('/api/library/analysis', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fileId: args.fileId, analysisText: args.analysisText, sessionId: sid }), signal
              });
              toolRes = { functionResponse: { name: call.name, id: call.id, response: await res.json() } };
              await fetchLibrary();
            }
            else if (call.name === 'report_progress') {
              if (args.phase) setCurrentPhase(args.phase);
              else setCurrentPhase('EVALUATE — Scoring Output');
              const normArc = normalizeMetricScore(args.emotionalArc);
              const normSmooth = normalizeMetricScore(args.transitionSmoothness);
              const normIdentity = normalizeMetricScore(args.performerIdentity);
              const normOverall = normalizeMetricScore(args.overallScore);
              const newMetrics = {
                emotionalArc: normArc, transitionSmoothness: normSmooth,
                performerIdentity: normIdentity, overallScore: normOverall,
                iteration: args.iteration, phase: args.phase || undefined
              };
              setMetrics(newMetrics);
              addLog(`  📈 Scores: Arc=${normArc.toFixed(1)}% Trans=${normSmooth.toFixed(1)}% Identity=${normIdentity.toFixed(1)}% Overall=${normOverall.toFixed(1)}%${args.phase ? ` [${args.phase}]` : ''}`);
              if (normOverall >= EARLY_TERMINATION_SCORE) {
                addLog(`   ✅ Early termination: overallScore ${normOverall.toFixed(1)} >= ${EARLY_TERMINATION_SCORE}. Stopping refinement.`);
              }
              await fetch('/api/session/metrics', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: sid, metrics: newMetrics }), signal
              });
              toolRes = { functionResponse: { name: call.name, id: call.id, response: { status: 'Metrics updated.' } } };
            }
            else if (call.name === 'finalize_medley') {
              setCurrentPhase('FINISH — Rendering Final Clean Medley');
              saveCheckpoint(); // Before long-running final render
              addLog(`  🚀 Calling finalize_medley for clean render: ${args.finalMp3Path}`);
              const finalStart = Date.now();
              const res = await withHeartbeat('FFmpeg final medley render',
                fetch('/api/finalize-medley', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ sessionId: sid, finalMp3Path: args.finalMp3Path, summary: args.summary, useCleanRender: args.useCleanRender ?? true }),
                  signal
                }), SSE_TRANSITION_HEARTBEAT_MS
              );
              const data = await res.json();
              if (!res.ok || !data.success) throw new Error(data.error || 'finalize_medley failed');
              addLog(`   ✓ Final render completed in ${((Date.now() - finalStart) / 1000).toFixed(1)}s`);
              addLog(`  ✅ Clean final medley rendered: ${data.outputPath}`);
              await fetch('/api/session/finish', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: sid, finalAudioPath: data.outputPath, summary: args.summary }), signal
              });
              fetch(`/api/checkpoint/${sid}`, { method: 'DELETE' }).catch(() => {});
              setSummary(args.summary);
              setStatus('completed');
              loopFinished = true;
              toolRes = { functionResponse: { name: call.name, id: call.id, response: data } };
            }
          } catch (e: any) {
            toolFailureStreakLocal++;
            logDetailedError(`Tool Execution: ${call.name}`, e, {
              toolName: call.name, toolId: call.id, arguments: args, model: getCurrentModel(), provider: config.provider, toolFailureStreak: toolFailureStreakLocal
            });
            toolRes = { functionResponse: { name: call.name, id: call.id, response: { error: e.message || String(e), details: e.rawBody || e.rawArguments || undefined } } };
            saveCheckpoint(); // After exception, before potential model switch
            if (toolFailureStreakLocal >= MAX_TOOL_FAILURE_STREAK) {
              await switchToNextModel(`Repeated failures calling tool "${call.name}" (${toolFailureStreakLocal} times)`);
            }
          }
          if (toolRes) toolResponses.push(toolRes);
        }

        const lastToolThisTurn = functionCalls.length > 0 ? functionCalls[functionCalls.length - 1].name : null;
        setExecutionContext(deriveExecutionContext(currentPhase, lastToolThisTurn, result.text || null, iterations));

        const anySuccess = toolResponses.some((tr: any) => !tr.functionResponse?.response?.error);
        if (toolResponses.length > 0 && !loopFinished) {
          if (anySuccess) toolFailureStreakLocal = 0;
          result = await sendWithRetry(toolResponses.map((toolResponse: any) => ({
            name: toolResponse.functionResponse.name, id: toolResponse.functionResponse.id, response: toolResponse.functionResponse.response
          })));
          llmCallCount++;
          expensiveLLMCalls++;
          if (result.usage?.total_tokens) {
            addLog(`   [Tokens] Prompt: ${result.usage.prompt_tokens ?? '?'}, Completion: ${result.usage.completion_tokens ?? '?'}, Total: ${result.usage.total_tokens}`);
          }
          saveCheckpoint();
        }
      }

      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (iterations >= MAX_ITERATIONS && !loopFinished) {
        addLog('⚠️ Max iterations reached. Stopping.');
        setStatus('error');
        setErrorMessage('Max iterations reached without completing the medley.');
      }
      addLog(`   [Phase 1/2 Final Stats] evaluateCalls=${evaluateCallCount}, llmCalls=${llmCallCount} (expensive=${expensiveLLMCalls}, cheap=${cheapLLMCalls}), refinementPasses=${refinementPassCount}, cachedPairs=${sectionPairCache.size}, autoAccepted=${autoAcceptedCount}, autoRejected=${autoRejectedCount}`);
    } catch (e: any) {
      if (e.name === 'AbortError') {
        setStatus('idle'); setRunStartedAt(null); setSessionId(null); sessionIdRef.current = null;
        setErrorMessage(null); setIteration(null); setExecutionContext(null); setSummary(null); setMetrics(null);
        return;
      }
      try { _checkpointFn?.(); } catch {}
      addLog(`💥 Loop crashed — Phase: ${currentPhaseRef.current || 'unknown'} | Model: ${config.model} | Provider: ${config.provider} | Session: ${sid}`);
      addLog(`   Error: ${e.message || String(e)}${e.status ? ` (HTTP ${e.status})` : ''}`);
      console.error('[Autonomous Loop Crashed]', { error: e, phase: currentPhaseRef.current, model: config.model, sessionId: sid });
      setStatus('error');
      setErrorMessage(e.message || 'Autonomous loop failed unexpectedly');
    } finally {
      forceModelSwitchRef.current = null;
      if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
      setRenderProgress(null);
    }
  }, [config, hasProviderKey, addLog, logDetailedError, fetchLibrary, shouldUploadAudioForAnalysis, getLocalAnalysis, setCurrentPhase]);

  // ── Cancel ──
  const handleCancel = useCallback(() => {
    const activeSid = sessionIdRef.current;
    if (activeSid) { fetch(`/api/session/${activeSid}/cancel`, { method: 'POST' }).catch(err => console.error('Failed to cancel active render process:', err)); }
    if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
    abortRef.current?.abort();
    abortRef.current = null;
    setCloudAnalysisPrompt(null); // Dismiss any pending cloud upload prompt
    batchCloudChoiceRef.current = null;
    setStatus('idle'); setRenderProgress(null); setSessionId(null); sessionIdRef.current = null;
    setErrorMessage(null); setIteration(null); setExecutionContext(null); setSummary(null); setMetrics(null);
    setTimeout(fetchCheckpoints, CHECKPOINT_DISCARD_DELAY_MS);
  }, [fetchCheckpoints]);

  // ── Resume from Checkpoint ──
  const resumeFromCheckpoint = useCallback(async (checkpoint: CheckpointData) => {
    if (status !== 'idle') return;
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('running');
    setCurrentPhase(checkpoint.currentPhase || '');
    setMedleyDesign(checkpoint.design);
    setIteration({ current: checkpoint.iterations, max: MAX_ITERATIONS });
    runAutonomousLoop(library, controller.signal, checkpoint.design, checkpoint);
  }, [status, library, runAutonomousLoop, setCurrentPhase]);

  // ── Discard Checkpoint ──
  const discardCheckpoint = useCallback(async (sid: string) => {
    await fetch(`/api/checkpoint/${sid}`, { method: 'DELETE' });
    await fetchCheckpoints();
  }, [fetchCheckpoints]);

  // ── Load from History ──
  const loadFromHistory = useCallback((entry: any) => {
    setSessionId(entry.id);
    setSummary(entry.summary);
    setMetrics(entry.metrics ?? null);
    setStatus('completed');
  }, []);

  const reset = useCallback(() => {
    setStatus('idle');
    setErrorMessage(null);
    setSummary(null);
    setMetrics(null);
    setSessionId(null);
    setIteration(null);
    setRunStartedAt(null);
    setCurrentPhaseState('');
    setExecutionContext(null);
    setActiveModel('');
    setRenderProgress(null);
    setPreAnalysisProgress(null);
    setMedleyDesign(null);
    setCheckpoints([]);
    setCloudAnalysisPrompt(null);
    statusRef.current = 'idle';
    sessionIdRef.current = null;
    currentPhaseRef.current = '';
    batchCloudChoiceRef.current = null;
  }, []);

  return {
    status, setStatus, errorMessage, setErrorMessage, summary, setSummary, metrics, setMetrics,
    sessionId, iteration, runStartedAt, currentPhase, executionContext,
    activeModel, renderProgress, preAnalysisProgress, medleyDesign,
    checkpoints, fetchCheckpoints,
    startMedley, handleCancel, resumeFromCheckpoint, discardCheckpoint,
    forceModelSwitchRef, activeModelState: activeModel, setActiveModel,
    loadFromHistory, cloudAnalysisPrompt, reset,
  };
}
