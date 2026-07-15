# Current Operations Contract

This document describes the executable application after the 2026-07 stabilization work. Dated plans and audits remain historical evidence; when they conflict with this document or code, current code and its contract tests are authoritative.

## Supported environment

- Node.js `>=20 <27` on Windows.
- npm uses the committed lockfile. Use `npm ci` for a clean install.
- FFmpeg is supplied by `ffmpeg-static` and validated during server startup.
- The server binds only to `127.0.0.1`; the default `PORT` is `3000`.
- Production is bundled ESM. `npm run build` emits `dist/server.js`, and `npm run start` runs that file.

## Install, run, and verify

```powershell
npm ci
npm run dev

npm test
npm run lint
npm run build
npm run test:production-start

npm run start
```

`npm run lint` is TypeScript checking (`tsc --noEmit`), not ESLint. `npm run clean` is guarded and can remove only this repository's `dist` directory; it must never be pointed at library or workdir data.

## Environment variables

The server reads variables from the process environment and loads git-ignored `.env.local` before `.env`. Do not commit secrets.

| Variable | Behavior |
|---|---|
| `OPENROUTER_API_KEY` | Required server-managed credential for Automatic v4; also available to Manual Model mode. |
| `OPENROUTER_LIVE_TEST_MODEL` | Test-only override used by the isolated end-to-end test. It must end in `:free`; the test discovers a currently listed free OpenRouter model that accepts audio and tool calls, then sends it only a generated test MP3. Never set this for normal app use. |
| `OPENROUTER_LIVE_STRUCTURED_TEST_MODEL` | Optional test-only override for the strict structured-output OpenRouter contract check. It must end in `:free`; normal app runs ignore it. |
| `GEMINI_API_KEY` | Optional server-managed credential for the explicit Manual Gemini mode only. |
| `PORT` | Optional integer from 1–65535; defaults to `3000`. Invalid values fail startup. |
| `AI_MEDLEY_DATA_ROOT` | Optional isolated persistence root. Defaults to the repository working directory. Its `library/` and `workdir/` children hold persistent state and session artifacts. |
| `NODE_ENV` | `production` serves the built SPA and suppresses development stack details; other values use Vite middleware. |

Browser-entered API keys are memory-only unless the user explicitly selects **Save on this computer** for an OpenRouter key. That action writes the credential to the git-ignored server file `.env.local`, switches the browser to the server-managed credential sentinel, and never stores or returns the secret through browser configuration. The browser calls same-origin server provider proxies; server-managed credentials remain server-side. Provider failures are categorized and retries/fallbacks are bounded.

## Workflow and model configuration

New Automatic Specialist Team sessions use workflow version 4. The version is
pinned when the session is created: a v4 session never silently becomes v3,
and a v3 checkpoint is preserved rather than resumed as v4.

- Mode: **Automatic Specialist Team**.
- Provider: OpenRouter through the local server.
- Local audio analysis.
- Style: smooth transitions.
- Target: 10 minutes; crossfade: 5 seconds.
- Manual capability: `contained`.
- Manual OpenRouter and Gemini choices remain independently configurable.

Automatic v4 has a deterministic local brief and deterministic FFmpeg
execution compiler. It makes **no context-brief provider request** and **no
production/tool-execution provider request**. Provider use is limited to a
constrained arrangement decision and an audio-aware candidate review;
corrections may only choose explicitly permitted local presets. Provider
failures are recorded without exposing credentials. A Pro arrangement failure
stops before rendering and offers Retry, Change Model, or Cancel rather than
silently producing a local substitute. An audio-review failure preserves the
rendered candidate and opens Candidate Review.

Automatic OpenRouter tool requests expose exactly one tool and use
`tool_choice: "required"`, followed by strict local schema and authority
validation. If the tool wrapper is rejected or absent, arrangement recovery
uses strict JSON Schema output with Response Healing and
`provider.require_parameters: true`. This recovery is still locally validated
before any plan can be stored or rendered.

The remaining constrained provider decisions use the fixed roster:

| Role | Primary model |
|---|---|
| Arrangement and whole-mix audio review | `google/gemini-3.1-pro-preview` via OpenRouter |
| Targeted transition-clip review after a rejection | `google/gemini-3.5-flash` via OpenRouter |

The whole-mix approval has no silent model fallback. Provider text requests are rejected before network access above 100 KiB or 24,000 estimated tokens, with a 16,000-token regression target. One bounded transport retry handles HTTP 429 or 503 and may honor at most 60 seconds of `Retry-After`.

After local technical checks pass, Automatic v4 sends the rendered candidate MP3—not original library audio—to OpenRouter for a whole-mix review. A rejected candidate may send at most three registered transition previews through OpenRouter to Gemini 3.5 Flash for a focused correction choice. Audio is sent as base64 through OpenRouter's audio-input contract; no temporary Google Files API artifact is created. The original library tracks and all local candidate artifacts remain local and are never removed by this review step.

