# AI Medley Architect Progress

## 2026-07-15 — Repository-wide documentation alignment started

- User requested that every project document be brought current.
- Ran a read-only inventory of all Markdown, Mermaid, and text documentation.
- Classified active contracts, chronological ledgers, historical plans/audits,
  incident reports, experiments, and generated repository snapshots.
- Confirmed active semantic drift in `CLAUDE.md`, architecture diagrams,
  `task_plan.md`, acceptance wording, and historical-looking verification files.
- Replaced the stale active task ledger with this documentation-alignment phase.
- No protected audio, session, manifest, candidate, final, history, wisdom,
  checkpoint, environment, or provider-payload audit artifact was read or changed.
- Documentation inventory attempt 1 used an invalid PowerShell pipeline after a
  `foreach` statement and failed before reading or writing files. The follow-up
  uses an explicit results array instead of repeating that syntax.
- The corrected inventory classified 39 tracked documentation files and four
  untracked local artifacts. Historical plans/audits will keep their dated
  claims; active contracts, diagrams, ledgers, and experiment indexes will be
  corrected, while untracked generated/history files will not be staged.
- Reviewed the complete active plans, plan index, README, audit headers, and
  payload-experiment directory. Established a banner/addendum strategy that
  keeps historical facts intact while preventing old instructions from being
  mistaken for current behavior.
- Updated the current README and CLAUDE guide, the Automatic v4 visual guide,
  all three workflow diagrams, the plan index, Candidate Review acceptance
  wording, and the Master Plan superseding rules. They now agree that Automatic
  mode uses OpenRouter only, rendering is local and deterministic, candidates
  are immutable, AI review is advisory, and a human must choose before final
  promotion.
- Compared the Master Plan transition matrix with
  `src/server/automaticSessionState.ts`; the documented `generating_options`
  and human-review path now match the enforced server states.
- Added a historical audit index and explicit non-authoritative banners to all
  dated audits and old imperative plans without altering their recorded facts.
- Converted the payload-optimization directory from a misleading active plan
  into a completed experiment archive and added the current 12-request payload
  measurement summary to the historical verification report.
- Marked the four pre-existing untracked chat/verification/repository snapshots
  as stale local history. They remain untracked and will not be included in the
  documentation commit.
- Replaced the destructive tracked `clean-workdir` skill instructions with a
  read-only protected-storage audit contract and extended the FFmpeg reviewer
  to enforce no-overwrite, decode/probe/hash verification, and protected input
  safety.
- The repository-wide relative documentation link check passed for all 45
  tracked/current Markdown and Mermaid files.
- `npm test` passed the complete mocked suite, including the 12-request payload
  audit and documentation contract. `npm run test:e2e` also passed in its
  isolated temporary root; as designed, it made one live audio-review call to
  catalog-listed `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` using only
  generated tones. No paid model, source track, library, or repository workdir
  data was used.
- Updated the command documentation to distinguish the mocked core gate from
  the two deliberately live, free-only synthetic integration scripts.
- `npm run test:openrouter-free-live` passed with catalog-listed free models:
  tool calling used `nvidia/nemotron-3-nano-30b-a3b:free` and strict structured
  output used `tencent/hy3:free`. The gate used only generated prompts and an
  isolated temporary application root.
- The first final source-comparison helper used the overly exact phrase
  `a human must choose`; `AGENTS.md` correctly says `A person must choose`.
  The helper failed without changing files and was corrected to assert the
  actual contract wording.
- Final gates passed: release documentation contract, TypeScript, complete
  mocked `npm test`, isolated synthetic/free-model end-to-end, free-only tool
  and structured-output integration, all relative links, Mermaid structure,
  provider/model/state source comparisons, `git diff --check`, credential
  pattern scan, and protected-path diff scan.

## 2026-07-14 — Candidate Review Experience

- User approval received; continuous implementation authorized.
- Created `docs/plans/candidate-review-experience-plan.md` and updated the active ledger.
- Baseline inspection confirmed existing state/manifest/finalization foundations
  and identified false completion labeling and the incomplete manual-review UI.
- No protected user data, provider credentials, candidates, finals, or environment files were changed.
- First Candidate Review type-check found React's local JSX typing did not admit
  the mapped component `key`; the component props now explicitly tolerate the
  React-only key while retaining the runtime behavior.
- A read-only source search used a Windows-incompatible wildcard and referenced
  a non-existent `targetedCorrection.ts`; the actual correction implementation
  is in `specialistOrchestrator.ts`, which was inspected directly on the next action.


## 2026-07-13 Master Plan offline completion

- Completed the remaining workflow-upgrade offline gates using mocked provider
  behavior and isolated temporary data roots only.
- Fixed durable automatic cancellation and the idempotency replay stale-revision
  failure path; a successful state-changing operation can no longer be marked
  failed when its replay record is saved.
- Fixed v4 automatic-session ownership and stopped preview-only execution facts
  from mutating strict arrangement objects. The isolated end-to-end acceptance
  now exercises the strict v4 route through upload, local analysis, design,
  arrangement, deterministic FFmpeg execution, candidate technical/musical
  review, exact promotion, playback, and download.
- Added existing cross-drive upload and targeted-correction focused tests to
  the standard `npm test` gate.
- Verified `npm test`, `npm run lint`, `npm run test:e2e`,
  `npm run test:release-contract`, `git diff --check`, and a build plus
  production-start smoke in a disposable worktree with isolated
  `AI_MEDLEY_DATA_ROOT`. The first disposable install used `--ignore-scripts`
  and correctly failed because it suppresses the bundled FFmpeg installation;
  the normal isolated install/build/smoke passed.
