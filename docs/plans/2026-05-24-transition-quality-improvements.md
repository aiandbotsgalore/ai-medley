# Transition Quality Improvements — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the medley AI choose better, more musically coherent snippet pairs through four targeted improvements: wider matrix coverage with tuned scoring weights, an on-demand section-pair evaluation tool, a structured DESIGN→BUILD handoff tool, and strategy ordering that uses the specific sections from the transition matrix.

**Architecture:** All changes stay within the existing three-file boundary: `src/engine/medleyIntelligence.ts` (scoring logic), `server.ts` (routes + session cache), `src/App.tsx` + `src/engine/prompts.ts` (tool definitions and handlers). No new libraries needed.

**Tech Stack:** TypeScript, Express, React 19, Google GenAI SDK. Run `npm run lint` (tsc --noEmit) to validate after each task.

---

## Task 1: Tune matrix breadth and scoring weights

**Files:**
- Modify: `src/engine/medleyIntelligence.ts`

This task widens the candidate pool (5 exits × 5 entries = 25 combos, keep top 8) and rebalances the `smoothBlend` formula to reward harmonic and beat-aligned pairs more strongly, then increases the risk penalty in the final score.

**Step 1: Widen the candidate pool**

In `buildTransitionMatrix` (search for `MAX_PAIRS_PER_TRACK_COMBO`), change two constants:

```typescript
// Before:
const MAX_PAIRS_PER_TRACK_COMBO = 6;
// ...
const exitCands = from.rankedExitCandidates.slice(0, 4);
const entryCands = to.rankedEntryCandidates.slice(0, 4);

// After:
const MAX_PAIRS_PER_TRACK_COMBO = 8;
// ...
const exitCands = from.rankedExitCandidates.slice(0, 5);
const entryCands = to.rankedEntryCandidates.slice(0, 5);
```

**Step 2: Rebalance the smoothBlend formula**

In `computeSectionPairTransition`, find the `smoothBlend` line and replace it:

```typescript
// Before:
const smoothBlend = clamp01(energyContinuity * 0.2 + tempo.score * 0.2 + harmonic.score * 0.14 + beatAlignment * 0.16 + brightnessCompatibility * 0.12 + densityCompatibility * 0.08 + sectionBoundaryQuality * 0.1);

// After (weights sum to 1.0):
const smoothBlend = clamp01(energyContinuity * 0.16 + tempo.score * 0.2 + harmonic.score * 0.20 + beatAlignment * 0.18 + brightnessCompatibility * 0.12 + densityCompatibility * 0.06 + sectionBoundaryQuality * 0.08);
```

Rationale: harmonic compatibility (0.14→0.20) and beat alignment (0.16→0.18) are the two strongest perceptual cues for a smooth transition. Energy continuity (0.20→0.16) and density (0.08→0.06) contribute less independently since `sectionBoundaryQuality` already captures exit/entry strength.

**Step 3: Increase the risk penalty in overallScore**

In `computeSectionPairTransition`, find the `overallScore` line and replace it:

```typescript
// Before:
const overallScore = round(Math.max(smoothBlend, hardCut, energyLift, energyDrop, resetMoment, buildTransition, finaleLaunch, surpriseContrast) * (1 - riskLevel * 0.25));

// After:
const overallScore = round(Math.max(smoothBlend, hardCut, energyLift, energyDrop, resetMoment, buildTransition, finaleLaunch, surpriseContrast) * (1 - riskLevel * 0.35));
```

**Step 4: Verify lint passes**

```
npm run lint
```
Expected: no TypeScript errors.

**Step 5: Commit**

```
git add src/engine/medleyIntelligence.ts
git commit -m "feat: widen transition matrix to 5x5 candidates, tune smoothBlend weights and risk penalty"
```

---

## Task 2: Export `evaluateSectionPair` and add server cache

**Files:**
- Modify: `src/engine/medleyIntelligence.ts`
- Modify: `server.ts`

