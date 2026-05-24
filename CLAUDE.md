# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

AI Medley Architect — a web app that uses the Gemini API to autonomously build audio medleys from uploaded tracks. The AI agent analyzes audio, designs an optimal track order, then issues FFmpeg commands to splice and crossfade clips into a final MP3. Originally generated in Google AI Studio.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start dev server (Express + Vite HMR) on port 3000
npm run build        # Build for production (Vite → dist/, esbuild server.ts → dist/server.cjs)
npm run start        # Run production build
npm run lint         # TypeScript type-check only (tsc --noEmit), no ESLint configured
```

Create `.env.local` (or `.env`) with:
```
GEMINI_API_KEY=your_key_here
```

## Architecture

**Single-server hybrid**: `server.ts` runs Express for the API layer and embeds Vite as middleware in dev mode (middleware mode SPA). In production, Express serves the built `dist/` folder. Both share port 3000.

**Frontend** (`src/`): React 19 SPA with Tailwind v4 (via `@tailwindcss/vite`). No router — single-page. State lives entirely in `App.tsx`.

**The AI loop** (`src/App.tsx:108` — `runAutonomousLoop`): The core logic. Creates a Gemini chat session with function calling enabled, then drives it through up to 50 iterations. The model calls tools, the browser executes them via `/api/*` endpoints, and results are fed back. Tools available to the model:
- `execute_shell_command` — runs FFmpeg in `workdir/<sessionId>/`
- `listen_to_audio` — uploads audio to Gemini Files API (with 48h URI caching in `library/db.json`)
- `read_file` / `write_file` — filesystem access for scripts/intermediates
- `save_file_analysis` — persists BPM/key/mood analysis back to `library/db.json`
- `report_progress` — updates quality metrics in the UI
- `finish_medley` — ends the session with the final MP3 path

**System prompt** (`src/engine/prompts.ts`): `buildSystemPrompt()` constructs the six-phase instruction set (Analyze → Design → Build → Evaluate → Refine → Finish) with style presets injected from `MedleyConfig`. `getToolDeclarations()` exports the Gemini function schema.

**Persistence** (`library/`):
- `db.json` — audio file metadata + cached Gemini File URIs + per-file analysis text
- `history.json` — last 50 completed session summaries
- `audio/` — uploaded audio files stored with UUID filenames

**Streaming** (`/api/session/:id/stream`): SSE endpoint; server pushes `log`, `metrics`, `completed` events to the frontend during generation.

**Session workdir**: Each run gets a temp folder at `workdir/<sessionId>/` where FFmpeg intermediate files land.

## Key Constraints

- FFmpeg is bundled via `ffmpeg-static`; `server.ts` auto-replaces `ffmpeg` in shell commands with the actual binary path.
- The `/api/exec` endpoint executes arbitrary shell commands in the session workdir — this is intentional (it's how the AI issues FFmpeg operations), not a bug.
- Audio uploads to Gemini Files API expire after 48 hours; the app caches `geminiFileUri` + expiry timestamp in `db.json` to avoid re-uploading on subsequent runs.
- `MedleyConfig.model` defaults to `gemini-2.5-flash`; `gemini-2.5-pro` is the alternative — change in ConfigPanel UI or `DEFAULT_CONFIG` in `src/components/ConfigPanel.tsx:19`.