Automatic v4 renders an initial candidate and, after it passes the local and
whole-mix checks, requests one distinct, constrained arrangement option for
side-by-side human comparison. It never promotes either draft automatically.
Targeted corrections may use only the remaining candidate capacity, up to the
hard limit of three preserved drafts. The server offers exact, versioned
correction presets; the provider can select one offered preset for one named
transition but cannot invent timestamps, change several transitions, or repeat
an identical plan. Every earlier candidate remains registered and visible.

## Candidate Review and completion truth

Candidate Review is the user-facing destination whenever a rendered draft
needs a decision, an automatic correction cannot proceed, or final promotion
was interrupted. It is also restored automatically on startup. The screen:

- shows every registered draft, its local path, size, duration, technical
  status, OpenRouter review evidence, transition concerns, and deterministic
  changes from its parent;
- provides one shared range-capable audio player for A/B switching so drafts
  cannot play over each other;
- keeps invalid or tampered drafts visible while disabling playback or final
  approval when integrity cannot be verified;
- labels AI approval as a recommendation only and requires an append-only human
  approval before a technically valid draft can be promoted; and
- resumes an interrupted finalization without rerendering or duplicating the
  approval.

The UI reports **Final MP3 created successfully** only when the finalization
journal is complete, the promoted bytes match the selected registered
candidate, FFmpeg can decode the final audio, history and wisdom were projected,
and authoritative session state is `completed`. A verified final exposes
playback, download, its local path, and finalization time. Refresh or server
restart restores the same candidates and verified final. A rendered candidate
alone is never reported as completion.

Manual Model mode supports the Gemini and OpenRouter models listed in `src/components/ConfigPanel.tsx`, plus a custom OpenRouter model ID. Saved provider/model pairs are validated and visibly migrated to a compatible default when necessary.

## Capabilities and local security

- Requests require a local Host and local same-origin policy; cross-site mutations are rejected.
- Default manual capability `contained` limits file operations to the current session and shell access to bounded read-only diagnostics.
- `expert` capability intentionally permits arbitrary shell commands with the Windows account's permissions and must be enabled explicitly.
- Paths are canonicalized and symlink/junction escape is rejected for protected operations.
- Provider credentials, authorization headers, signed URLs, and secret-like values are redacted from logs, SSE, checkpoints, and tool results.
- Manual tool contracts are strict and versioned. Legacy artifacts are adapted only when they can be safely bound; otherwise the UI requires restart/discard.

## Data, recovery, and retention

Persistent source audio, library records, history, wisdom, checkpoints, candidates, manifests, and completed outputs are user data. The application does not run automatic cleanup over these classes.

- Core JSON stores fail closed on corrupt reads and use atomic writes plus last-known-good backups.
- Source upload stages, probes, hashes, capacity-checks, and atomically
  registers media; cross-volume moves use copy-then-publish. Deletion is a
  pending/quarantine transaction rather than immediate erasure.
- Automatic checkpoints are source/design/config bound. Changed or legacy-unbound state requires an explicit user decision.
- Candidate manifests retain append-only technical, musical, human, and
  correction evidence. Resource limits enter manual review without deleting
  older candidates. Candidate playback requires a manifest registration plus
  canonical path, size, and SHA-256 integrity. Final promotion revalidates the
  same identity, verifies full-audio FFmpeg decoding, and follows a recoverable
  finalization journal.
- Automatic state is revisioned and idempotent. Cancellation is durable,
  session-wide, and leaves protected completed artifacts intact; startup
  reconciliation only classifies interrupted boundaries and never deletes data.
- SSE publishes named, sequenced, replayable events and an authoritative snapshot.
- `/api/storage/inventory` is inventory-only: all entries are `preserve`, and deletion candidates are always zero.

Current declared envelopes include 25 tracks per project, 24 hours aggregate source duration, 30 minutes per full-memory analysis, 500 session log entries, 50 uploads per request, 500 MiB per uploaded file, and a 1 GiB free-space reserve after incoming bytes.

## Browser accessibility

Core upload, configuration, history, reorder, progress, error, recovery, and
Candidate Review workflows expose semantic controls, keyboard operation, focus
management, live states, reduced-motion behavior, and minimum 44px interaction
targets. Candidate cards have accessible draft names and their playback and
finalization actions are native buttons. Phase 10 verification used mocked
local APIs only and covered axe WCAG A/AA, Lighthouse, narrow/zoom-equivalent
layouts, refresh, and two-tab isolation; the Candidate Review release gate also
uses an isolated two-draft browser fixture.

## API contract

The complete executable Express registration list is maintained in [api-routes.md](api-routes.md) and checked against `server.ts` by `scripts/release-contract.mjs`.

## Historical material

See [plans/README.md](plans/README.md) for the status of dated plans. Stabilization evidence and known residual risks are recorded under `docs/audits/`; these files must not be rewritten to hide earlier incidents.
