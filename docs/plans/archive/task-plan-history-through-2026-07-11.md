# Archived Task Plan History Through 2026-07-11

This file is historical evidence, not the active plan. The current Git state
and release proposal are documented in the root `task_plan.md`. Statements
below describe the state when written unless a later note supersedes them.

## End-to-end medley workflow audit — 2026-07-11

Status: complete

Goal: trace and verify the live library-upload-to-final-promotion workflow across
React state, configuration, selection, local analysis, both orchestration modes,
provider fallback/corrections, SSE/checkpoints/resume, FFmpeg rendering,
candidate registration/review, finalization, history, and wisdom. Preserve all
protected data and unrelated worktree changes; use only mocked provider behavior.

Plan:

1. Baseline the dirty worktree and map actual client/server/runtime entry points.
2. Audit state and data boundaries, then reproduce confirmed failures with
   focused tests or isolated temporary fixtures outside protected stores.
3. Apply the smallest safe fixes for confirmed in-scope issues and document the
   evidence, affected functions, and failure path.
4. Run focused checks, `npm test`, `npm run lint`, `git diff --check`, and any
   controlled build/runtime checks needed; restore pre-existing `dist/` exactly
   if a build changes it.
5. Record prioritized findings, changed files, verification, and residual risks.

Result: complete. Confirmed and fixed selected-track authority loss, a
post-promotion false-failure request, ineffective manual tool-failure streaks,
SSE snapshot/replay gaps, interrupted candidate-registration recovery, final
overwrite risk, implicit rejected-candidate cleanup, and incomplete wisdom
track attribution. The pre-existing strict transition sanitizer was audited and
verified. Full offline tests, TypeScript, diff checks, controlled build/start,
exact `dist/` restoration, and an isolated real-FFmpeg upload-to-final route
smoke all pass. No provider call or protected-data mutation was performed.

Errors recorded:

- Initial combined inventory command returned exit 1 after producing its useful
  output because `rg --files` was also given nonexistent `test/` and `tests/`
  directories. Future inventory searches will use existing paths only.
- The first combined targeted-check command exposed one SSE test assertion that
  assumed a reconnected source already had a heartbeat timer before receiving
  its first event. The implementation correctly created the timer on that
  event; the test was corrected to verify one timer is created and replaced,
  not duplicated. The other targeted tests and TypeScript check passed.
- The first full verification pass completed all tests, then TypeScript found a
  local inference issue where filtered request IDs remained `unknown[]`. Added
  an explicit `string[]` boundary after the runtime type guard; rerun the
  required checks rather than repeating the unchanged failing command.
- The first isolated synthetic runtime attempt expected one curl multipart
  request to register three files, but that client invocation produced one
  library entry. The owned temporary server/root were stopped and removed.
  Retry with three independent uploads to exercise the same server route
  without relying on curl's multipart batching behavior.

## Candidate manifest timing-field fix — 2026-07-11

Status: complete

Goal: prevent render-time `_resolvedFromExitSec` and `_resolvedToEntrySec`
scratch fields from being persisted into strict candidate manifests.

Result: added an explicit manifest-boundary sanitizer that removes only those
two private fields and validates the remaining record as a `ResolvedTransition`.
The candidate renderer now uses that sanitizer before registration. A regression
test reproduces the exact private-field shape and proves both fields are absent
from the persisted transition. `npm test`, `npm run lint`, and diff checks pass;
the updated local dev server is running.

## Responsive layout polish — 2026-07-10

Status: complete

Goal: eliminate the need to zoom out, especially in Configuration, and make the
desktop workspace feel like a deliberate, bounded audio-production surface.

Result: Configuration now uses a fixed header/footer and independently scrolls
only its content. Common styles occupy a compact three-column desktop row; the
Apply button remains visible at all times. The app root uses a bounded desktop
viewport, the workspace has an explicit minimum-height flex layout, and the
library/footer panels have clearer visual separation. Browser checks at
1440×900 and 1366×768 confirmed the dialog and Apply button remain inside the
viewport. `npm test` and `npm run lint` pass.

## Library recovery and per-mix selection — 2026-07-10

Status: complete

Goal: recover valid audio that remains in the protected library folder after
its active JSON index was emptied, without touching backup evidence or source
audio. Add a visible per-mix selection layer so a run uses only checked tracks.

Plan:

1. Add a non-destructive recovery route that registers only existing orphaned
   audio files and reports its result.
