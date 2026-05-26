import React, { useRef, useEffect } from 'react';
import { Sparkles, FileCheck2, Loader2, Terminal } from 'lucide-react';

interface LogPanelProps {
  status: string;
  logs: string[];
  iteration?: { current: number; max: number } | null;
}

export default function LogPanel({ status, logs, iteration }: LogPanelProps) {
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const getLogColor = (log: string) => {
    if (log.includes('Tool:') || log.includes('CMD:')) return 'text-[#0080FF]';
    if (log.includes('Uploading') || log.includes('Fetching')) return 'text-[#00F0FF]';
    if (log.includes('Error') || log.includes('error')) return 'text-red-400';
    if (log.includes('Finished') || log.includes('completed')) return 'text-emerald-400 font-bold';
    if (log.includes('AI:')) return 'text-[#AAA]';
    return 'text-[#666]';
  };

  const ringRadius = 8;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringProgress = iteration ? iteration.current / iteration.max : 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Phase header */}
      <div className="h-14 px-5 flex items-center border-b border-[#1A1A1A] bg-[#0A0A0A] shrink-0">
        <h2 className="text-[12px] uppercase tracking-wider font-bold flex items-center gap-2 w-full">
          {status === 'uploading' ? (
            <><Loader2 className="w-4 h-4 animate-spin text-amber-400" /> <span className="text-amber-400">Ingesting Material</span></>
          ) : status === 'running' ? (
            <>
              {iteration ? (
                <svg width="22" height="22" viewBox="0 0 22 22" className="shrink-0">
                  <circle cx="11" cy="11" r={ringRadius} fill="none" stroke="#1A1A1A" strokeWidth="2" />
                  <circle
                    cx="11" cy="11" r={ringRadius} fill="none"
                    stroke="#00F0FF" strokeWidth="2"
                    strokeDasharray={ringCircumference}
                    strokeDashoffset={ringCircumference * (1 - ringProgress)}
                    strokeLinecap="round"
                    transform="rotate(-90 11 11)"
                    className="transition-all duration-300"
                  />
                </svg>
              ) : (
                <Sparkles className="w-4 h-4 text-[#00F0FF]" />
              )}
              <span className="text-[#00F0FF]">Autonomous Medley Architect</span>
              {iteration && (
                <span className="ml-auto text-[10px] font-mono text-[#444]">
                  Iteration {iteration.current}<span className="text-[#2A2A2A]">/{iteration.max}</span>
                </span>
              )}
            </>
          ) : (
            <><FileCheck2 className="w-4 h-4 text-emerald-400" /> <span className="text-emerald-400">Target Achieved</span></>
          )}
        </h2>
      </div>

      {/* Timeline visualization */}
      <div className="h-24 px-5 py-3 border-b border-[#1A1A1A] bg-[#050505] shrink-0">
        <div className="h-full bg-[#0A0A0A] rounded-lg border border-[#1A1A1A] p-3 flex items-center relative overflow-hidden">
          {status === 'running' && (
            <div className="absolute inset-0 opacity-5 pointer-events-none bg-[radial-gradient(circle_at_30%_50%,_#00F0FF_0%,_transparent_50%)]" />
          )}
          <div className="w-full h-8 flex items-end gap-[2px]">
            {Array.from({ length: 60 }).map((_, i) => {
              const height = Math.sin(i * 0.3) * 0.4 + Math.random() * 0.3 + 0.3;
              return (
                <div
                  key={i}
                  className={`flex-1 rounded-t-sm transition-all duration-300 ${status === 'running' ? 'bg-[#00F0FF]/30' : status === 'completed' ? 'bg-emerald-400/20' : 'bg-[#222]'}`}
                  style={{ height: `${height * 100}%` }}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Log stream */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="flex items-center gap-2 px-5 py-2 border-b border-[#1A1A1A] shrink-0">
          <Terminal className="w-3 h-3 text-[#444]" />
          <span className={`w-1.5 h-1.5 rounded-full ${status === 'running' ? 'bg-amber-400 animate-pulse' : 'bg-[#333]'}`} />
          <span className="text-[10px] font-mono uppercase text-[#555] tracking-wider">Model Thought Stream</span>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-0.5 custom-scrollbar font-mono text-[11px]">
          {logs.length === 0 ? (
            <div className="text-[#333] animate-pulse">Awaiting initialization...</div>
          ) : (
            logs.map((log, i) => (
              <p key={i} className={`${getLogColor(log)} leading-relaxed`}>
                <span className="text-[#2A2A2A] mr-2 select-none">{String(i + 1).padStart(3, '0')}</span>
                {log.replace(/\[.*?\]\s*/, '')}
              </p>
            ))
          )}
          {status === 'running' && <p className="text-[#333] animate-pulse">█</p>}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
}
