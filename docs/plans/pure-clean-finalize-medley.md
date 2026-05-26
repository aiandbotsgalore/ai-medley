# Pure Clean Finalize Medley – Architecture Plan

**Date:** 2026-05 (ongoing)
**Status:** In discussion / early implementation
**Goal:** Eliminate intermittent silent gaps during transitions by moving to a high-quality single-pass render for the final medley output.

## Problem

The current transition architecture has a recurring quality issue:

- During BUILD, the agent calls `apply_musical_transition` which pre-renders short crossfaded transition files (using isolated `atrim` + `acrossfade` + style-specific processing).
- At the end, either the agent or `finalize_medley` must assemble:
  - Main body snippets (trimmed from original tracks)
  - These pre-rendered transition files
- Because of beat snapping, timing drift, and the difficulty of correctly trimming around pre-rendered regions, the final concatenation frequently produces **intermittent silent gaps** during transitions.

Manual assembly by the LLM (via `execute_shell_command`) is especially fragile.

## Current Hybrid Approach (What We're Building Now)

- Keep `apply_musical_transition` available during BUILD/REFINE so the agent can preview and evaluate individual transitions.
- Introduce `finalize_medley` as the **mandatory final step**.
- `finalize_medley` attempts a cleaner assembly using the enriched design plan (with `actualFromExitSec`, `actualToEntrySec`, etc.).
- A fallback path exists for safety.

This improves things but still relies on pre-rendered transition files + later re-assembly.

## The Pure Clean Vision

**Core idea:** For the final output, completely ignore all pre-rendered transition files.

Instead, `finalize_medley` builds **one single, massive `filter_complex`** that:

1. Extracts every main segment directly from the original source files using the *final* locked timings from the design plan.
2. Applies every crossfade, style-specific EQ/high-pass carving, loudnorm, and other processing in one continuous chain.
3. Outputs the complete medley in a single pass.

### Benefits
- Highest possible audio quality (minimal re-encoding).
- Perfect sample-accurate timing with no drift.
- Eliminates the entire class of "gaps from bad manual assembly" bugs.
- The agent only needs to produce a correct locked design plan with final timestamps.
- Easier to apply global post-processing if desired later.

### Trade-offs / Challenges
- The final render becomes a longer atomic operation.
- The filter_complex string becomes very long for medleys with many tracks/transitions.
- More complex to implement and debug initially.
- Loses easy per-transition preview files unless we keep the preview path separate (which we should).

## Recommended Architecture (Hybrid + Pure Clean Final Step)

- **During BUILD/REFINE:** Agent can still freely call `apply_musical_transition` to render and listen to individual transitions (very useful for iteration and evaluation).
- **At the very end:** Agent **must** call `finalize_medley`.
  - Preferred mode: Pure clean single-pass render (ignores pre-rendered transitions).
  - Fallback mode: Careful assembly using pre-rendered transitions + exact timings (current direction).
- The prompt should treat `finalize_medley` as the required final action.

## Pure Clean Filter Complex Construction Sketch

### Input Data
- `designPlan.transitions[]` (enriched with `actualFromExitSec`, `actualToEntrySec`, `style`/`transitionType`, `durationUsed`, beat snap info, etc.).
- Access to original full track files (via library or workdir).
- Optional: cached `TrackIntelligence` for beat grids if beat-aligned processing is still desired in the final pass.

### High-Level Algorithm

1. Build an ordered list of tracks from the transitions.
2. For each consecutive pair of tracks, determine the exact crossfade region using the final actual timings.
3. Build a sequence of main segments:
   - Track 1: 0 → first transition’s actual exit
   - Track 2: previous transition’s actual entry → next transition’s actual exit
   - ...
   - Last track: last transition’s actual entry → end of file
4. For each join, apply the appropriate style-specific processing + `acrossfade`.
5. Chain everything with successive `acrossfade` (or a more advanced multi-input graph for complex styles like mashup_layer).
6. Apply final loudnorm / limiting on the output.
7. Write the final 320kbps MP3.

