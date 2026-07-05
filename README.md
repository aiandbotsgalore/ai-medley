# AI Medley Architect

AI Medley Architect analyzes local audio, creates a bounded medley plan with Gemini or OpenRouter models, renders immutable review candidates with FFmpeg, and promotes an approved candidate to the final MP3.

## Quick start

Requirements: Windows, Node.js `>=20 <27`, and npm. FFmpeg is bundled by `ffmpeg-static`.

```powershell
npm ci
npm run dev
```

Open `http://localhost:3000`. The server binds to `127.0.0.1` only.

Configure `OPENROUTER_API_KEY` and/or `GEMINI_API_KEY` in the process environment or `.env`, or enter a key for the current browser session. Browser-entered keys are memory-only. Automatic Specialist Team mode requires OpenRouter; Manual Model mode supports Gemini and OpenRouter.

## Production and verification

```powershell
npm test
npm run lint
npm run build
npm run test:production-start
npm run start
```

The production build emits bundled ESM at `dist/server.js`. `npm run lint` performs TypeScript checking.

## Current contract

Read [Current Operations](docs/current-operations.md) for environment variables, models, workflows, capabilities, persistence/recovery, limits, accessibility, and safe operation. The exact current API registration list is in [API Routes](docs/api-routes.md).

Dated files under `docs/plans/` are retained as historical records and are indexed by [Plan Archive Status](docs/plans/README.md). Audit incident history under `docs/audits/` is preserved.