The `computeSectionPairTransition` function is private. We need to expose it so the new API route can call it on demand. We also need a lightweight per-session cache of `TrackIntelligence[]` so the route doesn't re-analyze audio on every call.

**Step 1: Export a public wrapper in medleyIntelligence.ts**

Add this function at the bottom of `src/engine/medleyIntelligence.ts`, just before or after `buildMedleyDesignPayload`:

```typescript
/**
 * Public entry point for evaluating a specific exit section from one track
 * against a specific entry section from another. Returns null if either
 * sectionId is not found in the respective TrackIntelligence.
 */
export function evaluateSectionPair(
  fromTrack: TrackIntelligence,
  toTrack: TrackIntelligence,
  fromSectionId: string,
  toSectionId: string
): TransitionScore | null {
  const fromScore = fromTrack.sectionScores.find(s => s.sectionId === fromSectionId);
  const toScore = toTrack.sectionScores.find(s => s.sectionId === toSectionId);
  if (!fromScore || !toScore) return null;
  const pairData = computeSectionPairTransition(fromTrack, toTrack, fromScore, toScore);
  if (!pairData) return null;
  return {
    fromTrackId: fromTrack.profile.trackId,
    toTrackId: toTrack.profile.trackId,
    ...pairData
  };
}
```

**Step 2: Add server-side TrackIntelligence cache**

In `server.ts`, add a module-level cache map near the top (after the `sessions` declaration):

Find the `sessions` variable (search for `const sessions`). Immediately after it, add:

```typescript
// Caches the last computed TrackIntelligence[] for use by the evaluate-section-pair route.
// Keyed by a cache key derived from the library file IDs so stale data is detected.
const trackIntelligenceCache: { key: string; tracks: TrackIntelligence[] } | null = null;
let cachedTrackIntelligence: { key: string; tracks: TrackIntelligence[] } | null = null;
```

