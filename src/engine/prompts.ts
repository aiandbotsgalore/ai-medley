import { Type } from "@google/genai";
import type { MedleyConfig } from "../components/ConfigPanel";
import type { LibraryFile } from "../components/LibrarySidebar";
import type { MedleyDesignPayload } from "./medleyIntelligence";
import { diagnosePayload } from "../utils/payloadDiagnostics";
import {
  getGeminiManualToolDeclarations,
  getOpenRouterManualTools,
} from "./manualToolContracts";

const DETAILED_DESIGN_INSTRUCTIONS =
  "## Phase 2: DESIGN — COHERENT SNIPPET SELECTION & BLENDING (MOST IMPORTANT PHASE)\n" +
  "Your primary job in this phase is to create a *beautiful, seamless, musically coherent medley* — not just a sequence of good songs.\n\n" +
  "You must:\n" +
  "1. **Choose the single best specific snippet** from each track for its role in the *overall medley*, not just the best snippet for that track in isolation.\n" +
  "   - For the very first track: strongly prefer the highest-ranked intro_candidate, clean_exit_candidate (if used as opener), or first_strong_entrance that also has good energy for starting the whole experience.\n" +
  "   - For middle tracks: choose entry + exit snippets that create natural, low-shock handoffs with the previous track's exit and the next track's entry.\n" +
  "   - For the final track: prioritize finale_candidate or strong high-energy late sections that give satisfying closure.\n\n" +
  "2. **Think in terms of specific section-to-section blending**, not just track order.\n" +
  "   - Look at the transitionMatrixSummary for high-scoring pairs.\n" +
  "   - When the matrix gives you a strong fromSectionId to toSectionId recommendation between two tracks, treat that as high-value data for creating seamlessness.\n" +
  "   - Prefer combinations where beat alignment is high, energy contour flows naturally, spectral brightness/density is compatible, and exit of one and entry of the next feel like they belong together.\n\n" +
  "3. **Explicitly design the global intro and global outro** (use recommendedGlobalIntros and recommendedGlobalFinales):\n" +
  "   - Strongly consider highest-ranked entries for opening selection.\n" +
  "   - Strongly consider highest-ranked entries for closing selection.\n" +
  "   - Opening 15-30 seconds should feel intentional and inviting.\n" +
  "   - Final 20-40 seconds should feel like a real conclusion.\n\n" +
  "4. Use recommendedStrategies heavily.\n\n" +
  "**Strict rules:**\n" +
  "- Always use exact timestamps from candidates.\n" +
  "- Never invent timestamps.\n";