- Live-provider acceptance remains intentionally skipped. No protected library
  or workdir data was used by acceptance tests.

## 2026-07-04 stabilization continuation

- Read the stabilization implementation progress and audit findings before editing.
- Inspected git state, provider transport/history, fallback/config, semantic validators, payload measurement, manual contracts, and Phase 6-related tests.
- Reported that Phase 6 implementation had not started and identified transactional provider history as the exact safe resume point.
- Added and passed mocked provider status/history/fallback tests, provider/model migration tests, authoritative fact/candidate tests, shared scale-budget tests, and versioned manual-contract tests.
- Completed Phase 6 verification with `npm test`, `npm run lint`, controlled `npm run build`, and `git diff --check`; restored `dist` exactly and confirmed every protected fingerprint was unchanged.
- Began Phase 7 with read-only inspection as the safe resume point.
- Completed Phase 7 Host/session/path/upload/capability/credential/redaction hardening using temp-root and canary tests only.
- Verified Phase 7 with the full test suite, lint, controlled build, and diff check; restored `dist` and confirmed protected fingerprints were unchanged.
- Began Phase 8 in inventory-only mode with cleanup/deletion explicitly disabled.
- Completed Phase 8 with all-preserve artifact inventory, project/audio/log/concurrency limits, and no cleanup capability.
- Verified Phase 8 with tests/lint/build/diff and unchanged protected fingerprints.
- Began Phase 9 packaging/startup inspection without running `npm ci` or changing dependencies.
- Added isolated data-root/port/startup validation and an owned production health smoke.
- Reproduced and fixed the production artifact mismatch; bundled ESM `dist/server.js` now starts and reaches health.
- Stopped in Phase 9 before clean-install verification because `npm ci` would reinstall dependencies. Phases 10–11 remain untouched; next step requires explicit isolated-install approval.

## 2026-05-19

- Logged conversation under `C:\Users\Logan\Documents\Codex Conversations`.
- Read `planning-with-files` skill instructions.
- Ran planning session catchup; no unsynced context was reported.
- Inspected project startup files and app structure.
- Found existing dependencies are installed and app is already runnable at `http://localhost:3000`.
- Inspected `server.ts`, `src/App.tsx`, `src/components/ConfigPanel.tsx`, and `src/engine/prompts.ts`.
- Confirmed current app is Gemini-specific in runtime code.
- Checked OpenRouter official docs for chat completions, tool calling, auth, and audio input support.
- Created `task_plan.md`, `findings.md`, and `progress.md`.
- Received approval and implemented provider-aware configuration settings.
- Added provider selection, Gemini API key input, OpenRouter API key input, and OpenRouter model input/presets.
- Added shared tool schema and provider adapter runtime.
- Updated the autonomous loop and pre-analysis flow to use provider-aware audio analysis.
- Updated `/api/config` to expose OpenRouter environment fallback.
- Fixed TypeScript issues introduced during integration and updated `test_sdk.ts` to the current Gemini SDK shape.
- Verified with `npm run lint`, `npm run build`, and `http://localhost:3000` returning `HTTP 200`.
- Fixed generated/final audio analysis by adding `/api/audio-file` and routing non-library `listen_to_audio` paths through it.
- Stopped deleting the session work directory immediately on finish so final audio remains available.
- Caught interrupted preview playback promises in `LibrarySidebar`.
- Disabled Vite HMR to avoid stale websocket retries against `localhost:24678`.
- Re-verified with `npm run lint`, `npm run build`, `GET /api/health`, `GET /`, and `GET /api/audio-file`.
- Investigated cost-control request.
- Confirmed current app sends full audio files during provider analysis.
- Confirmed bundled FFmpeg has local analysis filters needed for a local-first implementation.
- Added proposed local-first redesign to `task_plan.md` and cost findings to `findings.md`.
- Implemented `audioAnalysisMode` config with `Local Only` as the default.
- Added `/api/audio-analysis/local` server endpoint using local FFmpeg.
- Installed `music-tempo` to improve local BPM detection.
- Updated pre-analysis and `listen_to_audio` so raw audio uploads happen only when `Ask First` is confirmed or `Cloud Allowed` is selected.
- Updated model prompt so the provider receives compact local analysis and does not request cloud audio by default.
- Verified with `npm run lint`, `npm run build`, restarted dev server, and tested local analysis on an existing track.

## 2026-05-20

- Logged Logan's Bluetooth connection issue to the external Codex conversation log.
- Read `planning-with-files` instructions for the multi-step diagnosis.
- Started a read-only Windows Bluetooth diagnosis side task.
- Checked Bluetooth adapter, driver, services, PnP state, and recent System events.
- Narrowed the requested focus to the 11:49 incident.
- Found the 11:49 incident was BTHUSB adapter command timeouts followed by Windows unloading the Bluetooth driver.
- Confirmed the adapter later recovered to `OK`, so this appears intermittent/hang-related rather than permanently missing hardware.
- Per Logan's request, reset the Realtek Bluetooth adapter and Bluetooth services.
- Found `BTAGService` got stuck in `StopPending`; killed its isolated service host PID and restarted the service.
- Verified final Bluetooth state: core adapter `OK`; core Bluetooth services running.
- After Logan reported Bluetooth still unselectable, checked Bluetooth radio software device, Radio Management service, and policy blocks.
- Restarted Explorer/Settings shell and opened Bluetooth settings.
- Tried Plug and Play/radio-layer refresh; Windows device-management operations hung, then were stopped.
- Tried no-reboot hard repair at Logan's request.
- `pnputil /restart-device` against the Realtek Bluetooth adapter hung and was stopped.
- Device Association Service failed and became stuck in `StartPending`.
- Ran DISM health check; component store was repairable.
- Ran DISM RestoreHealth; repair completed successfully.
- Retried Device Association Service; it still hung.
- Tried SFC; Windows refused because a pending system repair now requires reboot.

