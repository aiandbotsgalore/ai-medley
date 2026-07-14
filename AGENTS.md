# AGENTS.md

This repository contains AI Medley Architect, a local-only React/Express application that analyzes source audio, plans medleys with Gemini or OpenRouter, renders candidates with bundled FFmpeg, and transactionally promotes an approved final.

The authoritative runtime and operator contract is `docs/current-operations.md`. The exact API list is `docs/api-routes.md`. Dated plans are historical and must not override current code/tests.

## Commands

```powershell
npm ci
npm run dev
npm test
npm run lint
npm run build
npm run test:production-start
npm run start
```

Node support is `>=20 <27`. Production is bundled ESM at `dist/server.js`; the server binds to `127.0.0.1` and defaults to port 3000.

## Architecture

- `server.ts`: Express API, local access controls, persistence, FFmpeg orchestration, candidate/finalization transactions, SSE, and production static serving.
- `src/App.tsx`: React SPA and Manual Model orchestration.
- `src/engine/specialistOrchestrator.ts`: workflow-v4 Automatic Specialist Team
  orchestration: deterministic brief/execution, constrained direct-Gemini
  arrangement, and server-only audio review of rendered candidates.
- `src/engine/providers.ts` and `providerRequest.ts`: server-proxied providers, bounded requests, retries, and typed failures.
- `src/server/`: atomic stores, path/upload/resource policy, analysis authority, candidate integrity, event journal, and finalization journal.
- `library/`: protected source metadata/audio/history/wisdom.
- `workdir/`: protected session checkpoints, candidates, manifests, diagnostics, and completed outputs.

## Safety constraints

- Do not run cleanup over `library/` or `workdir/`; inventory is preserve-only.
- Unit and end-to-end tests use mocked provider responses. `npm run test:full` adds one explicit live OpenRouter contract request to a currently listed `:free` model only; it uses synthetic text and an isolated data root.
- Preserve source audio, history, wisdom, checkpoints, candidates, manifests, finals, environment files, and the documented `provider-payload-audit.json` incident.
- `contained` is the default manual capability. `expert` intentionally grants arbitrary shell access and must remain explicit.
- If a build changes `dist`, restore the pre-existing `dist` exactly unless the user explicitly requests generated artifacts.

Automatic Specialist Team v4 pins its workflow version per session. It makes
no context-brief or production/tool-execution provider request. It routes all
AI requests through OpenRouter: Gemini 3.1 Pro for arrangement and whole-mix
candidate review, and Gemini 3.5 Flash only for targeted registered
transition-preview review after rejection. The server uploads no source tracks;
it sends only registered rendered artifacts through OpenRouter audio input.
Manual Model mode supports Gemini and OpenRouter, including custom OpenRouter
model IDs. Server-managed credentials come from `OPENROUTER_API_KEY` and
`GEMINI_API_KEY`; browser-entered keys are memory-only.
