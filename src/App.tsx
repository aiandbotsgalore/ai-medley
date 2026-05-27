import React, { useState, useRef, useCallback } from 'react';
import { validateProviderApiKey } from './utils/apiKey';
import { Upload, Play, Loader2, AlertCircle } from 'lucide-react';
import Header from './components/Header';
import LibrarySidebar, { type LibraryFile } from './components/LibrarySidebar';
import MetricsSidebar from './components/MetricsSidebar';
import LogPanel from './components/LogPanel';
import ConfigPanel from './components/ConfigPanel';
import ExecutionContextPanel from './components/ExecutionContextPanel';
import HistoryBrowser, { type HistoryEntry } from './components/HistoryBrowser';
import MedleyMatchPanel from './components/MedleyMatchPanel';
import { useConfig, type MedleyConfig } from './hooks/useConfig';
import { useLibrary } from './hooks/useLibrary';
import { useAutonomousLoop, type AppStatus } from './hooks/useAutonomousLoop';
import type { CheckpointData } from './types/checkpoint';

// ── App Shell ──
export default function App() {
  const { config, configLoaded, setConfig } = useConfig();
  const { library, setLibrary, uploadProgress, setUploadProgress, fetchLibrary, uploadToLibrary, removeFile, reorderLibrary } = useLibrary();

  const [logs, setLogs] = useState<string[]>([]);
  const [showConfig, setShowConfig] = useState(false);
  const [activeTab, setActiveTab] = useState<'workshop' | 'history'>('workshop');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addLog = useCallback((msg: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  const logDetailedError = useCallback((context: string, error: any, extra?: any) => {
    const errMessage = error?.message || String(error);
    const status = error?.status;
    const rawBody = error?.rawBody;
    const rawArguments = error?.rawArguments;

    addLog(`❌ [${context}] ${errMessage}${status ? ` (HTTP ${status})` : ''}`);

    if (rawBody) {
      try {
        const parsed = JSON.parse(typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody));
        const apiMsg = parsed?.error?.message || parsed?.message || parsed?.error;
        if (apiMsg) {
          addLog(`   API message: ${String(apiMsg).substring(0, 500)}`);
        } else {
          addLog(`   Raw response: ${(typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody)).substring(0, 500)}`);
        }
      } catch {
        addLog(`   Raw response: ${(typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody)).substring(0, 500)}`);
      }
    }

    if (rawArguments) addLog(`   Raw tool args: ${String(rawArguments).substring(0, 300)}`);

    if (extra && typeof extra === 'object') {
      for (const [key, val] of Object.entries(extra)) {
        if (val === undefined || val === null) continue;
        const display = typeof val === 'object' ? JSON.stringify(val).substring(0, 300) : String(val);
        addLog(`   ${key}: ${display}`);
      }
    }

    console.error(`[DETAILED ERROR - ${context}]`, { error, extra, rawBody, rawArguments });
  }, [addLog]);

  const keyValidation = config ? validateProviderApiKey(config) : { ok: false, message: '', severity: 'error' as const };
  const hasProviderKey = keyValidation.ok;

  // ── Autonomous Loop Hook ──
  const loop = useAutonomousLoop({
    library,
    config: config || {} as MedleyConfig,
    hasProviderKey,
    fetchLibrary,
    setLibrary,
    addLog,
    logDetailedError,
  });

  const isIdle = loop.status === 'idle' || loop.status === 'error';

  const handleReset = useCallback(() => {
    loop.reset();
    setLogs([]);
  }, [loop]);
  const canStart = library.length >= 2 && hasProviderKey && configLoaded;

  // ── Upload handler ──
  const handleUpload = async (files: File[]) => {
    try {
      await uploadToLibrary(Array.from(files));
    } catch (e: any) {
      loop.setStatus('error');
      loop.setErrorMessage(e.message);
    }
  };

  // ── File drop handler ──
  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFiles = Array.from(e.dataTransfer.files as FileList);
    if (droppedFiles.length > 0) {
      handleUpload(droppedFiles.filter(file => file.type.startsWith('audio/')));
    }
  };

  // ── Load from History ──
  const loadFromHistory = (entry: HistoryEntry) => {
    loop.loadFromHistory(entry);
    setActiveTab('workshop');
  };

  if (!config) return null;  // still loading

  return (
    <div className="h-screen bg-[#060606] text-[#E0E0E0] font-sans flex flex-col overflow-hidden selection:bg-[#00F0FF]/30">
      <Header 
        status={loop.status} 
        provider={config.provider} 
        currentModel={loop.activeModel}
        onConfigClick={() => setShowConfig(true)} 
        onForceModelSwitch={() => loop.forceModelSwitchRef.current?.()}
        onCancel={loop.handleCancel} 
      />
      {showConfig && <ConfigPanel config={config} onUpdate={setConfig} onClose={() => setShowConfig(false)} isRunning={loop.status === 'running'} />}

      {loop.cloudAnalysisPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-[#111] border border-[#222] rounded-xl w-full max-w-sm p-6 shadow-2xl">
            <p className="text-[12px] text-white font-semibold mb-1">Cloud Audio Analysis</p>
            <p className="text-[11px] text-[#888] mb-5">
              Upload <span className="text-[#ccc] font-mono">"{loop.cloudAnalysisPrompt.trackName}"</span> to {config.provider === 'gemini' ? 'Gemini' : 'OpenRouter'} for deeper analysis?
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => loop.cloudAnalysisPrompt?.respond('upload')} className="px-3 py-2 text-[10px] font-bold uppercase bg-[#00F0FF]/10 border border-[#00F0FF]/30 text-[#00F0FF] rounded-lg hover:bg-[#00F0FF]/20 transition-colors">Upload this track</button>
              <button onClick={() => loop.cloudAnalysisPrompt?.respond('local')} className="px-3 py-2 text-[10px] font-bold uppercase bg-[#1A1A1A] border border-[#333] text-[#888] rounded-lg hover:border-[#555] transition-colors">Local only</button>
              <button onClick={() => loop.cloudAnalysisPrompt?.respond('upload-all')} className="px-3 py-2 text-[10px] font-bold uppercase bg-[#00F0FF]/10 border border-[#00F0FF]/30 text-[#00F0FF] rounded-lg hover:bg-[#00F0FF]/20 transition-colors">Upload all remaining</button>
              <button onClick={() => loop.cloudAnalysisPrompt?.respond('local-all')} className="px-3 py-2 text-[10px] font-bold uppercase bg-[#1A1A1A] border border-[#333] text-[#888] rounded-lg hover:border-[#555] transition-colors">Local only for all</button>
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 flex overflow-hidden">
        <LibrarySidebar library={library} status={loop.status} provider={config.provider} apiReady={hasProviderKey} onRemove={removeFile} onReorder={reorderLibrary} />

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

          {/* Persistent Activity Status Bar */}
          {loop.status === 'running' && (
            <div className="shrink-0 border-b border-[#1A1A1A] bg-[#0A0A0A] px-5 py-2.5 flex items-center justify-between text-[11px] font-mono animate-fade-in">
              <div className="flex items-center gap-3 min-w-0">
                <span className="uppercase tracking-[1.5px] text-[#00F0FF] font-bold shrink-0">CURRENT PHASE</span>
                <span className="text-white font-medium truncate">
                  {loop.preAnalysisProgress
                    ? `ANALYZE — Pre-analyzing Library (${loop.preAnalysisProgress.current}/${loop.preAnalysisProgress.total})`
                    : (loop.metrics?.phase || loop.currentPhase || (loop.iteration ? 'BUILD — Constructing Medley' : 'Initializing...'))}
                </span>
              </div>

              <div className="flex items-center gap-3">
                {/* Pre-analysis progress bar */}
                {loop.preAnalysisProgress && (
                  <div className="flex items-center gap-3 ml-4 min-w-[220px]">
                    <div className="flex-1 h-1.5 bg-[#1A1A1A] rounded-full overflow-hidden">
                      <div
                        className="progress-fill h-full bg-gradient-to-r from-[#00F0FF] to-[#0080FF] transition-all duration-200"
                        style={{ '--progress-width': `${(loop.preAnalysisProgress.current / loop.preAnalysisProgress.total) * 100}%` } as React.CSSProperties}
                      />
                    </div>
                    <div className="text-[#888] tabular-nums w-12 text-right">
                      {Math.round((loop.preAnalysisProgress.current / loop.preAnalysisProgress.total) * 100)}%
                    </div>
                  </div>
                )}

                {/* Render progress bar */}
                {loop.renderProgress && loop.renderProgress.percent < 100 && (
                  <div className="flex items-center gap-3 ml-4 min-w-[260px] animate-pulse">
                    <span className="text-[#FF00F0] text-[9px] uppercase tracking-wider font-bold">[FFMPEG ENCODING]</span>
                    <div className="flex-1 h-1.5 bg-[#1A1A1A] rounded-full overflow-hidden relative">
                      <div className="progress-fill h-full bg-gradient-to-r from-[#FF00F0] to-[#00F0FF] transition-all duration-200" style={{ '--progress-width': `${loop.renderProgress.percent}%` } as React.CSSProperties} />
                    </div>
                    <div className="text-white tabular-nums font-bold w-10 text-right">{loop.renderProgress.percent}%</div>
                    {loop.renderProgress.remainingSecondsEstimate !== undefined && loop.renderProgress.remainingSecondsEstimate !== null && (
                      <span className="text-[#666] text-[9px] shrink-0">~{loop.renderProgress.remainingSecondsEstimate}s left</span>
                    )}
                  </div>
                )}

                {/* Main loop iteration */}
                {loop.iteration && !loop.preAnalysisProgress && !loop.renderProgress && (
                  <div className="text-[#666] shrink-0">
                    Iteration <span className="text-white font-medium">{loop.iteration.current}</span> / {loop.iteration.max}
                  </div>
                )}

                {/* Cancel Button */}
                <button
                  onClick={loop.handleCancel}
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
                <input type="file" multiple accept="audio/*" className="hidden" ref={fileInputRef} aria-label="Select audio files to upload" onChange={e => e.target.files && handleUpload(Array.from(e.target.files))} />
              </div>

              {/* Upload progress */}
              {uploadProgress && (
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
              {loop.status === 'error' && loop.errorMessage && (
                <div className="mt-6 border border-red-500/30 bg-red-500/5 text-red-400 p-4 text-[11px] font-mono flex items-start gap-3 rounded-xl w-full max-w-lg">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold uppercase">Error</div>
                    <div className="mt-1 text-[10px] opacity-80">{loop.errorMessage}</div>
                  </div>
                </div>
              )}

              {/* Checkpoint resume banner */}
              {loop.checkpoints.length > 0 && (
                <div className="mt-8 w-full max-w-lg border border-[#00F0FF]/20 bg-[#00F0FF]/[0.03] rounded-xl p-4">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-[#00F0FF] font-bold mb-3">Interrupted Sessions</div>
                  {loop.checkpoints.map((cp: CheckpointData) => (
                    <div key={cp.sessionId} className="flex items-center gap-3 py-2 border-t border-white/5 first:border-t-0">
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] text-white font-mono truncate">{cp.model}</div>
                        <div className="text-[10px] text-[#555] font-mono">
                          Iteration {cp.iterations} · {cp.currentPhase || 'Unknown phase'} · {new Date(cp.savedAt).toLocaleString()}
                        </div>
                      </div>
                      <button onClick={() => loop.resumeFromCheckpoint(cp)} className="shrink-0 px-3 py-1 text-[10px] font-mono uppercase tracking-wider border border-[#00F0FF]/50 text-[#00F0FF] rounded hover:bg-[#00F0FF]/10 transition-all">Resume</button>
                      <button onClick={() => loop.discardCheckpoint(cp.sessionId)} className="shrink-0 px-3 py-1 text-[10px] font-mono uppercase tracking-wider border border-red-500/40 text-red-400 rounded hover:bg-red-500/10 transition-all">Discard</button>
                    </div>
                  ))}
                </div>
              )}

              {/* Start button */}
              <button
                onClick={loop.startMedley}
                disabled={!canStart}
                className="mt-10 px-10 py-3.5 bg-gradient-to-r from-[#00F0FF] to-[#0080FF] text-black text-[12px] font-bold uppercase rounded-xl hover:shadow-xl hover:shadow-[#00F0FF]/20 transition-all duration-300 disabled:opacity-20 disabled:cursor-not-allowed disabled:shadow-none flex items-center gap-2 group"
              >
                <Play className="w-4 h-4" />
                Initialize Architecture
              </button>
              {library.length < 2 && library.length > 0 && (
                <p className="mt-3 text-[10px] text-[#444] font-mono">Need at least 2 tracks to build a medley</p>
              )}
              {library.length >= 2 && !keyValidation.ok && keyValidation.message && (
                <p className="mt-3 text-[10px] text-[#444] font-mono">{keyValidation.message}</p>
              )}
              {library.length >= 2 && keyValidation.ok && keyValidation.severity === 'warning' && keyValidation.message && (
                <p className="mt-3 text-[10px] text-amber-500/70 font-mono">{keyValidation.message}</p>
              )}
            </div>
          ) : (
            <div className="flex flex-col h-full">
              {loop.status === 'completed' && (
                <div className="flex items-center justify-between px-4 py-2 border-b border-[#1A1A1A] bg-[#0A0A0A] shrink-0">
                  <span className="text-[10px] font-mono text-[#00F0FF] uppercase tracking-widest">Run complete</span>
                  <button
                    onClick={handleReset}
                    className="px-3 py-1 rounded border border-[#00F0FF]/40 bg-[#00F0FF]/10 hover:bg-[#00F0FF]/20 text-[#00F0FF] hover:text-white font-mono text-[10px] uppercase tracking-wider transition-all flex items-center gap-1.5"
                  >
                    <Play className="w-3 h-3" />
                    New Run
                  </button>
                </div>
              )}
              <LogPanel status={loop.status} logs={logs} iteration={loop.iteration} runStartedAt={loop.runStartedAt} />
            </div>
          )}
        </section>

        {loop.medleyDesign && activeTab === 'workshop' && loop.status !== 'completed' && loop.status !== 'running' ? (
          <MedleyMatchPanel design={loop.medleyDesign} />
        ) : (
          <MetricsSidebar metrics={loop.metrics} summary={loop.summary} status={loop.status} sessionId={loop.sessionId} />
        )}
      </main>

      {/* Footer Audio Player */}
      <footer className="h-20 border-t border-[#1A1A1A] bg-[#0A0A0A] flex items-center px-6 gap-6 shrink-0">
        {loop.status === 'completed' && loop.sessionId ? (
          <>
            <audio controls src={`/api/audio/${loop.sessionId}`} className="flex-1 h-10" style={{ filter: 'invert(1) hue-rotate(180deg)', opacity: 0.8 }} />
            <button
              onClick={handleReset}
              className="shrink-0 px-4 py-2 rounded-lg border border-[#00F0FF]/40 bg-[#00F0FF]/10 hover:bg-[#00F0FF]/20 text-[#00F0FF] hover:text-white font-mono text-[10px] uppercase tracking-wider transition-all flex items-center gap-1.5"
            >
              <Play className="w-3 h-3" />
              New Run
            </button>
          </>
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
        @keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
        .animate-shimmer { animation: shimmer 2s infinite; }
        input[type="range"] { height: 4px; }
        input[type="range"]::-webkit-slider-thumb { width: 14px; height: 14px; }
      `}} />
    </div>
  );
}