- Logged Logan's export/download complaint to the external Codex conversation log.
- Re-read `planning-with-files` instructions and current planning files.
- Found the current Export Output link points at the inline `/api/audio/:sessionId` route.
- Found that a missing audio file returns JSON, which can explain JSON being downloaded instead of the medley MP3.
- Started a scoped export fix: dedicated download route plus client-side response validation.

- Added a dedicated /api/audio/:id/download route for attachment downloads.
- Updated the sidebar export control to fetch the route, reject JSON/error responses, and save a real MP3 blob.
- Updated history downloads to use the dedicated download route.
- Progress append command failed once because PowerShell interpreted quoted content incorrectly; retried with a literal here-string.
- Verified `npm run lint` passed.
- Verified `npm run build` passed.
- Started the dev server at `http://localhost:3000`.
- Verified `/api/audio/u6dcusk/download` returns HTTP 200, `audio/mpeg`, `attachment; filename="final_medley.mp3"`, and 9,986,039 bytes.
- Verified `/api/audio/u6dcusk` still returns inline `audio/mpeg` for playback.
- Verified the app root returns HTTP 200.

- Logged Logan's request for a high-impact medley song-selection plan.
- Confirmed the work is only for `G:\ai-medley--main`.
- Reviewed current planning files and source-level evidence for local analysis, prompts, scoring gaps, and UI/config behavior.
- Added the proposed Medley Intelligence Upgrade to `task_plan.md` with phases 8-13 and an approval gate.
- Added medley intelligence planning findings to `findings.md`.
- No implementation code was changed for this plan.
- Read Logan's instruction file at `C:\Users\Logan\OneDrive\Documents\You are working inside my Medley Cr.txt`; it instructed immediate implementation in the Medley Creator project only.
- Implemented `src/engine/medleyIntelligence.ts` with local facts, heuristic guesses, section scoring, pairwise transition scoring, ranked order strategies, compact design payload generation, and AI-plan validation.
- Added `/api/medley-intelligence/design` and wired local analysis to save `medleyIntelligence` in library entries.
- Updated local analysis text to clearly separate facts, heuristic guesses, scoring/ranking, and candidate sections.
- Updated `src/engine/prompts.ts` so the model receives the compact Medley Design JSON and must avoid unsupported claims about key, lyrics, or song meaning.
- Updated `src/App.tsx` to build Medley Intelligence before the autonomous loop and pass it into the model prompt.
- Updated pre-analysis and `listen_to_audio` so local analysis always runs first; optional cloud audio can supplement but not replace the local facts.
- Added `src/components/MedleyMatchPanel.tsx` so the workshop sidebar shows candidate sections, transition scores, order strategies, and warnings before final export.
- Added `src/engine/medleyIntelligence.test.ts` and `npm test` for no-API scoring/payload/validation coverage.
- Fixed a TypeScript key-prop issue in `MedleyMatchPanel`.
- Verified `npm test` passed.
- Verified `npm run lint` passed.
- Verified `npm run build` passed; Vite emitted only the existing large chunk warning.
- Started the dev server at `http://localhost:3000`.
- Verified `GET /api/health` returned OK.
- Verified `GET /` returned HTTP 200 HTML.
- Verified `POST /api/medley-intelligence/design` returned success with 7 tracks, 32 transition scores, 6 strategies, and source `local_medley_intelligence`.
- Stopped the dev server after runtime checks.
- Updated `task_plan.md`, `findings.md`, and `progress.md` with implementation status and validation results.
- Logged Logan's request to plan deeper local audio analysis.
- Re-read the planning-with-files instructions and current project planning files.
- Researched local audio-analysis tool options: Essentia/Essentia.js, aubio, and librosa.
- Added the proposed Deep Local Audio Analysis Upgrade to `task_plan.md` with phases 14-23 and an approval gate.
- Added deep local audio analysis planning findings and sources to `findings.md`.
- No implementation code was changed for this plan.

## 2026-05-21

