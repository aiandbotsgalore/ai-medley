# Design Spec: `apply_musical_transition` Tool

> **SUPERSEDED**  
> This document is obsolete. The `apply_musical_transition` tool it describes has been fully implemented (see current `/api/apply-transition` logic in `server.ts` and tool definition in `prompts.ts`).  
> **Archived as historical reference only.** Do not implement anything from this spec.

**Original Status:** Design Phase  
**Date:** 2026-05  
**Original Goal:** Dramatically improve the musical quality of transitions in generated medleys by giving the agent a high-quality, musically-aware blending primitive instead of raw FFmpeg commands.

---

## 1. Problem Statement

Even when the agent makes excellent high-level decisions (good section selection, coherent ordering, and a strong design plan), the **actual audio execution** of transitions remains a major quality bottleneck.

Currently, the agent issues low-level commands such as:

```bash
ffmpeg ... -af "acrossfade=d=5:curve1=tri:curve2=tri" ...
```

This approach frequently produces:
- Phasey or smeared transitions
- Abrupt energy or spectral jumps
- Poor musical timing (even when beat data exists)
- Inconsistent loudness and tone across the medley

**The core issue** is that the agent is being asked to act as both the musical director *and* the audio engineer. This is where quality suffers most.

---

## 2. Solution Overview

Introduce a new high-level tool called `apply_musical_transition`.

This tool allows the agent to express **musical intention** ("I want a beat-aligned energy ramp here") while the backend handles professional-grade audio processing using the rich data already available in `medleyIntelligence`.

The tool is responsible for the **entire transition**, including:
- Relevant clip extraction
- Normalization / loudness matching
- Intelligent blending based on the chosen style

---

## 3. Tool Interface

### Tool Name
`apply_musical_transition`

### Parameters

| Parameter      | Type     | Required | Description |
|----------------|----------|----------|-----------|
| `fromTrackId`  | string   | Yes      | Track ID of the source section |
| `fromSectionId`| string   | Yes      | Section ID of the source (exit) |
| `toTrackId`    | string   | Yes      | Track ID of the destination section |
| `toSectionId`  | string   | Yes      | Section ID of the destination (entry) |
| `style`        | string   | Yes      | One of the supported transition styles (see below) |
| `duration`     | number   | No       | Desired transition length in seconds. Backend may adjust slightly for musical reasons. |
| `intensity`    | number   | No       | 0.0 – 1.0. Controls how expressive/aggressive the transition should feel. |
| `beatAlign`    | boolean  | No       | Whether the transition should attempt to align to beats/downbeats. |
| `notes`        | string   | No       | Free-text instructions or musical intent from the agent (e.g. "make this feel like a big lift into the chorus"). |

**Defaults:**
- `duration`: Style-dependent (typically 4–6 seconds)
- `intensity`: 0.6
- `beatAlign`: `false` (agent must opt-in)

---

## 4. Supported Transition Styles

| Style                | Primary Use Case                     | Characteristics                              | Recommended `beatAlign` |
|----------------------|--------------------------------------|----------------------------------------------|-------------------------|
| `smooth_blend`       | General musical flow                 | Transparent, natural, good spectral continuity | Optional |
| `beat_aligned`         | Groove / dance music                 | Strong beat/downbeat locking, rhythmic continuity | Strongly recommended |
| `energy_ramp`        | Building or releasing energy         | Progressive intensity shift, often with spectral movement | Recommended |
| `harmonic_blend`     | Key-compatible, tonal material       | Emphasizes harmonic smoothness               | Optional |
| `dramatic_cut`       | Impactful, intentional moments       | Sharper, shorter, more aggressive            | Optional |
| `reset_moment`       | Breakdowns / low-energy resets       | Gentle dip followed by re-entry              | Optional |
| `mashup_layer`       | Creative overlapping / layering      | Allows more overlap with frequency carving   | Optional |

**Notes on `mashup_layer`:**
- Treated as a first-class style (not experimental).
- Backend should use more sophisticated layering techniques (EQ ducking, spectral carving, etc.).
- May result in longer overlap durations than traditional crossfades.

---

## 5. Backend Responsibilities

When the tool is invoked, the backend must:

1. **Resolve sections** using the provided IDs and pull relevant data from `medleyIntelligence` (beat grid, energy curve, spectral data, section boundaries, etc.).

2. **Determine actual cut points**, with the ability to make small musical adjustments (especially when `beatAlign` is true).

3. **Perform full transition processing**, including:
   - Clip extraction
   - Loudness normalization (consistent with the rest of the medley)
   - Style-specific DSP (multiband processing, beat-aware envelopes, spectral matching, etc.)
   - Beat snapping logic (when requested) — **snap only**, no time-stretching

4. **Return structured feedback** to the agent.

The tool should aim for **consistent high quality** rather than maximum flexibility.

---

## 6. Return Value

```json
{
  "success": true,
  "actualFromExitSec": number,
  "actualToEntrySec": number,
  "styleUsed": string,
  "durationUsed": number,
  "beatAligned": boolean,
  "notes": string,
  "transitionQualityHint": number   // 0–100 rough self-assessment (optional but useful)
}
```

The `notes` field should contain useful information for the agent, such as:
- Why certain decisions were made
- Any compromises (e.g. "beat alignment confidence was low, so snapped to nearest strong beat instead")
- Suggestions for future refinement

---

## 7. Integration with Existing System

### With `set_design_plan`
- The agent should still use `set_design_plan` to lock its high-level structure and chosen sections.
- During `BUILD`, it calls `apply_musical_transition` for each planned transition instead of raw `execute_shell_command` for blending.

### With Evaluation
- The agent can (and should) continue using `analyze_medley_quality` after applying transitions.
- Future enhancement: Add transition-specific metrics (spectral continuity at boundary, beat alignment error, energy delta, etc.).

### With Wisdom Accumulation
- Every call to `apply_musical_transition` (plus its parameters and resulting quality scores) should be recorded in the permanent wisdom store.
- This data can later be used to bias future designs toward transition styles that historically worked well between certain track types.

### With the Agent Prompt
The system prompt should be updated to:
- Strongly encourage use of this tool during the `BUILD` phase.
- Discourage raw `execute_shell_command` for crossfading when this tool is available.
- Teach the agent the musical meaning of each `style`.

---

## 8. Design Principles

- **Agent owns intention. Backend owns execution.**
- **Strong defaults, limited but powerful controls.**
- **Snap to beats, do not stretch** (per current decision).
- `mashup_layer` is a legitimate creative choice, not an afterthought.
- The tool should feel like calling a skilled audio engineer, not writing DSP code.

---

## 9. Open Questions / Future Work

- Should we eventually support light time-stretching for beat alignment?
- How should we handle transitions that cross multiple sections or involve more than two tracks?
- Should there be a separate tool for global loudness / final mastering passes?
- How do we best surface transition quality in the UI and in wisdom queries?

---

## 10. Recommended Next Steps

1. Review and refine this spec.
2. Update the agent prompt with clear instructions and examples for using the new tool.
3. Implement the tool (backend logic + tool registration).
4. Update `set_design_plan` documentation / validation if needed.
5. Add transition logging to the wisdom system.
6. Iterate based on real medley results.

---

**Document Owner:** Grok  
**Review Status:** Awaiting user feedback before implementation.