# CLAUDE.md

AI Medley Architect is a local React/Express medley builder with deterministic
FFmpeg rendering, atomic persistence, immutable candidates, OpenRouter-only
Automatic mode, and separate Gemini/OpenRouter Manual Model support.

Use `docs/current-operations.md` as the authoritative runtime contract and `docs/api-routes.md` as the checked Express route inventory. Files under `docs/plans/` are historical records.

## Commands

```powershell
npm ci
npm run dev
npm test
npm run lint
npm run test:e2e
npm run test:openrouter-free-live
npm run build
npm run test:production-start
npm run start
```

Supported Node is `>=20 <27`. Production runs bundled ESM `dist/server.js` on `127.0.0.1` (default port 3000).

## Current behavior

- Automatic Specialist Team v4 uses OpenRouter as its only cloud-provider route.
  Gemini 3.1 Pro through OpenRouter performs constrained arrangement selection
  and whole-mix audio review; Gemini 3.5 Flash through OpenRouter may review up
  to three registered transition clips after rejection. Automatic mode never
  calls Gemini Direct. It makes no context-brief or production/tool-execution
  provider request; local TypeScript and FFmpeg own execution.
- Provider tool decisions expose one tool with `tool_choice: "required"` and
  strict local validation. Arrangement recovery may use strict JSON Schema plus
  Response Healing. Transport retries are bounded to one 429/503 retry.
- Every registered draft remains playable in Candidate Review. AI approval is
  only a recommendation; a human must choose a technically valid draft before
  verified, journaled final promotion.
- Manual Model: Gemini or OpenRouter with strict versioned tool contracts.
- Audio analysis is local by default and server-authoritative.
- Provider payloads fail before network access when over shared limits; retries are bounded and recorded.
- `npm test` uses mocked providers. The two explicitly live scripts reject
  non-`:free` model IDs and use only synthetic prompts/audio in isolated
  temporary data roots.
- Candidate approval/finalization is append-only, integrity checked, human-gated,
  idempotent, and journaled.
- Default manual capability is `contained`; `expert` shell access is explicit and dangerous.

## Protected data

Never mutate or clean real source audio, library/history/wisdom, checkpoints, candidates/manifests, completed outputs, environment files, or pre-existing workdir artifacts during verification. Preserve the documented `provider-payload-audit.json` incident. Use isolated roots, fake data, and mocked provider responses.

If `npm run build` changes `dist`, restore the original `dist` exactly unless generated artifacts were explicitly requested.
