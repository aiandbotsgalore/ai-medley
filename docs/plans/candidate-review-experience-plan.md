# Candidate Review Experience Implementation Plan

**Status:** Complete — implemented and verified 2026-07-14
**Branch:** `payload-optimization`
**Safety boundary:** Preserve all protected user data and unrelated changes. Tests use isolated temporary roots; live checks use synthetic audio and OpenRouter `:free` models only.

## Outcome

Every rendered draft is visible, playable, understandable, recoverable, and actionable. The application reports completion only after a verified final MP3 has been transactionally promoted. The internal `manual_review_required` state opens a useful Candidate Review experience rather than a dead end.

## Architecture boundaries

- Extend the existing Automatic v4 state machine, candidate manifest, append-only reviews, per-session transaction coordinator, and finalization journal.
- Do not add a parallel state store, migrate existing session artifacts, or rewrite protected data.
- Automatic mode routes provider work through OpenRouter only. Manual-mode compatibility remains intact.
- One initial candidate and at most two genuinely different targeted corrections are permitted.
- Candidates are never automatically overwritten or deleted. Any archive/hide action is reversible metadata only.

## Phase 1 — Baseline and authoritative review projection

- Inventory the current React status flow, state endpoint, candidate manifest, review evidence, audio serving, checkpoint recovery, and finalization result.
- Add a typed server-to-UI projection containing authoritative state, state revision, candidate summaries, append-only review evidence, correction lineage, final integrity, user-facing reason, and legal actions.
- Make legacy manifests readable without rewriting them.
- Add focused projection tests for empty, rendered, rejected, manual-review, interrupted-finalization, and completed sessions.

## Phase 2 — Honest status and recovery

- Derive UI labels from authoritative server state and final integrity.
- Remove the current non-running-state `Target Achieved` default.
- Re-fetch authoritative state after human review and finalization; never set completion optimistically.
- Restore the correct Candidate Review or Finalized view after refresh/restart.
- Preserve rendered-but-unregistered recovery without rerendering.
- Distinguish provider failure, musical rejection, technical invalidity, recoverable interruption, cancellation, and terminal failure.

## Phase 3 — Candidate audio and review UI

- Serve only manifest-registered candidate audio through a session-scoped, range-capable endpoint with path and hash integrity checks.
- Build an accessible Candidate Review panel with one shared player.
- Display every draft, including technically invalid candidates, with duration, size, creation time, technical status, review reason, transition concerns, recommendation, deterministic plan differences, local path, and Copy Path.
- Disable finalization for technically invalid or unapproved candidates without hiding them.
- Support keyboard operation, live status announcements, and A/B candidate switching.

## Phase 4 — Constrained corrections and provider failure

- Replace silent local arrangement fallback with Retry, Change Model, or Cancel before rendering.
- Supply audio review with exact server-offered transition and correction IDs.
- Reject unknown corrections, multi-transition mutations, duplicate plan hashes, invalid provenance, duration/balance violations, and candidate-limit overflow.
- Preserve unaffected transition executions and every earlier candidate.
- When no safe correction exists, expose the preserved drafts and a plain-English explanation.

## Phase 5 — Finalization truth

- Require selected, approved, technically valid, registered candidate identity.
- Verify candidate size and SHA-256, final-copy byte identity, audio probe success, finalization journal completion, history/wisdom projection, and authoritative completed state.
- Resume interrupted finalization idempotently and refuse to overwrite a different final.
- Show final playback, download, local path, and finalized timestamp only after verification.

## Phase 6 — Acceptance and release gates

- Mocked tests: projection, status, correction, provider failure, stale revisions, SSE disconnect, manifest registration failure, resume, human approval, and finalization failures.
- Isolated FFmpeg acceptance: candidate render, range playback, multiple preserved drafts, exact promotion, refresh/restart recovery.
- Browser acceptance: single and multiple candidate playback, A/B switching, review evidence, approval, final download, keyboard accessibility, and honest status.
- Live acceptance: current OpenRouter `:free` audio/tool model with synthetic audio only.
- Run applicable `npm test`, `npm run lint`, `npm run test:e2e`, `npm run test:full`, failure injection, accessibility checks, `git diff --check`, and disposable production build/start with isolated `AI_MEDLEY_DATA_ROOT`.
- Update current operations, API, architecture, findings, progress, and active ledger. Commit and push only scoped files.

## Acceptance criteria

1. Draft 1 is immediately visible and playable.
2. A permitted rejection creates Draft 2 by changing only the named transition.
3. Both drafts remain playable and comparable after restart.
4. The chosen technically valid draft is human- or AI-approved and promoted with identical verified bytes.
5. Final and candidate views remain accurate after restart.
6. No protected data is lost, hidden, overwritten, migrated, or falsely reported complete.