2. Verify recovery with an isolated store test, then recover the three detected
   MP3s through the local route.
3. Add sidebar selection checkboxes, select-all controls, and a clear selected
   count; default newly loaded tracks to selected.
4. Pass only selected tracks into pre-analysis/design/run startup and require
   at least two selected tracks.

Result: complete. The isolated recovery test passed, then the local recovery
route registered the three existing orphaned MP3s. The route added metadata only
and did not modify source-audio bytes or historical backup files. The sidebar
now has checkboxes, selected/total count, select-all/clear controls, and sends
only selected tracks into a run. Full test and TypeScript verification pass.

## Configuration decluttering — 2026-07-10

Status: complete

Goal: make the default Configuration view match the personal app's normal
workflow: automatic Gemini-through-OpenRouter mixing, local analysis, a common
style, duration, and crossfade.

Result: the initial screen now shows the automatic model summary, connection
state, local-analysis state, three common style choices, and mix timing. Manual
provider/model selection, cloud-analysis choices, uncommon styles, and the
manual workflow selector are retained under an accessible Advanced controls
disclosure, which opens automatically if an existing advanced setting is active.
`npm test` and `npm run lint` pass.

## OpenRouter connection preflight — 2026-07-10

Status: complete

Goal: add an explicit, user-triggered server-managed OpenRouter check using
`google/gemini-2.5-flash`, a minimal bounded request, and actionable status in
the configuration dialog. Verify success and provider failure categories using
mocked upstream responses only; do not make a live provider call during
implementation.

Plan:

1. Add a testable server-side preflight helper with a hard 8-token output cap.
2. Expose it only through a local same-origin API route that never returns the credential.
3. Add an accessible Configuration-panel control and clear success/error state.
4. Add mocked success, 401, 402, and 429 coverage; run the full offline suite.

Result: complete. The check is server-managed only, uses a single
`google/gemini-2.5-flash` request capped at 8 output tokens, and reports
credential, credit, rate-limit, model, and temporary-service failures without
returning credentials. `npm test` and `npm run lint` pass without a live call.

## Current stabilization continuation — 2026-07-04

Status: Implementation Phases 0–11 complete

- Preserve all protected project data and the documented payload-audit incident.
- Complete Phase 6 from its first unfinished item: mocked provider history/error policy, config discrimination, semantic authority, shared budgets, and versioned manual contracts.
- Run the required full verification and protected fingerprint comparison.
- Continue through later audit phases only while changes remain isolated and safe.

Phase 6 result: complete. Full tests/lint/build/diff checks passed and all protected fingerprints were unchanged.

Phase 7 result: complete. Security tests/lint/build/diff checks passed and all protected fingerprints were unchanged.

Phase 8 result: complete. Inventory/resource tests/lint/build/diff checks passed; no artifact was selected or mutated and all protected fingerprints were unchanged.

Phase 9 result: complete. An approved G:-only clean install exposed and fixed the payload-audit test's dependency on `library/db.json`; disposable install/test/lint/build/start and main-tree verification pass with protected hashes unchanged.

Phase 10 result: semantic/keyboard UI implementation and static contracts pass, but the phase remains incomplete because no in-app browser instance or preinstalled Chrome DevTools/Playwright CLI is available for the required runtime accessibility matrix. Stop before installing a harness; Phase 11 remains unstarted.

Phase 10 runtime continuation: approved disposable G:-only harness installed. First matrix passed 43/47 checks. Fix the measured contrast/tap-target/upload-progress failures, rerun the same matrix, then perform full phase verification.

Phase 10 final result: complete. Playwright/axe passed 47/47, isolated Lighthouse scored 1.00, full project checks passed, and protected hashes were unchanged. Begin Phase 11 with evidence-only dependency removal and executable documentation alignment.

Phase 11 final result: complete. Three proven-dead declarations were removed; current operations and exact route documentation are contract-tested; G:-only clean install/test/lint/build/start and offline audit pass; protected data and environment files are unchanged. No implementation phase remains.

Errors recorded:

