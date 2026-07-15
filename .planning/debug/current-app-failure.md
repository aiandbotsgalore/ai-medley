# Current App Failure — Diagnostic Session

> Historical incident record. This file preserves the evidence from the July 13, 2026 diagnosis and is not an active workflow specification. Current operating rules live in `AGENTS.md` and `docs/current-operations.md`.

## Current workflow update — July 15, 2026

- The original diagnosis below remains valid: editing Vite-watched source during a browser-owned development run can reload the page and interrupt that in-flight run.
- Automatic cloud decisions now route through OpenRouter only; Gemini Direct is not part of Automatic mode.
- Arrangement output is strictly schema-validated and rebound to locally authoritative transition candidates before rendering.
- Rendering and production are deterministic local operations. OpenRouter never writes FFmpeg commands or source timestamps.
- Successfully registered drafts are restored into Candidate Review after refresh or restart.
- AI review cannot finalize a draft. The session enters `manual_review_required`, Candidate Review shows the preserved drafts, and a human must approve one before final promotion.
- The isolated end-to-end acceptance test now covers synthetic upload, local analysis, candidate rendering, live free-model audio review, correction, two preserved candidates, refreshed authoritative state, human approval, verified promotion, and restart projection.
- Operator guidance remains unchanged: do not modify watched source files while evaluating a live development run. Use a stable server process for meaningful listening tests.

## Status

HISTORICAL / RESOLVED DIAGNOSIS — root cause confirmed. The development hot-reload hazard remains an operator constraint; current recovery and Candidate Review behavior is documented above.

## Symptoms

- Expected: Resuming automatic session `xok0d0ee` proceeds through production, candidate render, quality review, and finalization.
- Actual: UI returns to an Interrupted Session at correction 3/3.
- Browser showed System Ready, FFmpeg READY, and OpenRouter READY.
- The stale 03:10 candidate error was already fixed, but corrected transition previews existed without a newer candidate or checkpoint advancement.

## Constraints

- Preserve `library/`, `workdir/`, existing incident artifacts, source audio, and unrelated working-tree changes.
- Only this diagnostic note may be updated.
- Do not fix during this investigation.

## Root cause

The automatic workflow is browser-owned. While it was running in Vite development mode, concurrent repository edits caused Vite to issue a full-page reload. The reload destroyed the page context and aborted the in-flight OpenRouter continuation request after both FFmpeg transition previews had succeeded. Because the production specialist had not yet returned and posted its `executionReport`, the last durable checkpoint remained at `stage=correction`, `activeRole=production`, `correctionCount=3`. The newly loaded page then correctly redisplayed that still-present checkpoint as an Interrupted Session.

This is a development hot/full-reload interruption, not a repeat of the invalid-trim defect and not a current FFmpeg, provider-readiness, render-candidate, or checkpoint-write failure.

## Evidence timeline

### Most recent live Chrome/CDP reproduction

- Resume was invoked at approximately 03:44:12 local.
- The production fallback sequence behaved normally: Gemini Flash returned no tool calls, then Gemini Pro returned HTTP 200.
- Both `/api/apply-transition` calls returned HTTP 200; the two `transition-exec-008` previews were produced/overwritten successfully.
- Chrome then showed a new full Document `GET /` (network sequence 112), followed by a fresh `src/main.tsx?t=1783939464961` load. The timestamp query corresponds to approximately 03:44:24.961 local.
- The trigger coincides exactly with source writes observed on disk:
  - `src/server/libraryPersistence.ts` — 03:44:24.9368559
  - `src/server/libraryPersistence.test.ts` — 03:44:24.9503629
  - `server.ts` — 03:44:24.9588756
- Those files were subsequently included in commit `bd44926` at 03:44:57 (`feat: retain deleted library audio in quarantine`), confirming concurrent implementation work was touching the dev server while the app run was active.
- At reload time, the next `/api/provider/openrouter` continuation was still in flight. No execution report, review-candidate request, or candidate render followed.

