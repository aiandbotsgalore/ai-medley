# Active Plan: Release Readiness and Handoff

Status: in progress — candidate-registration recovery hotfix under verification

Last updated: 2026-07-11

Historical plans are archived in
`docs/plans/archive/task-plan-history-through-2026-07-11.md`.

## Confirmed repository state

- Git is active at `G:/ai-medley--main` on branch `payload-optimization`.
- Current `HEAD` is `cb69dc1`; an `origin` remote exists.
- The old “not a git repository” warning was historical and is obsolete.
- `dist/`, `.env*`, `workdir/`, and `library/audio/` are ignored.
- Protected library JSON and several old workdir artifacts are already tracked.
  Ignore rules cannot protect tracked files; index-only de-tracking requires a
  separate approval and must leave local files byte-for-byte intact.

## Objective

Turn the completed medley workflow fixes into a reviewable release candidate
without feature expansion, provider spending, secret exposure, or protected
data mutation.

## Safeguards and unrelated changes

- Do not delete, rewrite, migrate, regenerate, clean, or reset protected data.
- Do not stash the mixed worktree. Leave unrelated user changes in place and
  unstaged so stashing cannot capture or disturb them.
- Attribute every changed path. If an in-scope file contains ambiguous unrelated
  edits, stop and request direction before staging or rewriting it.
- Use temporary roots, generated audio, and mocked providers for tests.
- Do not stage, commit, push, open a PR, de-track files, or use live providers
  without the separate approvals below.
- Never print real secret values during scans or diagnostics.

## Phase 1 — Freeze, attribute, and repair Git data boundaries

Status: complete

1. Record branch, `HEAD`, remotes, status, and the complete diff inventory.
2. Classify changes as workflow implementation, test/docs support, unrelated
   user work, or ambiguous overlap.
3. Capture hashes/metadata for protected data and the payload-audit artifact.
4. Verify `.gitignore` covers `library/`, `workdir/`, `.env*`, provider audit
   outputs, local logs, and `dist/`.
5. Inventory protected paths already tracked by Git.
6. Present exact index-only de-tracking commands. After separate approval, use
   `git rm --cached` only and prove every local file retains its prior hash.
7. Leave unrelated changes untouched and unstaged; never use reset, checkout
   restoration, or stash to separate them.

Exit: every change is classified, protected paths are ignored for future work,
approved de-tracking affects only the index, and ambiguous overlap is resolved.

## Phase 2 — Permanent regression coverage

Status: complete

Add isolated tests for:

1. Three library tracks with a two-track selection across client design, server
   authority, brief, arrangement, render, and resume.
2. Successful FFmpeg output plus an injected first manifest-write failure,
   proving retry registration occurs without a second render.
3. Manual final promotion with no later provider request or false UI failure.
4. Automatic invalid production output with changed correction feedback and a
   terminal stop for persistent registration failure.
5. SSE reconnect using last-event replay and authoritative snapshot hydration
   without duplicates.
6. Candidate/final identity, interrupted identical-final recovery, and refusal
   to overwrite different final bytes.

Exit: tests are deterministic, temp-rooted, provider-mocked, and reproduce the
historical regressions before validating their fixes.

## Phase 3 — Browser-level mocked acceptance

Status: complete through a clean mocked browser workflow plus focused contract
tests for nonvisual recovery/failure branches.

Using isolated Express data and mocked providers, cover upload, orphan recovery,
selection/reorder/refresh reconciliation, both workflow modes, fallback and
corrections, cancellation, compatible resume, unsafe-resume rejection, SSE
reconnect, candidate review, finalization, history, playback, seeking, download,
and truthful ready/failed/completed UI states. Capture screenshots, console and
network errors, accessibility results, and client/server state comparisons.

## Phase 4 — Failure injection and recovery

Status: complete

Inject disposable failures at checkpoint, manifest, validation sidecar, history,
wisdom, finalization journal, SSE, candidate hash, analysis cache, existing-final,
and storage-limit boundaries. Verify idempotent safe recovery, fail-closed unsafe
behavior, no duplicate projections, preserved bytes, accurate errors, and UI/
server agreement.

## Phase 5 — Explicit release, payload, security, and secret gate

Status: complete

Report each gate separately even when `npm test` also invokes it:

1. Focused tests from Phases 2–4.
2. `npm test`.
3. `src/engine/providerPayloadAudit.test.ts`:
   - enforce the 16,000 estimated-token regression target;
   - enforce 24,000-token and 100-KiB hard pre-network limits;
   - cover the complete current initial/repair/fallback/continuation/correction/
     review matrix;
   - historical coverage was 117 requests; the current two-model roster
     produces 78, and any count change must be explained and reviewed;
   - keep generated reports in OS temp and preserve the historical audit file.
4. Phase 34 security suites already included by `npm test`: `localAccess`,
   `pathPolicy`, `uploadPolicy`, `redaction`, `resourcePolicy`,
   `credentialStore`, provider-proxy, and contained-capability coverage.
