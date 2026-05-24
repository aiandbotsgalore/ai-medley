import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, Play, Loader2, AlertCircle } from 'lucide-react';
import Header from './components/Header';
import LibrarySidebar, { type LibraryFile } from './components/LibrarySidebar';
import MetricsSidebar from './components/MetricsSidebar';
import LogPanel from './components/LogPanel';
import ConfigPanel, { type MedleyConfig, DEFAULT_CONFIG } from './components/ConfigPanel';
import { buildSystemPrompt, getOpenRouterTools, getToolDeclarations } from './engine/prompts';
import { analyzeAudioWithProvider, createProviderSession } from './engine/providers';
import HistoryBrowser, { type HistoryEntry } from './components/HistoryBrowser';
import MedleyMatchPanel from './components/MedleyMatchPanel';
import type { MedleyDesignPayload } from './engine/medleyIntelligence';

type AppStatus = 'idle' | 'uploading' | 'running' | 'completed' | 'error';
const CONFIG_STORAGE_KEY = 'ai-medley-config-v1';
const AUDIO_ANALYSIS_PROMPT = 'Analyze this audio file and provide BPM if discernible, musical key, genre or mood, energy level from 1 to 10, and a concise 2 to 3 sentence structural summary. If this is a medley output, also mention any obvious transition or loudness issues.';