### Example Filter Complex Structure (Conceptual)

For a simple 3-track medley with 2 transitions:

```text
[0:a]atrim=start=0:end=ACTUAL_EXIT1,loudnorm=I=-14:TP=-1.5[main0];
[1:a]atrim=start=ACTUAL_ENTRY1:end=ACTUAL_EXIT2,loudnorm=I=-14:TP=-1.5[main1];
[2:a]atrim=start=ACTUAL_ENTRY2,loudnorm=I=-14:TP=-1.5[main2];

[main0][main1]acrossfade=d=TRANS1_DUR:curve1=tri:curve2=tri[xfade1];
[xfade1][main2]acrossfade=d=TRANS2_DUR:curve1=tri:curve2=tri[final]
```

Style-specific extras (high-pass, EQ carving, etc.) can be inserted on the individual streams before each `acrossfade`, mirroring the logic already used in `apply_musical_transition`.

For beat-aligned transitions, the trim points themselves are already adjusted in the design plan (thanks to enrichment during the transition calls).

### Dynamic Construction

In code, this would look roughly like:

- Iterate through the ordered transitions.
- For each segment, emit an `atrim + loudnorm` (plus style extras) into a labeled stream.
- Between segments, emit an `acrossfade` that connects the previous output label to the new segment label.
- Accumulate the filter string.
- At the end, map the final label and apply global normalization.

This can be built incrementally in a loop, similar to (but more sophisticated than) the current piece-by-piece concat logic in the fallback path.

## Implementation Roadmap (Suggested)

1. **Phase 1 (Current):** Make `finalize_medley` mandatory in the prompt + improve the hybrid path with better trimming and fallback (in progress).
2. **Phase 2:** Implement a working "pure clean" path inside `finalize_medley` that builds the big filter_complex using the enriched design plan (ignore pre-rendered transition files for the final output).
3. **Phase 3:** Add optional style-specific processing inside the big graph (reuse/adapt existing style logic).
4. **Phase 4 (Optional):** Add a mode or separate tool that can still produce individual transition preview files on demand without affecting the final clean render.
5. **Phase 5:** Add progress reporting / logging during the long filter_complex build.

## Open Questions

- Should `finalize_medley` always do the pure clean version, or should it have a parameter to choose between "pure clean" and "use pre-rendered transitions"?
- How do we handle very complex styles (e.g. mashup_layer) that may require simultaneous layering rather than simple sequential crossfades?
- Do we want to support global mastering (e.g. one final loudnorm pass across the whole medley) as part of the pure clean render?
- How do we surface useful debug information if the giant filter_complex fails?

## Related Files

- `src/engine/prompts.ts` – Tool definitions + BUILD phase instructions (make `finalize_medley` required + document the pure clean expectation).
- `server.ts` – `/api/apply-transition` (enrichment of design plan) and `/api/finalize-medley` (the actual pure clean logic).
- `src/App.tsx` – Handling of the `finalize_medley` tool call.

---

**Purpose of this document:** Provide a clear, reviewable plan for another AI (or future self) to understand the motivation, architecture, and implementation direction for the pure clean final render strategy.

---

## Review Feedback from Claude (2026-05)

> **To: Grok AI (the agent implementing this plan)**
> **From: Claude (code review / architecture pass)**
> **Re: Pure Clean Finalize Medley – Revised Architecture Notes**

[Full review text pasted by user inserted here for context and action]

**Key Action Items from Review (prioritized):**

- Design mashup_layer branching support into the filter_complex builder in Phase 2.
- Move input validation, full filter_complex logging to debug file, and structured FFmpeg stderr parsing to Phase 2.
- Add hard guard in `finalize_medley`: if any transition is missing `actualFromExitSec`/`actualToEntrySec`, reject with clear list of missing transitions.
- Reconsider loudnorm: prefer lighter per-segment + one final global `loudnorm` + limiter.
- Merge style-specific processing hooks into the main loop from Phase 2 (pluggable `buildSegmentProcessing` step).
- Update phase order as proposed in the review.
- Answer the open questions as recommended in the review.

