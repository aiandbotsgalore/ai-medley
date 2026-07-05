import React, { useRef, useState, useEffect } from "react";
import {
  ArrowDown,
  ArrowUp,
  FileAudio,
  GripVertical,
  Play,
  Pause,
  X,
} from "lucide-react";
import type { ProviderId } from "./ConfigPanel";
import { moveItem } from "../utils/accessibility";

export interface LibraryFile {
  id: string;
  originalName: string;
  filename: string;
  path: string;
  size: number;
  mimeType: string;
  analysis?: string;
  localAnalysis?: unknown;
  medleyIntelligence?: any;
  geminiFileUri?: string;
  geminiFileExpires?: number;
}

interface LibrarySidebarProps {
  library: LibraryFile[];
  status: string;
  provider: ProviderId;
  apiReady: boolean;
  onRemove: (id: string) => void;
  onReorder: (ids: string[]) => void;
}

function Waveform({
  peaks,
  isPlaying,
}: {
  peaks: number[];
  isPlaying: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || peaks.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    const BAR_W = 2;
    const GAP = 1;
    const stride = BAR_W + GAP;
    const count = Math.floor(W / stride);
    ctx.fillStyle = isPlaying ? "#00F0FF" : "#333333";
    for (let i = 0; i < count; i++) {
      const idx = Math.floor((i / count) * peaks.length);
      const barH = Math.max(2, peaks[idx] * H);
      ctx.fillRect(i * stride, (H - barH) / 2, BAR_W, barH);
    }
  }, [peaks, isPlaying]);

  if (peaks.length === 0) return null;
  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="mt-2 w-full h-6 opacity-50 group-hover:opacity-80 transition-opacity"
    />
  );
}