- Logan approved the Deep Local Audio Analysis Upgrade plan.
- Marked the deep local analysis implementation as in progress in `task_plan.md`.
- Confirmed current implementation still has local FFmpeg analysis in `server.ts`, Medley Intelligence in `src/engine/medleyIntelligence.ts`, and no advanced local MIR dependency installed yet.
- Installed `essentia.js`; it added 2 packages and updated `package.json` / `package-lock.json`.
- Inspected the Essentia.js package shape and confirmed it exposes `Essentia`, `EssentiaWASM`, `EssentiaModel`, `EssentiaExtractor`, and `EssentiaPlot`.
- Found direct Essentia WASM algorithms can throw raw numeric errors on unsuitable/synthetic input, so implementation uses Essentia defensively and keeps local DSP fallback.
- Added `src/engine/localAudioAnalysis.ts`.
- Implemented `local_audio_analysis_v2` with beat grid, beat confidence, tempo segments, onset detection, onset density windows, spectral centroid/rolloff/flatness/flux, brightness/density descriptors, chroma/key estimate, RMS loudness windows, beat-snapped segments, and quality warnings.
- Wired `/api/audio-analysis/local` to the V2 analyzer.
- Updated `src/engine/medleyIntelligence.ts` to consume V2 facts and score beat alignment, downbeat confidence, harmonic stability, spectral contrast, groove continuity, transition shock/risk, and harmonic transition compatibility.
- Updated `src/components/MedleyMatchPanel.tsx` to show advanced track count, key estimate count, beat/key confidence, and beat/key transition scores.
- Added `src/engine/localAudioAnalysis.test.ts`, which generates a WAV locally and verifies V2 analysis without API calls.
- Updated `npm test` to run both Medley Intelligence and local analyzer tests.
- Verified `npm test` passed.
- Verified `npm run lint` passed.
- Verified `npm run build` passed; Vite emitted only the existing large chunk warning.
- Started the dev server at `http://localhost:3000`.
- Verified `GET /api/health` returned OK.
- Verified `GET /` returned HTTP 200 HTML.
- Verified `POST /api/audio-analysis/local` on library track `09ffc54c-b8bc-4305-9a85-d28ab4798f88` returned `local_audio_analysis_v2`, BPM `128`, estimated key `F major`, 14 segments, 18 facts, and beat-aligned section scoring.
- Verified `POST /api/medley-intelligence/design` returned success with 7 tracks, 1 advanced V2 track, 32 transition scores, and 6 strategies.
- Stopped the dev server after runtime checks.
- Marked Deep Local Audio Analysis phases 14-23 complete in `task_plan.md`.
- Added implementation findings and license note to `findings.md`.
- Patched pre-analysis so older tracks that already had the previous analysis still get re-analyzed when `localAnalysisV2` is missing.
- Re-verified `npm run lint` passed.
- Re-verified `npm test` passed.
- Re-verified `npm run build` passed; Vite emitted only the existing large chunk warning.

## 2026-06-14

