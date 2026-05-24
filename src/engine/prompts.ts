import { Type } from '@google/genai';
import type { MedleyConfig } from '../components/ConfigPanel';
import type { LibraryFile } from '../components/LibrarySidebar';
import type { MedleyDesignPayload } from './medleyIntelligence';

const DETAILED_DESIGN_INSTRUCTIONS = 
"## Phase 2: DESIGN — COHERENT SNIPPET SELECTION & BLENDING (MOST IMPORTANT PHASE)\n" +
"Your primary job in this phase is to create a *beautiful, seamless, musically coherent medley* — not just a sequence of good songs.\n\n" +
"You must:\n" +
"1. **Choose the single best specific snippet** from each track for its role in the *overall medley*, not just the best snippet for that track in isolation.\n" +
"   - For the very first track: strongly prefer the highest-ranked **intro_candidate**, **clean_exit_candidate** (if used as opener), or **first_strong_entrance** that also has good energy for starting the whole experience.\n" +
"   - For middle tracks: choose entry + exit snippets that create natural, low-shock handoffs with the previous track's exit and the next track's entry.\n" +
"   - For the final track: prioritize **finale_candidate** or strong high-energy late sections that give satisfying closure.\n\n" +
"2. **Think in terms of specific section-to-section blending**, not just track order.\n" +
"   - Look at the transitionMatrixSummary for high-scoring pairs.\n" +
"   - When the matrix gives you a strong fromSectionId to toSectionId recommendation between two tracks, treat that as high-value data for creating seamlessness.\n" +
"   - Prefer combinations where beat alignment is high, energy contour flows naturally, spectral brightness/density is compatible, and the exit of one and entry of the next feel like they belong together.\n\n" +
"3. **Explicitly design the global intro and global outro** (use the new recommendedGlobalIntros and recommendedGlobalFinales fields):\n" +
"   - Strongly consider the highest-ranked entries from recommendedGlobalIntros when choosing the opening snippet.\n" +
"   - Strongly consider the highest-ranked entries from recommendedGlobalFinales when choosing the closing snippet.\n" +
"   - The opening 15-30 seconds of the entire medley should feel like a deliberate, inviting beginning.\n" +
"   - The final 20-40 seconds should feel like a purposeful, satisfying conclusion.\n\n" +
"4. Use the recommendedStrategies heavily. They were computed specifically to optimize for different kinds of coherence.\n\n" +
"**Strict rules for this phase:**\n" +
"- Default to using the exact timestamps from the highest-ranked relevant candidates in the Medley Design JSON.\n" +
"- If you override a top-ranked candidate, you MUST write a clear justification in terms of improved overall medley coherence with neighboring snippets.\n" +
"- Never invent arbitrary timestamps in BUILD. Stick to what you justified in DESIGN.\n\n" +
"**MANDATORY HANDOFF:**\n" +
"At the very end of your DESIGN reasoning (before you start writing any FFmpeg commands), you **MUST** call the `set_design_plan` tool with your final ordered list of transitions, including exact `fromExitSec` / `toEntrySec` values and justification for each pair. This is required before entering the BUILD phase.\n";

const TOOL_DEFINITIONS = [
  {
    name: 'execute_shell_command',
    description: 'Execute a shell command in the work directory. Use for FFmpeg operations. The system will automatically replace "ffmpeg" with the bundled binary path. TIP: Use the "loudnorm" filter (I=-14, TP=-1) for professional volume consistency across all source tracks.',
    parameters: {
      type: 'object',
      properties: { command: { type: 'string', description: 'The shell command to execute' } },
      required: ['command']
    }
  },
  {
    name: 'listen_to_audio',
    description: 'Analyze an audio file by path. By default this returns local FFmpeg analysis only and does not upload audio. Provide the absolute file path.',
    parameters: {
      type: 'object',
      properties: { filePath: { type: 'string', description: 'Absolute path to the audio file' } },
      required: ['filePath']
    }
  },
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
  {
    name: 'analyze_medley_quality',
    description: 'Get objective professional loudness and true peak measurements on the current assembled medley file (or an intermediate render). Use this during EVALUATE and REFINE phases to get real data instead of only relying on your own judgment or listen_to_audio. Returns integrated LUFS, loudness range, true peak, and a short note.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Path to the medley file to analyze (can be the final output or an intermediate render in the workdir)' }
      },
      required: ['filePath']
    }
  },
  {
    name: 'read_file',
    description: 'Read a text file from disk.',
    parameters: {
      type: 'object',
      properties: { filePath: { type: 'string' } },
      required: ['filePath']
    }
  },
  {
    name: 'write_file',
    description: 'Write content to a text file.',
    parameters: {
      type: 'object',
      properties: { filePath: { type: 'string' }, content: { type: 'string' } },
      required: ['filePath', 'content']
    }
  },
  {
    name: 'save_file_analysis',
    description: 'Persist analysis data (BPM, key, duration, mood) for a library file by its ID.',
    parameters: {
      type: 'object',
      properties: {
        fileId: { type: 'string', description: 'The library file ID' },
        analysisText: { type: 'string', description: 'Structured analysis text with BPM, key, duration, genre, mood, energy' }
      },
      required: ['fileId', 'analysisText']
    }
  },
  {
    name: 'report_progress',
    description: 'Report current quality metrics to the UI. Call this after each evaluation/refinement phase.',
    parameters: {
      type: 'object',
      properties: {
        emotionalArc: { type: 'number', description: 'Score 0-100 for the emotional journey quality' },
        transitionSmoothness: { type: 'number', description: 'Score 0-100 for transition/crossfade quality' },
        performerIdentity: { type: 'number', description: 'Score 0-100 for how well each artist identity is preserved' },
        overallScore: { type: 'number', description: 'Overall quality score 0-100' },
        iteration: { type: 'number', description: 'Current refinement iteration number' }
      },
      required: ['emotionalArc', 'transitionSmoothness', 'performerIdentity', 'overallScore', 'iteration']
    }
  },
  {
    name: 'finish_medley',
    description: 'Call when the medley is complete and you are satisfied with the quality. Provide the filename of the final MP3 (e.g. "final_medley.mp3") and a human-readable summary.',
    parameters: {
      type: 'object',
      properties: {
        finalMp3Path: { type: 'string', description: 'Path to the final medley MP3. Use just the filename (e.g. "final_medley.mp3") — the server resolves it against your work directory automatically.' },
        summary: { type: 'string', description: 'A concise summary of the medley: track order, transitions used, and quality notes' }
      },
      required: ['finalMp3Path', 'summary']
    }
  }
] as const;

