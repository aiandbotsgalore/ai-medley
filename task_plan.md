# Task Plan: Provider API Key Settings

## Goal
Add configuration settings in the app so Logan can:
- enter a Gemini API key in the app UI
- switch the AI provider to OpenRouter
- enter an OpenRouter API key in the app UI
- run the medley workflow with the selected provider where technically supported

## Current Status
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

- This project directory is not a git repository, so there is no commit/diff safety net.
- OpenRouter audio support depends on selecting an OpenRouter model that supports audio input.
- OpenRouter does not use Gemini's file upload/cache API, so Gemini cached file URIs are no longer part of the active runtime path.
- API keys entered in the browser will be stored locally if persistence is approved; that is convenient but less secure than server-side secret storage.
- Cloud audio analysis can be expensive because it sends full audio files. New work should default to local analysis and avoid sending raw audio unless explicitly enabled.

## Side Task: Windows Bluetooth Connection Diagnosis

Status: diagnosis_complete_read_only

Goal: Determine why Bluetooth devices are not connecting on Logan's Windows machine using read-only checks first.

Plan:
- Check Bluetooth adapter status and driver metadata.
- Check required Bluetooth services.
- Check recent Bluetooth/System event log errors.
- Check paired Bluetooth device state.
- Summarize likely cause and ask before making driver, device, or settings changes.

Result: The 11:49 failure was a local Realtek Bluetooth adapter timeout followed by Windows unloading the BTHUSB driver. Bluetooth adapter and services were reset on request; final state is adapter `OK` and core Bluetooth services running.

Follow-up: Windows UI still treats Bluetooth as unavailable. The physical adapter and software radio both report `OK`, but Plug and Play/radio reset operations hang, suggesting the Bluetooth/PnP stack is wedged. No-reboot repair was attempted with service resets, `pnputil`, DISM, and SFC. DISM completed a repair, but SFC reports a pending system repair requiring reboot. Next required step is reboot, then rerun SFC and verify Bluetooth.

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

## Recommended Execution Setup

- Recommended model/reasoning for implementation: GPT-5.4, medium reasoning.
- Reason: this is a moderate server/client refactor with careful behavior changes, but it should not need extra-high reasoning.

## Cost-Control Implementation Summary

- Default analysis mode is now `Local Only`.
- Full audio uploads to Gemini/OpenRouter are blocked unless Logan chooses `Ask First` and confirms, or chooses `Cloud Allowed`.
- Local analysis uses FFmpeg plus `music-tempo` and stores compact analysis text in the library.
- The model receives text summaries and local file paths, not raw songs, during normal operation.

## Errors Encountered

| Error | Attempt | Resolution |
|---|---|---|
| `fatal: not a git repository` | Checked `git status --short` before planning | Logged constraint; proceed carefully with scoped edits only after approval |
| Final medley could not be analyzed by `listen_to_audio` | Reviewed tool handler and server audio routes | Added `/api/audio-file` for generated/session audio paths and updated the tool handler to use it |
| Completed session audio could disappear after finish | Reviewed `/api/session/finish` | Stopped deleting the session work directory immediately after saving the final audio path |
| Browser `AbortError` from interrupted `audio.play()` | Reviewed library preview playback | Added a catch for interrupted play promises |
| Vite websocket retries on `localhost:24678` | Reviewed custom Express/Vite setup | Disabled Vite HMR for this custom server to remove stale websocket retries |
| PowerShell `Add-Content` failed while updating progress | Used nested quotes and backticks in one command | Retried with a literal here-string and updated `progress.md` |
| React component key typing error in `MedleyMatchPanel` | Ran `npm run lint` after adding UI panel | Removed `key` from component props and let React handle it at call sites |
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

## Recommended Execution Setup for Medley Intelligence Upgrade

- Recommended model/reasoning for implementation: GPT-5.4 or GPT-5.5, high reasoning.
- Reason: this touches local signal analysis, ranking/scoring design, prompt contracts, UI clarity, and verification. The implementation is still bounded, but the scoring architecture benefits from deeper reasoning.

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

## Recommended Execution Setup for Deep Local Audio Analysis

- Recommended model/reasoning for implementation: GPT-5.5 or GPT-5.4, high reasoning.
- Reason: this touches dependency choice, audio feature extraction, schema migration, scoring math, UI display, caching, and fallback behavior. The change is local-only but technically deeper than the previous scoring layer.

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