- Logan approved the final Three-Model Specialist Workflow plan.
- Confirmed the active branch is `payload-optimization`, synchronized with `origin/payload-optimization`.
- Confirmed the interrupted start made no tracked code changes.
- Marked specialist workflow implementation as in progress.
- Chosen implementation strategy: preserve the existing manual/version-2 loop and add a separate automatic/version-3 specialist path.
- Added Zod 4 and strict contracts for project briefs, arrangements, execution reports, candidates, reviews, handoffs, manifests, transition execution, and automatic checkpoints.
- Added compact specialist payloads, automatic role routing, one repair per model, role-specific fallback, 120-second request timeouts, one bounded 429 retry, abort signals, request IDs, and stale-request guards.
- Added config version 2 with automatic/manual mode, OpenRouter-key blocking, preserved manual provider/model choices, and all existing manual models retained.
- Added the automatic state machine and seven-stage UI.
- Added server-authoritative transition execution records and exact report validation.
- Added immutable review candidates, atomic manifests, locks, storage limits, safe path checks, SHA-256/size verification, deterministic selection, exact final promotion without FFmpeg, cleanup, and idempotent discard/finalization.
- Added version-3 specialist checkpoints with atomic sequence-aware writes and preserved version-2 legacy resume.
- Added responsive mobile stacking and changed the log label to Activity Log.
- Added direct tests for schemas, contextual validation, migration, payload limits, candidate selection, integrity tampering, candidate limits, exact promotion, and discard.
- Verified `npm test`, `npm run lint`, `npm run build`, and `git diff --check`.
- Verified the dev server and app at `http://localhost:3000`; browser console had zero errors.
- Verified compact complete provider request size: 53,824 bytes and about 17,908 estimated tokens.
- Verified real FFmpeg transition and 57.84-second candidate rendering, forged execution-report rejection, version-3 checkpoint acceptance/deletion, delayed checkpoint rejection, exact final SHA-256 match, and idempotent finalization.
- Verified interrupted discard removed its preview and checkpoint.
- Removed all temporary Codex verification sessions and history entries; source-library audio was untouched.
- Live OpenRouter specialist calls were not run because no OpenRouter API key is configured.
- Marked Three-Model Specialist Workflow phases 24-28 complete.
- Confirmed Logan's OpenRouter key is configured without exposing it.
- Started the first real automatic specialist run with four analyzed tracks and session `7s66ce77`.
- Nemotron 3 Super completed the project brief.
- Found that browser timeout aborts could surface as user cancellation and stop the workflow silently.
- Updated provider sessions to preserve the actual timeout reason.
- Reduced the arrangement handoff to essential track data, the best directed transition pairs, and the top four strategies.
- Re-verified `npm test`, `npm run lint`, and `npm run build` after the live-run fixes.
- Resumed the saved version-3 checkpoint at the arrangement stage.
- Nemotron 3 Ultra timed out at 120 seconds; the workflow correctly fell back to Nemotron 3 Super.
- Nemotron 3 Super completed the arrangement, and Nex-N2-Pro completed all three planned transitions.
- Rendered and reviewed immutable `candidate-001`; quality review approved it with overall score 85.
- Finalized the approved candidate without FFmpeg re-rendering.
- Confirmed `candidate-001.mp3` and `medley_final.mp3` have the same 25,932,326-byte size and SHA-256 digest.
- Confirmed `/api/audio/7s66ce77` returns seekable MP3 range responses and browser playback advances without errors.
- The completed 10:48 medley is available at `workdir/7s66ce77/medley_final.mp3`.
- Logan approved the Provider Payload Verification Gate as the only active work.
- Paused the larger hardening plan until every automatic provider request passes exact size verification.
- Began implementing shared exact serialization, role-specific compaction, three/four-track regression coverage, and live request measurement.
- Added `providerRequest.ts` with exact serialized-body measurement and component breakdowns.
- Added role-specific specialist payloads and tool allowlists.
- Changed OpenRouter networking to send the exact measured serialized string.
- Added runtime request auditing with provider-reported prompt-token capture.
- Added `providerPayloadAudit.test.ts` using the current three-track and four-track library data.
- Audited 117 initial, repair, fallback, continuation, correction, and quality-review requests.
- Verified the previous 237,644-byte request shape is rejected before network activity.
- Fixed a live production-report regression by retaining the required server-issued preview path in compact production tool results.
- Completed live automatic session `2oquenv9`.
- Completed forced correction session `payload-correction-live`.
- Confirmed finalization made no provider request in both runs.
- Confirmed both approved candidates exactly match their final MP3 files.
- Verified `npm test`, `npm run lint`, `npm run build`, server health, and a browser console with no errors.
- Added `provider-payload-verification.md` with automated and live measurements.
- Committed and pushed the provider payload verification gate as `f0e424c`.
- Replaced unrestricted CORS with local-origin validation.
- Bound the server to `127.0.0.1` instead of every network interface.
- Added cross-site write protection for POST, PUT, PATCH, and DELETE requests.
- Added `localAccess.test.ts` and included it in `npm test`.
- Verified `npm test`, `npm run lint`, and `npm run build`.
- Verified the live app and health endpoint return HTTP 200 locally.
- Verified outside origins and cross-site writes return HTTP 403.
- Verified port 3000 listens only on `127.0.0.1`.
- Restarted the development server at `http://localhost:3000`.
- Completed the approved Phase 9 clean-install gate in `G:\ai-medley-clean-install-test` with isolated G: npm cache and temp directories.
- Fixed `providerPayloadAudit.test.ts` to use deterministic synthetic tracks instead of protected `library/db.json` and `library/wisdom.json`.
- Verified disposable `npm ci`, full tests, type-check, production build, and owned production start; verified main tests/type-check/controlled build/diff and unchanged protected fingerprints.
- Began Phase 10 at the first unfinished F-033 barrier and added semantic tabs, upload, dialog/forms, keyboard reorder, named actions/status/progress/log regions, focus treatment, and reduced-motion behavior.
- Added `accessibility.ts` and `accessibility.test.ts`; the focused test, full suite, type-check, controlled build, and diff check pass.
- Started and stopped an owned isolated dev server on port 38941; no provider or real-data route was used.
- Stopped Phase 10 before runtime browser verification because the in-app browser has no available instance and Chrome DevTools/Playwright/Lighthouse CLIs are not installed; installing one needs separate approval.
- Received approval and installed a disposable G:-only Playwright/axe harness without changing the main project dependencies or downloading a browser.
- Ran the first Phase 10 matrix against system Chrome and mocked local APIs: 43/47 checks passed; contrast, tap-target sizing, and pending-upload progress exposure require UI fixes.
- Fixed the four measured issues and removed external Google Fonts; the disposable Playwright/axe matrix passed 47/47.
- Lighthouse generated a 0.98 report and exposed one upload heading-order issue, but cleanup failed with EPERM and Chrome singleton inspection showed the run attached renderers to the existing personal Chrome process. Did not terminate or otherwise touch that process; rerun only with an explicit G:-only profile.
- Fixed the heading order and reran Lighthouse with an explicit new G: profile. The complete report scores 1.00 with zero failed audits; the CLI exit remains nonzero only because its G: temporary directory cleanup returns EPERM.
- Completed Phase 10: full tests, lint, controlled build, diff check, and protected hashes pass; begin Phase 11 dependency/documentation closure.
- Phase 11 inventory proved `@google/generative-ai` is the sole dead duplicate SDK and identified stale README/AGENTS/CLAUDE environment, packaging, provider, capability, and persistence guidance. `.env.example` remains protected and will not be edited.
- Completed Phase 11: removed the proven-dead legacy Gemini SDK, Motion runtime, and unused Autoprefixer declaration; added checked current operations/API/plan-history documentation.
- Verified a new G:-only clean install (242 packages), full tests, type-check, build, production start, and offline zero-vulnerability audit; main checks and protected hashes pass. All implementation phases are complete.
## 2026-07-10 — OpenRouter connection preflight

- Added a user-triggered Configuration-panel connection test backed by a local
  server route and a minimal Gemini 2.5 Flash request (8 output-token cap).
- Added mocked success, authentication, insufficient-credit, rate-limit, and
  missing-credential tests. No live provider request was made.
- Verification passed: `npm test`, `npm run lint`, and `git diff --check`.
## 2026-07-10 — Configuration declutter

- Reduced the default Configuration screen to the recommended automatic mix,
  connection, local analysis, common style choices, and timing controls.
- Moved manual model/provider, cloud-analysis, and uncommon style controls to
  Advanced controls without removing existing functionality.
- Verified with `npm test`, `npm run lint`, and `git diff --check`.
- Follow-up: legacy saved Manual mode no longer expands provider, model, or
  shell-capability controls. It now offers one compact action to switch to the
  recommended automatic mix; verification was rerun successfully.
## 2026-07-10 — Library recovery and per-mix selection

- Diagnosed the empty sidebar: `library/db.json` was an empty array while three
  MP3 files remained under `library/audio/`. Historical backup records pointed
  only to missing audio and were left untouched.
- Added and locally invoked a non-destructive recovery route. It registered the
  three existing MP3s without modifying their bytes.
- Added selected-for-this-mix checkboxes, count, select-all/clear, and run-time
  filtering so only selected tracks are analyzed and rendered.