- Expected red test: `providerRequest.test.ts` failed because the new shared budget/error exports do not exist yet. Next action is implementing those contracts, not rerunning unchanged code.
- First integration type check found only local typing issues: an inferred `Map<unknown, unknown>`, test fixture optional-field inference, and the intentional v2 migration fixture conflicting with the new v3 type. Fix these type declarations directly.
- A combined Phase 7 `rg` inspection command returned exit 1 without output because its PowerShell quoting/pattern composition was invalid. Split the searches into simpler commands instead of repeating it.
- One `apply_patch` hunk for `trackPathMap` missed because the local loop used `forEach` rather than the assumed `for...of`; inspected the exact lines and applied the canonical-path change to the actual structure.
- The first Phase 7 type check found a local import-name collision for two `sha256File` helpers and a Multer callback overload mismatch. Alias the upload hash helper and use the callback's explicit success/error overloads.
- Phase 9 production smoke failed as expected from F-023: `dist/server.cjs` contained ESM imports and Node rejected it as CommonJS. The controlled build restored `dist`; fix the build with explicit `--format=cjs` and rerun the owned smoke.
- The format fix exposed the second packaging gap: esbuild had not bundled local `src/` modules, so production could not resolve them from `dist`. `dist` was restored again; add explicit `--bundle` while keeping npm packages external.
- The third production smoke showed bundled CJS cannot support the analyzer's legitimate `import.meta.url`/`createRequire` path. `dist` was restored. Broader correction: align with the package's ESM mode and emit bundled `dist/server.js` instead of continuing CJS patches.
- The first Phase 10 harness directory command used a not-yet-created directory as its working directory and failed before executing; created all G: paths from the main workspace, then ran npm commands from the new harness.
- A combined PowerShell `rg` command for API calls had invalid quoting; split source inspection and simpler `rg -e` searches.
- The first runtime accessibility matrix intentionally failed 4/47 checks: two axe contrast checks, the 44px target check, and pending-upload progress exposure. Apply targeted UI fixes before rerunning.
- Lighthouse's first launch generated a report but cleanup failed with EPERM and the audit renderers were parented to the existing personal Chrome singleton. Never repeat without an explicit disposable G: `--user-data-dir`; do not terminate the user's Chrome process.
- The explicit G:-profile Lighthouse rerun produced a complete 1.00 accessibility report with zero failed audits, but the CLI again exited 1 solely on G: temp-directory cleanup (`EPERM`). Preserve the report and temp evidence; do not repeat the same cleanup failure.
- Phase 10 server shutdown raced after the child had already exited, producing a benign `Stop-Process` not-found message; the owned port was confirmed closed and no unrelated process was targeted.
- The Phase 11 release contract initially failed because the new authoritative docs did not exist, then passed after those docs were added.

## Goal

Add configuration settings in the app so Logan can:

- enter a Gemini API key in the app UI
- switch the AI provider to OpenRouter
- enter an OpenRouter API key in the app UI
- run the medley workflow with the selected provider where technically supported

## Historical status at that milestone

Status: deep local audio analysis implemented and verified

## Proposed Approach

### Phase 1: Config Shape and Persistence

Status: complete

- Extend `MedleyConfig` with provider selection and provider-specific API keys.
- Persist config locally in the browser so keys survive refreshes on Logan's machine.
- Keep `.env` fallback support for existing Gemini behavior.
- Avoid writing API keys to project files or logs.

### Phase 2: Settings UI

Status: complete

- Add a provider switch in `src/components/ConfigPanel.tsx`.
- Show Gemini API key input when Gemini is selected.
- Show OpenRouter API key input and OpenRouter model input/presets when OpenRouter is selected.
- Keep the current medley controls intact.

### Phase 3: Provider Runtime Adapter

Status: complete

- Keep Gemini using the existing `@google/genai` workflow.
- Add an OpenRouter chat-completions adapter for text/tool-call messages.
- Convert the app's existing tool declarations into OpenRouter/OpenAI-compatible tool schemas.
- Support OpenRouter audio analysis by sending base64 `input_audio` content for compatible OpenRouter models.

### Phase 4: Wiring and Verification

Status: complete

- Update `src/App.tsx` so key validation and model calls use the selected provider.
- Update visible provider labels that currently hard-code Gemini where relevant.
- Run TypeScript lint/build checks.
- Start or reuse the local app server and verify the page loads.

## Implemented Decisions

- The app now stores provider settings in browser local storage and falls back to `/api/config` environment values when local keys are absent.
- Gemini remains on the direct `@google/genai` path.
- OpenRouter uses a fetch-based adapter against the OpenRouter chat completions API.
- Audio analysis for both providers now returns analysis text to the autonomous loop instead of attaching provider-specific media parts into the main chat session.

