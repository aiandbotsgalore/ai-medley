# Session Checkpoints Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist the AI loop's chat history and counters after every iteration so a crashed or cancelled session can be resumed from the last completed model turn.

**Architecture:** After each successful round-trip in `runAutonomousLoop` (tool responses sent → model reply received), save a checkpoint JSON to `library/checkpoints/<sessionId>.json` via a server endpoint. On resume, recreate the provider session with the saved chat history and continue the while-loop. The workdir is already on disk, so resuming the workdir is free.

**Tech Stack:** Express (new endpoints), React state + useRef, `@google/genai` `chat.getHistory()` / `chats.create({ history })`, OpenRouter `messages[]` array serialization.

---

### Task 1: Extend `providers.ts` — expose `getHistory` and `initialHistory`

**Files:**
- Modify: `src/engine/providers.ts`

**Step 1: Add `getHistory` to the `ProviderSession` type**

Find the `ProviderSession` type and replace it:

```typescript
type ProviderSession = {
  send: (message: string | ProviderToolResponse[]) => Promise<ProviderResponse>;
  getHistory: () => unknown[];
};
```

**Step 2: Add optional `initialHistory` param to `createProviderSession` signature**

```typescript
export function createProviderSession(
  config: MedleyConfig,
  systemInstruction: string,
  tools: unknown[],
  temperature: number,
  initialHistory?: unknown[]
): ProviderSession {
```

**Step 3: Implement for the Gemini branch**

Inside the `if (config.provider === 'gemini')` block, change `ai.chats.create(...)` to include history:

```typescript
const chat = ai.chats.create({
  model: config.model,
  config: {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    tools: [{ functionDeclarations: tools as never[] }],
    temperature
  },
  history: (initialHistory as any[]) ?? []
});

return {
  async send(message) {
    const result = await chat.sendMessage({ message: message as any });
    return {
      text: result.text ?? '',
      functionCalls: (result.functionCalls ?? []).map(call => ({
        id: call.id,
        name: call.name,
        args: call.args
      }))
    };
  },
  getHistory() {
    return chat.getHistory() as unknown[];
  }
};
```

**Step 4: Implement for the OpenRouter branch**

The OpenRouter branch maintains a `messages` array in closure. Add the initial history and expose it:

```typescript
const messages: Array<Record<string, unknown>> = [
  { role: 'system', content: systemInstruction },
  ...((initialHistory as Array<Record<string, unknown>>) ?? [])
];

return {
  async send(message) {
    // ... existing send logic unchanged ...
  },
  getHistory() {
    // Return all messages except the system message
    return messages.slice(1);
  }
};
```

**Step 5: Verify TypeScript compiles**

```bash
npm run lint
```

Expected: no errors about missing `getHistory` on ProviderSession.

**Step 6: Commit**

```bash
git add src/engine/providers.ts
git commit -m "feat: expose getHistory + initialHistory on ProviderSession for checkpoint support"
```

---

### Task 2: Server checkpoint endpoints (`server.ts`)

**Files:**
- Modify: `server.ts`

**Step 1: Add checkpoint directory creation on startup**

Near the top of `server.ts` where other path constants are defined, add:

```typescript
const CHECKPOINT_DIR = path.join(__dirname, '../library/checkpoints');
fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });
```

**Step 2: Add the four checkpoint endpoints**

Place these after the existing `/api/library` endpoints and before the Vite middleware:

```typescript
// POST /api/checkpoint — upsert checkpoint for a session
app.post('/api/checkpoint', express.json({ limit: '50mb' }), (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  const filePath = path.join(CHECKPOINT_DIR, `${sessionId}.json`);
  fs.writeFileSync(filePath, JSON.stringify({ ...req.body, savedAt: new Date().toISOString() }));
  res.json({ ok: true });
});

// GET /api/checkpoints — list all saved checkpoints
app.get('/api/checkpoints', (_req, res) => {
  if (!fs.existsSync(CHECKPOINT_DIR)) return res.json([]);
  const checkpoints = fs.readdirSync(CHECKPOINT_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(CHECKPOINT_DIR, f), 'utf8')); }
      catch { return null; }
    })
    .filter(Boolean);
  res.json(checkpoints);
});

// GET /api/checkpoint/:sessionId — fetch one checkpoint
app.get('/api/checkpoint/:sessionId', (req, res) => {
  const p = path.join(CHECKPOINT_DIR, `${req.params.sessionId}.json`);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'not found' });
  res.json(JSON.parse(fs.readFileSync(p, 'utf8')));
});

// DELETE /api/checkpoint/:sessionId — remove checkpoint after successful finish
app.delete('/api/checkpoint/:sessionId', (req, res) => {
  const p = path.join(CHECKPOINT_DIR, `${req.params.sessionId}.json`);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  res.json({ ok: true });
});
```