function TrackItem({
  file,
  canRemove,
  isPlaying,
  onTogglePlay,
  onRemove,
  position,
  total,
  onMove,
}: {
  file: LibraryFile;
  canRemove: boolean;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onRemove: (id: string) => void;
  position: number;
  total: number;
  onMove: (delta: -1 | 1) => void;
}) {
  const [peaks, setPeaks] = useState<number[]>([]);
  const [duration, setDuration] = useState<number | null>(null);

  useEffect(() => {
    fetch(`/api/waveform/${file.id}`)
      .then((r) => r.json())
      .then((d) => setPeaks(d.peaks || []))
      .catch(() => {});
    fetch(`/api/audio-probe/${file.id}`)
      .then((r) => r.json())
      .then((d) => setDuration(d.duration || null))
      .catch(() => {});
  }, [file.id]);

  const formatDur = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="p-2.5 bg-[#111]/80 border border-[#222] rounded-lg group relative hover:border-[#00F0FF]/30 transition-all duration-200">
      <div className="flex items-center gap-2">
        <div aria-hidden="true" className="cursor-grab text-[#777] transition-colors">
          <GripVertical className="w-3.5 h-3.5" />
        </div>
        <button
          type="button"
          aria-label={`${isPlaying ? "Pause" : "Play"} ${file.originalName}`}
          onClick={(e) => {
            e.stopPropagation();
            onTogglePlay();
          }}
          className="w-10 h-10 rounded-full bg-[#1A1A1A] border border-[#555] flex items-center justify-center shrink-0 hover:border-[#00F0FF] hover:bg-[#00F0FF]/10 transition-all"
        >
          {isPlaying ? (
            <Pause className="w-3 h-3 text-[#00F0FF]" />
          ) : (
            <Play className="w-3 h-3 text-[#888] ml-0.5" />
          )}
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold truncate text-[#CCC]">
            {file.originalName}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[9px] font-mono text-[#555]">
              {(file.size / 1024 / 1024).toFixed(1)}MB
            </span>
            {duration && (
              <span className="text-[9px] font-mono text-[#555]">
                {formatDur(duration)}
              </span>
            )}
            <span className="text-[9px] font-mono text-[#555] uppercase">
              {file.originalName.split(".").pop()}
            </span>
          </div>
        </div>
        {canRemove && (
          <div role="group" className="flex items-center gap-1" aria-label={`Reorder and remove ${file.originalName}`}>
            <button
              type="button"
              onClick={onMove.bind(null, -1)}
              disabled={position === 0}
              aria-label={`Move ${file.originalName} up`}
              className="w-8 h-8 flex items-center justify-center rounded text-[#AAA] hover:text-[#00F0FF] disabled:opacity-30 transition-all"
            >
              <ArrowUp aria-hidden="true" className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onMove.bind(null, 1)}
              disabled={position === total - 1}
              aria-label={`Move ${file.originalName} down`}
              className="w-8 h-8 flex items-center justify-center rounded text-[#AAA] hover:text-[#00F0FF] disabled:opacity-30 transition-all"
            >
              <ArrowDown aria-hidden="true" className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onRemove(file.id)}
              aria-label={`Remove ${file.originalName}`}
              className="w-8 h-8 flex items-center justify-center rounded text-[#AAA] hover:text-red-400 transition-all"
            >
              <X aria-hidden="true" className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
      <Waveform peaks={peaks} isPlaying={isPlaying} />
      {file.analysis && (
        <div
          className="mt-1.5 text-[9px] text-[#444] font-mono truncate"
          title={file.analysis}
        >
          ✓ Analyzed
        </div>
      )}
    </div>
  );
}

export default function LibrarySidebar({
  library,
  status,
  provider,
  apiReady,
  onRemove,
  onReorder,
}: LibrarySidebarProps) {
  const canModify = status === "idle" || status === "error";
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef(new Audio());

  useEffect(() => {
    const audio = audioRef.current;
    const onEnded = () => setPlayingId(null);
    audio.addEventListener("ended", onEnded);
    return () => audio.removeEventListener("ended", onEnded);
  }, []);

  const togglePlay = (file: LibraryFile) => {
    const audio = audioRef.current;
    if (playingId === file.id) {
      audio.pause();
      setPlayingId(null);
    } else {
      audio.pause();
      audio.src = `/api/audio-raw/${file.id}`;
      setPlayingId(file.id);
      audio.play().catch(() => {
        setPlayingId(null);
      });
    }
  };

  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const newLib = [...library];
    const [moved] = newLib.splice(dragIdx, 1);
    newLib.splice(idx, 0, moved);
    onReorder(newLib.map((f) => f.id));
    setDragIdx(idx);
  };

  const moveTrack = (idx: number, delta: -1 | 1) => {
    const reordered = moveItem(library, idx, delta);
    onReorder(reordered.map((file) => file.id));
  };

  return (
    <aside className="w-full md:w-72 max-h-[55vh] md:max-h-none border-b md:border-b-0 md:border-r border-[#1A1A1A] bg-[#090909] flex flex-col shrink-0">
      <div className="p-4 flex-1 overflow-y-auto custom-scrollbar">
        <div className="flex items-center justify-between mb-4">
          <div className="text-[10px] uppercase tracking-widest text-[#555] font-semibold flex items-center gap-2">
            <FileAudio className="w-3 h-3" /> Source Material
          </div>
          <span className="text-[10px] font-mono text-[#444]">
            {library.length} tracks
          </span>
        </div>
        {library.length > 0 ? (
          <ol className="space-y-2" aria-label="Source track order">
            {library.map((file, i) => (
              <li
                key={file.id}
                draggable={canModify}
                onDragStart={() => handleDragStart(i)}
                onDragOver={(e) => handleDragOver(e, i)}
                onDragEnd={() => setDragIdx(null)}
              >
                <TrackItem
                  file={file}
                  canRemove={canModify}
                  isPlaying={playingId === file.id}
                  onTogglePlay={() => togglePlay(file)}
                  onRemove={onRemove}
                  position={i}
                  total={library.length}
                  onMove={(delta) => moveTrack(i, delta)}
                />
              </li>
            ))}
          </ol>
        ) : (
          <div className="text-[11px] font-mono text-[#444] border border-dashed border-[#222] p-6 rounded-lg text-center">
            <FileAudio className="w-6 h-6 mx-auto mb-2 text-[#333]" />
            Awaiting source audio...
          </div>
        )}
      </div>
      <div className="p-4 border-t border-[#1A1A1A] shrink-0">
        <div className="text-[10px] uppercase tracking-widest text-[#555] mb-3 font-semibold">
          Environment
        </div>
        <div className="space-y-1.5 font-mono text-[10px]">
          <div className="flex justify-between">
            <span className="text-[#666]">FFmpeg</span>
            <span className="text-emerald-400">● READY</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#666]">
              {provider === "gemini" ? "Gemini" : "OpenRouter"}
            </span>
            <span className={apiReady ? "text-emerald-400" : "text-amber-400"}>
              {apiReady ? "● READY" : "● CONFIG NEEDED"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#666]">Files</span>
            <span className="text-[#00F0FF]">{library.length} LOADED</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