## Risks and Constraints

- Historical note: this directory was not a Git repository at that time. Git
  was initialized later; the current repository root is `G:/ai-medley--main`.
- OpenRouter audio support depends on selecting an OpenRouter model that supports audio input.
- OpenRouter does not use Gemini's file upload/cache API, so Gemini cached file URIs are no longer part of the active runtime path.
- API keys entered in the browser will be stored locally if persistence is approved; that is convenient but less secure than server-side secret storage.
- Cloud audio analysis can be expensive because it sends full audio files. New work should default to local analysis and avoid sending raw audio unless explicitly enabled.

## Proposed Cost-Control Redesign

### Phase 5: Local-First Analysis

Status: complete

- Add a server-side local analysis endpoint that uses the bundled FFmpeg only.
- Extract local facts: duration, bitrate, sample rate, loudness/volume stats, silence regions, waveform peaks, energy curve, and likely high-energy candidate sections.
- Store the local analysis in the library database.
- Do not send raw song audio to Gemini/OpenRouter during normal pre-analysis.

### Phase 6: Minimal AI Payloads

Status: complete

- Change the main model prompt so the API receives compact text/JSON summaries, not audio blobs.
- Keep local file paths available so the model can still build FFmpeg commands locally.
- Use the API for planning/reasoning only: ordering, transition strategy, section choice, and command generation.

### Phase 7: Explicit Cloud Audio Mode

Status: complete

- Add an analysis mode setting:
  - `Local only` as the default.
  - `Ask before cloud audio` for one-off cases where Logan wants a deeper model listen.
  - `Cloud audio allowed` for the current full-audio behavior.
- Make `listen_to_audio` return local analysis by default.
- Only send audio to Gemini/OpenRouter if the configured mode allows it.

## Cost-Control Implementation Summary

- Default analysis mode is now `Local Only`.
- Full audio uploads to Gemini/OpenRouter are blocked unless Logan chooses `Ask First` and confirms, or chooses `Cloud Allowed`.
- Local analysis uses FFmpeg plus `music-tempo` and stores compact analysis text in the library.
- The model receives text summaries and local file paths, not raw songs, during normal operation.

## Errors Encountered

| Error                                                           | Attempt                                                   | Resolution                                                                                                            |
| --------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `fatal: not a git repository`                                   | Historical check before Git initialization                | Superseded: Git now exists at `G:/ai-medley--main`; see the active root plan                                            |
| Final medley could not be analyzed by `listen_to_audio`         | Reviewed tool handler and server audio routes             | Added `/api/audio-file` for generated/session audio paths and updated the tool handler to use it                      |
| Completed session audio could disappear after finish            | Reviewed `/api/session/finish`                            | Stopped deleting the session work directory immediately after saving the final audio path                             |
| Browser `AbortError` from interrupted `audio.play()`            | Reviewed library preview playback                         | Added a catch for interrupted play promises                                                                           |
| Vite websocket retries on `localhost:24678`                     | Reviewed custom Express/Vite setup                        | Disabled Vite HMR for this custom server to remove stale websocket retries                                            |
| PowerShell `Add-Content` failed while updating progress         | Used nested quotes and backticks in one command           | Retried with a literal here-string and updated `progress.md`                                                          |
| React component key typing error in `MedleyMatchPanel`          | Ran `npm run lint` after adding UI panel                  | Removed `key` from component props and let React handle it at call sites                                              |
| Existing analyzed tracks could skip new intelligence generation | Reviewed `preAnalyzeLibrary` after adding design endpoint | Re-analysis now triggers when `localAnalysis` or `medleyIntelligence` is missing, even if old plain `analysis` exists |

## Export Download Fix

Status: complete

- Diagnose why Export Output can return or download JSON instead of an MP3.
- Add a dedicated MP3 download route with attachment headers.
- Update the UI export button to fetch the MP3, reject JSON/error responses, and save a real audio file.
- Verify lint/build and, if possible, the local export route.

## Proposed Medley Intelligence Upgrade

Status: complete

Goal: Upgrade song and section selection from "basic local facts plus prompt guidance" into an explicit scoring engine that finds the best medley ingredients: song order, excerpt choices, transitions, finale, emotional shape, and alternate order tradeoffs.

### Phase 8: Local Feature Expansion

Status: complete

