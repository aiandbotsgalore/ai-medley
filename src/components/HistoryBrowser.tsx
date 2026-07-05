import React, { useEffect, useState } from "react";
import { Clock, Download, Trash2 } from "lucide-react";

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
    fetch("/api/history")
      .then((r) => r.json())
      .then(setEntries)
      .catch(() => {});
  }, []);

  const deleteEntry = async (entry: HistoryEntry) => {
    if (!window.confirm(`Delete the history entry from ${formatDate(entry.completedAt)}? The completed audio file will be preserved.`)) {
      return;
    }
    await fetch(`/api/history/${entry.id}`, { method: "DELETE" });
    setEntries((prev) => prev.filter((h) => h.id !== entry.id));
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return (
      d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }) +
      " · " +
      d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    );
  };

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
      <h2 className="text-[11px] uppercase tracking-widest text-[#999] mb-4 font-semibold flex items-center gap-2">
        <Clock aria-hidden="true" className="w-3 h-3" /> Session History
        <span className="text-[#333] font-mono">({entries.length})</span>
      </h2>
      {entries.length === 0 ? (
        <div className="text-[11px] font-mono text-[#444] border border-dashed border-[#222] p-8 rounded-lg text-center">
          No completed sessions yet.
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <article
              key={entry.id}
              className="p-3.5 bg-[#111] border border-[#333] rounded-lg hover:border-[#00F0FF]/50 hover:bg-[#00F0FF]/[0.02] transition-all duration-200"
            >
              <div className="flex items-start justify-between gap-3">
                <button
                  type="button"
                  onClick={() => onLoadSession(entry)}
                  aria-label={`Load session from ${formatDate(entry.completedAt)}`}
                  className="flex-1 min-w-0 text-left rounded"
                >
                  <time dateTime={entry.completedAt} className="block text-[11px] font-mono text-[#999] mb-1">
                    {formatDate(entry.completedAt)}
                  </time>
                  <p className="text-[11px] text-[#999] leading-relaxed italic line-clamp-2">
                    "{entry.summary || "No summary"}"
                  </p>
                  {entry.metrics?.overallScore !== undefined && (
                    <div className="mt-2 flex items-center gap-3">
                      <span className="text-[9px] font-mono text-[#00F0FF]">
                        Score: {entry.metrics.overallScore}%
                      </span>
                      {entry.metrics.iteration && (
                        <span className="text-[9px] font-mono text-[#444]">
                          {entry.metrics.iteration} iterations
                        </span>
                      )}
                    </div>
                  )}
                </button>
                <div className="flex items-center gap-1.5 shrink-0">
                  <a
                    href={`/api/audio/${entry.id}/download`}
                    aria-label={`Download MP3 from ${formatDate(entry.completedAt)}`}
                    className="w-10 h-10 flex items-center justify-center rounded-md border border-[#555] text-[#AAA] hover:text-[#00F0FF] hover:border-[#00F0FF]/60 transition-all"
                    title="Download MP3"
                  >
                    <Download aria-hidden="true" className="w-4 h-4" />
                  </a>
                  <button
                    type="button"
                    onClick={() => deleteEntry(entry)}
                    aria-label={`Delete session from ${formatDate(entry.completedAt)}`}
                    className="w-10 h-10 flex items-center justify-center rounded-md border border-[#555] text-[#AAA] hover:text-red-400 hover:border-red-400/60 transition-all"
                  >
                    <Trash2 aria-hidden="true" className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