const TOOL_DEFINITIONS = [
  {
    name: "execute_shell_command",
    description:
      "Execute a shell command in the session work directory. Use ONLY for lightweight filesystem diagnostics (dir, ls, cat, find, echo). Do NOT run ffmpeg commands here. Do NOT use this for rendering, concatenating, or exporting audio. The final MP3 must be produced by calling finalize_medley — not by this tool.",
    parameters: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    },
  },
  {
    name: "listen_to_audio",
    description: "Analyze an audio file by path.",
    parameters: {
      type: "object",
      properties: { filePath: { type: "string" } },
      required: ["filePath"],
    },
  },
  {
    name: "evaluate_section_pair",
    description: "Evaluate compatibility between two sections.",
    parameters: {
      type: "object",
      properties: {
        fromTrackId: { type: "string" },
        fromSectionId: { type: "string" },
        toTrackId: { type: "string" },
        toSectionId: { type: "string" },
      },
      required: ["fromTrackId", "fromSectionId", "toTrackId", "toSectionId"],
    },
  },
  {
    name: "set_design_plan",
    description: "Lock DESIGN decisions.",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        transitions: { type: "array" },
      },
      required: ["sessionId", "transitions"],
    },
  },
  {
    name: "apply_musical_transition",
    description:
      "Applies a musical transition between two sections. You MUST choose an appropriate 'style'. " +
      "Returns outputPath (temporary preview file), actualFromExitSec, actualToEntrySec (use these for the final plan), and recommended trim points. " +
      "Available styles and when to use them:\n" +
      "- 'smooth_blend': Default transparent musical join.\n" +
      "- 'beat_aligned': Strong rhythmic lock (enable beatAlign).\n" +
      "- 'energy_ramp': Clear build-up or drop.\n" +
      "- 'harmonic_blend': Key-compatible tonal continuity.\n" +
      "- 'dramatic_cut': Bold genre/mood shift.\n" +
      "- 'reset_moment': Breathing room after high energy.\n" +
      "- 'mashup_layer': Currently unavailable. Do not select it.",
    parameters: {
      type: "object",
      properties: {
        fromTrackId: { type: "string" },
        fromSectionId: { type: "string" },
        toTrackId: { type: "string" },
        toSectionId: { type: "string" },
        style: { type: "string" },
        duration: { type: "number" },
        intensity: { type: "number" },
        beatAlign: { type: "boolean" },
        notes: { type: "string" },
      },
      required: [
        "fromTrackId",
        "fromSectionId",
        "toTrackId",
        "toSectionId",
        "style",
      ],
    },
  },
  {
    name: "analyze_medley_quality",
    description: "Analyze loudness/true peak.",
    parameters: {
      type: "object",
      properties: { filePath: { type: "string" } },
      required: ["filePath"],
    },
  },
  {
    name: "read_file",
    description: "Read file",
    parameters: {
      type: "object",
      properties: { filePath: { type: "string" } },
      required: ["filePath"],
    },
  },
  {
    name: "write_file",
    description: "Write file",
    parameters: {
      type: "object",
      properties: { filePath: { type: "string" }, content: { type: "string" } },
      required: ["filePath", "content"],
    },
  },
  {
    name: "save_file_analysis",
    description: "Save analysis data",
    parameters: {
      type: "object",
      properties: {
        fileId: { type: "string" },
        analysisText: { type: "string" },
      },
      required: ["fileId", "analysisText"],
    },
  },
  {
    name: "report_progress",
    description:
      "Report current quality scores. ALL scores MUST be integers on a 0–100 scale (e.g. 85 means 85% quality, not 0.85). DO NOT use decimals or 0–1 values. The score is NOT a permission gate — any score value does NOT authorize or require manual FFmpeg work. Call this once after transitions are applied, then immediately call finalize_medley regardless of score. Do not attempt execute_shell_command after this.",
    parameters: {
      type: "object",
      properties: {
        emotionalArc: {
          type: "number",
          description: "Emotional arc quality. Integer 0–100. Example: 82",
        },
        transitionSmoothness: {
          type: "number",
          description:
            "Transition smoothness quality. Integer 0–100. Example: 79",
        },
        performerIdentity: {
          type: "number",
          description:
            "How well each performer's identity is preserved. Integer 0–100. Example: 85",
        },
        overallScore: {
          type: "number",
          description: "Overall medley quality. Integer 0–100. Example: 83",
        },
        iteration: { type: "number", description: "Current iteration number" },
        phase: {
          type: "string",
          description: "Current phase: ANALYZE | DESIGN | BUILD | FINISH",
        },
      },
      required: [
        "emotionalArc",
        "transitionSmoothness",
        "performerIdentity",
        "overallScore",
        "iteration",
      ],
    },
  },
  {
    name: "finish_medley",
    description:
      "DEPRECATED — does NOT render an MP3. Returns acknowledged only. Do NOT call this if you want to produce the final audio file. Use finalize_medley instead.",
    parameters: {
      type: "object",
      properties: {
        finalMp3Path: { type: "string" },
        summary: { type: "string" },
      },
      required: ["finalMp3Path", "summary"],
    },
  },
  {
    name: "finalize_medley",
    description:
      "FINAL RENDER STEP — this is the ONLY tool that produces the output MP3. Call after set_design_plan, apply_musical_transition, and report_progress are complete. Uses a single-pass FFmpeg filtergraph with actual transition timings. Do NOT substitute execute_shell_command for this. Do NOT call finish_medley instead (it produces no audio). Any overallScore is acceptable — call this unconditionally after report_progress.",
    parameters: {
      type: "object",
      properties: {
        finalMp3Path: { type: "string" },
        summary: { type: "string" },
        useCleanRender: { type: "boolean" },
      },
      required: ["finalMp3Path", "summary", "useCleanRender"],
    },
  },
] as const;

