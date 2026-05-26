# Pure Clean Timeline Render Engine – Full Implementation Plan

**Project:** AI Medley Engine  
**Status:** Draft for Review & Refinement  
**Last Updated:** 2026-05  
**Owner:** Logan (with AI assistance)

---

## 1. Executive Summary

The current architecture for rendering the final medley relies on pre-rendering individual transitions as separate audio files and then later reassembling them with main body segments via `execute_shell_command` + concat. This approach has proven fragile and is the root cause of intermittent silent gaps, timing drift, beat misalignment, and quality degradation.

The correct long-term architecture is a **deterministic, timeline-centric, graph-compiled, single-pass render engine**.

All final output must be generated from:
- Original source tracks
- An authoritative timeline model
- A compiled filter graph
- A single FFmpeg render pass

This document defines the full plan to migrate from the current "transition snippet + manual assembly" model to a proper **Pure Clean Timeline Render Engine**.

---

## 2. Problem Statement

Current problems with the existing approach:

- Silent gaps during transitions
- Accumulated timing drift (especially after beat snapping)
- Re-encoding quality loss across multiple renders
- Brittleness when the agent manually writes concat commands
- Difficulty supporting advanced use cases (mashups, layering, automation, stems)
- Poor debuggability when things go wrong in the final assembly

---

## 3. Architectural Vision

### Old Model (Current)
```
Tracks → Pre-render transition snippets → Manual reassembly via concat → Final file
```

### New Model (Target)
```
Tracks + Authoritative Timeline
    ↓
Timeline Segment Graph
    ↓
Layer / Mix Graph
    ↓
Master Bus
    ↓
Single-Pass FFmpeg Render (via filter_complex_script)
```

---

## 4. Core Architectural Principles

1. **Timeline is Authoritative**  
   The final render must be driven by a formal timeline model, not by ad-hoc file concatenation.

2. **Preview ≠ Final**  
   Fast preview renders (for the agent to audition transitions during BUILD/REFINE) are allowed and encouraged, but they must be treated as disposable. The final output must always come from the clean timeline path.

3. **Single Source of Truth for Final Output**  
   The final medley must be rendered directly from the original source tracks using one filter graph. Pre-rendered transition files must **not** be used in the final render.

4. **Determinism & Debuggability**  
   All graphs must use deterministic labels. Every render must produce rich debug artifacts.

5. **Extensibility**  
   The system must be designed from day one to support future advanced features (automation curves, layered vocals, stems, DJ drops, sidechain processing, etc.).

---

## 5. Data Models

### 5.1 Timeline Segment

```ts
type TimelineSegment = {
  id: string;

  sourceTrackId: string;
  sourceStartSec: number;
  sourceEndSec: number;

  timelineStartSec: number;
  timelineEndSec: number;

  layer: number;                    // 0 = main, higher = overlays/layers

  fadeIn?: FadeSpec;
  fadeOut?: FadeSpec;

  processingChain?: ProcessingStep[];

  metadata?: {
    beatAligned?: boolean;
    transitionType?: string;
    energyCurve?: string;
    tailDurationSec?: number;       // for preserving reverb/decay
  };
};
```

### 5.2 FadeSpec

```ts
type FadeSpec = {
  durationSec: number;
  curve: string;                    // 'tri', 'log', 'exp', etc.
};
```

### 5.3 ProcessingStep

```ts
type ProcessingStep = {
  type: string;                     // 'eq', 'highpass', 'compressor', etc.
  params: Record<string, any>;
};
```

### 5.4 TimelineLayer

```ts
type TimelineLayer = {
  id: string;
  segments: TimelineSegment[];
};
```

### 5.5 TimelineEvent (Future)

```ts
type TimelineEvent = {
  type: string;                     // 'dj_drop', 'vocal_insert', 'automation', etc.
  timelinePositionSec: number;
  payload?: any;
};
```

### 5.6 TimelineModel

```ts
type TimelineModel = {
  segments: TimelineSegment[];
  layers?: TimelineLayer[];
  events?: TimelineEvent[];
  masterBus?: ProcessingStep[];
};
```

---

## 6. System Architecture

### Recommended Pipeline

```
Timeline Segments
    ↓
Layer Graph Builder
    ↓
Mix Graph Builder
    ↓
Master Bus
    ↓
Filter Graph Compiler
    ↓
filter_complex_script (written to disk)
    ↓
FFmpeg Single-Pass Render
```

### Key Components to Build

1. **Timeline Model** (data structures + validation)
2. **Graph DSL** (`FilterNode`, `FilterGraph`)
3. **Filter Graph Compiler** (`compileFilterGraph(graph) → string`)
4. **Style Plugin System** (`getTransitionStyleProcessor(style)`)
5. **Pure Clean Render Engine** (`buildPureCleanRender(timeline, trackPathMap)`)
6. **Preview vs Final Separation**

---

## 7. Required Technical Practices (Non-Negotiable)

