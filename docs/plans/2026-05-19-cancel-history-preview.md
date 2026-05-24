# Cancel + History + Library Preview Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add three features: a cancel button for running sessions, a history browser tab, and shared-audio library preview with canvas waveforms.

**Architecture:** All three tasks are self-contained UI changes. Task 1 threads an AbortController through App.tsx's fetch calls and adds a stop button to Header. Task 2 creates a HistoryBrowser component and a tab bar in the central panel, plus a one-time server-side preload so historical audio is playable after restart. Task 3 refactors LibrarySidebar to use a single shared Audio instance (currently each TrackItem has its own) and converts the existing div-based waveform bars to a canvas element.

**Tech Stack:** React 19, TypeScript, Tailwind v4, Express (server.ts), Lucide React icons

---

## Task 1: Cancel Button

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Header.tsx`

**Key context:** `runAutonomousLoop` (App.tsx:108) contains 9 bare `fetch()` calls and a `while` loop that runs up to 50 iterations. None have abort signals. `Header` currently receives only `status` and `onConfigClick`.

---

**Step 1: Add AbortController ref to App.tsx**

After `fileInputRef` (line 25), add:
```tsx
const abortRef = useRef<AbortController | null>(null);
```

**Step 2: Create and store AbortController in startMedley**

In `startMedley` (line 305), before `setStatus('running')`, add:
```tsx
abortRef.current = new AbortController();
```

Change the call at the bottom from:
```tsx
runAutonomousLoop(library);
```
to:
```tsx
runAutonomousLoop(library, abortRef.current.signal);
```

**Step 3: Update runAutonomousLoop signature**

Change line 108 from:
```tsx
const runAutonomousLoop = async (lib: LibraryFile[]) => {
```
to:
```tsx
const runAutonomousLoop = async (lib: LibraryFile[], signal: AbortSignal) => {
```

**Step 4: Add abort check at top of while loop**

At the top of the `while` body (after line 155), add:
```tsx
if (signal.aborted) break;
```

**Step 5: Pass signal to all fetch calls inside runAutonomousLoop**

Add `signal` to these 8 fetch calls (do NOT thread it into `fetchLibrary` — that's a side-effect refresh):
- `/api/exec` fetch (line ~179)
- `/api/audio-raw/${entry.id}` fetch (line ~202)
- `/api/library/cache` fetch (line ~217)
- `/api/file-read` fetch (line ~232)
- `/api/file-write` fetch (line ~236)
- `/api/library/analysis` fetch (line ~244)
- `/api/session/metrics` fetch (line ~262)
- `/api/session/finish` fetch (line ~272)

For POST calls add `signal` inside the existing options object. For GET calls add `{ signal }` as second argument.

**Step 6: Catch AbortError before the generic error handler**

In the outer `catch` block (line ~297), prepend:
```tsx
if (e.name === 'AbortError') {
  addLog('🛑 Session cancelled.');
  setStatus('idle');
  setErrorMessage(null);
  return;
}
```

**Step 7: Add handleCancel to App.tsx**

```tsx
const handleCancel = () => {
  abortRef.current?.abort();
  setStatus('idle');
  setLogs([]);
  setMetrics(null);
  setSummary(null);
  setSessionId(null);
  setErrorMessage(null);
};
```

**Step 8: Pass onCancel to Header**

Change:
```tsx
<Header status={status} onConfigClick={() => setShowConfig(true)} />
```
to:
```tsx
<Header status={status} onConfigClick={() => setShowConfig(true)} onCancel={handleCancel} />
```

**Step 9: Update Header.tsx**

Add `onCancel?: () => void` to `HeaderProps`.

Import `Square` from `lucide-react`.

After the gear button, add:
```tsx
{status === 'running' && (
  <button
    onClick={onCancel}
    title="Cancel session"
    className="w-8 h-8 rounded-lg border border-red-500/40 bg-red-500/10 flex items-center justify-center text-red-400 hover:bg-red-500/20 hover:border-red-400 transition-all duration-200"
  >
    <Square className="w-3.5 h-3.5 fill-current" />
  </button>
)}
```

**Step 10: Verify manually**

`npm run dev` → upload 2+ tracks → click Initialize Architecture → confirm red stop button appears in header → click it → confirm UI resets to idle with library intact and no error message shown.

**Step 11: Commit**
```bash
git add src/App.tsx src/components/Header.tsx
git commit -m "feat: add cancel button to abort running AI session"
```

---

## Task 2: History Browser Tab

**Files:**
- Modify: `server.ts`
- Create: `src/components/HistoryBrowser.tsx`
- Modify: `src/App.tsx`

**Key context:** `GET /api/history` returns up to 50 entries from `library/history.json`. Each entry has `{ id, completedAt, summary, finalAudioPath, metrics }`. `GET /api/audio/:id` serves a session's output MP3, but reads from the in-memory `sessions` object — which is empty after a server restart. Historical audio is unplayable after restart without a fix. `server.ts` already reads `history.json` at startup via `getHistory()`.

---

**Step 1: Preload history into sessions map on server startup**

In `server.ts`, after the library/audio/db/history directory init block (after line 32), add:
```ts
// Restore completed sessions from history so /api/audio/:id works after restart
for (const entry of getHistory()) {
  if (entry.finalAudioPath && fs.existsSync(entry.finalAudioPath)) {
    sessions[entry.id] = {
      status: 'completed',
      logs: [],
      finalAudioPath: entry.finalAudioPath,
      summary: entry.summary,
      metrics: entry.metrics
    };
  }
}
```

**Step 2: Create src/components/HistoryBrowser.tsx**

```tsx
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
                    href={`/api/audio/${entry.id}`}
                    download
                    onClick={e => e.stopPropagation()}
                    className="w-7 h-7 flex items-center justify-center rounded-md border border-[#333] text-[#666] hover:text-[#00F0FF] hover:border-[#00F0FF]/40 transition-all"
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
```

**Step 3: Add tab state to App.tsx**

Add to state declarations:
```tsx
const [activeTab, setActiveTab] = useState<'workshop' | 'history'>('workshop');
```

Import `HistoryBrowser` and `{ HistoryEntry }` from `./components/HistoryBrowser`.

**Step 4: Add loadFromHistory handler**

```tsx
const loadFromHistory = (entry: HistoryEntry) => {
  setSessionId(entry.id);
  setSummary(entry.summary);
  setMetrics(entry.metrics ?? null);
  setStatus('completed');
  setLogs([]);
  setActiveTab('workshop');
};
```

**Step 5: Replace the central <section> in App.tsx JSX**

Replace the existing `<section className="flex-1 ...">` block with:
```tsx
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

  {activeTab === 'history' ? (
    <HistoryBrowser onLoadSession={loadFromHistory} />
  ) : isIdle ? (
    <div className="flex-1 p-8 flex flex-col items-center justify-center">
      {/* paste existing drop zone JSX here verbatim */}
    </div>
  ) : (
    <LogPanel status={status} logs={logs} />
  )}
</section>
```

**Step 6: Verify manually**

Complete a short session. Click History tab — entry appears. Click the row — Workshop tab loads with completed state, audio player shows in footer, Export Output button visible in MetricsSidebar. Restart dev server — click History tab — audio download still works (confirms server preload works).

**Step 7: Commit**
```bash
git add server.ts src/components/HistoryBrowser.tsx src/App.tsx
git commit -m "feat: add history browser tab with session replay and audio preload"
```

---

## Task 3: Shared Audio + Canvas Waveform

**Files:**
- Modify: `src/components/LibrarySidebar.tsx`

**Key context:** `TrackItem` (LibrarySidebar.tsx:23) already fetches waveform data from `/api/waveform/:id` and renders it as `<div>` bars. It already has per-track play/pause via an `<audio ref>`. The problem: each `TrackItem` owns its own `HTMLAudioElement`, so clicking play on track B while track A plays does NOT stop track A. The task lifts audio to a single shared instance in `LibrarySidebar` and converts the div bars to a `<canvas>`.

---

**Step 1: Update TrackItem props interface**

Replace the existing `TrackItem` component signature. Remove internal `playing` state, `audioRef`, `togglePlay`. New props:

```tsx
function TrackItem({
  file, canRemove, onRemove, isPlaying, onTogglePlay
}: {
  file: LibraryFile;
  canRemove: boolean;
  onRemove: (id: string) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
}) {
```

**Step 2: Replace div waveform with canvas in TrackItem**

Keep `peaks` state and its fetch effect. Add a canvas ref and a draw effect:

```tsx
const canvasRef = useRef<HTMLCanvasElement>(null);

useEffect(() => {
  const canvas = canvasRef.current;
  if (!canvas || peaks.length === 0) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  const barW = 2;
  const gap = 1;
  const step = Math.max(1, Math.floor(peaks.length / Math.floor(width / (barW + gap))));
  const sampled = peaks.filter((_, i) => i % step === 0);
  ctx.fillStyle = isPlaying ? '#00F0FF' : '#333333';
  sampled.forEach((p, i) => {
    const h = Math.max(2, p * height);
    ctx.fillRect(i * (barW + gap), (height - h) / 2, barW, h);
  });
}, [peaks, isPlaying]);
```

Replace the div waveform block:
```tsx
{peaks.length > 0 && (
  <canvas
    ref={canvasRef}
    width={220}
    height={24}
    className="mt-2 w-full opacity-50 group-hover:opacity-80 transition-opacity rounded-sm"
  />
)}
```

**Step 3: Update play button and remove <audio> from TrackItem**

Replace:
```tsx
<button onClick={togglePlay} ...>
  {playing ? <Pause .../> : <Play .../>}
</button>
```
with:
```tsx
<button onClick={e => { e.stopPropagation(); onTogglePlay(); }} ...>
  {isPlaying ? <Pause .../> : <Play .../>}
</button>
```

Delete the `<audio ref={audioRef} .../>` element from the JSX.
Remove the `playing` state, `audioRef`, `togglePlay` function, and the `duration` state + its fetch (duration fetch can stay if desired, or remove for simplicity — the probe fetch is separate from the audio element).

**Step 4: Add shared audio state to LibrarySidebar**

At the top of the `LibrarySidebar` function, add:
```tsx
const [playingId, setPlayingId] = useState<string | null>(null);
const sharedAudio = useRef(new Audio());

useEffect(() => {
  const audio = sharedAudio.current;
  const onEnded = () => setPlayingId(null);
  audio.addEventListener('ended', onEnded);
  return () => audio.removeEventListener('ended', onEnded);
}, []);

const handleTogglePlay = (id: string) => {
  const audio = sharedAudio.current;
  if (playingId === id) {
    audio.pause();
    setPlayingId(null);
  } else {
    audio.pause();
    audio.src = `/api/audio-raw/${id}`;
    audio.play().catch(() => {});
    setPlayingId(id);
  }
};
```

**Step 5: Pass new props to TrackItem in the render loop**

Change:
```tsx
<TrackItem file={file} canRemove={canModify} onRemove={onRemove} />
```
to:
```tsx
<TrackItem
  file={file}
  canRemove={canModify}
  onRemove={onRemove}
  isPlaying={playingId === file.id}
  onTogglePlay={() => handleTogglePlay(file.id)}
/>
```

**Step 6: Verify manually**

Load sidebar with 2+ tracks. Confirm waveform canvas bars render. Click play on track 1 — plays, waveform turns cyan. Click play on track 2 — track 1 stops, track 2 starts. Track ends naturally — button resets to play icon.

**Step 7: Commit**
```bash
git add src/components/LibrarySidebar.tsx
git commit -m "feat: shared audio instance and canvas waveform in library sidebar"
```