- Verified with `npm test`, `npm run lint`, and a local API recovery response.
## 2026-07-10 — Responsive UI polish

- Rebuilt Configuration as a fixed-header, scrollable-content, fixed-action
  dialog and compacted the common style controls into a desktop grid.
- Bounded the desktop workspace to the viewport and refined library/footer
  separation for a cleaner production-console layout.
- Verified with tests/type-checking and Playwright at 1440×900 and 1366×768;
  the Apply action remained visible in both viewports.
## 2026-07-11 — Candidate manifest timing-field fix

- Fixed automatic candidate registration rejecting render-only
  `_resolvedFromExitSec` / `_resolvedToEntrySec` fields.
- Added a strict manifest sanitizer and a regression test using the exact
  leaked-field shape reported by the failed run.
- Verified with `npm test`, `npm run lint`, and restarted the local dev server.
# 2026-07-11 — End-to-end medley workflow audit

- Drafted a release-readiness follow-up plan at the user's request. Status is
  awaiting approval; no implementation, test execution, provider call, git
  staging, commit, push, or protected-data operation was performed.

- Read the repository instructions and the code-review/file-planning skills.
- Ran session catch-up, captured the dirty worktree, branch, package scripts,
  and source/test inventory without touching protected data.
- Began mapping the real client/server workflow and preserving all prior edits.
- Baseline full offline tests passed in 18.8 seconds; captured four `dist/`
  file hashes for later restoration/verification.
- Traced selected-track flow, automatic/manual orchestration, provider audits,
  SSE replay, candidate rendering/manifest registration, and final promotion.
- Confirmed six scoped workflow defects and began focused fixes/tests.
- Implemented explicit selected-track authority and checkpoint binding for
  Automatic mode and safe resume filtering.
- Removed the unnecessary provider turn after Manual finalization and preserved
  failed-tool streaks so validation/execution retries can reach model fallback.
- Added SSE snapshot hydration and last-event replay on reconnect.
- Added recoverable candidate registration, bounded same-request retries,
  terminal handling when registration remains unavailable, and pre-existing
  final overwrite refusal with interrupted-promotion recovery.
- Stopped automatic deletion of rejected candidate artifacts and fixed wisdom
  track attribution to include both transition endpoints.
- Full tests, TypeScript, diff checks, controlled build/start, exact `dist/`
  restoration, and isolated synthetic upload/analyze/design/render/register/
  finalize smoke passed. No real provider request was made.
# 2026-07-11 — Release-plan reconciliation

- Verified the Git repository, branch, commits, ignore rules, tracked protected
  paths, payload audit, and security-test wiring.
- Split the 781-line mixed task plan into a concise active plan and historical
  archive.
- Moved the open Bluetooth reboot/SFC follow-up to a separate operations note.
- Removed stale model recommendations and corrected the obsolete Git warning.
- Added unrelated-change disposition, payload/security/secret gates,
  disposable-build policy, and live-run pass/abort criteria.
- Release execution remains paused pending user approval.
- Final combined documentation check returned exit 1 only because `rg` found
  none of the stale model/Bluetooth/status strings; `git diff --check` itself
  passed. Verified the no-match result separately rather than treating it as a
  document failure.

## Release execution

- Phase 1 started after uninterrupted execution authorization.
- Initial protected fingerprinting encountered the active
  `workdir/current-dev.stderr.log` lock. The existing process was not stopped.
  Retry will use a read-sharing hash stream and mark active dev logs volatile so
  they do not create a false protected-data comparison failure.
- The first de-tracking guard expected seven tracked protected paths but the
  inventory contains eight (three library JSON stores and five workdir files).
  The command stopped before changing the index. Correct the verified count and
  rerun the index-only operation.
- Workdir index removal succeeded, but three library JSON files remained because
  they carried Git's skip-worktree flag. The first local hash-check helper name
  `H` collided with PowerShell's `Get-History` alias, so that verification was
  invalid despite the files remaining present. Use a non-conflicting helper,
  verify the five workdir hashes, clear skip-worktree only on the three library
  paths, then remove them from the index and verify their hashes.
- Phase 1 complete: classified the dirty tree as cohesive release work plus
  requested documentation housekeeping; captured a 491-file protected manifest
  (489 stable files, two active volatile dev logs; stable root SHA-256
  `CA347EADA6999C9C86D890B130108C39D98282E19B36529179D34728658F09B8`);
  added full library/provider-audit ignore rules; removed eight protected paths
  from the Git index; and verified all eight local files still match baseline.
- The first permanent end-to-end test reached finalization successfully, then
  asserted track attribution against the first wisdom record. Candidate-render
  wisdom legitimately precedes completion wisdom, so the test must select the
  `completed_medley` record before checking both track IDs.
- Browser acceptance exposed `0/3 selected` after a refreshed initial library
  load. `fetchLibrary` mutated selection refs inside a React state updater;
  Strict Mode can invoke that updater more than once and erase the default
  selection. Move reconciliation/ref updates outside the updater, centralize
  selection commits, and add a repeated-initial-load regression assertion.
- Browser console inspection found Vite websocket failures on port 24678. The
  inline `createViteServer({ server: { middlewareMode: true } })` object
  overrode the configured `hmr: false`. Set `hmr: false` at the real runtime
  boundary and add a reliability source contract.
- The first resolved-Vite-config probe used top-level await through tsx's CJS
  eval path and failed before inspecting config. Retry with an async IIFE.