**Step 3: Restart dev server and verify endpoints**

```bash
curl -X POST http://localhost:3000/api/checkpoint \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"test123","iterations":5}'
# Expected: {"ok":true}

curl http://localhost:3000/api/checkpoints
# Expected: [{"sessionId":"test123","iterations":5,...}]

curl http://localhost:3000/api/checkpoint/test123
# Expected: {"sessionId":"test123","iterations":5,...}

curl -X DELETE http://localhost:3000/api/checkpoint/test123
# Expected: {"ok":true}
```

**Step 4: Commit**

```bash
git add server.ts
git commit -m "feat: add checkpoint CRUD endpoints — POST/GET/DELETE /api/checkpoint"
```

---

### Task 3: Add checkpoint type + save call inside `runAutonomousLoop` (`App.tsx`)

**Files:**
- Modify: `src/App.tsx`

**Step 1: Add `CheckpointData` type near the top of the file (after imports)**

```typescript
type CheckpointData = {
  sessionId: string;
  savedAt: string;
  provider: string;
  model: string;
  iterations: number;
  currentModelIndex: number;
  llmCallCount: number;
  refinementPassCount: number;
  evaluateCallCount: number;
  expensiveLLMCalls: number;
  cheapLLMCalls: number;
  autoAcceptedCount: number;
  autoRejectedCount: number;
  currentPhase: string;
  design: MedleyDesignPayload | null;
  chatHistory: unknown[];
  sectionPairCacheEntries: [string, unknown][];
  evaluationsPerFromSectionEntries: [string, number][];
};
```

**Step 2: Add `checkpoints` state alongside the other useState declarations in `App()`**

```typescript
const [checkpoints, setCheckpoints] = useState<CheckpointData[]>([]);
```

**Step 3: Add `fetchCheckpoints` callback and call it on mount**

Right after the `fetchLibrary` callback:

```typescript
const fetchCheckpoints = useCallback(async () => {
  try {
    const res = await fetch('/api/checkpoints');
    if (res.ok) setCheckpoints(await res.json());
  } catch {}
}, []);

useEffect(() => { fetchCheckpoints(); }, [fetchCheckpoints]);
```

**Step 4: Locate the `saveCheckpoint` fire-and-forget helper**

Add this function *inside* `runAutonomousLoop`, right after `session` is first created (after `let session = createSessionForModel(getCurrentModel());`):

```typescript
const saveCheckpoint = () => {
  const data: CheckpointData = {
    sessionId: sid,
    savedAt: new Date().toISOString(),
    provider: config.provider,
    model: getCurrentModel(),
    iterations,
    currentModelIndex,
    llmCallCount,
    refinementPassCount,
    evaluateCallCount,
    expensiveLLMCalls,
    cheapLLMCalls,
    autoAcceptedCount,
    autoRejectedCount,
    currentPhase,
    design,
    chatHistory: session.getHistory(),
    sectionPairCacheEntries: [...sectionPairCache.entries()],
    evaluationsPerFromSectionEntries: [...evaluationsPerFromSection.entries()],
  };
  fetch('/api/checkpoint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }).catch(() => {}); // fire-and-forget
};
```

Note: `saveCheckpoint` closes over `session`, `iterations`, `currentModelIndex`, etc. Since these are `let` variables in the outer function scope, the closure captures the *binding*, not the *value* — so calling `saveCheckpoint()` at any point reads the current values. This is correct.

**Step 5: Call `saveCheckpoint()` after each successful `sendWithRetry(toolResponses)` in the main loop**

Find the section of the loop where tool responses are sent back to the model. It looks like:

```typescript
if (!loopFinished) {
  result = await sendWithRetry(toolResponses);
  llmCallCount++;
  ...
}
```

Add `saveCheckpoint()` immediately after `result = await sendWithRetry(toolResponses)`:

```typescript
if (!loopFinished) {
  result = await sendWithRetry(toolResponses);
  llmCallCount++;
  saveCheckpoint(); // <-- ADD THIS LINE
  if (result.usage?.total_tokens) { ... }
}
```

**Step 6: Delete checkpoint on successful finish**

Find the `finish_medley` tool handler (around line 281 per prior observations). After the POST to `/api/session/finish`, add:

```typescript
fetch(`/api/checkpoint/${sid}`, { method: 'DELETE' }).catch(() => {});
await fetchCheckpoints(); // refresh checkpoint list in UI
```

**Step 7: Verify checkpoint files appear during a test run**

Start the dev server, start a medley, watch `library/checkpoints/` directory for `.json` files appearing after each iteration.

**Step 8: Commit**

```bash
git add src/App.tsx
git commit -m "feat: save checkpoint after each loop iteration, delete on successful finish"
```

