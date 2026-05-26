import { Type } from '@google/genai';
import type { MedleyConfig } from '../components/ConfigPanel';
import type { LibraryFile } from '../components/LibrarySidebar';
import type { MedleyDesignPayload } from './medleyIntelligence';

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
    name: 'execute_shell_command',
    description: 'Execute a shell command in the work directory. Use for FFmpeg operations.',
    parameters: {
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command']
    }
  },
  {
    name: 'listen_to_audio',
    description: 'Analyze an audio file by path.',
    parameters: {
      type: 'object',
      properties: { filePath: { type: 'string' } },
      required: ['filePath']
    }
  },
  {
    name: 'evaluate_section_pair',
    description: 'Evaluate compatibility between two sections.',
    parameters: {
      type: 'object',
      properties: {
        fromTrackId: { type: 'string' },
        fromSectionId: { type: 'string' },
        toTrackId: { type: 'string' },
        toSectionId: { type: 'string' }
      },
      required: ['fromTrackId', 'fromSectionId', 'toTrackId', 'toSectionId']
    }
  },
  {
    name: 'set_design_plan',
    description: 'Lock DESIGN decisions.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        transitions: { type: 'array' }
      },
      required: ['sessionId', 'transitions']
    }
  },
  {
    name: 'apply_musical_transition',
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
      "- 'mashup_layer': Creative simultaneous overlapping/layering (e.g. vocals over a different instrumental bed, complementary hooks, or textural layering). Use this when two sections have elements that would sound exciting playing at the same time rather than a clean handoff. Prefer this for final design when it creates interesting musical tension or richness.",
    parameters: {
      type: 'object',
      properties: {
        fromTrackId: { type: 'string' },
        fromSectionId: { type: 'string' },
        toTrackId: { type: 'string' },
        toSectionId: { type: 'string' },
        style: { type: 'string' },
        duration: { type: 'number' },
        intensity: { type: 'number' },
        beatAlign: { type: 'boolean' },
        notes: { type: 'string' }
      },
      required: ['fromTrackId', 'fromSectionId', 'toTrackId', 'toSectionId', 'style']
    }
  },
  {
    name: 'analyze_medley_quality',
    description: 'Analyze loudness/true peak.',
    parameters: {
      type: 'object',
      properties: { filePath: { type: 'string' } },
      required: ['filePath']
    }
  },
  {
    name: 'read_file',
    description: 'Read file',
    parameters: {
      type: 'object',
      properties: { filePath: { type: 'string' } },
      required: ['filePath']
    }
  },
  {
    name: 'write_file',
    description: 'Write file',
    parameters: {
      type: 'object',
      properties: { filePath: { type: 'string' }, content: { type: 'string' } },
      required: ['filePath', 'content']
    }
  },
  {
    name: 'save_file_analysis',
    description: 'Save analysis data',
    parameters: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        analysisText: { type: 'string' }
      },
      required: ['fileId', 'analysisText']
    }
  },
  {
    name: 'report_progress',
    description: 'Report progress',
    parameters: {
      type: 'object',
      properties: {
        emotionalArc: { type: 'number' },
        transitionSmoothness: { type: 'number' },
        performerIdentity: { type: 'number' },
        overallScore: { type: 'number' },
        iteration: { type: 'number' },
        phase: { type: 'string' }
      },
      required: ['emotionalArc', 'transitionSmoothness', 'performerIdentity', 'overallScore', 'iteration']
    }
  },
  {
    name: 'finish_medley',
    description: 'Finish medley',
    parameters: {
      type: 'object',
      properties: {
        finalMp3Path: { type: 'string' },
        summary: { type: 'string' }
      },
      required: ['finalMp3Path', 'summary']
    }
  },
  {
    name: 'finalize_medley',
    description:
      "FINAL RENDER STEP. Uses a single-pass FFmpeg filtergraph (no concat). Uses actual transition timings and produces a clean output.",
    parameters: {
      type: 'object',
      properties: {
        finalMp3Path: { type: 'string' },
        summary: { type: 'string' },
        useCleanRender: { type: 'boolean' }
      },
      required: ['finalMp3Path', 'summary', 'useCleanRender']
    }
  }
] as const;

export function buildSystemPrompt(
  lib: LibraryFile[],
  config: MedleyConfig,
  medleyDesign?: MedleyDesignPayload | null,
  sessionId?: string
): string {
  const styleInstructions: Record<string, string> = {
    'dj-set': `STYLE: DJ Set Mode`,
    'smooth-transitions': `STYLE: Smooth Transitions`,
    'mashup': `STYLE: Mashup`,
    'acoustic': `STYLE: Acoustic`,
    'custom': `STYLE: Custom`
  };

  const medleyDesignBlock = medleyDesign
    ? `# Medley Design JSON\n${JSON.stringify(medleyDesign, null, 2)}`
    : '# Medley Design JSON\nUnavailable.';

  return `You are AI Medley Architect.

${styleInstructions[config.style] || styleInstructions['smooth-transitions']}

${sessionId ? `Session ID: ${sessionId}\n` : ''}

${medleyDesignBlock}

# FINAL DESIGN GUIDANCE — USE MASHUP_LAYER WHEN APPROPRIATE
When locking your final design via set_design_plan and choosing styles for apply_musical_transition:
- Use 'mashup_layer' (not just for previews, but in the authoritative plan) whenever two sections have complementary musical elements that would create interesting texture, tension, or richness if played simultaneously rather than a clean sequential handoff.
  Good contexts for mashup_layer in the final medley:
  - Vocals or lead melody from one track layered over a strong rhythmic/instrumental bed from another.
  - Two hooks or melodic phrases that interlock harmonically or rhythmically.
  - Sections with similar energy but different timbres that benefit from overlapping instead of crossfading.
- Only use it when it serves the overall emotional arc and does not create mud. When in doubt between 'smooth_blend' and 'mashup_layer', prefer the one that makes the medley more memorable and exciting.
- The finalize_medley renderer now fully supports true simultaneous branching/layering for 'mashup_layer' transitions using the enriched timings.

${DETAILED_DESIGN_INSTRUCTIONS}

# Library
${lib.map(f => `${f.id} - ${f.originalName}`).join('\n')}
`;
}

function convertSchema(value: any): any {
  if (!value || typeof value !== 'object') return value;

  const t = value.type;
  let gemType: any;

  if (t === 'array') gemType = Type.ARRAY;
  else if (t === 'object') gemType = Type.OBJECT;
  else if (t === 'number' || t === 'integer') gemType = Type.NUMBER;
  else if (t === 'boolean') gemType = Type.BOOLEAN;
  else gemType = Type.STRING;

  const out: any = { ...value, type: gemType };

  if (value.items) out.items = convertSchema(value.items);
  if (value.properties) {
    out.properties = Object.fromEntries(
      Object.entries(value.properties).map(([k, v]) => [k, convertSchema(v)])
    );
  }

  return out;
}

export function getToolDeclarations() {
  return TOOL_DEFINITIONS.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: convertSchema(tool.parameters)
  }));
}

export function getOpenRouterTools() {
  return TOOL_DEFINITIONS.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));
}