- Resolved config confirmed `hmr:false`, but Vite 6 middleware mode still
  injects `/@vite/client`, whose client code selects fallback port 24678 even
  when the HMR server is disabled. Switch the dev integration to `appType:
  "custom"`, transform the SPA index explicitly, and remove only the injected
  disabled-HMR client script.
- CSS transformation still imported `/@vite/client` for style injection, so
  stripping the HTML client was insufficient. Replace the interim approach with
  the supported single-server design: create one Node HTTP server, pass it to
  Vite's HMR configuration, and bind that same server on loopback. This avoids
  fallback port 24678 while retaining required dev CSS injection.
- The first restart command after the single-server change used PowerShell's
  reserved `$PID` variable name and stopped before touching the server. Tests
  and TypeScript had already passed. Retry with `$ownerPid`.
- The first full mocked Automatic browser run reached model orchestration, but
  the temporary browser fixture used an outdated strategy shape and crashed
  `MedleyMatchPanel` while mapping `orderedTracks`. Production code was not at
  fault; update the disposable fixture to the current `MedleyOrderStrategy`
  contract and restart the browser scenario with clean console state.
- The second mocked Automatic browser run correctly used only two selected
  tracks and rendered the Medley Match panel, then stopped because the temporary
  checkpoint mock returned `{success:true}` while the client requires
  `{ok:true}`. Update the disposable checkpoint response and restart cleanly.
- The third mocked Automatic run passed checkpoint persistence but the fixture
  answered with historical tool name `submit_arrangement_plan`; the current
  arrangement contract requires `set_design_plan`. Correct the disposable mock
  and restart with clean state.
- Clean browser acceptance passed with zero console errors: three recovered
  tracks loaded selected, one was deselected, Automatic Specialist Team used
  exactly the remaining two, completed, exposed the MP3 download, and populated
  history. The final audio route was mocked at the browser transport boundary.
- Browser acceptance also exposed and fixed two release defects: Strict Mode
  could erase initial track selection because refs were mutated inside a state
  updater; Vite middleware could connect to a stray port 24678 because it was
  not sharing the Express HTTP server. Focused regressions and a clean browser
  rerun now pass.
- Focused recovery/security suites, full `npm test`, `npm run test:e2e`, explicit
  78-request payload audit, Phase 34 security tests, `npm run lint`, and
  `git diff --check` passed. Provider behavior remained fully mocked.
- A disposable 172-file repository copy contained no `library/`, `workdir/`,
  `.env*`, or `dist/`; `npm ci`, `npm run build`, and isolated
  `npm run test:production-start` passed on loopback port 31410.
- The secret gate found no credential value in the proposed diff, isolated
  build, final browser capture, or protected text logs/audits. The intentional
  redaction-test canary remained test-only; a minified `pageToken` assignment
  was classified as a false positive. `.env` and `.env.local` are ignored and
  untracked; only `.env.example` is tracked.
- Final protected-data comparison passed: all 489 stable files match their
  baseline SHA-256 values, and the complete 491-path inventory has no added or
  missing path. The eight index-only removals still exist locally with their
  original bytes.
- **Release handoff blocker (2026-07-12):** a repeat protected-data comparison
  after the final gate found two stable library source MP3s different from the
  original baseline. Each is 521 bytes larger and has a July 12 modification
  time. Only path/length/timestamp metadata was inspected; no source-audio
  contents were opened, restored, copied, deleted, staged, or committed. No AI
  Medley server process was running at the time of inspection. Do not proceed
  with commit/push/PR until the user directs preservation or recovery.
- Read-only follow-up: neither affected UUID-named MP3 is tracked by Git or has
  Git history, both remain parseable as MP3, and the additional 521 bytes are
  not a standard ID3/TAG suffix. An exact-name whole-`G:` duplicate search was
  bounded and stopped without a result before it could become an unbounded disk
  operation. No source bytes changed during investigation.
- Under the user's instruction to use the recommended path, current source
  bytes are preserved in place and explicitly excluded from the code-only
  handoff. A focused Documents/OneDrive/other-`G:\\ai-medley*` exact-name
  search found no backup duplicate. The integrity exception remains documented
  as a follow-up risk rather than being hidden by an altered baseline.
- Code-only release handoff completed: commit `af7a16c` (`fix: harden medley
  workflow handoff`) was pushed to `origin/payload-optimization`, and PR #1 was
  opened against `master`. The Git index contains no source-audio addition; the
  protected-data integrity exception remains local, documented, and untouched.
- Chrome inspection of the current app confirmed the candidate error is real,
  not stale UI. The `bknfa639` sidecar shows strict validation rejected only
  `_resolvedFromExitSec` and `_resolvedToEntrySec` during interrupted manifest
  recovery. Patched recovery to sanitize those known internal-only fields before
  strict validation; added exact regression coverage. `candidateStore` tests,
  TypeScript, and `git diff --check` pass. The real candidate/manifests were not
  retried, rerendered, or changed.
- The server restart loaded the scratch-field fix; the preserved error then
  changed to an execution-version mismatch (candidate version 4 versus resumed
  checkpoint version 6). Read-only transition comparison proved both describe
  the same candidate audio. Added a narrow compatibility rule and tests so an
  older candidate can recover only when every audio-affecting transition fact
  matches; no real candidate, checkpoint, manifest, or provider request was
  changed during diagnosis.
- Diagnosed the later correction-limit stop: candidate `candidate-001` is 493.6
  seconds against a 240-second target, so its quality gate correctly requested a
  shorter timeline. Production repeated the impossible request three times
  because the locked arrangement controls section boundaries. Added a
  deterministic arrangement-duration estimate and target-tolerance rejection
  before production/rendering; focused schema, transition, candidate recovery,
  lint, and diff checks pass. The browser Vite WebSocket warning is a dev
  auto-refresh retry during restart, not a render failure.