(Remove the first line — it's a comment duplicate. Just add:)
```typescript
let cachedTrackIntelligence: { key: string; tracks: TrackIntelligence[] } | null = null;
```

**Step 3: Update the design endpoint to populate the cache**

In `server.ts`, find the `app.post('/api/medley-intelligence/design'` handler. After the `tracks` array is built (after `.filter(Boolean)`), insert:

```typescript
// Cache track intelligence for use by evaluate-section-pair
const cacheKey = tracks.map((t: TrackIntelligence) => t.profile.trackId).join(',');
cachedTrackIntelligence = { key: cacheKey, tracks };
```

Also add the import at the top of server.ts (the function is now exported):

```typescript
import { buildMedleyDesignPayload, buildTrackIntelligence, evaluateSectionPair } from './src/engine/medleyIntelligence';
import type { TrackIntelligence } from './src/engine/medleyIntelligence';
```

Note: check if `TrackIntelligence` is already imported — if `buildTrackIntelligence` was already imported, just add `evaluateSectionPair` and `TrackIntelligence` to the existing import.

**Step 4: Add the evaluate-section-pair route**

Add this route in `server.ts` just after the design route (around line 770):

```typescript
app.post('/api/section-pair-evaluate', (req, res) => {
  const { fromTrackId, fromSectionId, toTrackId, toSectionId } = req.body || {};
  if (!fromTrackId || !fromSectionId || !toTrackId || !toSectionId) {
    return res.status(400).json({ error: 'fromTrackId, fromSectionId, toTrackId, toSectionId are all required.' });
  }
  if (!cachedTrackIntelligence) {
    return res.status(400).json({ error: 'No track intelligence available. Run /api/medley-intelligence/design first.' });
  }
  const fromTrack = cachedTrackIntelligence.tracks.find((t: TrackIntelligence) => t.profile.trackId === fromTrackId);
  const toTrack = cachedTrackIntelligence.tracks.find((t: TrackIntelligence) => t.profile.trackId === toTrackId);
  if (!fromTrack) return res.status(404).json({ error: `Track not found: ${fromTrackId}` });
  if (!toTrack) return res.status(404).json({ error: `Track not found: ${toTrackId}` });
  const result = evaluateSectionPair(fromTrack, toTrack, fromSectionId, toSectionId);
  if (!result) {
    return res.status(404).json({ error: `One or both section IDs not found (fromSectionId=${fromSectionId}, toSectionId=${toSectionId}).` });
  }
  res.json({ success: true, transition: result });
});
```

**Step 5: Verify lint**

```
npm run lint
```

**Step 6: Commit**

```
git add src/engine/medleyIntelligence.ts server.ts
git commit -m "feat: export evaluateSectionPair, add server cache + /api/section-pair-evaluate route"
```

---

## Task 3: Add `evaluate_section_pair` tool definition and App.tsx handler

**Files:**
- Modify: `src/engine/prompts.ts`
- Modify: `src/App.tsx`

**Step 1: Add the tool definition in prompts.ts**

In `TOOL_DEFINITIONS` (inside the `const TOOL_DEFINITIONS = [...]` array), add a new tool entry after `listen_to_audio` and before `read_file`:

```typescript
  {
    name: 'evaluate_section_pair',
    description: 'Evaluate the musical compatibility of a specific exit section from one track blending into a specific entry section from another track. Use this during DESIGN when you want to compare alternative section pairs beyond what the pre-computed transitionMatrixSummary provides, or to verify a specific pair before committing to it. Returns a full TransitionScore with per-dimension scores (smoothBlend, harmonicCompatibility, beatAlignment, energyContour, riskLevel, etc.).',
    parameters: {
      type: 'object',
      properties: {
        fromTrackId: { type: 'string', description: 'The trackId of the source track (the one being exited)' },
        fromSectionId: { type: 'string', description: 'The sectionId of the exit section in the source track (e.g. "track01_section_03")' },
        toTrackId: { type: 'string', description: 'The trackId of the destination track (the one being entered)' },
        toSectionId: { type: 'string', description: 'The sectionId of the entry section in the destination track (e.g. "track02_section_01")' }
      },
      required: ['fromTrackId', 'fromSectionId', 'toTrackId', 'toSectionId']
    }
  },
```

**Step 2: Add the handler in App.tsx**

In `App.tsx`, find the tool dispatch loop (search for `else if (call.name === 'listen_to_audio')`). Add a new branch after the `listen_to_audio` block and before the `read_file` block:

```typescript
            else if (call.name === 'evaluate_section_pair') {
              addLog(`  🔬 Evaluating pair: ${args.fromSectionId} → ${args.toSectionId}`);
              const res = await fetch('/api/section-pair-evaluate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  fromTrackId: args.fromTrackId,
                  fromSectionId: args.fromSectionId,
                  toTrackId: args.toTrackId,
                  toSectionId: args.toSectionId
                }),
                signal
              });
              const data = await res.json();
              toolRes = { functionResponse: { name: call.name, id: call.id, response: data } };
            }
```

**Step 3: Verify lint**

```
npm run lint
```

**Step 4: Commit**

```
git add src/engine/prompts.ts src/App.tsx
git commit -m "feat: add evaluate_section_pair tool — agent can probe specific section pairs during DESIGN"
```

---

## Task 4: Add `set_design_plan` tool for DESIGN→BUILD handoff

**Files:**
- Modify: `server.ts`
- Modify: `src/engine/prompts.ts`
- Modify: `src/App.tsx`

This tool lets the agent lock down its snippet selections at the end of DESIGN. The server validates the plan against the transition matrix cache and stores it in session state. BUILD phase instructions tell the agent to call this before issuing any FFmpeg commands.

**Step 1: Add designPlan to session state in server.ts**

Find the `sessions` object (search for `const sessions`). The session entries are plain objects. After the designPlan approach, update the type comment if present — sessions are untyped objects here, so just:

In the `app.post('/api/session/design-plan'` route (add after the section-pair route, around line 775), add:

```typescript
app.post('/api/session/design-plan', (req, res) => {
  const { sessionId, plan } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  if (!plan || !Array.isArray(plan.transitions)) {
    return res.status(400).json({ error: 'plan.transitions must be an array' });
  }
  if (!sessions[sessionId]) {
    sessions[sessionId] = { status: 'running', logs: [] };
  }
  sessions[sessionId].designPlan = plan;

  // Soft validation: warn about any low-score pairs
  const warnings: string[] = [];
  if (cachedTrackIntelligence) {
    for (const t of plan.transitions) {
      const fromTrack = cachedTrackIntelligence.tracks.find((tr: TrackIntelligence) => tr.profile.trackId === t.fromTrackId);
      const toTrack = cachedTrackIntelligence.tracks.find((tr: TrackIntelligence) => tr.profile.trackId === t.toTrackId);
      if (fromTrack && toTrack && t.fromSectionId && t.toSectionId) {
        const score = evaluateSectionPair(fromTrack, toTrack, t.fromSectionId, t.toSectionId);
        if (score && score.score < 0.35) {
          warnings.push(`Low-score transition (${score.score.toFixed(2)}): ${t.fromSectionId} → ${t.toSectionId}. Consider reviewing.`);
        }
      }
    }
  }
  res.json({ success: true, storedTransitions: plan.transitions.length, warnings });
});
```

**Step 2: Add the tool definition in prompts.ts**

In `TOOL_DEFINITIONS`, add after `evaluate_section_pair` (or before `report_progress`):

```typescript
  {
    name: 'set_design_plan',
    description: 'Lock in your DESIGN decisions before starting the BUILD phase. Call this exactly once at the end of DESIGN, after you have chosen your snippet sections and transition pairs. Provide the ordered list of transitions you plan to execute. The system validates each pair and warns you about low-score combinations. You MUST call this before any execute_shell_command calls.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'The current session ID (provided at session start)' },
        transitions: {
          type: 'array',
          description: 'Ordered list of planned transitions, one per consecutive track pair',
          items: {
            type: 'object',
            properties: {
              fromTrackId: { type: 'string' },
              fromSectionId: { type: 'string' },
              fromExitSec: { type: 'number', description: 'Exact timestamp (seconds) where you will cut/fade out of the source track' },
              toTrackId: { type: 'string' },
              toSectionId: { type: 'string' },
              toEntrySec: { type: 'number', description: 'Exact timestamp (seconds) where you will cut/fade into the destination track' },
              transitionType: { type: 'string', description: 'e.g. smooth_blend, hard_cut, energy_lift, etc.' },
              justification: { type: 'string', description: 'Why this specific pair was chosen (score data, coherence reasoning)' }
            },
            required: ['fromTrackId', 'fromSectionId', 'fromExitSec', 'toTrackId', 'toSectionId', 'toEntrySec', 'transitionType', 'justification']
          }
        }
      },
      required: ['sessionId', 'transitions']
    }
  },
```

**Step 3: Update DESIGN instructions in prompts.ts to require set_design_plan**

In `DETAILED_DESIGN_INSTRUCTIONS`, at the end of the "Required design output" section, add to the existing list:

Find this block near the bottom of `DETAILED_DESIGN_INSTRUCTIONS`:
```
Required design output (be explicit and reference specific data from the Medley Design JSON):
- Which strategy you chose and why.
- For each track the exact section(s) you selected...
- Planned transition types between pairs and supporting evidence from the scores.
- Any risky transitions and mitigation.
```

Replace with:
```typescript
const DETAILED_DESIGN_INSTRUCTIONS = `
## Phase 2: DESIGN — COHERENT SNIPPET SELECTION & BLENDING (MOST IMPORTANT PHASE)
...
Required design output (be explicit and reference specific data from the Medley Design JSON):
- Which strategy you chose and why.
- For each track the exact section(s) you selected, with preference for recommendedGlobalIntros on the opener and recommendedGlobalFinales on the closer.
- Planned transition types between pairs and supporting evidence from the scores.
- Any risky transitions and mitigation.
- **Use evaluate_section_pair for any transition you are uncertain about before committing.**
- **Call set_design_plan with your final ordered transition list BEFORE issuing any FFmpeg commands.** This locks in your timestamp decisions and validates scores.
`;
```

(Note: append the last two bullet points to the existing `Required design output` list without replacing the full string.)

**Step 4: Add the handler in App.tsx**

In App.tsx, add a new branch after the `evaluate_section_pair` handler:

```typescript
            else if (call.name === 'set_design_plan') {
              addLog(`  📋 Locking design plan: ${(args.transitions || []).length} transitions`);
              const res = await fetch('/api/session/design-plan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: sid, plan: { transitions: args.transitions } }),
                signal
              });
              const data = await res.json();
              if (data.warnings?.length) {
                for (const w of data.warnings) addLog(`  ⚠️ ${w}`);
              }
              toolRes = { functionResponse: { name: call.name, id: call.id, response: data } };
            }
```

**Step 5: Mention the session ID in the system prompt**

The `set_design_plan` tool needs the session ID. Currently the agent doesn't know it. In `buildSystemPrompt`, find where the system prompt string is returned. Add a line near the top of the prompt (after the style instructions block) that injects the session ID:

This needs App.tsx to pass `sessionId` to `buildSystemPrompt`. Check the call site in App.tsx for `buildSystemPrompt`:

Search App.tsx for `buildSystemPrompt(`. The call signature is `buildSystemPrompt(lib, config, medleyDesign)`. Change the function signature in prompts.ts to accept an optional sessionId:

```typescript
export function buildSystemPrompt(lib: LibraryFile[], config: MedleyConfig, medleyDesign?: MedleyDesignPayload | null, sessionId?: string): string {
```

And in the returned prompt string, after the style instructions block and before `${medleyDesignBlock}`, add:

```typescript
${sessionId ? `# Session ID\nYour current session ID is: **${sessionId}**\nYou will need this when calling the set_design_plan tool.\n` : ''}
```

Then in App.tsx, update the `buildSystemPrompt` call to pass `sid`:

```typescript
const systemPrompt = buildSystemPrompt(lib, config, medleyDesign, sid);
```

**Step 6: Verify lint**

```
npm run lint
```

**Step 7: Commit**

```
git add server.ts src/engine/prompts.ts src/App.tsx
git commit -m "feat: add set_design_plan tool — locks DESIGN choices before BUILD starts, validates pair scores"
```

---

## Task 5: Fix ordering strategies to use matrix section pairs

**Files:**
- Modify: `src/engine/medleyIntelligence.ts`

Currently `buildStrategy` selects section timestamps independently of the transition matrix, calling `bestSection(track, sectionKey)` for each track. This ignores the specific `fromSectionId`/`toSectionId`/`fromExitSec`/`toEntrySec` data in the matrix entries. We need `buildStrategy` to look up the matrix-chosen sections for each consecutive pair.

**Step 1: Rewrite the orderedTracks construction in buildStrategy**

Find `buildStrategy` in `medleyIntelligence.ts`. Replace the `orderedTracks` construction block:

```typescript
// BEFORE:
  const orderedTracks = orderedIds.map((trackId, index) => {
    const track = byId.get(trackId)!;
    const score = bestSection(track, sectionKey) || bestSection(track, 'hookStrength');
    const section = track.sections.find(item => item.sectionId === score?.sectionId) || track.sections[0];
    return {
      trackId,
      selectedSectionIds: section ? [section.sectionId] : [],
      entrySec: section?.startSec ?? 0,
      exitSec: section?.endSec ?? Math.min(track.profile.durationSec, 45),
      role: index === 0 ? 'opening' : index === orderedIds.length - 1 ? 'finale' : 'build'
    };
  });
```

Replace with:

```typescript
// AFTER: use specific section pairs from the matrix when available
  const orderedTracks = orderedIds.map((trackId, index) => {
    const track = byId.get(trackId)!;
    const role = index === 0 ? 'opening' : index === orderedIds.length - 1 ? 'finale' : 'build';

    // Try to derive entry and exit from the matrix pairs involving this track
    const prevId = orderedIds[index - 1];
    const nextId = orderedIds[index + 1];

    // Best matrix entry that brings us INTO this track
    const bestInbound = prevId
      ? matrix.filter(m => m.fromTrackId === prevId && m.toTrackId === trackId)
              .sort((a, b) => b.score - a.score)[0]
      : undefined;

    // Best matrix entry that takes us OUT of this track
    const bestOutbound = nextId
      ? matrix.filter(m => m.fromTrackId === trackId && m.toTrackId === nextId)
              .sort((a, b) => b.score - a.score)[0]
      : undefined;

    // Inbound defines the entry section; outbound defines the exit section
    const entrySec = bestInbound?.toEntrySec
      ?? track.sections.find(s => s.sectionId === (bestSection(track, 'entryQuality') || bestSection(track, sectionKey))?.sectionId)?.startSec
      ?? 0;

    const exitSec = bestOutbound?.fromExitSec
      ?? track.sections.find(s => s.sectionId === (bestSection(track, 'exitQuality') || bestSection(track, sectionKey))?.sectionId)?.endSec
      ?? Math.min(track.profile.durationSec, 45);

    const selectedSectionIds = Array.from(new Set([
      bestInbound?.toSectionId,
      bestOutbound?.fromSectionId
    ].filter(Boolean))) as string[];

    if (!selectedSectionIds.length) {
      const fallback = bestSection(track, sectionKey) || bestSection(track, 'hookStrength');
      if (fallback) selectedSectionIds.push(fallback.sectionId);
    }

    return { trackId, selectedSectionIds, entrySec, exitSec, role };
  });
```

**Step 2: Verify the transitions array still works**

The `transitions` line in `buildStrategy` uses:
```typescript
const transitions = orderedIds.slice(0, -1).map((trackId, index) => {
  const nextId = orderedIds[index + 1];
  return matrix.find(item => item.fromTrackId === trackId && item.toTrackId === nextId);
}).filter(Boolean) as TransitionScore[];
```

With the richer matrix (multiple entries per pair), `matrix.find()` returns the first match. Since `buildTransitionMatrix` now returns entries sorted globally by score (highest first), the global sort doesn't guarantee the first match per pair is the best. Fix this to use `sort`:

```typescript
// AFTER:
  const transitions = orderedIds.slice(0, -1).map((trackId, index) => {
    const nextId = orderedIds[index + 1];
    return matrix
      .filter(item => item.fromTrackId === trackId && item.toTrackId === nextId)
      .sort((a, b) => b.score - a.score)[0];
  }).filter(Boolean) as TransitionScore[];
```

**Step 3: Verify lint**

```
npm run lint
```

**Step 4: Quick smoke test**

Start the dev server and check the browser console:
```
npm run dev
```
Open `http://localhost:3000`, add a couple of library tracks that have been analyzed, click "Generate" and watch the pre-analysis phase. The strategies in the Medley Design JSON should now show `entrySec`/`exitSec` values that match the `toEntrySec`/`fromExitSec` from their corresponding matrix transitions, rather than independently-chosen best sections.

**Step 5: Commit**

```
git add src/engine/medleyIntelligence.ts
git commit -m "fix: buildStrategy uses matrix section pairs for entry/exit timestamps instead of independently selecting best sections"
```

---

## Summary of what was built

| Task | Files | Key change |
|------|-------|-----------|
| 1 | medleyIntelligence.ts | 5×5 matrix, top 8 pairs kept; smoothBlend rebalanced toward harmonic+beat; risk penalty 0.25→0.35 |
| 2 | medleyIntelligence.ts, server.ts | `evaluateSectionPair` exported; server caches TrackIntelligence after design; `/api/section-pair-evaluate` route |
| 3a | prompts.ts, App.tsx | `evaluate_section_pair` tool + handler |
| 3b | prompts.ts, App.tsx, server.ts | `set_design_plan` tool + handler + validation route; session ID injected into system prompt |
| 4 | medleyIntelligence.ts | `buildStrategy` derives entry/exit from matrix inbound/outbound pairs; `transitions` array uses best matrix entry per pair |