export function buildManualDesignContext(design: MedleyDesignPayload) {
  return {
    schemaVersion: design.schemaVersion,
    source: design.source,
    userConstraints: design.userConstraints,
    tracks: design.tracks.map((track) => ({
      trackId: track.trackId,
      filename: track.filename,
      durationSec: track.durationSec,
      tempoEstimate: track.tempoEstimate,
      tempoConfidence: track.tempoConfidence,
      keyEstimate: track.keyEstimate ?? null,
      keyConfidence: track.keyConfidence ?? null,
      averageEnergy: track.averageEnergy,
      peakEnergy: track.peakEnergy,
      confidence: track.confidence,
      warnings: track.warnings.slice(0, 4),
    })),
    sections: design.tracks.flatMap((track) =>
      design.sections
        .filter((section) => section.trackId === track.trackId)
        .slice(0, 8)
        .map((section) => ({
          sectionId: section.sectionId,
          trackId: section.trackId,
          startSec: section.startSec,
          endSec: section.endSec,
          labels: section.labels.slice(0, 4),
          confidence: section.confidence,
          warnings: section.warnings.slice(0, 2),
        })),
    ),
    transitionCandidates: design.transitionMatrixSummary
      .slice(0, 16)
      .map((transition) => ({
        fromTrackId: transition.fromTrackId,
        toTrackId: transition.toTrackId,
        fromSectionId: transition.fromSectionId,
        toSectionId: transition.toSectionId,
        fromExitSec: transition.fromExitSec,
        toEntrySec: transition.toEntrySec,
        transitionType: transition.transitionType,
        score: transition.score,
        confidence: transition.confidence,
        reason: transition.reason,
        warnings: transition.warnings.slice(0, 2),
      })),
    recommendedStrategies: design.recommendedStrategies
      .slice(0, 4)
      .map((strategy) => ({
        strategyId: strategy.strategyId,
        title: strategy.title,
        score: strategy.score,
        confidence: strategy.confidence,
        estimatedDurationSec: strategy.estimatedDurationSec,
        orderedTracks: strategy.orderedTracks,
        tradeoffs: strategy.tradeoffs.slice(0, 3),
        warnings: strategy.warnings.slice(0, 3),
      })),
    recommendedGlobalIntros: design.recommendedGlobalIntros
      .slice(0, 6)
      .map((section) => ({
        sectionId: section.sectionId,
        trackId: section.trackId,
        scores: section.scores,
        confidence: section.confidence,
      })),
    recommendedGlobalFinales: design.recommendedGlobalFinales
      .slice(0, 6)
      .map((section) => ({
        sectionId: section.sectionId,
        trackId: section.trackId,
        scores: section.scores,
        confidence: section.confidence,
      })),
    warnings: design.warnings.slice(0, 12),
    aiRules: design.aiRules,
  };
}

export function buildSystemPrompt(
  lib: LibraryFile[],
  config: MedleyConfig,
  medleyDesign?: MedleyDesignPayload | null,
  sessionId?: string,
): string {
  // === Payload Diagnostics (origin/payload-optimization) ===
  if (medleyDesign) {
    diagnosePayload(medleyDesign, "MedleyDesignPayload");
  }

  const styleInstructions: Record<string, string> = {
    "dj-set": `STYLE: DJ Set Mode`,
    "smooth-transitions": `STYLE: Smooth Transitions`,
    mashup: `STYLE: Mashup`,
    acoustic: `STYLE: Acoustic`,
    custom: `STYLE: Custom`,
  };

  const medleyDesignBlock = medleyDesign
    ? `# Medley Design JSON\n${JSON.stringify(buildManualDesignContext(medleyDesign))}`
    : "# Medley Design JSON\nUnavailable.";

  return `You are AI Medley Architect.

${styleInstructions[config.style] || styleInstructions["smooth-transitions"]}

${sessionId ? `Session ID: ${sessionId}\n` : ""}

${medleyDesignBlock}

# SUPPORTED TRANSITION CAPABILITIES
Use only smooth_blend, beat_aligned, energy_ramp, harmonic_blend, dramatic_cut, or reset_moment.
mashup_layer is disabled until preview and final rendering share a canonical simultaneous-layer timeline. Do not select it.

${DETAILED_DESIGN_INSTRUCTIONS}

## Phase 3: FINISH — RENDER THE FINAL MP3
After set_design_plan and apply_musical_transition are complete:
1. Call report_progress once with your quality scores.
2. Call finalize_medley immediately after — this is the ONLY way to produce the output MP3.
   - Pass useCleanRender: true.
   - Any overallScore value is acceptable — do not delay finalization because of a score below a threshold.
3. Do NOT call execute_shell_command for rendering, concatenating, or exporting audio.
4. Do NOT call finish_medley — it does NOT render anything and produces no MP3.

# Library
${lib.map((f) => `${f.id} - ${f.originalName}`).join("\n")}
`;
}

function convertSchema(value: any): any {
  if (!value || typeof value !== "object") return value;

  const t = value.type;
  let gemType: any;

  if (t === "array") gemType = Type.ARRAY;
  else if (t === "object") gemType = Type.OBJECT;
  else if (t === "number" || t === "integer") gemType = Type.NUMBER;
  else if (t === "boolean") gemType = Type.BOOLEAN;
  else gemType = Type.STRING;

  const out: any = { ...value, type: gemType };

  if (value.items) out.items = convertSchema(value.items);
  if (value.properties) {
    out.properties = Object.fromEntries(
      Object.entries(value.properties).map(([k, v]) => [k, convertSchema(v)]),
    );
  }

  return out;
}

export function getToolDeclarations() {
  return getGeminiManualToolDeclarations();
}

export function getOpenRouterTools() {
  return getOpenRouterManualTools();
}