- **Always** use `aformat` on all inputs (sample_fmts=fltp, sample_rates=48000, channel_layouts=stereo)
- **Always** use `asetpts=PTS-STARTPTS` after `atrim`
- **Always** use `-filter_complex_script` (never inline giant strings)
- Use only **deterministic labels** (`seg_0`, `seg_1`, `mix_0`, `fade_0`, `master_bus`, `final_out`)
- Only **one final encode** for the authoritative output
- Write rich debug artifacts on every render:
  - `timeline.json`
  - `compiled_graph.txt`
  - `ffmpeg_command.txt`
  - `ffmpeg_stderr.log`
  - `validation_report.json`

---

## 8. Implementation Phases (Revised Order)

| Phase | Name                              | Focus                                      | Priority |
|-------|-----------------------------------|--------------------------------------------|----------|
| 1     | Stabilize Current System          | Make `finalize_medley` mandatory, add validation, debug logging, structured error parsing | High |
| 2     | Timeline Data Model + Validation  | Define `TimelineSegment`, `TimelineLayer`, validators | Critical |
| 3     | Graph DSL + Compiler              | `FilterNode`, `FilterGraph`, `compileFilterGraph()` | Critical |
| 4     | `filter_complex_script` Support   | Mandatory use of script files | High |
| 5     | Pure Clean Render Path            | `buildPureCleanRender()` using timeline → graph | High |
| 6     | Style Plugin System               | Pluggable per-style processing & layering | Medium |
| 7     | Mashup / Layering Support         | Branching graphs for simultaneous layers | Medium |
| 8     | Tail Preservation System          | `tailDurationSec` / `postTransitionTailSec` | Medium |
| 9     | Preview Render Subsystem          | Fast, disposable preview renders | Medium |
| 10    | Global Timeline Engine            | Events, automation curves, future features | Low |

**Note:** Error handling, debug logging, and validation should be built into Phases 2–5, not deferred.

---

## 9. Prompt & Agent Behavior Changes

Update BUILD/REFINE instructions to clearly state:

- Transition previews (via `apply_musical_transition`) are temporary audition assets only.
- The **final** medley **must** be rendered using `finalize_medley`.
- The agent must not perform manual concat assembly of the final output.
- All timing decisions must come from the authoritative timeline.

---

## 10. Risks & Mitigations

| Risk | Mitigation |
|------|----------|
| Extremely long filter_complex strings | Use `filter_complex_script` + good graph compiler |
| Debugging giant graphs | Deterministic labels + rich logging + structured error parsing |
| Agent resistance to new tool | Strong prompt language + clear error messages if it tries manual assembly |
| Performance of very large graphs | Profile early; consider splitting into multiple filter_complex stages if needed |
| Mashup_layer complexity | Design branching support from Phase 2 |

---

## 11. Success Criteria

- Zero silent gaps in final renders across a wide range of libraries and styles.
- All final output is produced via a single authoritative filter graph.
- Agent reliably uses `finalize_medley` as the mandatory final step.
- System can support future advanced features (automation, layering, stems) without major refactoring.
- Excellent debuggability (engineer or agent can understand exactly what happened from the artifacts).

---

## 12. Open Decisions / Questions

- Should `finalize_medley` always do the pure clean path, or should there be a `usePrerenderedTransitions` debug flag?
- How aggressively should we apply global mastering (final `loudnorm` + limiter) in the pure clean path?
- What is the right granularity for the Graph DSL (very low-level nodes vs. higher-level "Transition" nodes)?
- How do we handle very long medleys that might exceed practical filter_complex size limits?

---

## 13. Non-Negotiable Rules

### DO
- Treat the timeline as authoritative
- Use original source tracks for final render
- Use single-pass (or well-defined staged) rendering for final output
- Use deterministic graph generation
- Validate aggressively before rendering
- Separate preview rendering from final rendering
- Log everything needed for debugging

### DO NOT
- Concatenate pre-rendered transition snippets for the final authoritative output
- Use per-segment `loudnorm` as the only normalization
- Inline giant filtergraphs (always use `filter_complex_script`)
- Allow silent fallback corruption
- Tightly couple the agent’s creative decisions to low-level FFmpeg string construction
- Build complex FFmpeg strings directly in business logic without a graph layer

---

## 14. Long-Term End State

The system should evolve into:

```
Creative Planning Layer (agent reasoning + design plan)
    ↓
Timeline Authoring Layer
    ↓
Segment Graph Compiler
    ↓
Mix / Layer Graph Compiler
    ↓
Master Bus Compiler
    ↓
FFmpeg Render Backend (via filter_complex_script)
```

This is the correct foundation for a professional, scalable, future-proof medley rendering engine.

---

**Document Status:** Draft for review and refinement before implementation begins.

**Next Steps (once reviewed):**
1. Finalize data models
2. Define Graph DSL
3. Implement validation + debug logging infrastructure
4. Build the Timeline → Graph compiler
5. Implement `buildPureCleanRender`

---

*This document supersedes earlier versions of the pure clean finalize plan.*