export default function App() {
  const [library, setLibrary] = useState<LibraryFile[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<AppStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<any>(null);
  const [config, setConfig] = useState<MedleyConfig>(DEFAULT_CONFIG);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [iteration, setIteration] = useState<{ current: number; max: number } | null>(null);
  const [activeTab, setActiveTab] = useState<'workshop' | 'history'>('workshop');
  const [medleyDesign, setMedleyDesign] = useState<MedleyDesignPayload | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const addLog = useCallback((msg: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

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

  useEffect(() => {
    let cancelled = false;

    const loadConfig = async () => {
      try {
        const rawStored = localStorage.getItem(CONFIG_STORAGE_KEY);
        const storedConfig = rawStored ? JSON.parse(rawStored) : {};
        const serverConfig = await fetch('/api/config').then(r => r.json()).catch(() => ({}));
        const nextConfig: MedleyConfig = {
          ...DEFAULT_CONFIG,
          ...storedConfig,
          geminiApiKey: storedConfig?.geminiApiKey || serverConfig?.geminiApiKey || '',
          openrouterApiKey: storedConfig?.openrouterApiKey || serverConfig?.openrouterApiKey || ''
        };

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

  const activeApiKey = (config.provider === 'gemini' ? config.geminiApiKey : config.openrouterApiKey).trim();
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
    setMedleyDesign(data.design);
    return data.design as MedleyDesignPayload;
  };

  // ── Autonomous Medley Loop ──
  const runAutonomousLoop = async (lib: LibraryFile[], signal: AbortSignal, design: MedleyDesignPayload | null) => {
    if (!hasProviderKey) {
      setErrorMessage(config.provider === 'gemini' ? 'Gemini API key is not set.' : 'OpenRouter API key is not set.');
      setStatus('error');
      return;
    }

    const sid = Math.random().toString(36).substring(7);
    setSessionId(sid);
    setLogs([]);
    setSummary(null);
    setMetrics(null);
    setIteration(null);

    try {
      const systemInstruction = buildSystemPrompt(lib, config, design, sid);
      const session = createProviderSession(
        config,
        systemInstruction,
        config.provider === 'gemini' ? getToolDeclarations() : getOpenRouterTools(),
        config.temperature
      );

      const sendWithRetry = async (msg: any, retries = 0): Promise<any> => {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        try {
          return await session.send(msg);
        } catch (err: any) {
          const errText = String(err?.message || err);
          const isRateLimit = errText.includes('429') || errText.includes('RESOURCE_EXHAUSTED') || errText.includes('rate limit');
          if (isRateLimit && retries < 5) {
            const delay = Math.pow(2, retries) * 2000 + Math.random() * 1000;
            addLog(`⏳ Rate limited. Retrying in ${Math.round(delay / 1000)}s...`);
            await new Promise<void>((res, rej) => {
              const t = setTimeout(res, delay);
              signal.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Aborted', 'AbortError')); }, { once: true });
            });
            return sendWithRetry(msg, retries + 1);
          }
          throw err;
        }
      };

      let result = await sendWithRetry('Begin the medley architect process. Analyze the library first, then design and build the medley.');

      let loopFinished = false;
      let iterations = 0;
      const MAX_ITERATIONS = 50;

      while (!loopFinished && iterations < MAX_ITERATIONS) {
        if (signal.aborted) break;
        iterations++;
        setIteration({ current: iterations, max: MAX_ITERATIONS });
        if (result.text) addLog(`🤖 ${result.text}`);

        const functionCalls = result.functionCalls;
        if (!functionCalls || functionCalls.length === 0) {
          if (!result.text) {
            result = await sendWithRetry('Please proceed with the next step.');
            continue;
          }
          break;
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
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command: args.command, sessionId: sid }),
                signal
              });
              const data = await res.json();
              toolRes = { functionResponse: { name: call.name, id: call.id, response: data } };
            }
            else if (call.name === 'listen_to_audio') {
              const entry = lib.find(f => f.path === args.filePath);
              const displayName = entry?.originalName || String(args.filePath || 'audio-output').split(/[\\/]/).pop() || 'audio-output';

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
              addLog(`   Evaluating pair: ${args.fromSectionId} → ${args.toSectionId}`);
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
                body: JSON.stringify({ fileId: args.fileId, analysisText: args.analysisText }),
                signal
              });
              toolRes = { functionResponse: { name: call.name, id: call.id, response: await res.json() } };
              await fetchLibrary();
            }
            else if (call.name === 'report_progress') {
              const newMetrics = {
                emotionalArc: args.emotionalArc,
                transitionSmoothness: args.transitionSmoothness,
                performerIdentity: args.performerIdentity,
                overallScore: args.overallScore,
                iteration: args.iteration
              };
              setMetrics(newMetrics);
              addLog(`  📈 Scores: Arc=${args.emotionalArc}% Trans=${args.transitionSmoothness}% Identity=${args.performerIdentity}% Overall=${args.overallScore}%`);
              // Also persist to server for SSE
              await fetch('/api/session/metrics', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: sid, metrics: newMetrics }),
                signal
              });
              toolRes = { functionResponse: { name: call.name, id: call.id, response: { status: 'Metrics updated.' } } };
            }
            else if (call.name === 'finish_medley') {
              addLog(`  ✅ Medley complete: ${args.finalMp3Path}`);
              await fetch('/api/session/finish', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: sid, finalAudioPath: args.finalMp3Path, summary: args.summary }),
                signal
              });
              setSummary(args.summary);
              setStatus('completed');
              loopFinished = true;
              toolRes = { functionResponse: { name: call.name, id: call.id, response: { status: 'acknowledged' } } };
            }
          } catch (e: any) {
            addLog(`  ❌ Error: ${e.message}`);
            toolRes = { functionResponse: { name: call.name, id: call.id, response: { error: e.message } } };
          }

          if (toolRes) toolResponses.push(toolRes);
        }

        if (toolResponses.length > 0) {
          result = await sendWithRetry(toolResponses.map((toolResponse: any) => ({
            name: toolResponse.functionResponse.name,
            id: toolResponse.functionResponse.id,
            response: toolResponse.functionResponse.response
          })));
        }
      }

      if (iterations >= MAX_ITERATIONS && !loopFinished) {
        addLog('⚠️ Max iterations reached. Stopping.');
        setStatus('error');
        setErrorMessage('Max iterations reached without completing the medley.');
      }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        setStatus('idle');
        setLogs([]);
        setMetrics(null);
        setSummary(null);
        setSessionId(null);
        setErrorMessage(null);
        setIteration(null);
        return;
      }
      console.error(e);
      setStatus('error');
      setErrorMessage(e.message);
      addLog(`💀 Fatal error: ${e.message}`);
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  const loadFromHistory = (entry: HistoryEntry) => {
    setSessionId(entry.id);
    setSummary(entry.summary);
    setMetrics(entry.metrics ?? null);
    setStatus('completed');
    setLogs([]);
    setActiveTab('workshop');
  };

  const preAnalyzeLibrary = async (lib: LibraryFile[], signal: AbortSignal): Promise<void> => {
    const unanalyzed = lib.filter(f => !f.analysis || !f.localAnalysis || !(f.localAnalysis as any)?.localAnalysisV2 || !f.medleyIntelligence);
    if (unanalyzed.length === 0) return;

    addLog(`🔬 Pre-analyzing ${unanalyzed.length} track(s) before session starts...`);

    for (const entry of unanalyzed) {
      if (signal.aborted) return;
      addLog(`  📡 Analyzing: ${entry.originalName}`);

      try {
        const local = await getLocalAnalysis({ fileId: entry.id, saveToLibrary: true }, signal);
        let analysisText = local.analysisText;

        if (shouldUploadAudioForAnalysis(entry.originalName)) {
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
    }

    await fetchLibrary();
    addLog('✅ Pre-analysis complete. Handing off to Architect...');
  };

  const startMedley = async () => {
    if (library.length < 2) return;
    if (!hasProviderKey) {
      setStatus('error');
      setErrorMessage(config.provider === 'gemini' ? 'Add a Gemini API key in Configuration before starting.' : 'Add an OpenRouter API key in Configuration before starting.');
      return;
    }
    abortRef.current = new AbortController();
    setStatus('running');
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
    await preAnalyzeLibrary(library, abortRef.current.signal);
    if (!abortRef.current || abortRef.current.signal.aborted) return;
    const freshLib: LibraryFile[] = await fetch('/api/library').then(r => r.json()).catch(() => library);
    let design: MedleyDesignPayload | null = null;
    try {
      addLog('🧠 Building Medley Intelligence match scores...');
      design = await buildMedleyDesign(freshLib, abortRef.current.signal);
      addLog(`✅ Medley Intelligence ready: ${design.recommendedStrategies.length} strategies, ${design.transitionMatrixSummary.length} transition scores.`);
    } catch (e: any) {
      addLog(`⚠️ Medley Intelligence unavailable: ${e.message}`);
    }
    runAutonomousLoop(freshLib, abortRef.current.signal, design);
  };

  const isIdle = status === 'idle' || status === 'error';
  const canStart = library.length >= 2 && hasProviderKey && configLoaded;

  return (
    <div className="h-screen bg-[#060606] text-[#E0E0E0] font-sans flex flex-col overflow-hidden selection:bg-[#00F0FF]/30">
      <Header status={status} provider={config.provider} onConfigClick={() => setShowConfig(true)} onCancel={handleCancel} />
      {showConfig && <ConfigPanel config={config} onUpdate={setConfig} onClose={() => setShowConfig(false)} />}

      <main className="flex-1 flex overflow-hidden">
        <LibrarySidebar library={library} status={status} provider={config.provider} apiReady={hasProviderKey} onRemove={removeFile} onReorder={reorderLibrary} />

        <section className="flex-1 flex flex-col bg-[#030303] overflow-hidden">
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

          {activeTab === 'history' ? (
            <HistoryBrowser onLoadSession={loadFromHistory} />
          ) : isIdle ? (
            <div className="flex-1 p-8 flex flex-col items-center justify-center">
              {/* Drop zone */}
              <div
                onDragOver={e => e.preventDefault()}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                className="w-full max-w-lg border-2 border-dashed border-[#1A1A1A] bg-[#0A0A0A] p-16 text-center cursor-pointer hover:border-[#00F0FF]/40 hover:bg-[#00F0FF]/[0.02] transition-all duration-300 group rounded-xl"
              >
                <Upload className="w-12 h-12 text-[#333] group-hover:text-[#00F0FF] transition-colors mx-auto mb-6" />
                <h3 className="text-[15px] font-bold uppercase tracking-wider text-white mb-2">Drop Audio Files Here</h3>
                <p className="text-[#555] text-[12px]">MP3, WAV, FLAC, AAC, OGG • Click to browse</p>
                <input type="file" multiple accept="audio/*" className="hidden" ref={fileInputRef} onChange={e => e.target.files && uploadToLibrary(Array.from(e.target.files))} />
              </div>

              {/* Upload progress */}
              {status === 'uploading' && uploadProgress && (
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
            <LogPanel status={status} logs={logs} iteration={iteration} />
          )}
        </section>

        {medleyDesign && activeTab === 'workshop' && status !== 'completed' ? (
          <MedleyMatchPanel design={medleyDesign} />
        ) : (
          <MetricsSidebar metrics={metrics} summary={summary} status={status} sessionId={sessionId} />
        )}
      </main>

      {/* Footer Audio Player */}
      <footer className="h-20 border-t border-[#1A1A1A] bg-[#0A0A0A] flex items-center px-6 gap-6 shrink-0">
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
            <div className="text-[10px] font-mono text-[#333] opacity-20">44.1kHz • Stereo • 320kbps</div>
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