- Extend `/api/audio-analysis/local` so each track gets richer local features without cloud upload.
- Add structured fields for intro, outro, low-energy reset zones, high-energy zones, likely hook candidates, transition entry/exit candidates, onset density, rough sonic density, brightness/tonal-balance proxy, and local confidence.
- Keep arrays compact so the AI receives summaries, not large waveform data.
- Keep key, lyric meaning, and subjective mood marked unknown unless supplied by metadata/user notes/cloud clips.

### Phase 9: Medley Match Scoring Engine

Status: complete

- Add a local scoring module that scores every track and candidate section before the AI makes final decisions.
- Score:
  - hook strength
  - entry quality
  - exit quality
  - transition usability
  - energy role
  - contrast value
  - finale potential
  - tempo compatibility
  - confidence
- Generate pairwise transition scores for every candidate song-to-song pairing.
- Produce ranked song orders locally: smoothest, strongest emotional arc, highest intensity, and surprise/contrast order.

### Phase 10: Medley Design Schema

Status: complete

- Create a structured medley design JSON that becomes the main planning artifact.
- Include `trackProfiles`, `sectionCandidates`, `transitionScores`, `recommendedOrders`, `warnings`, and `confidence`.
- The AI should reason over this structured data instead of loosely reading plain analysis text.

### Phase 11: AI Prompt Upgrade

Status: complete

- Rewrite the system prompt so the model must use the local scoring output.
- Require it to choose from candidate sections or explain why it overrides them.
- Require 2-3 alternate orders with tradeoffs.
- Require a final medley plan with exact timestamps, role of each section, transition type, and confidence.
- Add strict rules: do not invent key, lyrics, or emotional meaning without evidence.

### Phase 12: UI Visibility

Status: complete

- Add a "Medley Match" view or sidebar section that shows why songs were selected.
- Show top candidate sections per song.
- Show transition-pair scores.
- Show recommended order options before/while building.
- Show warnings such as "key unknown", "tempo confidence low", or "lyrics unavailable".

### Phase 13: Tests and Verification

Status: complete

- Add focused tests for scoring math, order ranking, compact payload construction, prompt requirements, local-only behavior, and final export path preservation.
- Verify with `npm run lint`, `npm run build`, and bounded `npm run dev`.

## Approval Gate

Logan provided follow-up instruction file approval to implement immediately. Phases 8-13 were completed.

## Medley Intelligence Implementation Summary

- Added a local `medley_design_v1` intelligence layer that separates local audio facts, heuristic musical guesses, scoring/ranking, and AI medley reasoning.
- Added track profiles, section candidates, hook/entry/exit/reset/finale section scores, pairwise transition scores, and multiple ranked order strategies.
- Added `/api/medley-intelligence/design` so the app can build compact AI planning payloads from local analysis.
- Updated the autonomous prompt to reason over compact structured JSON and avoid inventing key, lyrics, or song meaning.
- Updated the UI with a Medley Match panel showing candidate sections, transition scores, strategy options, and warnings.
- Updated pre-analysis and `listen_to_audio` so local analysis runs first even when optional cloud audio analysis is enabled.
- Added focused no-API tests for scoring, payload construction, and AI-plan validation.

## Proposed Deep Local Audio Analysis Upgrade

Status: complete

Goal: Replace the current rough local proxies with stronger on-computer music analysis so the app can make better medley decisions without sending full songs to Gemini/OpenRouter.

Core principle: anything measurable locally should be measured locally. The AI should receive compact summaries, not raw audio, unless Logan explicitly enables cloud audio.

### Phase 14: Toolchain Decision and Dependency Gate

Status: complete

- Compare local options and choose the smallest reliable stack.
- Preferred implementation path:
  - Keep FFmpeg as the decode/extraction backbone.
  - Add Essentia.js for Node-side spectral, tonal, rhythm, onset, and descriptor analysis if it installs cleanly.
  - Keep `music-tempo` as a fallback BPM estimator.
  - Use a Python/librosa fallback only if Essentia.js cannot deliver the needed features reliably in this app.
- Before downloading new packages, ask Logan for approval for the network download step.
- After packages are present, installation/configuration can proceed under the standing permission rules.

### Phase 15: Analysis Schema V2

Status: complete

