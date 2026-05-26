import React from 'react';
import { Settings, Square } from 'lucide-react';
import type { ProviderId } from './ConfigPanel';

interface HeaderProps {
  status: 'idle' | 'uploading' | 'running' | 'completed' | 'error';
  provider: ProviderId;
  currentModel?: string;
  onConfigClick: () => void;
  onForceModelSwitch?: () => void;
  onCancel?: () => void;
}

const statusLabels: Record<string, string> = {
  running: 'Autonomous Logic Active',
  idle: 'System Ready',
  uploading: 'Ingesting Material',
  completed: 'Task Completed',
  error: 'System Error'
};

export default function Header({ 
  status, 
  provider, 
  currentModel, 
  onForceModelSwitch, 
  onConfigClick, 
  onCancel 
}: HeaderProps) {
  const isActive = status === 'running' || status === 'uploading';
  return (
    <header className="h-16 border-b border-[#1E1E1E] flex items-center justify-between px-6 bg-[#0C0C0C] shrink-0 relative overflow-hidden">
      {/* Subtle gradient shimmer when active */}
      {isActive && (
        <div className="absolute inset-0 pointer-events-none opacity-20">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#00F0FF]/10 to-transparent animate-shimmer" />
        </div>
      )}
      <div className="flex items-center gap-4 relative z-10">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#00F0FF] to-[#0080FF] flex items-center justify-center shadow-lg shadow-[#00F0FF]/20">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.5" strokeLinecap="round">
            <path d="M9 18V5l12-2v13"/>
            <circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
          </svg>
        </div>
        <div>
          <h1 className="text-[15px] font-bold tracking-tight text-white">AI Medley Architect</h1>
          <span className="text-[10px] font-mono text-[#555] tracking-wider">v3.1.0 — {provider === 'gemini' ? 'GEMINI DIRECT' : 'OPENROUTER'}</span>
        </div>
      </div>
      <div className="flex items-center gap-5 relative z-10">
        {/* Current Model Indicator */}
        {currentModel && (
          <div 
            className="flex items-center gap-2 px-3 py-1 rounded-md bg-[#111] border border-[#333] text-[10px] font-mono"
            title={currentModel}
          >
            <span className="text-[#666]">MODEL</span>
            <span className="text-[#00F0FF] max-w-[260px] truncate">{currentModel}</span>
          </div>
        )}

        <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-[#111] border border-[#222]">
          <div className={`w-2 h-2 rounded-full transition-colors duration-300 ${isActive ? 'bg-[#00F0FF] shadow-[0_0_8px_#00F0FF] animate-pulse' : status === 'completed' ? 'bg-emerald-400' : status === 'error' ? 'bg-red-400' : 'bg-[#444]'}`} />
          <span className={`text-[10px] font-mono uppercase tracking-widest transition-colors ${isActive ? 'text-[#00F0FF]' : 'text-[#666]'}`}>
            {statusLabels[status] || 'Unknown'}
          </span>
        </div>

        <button
          onClick={onConfigClick}
          className="w-8 h-8 rounded-lg border border-[#333] bg-[#111] flex items-center justify-center text-[#888] hover:text-white hover:border-[#00F0FF]/50 hover:bg-[#00F0FF]/5 transition-all duration-200"
        >
          <Settings className="w-4 h-4" />
        </button>

        {/* Manual Model Switch Button (only when running) */}
        {status === 'running' && onForceModelSwitch && (
          <button
            onClick={onForceModelSwitch}
            title="Force switch to next fallback model"
            className="px-3 py-1 text-[10px] font-mono border border-[#444] bg-[#111] hover:bg-[#222] hover:border-[#00F0FF]/60 rounded text-[#888] hover:text-[#00F0FF] transition-all"
          >
            SWITCH MODEL
          </button>
        )}

        {status === 'running' && (
          <button
            onClick={() => onCancel?.()}
            title="Cancel session"
            className="w-8 h-8 rounded-lg border border-red-500/40 bg-red-500/10 flex items-center justify-center text-red-400 hover:bg-red-500/20 hover:border-red-400 transition-all duration-200"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
          </button>
        )}
      </div>
    </header>
  );
}
