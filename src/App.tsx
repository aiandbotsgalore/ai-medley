import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, Play, Loader2, AlertCircle } from 'lucide-react';
import Header from './components/Header';
import LibrarySidebar, { type LibraryFile } from './components/LibrarySidebar';
import MetricsSidebar from './components/MetricsSidebar';
import LogPanel from './components/LogPanel';
import ConfigPanel, { type MedleyConfig, DEFAULT_CONFIG } from './components/ConfigPanel';
import ExecutionContextPanel, { type ExecutionContextSummary } from './components/ExecutionContextPanel';
import { buildSystemPrompt, getOpenRouterTools, getToolDeclarations } from './engine/prompts';
import { useSSEStream } from './hooks/useSSEStream';
import { useMetricsManager } from './hooks/useMetricsManager';
import { useSessionState } from './hooks/useSessionState';
import { useModelFallback } from './hooks/useModelFallback';
import { updateSemanticMemoryOnToolResult } from './types/semanticMemory';
import { validateCheckpoint, upgradeCheckpoint, enrichCheckpointPayload } from './utils/checkpointManager';
import { logIterationTelemetry } from './utils/telemetry';
import {
  EARLY_TERMINATION_SCORE,
  MAX_EVALUATE_CALLS_PER_RUN,
  MAX_LLM_CALLS_PER_RUN,
  MAX_TOOL_FAILURE_STREAK,
  LOCAL_REJECTION_THRESHOLD,
  LOCAL_AUTO_ACCEPT_THRESHOLD,
} from './constants/thresholds';
import { analyzeAudioWithProvider, createProviderSession } from './engine/providers';
import HistoryBrowser, { type HistoryEntry } from './components/HistoryBrowser';
import MedleyMatchPanel from './components/MedleyMatchPanel';
import type { MedleyDesignPayload } from './engine/medleyIntelligence';
import {
  runAutomaticSpecialistWorkflow,
  type AutomaticWorkflowCheckpoint,
} from './engine/specialistOrchestrator';
import {
  AutomaticWorkflowCheckpointSchema,
  MAX_CORRECTION_RETRIES,
  type SpecialistRole,
  type SpecialistStage,
} from './types/specialistWorkflow';
import {
  getProviderKey,
  getStartConfigurationError,
  migrateMedleyConfig,
} from './utils/configMigration';

type AppStatus = 'idle' | 'uploading' | 'running' | 'completed' | 'error';

type CheckpointData = {
  schemaVersion?: 2;
  sessionId: string;
  savedAt: string;
  provider: string;
  model: string;
  iterations: number;
  currentModelIndex: number;
  llmCallCount: number;
  refinementPassCount: number;
  evaluateCallCount: number;
  expensiveLLMCalls: number;
  cheapLLMCalls: number;
  autoAcceptedCount: number;
  autoRejectedCount: number;
  currentPhase: string;
  design: any | null;
  chatHistory: unknown[];
  sectionPairCacheEntries: [string, unknown][];
  evaluationsPerFromSectionEntries: [string, number][];
};
type StoredCheckpoint = CheckpointData | AutomaticWorkflowCheckpoint;
const CONFIG_STORAGE_KEY = 'ai-medley-config-v1';
const AUDIO_ANALYSIS_PROMPT = 'Analyze this audio file and provide BPM if discernible, musical key, genre or mood, energy level from 1 to 10, and a concise 2 to 3 sentence structural summary. If this is a medley output, also mention any obvious transition or loudness issues.';

/**
 * Pure function. Translates the last observed tool + phase + reasoning into
 * a human-friendly 4-question summary. Called after every meaningful step
 * in the orchestration loop. Never mutates state or calls tools.
 * (Interface is defined in ExecutionContextPanel.tsx and re-exported for consumers.)
 */
function deriveExecutionContext(
  phase: string,
  lastTool: string | null,
  lastReasoning: string | null,
  _iteration: number
): ExecutionContextSummary {
  const p = (phase || 'Initializing').trim();
  const tool = (lastTool || '').toLowerCase();
  const reasoningSnippet = lastReasoning ? lastReasoning.replace(/\s+/g, ' ').trim().slice(0, 160) : '';

  // Strong defaults
  let ctx: ExecutionContextSummary = {
    phase: p || 'AGENT LOOP',
    currentAction: 'Advancing the autonomous medley generation process',
    rationale: 'The agent follows a structured multi-phase loop (analyze → design → build → evaluate → refine → finish) to produce a musically coherent result.',
    impact: 'Each step contributes data or decisions that improve the quality and seamlessness of the final medley.',
    nextStep: 'The model will decide the next tool call or conclude the process.'
  };

  if (tool.includes('listen_to_audio') || p.toUpperCase().includes('ANALYZE')) {
    ctx = {
      phase: p || 'ANALYZE',
      currentAction: 'Performing deep analysis of a track’s waveform, energy, tempo, silence map, and timbral character',
      rationale: 'No creative decisions can be trustworthy without objective sonic facts about every piece of source material.',
      impact: 'This data powers the transition scoring matrix, recommended section candidates, and every later timing decision.',
      nextStep: 'The agent will evaluate promising section pairs or load more cached analyses.'
    };
  } else if (tool.includes('evaluate_section_pair')) {
    ctx = {
      phase: p || 'DESIGN',
      currentAction: 'Scoring how musically compatible two specific sections are for a direct join',
      rationale: 'Raw energy or key data is not enough — only direct compatibility testing reveals which pairs will actually feel seamless.',
      impact: 'Only high-scoring pairs are allowed into the final locked design plan, dramatically reducing the chance of weak transitions.',
      nextStep: 'Once enough pairs are scored the agent will call set_design_plan to lock the authoritative structure.'
    };
  } else if (tool.includes('set_design_plan')) {
    ctx = {
      phase: 'DESIGN — STRUCTURE LOCKED',
      currentAction: 'Committing to a final ordered sequence of sections and exact transition points',
      rationale: 'After objective evaluation the agent now has enough confidence to freeze one concrete architecture for the rest of the run.',
      impact: 'All future preview renders and the final single-pass render will use these exact timings and this exact ordering.',
      nextStep: 'The agent will render real musical preview crossfades (apply_musical_transition) for the locked joins so you can audition them.'
    };
  } else if (tool.includes('apply_musical_transition')) {
    ctx = {
      phase: p || 'BUILD',
      currentAction: 'Rendering a high-quality preview crossfade for one locked transition using style-aware DSP and beat alignment',
      rationale: 'The only reliable way to know whether a paper plan actually sounds good is to hear the real audio join.',
      impact: 'The precise actual exit/entry timestamps returned (post beat-snap) become the authoritative values used in the final clean render.',
      nextStep: 'After auditioning transitions the agent will either refine or call finalize_medley for the production master.'
    };
  } else if (tool.includes('analyze_medley_quality') || tool.includes('report_progress')) {
    ctx = {
      phase: p || 'EVALUATE / REFINE',
      currentAction: 'Measuring the current draft against hard quality metrics (loudness, smoothness, emotional arc, identity)',
      rationale: 'Human ears are biased. Objective numbers tell the agent exactly which dimensions are still weak.',
      impact: 'Low scores directly drive the next targeted refinement actions instead of random guessing.',
      nextStep: 'The agent will either perform a focused refinement or decide the current version is ready for final rendering.'
    };
  } else if (tool.includes('finalize_medley')) {
    ctx = {
      phase: 'FINISH — PRODUCTION RENDER',
      currentAction: 'Executing the single deterministic final render from original sources only (sequential atrim + acrossfade chain + one master loudnorm + limiter)',
      rationale: 'This is the authoritative, gap-free, timing-accurate production file. It never uses any pre-rendered preview assets.',
      impact: 'This is the finished downloadable medley that represents the complete artistic vision.',
      nextStep: 'Process complete. The final file is ready for playback and export.'
    };
  } else if (tool.includes('finish_medley')) {
    ctx.currentAction = 'Persisting the completed medley and surfacing the final summary';
    ctx.nextStep = 'You can now listen and download the result.';
  } else if (tool.includes('execute_shell')) {
    ctx = {
      phase: p,
      currentAction: 'Executing a direct low-level command (usually FFmpeg or file I/O) in the session work directory',
      rationale: 'Some operations still require direct shell access when no specialized tool exists for that exact step.',
      impact: 'These commands are in service of the current phase (analysis, preview, or final export).',
      nextStep: 'The command result is returned to the model so it can continue reasoning.'
    };
  }

  if (reasoningSnippet.length > 25) {
    ctx.rationale = `${ctx.rationale} Recent model note: “${reasoningSnippet}${lastReasoning && lastReasoning.length > 160 ? '…”' : '”'}`;
  }

  if (p) ctx.phase = p;
  return ctx;
}