- Add a versioned local analysis schema, likely `localAnalysisV2`, without breaking existing `localAnalysis`.
- Add structured fields:
  - `beatGrid`: beat timestamps, downbeat/bar-confidence proxy, tempo segments, tempo confidence.
  - `onsets`: transient timestamps, local density by window, strong hit markers.
  - `spectral`: centroid, bandwidth, rolloff, flatness, brightness, spectral flux, per-section averages.
  - `tonal`: chroma vector, estimated key, key confidence, harmonic compatibility notes.
  - `loudness`: integrated loudness proxy, short-term loudness windows, peak/RMS by segment.
  - `segments`: intro/verse-like/chorus-like/breakdown/outro candidates as heuristic labels, with confidence.
  - `quality`: clipping risk, silence boundaries, noisy/low-confidence warnings.
- Every field must identify whether it is:
  - measured fact
  - statistical descriptor
  - heuristic guess
  - unavailable
- Keep arrays compact by storing summaries and top candidates, not huge frame-by-frame data.

### Phase 16: Local Analyzer Engine

Status: complete

- Refactor local analysis out of `server.ts` into a dedicated module, likely `src/engine/localAudioAnalysis.ts` or `src/server/localAudioAnalysis.ts`.
- Pipeline:
  1. Decode input audio to normalized mono PCM with FFmpeg.
  2. Run existing FFmpeg stats and silence detection.
  3. Run beat/BPM/onset/spectral/tonal analysis through the selected local library.
  4. Aggregate raw frame data into compact windows.
  5. Generate section candidates from beat-aware boundaries, energy changes, onsets, silence, and spectral/tonal stability.
  6. Return `localAnalysisV2` plus a concise human-readable summary.
- Add caching so unchanged files are not re-analyzed every run.
- Include file hash, analyzer version, dependency versions, and timestamp in the cached result.

### Phase 17: Beat-Aware Section Detection

Status: complete

- Improve section boundaries from arbitrary time windows to musically useful points.
- Use beat grid and onset markers to snap candidate starts/ends to nearby beats.
- Generate candidates:
  - clean intro start
  - first strong entrance
  - likely chorus/hook section
  - breakdown/reset
  - pre-finale build
  - strongest finale section
  - clean outro/exit
- Avoid calling something "chorus" as a fact. Use labels like `chorus_like_candidate` unless verified by lyrics/user notes.
- Add confidence and reasons for each section label.

### Phase 18: Key and Harmonic Compatibility

Status: complete

- Add local chroma/key estimation.
- Store key as an estimate, never as guaranteed truth.
- Score transitions by:
  - same/near key estimate
  - compatible relative major/minor relationship
  - strong confidence versus weak confidence
  - tonal instability or noise warnings
- Let the medley scorer use harmonic compatibility when confidence is good and ignore it when confidence is weak.

### Phase 19: Upgrade Medley Intelligence Scoring

Status: complete

- Feed `localAnalysisV2` into `src/engine/medleyIntelligence.ts`.
- Replace current rough proxies where better local facts exist:
  - brightness proxy -> spectral centroid/rolloff descriptors
  - density proxy -> onset density + spectral flux + RMS density
  - onset proxy -> real onset/transient markers
  - tempo estimate -> beat grid + tempo confidence
  - transition timing -> beat-snapped candidate entry/exit points
  - harmonic risk -> chroma/key compatibility
- Add new scores:
  - beat alignment score
  - downbeat cut confidence
  - harmonic compatibility score
  - spectral contrast score
  - groove continuity score
  - transition shock/risk score
  - hook repetition/strength proxy
- Preserve the four-layer separation: facts, guesses, scores, AI reasoning.

### Phase 20: UI Upgrade for Local Analysis Confidence

Status: complete

- Extend the Medley Match panel or add an Analysis Details view.
- Show:
  - BPM and beat confidence
  - estimated key and confidence
  - top beat-snapped section candidates
  - strongest hooks/finales/resets
  - why a transition scored well or poorly
  - warnings such as "key low confidence" or "beat grid unstable"
- Keep it practical: show the best few candidates and warnings, not every raw datapoint.

### Phase 21: Cost-Control and AI Payload Guardrails

Status: complete

- Ensure no full audio is sent through API during local analysis.
- Keep AI payload compact:
  - top section candidates
  - summary descriptors
  - transition scores
  - confidence/warning fields
- Add payload size checks or logging so the app does not accidentally send oversized analysis JSON.
- Keep optional cloud audio mode separate and explicit.

### Phase 22: Tests and Verification

Status: complete

