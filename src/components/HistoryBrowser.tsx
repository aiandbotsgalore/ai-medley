import React, { useEffect, useState } from 'react';
import { Clock, Download, Trash2 } from 'lucide-react';

export interface HistoryEntry {
  id: string;
  completedAt: string;
  summary: string;
  finalAudioPath: string;
  metrics?: {
    emotionalArc?: number;
    transitionSmoothness?: number;
    performerIdentity?: number;
    overallScore?: number;
    iteration?: number;
  };
}

interface HistoryBrowserProps {
  onLoadSession: (entry: HistoryEntry) => void;
}

export default function HistoryBrowser({ onLoadSession }: HistoryBrowserProps) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    fetch('/api/history').then(r => r.json()).then(setEntries).catch(() => {});
  }, []);

  const deleteEntry = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await fetch(`/api/history/${id}`, { method: 'DELETE' });
    setEntries(prev => prev.filter(h => h.id !== id));
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
      <div className="text-[10px] uppercase tracking-widest text-[#555] mb-4 font-semibold flex items-center gap-2">
        <Clock className="w-3 h-3" /> Session History
        <span className="text-[#333] font-mono">({entries.length})</span>
      </div>
      {entries.length === 0 ? (
        <div className="text-[11px] font-mono text-[#444] border border-dashed border-[#222] p-8 rounded-lg text-center">
          No completed sessions yet.
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map(entry => (
            <div
              key={entry.id}
              onClick={() => onLoadSession(entry)}
              className="p-3.5 bg-[#111] border border-[#222] rounded-lg cursor-pointer hover:border-[#00F0FF]/30 hover:bg-[#00F0FF]/[0.02] transition-all duration-200 group"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-mono text-[#444] mb-1">{formatDate(entry.completedAt)}</div>
                  <p className="text-[11px] text-[#999] leading-relaxed italic line-clamp-2">
                    "{entry.summary || 'No summary'}"
                  </p>
                  {entry.metrics?.overallScore !== undefined && (
                    <div className="mt-2 flex items-center gap-3">
                      <span className="text-[9px] font-mono text-[#00F0FF]">Score: {entry.metrics.overallScore}%</span>
                      {entry.metrics.iteration && (
                        <span className="text-[9px] font-mono text-[#444]">{entry.metrics.iteration} iterations</span>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <a
                    href={`/api/audio/${entry.id}/download`}
                    onClick={e => e.stopPropagation()}
                    className="w-7 h-7 flex items-center justify-center rounded-md border border-[#333] text-[#666] hover:text-[#00F0FF] hover:border-[#00F0FF]/40 transition-all"
                    title="Download MP3"
                  >
                    <Download className="w-3 h-3" />
                  </a>
                  <button
                    onClick={e => deleteEntry(entry.id, e)}
                    className="w-7 h-7 flex items-center justify-center rounded-md border border-[#333] text-[#666] hover:text-red-400 hover:border-red-400/40 transition-all"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
