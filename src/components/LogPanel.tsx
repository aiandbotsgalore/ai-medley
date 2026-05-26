import React, { useRef, useEffect, useState } from 'react';
import { Sparkles, FileCheck2, Loader2, Terminal, Clock } from 'lucide-react';

interface LogPanelProps {
  status: string;
  logs: string[];
  iteration?: { current: number; max: number } | null;
  runStartedAt?: number | null;
}

const PHASES = ['ANALYZE', 'DESIGN', 'BUILD', 'EVALUATE', 'FINISH'] as const;

function detectPhaseIndex(logs: string[]): number {
  const recent = logs.slice(-20).join(' ').toLowerCase();
  if (recent.includes('finalize') || recent.includes('target achieved') || recent.includes('finish')) return 4;
  if (recent.includes('quality') || recent.includes('evaluate') || recent.includes('refin')) return 3;
  if (recent.includes('apply_musical') || recent.includes('render') || recent.includes('build')) return 2;
  if (recent.includes('design_plan') || recent.includes('evaluate_section') || recent.includes('design')) return 1;
  return 0;
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function extractTimestamp(log: string): string {
  const match = log.match(/^\[([^\]]+)\]/);
  return match ? match[1] : '';
}

export default function LogPanel({ status, logs, iteration, runStartedAt }: LogPanelProps) {
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  useEffect(() => {
    if (status !== 'running' || !runStartedAt) {
      setElapsed(0);
      return;
    }
    const tick = () => setElapsed(Date.now() - runStartedAt);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [status, runStartedAt]);

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
  const currentPhaseIdx = status === 'running' ? detectPhaseIndex(logs) : status === 'completed' ? PHASES.length - 1 : -1;

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

      {/* Progress strip — elapsed timer + phase pipeline */}
      <div className="h-24 px-5 py-3 border-b border-[#1A1A1A] bg-[#050505] shrink-0">
        <div className="h-full bg-[#0A0A0A] rounded-lg border border-[#1A1A1A] px-3 py-2 flex flex-col justify-between relative overflow-hidden">
          {status === 'running' && (
            <div className="absolute inset-0 opacity-5 pointer-events-none bg-[radial-gradient(circle_at_30%_50%,_#00F0FF_0%,_transparent_50%)]" />
          )}
          {/* Elapsed timer */}
          <div className="flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-[#444]" />
            <span className="text-[11px] font-mono">
              {status === 'running' && runStartedAt
                ? <span className="text-[#00F0FF] tabular-nums">{formatElapsed(elapsed)}</span>
                : status === 'completed'
                ? <span className="text-emerald-400">Complete</span>
                : <span className="text-[#333]">—</span>}
            </span>
          </div>
          {/* Phase progress strip */}
          <div className="flex items-end gap-1">
            {PHASES.map((phase, i) => {
              const isActive = i === currentPhaseIdx && status === 'running';
              const isDone = i < currentPhaseIdx || status === 'completed';
              return (
                <React.Fragment key={phase}>
                  <div className="flex-1 flex flex-col items-center gap-0.5">
                    <div
                      className={`h-1 w-full rounded-full transition-all duration-500 ${
                        isDone ? 'bg-emerald-400/60' :
                        isActive ? 'bg-[#00F0FF] animate-pulse' :
                        'bg-[#1A1A1A]'
                      }`}
                    />
                    <span className={`text-[8px] font-mono uppercase tracking-wide transition-colors duration-300 ${
                      isDone ? 'text-emerald-400/50' :
                      isActive ? 'text-[#00F0FF]' :
                      'text-[#2A2A2A]'
                    }`}>
                      {phase}
                    </span>
                  </div>
                  {i < PHASES.length - 1 && (
                    <div className={`w-2 h-px shrink-0 mb-3.5 transition-colors duration-300 ${isDone ? 'bg-emerald-400/30' : 'bg-[#1A1A1A]'}`} />
                  )}
                </React.Fragment>
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
            logs.map((log, i) => {
              const ts = extractTimestamp(log);
              const text = log.replace(/^\[.*?\]\s*/, '');
              return (
                <p key={i} className={`${getLogColor(log)} leading-relaxed flex gap-2`}>
                  <span className="text-[#2A2A2A] shrink-0 select-none">{String(i + 1).padStart(3, '0')}</span>
                  {ts && <span className="text-[#3A3A3A] shrink-0 select-none tabular-nums">{ts}</span>}
                  <span>{text}</span>
                </p>
              );
            })
          )}
          {status === 'running' && <p className="text-[#333] animate-pulse">█</p>}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
}