- Add unit tests for:
  - schema generation
  - compact payload limits
  - beat snapping
  - section candidate ranking
  - harmonic compatibility scoring
  - confidence/warning behavior
  - fallback behavior when advanced analyzer fails
- Add route tests or script checks for `/api/audio-analysis/local`.
- Run:
  - `npm test`
  - `npm run lint`
  - `npm run build`
  - bounded `npm run dev`
  - `/api/health`
  - local analysis on at least one existing library track
  - medley design endpoint after V2 analysis

### Phase 23: Fallback and Failure Handling

Status: complete

- If advanced local analysis fails on a file, keep the existing FFmpeg/music-tempo analyzer working.
- Return warnings instead of crashing the medley workflow.
- Store partial analysis with `advancedAnalysisAvailable: false`.
- Keep old library entries compatible.
- Add logs that explain whether the app used V2 advanced analysis or the fallback analyzer.

## Deep Local Audio Analysis Approval Gate

Logan approved this plan on 2026-05-21. Phases 14-23 were completed.

## Deep Local Audio Analysis Implementation Summary

- Installed `essentia.js` and added it as an optional local MIR engine.
- Added `src/engine/localAudioAnalysis.ts` with `local_audio_analysis_v2`.
- Added local V2 fields for beat grid, beat confidence, onsets, onset density, spectral centroid/rolloff/flatness/flux, chroma/key estimate, loudness windows, beat-snapped segments, and quality warnings.
- Kept analysis fully local; no Gemini/OpenRouter audio request is used for V2 analysis.
- Kept fallback behavior: FFmpeg + internal DSP + `music-tempo` continue to produce analysis even if Essentia algorithms fail.
- Updated Medley Intelligence scoring to use beat alignment, downbeat confidence, harmonic compatibility, spectral contrast, groove continuity, and transition shock/risk where available.
- Updated Medley Match UI to show local BPM/key confidence, advanced analysis coverage, beat-safe sections, and beat/key transition scores.
- Added local-only analyzer test coverage.
- Verified with `npm test`, `npm run lint`, `npm run build`, bounded `npm run dev`, `/api/health`, `/`, `/api/audio-analysis/local`, and `/api/medley-intelligence/design`.

## Three-Model Specialist Workflow

Status: complete

Goal: Replace automatic single-model runs with a validated specialist workflow while preserving the existing manual-model workflow.

### Phase 24: Contracts, Configuration, and Provider Control

Status: complete

- Add Zod 4 strict schemas for specialist handoffs, execution reports, reviews, candidates, and manifests.
- Add automatic/manual model mode and preserve the existing selected model for manual runs.
- Route automatic work only through Nemotron Super, Nemotron Ultra, and Nex-N2-Pro.
- Add abortable provider sends, request IDs, timeouts, stale-response protection, and complete-request payload limits.

### Phase 25: Candidate Rendering and Persistence

Status: complete

- Add atomic server-side candidate manifests and immutable candidate/debug files.
- Add server-side session locks, candidate limits, storage checks, SHA-256 verification, and safe path handling.
- Add `submit_execution_report`, `render_review_candidate`, and `submit_quality_review` stage boundaries.

### Phase 26: Exact Candidate Finalization and Cleanup

Status: complete

- Change finalization to promote the exact reviewed candidate without FFmpeg re-rendering.
- Add deterministic candidate selection and idempotent finalization.
- Add atomic session discard and registered-file cleanup while preserving source audio and completed outputs.

### Phase 27: Specialist Orchestration and UI

Status: complete

- Add the explicit specialist state machine and role-specific prompts/tools.
- Add seven-stage progress, active specialist, candidate, repair, fallback, correction, and warning visibility.
- Preserve version-2 checkpoints through the legacy manual workflow and add version-3 automatic checkpoints.

### Phase 28: Verification

Status: complete

- Add direct TypeScript tests using `node:assert/strict`.
- Run tests, type-check, build, server health checks, candidate lifecycle checks, and manual-mode compatibility checks.

## Three-Model Specialist Workflow Decisions

- Existing saved configurations migrate to automatic OpenRouter mode while preserving both API keys and the saved manual model.
- Automatic mode is blocked before local analysis when no OpenRouter key is configured.
- Automatic fallback models are limited to the three approved specialist models.
- A model gets one structured-output repair attempt before role-specific fallback.
- At most three complete candidates are retained: initial plus two corrections.
- The exact reviewed candidate is promoted byte-for-byte using SHA-256 and byte-size verification.
- Zod 4 is the only new dependency.

