import React, { useState } from 'react';
import { AlertCircle, Download, Loader2 } from 'lucide-react';

interface MetricsSidebarProps {
  metrics: {
    emotionalArc?: number;
    transitionSmoothness?: number;
    performerIdentity?: number;
    overallScore?: number;
    iteration?: number;
  } | null;
  summary: string | null;
  status: string;
  sessionId: string | null;
}

function MetricBar({ label, value }: { label: string; value: number | undefined }) {
  const pct = value ?? 0;
  const hasValue = value !== undefined && value > 0;
  const color = pct >= 80 ? '#00F0FF' : pct >= 50 ? '#F0C800' : '#F27D26';

  return (
    <div>
      <div className="flex justify-between text-[10px] mb-1.5">
        <span className="text-[#888] font-medium">{label}</span>
        <span className="font-mono" style={{ color: hasValue ? color : '#444' }}>{hasValue ? `${pct}%` : '—'}</span>
      </div>
      <div className="h-1.5 bg-[#1A1A1A] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{
            width: `${pct}%`,
            background: hasValue ? `linear-gradient(90deg, ${color}88, ${color})` : '#222',
            boxShadow: hasValue ? `0 0 8px ${color}40` : 'none'
          }}
        />
      </div>
    </div>
  );
}

export default function MetricsSidebar({ metrics, summary, status, sessionId }: MetricsSidebarProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const exportAudio = async () => {
    if (!sessionId || isExporting) return;

    setIsExporting(true);
    setExportError(null);

    try {
      const res = await fetch(`/api/audio/${sessionId}/download`);
      const contentType = res.headers.get('content-type') || '';

      if (!res.ok || !contentType.toLowerCase().startsWith('audio/')) {
        let detail = '';
        try {
          const errorBody = await res.json();
          detail = errorBody?.error || '';
        } catch {
          detail = await res.text().catch(() => '');
        }
        throw new Error(detail || 'The medley MP3 is not available yet.');
      }

      const disposition = res.headers.get('content-disposition') || '';
      const filenameMatch = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
      const filename = filenameMatch
        ? decodeURIComponent(filenameMatch[1].replace(/"/g, ''))
        : `medley-${sessionId}.mp3`;

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: any) {
      setExportError(e?.message || 'Export failed.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <aside className="w-80 border-l border-[#1A1A1A] bg-[#090909] flex flex-col shrink-0">
      <div className="p-5 border-b border-[#1A1A1A]">
        <div className="text-[10px] uppercase tracking-widest text-[#555] mb-5 font-semibold">Refinement Metrics</div>
        <div className="space-y-4">
          <MetricBar label="EMOTIONAL ARC" value={metrics?.emotionalArc} />
          <MetricBar label="TRANSITION SMOOTHNESS" value={metrics?.transitionSmoothness} />
          <MetricBar label="PERFORMER IDENTITY" value={metrics?.performerIdentity} />
        </div>
        {metrics?.overallScore !== undefined && metrics.overallScore > 0 && (
          <div className="mt-5 pt-4 border-t border-[#1A1A1A]">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase text-[#888] font-semibold">Overall Score</span>
              <span className="text-2xl font-bold text-[#00F0FF] font-mono">{metrics.overallScore}</span>
            </div>
            {metrics.iteration && (
              <span className="text-[9px] font-mono text-[#444]">Iteration #{metrics.iteration}</span>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 p-5 overflow-y-auto custom-scrollbar flex flex-col">
        <div className="text-[10px] uppercase tracking-widest text-[#555] mb-4 font-semibold">Decision Summary</div>
        <div className="flex-1">
          {summary ? (
            <div className="text-[12px] leading-relaxed text-[#999] italic">
              "{summary}"
            </div>
          ) : (
            <div className="text-[11px] text-[#333] font-mono italic">
              Awaiting final synthesis...
            </div>
          )}
        </div>

        {status === 'completed' && sessionId && (
          <div className="mt-6 pt-4 border-t border-[#1A1A1A] space-y-2">
            <button
              type="button"
              onClick={exportAudio}
              disabled={isExporting}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-[#00F0FF] to-[#0080FF] text-black text-[11px] font-bold uppercase rounded-lg hover:shadow-lg hover:shadow-[#00F0FF]/20 transition-all duration-200 disabled:opacity-60 disabled:cursor-wait"
            >
              {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              Download MP3
            </button>
            {exportError && (
              <div className="flex items-start gap-2 text-[10px] leading-relaxed text-red-300 bg-red-950/20 border border-red-900/40 rounded-md px-2.5 py-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{exportError}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