- Added compact shortest-timeline planning support: arrangement payloads now
  include each pair's best-score and earliest-exit authoritative choice, and
  state the exact-copy/target requirement. Target tolerance is 10%; focused
  schema, quality-gate, specialist-payload, and 78-request payload audits pass
  (largest request 12,186 bytes / 4,056 estimated tokens).

# 2026-07-13 — Local arrangement fallback in progress

- Focused mocked checks pass for the deterministic arrangement builder, payload
  audit, TypeScript, and whitespace validation. No provider call, source-audio
  write, candidate recovery, or render was performed.
- Found and fixed one safety follow-up: an explicit user abort now bypasses the
  fallback. Adding a mocked workflow regression for provider failure next.

- Complete: the mocked workflow now returns a 504 from the arrangement
  provider, proves the locally validated plan is saved, and halts before any
  production/render request. A separate cancellation regression proves no
  fallback plan is saved after the user cancels.
- Verification passed: `npm test`, `npm run lint`, `git diff --check`, and the
  78-request payload audit. All provider behavior was mocked and test files
  used temporary storage only.
- Added and verified resumed-session handling: an invalid saved arrangement is
  replaced by the local plan without calling a provider, then checkpointed
  before production. The complete mocked suite passed again afterward.

# 2026-07-13 — Cross-drive upload fix in progress

- Reproduced the reported failure from its exact `EXDEV` message and replaced
  the unsafe cross-drive rename with a narrowly scoped copy-then-remove
  fallback. The regression is simulated with a fake filesystem; no actual
  library audio was created, removed, or rewritten during verification.
- Complete: simulated EXDEV, failed-copy cleanup, the full test suite,
  TypeScript, and whitespace validation all pass. The production change is
  ready to restart and retry with the user's original audio file.

# 2026-07-13 — Context tool-call fallback in progress

- Added a local project-brief fallback for a provider response with no
  `submit_project_brief` call. The focused regression uses a mocked plain-text
  provider response and proves the validated local brief is saved before the
  workflow advances. No provider request, render, or protected data was used.
- Complete: full mocked suite, TypeScript, and whitespace checks pass.

# Master Plan Phase 0 — In progress

- Classified the workspace as clean before the master-plan task. Captured a
  protected-data SHA-256 baseline outside the repository and audited ignore
  rules, tracked protected paths, npm scripts, provider references, and test
  temporary-root usage. Baseline test and disposable production checks remain.
- Complete: protected-data post-check matches the baseline exactly. Full mocked
  tests, lint, end-to-end test, release contract, and disposable production
  build/smoke passed. No live provider call or protected-data mutation occurred.

# Master Plan Phase 1 — In progress

- Added isolated v4 workflow schemas and a focused schema regression script.
  The current v3 runtime remains unchanged by design until the compatibility
  phase; focused schema test and TypeScript passed.
- Complete: focused schema test, full mocked suite, TypeScript, and whitespace
  checks passed. No existing session files were read or rewritten.

# 2026-07-14 — Candidate Review Experience complete

- Added the authoritative review projection, integrity-gated candidate range
  endpoint, reviewable-session recovery, accessible shared-player Candidate
  Review UI, append-only human approval, honest completion labels, and final
  playback/download/path presentation.
- Added server-owned correction policy v1, exact one-transition correction
  validation, plan hashes, duplicate-render rejection, three-candidate limit,
  and no-op rejected-candidate cleanup so prior drafts remain preserved.
- Added FFmpeg full-decode verification before final transaction projections or
  completion. Failure injection proves a promoted but undecodable file remains
  recoverable without history/wisdom updates or checkpoint deletion.
- Browser acceptance passed against an isolated two-draft fixture: both drafts
  displayed with review evidence and local paths, A/B switching changed the
  shared player, Draft 2 finalized, restart restored both drafts and the verified
  final, and browser error logs were empty.
- Root `npm test` passed every code/mocked/payload test, then reached the
  then-known release-contract mismatch while user-edited `AGENTS.md` was being
  preserved outside that implementation scope. The 2026-07-15 aligned contract
  now passes.
  The exact complete suite passed in a disposable repository copy using the
  committed guide: `npm run test:full`, including release contract, synthetic
  FFmpeg render/correction/finalization, and only current OpenRouter `:free`
  live checks.
- `npm run lint`, `git diff --check`, isolated `npm run build`, and isolated
  `npm run test:production-start` passed. Production smoke owned port 37711.
- A release-copy setup command initially ran `npm ci` in the workspace and
  partially removed ignored `node_modules` before Windows returned `EPERM`.
  No source or protected artifact was involved. Dependencies were restored from
  the verified disposable install, and workspace TypeScript passed afterward.
- Secret scan found zero configured-key or generic credential hits in the scoped
  diff and zero configured-key hits in isolated `dist`; no environment file is
  tracked. The real repository `dist/` was never built or changed.
- Final source review removed the last Automatic SSE shortcut that could set
  `completed` directly from an event snapshot. Completion and manual-review
  events now refresh authoritative final integrity; focused regression, SSE,
  TypeScript, whitespace, and the isolated complete mocked suite pass.
- A second isolated browser check proved that a restored verified final opens on
  startup, clicking New session returns to upload, and checkpoint refresh does
  not reopen the old final after 1.5 seconds. Browser errors remained empty.
