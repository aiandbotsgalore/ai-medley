import React from 'react';
import { Activity, HelpCircle, TrendingUp, ArrowRight, Zap } from 'lucide-react';

export interface ExecutionContextSummary {
  phase: string;
  currentAction: string;
  rationale: string;
  impact: string;
  nextStep: string;
}

interface ExecutionContextPanelProps {
  context: ExecutionContextSummary | null;
  status: string;
}

export default function ExecutionContextPanel({ context, status }: ExecutionContextPanelProps) {
  if (!context || status !== 'running') {
    return (
      <div className="h-full border border-[#1A1A1A] bg-[#0A0A0A] rounded-xl overflow-hidden flex flex-col">
        <div className="h-12 px-4 flex items-center border-b border-[#1A1A1A] bg-[#050505] shrink-0">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[1.5px] text-[#555] font-bold">
            <Zap className="w-3.5 h-3.5" />
            EXECUTION CONTEXT
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <div className="text-[#444] text-[11px] font-mono">
            {status === 'running'
              ? 'Agent is initializing...\nExecution context will appear after the first reasoning step.'
              : 'Execution context appears during autonomous runs.'}
          </div>
        </div>
      </div>
    );
  }

  const { phase, currentAction, rationale, impact, nextStep } = context;

  return (
    <div className="h-full border border-[#1A1A1A] bg-[#0A0A0A] rounded-xl overflow-hidden flex flex-col">
      {/* Header */}
      <div className="h-12 px-4 flex items-center justify-between border-b border-[#1A1A1A] bg-[#050505] shrink-0">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[1.5px] text-[#00F0FF] font-bold">
          <Activity className="w-3.5 h-3.5" />
          EXECUTION CONTEXT
        </div>
        <div className="text-[9px] font-mono text-[#444] px-2 py-0.5 rounded bg-[#111] border border-[#1A1A1A]">
          LIVE
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5 custom-scrollbar text-[11px]">
        {/* Phase */}
        <div>
          <div className="text-[#555] font-mono uppercase tracking-wider text-[9px] mb-1">PHASE</div>
          <div className="text-white font-medium leading-tight">{phase || '—'}</div>
        </div>

        {/* Current Action */}
        <div className="pt-2 border-t border-[#1A1A1A]">
          <div className="flex items-center gap-1.5 text-[#00F0FF] font-mono uppercase tracking-wider text-[9px] mb-1.5">
            <Zap className="w-3 h-3" /> CURRENT ACTION
          </div>
          <div className="text-[#DDD] leading-relaxed">{currentAction}</div>
        </div>

        {/* Why / Rationale */}
        <div className="pt-2 border-t border-[#1A1A1A]">
          <div className="flex items-center gap-1.5 text-[#F0C800] font-mono uppercase tracking-wider text-[9px] mb-1.5">
            <HelpCircle className="w-3 h-3" /> WHY
          </div>
          <div className="text-[#BBB] leading-relaxed">{rationale}</div>
        </div>

        {/* Impact */}
        <div className="pt-2 border-t border-[#1A1A1A]">
          <div className="flex items-center gap-1.5 text-emerald-400 font-mono uppercase tracking-wider text-[9px] mb-1.5">
            <TrendingUp className="w-3 h-3" /> IMPACT ON FINAL MEDLEY
          </div>
          <div className="text-[#BBB] leading-relaxed">{impact}</div>
        </div>

        {/* Next Step */}
        <div className="pt-2 border-t border-[#1A1A1A]">
          <div className="flex items-center gap-1.5 text-[#0080FF] font-mono uppercase tracking-wider text-[9px] mb-1.5">
            <ArrowRight className="w-3 h-3" /> WHAT HAPPENS NEXT
          </div>
          <div className="text-[#BBB] leading-relaxed">{nextStep}</div>
        </div>
      </div>

      {/* Footer hint */}
      <div className="px-4 py-2 border-t border-[#1A1A1A] bg-[#050505] text-[9px] text-[#444] font-mono shrink-0">
        Derived live from tool calls + phase. Does not alter agent behavior.
      </div>
    </div>
  );
}