---

### Task 4: Resume logic — modify `runAutonomousLoop` to accept checkpoint state

**Files:**
- Modify: `src/App.tsx`

**Step 1: Change `runAutonomousLoop` signature to accept optional `resumeState`**

```typescript
const runAutonomousLoop = async (
  lib: LibraryFile[],
  signal: AbortSignal,
  design: MedleyDesignPayload | null,
  resumeState?: CheckpointData
) => {
```

**Step 2: At the top of `runAutonomousLoop`, branch on `resumeState`**

Replace the session-ID generation + state reset block with:

```typescript
// Use existing sessionId when resuming, generate new one for fresh runs
const sid = resumeState?.sessionId ?? Math.random().toString(36).substring(7);
setSessionId(sid);
sessionIdRef.current = sid;

if (!resumeState) {
  setLogs([]);
  setSummary(null);
  setMetrics(null);
  setIteration(null);
  setExecutionContext(null);
  setRenderProgress(null);
} else {
  addLog(`🔁 Resuming session ${sid} from iteration ${resumeState.iterations}`);
}
```

**Step 3: When creating the session, pass `initialHistory` from resumeState**

Find `let session = createSessionForModel(getCurrentModel());`. Change `createSessionForModel` to pass history:

```typescript
const createSessionForModel = (model: string, history?: unknown[]) => {
  const tempConfig = { ...config, model };
  return createProviderSession(
    tempConfig,
    buildSystemPrompt(lib, tempConfig, design, sid),
    tempConfig.provider === 'gemini' ? getToolDeclarations() : getOpenRouterTools(),
    tempConfig.temperature,
    history
  );
};

let session = createSessionForModel(getCurrentModel(), resumeState?.chatHistory);
```

**Step 4: Restore counters from resumeState**

Find where the counters are initialized:

```typescript
let evaluateCallCount = 0;
let llmCallCount = 0;
let refinementPassCount = 0;
let expensiveLLMCalls = 0;
let cheapLLMCalls = 0;
let autoAcceptedCount = 0;
let autoRejectedCount = 0;
let currentModelIndex = 0;
```

Change to restore from resumeState when present:

```typescript
let evaluateCallCount = resumeState?.evaluateCallCount ?? 0;
let llmCallCount = resumeState?.llmCallCount ?? 0;
let refinementPassCount = resumeState?.refinementPassCount ?? 0;
let expensiveLLMCalls = resumeState?.expensiveLLMCalls ?? 0;
let cheapLLMCalls = resumeState?.cheapLLMCalls ?? 0;
let autoAcceptedCount = resumeState?.autoAcceptedCount ?? 0;
let autoRejectedCount = resumeState?.autoRejectedCount ?? 0;
let currentModelIndex = resumeState?.currentModelIndex ?? 0;
```

**Step 5: Restore sectionPairCache and evaluationsPerFromSection**

After the `const sectionPairCache = new Map<string, any>();` line:

```typescript
if (resumeState?.sectionPairCacheEntries) {
  for (const [k, v] of resumeState.sectionPairCacheEntries) sectionPairCache.set(k, v);
}

if (resumeState?.evaluationsPerFromSectionEntries) {
  for (const [k, v] of resumeState.evaluationsPerFromSectionEntries) evaluationsPerFromSection.set(k, v);
}
```

**Step 6: Change the initial `sendWithRetry` call to branch on resume**

Find:

```typescript
let result = await sendWithRetry('Begin the medley architect process. Analyze the library first, then design and build the medley.');
```

Change to:

```typescript
const initialMessage = resumeState
  ? `Session resumed from checkpoint at iteration ${resumeState.iterations}. The conversation history above shows all previous work completed in this session. Please assess what phase we are in and what the very next action should be, then continue immediately.`
  : 'Begin the medley architect process. Analyze the library first, then design and build the medley.';

let result = await sendWithRetry(initialMessage);
```

**Step 7: Restore `iterations` loop counter**

Find `let iterations = 0;` inside the while-loop setup. Change to:

```typescript
let iterations = resumeState?.iterations ?? 0;
```

**Step 8: Add `resumeFromCheckpoint` function in `App()` component body**

Add this after the `runAutonomousLoop` definition:

```typescript
const resumeFromCheckpoint = useCallback(async (checkpoint: CheckpointData) => {
  if (status !== 'idle') return;
  
  const controller = new AbortController();
  abortRef.current = controller;
  setStatus('running');
  setCurrentPhase(checkpoint.currentPhase || '');
  setMedleyDesign(checkpoint.design);
  setIteration({ current: checkpoint.iterations, max: 50 });
  
  // Refresh library so we have up-to-date track data
  await fetchLibrary();
  const currentLib = library;
  
  await runAutonomousLoop(currentLib, controller.signal, checkpoint.design, checkpoint);
}, [status, library, fetchLibrary, runAutonomousLoop]);
```

