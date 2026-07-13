# CLAUDE.md

AI Medley Architect is a local React/Express medley builder with deterministic FFmpeg rendering, atomic persistence, immutable candidates, and Gemini/OpenRouter provider support.

Use `docs/current-operations.md` as the authoritative runtime contract and `docs/api-routes.md` as the checked Express route inventory. Files under `docs/plans/` are historical records.

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

Supported Node is `>=20 <27`. Production runs bundled ESM `dist/server.js` on `127.0.0.1` (default port 3000).

## Current behavior

- Automatic Specialist Team v4: deterministic local brief and transition
  execution, with bounded OpenRouter arrangement and musical-review decisions
  only. It makes no context-brief or production/tool-execution provider call;
  v3 checkpoints remain isolated rather than silently migrating.
- Manual Model: Gemini or OpenRouter with strict versioned tool contracts.
- Audio analysis is local by default and server-authoritative.
- Provider payloads fail before network access when over shared limits; retries are bounded and recorded.
- Candidate approval/finalization is integrity checked and journaled.
- Default manual capability is `contained`; `expert` shell access is explicit and dangerous.

## Protected data

Never mutate or clean real source audio, library/history/wisdom, checkpoints, candidates/manifests, completed outputs, environment files, or pre-existing workdir artifacts during verification. Preserve the documented `provider-payload-audit.json` incident. Use isolated roots, fake data, and mocked provider responses.

If `npm run build` changes `dist`, restore the original `dist` exactly unless generated artifacts were explicitly requested.
