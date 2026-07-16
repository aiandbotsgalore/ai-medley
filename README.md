# AI Medley Architect

AI Medley Architect analyzes selected local audio, asks OpenRouter to choose among locally measured arrangement options, renders immutable review candidates with FFmpeg, and promotes a human-selected candidate to a verified final MP3. Automatic mode never calls Gemini Direct; Manual Model mode separately supports Gemini and OpenRouter.

## Quick start

Requirements: Windows, Node.js `>=20 <27`, and npm. FFmpeg is bundled by `ffmpeg-static`.

```powershell
npm ci
npm run dev
```

Open `http://localhost:3000`. The server binds to `127.0.0.1` only.

Configure `OPENROUTER_API_KEY` and/or `GEMINI_API_KEY` in the process environment or `.env`, or enter a key for the current browser session. Browser-entered keys are memory-only. Automatic Specialist Team mode requires OpenRouter; Manual Model mode supports Gemini and OpenRouter.

## Automatic workflow

Selected tracks → local analysis/design → constrained OpenRouter arrangement →
deterministic FFmpeg draft → local technical verification → OpenRouter listens
to the rendered mix → distinct/corrected drafts remain playable in Candidate
Review → the user chooses one → verified, journaled final promotion.

AI approval is a recommendation only. Automatic mode never silently substitutes
a local arrangement after provider failure and never creates a final MP3 without
an explicit human approval.

## Production and verification

```powershell
npm test
npm run lint
npm run test:e2e
npm run test:openrouter-free-live
npm run build
npm run test:production-start
npm run start
```

The production build emits bundled ESM at `dist/server.js`. `npm run lint`
performs TypeScript checking. `npm test` is mocked. The two explicitly live
test scripts use only catalog-listed OpenRouter `:free` models, generated
prompts/audio, and isolated temporary data; they never use library or workdir
audio.

## Current contract

Read [Current Operations](docs/current-operations.md) for environment variables, models, workflows, capabilities, persistence/recovery, limits, accessibility, and safe operation. The exact current API registration list is in [API Routes](docs/api-routes.md).

Dated files under `docs/plans/` are retained as historical records and are indexed by [Plan Archive Status](docs/plans/README.md). Audit incident history is indexed by the [Audit Archive](docs/audits/README.md), is preserved as evidence, and is not a current operating contract. The active execution ledger is [task_plan.md](task_plan.md).
