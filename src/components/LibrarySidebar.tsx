import React, { useRef, useState, useEffect } from 'react';
import { FileAudio, GripVertical, Play, Pause, X } from 'lucide-react';
import type { ProviderId } from './ConfigPanel';

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

function Waveform({ peaks, isPlaying }: { peaks: number[]; isPlaying: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || peaks.length === 0) return;
    const ctx = canvas.getContext('2d');
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
    ctx.fillStyle = isPlaying ? '#00F0FF' : '#333333';
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
}: {
  file: LibraryFile;
  canRemove: boolean;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onRemove: (id: string) => void;
}) {
  const [peaks, setPeaks] = useState<number[]>([]);
  const [duration, setDuration] = useState<number | null>(null);

  useEffect(() => {
    fetch(`/api/waveform/${file.id}`).then(r => r.json()).then(d => setPeaks(d.peaks || [])).catch(() => {});
    fetch(`/api/audio-probe/${file.id}`).then(r => r.json()).then(d => setDuration(d.duration || null)).catch(() => {});
  }, [file.id]);

  const formatDur = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="p-2.5 bg-[#111]/80 border border-[#222] rounded-lg group relative hover:border-[#00F0FF]/30 transition-all duration-200">
      <div className="flex items-center gap-2">
        <div className="cursor-grab text-[#333] group-hover:text-[#666] transition-colors">
          <GripVertical className="w-3.5 h-3.5" />
        </div>
        <button
          onClick={e => { e.stopPropagation(); onTogglePlay(); }}
          className="w-7 h-7 rounded-full bg-[#1A1A1A] border border-[#333] flex items-center justify-center shrink-0 hover:border-[#00F0FF] hover:bg-[#00F0FF]/10 transition-all"
        >
          {isPlaying ? <Pause className="w-3 h-3 text-[#00F0FF]" /> : <Play className="w-3 h-3 text-[#888] ml-0.5" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold truncate text-[#CCC]">{file.originalName}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[9px] font-mono text-[#555]">{(file.size / 1024 / 1024).toFixed(1)}MB</span>
            {duration && <span className="text-[9px] font-mono text-[#555]">{formatDur(duration)}</span>}
            <span className="text-[9px] font-mono text-[#555] uppercase">{file.originalName.split('.').pop()}</span>
          </div>
        </div>
        {canRemove && (
          <button onClick={() => onRemove(file.id)} className="text-[#444] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <Waveform peaks={peaks} isPlaying={isPlaying} />
      {file.analysis && (
        <div className="mt-1.5 text-[9px] text-[#444] font-mono truncate" title={file.analysis}>
          ✓ Analyzed
        </div>
      )}
    </div>
  );
}

export default function LibrarySidebar({ library, status, provider, apiReady, onRemove, onReorder }: LibrarySidebarProps) {
  const canModify = status === 'idle' || status === 'error';
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef(new Audio());

  useEffect(() => {
    const audio = audioRef.current;
    const onEnded = () => setPlayingId(null);
    audio.addEventListener('ended', onEnded);
    return () => audio.removeEventListener('ended', onEnded);
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
    onReorder(newLib.map(f => f.id));
    setDragIdx(idx);
  };

  return (
    <aside className="w-72 border-r border-[#1A1A1A] bg-[#090909] flex flex-col shrink-0">
      <div className="p-4 flex-1 overflow-y-auto custom-scrollbar">
        <div className="flex items-center justify-between mb-4">
          <div className="text-[10px] uppercase tracking-widest text-[#555] font-semibold flex items-center gap-2">
            <FileAudio className="w-3 h-3" /> Source Material
          </div>
          <span className="text-[10px] font-mono text-[#444]">{library.length} tracks</span>
        </div>
        {library.length > 0 ? (
          <div className="space-y-2">
            {library.map((file, i) => (
              <div
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
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[11px] font-mono text-[#444] border border-dashed border-[#222] p-6 rounded-lg text-center">
            <FileAudio className="w-6 h-6 mx-auto mb-2 text-[#333]" />
            Awaiting source audio...
          </div>
        )}
      </div>
      <div className="p-4 border-t border-[#1A1A1A] shrink-0">
        <div className="text-[10px] uppercase tracking-widest text-[#555] mb-3 font-semibold">Environment</div>
        <div className="space-y-1.5 font-mono text-[10px]">
          <div className="flex justify-between"><span className="text-[#666]">FFmpeg</span><span className="text-emerald-400">● READY</span></div>
          <div className="flex justify-between">
            <span className="text-[#666]">{provider === 'gemini' ? 'Gemini' : 'OpenRouter'}</span>
            <span className={apiReady ? 'text-emerald-400' : 'text-amber-400'}>{apiReady ? '● READY' : '● CONFIG NEEDED'}</span>
          </div>
          <div className="flex justify-between"><span className="text-[#666]">Files</span><span className="text-[#00F0FF]">{library.length} LOADED</span></div>
        </div>
      </div>
    </aside>
  );
}
