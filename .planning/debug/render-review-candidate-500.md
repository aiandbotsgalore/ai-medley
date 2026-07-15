# Debug: render-review-candidate 500

> Historical incident record. The evidence below is preserved as written. Current workflow rules live in `AGENTS.md` and `docs/current-operations.md`.

## Current verification update — July 15, 2026

- The adjacent-transition validation fix described below remains active and covered by regression tests.
- Automatic arrangements are now strictly validated against authoritative local transition candidates before FFmpeg can run.
- A rendered MP3 that survives FFmpeg but encounters later registration trouble is preserved for manifest recovery rather than blindly rerendered.
- Every successfully registered candidate remains immutable, playable, and visible in Candidate Review.
- Final promotion now requires explicit human approval and verified candidate/final integrity.
- The complete offline suite and isolated end-to-end workflow passed after the current OpenRouter contract and human-review state fixes. The acceptance flow produced two candidates, refreshed authoritative state, recorded human approval, promoted the chosen file, verified matching hashes, and restored the finalized projection.
- Live provider acceptance used only catalog-listed free OpenRouter models and generated synthetic audio; it did not read or mutate the historical session or any user source audio.

## Status

Resolved in the working tree. Root cause confirmed before implementation.

## Symptoms

- Session: `xok0d0ee`
- Failure time: `2026-07-13T10:10:19.764Z`
- Endpoint: `POST /api/render-review-candidate`
- Result: HTTP 500 after three automatic correction cycles
- Render marker: `pure-clean-mvp-failed`

## Evidence

1. `workdir/xok0d0ee/candidate-001-error.json` records the server failure at `server.ts:3574`:
   `INVALID TRIM on seg_1 (track 6844...): start=87.8 >= end=84.4`.
2. `library/checkpoints/xok0d0ee.json` preserves the exact locked plan and execution report:
   - transition 1 enters middle track `6844...` at `toEntrySec=87.8`;
   - transition 2 exits the same track at `fromExitSec=84.4`;
   - all seven production executions preserve those authoritative values.
3. A read-only reconstruction from `library/db.json`, `library/wisdom.json`, and the current design/fallback functions reproduces the exact two transition candidate IDs stored in the checkpoint.
4. `validateArrangementContext()` returns no errors for that reproduced plan. It validates each transition independently but never validates the segment between adjacent transitions.
5. `estimateArrangementDurationSec()` adds `next.fromExitSec - current.toEntrySec`; here it adds `84.4 - 87.8 = -3.4s`. That invalid negative segment makes the overall estimate about 235.3s, deceptively close to the 240s target, so `buildDeterministicArrangementFallback()` ranks it first.
6. The render endpoint derives `seg_1` with the same start/end and correctly hard-fails before FFmpeg. No filtergraph, command, or stderr files exist because FFmpeg was never started.
7. Render correction cycles call `runProductionRole()` against the same locked `arrangementPlan`. Production cannot change authoritative transition timestamps, so retries produced execution versions 5, 6, and 7 with the same impossible segment.

## Root Cause

The shared arrangement validator lacks cross-transition timeline validation. It permits an intermediate track's exit timestamp to precede its entry timestamp and does not verify that the intermediate segment is long enough for both adjacent crossfades. The fallback ranker then rewards the resulting negative duration, and render-only validation detects the issue too late for production correction to repair it.

## Fix Direction

- Add render-aligned adjacent-transition validation in `validateArrangementContext()`.
- For each intermediate segment, require
  `next.fromExitSec - current.toEntrySec >= max(current.duration, next.duration)`.
  Equality is valid because the renderer rejects only crossfades strictly greater than available audio.
- Add focused validator and deterministic-fallback regression tests showing that the invalid target-matching variant is rejected and a valid variant is selected.
- Verify typecheck/tests/build as appropriate; preserve and restore pre-existing `dist` if a build modifies it.

## Changes

- `src/types/specialistWorkflow.ts`
  - `validateArrangementContext()` now checks every intermediate rendered segment.
  - Available audio is `next.fromExitSec - current.toEntrySec`.
  - Required audio is `max(current.duration, next.duration)` because that segment participates in both adjacent crossfades.
  - The comparison intentionally permits equality, matching the render endpoint's `crossfade > available` rejection rule.
- `src/types/specialistWorkflow.test.ts`
  - Added a regression proving an intermediate segment with `-2s` available audio is rejected before production/render.
- `src/engine/specialistOrchestrator.checkpoint.test.ts`
  - Added a three-track fallback regression in which the invalid candidate is closest to target duration but must be filtered in favor of the renderable candidate.

## Verification

- Focused validator test: passed.
- Focused specialist orchestrator checkpoint/fallback test: passed.
- `npm run lint`: passed (`tsc --noEmit`).
- `npm test`: passed, including all specialist, server, persistence, safety, provider-payload, and release-contract tests.
- Read-only reconstruction of session `xok0d0ee` after the fix:
  - saved checkpoint is rejected with `-3.400s available ... requires at least 4.000s`;
  - fallback selects candidate IDs `transition-candidate-v1-457399e87d82c3f8` and `transition-candidate-v1-4c85598ed706aa3e`;
  - replacement plan has a valid 17.3s intermediate segment, estimated duration 256.7s, and zero contextual validation errors.

## Remaining Risk

- No real provider call or destructive live-session mutation was performed. This follows repository safety rules and means the final FFmpeg render was not replayed during diagnosis.
- On resume, the workflow validates the saved arrangement, replaces it with the locally validated fallback, persists the replacement, and continues production. A currently running dev server/browser must load the changed source (restart if it is not hot-reloaded) before retrying the saved session.