export default function App() {
  const [library, setLibrary] = useState<LibraryFile[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<AppStatus>('idle');

  // Keep statusRef in sync for use inside async runAutonomousLoop
  const statusRef = useRef<AppStatus>('idle');
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const metricsManager = useMetricsManager();
  const sessionManager = useSessionState();
  const [config, setConfig] = useState<MedleyConfig>(DEFAULT_CONFIG);

  const [configLoaded, setConfigLoaded] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'workshop' | 'history'>('workshop');
  const currentPhaseRef = useRef<string>('');
  const setCurrentPhase = useCallback((phase: string) => {
    currentPhaseRef.current = phase;
    sessionManager.updatePhase(phase);
  }, [sessionManager]);
  const modelFallback = useModelFallback(config);
  const [checkpoints, setCheckpoints] = useState<StoredCheckpoint[]>([]);
  const [specialistModel, setSpecialistModel] = useState<string>('');
  const [specialistRole, setSpecialistRole] = useState<SpecialistRole | null>(null);
  const activeRequestSequenceRef = useRef(0);

  // Used for manual "Force Model Switch" button from the header
  const forceModelSwitchRef = useRef<(() => void) | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { connect: connectSSE, disconnect: disconnectSSE } = useSSEStream();
  const sessionIdRef = useRef<string | null>(null);

  const addLog = useCallback((msg: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  // Rich error logger - designed to make debugging failures (especially with free/weak models) much easier
  const logDetailedError = useCallback((context: string, error: any, extra?: any) => {
    const timestamp = new Date().toLocaleTimeString();
    const errMessage = error?.message || String(error);
    const status = error?.status;
    const rawBody = error?.rawBody;
    const rawArguments = error?.rawArguments;

    let logMessage = `❌ [${context}] ${errMessage}`;

    if (status) logMessage += ` | Status: ${status}`;
    if (rawBody) logMessage += `\n   Raw response: ${typeof rawBody === 'string' ? rawBody.substring(0, 800) : JSON.stringify(rawBody)}`;
    if (rawArguments) logMessage += `\n   Raw tool args: ${rawArguments}`;
    if (extra) {
      try {
        const extraStr = typeof extra === 'string' ? extra : JSON.stringify(extra, null, 2);
        logMessage += `\n   Extra context: ${extraStr.substring(0, 1200)}`;
      } catch {}
    }

    // Also log full error to browser console for deeper inspection
    console.error(`[DETAILED ERROR - ${context}]`, { error, extra, rawBody, rawArguments });

    addLog(logMessage);
  }, [addLog]);

  const fetchLibrary = useCallback(async () => {
    try {
      const res = await fetch('/api/library');
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        setLibrary(await res.json());
      }
    } catch (e) {
      console.error('Library fetch error:', e);
    }
  }, []);

  useEffect(() => {
    fetchLibrary();
  }, [fetchLibrary]);

  const fetchCheckpoints = useCallback(async () => {
    try {
      const res = await fetch('/api/checkpoints');
      if (res.ok) setCheckpoints(await res.json());
    } catch {}
  }, []);

  useEffect(() => { fetchCheckpoints(); }, [fetchCheckpoints]);

  useEffect(() => {
    let cancelled = false;

    const loadConfig = async () => {
      try {
        const rawStored = localStorage.getItem(CONFIG_STORAGE_KEY);
        const storedConfig = rawStored ? JSON.parse(rawStored) : {};
        const serverConfig = await fetch('/api/config').then(r => r.json()).catch(() => ({}));
        const nextConfig = migrateMedleyConfig(storedConfig, serverConfig);

        if (!cancelled) {
          setConfig(nextConfig);
        }
      } catch (e) {
        console.error('Config load error:', e);
      } finally {
        if (!cancelled) {
          setConfigLoaded(true);
        }
      }
    };

    loadConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!configLoaded) return;
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
  }, [config, configLoaded]);

  // Prevent page-level drag/drop
  useEffect(() => {
    const prevent = (e: Event) => e.preventDefault();
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => { window.removeEventListener('dragover', prevent); window.removeEventListener('drop', prevent); };
  }, []);

  const uploadToLibrary = async (newFiles: File[]) => {
    if (newFiles.length === 0) return;
    setStatus('uploading');
    setErrorMessage(null);
    setUploadProgress({ current: 0, total: newFiles.length });
    try {
      let count = 0;
      for (const f of newFiles) {
        const formData = new FormData();
        formData.append('files', f);
        const res = await fetch('/api/library', { method: 'POST', body: formData });
        if (!res.ok) throw new Error(await res.text() || res.statusText);
        count++;
        setUploadProgress({ current: count, total: newFiles.length });
        await fetchLibrary();
      }
      setUploadProgress(null);
      setStatus('idle');
    } catch (e: any) {
      setUploadProgress(null);
      setStatus('error');
      let msg = e.message;
      if (msg.includes('413') || msg.toLowerCase().includes('payload too large')) {
        msg = 'File exceeds the 50MB server limit.';
      }
      setErrorMessage(msg);
    }
  };

  const removeFile = async (id: string) => {
    await fetch(`/api/library/${id}`, { method: 'DELETE' });
    await fetchLibrary();
  };

  const reorderLibrary = async (ids: string[]) => {
    // Optimistic update
    const reordered = ids.map(id => library.find(f => f.id === id)).filter(Boolean) as LibraryFile[];
    setLibrary(reordered);
    await fetch('/api/library/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds: ids })
    });
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFiles = Array.from(e.dataTransfer.files as FileList);
    if (droppedFiles.length > 0) {
      uploadToLibrary(droppedFiles.filter(file => file.type.startsWith('audio/')));
    }
  };

  const activeApiKey = getProviderKey(config);
  const hasProviderKey = Boolean(activeApiKey);

  const shouldUploadAudioForAnalysis = (displayName: string) => {
    if (config.audioAnalysisMode === 'cloud') return true;
    if (config.audioAnalysisMode === 'ask') {
      return window.confirm(`Upload "${displayName}" to ${config.provider === 'gemini' ? 'Gemini' : 'OpenRouter'} for deeper audio analysis? Local analysis will be used if you choose Cancel.`);
    }
    return false;
  };

  const getLocalAnalysis = async (payload: { fileId?: string; filePath?: string; sessionId?: string; saveToLibrary?: boolean }, signal: AbortSignal) => {
    const res = await fetch('/api/audio-analysis/local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Local audio analysis failed.');
    return data as { analysisText: string; analysis: unknown; medleyIntelligence?: unknown };
  };

  const buildMedleyDesign = async (lib: LibraryFile[], signal?: AbortSignal) => {
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
    sessionManager.updateDesign(data.design);
    return data.design as MedleyDesignPayload;
  };

  // ── Autonomous Medley Loop ──
  const runAutonomousLoop = async (lib: LibraryFile[], signal: AbortSignal, design: MedleyDesignPayload | null, resumeState?: CheckpointData) => {
    if (!hasProviderKey) {
      setErrorMessage(config.provider === 'gemini' ? 'Gemini API key is not set.' : 'OpenRouter API key is not set.');
      setStatus('error');
      return;
    }

    const sid = resumeState?.sessionId ?? Math.random().toString(36).substring(7);
    setSessionId(sid);
    sessionIdRef.current = sid;
    if (!resumeState) {
      setLogs([]);
      setSummary(null);
      metricsManager.resetMetrics();
    } else {
      addLog(`🔁 Resuming session ${sid} from iteration ${resumeState.iterations}`);
    }

    // === Real-Time Progress Stream (SSE) ===
    connectSSE(sid, {
      onLog: (message) => addLog(`📡 ${message}`),
      onProgress: (data) => metricsManager.setRenderProgress(data),
      onMetrics: (data) => metricsManager.setMetrics(data),
      onCompleted: (data) => { if (data.summary) setSummary(data.summary); },
    });

    // === Phase 1 Hard Limits (Optimization + Stabilization) ===
    const MAX_LOOP_TURNS = 10; // counts every assistant/tool round-trip, not just refinement turns

    // Stability guards
    const recentToolCallHashes = new Set<string>();
    const MAX_TOOL_HASH_MEMORY = 20;

    let evaluateCallCount = resumeState?.evaluateCallCount ?? 0;
    let llmCallCount = resumeState?.llmCallCount ?? 0;
    let refinementPassCount = resumeState?.refinementPassCount ?? 0;
    let expensiveLLMCalls = resumeState?.expensiveLLMCalls ?? 0;   // generation / complex reasoning
    let cheapLLMCalls = resumeState?.cheapLLMCalls ?? 0;           // classification / simple scoring

    // Phase 2 stats
    let autoAcceptedCount = resumeState?.autoAcceptedCount ?? 0;
    let autoRejectedCount = resumeState?.autoRejectedCount ?? 0;

    // Simple in-session cache for section pair evaluations (fromSectionId + toSectionId)
    const sectionPairCache = new Map<string, any>(resumeState?.sectionPairCacheEntries ?? []);

    // Phase 1: Per-source-section Top-N=5 tracking (in-session)
    const evaluationsPerFromSection = new Map<string, number>(resumeState?.evaluationsPerFromSectionEntries ?? []);

    // Hoisted so switchToNextModel can reference it before the try block defines saveCheckpoint.
    let _checkpointFn: (() => void) | undefined;

    let session = modelFallback.createSessionForModel(modelFallback.getCurrentModel(), lib, design, sid, resumeState?.chatHistory);
    modelFallback.setActiveModel(modelFallback.getCurrentModel());
    sessionManager.initSession(sid, modelFallback.getCurrentModel());

    // Wire up manual force switch from header
    forceModelSwitchRef.current = () => {
      if (statusRef.current === 'running') {
        modelFallback.requestForceModelSwitch();
        addLog('⚡ Manual model switch requested from header');
      }
    };

    // Window helpers for console-driven model navigation
    (window as any).switchModelBack = () => modelFallback.switchToPreviousModel(addLog);
    (window as any).resetModel = () => modelFallback.resetToPrimaryModel(addLog);

    const switchToNextModel = async (reason: string) => {
      const switched = await modelFallback.switchToNextModel(reason, {
        lib,
        design: sessionManager.design,
        sid,
        semanticMemory: sessionManager.sessionState?.semanticMemory,
        currentPhase: currentPhaseRef.current,
        checkpointFn: () => _checkpointFn?.(),
        addLog,
      });
      if (switched) {
        session = modelFallback.getSession();
        logIterationTelemetry({ sessionId: sid, iteration: 0, phase: currentPhaseRef.current, model: modelFallback.getCurrentModel(), fallbackOccurred: true });
      }
      return switched;
    };

    try {

      const sendWithRetry = async (msg: any, retries = 0): Promise<any> => {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        try {
          return await session.send(msg);
        } catch (err: any) {
          const errText = String(err?.message || err);
          const isRateLimit = errText.includes('429') || errText.includes('RESOURCE_EXHAUSTED') || errText.includes('rate limit');
          const isPaymentError = err?.status === 402 || errText.includes('402') || errText.includes('insufficient_quota') || errText.includes('Out of credits');
          const isModelUnsupported = errText.includes('No endpoints found') || errText.includes('no endpoints found');

          if (isRateLimit && retries < 5) {
            const delay = Math.pow(2, retries) * 2000 + Math.random() * 1000;
            addLog(`⏳ Rate limited. Retrying in ${Math.round(delay / 1000)}s...`);
            await new Promise<void>((res, rej) => {
              const t = setTimeout(res, delay);
              signal.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Aborted', 'AbortError')); }, { once: true });
            });
            return sendWithRetry(msg, retries + 1);
          }

          // Special handling for 402 (payment / credits exhausted) on free models
          if (isPaymentError) {
            const currentModel = modelFallback.getCurrentModel();
            logDetailedError('LLM Send Failed (Payment Required)', err, {
              model: currentModel,
              provider: config.provider,
              messagePreview: typeof msg === 'string' ? msg.substring(0, 300) : '[tool results]',
              retriesAttempted: retries,
              note: 'This is a quota/credits issue on the free tier, not a model intelligence problem.'
            });

            addLog(`💳 OpenRouter 402 — This free model ran out of credits.`);
            addLog(`   Model: ${currentModel}`);
            addLog(`   Recommendation: Switch to a different free model or use a paid API key with quota.`);

            // Immediately try to switch to next model instead of waiting for streak
            const switched = await switchToNextModel(`OpenRouter returned 402 (out of credits) on model ${currentModel}`);
            if (switched) {
              return sendWithRetry(msg, 0);
            }

            throw err;
          }

          // Model doesn't exist or doesn't support tool calling on OpenRouter
          if (isModelUnsupported) {
            const currentModel = modelFallback.getCurrentModel();
            addLog(`🚫 Model "${currentModel}" is not supported or doesn't support tool calling on OpenRouter.`);
            addLog(`   Switching to next fallback model…`);
            const switched = await switchToNextModel(`OpenRouter returned 404 — model "${currentModel}" has no compatible endpoints`);
            if (switched) {
              return sendWithRetry(msg, 0);
            }
            throw err;
          }

          // Normal non-rate-limit failure
          const streak1 = modelFallback.incrementToolFailure();
          logDetailedError('LLM Send Failed', err, {
            model: modelFallback.getCurrentModel(),
            provider: config.provider,
            messagePreview: typeof msg === 'string' ? msg.substring(0, 300) : '[tool results]',
            retriesAttempted: retries,
            toolFailureStreak: streak1
          });

          if (modelFallback.toolFailureStreakRef.current >= MAX_TOOL_FAILURE_STREAK) {
            const switched = await switchToNextModel(`Repeated LLM failures when sending messages (${streak1} times)`);
            if (switched) {
              return sendWithRetry(msg, 0);
            }
          }

          throw err;
        }
      };

      const initialMessage = resumeState
        ? `Session resumed from checkpoint at iteration ${resumeState.iterations}. The conversation history above contains all previous work. Please assess the current state and continue immediately from where we left off.`
        : 'Begin the medley architect process. Analyze the library first, then design and build the medley.';

      let result = await sendWithRetry(initialMessage);
      llmCallCount++;
      expensiveLLMCalls++;

      if (result.usage?.total_tokens) {
        addLog(`   [Tokens] Prompt: ${result.usage.prompt_tokens ?? '?'}, Completion: ${result.usage.completion_tokens ?? '?'}, Total: ${result.usage.total_tokens}`);
      }

      let loopFinished = false;
      let iterations = resumeState?.iterations ?? 0;
      const MAX_ITERATIONS = 50;

      // Fire-and-forget checkpoint save — called after each completed model round-trip.
      // Closes over `iterations`, `session`, and all counters as live bindings.
      const saveCheckpoint = () => {
        const data: CheckpointData = {
          sessionId: sid,
          savedAt: new Date().toISOString(),
          provider: config.provider,
          model: modelFallback.getCurrentModel(),
          iterations,
          currentModelIndex: modelFallback.currentModelIndexRef.current,
          llmCallCount,
          refinementPassCount,
          evaluateCallCount,
          expensiveLLMCalls,
          cheapLLMCalls,
          autoAcceptedCount,
          autoRejectedCount,
          currentPhase: currentPhaseRef.current,
          design: sessionManager.design,
          chatHistory: session.getHistory(),
          sectionPairCacheEntries: [...sectionPairCache.entries()],
          evaluationsPerFromSectionEntries: [...evaluationsPerFromSection.entries()],
        };
        const enriched = enrichCheckpointPayload(data, sessionManager.sessionState?.semanticMemory, metricsManager.metrics);
        fetch('/api/checkpoint', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(enriched)
        }).catch(() => {});
        logIterationTelemetry({ sessionId: sid, iteration: iterations, phase: currentPhaseRef.current, model: modelFallback.getCurrentModel(), checkpointSaved: true });
      };
      _checkpointFn = saveCheckpoint; // wire hoisted ref so switchToNextModel can call it

      while (!loopFinished && iterations < MAX_ITERATIONS) {
        if (signal.aborted) break;

        // === Immediate manual model switch (from SWITCH MODEL button) ===
        if (modelFallback.isForceModelSwitchPending()) {
          await switchToNextModel('Manual switch requested by user');
        }

        // === Phase 1 Hard Limits (checked BEFORE incrementing) ===
        if (refinementPassCount >= MAX_LOOP_TURNS) {
          addLog(`⛔ Hard limit: maxLoopTurns (${MAX_LOOP_TURNS}) reached at iteration ${iterations}. Completed: ${evaluateCallCount} evaluations, ${refinementPassCount} turns. Phase at stop: ${currentPhaseRef.current}. Stopping.`);
          break;
        }
        if (llmCallCount >= MAX_LLM_CALLS_PER_RUN) {
          addLog(`⛔ Hard limit: MAX_LLM_CALLS_PER_RUN (${MAX_LLM_CALLS_PER_RUN}) reached at iteration ${iterations}. Completed: ${evaluateCallCount} evaluations, ${refinementPassCount} refinements. Phase at stop: ${currentPhaseRef.current}. Stopping.`);
          break;
        }

        iterations++;
        refinementPassCount++;
        logIterationTelemetry({ sessionId: sid, iteration: iterations, phase: currentPhaseRef.current, model: modelFallback.getCurrentModel() });

        metricsManager.setIteration({ current: iterations, max: MAX_ITERATIONS });
        if (result.text) addLog(`🤖 ${result.text}`);

        // Update the pure derived execution context layer (UI only, after every model turn)
        metricsManager.setExecutionContext(deriveExecutionContext(currentPhaseRef.current, null, result.text || null, iterations));

        const functionCalls = result.functionCalls;
        if (!functionCalls || functionCalls.length === 0) {
          if (!result.text) {
            // Completely empty response — count as failure and nudge
            const streak2 = modelFallback.incrementToolFailure();
            addLog(`⚠️ Model returned no tool calls and no text (streak: ${streak2}/${MAX_TOOL_FAILURE_STREAK})`);
            if (modelFallback.toolFailureStreakRef.current >= MAX_TOOL_FAILURE_STREAK) {
              const switched = await switchToNextModel(`Model returned empty responses ${streak2} times`);
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
          // Text-only response with no tool call — this model may not support function calling.
          // Count toward streak so repeated text-only outputs trigger a model switch.
          const streak3 = modelFallback.incrementToolFailure();
          addLog(`⚠️ Model returned text without a tool call (streak: ${streak3}/${MAX_TOOL_FAILURE_STREAK}). May not support function calling.`);
          if (modelFallback.toolFailureStreakRef.current >= MAX_TOOL_FAILURE_STREAK) {
            const switched = await switchToNextModel(`Model returned text-only responses ${streak3} times — likely no tool/function-calling support`);
            if (switched) {
              result = await sendWithRetry('Please continue. You must use tool calls to make progress.');
              llmCallCount++;
              cheapLLMCalls++;
              continue;
            }
          }
          break;
        }

        // Extra visibility when using weaker free models
        if (functionCalls.length > 0) {
          addLog(`   → Model requested ${functionCalls.length} tool call(s): ${functionCalls.map((c: any) => c.name).join(', ')}`);
        }

        const toolResponses: any[] = [];

        for (const call of functionCalls) {
          addLog(`🔧 Tool: ${call.name}`);
          const args = call.args as any;
          let toolRes: any = null;

          // Duplicate tool call detection
          const toolHash = `${call.name}:${JSON.stringify(call.args ?? {})}`;
          if (recentToolCallHashes.has(toolHash)) {
            addLog(`⚠️ Duplicate tool call detected: ${call.name} — returning early-exit result.`);
            toolRes = { functionResponse: { name: call.name, id: call.id, response: { status: 'This exact call was already made this session. Do not repeat it — advance to the next step.' } } };
            if (toolRes) toolResponses.push(toolRes);
            continue;
          }
          recentToolCallHashes.add(toolHash);
          if (recentToolCallHashes.size > MAX_TOOL_HASH_MEMORY) {
            recentToolCallHashes.delete(recentToolCallHashes.values().next().value!);
          }

          const toolStartMs = Date.now();
          try {
            if (call.name === 'execute_shell_command') {
              const cmd = (args.command || '').toLowerCase();
              const isRenderAttempt = /ffmpeg|filter_complex|concat|medley_final|\.mp3|atempo|amerge|amix|aconcat|final\s*render|export|finalize/.test(cmd);
              if (isRenderAttempt) {
                addLog(`  🚫 Blocked manual render shell command — use finalize_medley`);
                toolRes = {
                  functionResponse: {
                    name: call.name, id: call.id,
                    response: {
                      error: 'Manual shell rendering is disabled. The final medley MP3 must be produced by calling finalize_medley after set_design_plan, apply_musical_transition, and report_progress. Do not use execute_shell_command for audio rendering.'
                    }
                  }
                };
              } else {
                addLog(`  ➜ ${(args.command || '').substring(0, 100)}...`);
                const res = await fetch('/api/exec', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ command: args.command, sessionId: sid }),
                  signal
                });
                const data = await res.json();
                toolRes = { functionResponse: { name: call.name, id: call.id, response: data } };
              }
            }
            else if (call.name === 'listen_to_audio') {
              setCurrentPhase('EVALUATE — Analyzing Audio');
              const argPath = String(args.filePath || '');
              const argBasename = argPath.split(/[\\/]/).pop()?.toLowerCase() || '';
              const entry = lib.find(f =>
                f.path === argPath ||
                f.path.replace(/\\/g, '/') === argPath.replace(/\\/g, '/') ||
                f.originalName?.toLowerCase() === argBasename ||
                f.filename?.toLowerCase() === argBasename ||
                f.id === argBasename.replace(/\.[^.]+$/, '')
              );
              const displayName = entry?.originalName || argBasename || 'audio-output';

              addLog(`  🎧 Analyzing: ${displayName}`);

              const local = await getLocalAnalysis(
                entry
                  ? { fileId: entry.id, saveToLibrary: true }
                  : { filePath: args.filePath, sessionId: sid },
                signal
              );

              if (!shouldUploadAudioForAnalysis(displayName)) {
                toolRes = {
                  functionResponse: {
                    name: call.name,
                    id: call.id,
                    response: {
                      analysisText: local.analysisText,
                      medleyIntelligence: local.medleyIntelligence,
                      source: 'local',
                      cloudAudioSent: false
                    }
                  }
                };
              } else {
                const audioUrl = entry
                  ? `/api/audio-raw/${entry.id}`
                  : `/api/audio-file?filePath=${encodeURIComponent(args.filePath)}&sessionId=${encodeURIComponent(sid)}`;
                const audioResp = await fetch(audioUrl, { signal });
                if (!audioResp.ok) {
                  toolRes = {
                    functionResponse: {
                      name: call.name,
                      id: call.id,
                      response: { error: `Audio file not found or unreadable: ${args.filePath}` }
                    }
                  };
                } else {
                  addLog(`  ☁️ Cloud audio upload allowed for ${displayName}`);
                  const blob = await audioResp.blob();
                  const mimeType = entry?.mimeType || audioResp.headers.get('content-type') || 'audio/mpeg';
                  const analysisText = await analyzeAudioWithProvider({
                    config,
                    file: new File([blob], displayName, { type: mimeType }),
                    mimeType,
                    displayName,
                    prompt: AUDIO_ANALYSIS_PROMPT,
                    signal
                  });
                  toolRes = {
                    functionResponse: {
                      name: call.name,
                      id: call.id,
                      response: {
                        analysisText,
                        localAnalysisText: local.analysisText,
                        medleyIntelligence: local.medleyIntelligence,
                        source: 'cloud',
                        cloudAudioSent: true
                      }
                    }
                  };
                }
              }
            }
            else if (call.name === 'evaluate_section_pair') {
              addLog(`  🔬 Evaluating pair: ${args.fromSectionId} → ${args.toSectionId}`);

              // === Phase 1: In-session cache + hard limits + Top-N + local rejection ===
              const cacheKey = `${args.fromSectionId}:${args.toSectionId}`;
              if (sectionPairCache.has(cacheKey)) {
                addLog(`   ♻️ Cache hit for pair ${args.fromSectionId} → ${args.toSectionId}`);
                toolRes = { functionResponse: { name: call.name, id: call.id, response: sectionPairCache.get(cacheKey) } };
                continue;
              }

              // Per-fromSection Top-N=5 tracking (Phase 1)
              const fromKey = args.fromSectionId;
              const currentCount = evaluationsPerFromSection.get(fromKey) || 0;
              if (currentCount >= 5) {
                addLog(`   ⛔ Top-N=5 limit reached for ${fromKey}. Rejecting additional candidates locally.`);
                const rejectedResponse = { 
                  success: true, 
                  locallyRejected: true, 
                  localHeuristicScore: 0.0,
                  reason: 'Top-N=5 per source section reached' 
                };
                sectionPairCache.set(cacheKey, rejectedResponse);
                toolRes = { functionResponse: { name: call.name, id: call.id, response: rejectedResponse } };
                continue;
              }
              evaluationsPerFromSection.set(fromKey, currentCount + 1);

              if (evaluateCallCount >= MAX_EVALUATE_CALLS_PER_RUN) {
                addLog(`⛔ Hard limit: MAX_EVALUATE_CALLS_PER_RUN (${MAX_EVALUATE_CALLS_PER_RUN}) reached at iteration ${iterations}. Completed: ${evaluateCallCount} evaluations, ${refinementPassCount} refinements. Phase at stop: ${currentPhaseRef.current}. Rejecting further evaluations.`);
                toolRes = { functionResponse: { name: call.name, id: call.id, response: { error: 'Evaluation limit reached for this run' } } };
                continue;
              }

              evaluateCallCount++;
              cheapLLMCalls++;

              const res = await fetch('/api/section-pair-evaluate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  fromTrackId: args.fromTrackId,
                  fromSectionId: args.fromSectionId,
                  toTrackId: args.toTrackId,
                  toSectionId: args.toSectionId
                }),
                signal
              });
              const data = await res.json();

              // Store in in-session cache (even rejections for this run)
              if (!data.error) {
                sectionPairCache.set(cacheKey, data);
              }

              if (data.locallyRejected) {
                autoRejectedCount++;
                addLog(`   🚫 Locally rejected (score ${data.localHeuristicScore?.toFixed(2) ?? 'low'}) — no LLM cost.`);
              } else if (data.localHeuristicScore !== undefined) {
                const score = data.localHeuristicScore;
                if (score >= LOCAL_AUTO_ACCEPT_THRESHOLD) {
                  autoAcceptedCount++;
                  addLog(`   ✅ High local confidence (${score.toFixed(2)}) — auto-accepted locally (ambiguous-only routing).`);
                } else if (score <= LOCAL_REJECTION_THRESHOLD) {
                  autoRejectedCount++;
                  addLog(`   🚫 Low local confidence (${score.toFixed(2)}) — auto-rejected locally.`);
                } else {
                  addLog(`   ⚖️ Ambiguous local score (${score.toFixed(2)}) — proceeding with full evaluation.`);
                }
              }

              toolRes = { functionResponse: { name: call.name, id: call.id, response: data } };
            }
            else if (call.name === 'set_design_plan') {
              addLog(`   Locking design plan: ${(args.transitions || []).length} transitions`);
              const res = await fetch('/api/session/design-plan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: sid, plan: { transitions: args.transitions } }),
                signal
              });
              const data = await res.json();
              if (data.warnings?.length) {
                for (const w of data.warnings) addLog(`  ⚠️ ${w}`);
              }
              if (data.success !== false) {
                const emptyMemory = { lockedDecisions: [], rejectedApproaches: [], stylisticConstraints: [], unresolvedProblems: [], successfulTransitions: [], failedTransitions: [], timingConstraints: [], recoveryNarrative: '' };
                sessionManager.updateSemanticMemory(updateSemanticMemoryOnToolResult(sessionManager.sessionState?.semanticMemory ?? emptyMemory, call.name, call.args ?? {}, data));
              }
              toolRes = { functionResponse: { name: call.name, id: call.id, response: data } };
            }
            else if (call.name === 'apply_musical_transition') {
              addLog(`   Applying ${args.style} transition: ${args.fromSectionId} → ${args.toSectionId}`);
              const res = await fetch('/api/apply-transition', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  fromTrackId: args.fromTrackId,
                  fromSectionId: args.fromSectionId,
                  toTrackId: args.toTrackId,
                  toSectionId: args.toSectionId,
                  style: args.style,
                  duration: args.duration,
                  intensity: args.intensity,
                  beatAlign: args.beatAlign,
                  notes: args.notes,
                  sessionId: sid
                }),
                signal
              });
              const data = await res.json();
              if (data.success !== false) {
                const emptyMemory = { lockedDecisions: [], rejectedApproaches: [], stylisticConstraints: [], unresolvedProblems: [], successfulTransitions: [], failedTransitions: [], timingConstraints: [], recoveryNarrative: '' };
                sessionManager.updateSemanticMemory(updateSemanticMemoryOnToolResult(sessionManager.sessionState?.semanticMemory ?? emptyMemory, call.name, call.args ?? {}, data));
              }
              toolRes = { functionResponse: { name: call.name, id: call.id, response: data } };
            }
            else if (call.name === 'analyze_medley_quality') {
              addLog(`   Analyzing medley quality: ${args.filePath}`);
              const res = await fetch('/api/medley-quality', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filePath: args.filePath, sessionId: sid }),
                signal
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
                body: JSON.stringify({ filePath: args.filePath, content: args.content }),
                signal
              });
              toolRes = { functionResponse: { name: call.name, id: call.id, response: await res.json() } };
            }
            else if (call.name === 'save_file_analysis') {
              addLog(`  📊 Saving analysis for ${args.fileId}`);
              const res = await fetch('/api/library/analysis', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                  fileId: args.fileId, 
                  analysisText: args.analysisText,
                  sessionId: sid   // pass session for wisdom accumulation
                }),
                signal
              });
              toolRes = { functionResponse: { name: call.name, id: call.id, response: await res.json() } };
              await fetchLibrary();
            }
            else if (call.name === 'report_progress') {
              if (args.phase) {
                setCurrentPhase(args.phase);
              } else {
                setCurrentPhase('EVALUATE — Scoring Output');
              }
              const normalizedMetrics = metricsManager.ingestMetrics(args);
              const phaseLog = args.phase ? ` [${args.phase}]` : '';
              addLog(`  📈 Scores: Arc=${normalizedMetrics.emotionalArc}% Trans=${normalizedMetrics.transitionSmoothness}% Identity=${normalizedMetrics.performerIdentity}% Overall=${normalizedMetrics.overallScore}%${phaseLog}`);

              // === Early Termination — log only; let the agent naturally call finalize_medley next ===
              if (metricsManager.shouldTerminateEarly(normalizedMetrics.overallScore)) {
                addLog(`   ✅ Early termination: overallScore ${normalizedMetrics.overallScore} >= ${EARLY_TERMINATION_SCORE}. Stopping refinement.`);
              }

              // Stall detection — embed guidance in function response (same turn, no protocol violation)
              const isStalled = metricsManager.isConverged(normalizedMetrics) && iterations > 10;
              if (isStalled) {
                addLog(`⚠️ Stalled progress detected at iteration ${iterations}.`);
              }

              // Also persist to server for SSE
              await fetch('/api/session/metrics', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: sid, metrics: normalizedMetrics }),
                signal
              });
              toolRes = {
                functionResponse: {
                  name: call.name,
                  id: call.id,
                  response: {
                    status: isStalled
                      ? 'Metrics updated. NOTE: Scores have not improved for 3+ consecutive iterations. Consider: (1) different section pair combinations, (2) changing transition styles, or (3) calling finalize_medley if current quality is acceptable. Do not repeat the same actions.'
                      : 'Metrics updated.',
                  },
                },
              };
            }
            else if (call.name === 'finish_medley') {
              // finish_medley does NOT render an MP3. Redirect the model to finalize_medley.
              addLog(`  ⚠️ finish_medley called — redirecting to finalize_medley (no render was performed)`);
              toolRes = {
                functionResponse: {
                  name: call.name, id: call.id,
                  response: {
                    error: 'finish_medley does not produce an MP3. You must call finalize_medley with useCleanRender: true to render the final output audio file.'
                  }
                }
              };
            }
            else if (call.name === 'finalize_medley') {
              setCurrentPhase('FINISH — Rendering Final Clean Medley');
              addLog(`  🚀 Rendering an immutable final candidate`);

              const candidateRes = await fetch('/api/render-review-candidate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  sessionId: sid,
                  legacy: true,
                }),
                signal
              });
              const candidateData = await candidateRes.json();
              if (!candidateRes.ok || !candidateData.success) {
                throw new Error(candidateData.error || 'Candidate render failed');
              }
              const res = await fetch('/api/finalize-medley', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  sessionId: sid,
                  candidateId: candidateData.candidate.candidateId,
                  summary: args.summary
                }),
                signal
              });
              const data = await res.json();
              if (!res.ok || !data.success) {
                throw new Error(data.error || 'Candidate promotion failed');
              }
              addLog(`  ✅ Reviewed candidate promoted byte-for-byte: ${data.outputPath}`);

              setSummary(args.summary);
              setStatus('completed');
              loopFinished = true;
              toolRes = { functionResponse: { name: call.name, id: call.id, response: data } };
            }
          } catch (e: any) {
            const streak4 = modelFallback.incrementToolFailure();
            logDetailedError(`Tool Execution: ${call.name}`, e, {
              toolName: call.name,
              toolId: call.id,
              arguments: args,
              model: modelFallback.getCurrentModel(),
              provider: config.provider,
              toolFailureStreak: streak4
            });

            toolRes = {
              functionResponse: {
                name: call.name,
                id: call.id,
                response: {
                  error: e.message || String(e),
                  details: e.rawBody || e.rawArguments || undefined
                }
              }
            };

            // Auto model switch on repeated tool failures
            if (modelFallback.toolFailureStreakRef.current >= MAX_TOOL_FAILURE_STREAK) {
              const switched = await switchToNextModel(`Repeated failures calling tool "${call.name}" (${streak4} times)`);
              if (switched) {
                addLog(`   Continuing with new model...`);
              }
            }
          }

          if (toolRes) toolResponses.push(toolRes);
          logIterationTelemetry({ sessionId: sid, iteration: iterations, phase: currentPhaseRef.current, model: modelFallback.getCurrentModel(), toolName: call.name, durationMs: Date.now() - toolStartMs });
        }

        // Update derived Execution Context after every tool batch (pure UI layer, reflects actual activity)
        const lastToolThisTurn = functionCalls.length > 0 ? functionCalls[functionCalls.length - 1].name : null;
        metricsManager.setExecutionContext(deriveExecutionContext(currentPhaseRef.current, lastToolThisTurn, result.text || null, iterations));

        if (toolResponses.length > 0) {
          // Reset streak: a successful round-trip means the model is functioning
          modelFallback.resetToolFailure();
          result = await sendWithRetry(toolResponses.map((toolResponse: any) => ({
            name: toolResponse.functionResponse.name,
            id: toolResponse.functionResponse.id,
            response: toolResponse.functionResponse.response
          })));
          if (result.usage?.total_tokens) {
            addLog(`   [Tokens] Prompt: ${result.usage.prompt_tokens ?? '?'}, Completion: ${result.usage.completion_tokens ?? '?'}, Total: ${result.usage.total_tokens}`);
          }
          if (!loopFinished) saveCheckpoint();
        }
      }

      if (iterations >= MAX_ITERATIONS && !loopFinished) {
        addLog('⚠️ Max iterations reached. Stopping.');
        setStatus('error');
        setErrorMessage('Max iterations reached without completing the medley.');
      }

      // Phase 1 + Phase 2 stats at end of run
      addLog(`   [Phase 1/2 Final Stats] evaluateCalls=${evaluateCallCount}, llmCalls=${llmCallCount} (expensive=${expensiveLLMCalls}, cheap=${cheapLLMCalls}), loopTurns=${refinementPassCount}, cachedPairs=${sectionPairCache.size}, autoAccepted=${autoAcceptedCount}, autoRejected=${autoRejectedCount}`);
      addLog(`   Note: Auto-accept threshold = ${LOCAL_AUTO_ACCEPT_THRESHOLD}, auto-reject threshold = ${LOCAL_REJECTION_THRESHOLD}. Recalibrate when using more diverse libraries.`);
    } catch (e: any) {
      if (e.name === 'AbortError') {
        setStatus('idle');
        setRunStartedAt(null);
        setLogs([]);
        metricsManager.resetMetrics();
        sessionManager.resetSession();
        setSummary(null);
        setSessionId(null);
        sessionIdRef.current = null;
        setErrorMessage(null);
        return;
      }

      logDetailedError('Autonomous Loop Crashed', e, {
        lastKnownPhase: currentPhaseRef.current,
        model: config.model,
        provider: config.provider,
        sessionId: sid
      });

      setStatus('error');
      setErrorMessage(e.message || 'Autonomous loop failed unexpectedly');
    } finally {
      disconnectSSE();
      metricsManager.setRenderProgress(null);
    }
  };

  const handleCancel = () => {
    const activeSid = sessionIdRef.current;
    activeRequestSequenceRef.current++;
    if (activeSid) {
      fetch(`/api/session/${activeSid}/cancel`, { method: 'POST' }).catch(err => {
        console.error('Failed to cancel active render process:', err);
      });
    }
    disconnectSSE();
    metricsManager.setRenderProgress(null);
    abortRef.current?.abort();
    abortRef.current = null;
    setTimeout(fetchCheckpoints, 600);
  };

  const stageLabels: Record<SpecialistStage, string> = {
    local_analysis: 'LOCAL ANALYSIS',
    context_brief: 'CONTEXT BRIEF',
    arrangement: 'ARRANGEMENT',
    production: 'PRODUCTION',
    review_candidate: 'REVIEW CANDIDATE',
    quality_review: 'QUALITY REVIEW',
    correction: 'CORRECTIONS',
    final_render: 'FINAL RENDER',
    completed: 'COMPLETED',
  };

  const runAutomaticWorkflow = async (
    lib: LibraryFile[],
    signal: AbortSignal,
    design: MedleyDesignPayload,
    resume?: AutomaticWorkflowCheckpoint | null,
  ) => {
    const sid = resume?.sessionId ?? Math.random().toString(36).substring(2, 10);
    const requestSequence = ++activeRequestSequenceRef.current;
    setSessionId(sid);
    sessionIdRef.current = sid;
    connectSSE(sid, {
      onLog: message => addLog(`📡 ${message}`),
      onProgress: data => metricsManager.setRenderProgress(data),
      onMetrics: data => metricsManager.setMetrics(data),
      onCompleted: data => { if (data.summary) setSummary(data.summary); },
    });
    try {
      const result = await runAutomaticSpecialistWorkflow({
        sessionId: sid,
        config,
        library: lib,
        design,
        signal,
        requestSequence,
        resume,
        onLog: addLog,
        onStage: (stage, role, model) => {
          if (activeRequestSequenceRef.current !== requestSequence) return;
          setCurrentPhase(stageLabels[stage]);
          setSpecialistRole(role);
          setSpecialistModel(model ?? '');
          addLog(`${stageLabels[stage]}${role ? ` · ${role}` : ''}${model ? ` · ${model}` : ''}`);
        },
        onCheckpoint: checkpoint => {
          if (activeRequestSequenceRef.current !== requestSequence) return;
          fetch('/api/checkpoint', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(checkpoint),
          }).catch(() => {});
        },
        onMetrics: review => {
          if (activeRequestSequenceRef.current !== requestSequence) return;
          metricsManager.setMetrics({
            emotionalArc: review.emotionalArc,
            transitionSmoothness: review.transitionSmoothness,
            performerIdentity: review.performerIdentity,
            overallScore: review.overallScore,
            iteration: review.candidateVersion,
            phase: 'QUALITY REVIEW',
          });
        },
      });
      if (activeRequestSequenceRef.current !== requestSequence) return;
      setSummary(result.summary);
      setStatus('completed');
      setRunStartedAt(null);
      await fetchCheckpoints();
    } catch (error: any) {
      if (error?.name === 'AbortError' || signal.aborted) {
        setStatus('idle');
        return;
      }
      logDetailedError('Automatic Specialist Workflow', error, { sessionId: sid });
      setStatus('error');
      setErrorMessage(error?.message || 'Automatic specialist workflow failed');
    } finally {
      disconnectSSE();
      metricsManager.setRenderProgress(null);
    }
  };

  const resumeFromCheckpoint = async (rawCheckpoint: StoredCheckpoint) => {
    if (status !== 'idle') return;
    if ((rawCheckpoint as AutomaticWorkflowCheckpoint).schemaVersion === 3) {
      const parsedCheckpoint = AutomaticWorkflowCheckpointSchema.safeParse(rawCheckpoint);
      if (!parsedCheckpoint.success) {
        setStatus('error');
        setErrorMessage('This automatic checkpoint is invalid and cannot be resumed.');
        return;
      }
      const checkpoint = parsedCheckpoint.data;
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus('running');
      setRunStartedAt(Date.now());
      setCurrentPhase(stageLabels[checkpoint.stage]);
      try {
        const design = await buildMedleyDesign(library, controller.signal);
        await runAutomaticWorkflow(library, controller.signal, design, checkpoint);
      } catch (error: any) {
        setStatus('error');
        setErrorMessage(error?.message || 'Could not rebuild medley intelligence for resume');
      }
      return;
    }
    const legacyCheckpoint = rawCheckpoint as CheckpointData;
    if (!validateCheckpoint(legacyCheckpoint)) {
      addLog('❌ Checkpoint failed validation — data may be corrupt. Discarding.');
      setStatus('idle');
      return;
    }
    const checkpoint = upgradeCheckpoint(legacyCheckpoint);
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('running');
    setCurrentPhase(checkpoint.currentPhase || '');
    sessionManager.updateDesign(checkpoint.design ?? null);
    metricsManager.setIteration({ current: checkpoint.iterations, max: 50 });
    await runAutonomousLoop(library, controller.signal, checkpoint.design, checkpoint);
  };

  const discardCheckpoint = async (sessionId: string) => {
    activeRequestSequenceRef.current++;
    abortRef.current?.abort();
    await fetch(`/api/session/${encodeURIComponent(sessionId)}/discard`, { method: 'DELETE' });
    await fetchCheckpoints();
  };

  const loadFromHistory = (entry: HistoryEntry) => {
    setSessionId(entry.id);
    setSummary(entry.summary);
    metricsManager.setMetrics(entry.metrics ?? null);
    setStatus('completed');
    setLogs([]);
    setActiveTab('workshop');
  };

  const preAnalyzeLibrary = async (lib: LibraryFile[], signal: AbortSignal): Promise<void> => {
    const unanalyzed = lib.filter(f => !f.analysis || !f.localAnalysis || !(f.localAnalysis as any)?.localAnalysisV2 || !f.medleyIntelligence);
    if (unanalyzed.length === 0) return;

    metricsManager.setPreAnalysisProgress({ current: 0, total: unanalyzed.length });
    setCurrentPhase('ANALYZE — Pre-analyzing Library');
    addLog(`🔬 Pre-analyzing ${unanalyzed.length} track(s) before session starts...`);

    // Bounded parallel queue — analyze up to 3 tracks concurrently
    const CONCURRENCY = 3;
    let completedCount = 0;

    const analyzeOne = async (entry: typeof unanalyzed[0]) => {
      if (signal.aborted) return;
      addLog(`  📡 Analyzing: ${entry.originalName}`);

      try {
        const local = await getLocalAnalysis({ fileId: entry.id, saveToLibrary: true }, signal);
        let analysisText = local.analysisText;

        if (config.modelMode === 'manual' && shouldUploadAudioForAnalysis(entry.originalName)) {
          addLog(`  ☁️ Cloud audio upload allowed for ${entry.originalName}`);
          const audioRes = await fetch(`/api/audio-raw/${entry.id}`, { signal });
          const audioBlob = await audioRes.blob();
          const cloudAnalysisText = await analyzeAudioWithProvider({
            config,
            file: new File([audioBlob], entry.originalName, { type: entry.mimeType }),
            mimeType: entry.mimeType,
            displayName: entry.originalName,
            prompt: 'Analyze this audio track and provide BPM if discernible, musical key, mood or genre, energy level from 1 to 10, and a concise 2 to 3 sentence structural summary.',
            signal
          });
          analysisText = `${local.analysisText}\n\nOptional cloud audio analysis:\n${cloudAnalysisText}`;
        }

        if (analysisText) {
          if (config.modelMode === 'manual' && config.audioAnalysisMode !== 'local') {
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
      metricsManager.setPreAnalysisProgress({ current: completedCount, total: unanalyzed.length });
    };

    // Process in waves of CONCURRENCY
    for (let i = 0; i < unanalyzed.length; i += CONCURRENCY) {
      if (signal.aborted) {
        metricsManager.setPreAnalysisProgress(null);
        return;
      }
      const wave = unanalyzed.slice(i, i + CONCURRENCY);
      await Promise.all(wave.map(analyzeOne));
    }

    await fetchLibrary();
    metricsManager.setPreAnalysisProgress(null);
    setCurrentPhase('');
    addLog('✅ Pre-analysis complete. Handing off to Architect...');
  };

  const startMedley = async () => {
    if (library.length < 2) return;
    const configurationError = getStartConfigurationError(config);
    if (configurationError) {
      setStatus('error');
      setErrorMessage(configurationError);
      return;
    }
    abortRef.current = new AbortController();
    setStatus('running');
    setRunStartedAt(Date.now());
    addLog('🔍 Checking system integrity...');
    
    let healthy = false;
    let attempts = 0;
    while (!healthy && attempts < 5) {
      try {
        const res = await fetch('/api/health');
        if (res.ok) {
          healthy = true;
        } else {
          throw new Error('Not ready');
        }
      } catch (e) {
        attempts++;
        addLog(`⚠️ Backend warming up (Attempt ${attempts}/5)...`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    if (!healthy) {
      setErrorMessage('Backend failed to respond. Please refresh the page.');
      setStatus('error');
      return;
    }

    addLog('✅ System online. Initializing Architect...');
    setCurrentPhase('ANALYZE — Library Analysis');
    await preAnalyzeLibrary(library, abortRef.current.signal);
    if (!abortRef.current || abortRef.current.signal.aborted) return;
    const freshLib: LibraryFile[] = await fetch('/api/library').then(r => r.json()).catch(() => library);
    let design: MedleyDesignPayload | null = null;
    try {
      setCurrentPhase('DESIGN — Building Structure');
      addLog('🧠 Building Medley Intelligence match scores...');
      design = await buildMedleyDesign(freshLib, abortRef.current.signal);
      addLog(`✅ Medley Intelligence ready: ${design.recommendedStrategies.length} strategies, ${design.transitionMatrixSummary.length} transition scores.`);
    } catch (e: any) {
      addLog(`⚠️ Medley Intelligence unavailable: ${e.message}`);
    }
    if (config.modelMode === 'automatic') {
      if (!design) {
        setStatus('error');
        setErrorMessage('Automatic mode requires local Medley Intelligence. Re-run local analysis and try again.');
        return;
      }
      await runAutomaticWorkflow(freshLib, abortRef.current.signal, design);
    } else {
      setCurrentPhase('BUILD — Constructing Medley');
      runAutonomousLoop(freshLib, abortRef.current.signal, design);
    }
  };

  const isIdle = status === 'idle' || status === 'error';
  const isUploading = status === 'uploading';
  const canStart = library.length >= 2 && hasProviderKey && configLoaded;

  return (
    <div className="min-h-screen h-auto md:h-screen bg-[#060606] text-[#E0E0E0] font-sans flex flex-col overflow-y-auto overflow-x-hidden md:overflow-hidden selection:bg-[#00F0FF]/30">
      <Header 
        status={status} 
        provider={config.modelMode === 'automatic' ? 'openrouter' : config.provider}
        currentModel={config.modelMode === 'automatic' ? specialistModel : modelFallback.activeModel}
        currentRole={config.modelMode === 'automatic' ? specialistRole : null}
        onConfigClick={() => setShowConfig(true)} 
        onForceModelSwitch={() => forceModelSwitchRef.current?.()}
        onCancel={handleCancel} 
      />
      {showConfig && <ConfigPanel config={config} onUpdate={setConfig} onClose={() => setShowConfig(false)} />}

      <main className="flex-1 flex flex-col md:flex-row overflow-visible md:overflow-hidden">
        <LibrarySidebar library={library} status={status} provider={config.modelMode === 'automatic' ? 'openrouter' : config.provider} apiReady={hasProviderKey} onRemove={removeFile} onReorder={reorderLibrary} />

        <section className="flex-1 min-w-0 min-h-[70vh] md:min-h-0 flex flex-col bg-[#030303] overflow-hidden">
          {/* Tab bar */}
          <div className="h-10 border-b border-[#1A1A1A] flex items-center px-4 gap-1 shrink-0 bg-[#0A0A0A]">
            {(['workshop', 'history'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1 text-[10px] font-mono uppercase tracking-widest rounded transition-all ${
                  activeTab === tab
                    ? 'text-[#00F0FF] bg-[#00F0FF]/10 border border-[#00F0FF]/20'
                    : 'text-[#444] hover:text-[#888] border border-transparent'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Persistent Activity Status Bar */}
          {status === 'running' && (
            <div className="shrink-0 border-b border-[#1A1A1A] bg-[#0A0A0A] px-3 md:px-5 py-2.5 flex flex-col md:flex-row md:items-center justify-between gap-2 text-[11px] font-mono animate-fade-in">
              <div className="flex items-center gap-3 min-w-0">
                <span className="uppercase tracking-[1.5px] text-[#00F0FF] font-bold shrink-0">CURRENT PHASE</span>
                <span className="text-white font-medium truncate">
                  {metricsManager.preAnalysisProgress
                    ? `ANALYZE — Pre-analyzing Library (${metricsManager.preAnalysisProgress.current}/${metricsManager.preAnalysisProgress.total})`
                    : (metricsManager.metrics?.phase || sessionManager.currentPhase || (metricsManager.iteration ? 'BUILD — Constructing Medley' : 'Initializing...'))}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 md:gap-3">
                {/* Pre-analysis progress bar */}
                {metricsManager.preAnalysisProgress && (
                  <div className="flex items-center gap-3 ml-4 min-w-[220px]">
                    <div className="flex-1 h-1.5 bg-[#1A1A1A] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[#00F0FF] to-[#0080FF] transition-all duration-200"
                        style={{ width: `${(metricsManager.preAnalysisProgress.current / metricsManager.preAnalysisProgress.total) * 100}%` }}
                      />
                    </div>
                    <div className="text-[#888] tabular-nums w-12 text-right">
                      {Math.round((metricsManager.preAnalysisProgress.current / metricsManager.preAnalysisProgress.total) * 100)}%
                    </div>
                  </div>
                )}

                {/* Render progress bar */}
                {metricsManager.renderProgress && metricsManager.renderProgress.percent < 100 && (
                  <div className="flex items-center gap-3 ml-4 min-w-[260px] animate-pulse">
                    <span className="text-[#FF00F0] text-[9px] uppercase tracking-wider font-bold">
                      [FFMPEG ENCODING]
                    </span>
                    <div className="flex-1 h-1.5 bg-[#1A1A1A] rounded-full overflow-hidden relative">
                      <div
                        className="h-full bg-gradient-to-r from-[#FF00F0] to-[#00F0FF] transition-all duration-200"
                        style={{ width: `${metricsManager.renderProgress.percent}%` }}
                      />
                    </div>
                    <div className="text-white tabular-nums font-bold w-10 text-right">
                      {metricsManager.renderProgress.percent}%
                    </div>
                    {metricsManager.renderProgress.remainingSecondsEstimate !== undefined && metricsManager.renderProgress.remainingSecondsEstimate !== null && (
                      <span className="text-[#666] text-[9px] shrink-0">
                        ~{metricsManager.renderProgress.remainingSecondsEstimate}s left
                      </span>
                    )}
                  </div>
                )}

                {/* Main loop iteration */}
                {metricsManager.iteration && !metricsManager.preAnalysisProgress && !metricsManager.renderProgress && (
                  <div className="text-[#666] shrink-0">
                    Iteration <span className="text-white font-medium">{metricsManager.iteration.current}</span> / {metricsManager.iteration.max}
                  </div>
                )}

                {/* Cancel Button in Status Bar */}
                <button
                  onClick={handleCancel}
                  className="ml-4 px-3 py-1 rounded-md border border-red-500/40 bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 font-mono text-[10px] uppercase tracking-wider transition-all flex items-center gap-1.5 shrink-0"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
                  Cancel Render
                </button>
              </div>
            </div>
          )}

          {activeTab === 'history' ? (
            <HistoryBrowser onLoadSession={loadFromHistory} />
          ) : isIdle ? (
            <div className="flex-1 p-4 md:p-8 flex flex-col items-center justify-center">
              {/* Drop zone */}
              <div
                onDragOver={e => e.preventDefault()}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                className="w-full max-w-lg border-2 border-dashed border-[#1A1A1A] bg-[#0A0A0A] p-8 md:p-16 text-center cursor-pointer hover:border-[#00F0FF]/40 hover:bg-[#00F0FF]/[0.02] transition-all duration-300 group rounded-xl"
              >
                <Upload className="w-12 h-12 text-[#333] group-hover:text-[#00F0FF] transition-colors mx-auto mb-6" />
                <h3 className="text-[15px] font-bold uppercase tracking-wider text-white mb-2">Drop Audio Files Here</h3>
                <p className="text-[#555] text-[12px]">MP3, WAV, FLAC, AAC, OGG • Click to browse</p>
                <input type="file" multiple accept="audio/*" className="hidden" ref={fileInputRef} onChange={e => e.target.files && uploadToLibrary(Array.from(e.target.files))} />
              </div>

              {/* Upload progress */}
              {isUploading && uploadProgress && (
                <div className="mt-8 border border-[#00F0FF]/20 bg-[#00F0FF]/[0.03] p-4 rounded-xl w-full max-w-lg">
                  <div className="flex items-center text-[#00F0FF] text-[11px] font-mono uppercase font-bold mb-2">
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Ingesting...
                  </div>
                  <div className="w-full bg-[#111] h-1.5 rounded-full overflow-hidden">
                    <div className="bg-gradient-to-r from-[#00F0FF] to-[#0080FF] h-full rounded-full transition-all duration-300" style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }} />
                  </div>
                  <div className="mt-1.5 text-[10px] font-mono text-[#444] text-right">{uploadProgress.current}/{uploadProgress.total}</div>
                </div>
              )}

              {/* Error display */}
              {status === 'error' && errorMessage && (
                <div className="mt-6 border border-red-500/30 bg-red-500/5 text-red-400 p-4 text-[11px] font-mono flex items-start gap-3 rounded-xl w-full max-w-lg">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold uppercase">Error</div>
                    <div className="mt-1 text-[10px] opacity-80">{errorMessage}</div>
                  </div>
                </div>
              )}

              {/* Checkpoint resume banner */}
              {checkpoints.length > 0 && (
                <div className="mt-8 w-full max-w-lg border border-[#00F0FF]/20 bg-[#00F0FF]/[0.03] rounded-xl p-4">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-[#00F0FF] font-bold mb-3">Interrupted Sessions</div>
                   {checkpoints.map(cp => (
                     <div key={cp.sessionId} className="flex items-center gap-3 py-2 border-t border-white/5 first:border-t-0">
                       <div className="flex-1 min-w-0">
                         <div className="text-[11px] text-white font-mono truncate">
                           {'workflowMode' in cp ? (cp.activeModel || 'Automatic Specialist Team') : cp.model}
                         </div>
                         <div className="text-[10px] text-[#555] font-mono">
                           {'workflowMode' in cp
                             ? `${stageLabels[cp.stage]} · correction ${cp.correctionCount}/${MAX_CORRECTION_RETRIES}`
                             : `Iteration ${cp.iterations} · ${cp.currentPhase || 'Unknown phase'}`}
                           {' · '}{new Date(cp.savedAt).toLocaleString()}
                         </div>
                      </div>
                      <button
                        onClick={() => resumeFromCheckpoint(cp)}
                        className="shrink-0 px-3 py-1 text-[10px] font-mono uppercase tracking-wider border border-[#00F0FF]/50 text-[#00F0FF] rounded hover:bg-[#00F0FF]/10 transition-all"
                      >
                        Resume
                      </button>
                      <button
                        onClick={() => discardCheckpoint(cp.sessionId)}
                        className="shrink-0 px-3 py-1 text-[10px] font-mono uppercase tracking-wider border border-red-500/40 text-red-400 rounded hover:bg-red-500/10 transition-all"
                      >
                        Discard
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Start button */}
              <button
                onClick={startMedley}
                disabled={!canStart}
                className="mt-10 px-10 py-3.5 bg-gradient-to-r from-[#00F0FF] to-[#0080FF] text-black text-[12px] font-bold uppercase rounded-xl hover:shadow-xl hover:shadow-[#00F0FF]/20 transition-all duration-300 disabled:opacity-20 disabled:cursor-not-allowed disabled:shadow-none flex items-center gap-2 group"
              >
                <Play className="w-4 h-4" />
                Initialize Architecture
              </button>
              {library.length < 2 && library.length > 0 && (
                <p className="mt-3 text-[10px] text-[#444] font-mono">Need at least 2 tracks to build a medley</p>
              )}
              {library.length >= 2 && !hasProviderKey && (
                <p className="mt-3 text-[10px] text-[#444] font-mono">Open Configuration and add a {config.provider === 'gemini' ? 'Gemini' : 'OpenRouter'} API key</p>
              )}
            </div>
          ) : (
            <LogPanel status={status} logs={logs} iteration={metricsManager.iteration} runStartedAt={runStartedAt} currentPhase={sessionManager.currentPhase} />
          )}
        </section>

        {sessionManager.design && activeTab === 'workshop' && status !== 'completed' && status !== 'running' ? (
          <MedleyMatchPanel design={sessionManager.design} />
        ) : (
          <MetricsSidebar metrics={metricsManager.metrics} summary={summary} status={status} sessionId={sessionId} />
        )}
      </main>

      {/* Footer Audio Player */}
      <footer className="min-h-20 border-t border-[#1A1A1A] bg-[#0A0A0A] flex items-center px-3 md:px-6 gap-3 md:gap-6 shrink-0">
        {status === 'completed' && sessionId ? (
          <audio controls src={`/api/audio/${sessionId}`} className="w-full max-w-5xl h-10 mx-auto" style={{ filter: 'invert(1) hue-rotate(180deg)', opacity: 0.8 }} />
        ) : (
          <>
            <div className="flex items-center gap-4 opacity-20 pointer-events-none">
              <div className="w-10 h-10 rounded-full border border-[#333] flex items-center justify-center">
                <div className="w-0 h-0 border-t-[6px] border-t-transparent border-l-[10px] border-l-white border-b-[6px] border-b-transparent ml-1" />
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase">No Active Output</div>
                <div className="text-[10px] text-[#444] font-mono">--:-- / --:--</div>
              </div>
            </div>
            <div className="flex-1 h-1.5 bg-[#111] rounded-full opacity-20" />
            <div className="hidden sm:block text-[10px] font-mono text-[#333] opacity-20">44.1kHz • Stereo • 320kbps</div>
          </>
        )}
      </footer>

      <style dangerouslySetInnerHTML={{ __html: `
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap');
        * { font-family: 'Inter', -apple-system, sans-serif; }
        code, .font-mono { font-family: 'JetBrains Mono', monospace !important; }
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #222; border-radius: 3px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #444; }
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .animate-shimmer { animation: shimmer 2s infinite; }
        input[type="range"] { height: 4px; }
        input[type="range"]::-webkit-slider-thumb { width: 14px; height: 14px; }
      `}} />
    </div>
  );
}