## Three-Model Specialist Workflow Implementation Summary

- Added strict shared Zod contracts, contextual validation, exact repair messages, role routing, bounded fallback, request timeouts, cancellation, request sequencing, and complete-request payload limits.
- Added automatic/manual config migration. Automatic mode uses only Nemotron 3 Super, Nemotron 3 Ultra, and Nex-N2-Pro. Manual mode retains every existing model and custom OpenRouter entries.
- Added version-3 automatic checkpoints with atomic writes, stale-write rejection, validated resume state, and legacy version-2 manual resume.
- Added authoritative server execution records so reports cannot claim transitions or files that the server did not produce.
- Added immutable candidate manifests, three-candidate limit, disk checks, safe registered paths, SHA-256 and byte-size verification, deterministic selection, exact candidate promotion, cleanup, and idempotent discard/finalization.
- Added a responsive seven-stage UI with specialist role/model, activity, correction state, candidate state, and warnings.
- Verified direct tests, TypeScript, production build, server health, desktop/mobile browser rendering, real FFmpeg preview/candidate rendering, forged-report rejection, checkpoint lifecycle, exact final-file hashing, idempotent finalization, and interrupted-session discard.
- Verified a complete live OpenRouter run with four tracks. The workflow handled an Ultra timeout through the approved fallback route, produced and reviewed `candidate-001`, and promoted the approved candidate byte-for-byte to the final MP3.

## Provider Payload Verification Gate

Status: complete

Goal: Prove every complete automatic OpenRouter request remains below 102,400 UTF-8 bytes, 24,000 hard-limit estimated tokens, and the stricter 16,000-token regression target for both three-track and full four-track projects.

### Phase 29: Exact Request Serialization

Status: complete

- Add one shared builder that returns the request object, exact serialized body, UTF-8 byte count, estimated tokens, and component breakdown.
- Send the builder's serialized body directly through `fetch`.
- Capture provider-reported prompt tokens when available.

### Phase 30: Role-Specific Compaction

Status: complete

- Limit each specialist to its own tools and compact stage data.
- Remove raw FFmpeg output, debug paths, preview paths, reasoning, unrelated assistant fields, and complete prior-stage history.
- Keep production continuations bounded with sanitized tool calls and compact tool results.

### Phase 31: Regression Audit

Status: complete

- Test three-track and full four-track projects, repairs, fallbacks, production continuations, both correction cycles, and the previous oversized failure shape.
- Fail any current-library request above 16,000 estimated tokens or 102,400 UTF-8 bytes.
- Confirm finalization sends no provider request.

### Phase 32: Live Verification

Status: complete

- Run tests, type-check, production build, current-library audit, complete automatic OpenRouter run, and forced correction-cycle run.
- Report every request measurement and the largest contributing component.

## Provider Payload Verification Result

- Added one exact OpenRouter request builder. The measured `serializedBody` is passed directly to `fetch`.
- Added component breakdowns for system prompts, stage data, tool schemas, retained history, tool results, repair errors, and request envelope.
- Added role-specific payload builders and exact tool allowlists.
- Removed raw FFmpeg output, debug paths, provider reasoning, usage objects, and prior-stage chat history.
- Kept the server-issued production preview path because it is required for authoritative execution-report validation; it is removed before Quality Review.
- Added a 117-request regression audit using the current three-track and four-track library data.
- Largest automated request: 13,607 bytes and 4,528 estimated tokens.
- Largest live request: 13,553 bytes and 4,509 estimated tokens; successful OpenRouter usage reported 6,455 prompt tokens.
- Completed a live four-track automatic run and a separate live one-correction-cycle run.
- Confirmed finalization generated zero provider requests.
- Verified tests, type-check, production build, browser console, server health, and exact candidate/final hashes.

## Local-Only Security Baseline

Status: complete

### Phase 33: Restrict Network Access

Status: complete

- Bind the server only to `127.0.0.1`.
- Allow browser origins only from localhost and loopback addresses.
- Reject cross-site mutating requests before they reach API handlers.

### Phase 34: Security Verification

Status: complete

- Add direct tests for valid local origins, invalid outside origins, deceptive hostnames, and cross-site writes.
- Verify local health and app requests succeed.
- Verify outside origins and cross-site writes return HTTP 403.
- Verify the live listener is bound only to `127.0.0.1`.