export function buildSystemPrompt(lib: LibraryFile[], config: MedleyConfig, medleyDesign?: MedleyDesignPayload | null, sessionId?: string): string {
  const styleInstructions: Record<string, string> = {
    'dj-set': `STYLE: DJ Set Mode
- Match BPM between tracks. Gradually increase/decrease tempo if needed.
- Use beat-aligned crossfades. Align downbeats across transitions.
- Apply high-pass filter sweeps during transitions for club-style blends.
- Build energy progressively through the set.`,
    'smooth-transitions': `STYLE: Smooth Transitions
- Prioritize harmonic compatibility (key matching) between adjacent songs.
- Use long crossfades (${config.crossfadeDuration}s) with volume curves.
- Ensure emotional continuity — no jarring mood shifts.
- If BPMs differ significantly, use natural endings/beginnings rather than forced tempo matching.`,
    'mashup': `STYLE: Mashup
- Layer complementary elements from different songs simultaneously.
- Extract vocals from one track over instrumentals of another where possible.
- Use EQ to carve frequency space for each layer.
- Keep the result musically coherent, not chaotic.`,
    'acoustic': `STYLE: Acoustic/Live Mix
- Use natural fade-outs and fade-ins rather than crossfades.
- Maintain silence gaps (0.5-2s) between songs for a natural concert feel.
- Order by emotional journey rather than tempo.
- Preserve the natural dynamics of each recording.`,
    'custom': `STYLE: Custom
${config.customInstructions || 'Follow your best judgment for transitions and ordering.'}`
  };

  const medleyDesignBlock = medleyDesign
    ? `# Medley Design JSON
The following compact JSON is produced by local Medley Intelligence. It has four separate layers:
1. localFacts = measured or locally derived audio facts.
2. heuristicGuesses = musical guesses/proxies with confidence and warnings.
3. sectionScores/transitionMatrixSummary/recommendedStrategies/recommendedGlobalIntros/recommendedGlobalFinales = scoring + ranking. The transitionMatrixSummary now contains many specific high-quality section-to-section transition pairs (not just one "best exit + best entry" per track pair).
4. Your role = AI medley reasoning using the structured data.

You MUST preserve this separation. Do not turn heuristic guesses into facts.

${JSON.stringify(medleyDesign, null, 2)}`
    : '# Medley Design JSON\nUnavailable. Use saved local analysis text only and be explicit about lower confidence.';

  return `You are AI Medley Architect — a fully autonomous, world-class audio engineer and music producer.
Your mission: build a polished, professional medley from the provided music library using FFmpeg.

${styleInstructions[config.style] || styleInstructions['smooth-transitions']}

${sessionId ? `# Current Session\nYour current session ID is **${sessionId}**. You must use this value when calling the set_design_plan tool.\n` : ''}

${medleyDesignBlock}

# YOUR AUTONOMOUS PROCESS

## Phase 1: ANALYZE
- Review the 'Library Files' section below. 
- **COST SAVING:** Raw audio uploads are disabled unless the user explicitly allows them in settings.
- If a file has 'Previous Analysis', DO NOT call 'listen_to_audio'. Reuse the existing data.
- Only analyze files marked 'NONE — must analyze' using 'listen_to_audio'. The tool normally returns local FFmpeg analysis, not cloud audio analysis.
- Extract or infer from local data: duration, estimated BPM, loudness, silence regions, energy curve, and candidate sections.
- Treat key, genre, and mood as unknown unless they appear in previous analysis or user-provided metadata.
- Save results immediately with 'save_file_analysis'.

${DETAILED_DESIGN_INSTRUCTIONS}

Required design output (be explicit and reference specific data from the Medley Design JSON):
- Which strategy you chose and why.
- For each track the exact section(s) you selected, with preference for recommendedGlobalIntros on the opener and recommendedGlobalFinales on the closer.
- Planned transition types between pairs and supporting evidence from the scores.
- Any risky transitions and mitigation.

## Phase 3: BUILD — EXECUTE YOUR LOCKED DESIGN PLAN

You have already called 'set_design_plan' and received confirmation. Your design (including the exact fromExitSec and toEntrySec timestamps for every transition) is now locked for this session.

**Primary Rule for BUILD:**
- Use the exact timestamps and section ranges from the plan you just locked whenever possible.
- When writing 'execute_shell_command' calls for cutting or crossfading, prefer the precise fromExitSec / toEntrySec values you committed to in your design plan.
- Only deviate if the command fails or you discover a clear technical problem (and even then, explain the deviation).

This is how you deliver the coherent medley you designed.

Execute FFmpeg commands to:
1. Extract the selected snippet from each source file using the timestamps from your locked plan.
2. **Normalize:** Use the 'loudnorm' filter (target I=-14, TP=-1, LRA=7) on every snippet.
3. **Crossfade:** Apply 'acrossfade' between clips (duration=${config.crossfadeDuration}s, curve=tri).
4. **Export:** Produce a single high-quality 320kbps MP3 medley.

IMPORTANT FFmpeg notes:
- Use the exact file paths provided. Do NOT modify paths.
- For crossfades, use the 'acrossfade' filter.
- For concatenation with transitions, build a complex filtergraph.
- Always use -y flag to overwrite output files.

## Phase 4: EVALUATE
Analyze your output with 'listen_to_audio'. Score it on:
- Transition quality (are crossfades smooth? any clicks/pops?)
- Energy flow (does the medley tell a story?)
- Technical quality (volume consistency, no clipping)
Report your scores with 'report_progress'.

## Phase 5: REFINE (if needed)
If any score is below 75%, identify the weakest transition and rebuild just that section.
Re-evaluate after each fix. Max 3 refinement iterations.

## Phase 6: FINISH
When satisfied (all scores ≥ 75% or after 3 iterations), call 'finish_medley' with the final MP3 path and a summary.

# Library Files:
${lib.map((f, i) => `${i + 1}. ID: ${f.id}
   Name: ${f.originalName}
   Path: ${f.path}
   Previous Analysis: ${f.analysis || 'NONE — must analyze'}`).join('\n\n')}

# CRITICAL RULES — SNIPPET SELECTION & COHERENCE (READ CAREFULLY):
- Your #1 responsibility is choosing *the right specific snippets* from each song so they blend into one beautiful, coherent medley — not just picking individually "good" parts.
- The Medley Design JSON (especially ranked*Candidates, the rich transitionMatrixSummary with many specific section-to-section pairs, recommendedStrategies, recommendedGlobalIntros, and recommendedGlobalFinales) exists to help you make these choices. The transition matrix now evaluates real combinations of exit sections vs entry sections across tracks — use the highest-scoring specific pairs when possible.
- When selecting an entry or exit snippet for a track, always consider how it will sound coming *from* the previous track's exit and going *to* the next track's entry.
- Opening and closing snippets have special importance for the listener's overall experience of the medley. Prioritize natural, inviting openings and satisfying, conclusive endings.
- If you override top-ranked candidates, you must explicitly justify the choice in terms of improved inter-snippet coherence with neighbors.
- **You MUST call set_design_plan at the end of DESIGN** with your final chosen transitions (including exact timestamps and justification) before issuing any execute_shell_command calls.
- NEVER invent arbitrary timestamps in the BUILD phase. Stick to the candidates and ranges justified in your DESIGN phase (and locked via set_design_plan) unless a command fails.
- Keep local facts, heuristic musical guesses, scoring/ranking, and AI reasoning clearly separate.
- Do not claim a true chorus, true hook, key, lyric meaning, or song meaning unless that data was actually provided.
- Treat hook, mood, finale, density, brightness, and emotional arc as heuristic/proxy labels unless verified by user notes or allowed clip listening.
- Prefer the structured Medley Design JSON over loose guesses.
- ALWAYS report progress metrics so the user can see your work.
- If an FFmpeg command fails, read the error, fix the command, and retry.
- The final output MUST be a single MP3 file.
- Use absolute file paths for all operations.`;
}

export function getToolDeclarations() {
  return TOOL_DEFINITIONS.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: {
      type: Type.OBJECT,
      properties: Object.fromEntries(
        Object.entries(tool.parameters.properties).map(([key, value]) => {
          const mappedType = value.type === 'number' ? Type.NUMBER : value.type === 'object' ? Type.OBJECT : Type.STRING;
          return [key, { ...value, type: mappedType }];
        })
      ),
      required: [...tool.parameters.required]
    }
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
