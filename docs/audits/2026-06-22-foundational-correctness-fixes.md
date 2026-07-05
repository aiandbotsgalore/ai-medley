# Foundational Correctness Fixes

Date: 2026-06-22
Scope: F-001 through F-004 from `docs/audits/2026-06-22-end-to-end-workflow-audit.md`

## Summary

Implemented focused safeguards for the automatic specialist workflow:

- F-001: Automatic finalization now requires an approved, selected, technically valid candidate. Correction exhaustion now fails instead of promoting an unapproved candidate.
- F-002: Transition execution authority is consolidated through a server-resolved transition object used by review-candidate rendering and quality-review payloads.
- F-003: Required automatic checkpoint boundaries are awaited. Stale, failed, or superseded checkpoint writes abort the required boundary instead of being ignored.
- F-004: Cancellation now invalidates stale callbacks, clears running UI state during pre-analysis/design, and prevents old SSE reconnect timers from reattaching.

No live provider calls were made. Verification used local tests and build commands only.

## Finalization Gate

Automatic candidate manifests are marked with `workflowMode: "automatic"` when candidates are registered. Legacy render-candidate compatibility marks manifests as `workflowMode: "legacy"`.

For server restart compatibility, `/api/finalize-medley` treats unclassified manifests with candidates as automatic. That means older automatic candidate manifests without workflow metadata fail closed unless the candidate is approved and selected.

Both automatic completion routes are covered:

- `/api/finalize-medley` calls `promoteCandidate(..., { requireApproved: true, requireSelected: true })` for automatic or unknown candidate manifests.
- `/api/session/finish` rejects automatic sessions and unclassified candidate manifests with candidates before updating session state, history, or wisdom.

## Transition Authority

Default transition execution permissions are strict:

- `style` is immutable.
- `beatAlign` is immutable.
- `duration` is immutable except when explicit bounded mutation is present.
- Track and section IDs remain locked to the arrangement.
- Resolved execution timings must fall inside the selected source sections.

The shared server resolver rejects missing server execution records, failed executions, invalid execution requests, missing preview paths, unavailable section context, and out-of-section timings. Candidate render no longer trusts model-reported execution fields for automatic sessions.

## Checkpoint Classification

Automatic checkpoint emissions are classified as follows:

| Emission                                                 | Durability       | Reason                                               |
| -------------------------------------------------------- | ---------------- | ---------------------------------------------------- |
| Active context role/model before provider request        | Opportunistic    | UI/progress resume hint only                         |
| Context model attempt list / repair count                | Opportunistic    | Diagnostic progress only                             |
| Project brief persisted to server                        | Required/awaited | Resume boundary before arrangement                   |
| Active arrangement role/model before provider request    | Opportunistic    | UI/progress resume hint only                         |
| Arrangement model attempt list / repair count            | Opportunistic    | Diagnostic progress only                             |
| Arrangement plan persisted to server                     | Required/awaited | Resume boundary before production                    |
| Production/correction stage entry                        | Required/awaited | Resume branch must not skip production state         |
| Production model attempt list / repair count             | Opportunistic    | Diagnostic progress only                             |
| Execution report persisted to server                     | Required/awaited | Resume boundary before candidate render              |
| Candidate rendered and registered                        | Required/awaited | Resume boundary before quality review                |
| Active quality-review role/model before provider request | Opportunistic    | UI/progress resume hint only                         |
| Quality-review model attempt list / repair count         | Opportunistic    | Diagnostic progress only                             |
| Quality review persisted to server                       | Required/awaited | Candidate approval/rejection boundary                |
| Correction counter increment                             | Required/awaited | Resume branch must not repeat wrong correction index |
| Final render/finalization entry                          | Required/awaited | Last durable state before final promotion            |

## Verification

Baseline before edits:

- `npm test`: passed.
- `npm run lint`: passed.
- `npm run build`: passed.
- `workdir/provider-payload-audit.json` was protected, restored, and hash-verified after the baseline test run.

Focused regression coverage added:

- `src/types/specialistWorkflow.test.ts`: default transition mutation rejection and explicit bounded mutation allowance.
- `src/server/candidateStore.test.ts`: automatic candidate promotion refuses unapproved/unselected candidates.
- `src/server/transitionResolution.test.ts`: resolved render transitions use server execution facts and reject unauthorized style/out-of-section timings.
- `src/utils/automaticCheckpoint.test.ts`: awaited checkpoint POST succeeds, rejects stale writes, rejects server failures, and rejects superseded runs.

Final verification is recorded in the session transcript after this document was created.
