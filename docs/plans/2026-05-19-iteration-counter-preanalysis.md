# Iteration Counter + Pre-Analysis Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Surface loop progress to the user (Task 3) and pre-analyze all unanalyzed library tracks before the autonomous loop starts so the AI can skip Phase 1 and spend more iterations on medley construction (Task 5).

**Architecture:**
Task 3 adds an `iteration` state to App.tsx, pipes it into LogPanel, and renders a small SVG arc ring + "N/50" label in the existing LogPanel header. Task 5 adds a `preAnalyzeLibrary` function that runs before `runAutonomousLoop` in `startMedley` — it uploads each unanalyzed file to Gemini Files API, sends a one-shot `generateContent` call for BPM/key/mood analysis, and persists the result via the existing `/api/library/analysis` endpoint.

**Tech Stack:** React 19, `@google/genai` SDK (already imported), Tailwind v4, TypeScript, `npm run lint` for type-checking (no test runner).

---

## Task 3: Iteration Progress Indicator

**Files:**
- Modify: `src/App.tsx` — add state, set in loop, pass to LogPanel
- Modify: `src/components/LogPanel.tsx` — accept prop, render ring + counter

---

### Step 1: Add `iteration` state to App.tsx

In `src/App.tsx`, find the block of `useState` calls near the top of the component (around line 14–29). Add one line after the `uploadProgress` state:

```tsx
const [iteration, setIteration] = useState<{ current: number; max: number } | null>(null);
```

### Step 2: Reset `iteration` at loop start

In `runAutonomousLoop`, find the block that resets state at the top of the function (around line 119–122, where `setLogs([])`, `setSummary(null)`, `setMetrics(null)` live). Add:

```tsx
setIteration(null);
```

### Step 3: Update `iteration` on each loop tick

In the `while` loop body, find the line `iterations++;` (around line 164). Immediately after it, add:

```tsx
setIteration({ current: iterations, max: MAX_ITERATIONS });
```

### Step 4: Clear `iteration` on cancel

In the `AbortError` catch block (around line 312–319), find the block that resets `setStatus`, `setLogs`, etc. Add:

```tsx
setIteration(null);
```

### Step 5: Pass `iteration` down to LogPanel

Find the `<LogPanel>` usage in the render (around line 404). Change it from:

```tsx
<LogPanel status={status} logs={logs} />
```

to:

```tsx
<LogPanel status={status} logs={logs} iteration={iteration} />
```

### Step 6: Add `iteration` prop to LogPanel

In `src/components/LogPanel.tsx`, update the `LogPanelProps` interface:

```tsx
interface LogPanelProps {
  status: string;
  logs: string[];
  iteration?: { current: number; max: number } | null;
}
```

Update the function signature to destructure it:

```tsx
export default function LogPanel({ status, logs, iteration }: LogPanelProps) {
```

### Step 7: Add the progress ring + counter to the LogPanel header

In `LogPanel`, find the `running` branch of the phase header (the `<><Sparkles ...> Autonomous Construction</>` line). Replace that branch only with:

```tsx
) : status === 'running' ? (
  <>
    {iteration ? (
      <svg width="22" height="22" viewBox="0 0 22 22" className="shrink-0">
        <circle cx="11" cy="11" r="8" fill="none" stroke="#1A1A1A" strokeWidth="2" />
        <circle
          cx="11" cy="11" r="8" fill="none"
          stroke="#00F0FF" strokeWidth="2"
          strokeDasharray={`${2 * Math.PI * 8}`}
          strokeDashoffset={`${2 * Math.PI * 8 * (1 - iteration.current / iteration.max)}`}
          strokeLinecap="round"
          transform="rotate(-90 11 11)"
          className="transition-all duration-300"
        />
      </svg>
    ) : (
      <Sparkles className="w-4 h-4 text-[#00F0FF]" />
    )}
    <span className="text-[#00F0FF]">Autonomous Construction</span>
    {iteration && (
      <span className="ml-auto text-[10px] font-mono text-[#444]">
        {iteration.current}<span className="text-[#2A2A2A]">/{iteration.max}</span>
      </span>
    )}
  </>
```

### Step 8: Verify with lint

```
npm run lint
```

Expected: same 2 pre-existing errors, nothing new. If new TS errors appear, fix them before continuing.

### Step 9: Verify visually

Run `npm run dev`, open `http://localhost:3000`, start a session with 2+ tracks. Confirm:
- The SVG ring arc grows with each iteration
- "12/50" style counter appears in the header right edge
- Ring and counter disappear when session is cancelled or a new session starts

### Step 10: Commit

```
git add src/App.tsx src/components/LogPanel.tsx
git commit -m "feat: add iteration progress ring and counter to LogPanel"
```

---

## Task 5: Pre-Analysis Pipeline

**Files:**
- Modify: `src/App.tsx` — add `preAnalyzeLibrary` function, call from `startMedley`

---

### Step 1: Understand what pre-analysis replaces

The AI loop's Phase 1 calls `listen_to_audio` for each unanalyzed track. That tool:
1. Checks if a cached Gemini File URI exists and is unexpired
2. If not, uploads via `ai.files.upload` + polls until ACTIVE
3. Caches the URI via `/api/library/cache`
4. Returns `{ status: 'Audio ready.' }` + pushes `fileData` to `mediaParts`

The AI then receives the audio and produces analysis text, saved via `save_file_analysis`.

Pre-analysis replicates this using `ai.models.generateContent` (one-shot, no chat) before the loop starts. Files already having `analysis` text in `library` are skipped.