The detailed sketch below has been updated to reflect these points.

---

## Detailed Pure Clean Filter Complex Construction (Incorporating Review Feedback)

### Design Principles (addressing Claude's review)

- **Mashup Layer**: Design branching support into the architecture in Phase 2 (not deferred).
- **Error Handling & Debuggability**: Validation + full filter_complex logging must be in Phase 2.
- **Enrichment Guard**: Treat missing `actual*` data as a hard failure with a clear list of offending transitions.
- **Loudnorm Strategy**: Use lighter per-segment normalization + one final `loudnorm` + limiter on the complete output.
- **Style Hooks**: Make per-segment style processing a first-class pluggable step from the beginning.

### Recommended Function Signature

```ts
function buildPureCleanFilterComplex(
  transitions: any[], 
  trackPathMap: Record<string, string>,
  cachedTrackIntelligence?: any
): {
  filterComplex: string;
  inputFiles: string[];
}
```

### High-Level Construction Loop (Sketch)

```ts
transitions.forEach((t, i) => {
  const fromId = t.fromTrackId;
  const toId   = t.toTrackId;
  const fromExit = t.actualFromExitSec;
  const toEntry  = t.actualToEntrySec;
  const dur      = t.durationUsed || 5;
  const style    = t.transitionType || 'smooth_blend';

  // Add source files (deduped)
  // ...

  // Main segment A (first one only)
  if (i === 0) {
    filterParts.push(`[${fromIdx}:a]atrim=start=0:end=${fromExit},loudnorm=...[seg${i}a]`);
    currentLabel = `seg${i}a`;
  }

  // Main segment B
  filterParts.push(`[${toIdx}:a]atrim=start=${toEntry}:end=${nextEnd || null},loudnorm=...[seg${i}b]`);

  // Get style config (pluggable)
  const styleConfig = getTransitionStyleConfig(style);   // returns curve + extraFilters + isMashup

  const xfadeLabel = `xfade${i}`;

  if (styleConfig.isMashup) {
    // Branching for mashup_layer (designed from day one)
    filterParts.push(`[${currentLabel}][seg${i}b]acrossfade=...[base${i}]`);
    filterParts.push(`[${currentLabel}][seg${i}b]amix=inputs=2:duration=longest,volume=0.5[mash${i}]`);
    filterParts.push(`[base${i}][mash${i}]amix=inputs=2[${xfadeLabel}]`);
  } else {
    filterParts.push(`[${currentLabel}][seg${i}b]acrossfade=d=${dur}:${styleConfig.curve}${styleConfig.extraFilters}[${xfadeLabel}]`);
  }

  currentLabel = xfadeLabel;
});

// Final global processing (recommended)
filterParts.push(`[${currentLabel}]loudnorm=I=-14:TP=-1.5[final]`);
```

### Key Implementation Safeguards (Phase 2)

1. **Pre-validation**
   ```ts
   const missing = transitions.filter(t => !t.actualFromExitSec || !t.actualToEntrySec);
   if (missing.length) throw new Error(`Missing actual timing data on: ${missing.map(...)}`);
   ```

2. **Debug Logging**
   ```ts
   const debugPath = path.join(sessionWorkDir, 'final_filtergraph.txt');
   fs.writeFileSync(debugPath, filterComplex);
   console.log(`[finalize-medley] Filter complex written to ${debugPath}`);
   ```

3. **Better FFmpeg Error Parsing** (after exec)
   - Look for labels like `[seg3]`, `[xfade2]`, or `atrim` errors in stderr and surface the exact segment that failed.

This is the direction for the pure clean implementation.

---

**Next Action Recommendation**

Start by creating a private helper in `server.ts`:

```ts
function buildPureCleanFilterComplex(designPlan: any, trackPathMap: Record<string,string>, cachedTrackIntelligence?: any): string
```

