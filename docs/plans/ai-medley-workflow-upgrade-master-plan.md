# AI Medley Architect Workflow Upgrade Master Implementation Plan

**Status:** Completed foundation plan. Current runtime behavior is governed by
`docs/current-operations.md`, `AGENTS.md`, and the repository-root
`task_plan.md`.

**Superseding implementation addendum — 2026-07-15:** Automatic v4 now uses
OpenRouter as its only cloud-provider route, generates distinct candidate
options when safe, and always requires a human choice before final promotion.
AI musical approval is recommendation evidence only. The implemented state
machine includes `generating_options`; `musical_review` may transition to
`generating_options`, `correcting`, `manual_review_required`, or `failed`, but
never directly to `finalizing`. `generating_options` may transition to
`validating_arrangement`, `manual_review_required`, or `failed`. The former
paid/live-provider gate remains skipped; current explicit live integration uses
only catalog-listed OpenRouter `:free` models, synthetic audio, and an isolated
data root.

**Target workspace:** `G:\ai-medley--main`
**Role:** Lead Architect & System Hardening Codex Agent
**Execution mode:** sequential internal phases with verification gates
**Branching rule:** inventory and classify all uncommitted files before any branch switch; keep unrelated edits unstaged and stage exact paths only.

## I. Non-Negotiable Safety and Branching Ground Rules

1. Preserve `library/`, `workdir/`, source audio, checkpoints, candidates, manifests, finals, history, wisdom, environment files, and provider-payload audit artifacts. Never clean, reset, bulk-migrate, or delete them.
2. Build and production-start checks run only in a disposable repository copy with isolated `AI_MEDLEY_DATA_ROOT`.
3. Core tests use mocked local provider responses only. Automatic v4 makes no context-brief or production/tool-execution provider request; arrangement and musical review are constrained provider decisions.
4. Manual Model mode remains intact. Expert manual capability intentionally grants powerful shell/file access and is not fully contained.
5. Run applicable declared package scripts: `lint`, `test`, `test:e2e`, `build`, and `test:production-start`. Do not invent scripts.

## II. Structural Data Ownership and Reconciliation

- Session lifecycle: `workdir/<sessionId>/session-state.json`.
- Deterministic analysis/design snapshot: `workdir/<sessionId>/design-v4.json`.
- Validated arrangement versions: `workdir/<sessionId>/arrangement-vN.json`.
- Resume state: checkpoint file.
- Candidate identity/reviews: `workdir/<sessionId>/candidate-manifest.json`.
- Final promotion transaction: `workdir/<sessionId>/finalization-transaction.json`.
- Completed browsing projection: `library/history.json`.
- Long-term learning projection: `library/wisdom.json`.

Startup reconciliation is non-destructive. It detects interrupted boundaries and never infers completion from one file. History status is `available`, `output_missing`, `candidate_recoverable`, `finalization_incomplete`, or `legacy_unverified`; history is never auto-deleted. Path policy must prevent a session ID escaping `workdir`.

## III. Authoritative State Machine and Transaction Coordination

Use one per-session transaction coordinator for all state changes; do not nest independent session, manifest, and finalization locks. Different sessions may proceed concurrently. Test review+correction, correction+cancellation, repeated finalization, SSE+cancellation, and human approval+AI review.

`session-state.json` has monotonic `stateRevision`. Every authoritative write uses optimistic expected-revision atomic writes and rejects stale revisions. Require idempotency keys for session creation, arrangement submission, execution compilation, transition execution, candidate rendering/registration, technical/musical reviews, correction submission, human approval, and finalization; identical keys return the original result.

Finalization durable order: write intent → copy candidate → verify size/SHA-256 → update manifest → history projection → wisdom projection → delete checkpoint → mark transaction complete → mark session completed.

Legal transitions: `created→analyzing`; `analyzing→planning|cancelled|failed|recoverable_error`; `planning→validating_arrangement|cancelled|failed`; `validating_arrangement→executing_transitions|manual_review_required|failed`; `executing_transitions→rendering_candidate|correcting|cancelled|failed`; `rendering_candidate→technical_review|recoverable_error|failed`; `technical_review→musical_review|correcting|manual_review_required|failed`; `musical_review→generating_options|correcting|manual_review_required|failed`; `generating_options→validating_arrangement|manual_review_required|failed`; `correcting→executing_transitions|planning|manual_review_required|cancelled`; `manual_review_required→correcting|finalizing|cancelled`; `finalizing→completed|recoverable_error|failed`. Terminal: `completed`, `cancelled`, `failed`.