**Step 9: Update the call site in `startMedley` to pass null for resumeState**

Find where `runAutonomousLoop` is called and ensure the call passes explicit `undefined` or nothing:

```typescript
await runAutonomousLoop(lib, controller.signal, design);
```

(No change needed if it already has 3 args — TypeScript will use the default `undefined` for the optional 4th param.)

**Step 10: TypeScript check**

```bash
npm run lint
```

Expected: no type errors.

**Step 11: Commit**

```bash
git add src/App.tsx
git commit -m "feat: runAutonomousLoop accepts resumeState — restores chat history, counters, and caches"
```

---

### Task 5: Resume UI — checkpoint banner and discard option

**Files:**
- Modify: `src/App.tsx`

**Step 1: Add `discardCheckpoint` function**

```typescript
const discardCheckpoint = useCallback(async (sessionId: string) => {
  await fetch(`/api/checkpoint/${sessionId}`, { method: 'DELETE' });
  await fetchCheckpoints();
}, [fetchCheckpoints]);
```

**Step 2: Add checkpoint resume banner to the JSX**

Find the main render return, specifically the workshop tab content area (the area that shows when `status === 'idle'`). Insert a checkpoint resume section ABOVE the start button or idle state UI.

The banner should show when: `status === 'idle' && checkpoints.length > 0`

```tsx
{status === 'idle' && checkpoints.length > 0 && (
  <div style={{
    border: '1px solid #00F0FF44',
    borderRadius: 8,
    padding: '12px 16px',
    marginBottom: 12,
    background: '#0a1a1a'
  }}>
    <div style={{ color: '#00F0FF', fontWeight: 600, marginBottom: 8, fontSize: 13 }}>
      Interrupted Sessions
    </div>
    {checkpoints.map(cp => (
      <div key={cp.sessionId} style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 0',
        borderTop: '1px solid #ffffff11',
        fontSize: 12
      }}>
        <div style={{ flex: 1, color: '#aaa' }}>
          <span style={{ color: '#fff' }}>{cp.model}</span>
          {' · '}Iteration {cp.iterations}
          {' · '}Phase: {cp.currentPhase || 'Unknown'}
          {' · '}<span style={{ color: '#666' }}>{new Date(cp.savedAt).toLocaleString()}</span>
        </div>
        <button
          onClick={() => resumeFromCheckpoint(cp)}
          style={{
            background: '#00F0FF22',
            border: '1px solid #00F0FF88',
            color: '#00F0FF',
            borderRadius: 4,
            padding: '3px 10px',
            cursor: 'pointer',
            fontSize: 11
          }}
        >
          Resume
        </button>
        <button
          onClick={() => discardCheckpoint(cp.sessionId)}
          style={{
            background: 'transparent',
            border: '1px solid #ff444488',
            color: '#ff6666',
            borderRadius: 4,
            padding: '3px 8px',
            cursor: 'pointer',
            fontSize: 11
          }}
        >
          Discard
        </button>
      </div>
    ))}
  </div>
)}
```

**Step 3: Refresh checkpoint list after cancel (handleCancel)**

Find `handleCancel` and add checkpoint refresh at the end:

```typescript
const handleCancel = useCallback(() => {
  abortRef.current?.abort();
  setStatus('idle');
  setTimeout(fetchCheckpoints, 500); // slight delay to let server write finish
}, [fetchCheckpoints]);
```

**Step 4: Verify full resume flow manually**

1. Start a medley, let it run 3–4 iterations
2. Click Cancel
3. Verify a checkpoint appears in the banner
4. Click Resume
5. Verify the session continues with the model picking up where it left off (logs should show "Resuming session...")
6. Let it finish — verify the checkpoint file is deleted from `library/checkpoints/`

**Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: checkpoint resume UI — banner shows interrupted sessions with Resume/Discard buttons"
```

---

## Summary

| Task | Files | What it does |
|------|-------|-------------|
| 1 | `providers.ts` | `getHistory()` + `initialHistory` param on both Gemini and OpenRouter sessions |
| 2 | `server.ts` | Four checkpoint endpoints + `library/checkpoints/` directory |
| 3 | `App.tsx` | `saveCheckpoint()` fires after each iteration; deletes on `finish_medley` |
| 4 | `App.tsx` | `runAutonomousLoop` accepts `resumeState`; `resumeFromCheckpoint()` function |
| 5 | `App.tsx` | Resume banner UI with Resume/Discard buttons; cancel refreshes checkpoint list |

**Test the full loop:** start → crash/cancel → resume → finish → verify no checkpoint file remains.