### Prior 03:39 interruption

- Checkpoint `library/checkpoints/xok0d0ee.json` was durably saved at `2026-07-13T10:39:09.453Z` after the invalid resumed arrangement was replaced by the valid section-04 fallback.
- The two corrected `transition-exec-008` previews completed at 03:39:23 and 03:39:32.
- Concurrent source writes began immediately afterward:
  - `src/server/automaticSessionState.ts` — 03:39:45.5715768
  - `src/server/automaticSessionState.test.ts` — 03:39:45.5745849
  - further source edits at 03:40:08 and 03:40:50
- Commit `af22a05` at 03:42:45 (`feat: persist automatic session idempotency`) contains that concurrent work. This independently matches the same reload mechanism as the live reproduction.

## Code-path explanation

- `runProductionRole()` writes transition previews through `/api/apply-transition`, then waits for a provider continuation and eventually `/api/session/execution-report` (`src/engine/specialistOrchestrator.ts`, production loop around lines 500–613).
- The orchestrator only advances the checkpoint to `review_candidate` after `runProductionRole()` returns a valid report (around lines 918–941).
- Therefore, preview MP3s can legitimately exist while the checkpoint still contains the preceding execution report and production/correction stage.
- A full browser navigation destroys the JavaScript workflow and its fetch/AbortSignal. The fresh app instance reloads `/api/checkpoints`, so the durable pre-report checkpoint appears as Interrupted.
- The server process itself did not restart during the reproduced run: the listener on port 3000 was the same Node process started at 03:37:48, and `/api/session/xok0d0ee` remained `status: "running"`. This rules out server restart as the immediate interruption mechanism.

## Competing hypotheses eliminated

- **Old invalid trim / candidate 500:** stale. `candidate-001-error.json` is from 03:10:19. The corrected section-04 arrangement generated successful previews and no newer candidate error was written.
- **FFmpeg failure:** ruled out by both `/api/apply-transition` HTTP 200 responses and the new preview MP3s.
- **OpenRouter outage/readiness failure:** ruled out as the immediate stop; system readiness was green and Gemini Pro returned HTTP 200. The interrupted request was in flight when navigation occurred.
- **Checkpoint persistence failure:** ruled out. The corrected arrangement checkpoint was written successfully; no `Checkpoint persistence failure` surfaced. Advancement could not occur because the browser vanished before a report existed.
- **Browser refresh by the user:** the network reload is timestamp-correlated to Vite-watched source writes, including a cache-busted module request. This is development-server reload behavior.
- **Frontend orchestration logic independently stopping at correction 3/3:** not supported. The run was actively applying corrected transitions and waiting for the next provider response when the page reloaded.
- **Provider payload audit incident:** `workdir/provider-payload-audit.json` was generated 2026-07-04 and contains no `xok0d0ee` record; it is unrelated and was preserved unchanged.

## Safest confirmation/reproduction plan

1. Stop all concurrent code-editing/commit activity and ensure no watched source file will change.
2. Keep the current dev server and Chrome tab stable; enable DevTools Preserve log for Network and Console.
3. Click Resume exactly once and do not reload, navigate, or edit repository files.
4. Observe the expected sequence: provider continuation -> `/api/session/execution-report` -> checkpoint `review_candidate` -> `/api/render-review-candidate` -> quality review.
5. If a failure occurs without a Document `GET /`, capture the failed request response and `window.__providerRequestAudits` before any reload. That would be a distinct secondary defect.

For an operator-safe run during active development, use a stable production build/server or pause all Vite-watched edits for the duration. Do not click Resume while another agent is modifying this checkout.

## Conclusion

The exact stop is explained by a Vite-triggered full reload caused by concurrent source edits. The workflow itself had passed the prior invalid-arrangement point and was still healthy immediately before navigation. No application fix was made in this diagnosis-only task.