Inside `finalize_medley`, if `useCleanRender` (or always in the future), call this helper instead of the piece-based hybrid logic.

Would you like me to begin writing the skeleton of this function now?

---

## Detailed Pure Clean Filter Complex Construction (Incorporating Review Feedback)

### Design Principles (addressing Claude's review)

- **Mashup Layer**: Design branching support into the architecture in Phase 2 (not deferred).
- **Error Handling & Debuggability**: Validation + full filter_complex logging must be in Phase 2.
- **Enrichment Guard**: Treat missing `actual*` data as a hard failure with a clear list of offending transitions.
- **Loudnorm Strategy**: Use lighter per-segment normalization + one final `loudnorm` + limiter on the complete output.
- **Style Hooks**: Make per-segment style processing a first-class pluggable step from the beginning.

### Recommended Function

```ts
function buildPureCleanFilterComplex(
  transitions: any[], 
  trackPathMap: Record<string, string>,
  cachedTrackIntelligence?: any
): {
  filterComplex: string;
  inputFiles: string[];
}
```

### High-Level Construction Loop (Sketch)

```ts
transitions.forEach((t, i) => {
  const fromId = t.fromTrackId;
  const toId   = t.toTrackId;
  const fromExit = t.actualFromExitSec;
  const toEntry  = t.actualToEntrySec;
  const dur      = t.durationUsed || 5;
  const style    = t.transitionType || 'smooth_blend';

  // Add source files (deduped)
  // ...

  // Main segment A (first one only)
  if (i === 0) {
    filterParts.push(`[${fromIdx}:a]atrim=start=0:end=${fromExit},loudnorm=...[seg${i}a]`);
    currentLabel = `seg${i}a`;
  }

  // Main segment B
  filterParts.push(`[${toIdx}:a]atrim=start=${toEntry}:end=${nextEnd || null},loudnorm=...[seg${i}b]`);

  // Get style config (pluggable)
  const styleConfig = getTransitionStyleConfig(style);   // returns curve + extraFilters + isMashup

  const xfadeLabel = `xfade${i}`;

  if (styleConfig.isMashup) {
    // Branching for mashup_layer (designed from day one)
    filterParts.push(`[${currentLabel}][seg${i}b]acrossfade=...[base${i}]`);
    filterParts.push(`[${currentLabel}][seg${i}b]amix=inputs=2:duration=longest,volume=0.5[mash${i}]`);
    filterParts.push(`[base${i}][mash${i}]amix=inputs=2[${xfadeLabel}]`);
  } else {
    filterParts.push(`[${currentLabel}][seg${i}b]acrossfade=d=${dur}:${styleConfig.curve}${styleConfig.extraFilters}[${xfadeLabel}]`);
  }

  currentLabel = xfadeLabel;
});

// Final global processing (recommended)
filterParts.push(`[${currentLabel}]loudnorm=I=-14:TP=-1.5[final]`);
```

### Key Implementation Safeguards (Phase 2)

1. **Pre-validation**
   ```ts
   const missing = transitions.filter(t => !t.actualFromExitSec || !t.actualToEntrySec);
   if (missing.length) throw new Error(`Missing actual timing data on: ${missing.map(...)}`);
   ```

2. **Debug Logging**
   ```ts
   const debugPath = path.join(sessionWorkDir, 'final_filtergraph.txt');
   fs.writeFileSync(debugPath, filterComplex);
   console.log(`[finalize-medley] Filter complex written to ${debugPath}`);
   ```

3. **Better FFmpeg Error Parsing** (after exec)
   - Look for labels like `[seg3]`, `[xfade2]`, or `atrim` errors in stderr and surface the exact segment that failed.

This is the direction for the pure clean implementation.

---

**Ready for next step?**

I can now:
- Turn the sketch above into a real helper function in `server.ts`
- Update the plan document with the revised phase order from the review
- Add the enrichment guard + debug logging into the current route

Which would you like me to do first? (Or all three in parallel?)