5. `npm run lint`.
6. `git diff --check`.
7. Secret-leak gate using synthetic canary credentials only:
   - scan tracked source, proposed staged diff, logs, checkpoints, provider
     audits, browser console/network capture, and isolated build output;
   - reject leaked Authorization headers, key values, signed query secrets, or
     canaries outside explicitly memory-only state;
   - confirm `.env`/`.env.local` and browser keys are neither staged nor bundled;
   - clear test browser storage afterward.
8. Build and production-start smoke in a disposable repository copy using an
   isolated `AI_MEDLEY_DATA_ROOT`.
9. Synthetic real-FFmpeg upload → analysis → selected design → candidate →
   manifest → final smoke with candidate/final SHA-256 equality.
10. Protected fingerprint comparison and proposed staged-file inventory.

`dist/` is already ignored and untracked. Future release builds run in a
disposable copy; the plan no longer mutates and restores workspace `dist/`.

Exit: every named gate passes; no real provider call or secret leak occurs;
protected hashes are unchanged; production binds only to `127.0.0.1`.

## Phase 6 — Scope and documentation closure

Status: complete

Review the final diff line-by-line, remove temporary/debug material, update only
authoritative changed contracts, verify routes/environment/models/recovery/
retention/security/payload guidance, and present the final release checklist,
risks, and exact staged-file proposal.

## Phase 7 — Commit and handoff gate

Status: complete — code-only handoff committed as `af7a16c`, pushed to
`payload-optimization`, and opened as PR #1. The two current source MP3s remain
unstaged and untouched after a bounded read-only recovery search found no copy.

Before staging, present the exact files, commit grouping, commit messages, and
verification attached to each commit. Split implementation, client state, and
tests/docs only if each intermediate commit passes; otherwise prefer one atomic
stabilization commit.

Separate approval is required before:

- index-only protected-file de-tracking;
- staging or committing;
- pushing;
- opening a PR.

Unrelated user changes remain unstaged throughout.

## Optional Phase 8 — Live provider acceptance

This is never an automated test. First obtain explicit provider/model choices
and maximum request, dollar, and elapsed-time ceilings.

Passing criteria:

- Automatic uses only selected tracks, stays within fallback/correction limits,
  promotes an approved candidate with identical final hash, and leaves history,
  wisdom, checkpoints, SSE, playback, and download consistent without leaks.
- Manual uses only selected tracks, reaches deterministic promotion, makes no
  provider request after finalization, remains completed, and supports playback
  and download.

Abort immediately when a request/cost/time ceiling is reached; authentication,
payment, or credential errors occur; payload limits are exceeded; fallback or
correction budgets are exhausted; repaired output repeats unchanged; any path,
hash, manifest, history, wisdom, or checkpoint inconsistency appears; or secret
exposure/protected-data mutation is suspected.

On abort, stop new provider/render activity, preserve all evidence and artifacts,
perform no cleanup, and report the last authoritative state.

## Approval status

The earlier approval-gated wording below was superseded by the user's
uninterrupted execution authorization. Optional live-provider calls remain
excluded because no spending ceiling was supplied.

## Handoff blocker — 2026-07-12

The final stable protected-data comparison found two source-audio paths with
different SHA-256 values and lengths from the 2026-07-11 baseline. Both grew by
521 bytes and have 2026-07-12 modification times. Their contents were not read,
rewritten, restored, deleted, staged, or committed. The current process list
contained no AI Medley server at inspection time. This must be treated as a
potential protected-data mutation. The user authorized the recommended
preservation path: leave the current bytes untouched, do not stage them, and
complete only the code/docs handoff. A bounded exact-name search of likely
backup locations found no duplicate; Git has no tracked copy or history.

## Candidate registration hotfix — 2026-07-13

Chrome inspection and the preserved `bknfa639` error sidecar identified a
strict-schema recovery failure: `resolvedTransitions` retained only the two
internal render scratch fields `_resolvedFromExitSec` and
`_resolvedToEntrySec`. Recovery now applies the same narrow transition
sanitizer used by initial manifest registration before strict candidate parsing.
The preserved real candidate has not been retried or rewritten. Focused
candidate recovery, TypeScript, and diff checks pass; complete the code-only
hotfix handoff after final review.

## Candidate resume compatibility follow-up — 2026-07-13

After the first hotfix, resuming `bknfa639` reached a second guard: the saved
candidate had execution version 4 while the resumed checkpoint had version 6.
Read-only comparison proved their two audio-affecting transitions match exactly.
Recovery now permits only an older candidate whose transition IDs, tracks,
sections, planned timings, actual timings, style, beat alignment, and duration
match the resumed execution report. A different plan remains rejected. The
real manifest was not written during this diagnosis.

## Execution authorization update

On 2026-07-11 the user authorized uninterrupted execution without approval
pauses. Phases 1–7 may proceed autonomously, including index-only de-tracking,
staging, committing, pushing, and PR creation where access permits. Optional
Phase 8 remains excluded because no provider spending ceiling was supplied and
real provider calls are unnecessary for release readiness.
