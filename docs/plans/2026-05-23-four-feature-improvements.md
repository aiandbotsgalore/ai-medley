# AI Medley: Four-Feature Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement four improvements: default model upgrade to gemini-2.5-pro, session checkpoint/resume, in-progress audio preview, and beat/key-aware FFmpeg crossfades.

**Architecture:** Tasks 1 and 4 touch isolated files (ConfigPanel.tsx, prompts.ts) with zero overlap. Tasks 2 and 3 both modify server.ts and App.tsx — Task 3 runs after Task 2 to avoid conflicts. Two agents work in parallel during Wave 1; one agent finishes Task 3 in Wave 2.

**Tech Stack:** React 19, TypeScript, Express, @google/genai SDK, FFmpeg via ffmpeg-static, Tailwind v4

---

## Parallel Execution Strategy

**Wave 1 (launch two agents simultaneously):**
- **Agent A** → Tasks 1 + 4 (ConfigPanel.tsx and prompts.ts only — no conflict with Agent B)
- **Agent B** → Task 2 (server.ts + App.tsx — checkpoint/resume system)

**Wave 2 (after both Wave 1 agents finish):**
- **Agent C** → Task 3 (server.ts + App.tsx + LogPanel.tsx — preview feature on top of Task 2's changes)

---

## AGENT A TASKS (Task 1 + Task 4)

### Task 1: Switch Default Model to gemini-2.5-pro

**Files:**
- Verify/Modify: `src/components/ConfigPanel.tsx:20`

**Step 1: Verify current state**

Open `src/components/ConfigPanel.tsx` and check line 20. The `DEFAULT_CONFIG` model field should read `'gemini-2.5-flash'`. If it already reads `'gemini-2.5-pro'`, skip to Step 3.

**Step 2: Apply the change**

In `src/components/ConfigPanel.tsx`, inside `DEFAULT_CONFIG`, change:
```typescript
model: 'gemini-2.5-flash',
```
To:
```typescript
model: 'gemini-2.5-pro',
```

**Step 3: Run lint**

```bash
npm run lint
```
Expected: 0 TypeScript errors.

**Step 4: Done — no commit needed**
Note this is one line changed. Log the result and move straight to Task 4.

---

### Task 4: Beat/Key-Aware FFmpeg Crossfades

**Files:**
- Modify: `src/engine/prompts.ts`

Context: `prompts.ts` has 234 lines. It exports `buildSystemPrompt()` which constructs the six-phase instruction set. The `TOOL_DEFINITIONS` array at the top defines all tools including `execute_shell_command`. The AI already receives BPM and key data via `medleyDesign.localFacts` and analysis text — the gap is that the BUILD phase gives generic FFmpeg instructions without concrete beat-sync math.

**Step 1: Enhance execute_shell_command description**

In `src/engine/prompts.ts`, find the `execute_shell_command` tool definition (it is the first entry in `TOOL_DEFINITIONS`). Replace its `description` field (currently a single sentence ending with `...all source tracks.'`) with:

```typescript
description: `Execute a shell command in the work directory. Use for FFmpeg operations. The system will automatically replace "ffmpeg" with the bundled binary path.
BEAT-SYNC TIPS:
- Normalization: loudnorm filter (I=-14, TP=-1, LRA=7) on every snippet before crossfading.
- Beat-synced crossfade: beatDuration = 60 / BPM. Use 4-beat crossfade = beatDuration * 4. E.g. 120 BPM → 0.5s/beat → 2.0s crossfade.
- Key-matched transitions (same or Camelot-adjacent key): acrossfade=d=SECS:c1=tri:c2=tri
- Key-mismatched transitions (5+ semitones apart): acrossfade=d=SECS:c1=exp:c2=exp with shorter duration (1-2 beats).
- Complex filtergraph for 3 clips: [0][1]acrossfade=d=2:c1=tri:c2=tri[a01];[a01][2]acrossfade=d=2:c1=tri:c2=tri[out]
- Always use -y flag. Use absolute paths.`,
```

**Step 2: Enhance Phase 3 BUILD section in buildSystemPrompt**

In `src/engine/prompts.ts`, inside the `buildSystemPrompt` function, find Phase 3:

```
3. **Crossfade:** Apply 'acrossfade' between clips (duration=${config.crossfadeDuration}s, curve=tri).
```

Replace that single line with:

```typescript
3. **Crossfade (Beat-Aligned):**
   - Compute per-transition crossfade duration:
     beatDuration = 60 / avgBPM  (use lower BPM if tracks differ)
     crossfadeSecs = beatDuration * 16  (4 bars at 4/4)
     Clamp to [${Math.max(2, config.crossfadeDuration - 2)}, ${config.crossfadeDuration + 6}]s. Default ${config.crossfadeDuration}s if BPM unknown.
   - Key matching (Camelot Wheel): Same key or ±1 step → tri curve. Incompatible key → exp curve, halve the duration.
   - Chain all clips in one filtergraph: [0][1]acrossfade=d=T1:c1=tri:c2=tri[a01];[a01][2]acrossfade=d=T2:c1=tri:c2=tri[out]
   - BPM ratio > 1.15 between adjacent tracks: do NOT force tempo-match. Use a natural ending/beginning instead.`,
```

**Step 3: Add a Transition Math section to the system prompt**

In `buildSystemPrompt`, find where `medleyDesignBlock` is injected into the return string. Right before the `# YOUR AUTONOMOUS PROCESS` line in the returned template literal, add a new section:

```typescript
# BEAT-ALIGNED TRANSITION MATH
For each transition, calculate before writing any FFmpeg command:
  Track A BPM = [from analysis], Track B BPM = [from analysis]
  avgBPM = (bpmA + bpmB) / 2  (or lower if ratio > 1.15)
  beatDuration = 60 / avgBPM
  crossfadeSecs = beatDuration * 16  (4 bars)  → clamp to [2, 20]

Key compatibility:
  Same key or Camelot ±1 → c1=tri:c2=tri, full crossfadeSecs
  Camelot ±2-3 → c1=exp:c2=exp, crossfadeSecs / 2
  Incompatible → c1=exp:c2=exp, beatDuration * 4 (1 bar only)

Log your calculations as text before each FFmpeg command so the user can verify.
```

**Step 4: Run lint**

```bash
npm run lint
```
Expected: 0 TypeScript errors.

**Step 5: Smoke test**

Start a session with 2+ tracks that have BPM in their analysis. In the log panel, verify the AI logs its beat calculation text before FFmpeg crossfade commands.

---

## AGENT B TASKS (Task 2)

### Task 2: Session Checkpoint + Resume

**Context:** The `sessions` object in `server.ts` is in-memory only — a server restart loses all state. The autonomous loop in `App.tsx` runs up to 50 iterations. If it crashes at iteration 30, the user loses everything. We add: (a) server endpoints to save/load checkpoint JSON, (b) App.tsx checkpoint saves after each tool batch, (c) a resume path that re-starts the AI loop with a "continue from where you left off" prompt, (d) a "Resume" button in the UI.

**Checkpoint format** (`workdir/<sessionId>/checkpoint.json`):
```json
{
  "sessionId": "abc123",
  "iteration": 12,
  "logsSnapshot": ["[10:00] 🔧 Tool: execute_shell_command"],
  "metricsSnapshot": { "overallScore": 72 },
  "savedAt": "2026-05-23T10:01:00.000Z"
}
```

Note: The Gemini chat history is NOT checkpointed (no API to resume a mid-stream session). The resume path starts a fresh session with a special prompt telling the AI to check its workdir and continue.

**Files:**
- Modify: `server.ts`
- Modify: `src/App.tsx`

**Step 1: Add checkpoint endpoints to server.ts**

Open `server.ts`. After the `POST /api/session/metrics` route (around line 633), add two new routes:

```typescript
app.post('/api/session/checkpoint', (req, res) => {
  const { sessionId, iteration, logsSnapshot, metricsSnapshot } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  const sessionDir = path.join(workDir, sessionId);
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
  const checkpoint = { sessionId, iteration, logsSnapshot, metricsSnapshot, savedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(sessionDir, 'checkpoint.json'), JSON.stringify(checkpoint, null, 2));
  res.json({ success: true });
});

app.get('/api/session/:id/checkpoint', (req, res) => {
  const cpPath = path.join(workDir, req.params.id, 'checkpoint.json');
  if (!fs.existsSync(cpPath)) return res.status(404).json({ error: 'No checkpoint' });
  try {
    res.json(JSON.parse(fs.readFileSync(cpPath, 'utf-8')));
  } catch {
    res.status(500).json({ error: 'Corrupt checkpoint' });
  }
});

app.get('/api/checkpoints', (req, res) => {
  if (!fs.existsSync(workDir)) return res.json([]);
  const checkpoints: any[] = [];
  for (const dir of fs.readdirSync(workDir)) {
    const cpPath = path.join(workDir, dir, 'checkpoint.json');
    if (fs.existsSync(cpPath)) {
      try { checkpoints.push(JSON.parse(fs.readFileSync(cpPath, 'utf-8'))); } catch {}
    }
  }
  res.json(checkpoints);
});
```

**Step 2: Add checkpoint state to App.tsx**

In `src/App.tsx`, after the `abortRef` declaration (around line 38), add:

```typescript
const [checkpoint, setCheckpoint] = useState<{ sessionId: string; iteration: number; savedAt: string } | null>(null);
```

**Step 3: Load checkpoints on startup in App.tsx**

In `src/App.tsx`, after the `fetchLibrary` useEffect, add:

```typescript
useEffect(() => {
  fetch('/api/checkpoints')
    .then(r => r.json())
    .then((cps: any[]) => {
      if (cps.length === 0) return;
      const latest = cps.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())[0];
      setCheckpoint(latest);
    })
    .catch(() => {});
}, []);
```

**Step 4: Save checkpoint after each tool batch in runAutonomousLoop**

In `src/App.tsx`, inside `runAutonomousLoop`, find the line:

```typescript
result = await sendWithRetry(toolResponses.map((toolResponse: any) => ({
```

Immediately AFTER `result = await sendWithRetry(...)` resolves (after that block closes), add a fire-and-forget checkpoint save:

```typescript
if (!loopFinished) {
  fetch('/api/session/checkpoint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: sid,
      iteration: iterations,
      logsSnapshot: logs.slice(-20),
      metricsSnapshot: metrics
    })
  }).catch(() => {});
}
```

Note: `logs` is a React state ref here — you need to capture it differently. Change the fire-and-forget to use a local variable instead:

```typescript
const currentLogs = [...logs].slice(-20); // capture snapshot before next setState
if (!loopFinished) {
  fetch('/api/session/checkpoint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: sid,
      iteration: iterations,
      logsSnapshot: currentLogs,
      metricsSnapshot: metrics
    })
  }).catch(() => {});
}
```

Actually `logs` is React state and closures capture stale values inside async callbacks. The safer approach: pass a `logsRef` alongside the state. Add at the top of the App component:

```typescript
const logsRef = useRef<string[]>([]);
```

And in `addLog`:
```typescript
const addLog = useCallback((msg: string) => {
  const entry = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logsRef.current = [...logsRef.current, entry];
  setLogs(prev => [...prev, entry]);
}, []);
```

Then in the checkpoint save, use `logsRef.current.slice(-20)`.

**Step 5: Add resume function to App.tsx**

After `handleCancel`, add:

```typescript
const resumeFromCheckpoint = async (cp: NonNullable<typeof checkpoint>) => {
  abortRef.current = new AbortController();
  setStatus('running');
  setSessionId(cp.sessionId);
  setIteration({ current: cp.iteration, max: 50 });
  setLogs([]);
  setSummary(null);
  setMetrics(cp.metricsSnapshot ?? null);
  addLog(`🔄 Resuming session from checkpoint at iteration ${cp.iteration}...`);
  const freshLib: LibraryFile[] = await fetch('/api/library').then(r => r.json()).catch(() => library);
  runAutonomousLoop(freshLib, abortRef.current.signal, null, { sessionId: cp.sessionId, resumeFromIteration: cp.iteration });
};
```

**Step 6: Add resumeHint parameter to runAutonomousLoop**

Change function signature from:
```typescript
const runAutonomousLoop = async (lib: LibraryFile[], signal: AbortSignal, design: MedleyDesignPayload | null) => {
```
To:
```typescript
const runAutonomousLoop = async (
  lib: LibraryFile[],
  signal: AbortSignal,
  design: MedleyDesignPayload | null,
  resumeHint?: { sessionId: string; resumeFromIteration: number }
) => {
```

Inside the function, use `resumeHint?.sessionId ?? sid` when setting the session ID. Also change the initial message sent to the AI:

Find:
```typescript
let result = await sendWithRetry('Begin the medley architect process. Analyze the library first, then design and build the medley.');
```

Replace with:
```typescript
const initialMessage = resumeHint
  ? `You are resuming a medley build session. Prior progress: ${resumeHint.resumeFromIteration} iterations completed. Check your work directory — intermediate files from the previous run may still be present. Review what was already built and continue from where you left off. Do NOT start from scratch unless all intermediate files are missing.`
  : 'Begin the medley architect process. Analyze the library first, then design and build the medley.';

let result = await sendWithRetry(initialMessage);
```

When a `resumeHint` is provided, also override `sid` with the resumed session ID so checkpoint and finish calls use the same session:

```typescript
const sid = resumeHint?.sessionId ?? Math.random().toString(36).substring(7);
```

(Move the `const sid = ...` declaration up before `setSessionId(sid)` and make it use the resumeHint.)

**Step 7: Add Resume button to idle UI in App.tsx**

In the idle state section (after the Start button), add:

```tsx
{checkpoint && status === 'idle' && (
  <button
    onClick={() => resumeFromCheckpoint(checkpoint)}
    className="mt-3 px-8 py-2.5 border border-[#00F0FF]/30 text-[#00F0FF] text-[11px] font-mono uppercase tracking-widest rounded-xl hover:bg-[#00F0FF]/[0.05] hover:border-[#00F0FF]/50 transition-all"
  >
    Resume Checkpoint · Iter {checkpoint.iteration}
  </button>
)}
```

**Step 8: Clear checkpoint on completion**

After `setStatus('completed')` in the `finish_medley` handler inside `runAutonomousLoop`, also delete the checkpoint file via a fire-and-forget:

```typescript
fetch(`/api/session/${sid}/checkpoint`, { method: 'DELETE' }).catch(() => {});
setCheckpoint(null);
```

Add the DELETE endpoint to server.ts after the GET checkpoint route:

```typescript
app.delete('/api/session/:id/checkpoint', (req, res) => {
  const cpPath = path.join(workDir, req.params.id, 'checkpoint.json');
  if (fs.existsSync(cpPath)) fs.unlinkSync(cpPath);
  res.json({ success: true });
});
```

**Step 9: Run lint**

```bash
npm run lint
```
Expected: 0 TypeScript errors.

**Step 10: Smoke test**

Start a session, wait 2-3 iterations, kill the dev server (Ctrl+C), restart it (`npm run dev`), open the app — verify the Resume button appears with the correct iteration number. Click it and confirm the AI receives the "resuming" prompt.

---

## AGENT C TASKS (Task 3) — Run AFTER Wave 1

### Task 3: Audio Preview During Generation

**Context:** During a session, the AI generates intermediate MP3 files in `workdir/<sessionId>/`. There is no way to hear them without waiting for `finish_medley`. We add: (a) a server endpoint that serves the most-recent MP3 from the session workdir, (b) a "Preview Build" button in the UI during active generation, (c) an optional `preview_current_build` tool the AI can call to proactively signal a preview is ready, (d) the footer audio player shows the preview during `running` state.

**Files:**
- Modify: `server.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/LogPanel.tsx`
- Modify: `src/engine/prompts.ts`

**Step 1: Add preview endpoint to server.ts**

After `GET /api/session/:id` (line 642), add:

```typescript
app.get('/api/session/:id/preview', (req, res) => {
  const sessionDir = path.join(workDir, req.params.id);
  if (!fs.existsSync(sessionDir)) return res.status(404).json({ error: 'No session directory' });

  const mp3s = fs.readdirSync(sessionDir)
    .filter(f => f.endsWith('.mp3'))
    .map(f => ({ name: f, mtime: fs.statSync(path.join(sessionDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  if (mp3s.length === 0) return res.status(404).json({ error: 'No audio build yet' });

  const latestPath = path.join(sessionDir, mp3s[0].name);
  res.setHeader('Content-Type', 'audio/mpeg');
  res.sendFile(latestPath);
});
```

**Step 2: Add previewUrl state to App.tsx**

After the `iteration` state declaration, add:

```typescript
const [previewUrl, setPreviewUrl] = useState<string | null>(null);
```

Reset it when a new session starts (at the top of `runAutonomousLoop`, alongside `setIteration(null)`):

```typescript
setPreviewUrl(null);
```

**Step 3: Add handlePreview function to App.tsx**

After `handleCancel`, add:

```typescript
const handlePreview = useCallback(async () => {
  if (!sessionId) return;
  const testUrl = `/api/session/${sessionId}/preview`;
  const res = await fetch(testUrl).catch(() => null);
  if (res?.ok) {
    setPreviewUrl(`${testUrl}?t=${Date.now()}`);
    addLog('🎵 Preview loaded — listen in the audio player below.');
  } else {
    addLog('⚠️ No in-progress audio file found yet. Try again after the first FFmpeg command completes.');
  }
}, [sessionId, addLog]);
```

**Step 4: Add preview_current_build tool to prompts.ts**

In `src/engine/prompts.ts`, in the `TOOL_DEFINITIONS` array, after the `report_progress` entry and before `finish_medley`, add:

```typescript
{
  name: 'preview_current_build',
  description: 'Signal to the user that the current in-progress MP3 build is ready to preview. Call this after completing any intermediate build so the user can listen before you continue refining.',
  parameters: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Filename of the current build (e.g. "intermediate_v1.mp3")' },
      note: { type: 'string', description: 'What changed or was improved in this build' }
    },
    required: ['filePath']
  }
},
```

**Step 5: Add preview_current_build handler to App.tsx tool dispatch**

In `runAutonomousLoop`, inside the `for (const call of functionCalls)` loop, after the `report_progress` handler block, add:

```typescript
else if (call.name === 'preview_current_build') {
  addLog(`  🎵 Preview ready: ${args.filePath}${args.note ? ` — ${args.note}` : ''}`);
  setPreviewUrl(`/api/session/${sid}/preview?t=${Date.now()}`);
  toolRes = { functionResponse: { name: call.name, id: call.id, response: { status: 'Preview signaled to user.' } } };
}
```

**Step 6: Teach the AI to call preview_current_build**

In `src/engine/prompts.ts`, inside `buildSystemPrompt`, in the Phase 4: EVALUATE section, append:

```
- After each refinement iteration where you've produced a new MP3, call 'preview_current_build' with the filename so the user can monitor progress.
```

**Step 7: Update LogPanel to accept and show Preview button**

Open `src/components/LogPanel.tsx`. Find the props interface (it likely accepts `status`, `logs`, `iteration`). Add `onPreview` to the interface:

```typescript
interface LogPanelProps {
  status: AppStatus;  // or whatever type is used
  logs: string[];
  iteration: { current: number; max: number } | null;
  onPreview?: () => void;
}
```

Inside the LogPanel render, find where the iteration counter is displayed. Next to it, add:

```tsx
{props.onPreview && props.status === 'running' && (
  <button
    onClick={props.onPreview}
    className="ml-3 px-3 py-1 text-[10px] font-mono uppercase border border-[#00F0FF]/20 text-[#00F0FF]/60 hover:text-[#00F0FF] hover:border-[#00F0FF]/40 rounded transition-all shrink-0"
  >
    Preview Build
  </button>
)}
```

**Step 8: Wire onPreview into LogPanel in App.tsx**

Find where LogPanel is rendered in App.tsx:
```tsx
<LogPanel status={status} logs={logs} iteration={iteration} />
```

Change to:
```tsx
<LogPanel status={status} logs={logs} iteration={iteration} onPreview={handlePreview} />
```

**Step 9: Update footer audio player to show preview during running state**

Find the footer audio player in App.tsx:
```tsx
{status === 'completed' && sessionId ? (
  <audio controls src={`/api/audio/${sessionId}`} ...
```

Change to:
```tsx
{((status === 'completed' && sessionId) || (status === 'running' && previewUrl)) ? (
  <audio
    key={previewUrl ?? sessionId}
    controls
    src={status === 'completed' ? `/api/audio/${sessionId}` : previewUrl!}
    className="w-full max-w-5xl h-10 mx-auto"
    style={{ filter: 'invert(1) hue-rotate(180deg)', opacity: 0.8 }}
  />
) : (
  // existing placeholder JSX unchanged
)}
```

The `key` prop forces React to re-mount the audio element when the preview URL changes (cache-bust).

**Step 10: Run lint**

```bash
npm run lint
```
Expected: 0 TypeScript errors.

**Step 11: End-to-end test**

Start a session. After ~5 iterations (once FFmpeg has produced a file), click "Preview Build". Confirm audio plays in the footer. Also verify the AI sometimes calls `preview_current_build` automatically during refinement iterations.

---

## Final Verification (run after all three agents complete)

1. `npm run lint` — must report 0 errors
2. `npm run dev` — server starts on port 3000 without crashes
3. Open app — default model shown in Config is "Gemini 2.5 Pro"
4. Start session with 3 tracks — confirm AI logs beat-calculation text before crossfade commands
5. Mid-session, click "Preview Build" — audio loads in footer player
6. Kill server mid-session, restart, reload page — "Resume Checkpoint" button appears
7. Click Resume — AI logs "resuming from checkpoint at iteration N"