### Step 2: Add `preAnalyzeLibrary` to App.tsx

Add this function in `src/App.tsx` directly above the `startMedley` function. It uses `addLog`, `fetchLibrary`, and the already-imported `GoogleGenAI`:

```tsx
const preAnalyzeLibrary = async (lib: LibraryFile[], signal: AbortSignal): Promise<void> => {
  const unanalyzed = lib.filter(f => !f.analysis);
  if (unanalyzed.length === 0) return;

  addLog(`🔬 Pre-analyzing ${unanalyzed.length} track(s) before session starts...`);
  const ai = new GoogleGenAI({ apiKey: geminiApiKey });

  for (const entry of unanalyzed) {
    if (signal.aborted) return;
    addLog(`  📡 Uploading: ${entry.originalName}`);

    try {
      // Check cache first
      let geminiUri: string | null = null;
      if (entry.geminiFileUri && entry.geminiFileExpires && Date.now() < entry.geminiFileExpires) {
        geminiUri = entry.geminiFileUri;
        addLog(`  ✓ Using cached URI for ${entry.originalName}`);
      } else {
        // Fetch raw audio bytes and upload to Gemini Files API
        const audioRes = await fetch(`/api/audio-raw/${entry.id}`, { signal });
        const audioBlob = await audioRes.blob();
        const uploadedFile = await ai.files.upload({
          file: new File([audioBlob], entry.originalName, { type: entry.mimeType }),
          config: { mimeType: entry.mimeType, displayName: entry.originalName }
        });

        // Poll until ACTIVE
        let fileInfo = uploadedFile;
        while (fileInfo.state === 'PROCESSING') {
          if (signal.aborted) return;
          await new Promise(r => setTimeout(r, 2000));
          fileInfo = await ai.files.get(uploadedFile.name!);
        }

        if (fileInfo.state !== 'ACTIVE') {
          addLog(`  ⚠️ Upload failed for ${entry.originalName} (state: ${fileInfo.state})`);
          continue;
        }

        geminiUri = fileInfo.uri!;
        const expires = Date.now() + (48 * 60 * 60 * 1000) - (60 * 1000);
        await fetch('/api/library/cache', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileId: entry.id, geminiFileUri: geminiUri, geminiFileExpires: expires }),
          signal
        });
      }

      // One-shot analysis
      addLog(`  🎵 Analyzing: ${entry.originalName}`);
      const result = await ai.models.generateContent({
        model: config.model,
        contents: [{
          role: 'user',
          parts: [
            { text: 'Analyze this audio track and provide: BPM (if discernible), musical key, mood/genre, energy level (1-10), and a 2-3 sentence structural summary. Be concise.' },
            { fileData: { fileUri: geminiUri, mimeType: entry.mimeType } }
          ]
        }]
      });
      const analysisText = result.text ?? '';

      if (analysisText) {
        await fetch('/api/library/analysis', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileId: entry.id, analysisText }),
          signal
        });
        addLog(`  ✅ Analyzed: ${entry.originalName}`);
      }
    } catch (e: any) {
      if (e.name === 'AbortError') return;
      addLog(`  ⚠️ Pre-analysis failed for ${entry.originalName}: ${e.message}`);
      // Non-fatal: the AI loop will analyze it normally
    }
  }

  await fetchLibrary(); // Refresh so runAutonomousLoop gets updated lib with analysis data
  addLog('✅ Pre-analysis complete. Handing off to Architect...');
};
```

### Step 3: Call `preAnalyzeLibrary` from `startMedley`

In `startMedley`, find the lines after the health check succeeds (around line 371–372):

```tsx
addLog('✅ System online. Initializing Architect...');
runAutonomousLoop(library, abortRef.current.signal);
```

Replace with:

```tsx
addLog('✅ System online. Initializing Architect...');
await preAnalyzeLibrary(library, abortRef.current.signal);
if (abortRef.current?.signal.aborted) return;
// Re-read library so the loop gets fresh analysis data
const freshLib = await fetch('/api/library').then(r => r.json()).catch(() => library);
runAutonomousLoop(freshLib, abortRef.current.signal);
```

Note: `startMedley` is already `async`, so `await` is valid here.

### Step 4: Verify with lint

```
npm run lint
```

Expected: same 2 pre-existing errors only. Common issues to watch for:
- `ai.models.generateContent` return type — `result.text` may need `result.text ?? ''`
- `entry.geminiFileUri`/`entry.geminiFileExpires` — these are optional on `LibraryFile`; use `&&` guards (already done in the code above)

### Step 5: Verify behavior

Run `npm run dev`. Load 2+ tracks where at least one has no analysis (check `library/db.json` — `analysis` field absent or null).

Start a session. In the log stream, confirm you see:
```
🔬 Pre-analyzing 2 track(s) before session starts...
  📡 Uploading: track1.mp3
  🎵 Analyzing: track1.mp3
  ✅ Analyzed: track1.mp3
  ...
✅ Pre-analysis complete. Handing off to Architect...
```

Then confirm the AI's first message in the loop skips or fast-paths Phase 1 (it should say something like "All tracks already analyzed, proceeding to design phase").

Also verify cancel works mid-pre-analysis: click the stop button during upload. Session should return to idle cleanly.

### Step 6: Commit

```
git add src/App.tsx
git commit -m "feat: pre-analyze library tracks before autonomous loop starts"
```

---

## Dependency Note

Task 3 and Task 5 are independent — they touch different parts of App.tsx and LogPanel with no overlap. Either can be implemented first. Suggested order: Task 3 (simpler, visual payoff) then Task 5.