## IV. Core Code Enhancements and Contracts

Automatic workflow v4 is pinned at session creation; v4 never silently falls back to v3, v3 never resumes through v4, and rollback changes only the default for new sessions. Schema and workflow versions are distinct.

`designHash` includes: design schema, deterministic algorithm, selected IDs, selection hash, source SHA-256 values, analysis schema/analyzer versions, target duration, maximum transitions, workflow constraints, transition-scoring policy version, wisdom snapshot hash, canonical deterministic brief, and canonical transition candidates. Exclude UI state, temporary paths, and provider responses.

`transitionCandidateId` excludes mutable style/duration choices; canonicalize seconds to integer milliseconds, use stable key ordering and UTF-8 canonical serialization before hashing.

Candidate manifests append `technicalEvaluations[]`, `musicalReviews[]`, `humanReviews[]`, and `correctionEvents[]`; derived summaries never erase evidence. Enforce maximum candidates, correction attempts, free-disk reserve, and session artifact bytes. On a limit, retain all artifacts and enter `manual_review_required`.

Upload: staging → limits → media probe → SHA-256 → duration/stream/channel/codec validation → atomic metadata registration → permanent move → safe rollback. Deletion: pending marker → quarantine → atomic database update → recovery-period retention → explicit user-authorized purge only.

Cancellation is session-wide. Remove only owned, unregistered `.part` files for the same session/generation/cancelled operation. `cancelled` is authoritative.

## V. Implementation Phases

0. Baseline, classification, protected fingerprints, test side-effect audit.
1. `AutomaticSessionStateV1` through `ManualReviewStateV1` schemas, idempotency, append-only arrays.
2. Session-state contract, single transaction coordinator, cross-file commit order.
3. Transactional source upload and deletion.
4. Deterministic brief, canonical hashes, transition provenance.
5. Deterministic execution compiler and pinned workflow v4.
6. Technical quality gate, DSP parity, candidate limits.
7. Constrained musical review and targeted correction idempotency.
8. Manual-review-required, append-only human approval, UI.
9. Unified cancellation, SSE projection, startup reconciliation.
10. Compatibility adapters and schema migration tests.
11. Offline end-to-end acceptance, failure injection, documentation alignment.

## VI. Acceptance, Regression, and Documentation Requirements

Mocked normal completion: upload three synthetic tracks, select two, analyze two, deterministic brief, constrained arrangement, deterministic execution, candidate render, technical pass, mocked musical recommendation, distinct comparison candidate when safe, Candidate Review, explicit human approval, and exact promotion. Mocked targeted correction reruns one transition only, preserves unaffected work and previous candidates, then requires the human to choose a technically valid draft. Mocked manual review exhausts corrections, restores after refresh, and human-approves a technically valid candidate.

Manual regressions cover Gemini, OpenRouter, custom OpenRouter model ID, manual v2 checkpoint resume, tool-failure streak, legacy finish route, cancellation, playback, and final download. Inject atomic-write, stale-revision, upload-rollback, checkpoint, render, SSE disconnect, different-existing-final, and history-interruption failures; prove protected artifacts remain and recoverability is correct.

Update `docs/current-operations.md`, `docs/api-routes.md`, `AGENTS.md`, `CLAUDE.md`, `docs/architecture/medley-workflow-visual-guide.md`, and the end-to-end, decision-process, and recovery-failure diagrams. Document removal of context/production specialists from automatic v4, manual compatibility, and expert shell-access boundary.

## Continuous Phase Execution

Execute all offline phases continuously and autonomously.

Phase boundaries are internal verification gates only. After completing a phase:

1. Record the results in `task_plan.md`, `progress.md`, and `findings.md` as appropriate.
2. Run the required verification checks.
3. Commit and push coherent work when appropriate.
4. Continue immediately to the next unfinished phase.

Do not stop, request approval, or send a final user-facing response between phases.

Only stop before all offline phases are complete if continuing would risk protected user data, require an unauthorized irreversible action, or be impossible because required access or information is unavailable.

Paid live-provider acceptance is skipped. Core tests use mocked provider calls.
The separate, explicitly authorized integration gate may call only
catalog-listed OpenRouter `:free` models with synthetic prompts/audio and an
isolated `AI_MEDLEY_DATA_ROOT`.
