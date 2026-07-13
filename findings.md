# Findings: Provider API Key Settings

## Stabilization continuation — 2026-07-04

- Phase 6 is administratively marked in progress but has no implementation yet.
- Existing exact OpenRouter measurement, automatic Zod schemas, and small payload fixtures are prerequisites only.
- Transactional history, typed provider decisions, config/model discrimination, semantic provenance, shared Gemini/manual budgets, and versioned manual contracts all remain.
- No protected data was touched during the Phase 6 inspection.
- Phase 6 completed with mocked provider-only coverage. Shared budgets reject oversized Gemini/OpenRouter requests before network activity; current automatic facts/candidates and active manual schemas are versioned and authoritative.
- Remaining provider risk is limited to live service behavior and Gemini SDK wire-size variance; neither was tested because paid/live calls are prohibited.
- Phase 9 production smoke reproduced the audit defect in three layers: wrong `.cjs` format, unbundled local modules, then CJS-incompatible `import.meta`. A bundled ESM `dist/server.js` passed on an owned port and temp data root.
- Full Phase 9 closure still requires an explicitly approved clean `npm ci` in a disposable clone/cache; it was not run in this worktree.

## Windows Bluetooth Diagnosis Findings

- Diagnosis started with read-only checks only.
- No driver, service, device, registry, or pairing changes have been made yet.
- Core adapter: `Realtek Bluetooth Adapter`, USB ID `USB\VID_13D3&PID_3556\00E04C000001`.
- Current adapter state after the incident: `OK`, problem code `0`, using `oem70.inf`, Realtek driver `1.1061.2312.2501`, driver date `2024-05-19`.
- Bluetooth services checked: `bthserv`, `BluetoothUserService_*`, `BTAGService`, and `BthAvctpSvc` were all running.
- Focused incident at `2026-05-20 11:49`: System log shows BTHUSB warning ID `3` at `11:49:52` and `11:49:57`: command sent to the adapter timed out and adapter did not respond.
- Same focused incident shows BTHUSB error ID `17` at `11:49:57`: local Bluetooth adapter failed in an undetermined manner and Windows unloaded the driver.
- No nearby System log evidence found for a specific paired-device auth failure at 11:49; earlier iPhone mutual-auth failures around 7:10 are a separate issue.
- The 11:49 issue points to a Realtek Bluetooth adapter / USB transport / driver hang, not just a normal pairing failure.
- Driver store contains the active Realtek Bluetooth driver `oem70.inf` version `1.1061.2312.2501` and an older Realtek Bluetooth driver `oem79.inf` version `1.9.1051.3002`.
- Restart attempt: disabling/enabling the Realtek Bluetooth adapter returned the adapter to `OK`.
- Service restart attempt: `BTAGService` hung in `StopPending`; it was the only service in PID `2088`.
- Killed the stuck `BTAGService` host process and restarted Bluetooth services. Final state: `bthserv`, `BluetoothUserService_cf83d`, `BTAGService`, and `BthAvctpSvc` all `Running`; Realtek Bluetooth Adapter `OK`.
- No fresh BTHUSB System events were found in the final post-reset check window.
- Logan reported Bluetooth remained unselectable/unavailable in Windows UI after the adapter/service reset.
- Checked Windows radio layer: `SWD\RADIO\BLUETOOTH_106838FADD5C` is present, `OK`, problem code `0`, Microsoft generic software-device driver `10.0.26100.2`.
- `RmSvc` / Radio Management Service is running.
- No Bluetooth policy keys were found at the checked PolicyManager/Policies registry paths.
- Restarted Explorer and Settings shell and opened `ms-settings:bluetooth`; device state still reports OK underneath.
- Plug and Play scan and radio-layer disable/enable both hung inside Windows device management and had to be stopped. This suggests the Windows Bluetooth/PnP stack is wedged even though Device Manager-style status says OK.
- Asked to fix without reboot. `pnputil /restart-device` for the Realtek Bluetooth adapter also hung and had to be stopped.
- `DeviceAssociationService` became the clear blocker: stopped/started attempts left it stuck in `StartPending`; Service Control Manager logged event ID `7031` that Device Association Service terminated unexpectedly.
- DISM `CheckHealth` reported: component store is repairable.
- DISM `RestoreHealth` completed successfully.
- After DISM, `DeviceAssociationService` still hung while starting.
- `sfc /scannow` could not proceed because Windows reported a pending system repair requiring reboot.
- Conclusion: no-reboot repair path is exhausted. Windows must reboot to complete the DISM repair before SFC or further service repair can work.

## Local Code Findings

- `src/App.tsx` stores `geminiApiKey` in component state.
- `src/App.tsx` fetches `/api/config` on load and sets the Gemini key from the server response.
- `src/App.tsx` directly creates `new GoogleGenAI({ apiKey: geminiApiKey })` in the browser.
- The main medley loop uses Gemini chat, Gemini tool calls, and Gemini file upload APIs.
- `preAnalyzeLibrary` also uses Gemini file upload and `ai.models.generateContent`.
- `src/components/ConfigPanel.tsx` currently contains model/style/duration/crossfade/custom-instruction settings, but no API key inputs and no provider selection.
- `server.ts` exposes `GET /api/config` with `geminiApiKey` from `process.env.GEMINI_API_KEY || ''`.
- `.env.local` and `.env` were not present when the app was launched.

## OpenRouter Research

- OpenRouter chat completions endpoint is `https://openrouter.ai/api/v1/chat/completions`.
- OpenRouter authenticates with `Authorization: Bearer <token>`.
- OpenRouter schemas are similar to the OpenAI Chat API, with OpenRouter-specific routing/provider fields.
- OpenRouter supports function/tool calling through the `tools` request field.
- OpenRouter supports audio inputs through chat completions using base64 `input_audio` content for compatible models.
- OpenRouter audio files must be base64 encoded; direct URLs are not supported for audio content.

Sources:

- https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request
- https://openrouter.ai/docs/api-reference/overview/
- https://openrouter.ai/docs/guides/overview/multimodal/audio

## Implementation Implications

- Gemini support can stay close to current code.
- OpenRouter support needs an adapter because the app currently uses Gemini-specific chat response shapes and file upload/cache APIs.
- OpenRouter can support audio analysis only if the selected OpenRouter model supports audio input.
- The UI should make provider/model/key state explicit so Logan can switch without editing environment files.

## Implementation Notes

- `src/components/ConfigPanel.tsx` now supports provider switching, provider-specific API key entry, and OpenRouter model entry.
- `src/engine/prompts.ts` now exports both Gemini tool declarations and OpenRouter-compatible tool definitions from one shared tool schema.
- `src/engine/providers.ts` now contains the provider-specific chat and audio-analysis adapters.
- `src/App.tsx` now persists config to local storage, validates the active provider key, routes sessions through the selected provider, and pre-analyzes tracks through the same provider abstraction.
- `server.ts` now exposes both `GEMINI_API_KEY` and `OPENROUTER_API_KEY` through `/api/config` and loads `.env` with `dotenv.config()`.

## Follow-Up Fix Findings

- `listen_to_audio` only handled source library paths. Generated files such as a final medley can now be fetched through `/api/audio-file` with the current session ID.
- `/api/session/finish` previously removed the session work directory immediately after recording the final audio path. That could delete the final output before playback or history download.
- The browser `AbortError` from `audio.play()` can happen when preview playback is paused or switched before the play promise resolves; catching it prevents noisy console errors.
- The repeated `ws://localhost:24678` errors came from Vite HMR websocket retries in this custom Express server setup. HMR is now disabled in dev config.
- The `content.js` and `polyfill.js` internal errors are not from this codebase's source files; those names are typical of browser extensions/content scripts.

## Local-First Cost Findings

- Current pre-analysis sends each unanalyzed full audio file to the selected provider.
- The bundled FFmpeg binary is already present at `node_modules/ffmpeg-static/ffmpeg.exe`.
- Available FFmpeg filters include `astats`, `volumedetect`, `loudnorm`, `ebur128`, `silencedetect`, `showspectrum`, and `showwavespic`.
- Local analysis can reliably cover duration, sample rate, bitrate, peak/RMS/loudness stats, silence regions, waveform peaks, energy curve, and likely usable high-energy sections.
- Installed `music-tempo` locally to improve BPM detection from FFmpeg-decoded PCM without sending audio to an API.
- Local analysis cannot perfectly identify musical key, genre, or subjective mood without either a model or additional specialized audio libraries. It can still provide enough structure to reduce cloud audio calls heavily.
- Best cost-control default: send the model compact local analysis text/JSON and file paths, not raw audio.

## Local Analyzer Verification

- Tested `/api/audio-analysis/local` on an existing library track.
- Result included duration, sample rate, bitrate, mean/max volume, silence region, high-energy candidate sections, and BPM.
- BPM improved from `unknown` to `120` after adding `music-tempo`.
- The analysis response explicitly reports that no audio was sent to an AI provider.

## Export Download Findings

- `MetricsSidebar` uses an `<a download href="/api/audio/:sessionId">` link for Export Output.
- `/api/audio/:sessionId` is also the inline playback route used by the footer audio player.
- If `/api/audio/:sessionId` cannot resolve the MP3, Express returns JSON like `{ "error": "Audio not found" }`; with a `download` attribute the browser can treat that JSON response as the downloaded output.
- The route does not set an attachment filename, so even successful downloads can have an unclear browser-generated name.
- The server already has the latest completed MP3 at `workdir/u6dcusk/final_medley.mp3`, so the fix should separate inline audio playback from explicit MP3 download and make the client reject non-audio responses.

## Medley Intelligence Planning Findings

- Current medley selection has a useful foundation: local duration, sample rate, bitrate, volume stats, silence regions, BPM estimate, energy curve, high-energy candidate sections, style presets, and prompt guidance for energy arc/BPM/transitions.
- Current implementation does not yet have a dedicated medley match scoring engine.
- Hook strength is approximated by high-energy regions, but there is no explicit hook score.
- Transition zones are partially represented by silence and candidate sections, but there is no pairwise transition compatibility matrix.
- Emotional compatibility, contrast, finale strength, vocal intensity, sonic density, and alternate-order tradeoffs are mostly prompt-driven rather than structured/scored.
- Key and lyrical meaning are intentionally weak locally; this is correct unless the user provides lyrics/notes or cloud clip listening is explicitly allowed.
- Highest impact next step is a local scoring layer that creates structured candidate sections and transition-pair scores before the AI plans the medley.
- Best architecture: local signal extraction -> local medley intelligence scoring -> compact structured planning payload -> AI final reasoning -> visible explanation UI.

## Medley Intelligence Implementation Findings

- Added `src/engine/medleyIntelligence.ts` as the local scoring layer.
- The implementation explicitly separates local facts (`kind: local_fact`) from heuristic guesses (`kind: heuristic_guess`).
- Local facts include duration, RMS energy, peak level, silence zones, tempo estimate, dynamic range proxy, brightness proxy, sonic density proxy, and onset-density proxy.
- Brightness, density, onset density, emotional role, hook strength, and finale role are intentionally labeled as proxies/heuristics with warnings because they are not true spectral, lyric, or semantic analysis.
- The design payload uses compact `medley_design_v1` JSON rather than raw audio or long waveform arrays.
- `/api/medley-intelligence/design` can build the design payload from existing `localAnalysis`, so older library items do not require cloud audio to get transition/order scoring.
- `preAnalyzeLibrary` now re-runs local analysis when older tracks have plain analysis text but lack `localAnalysis` or `medleyIntelligence`.
- `listen_to_audio` now runs local analysis first and only sends audio to the selected provider if Logan's config explicitly allows it.
- Runtime check against the local library produced 7 track profiles, 32 transition scores, and 6 order strategies from local data.

## Deep Local Audio Analysis Planning Findings

- Current app has local FFmpeg stats, silence detection, energy curve, high-energy candidates, and `music-tempo` BPM estimation.
- Current app still uses proxies for brightness, density, onset density, hook strength, and emotional role.
- Essentia is an open-source C++ audio/music information retrieval library with Python and JavaScript bindings. Its documentation describes spectral, temporal, tonal, rhythm, BPM, beat, onset, and higher-level music descriptors.
- Essentia.js is a JavaScript/WebAssembly wrapper intended for browser and Node.js music/audio analysis.
- aubio provides command-line and library tools for onset extraction, pitch, beat tracking, tempo, notes, MFCC, and silence/noise detection.
- librosa provides Python tools for spectral centroid, chroma, tonal centroid, beat tracking, and other feature extraction.
- Best first implementation path is likely FFmpeg + Essentia.js in Node because it keeps the app in the existing TypeScript/Node stack.
- Best fallback path is to preserve the current FFmpeg/music-tempo analyzer if the advanced analyzer fails or cannot be installed cleanly.
- Python/librosa can be a stronger scientific fallback, but it adds a Python runtime/dependency management layer and should not be the first choice unless needed.
- Any key/chord/section labeling should remain confidence-scored estimates, not facts, because local MIR algorithms can be wrong on dense rock/metal/cover recordings.

Sources:

- https://essentia.upf.edu/documentation/documentation.html
- https://mtg.github.io/essentia.js/
- https://aubio.org/documentation
- https://aubio.org/doc/latest/
- https://librosa.org/doc/latest/feature.html

## Deep Local Audio Analysis Implementation Findings

- `essentia.js` installed successfully and loads in Node.
- `essentia.js` is AGPL-3.0 licensed. This is acceptable for Logan's local/private use, but it is a license consideration if the app is distributed publicly or commercially.
- Some low-level Essentia WASM calls can throw raw numeric errors on unsuitable/synthetic signals, so the implementation treats Essentia as optional and defensive.
- The reliable core is now FFmpeg decode + internal TypeScript DSP + `music-tempo`, with Essentia availability recorded in the analyzer metadata.
- Added `localAnalysisV2` under the existing local analysis object, preserving compatibility with older `localAnalysis`.
- The live route check against library track `09ffc54c-b8bc-4305-9a85-d28ab4798f88` returned `source=local-ffmpeg-essentia-v2`, `schema=local_audio_analysis_v2`, BPM `128`, estimated key `F major`, 14 V2 segments, 18 local facts, and beat score `1`.
- Medley design after that route check returned 7 tracks, 1 advanced V2-analyzed track, 32 transition scores, and 6 strategies.
- As more tracks are re-analyzed, the design payload will contain advanced facts for more tracks.

## Three-Model Specialist Workflow Findings

- The current application uses one selected model for the entire autonomous loop and changes models only after failures.
- The existing finalization endpoint performs a new FFmpeg render, so it cannot guarantee that a reviewed candidate becomes the final file.
- Current checkpoints require full chat history and use schema version 2.
- Current checkpoint discard deletes only the checkpoint JSON.
- Current render debug files use shared filenames and would be overwritten by later candidates.
- OpenRouter requests already accept an abort signal in the low-level fetch helper, but `ProviderSession.send()` does not expose it.
- The safest migration is to keep the current autonomous loop as the version-2/manual path and add a separate version-3 automatic specialist orchestrator.
- Candidate state needs a server-side atomic manifest because browser state and checkpoints cannot safely authorize file cleanup or final promotion.

## Three-Model Specialist Workflow Implementation Findings

- The full local Medley Design payload was 126,581 UTF-8 bytes and exceeded the new provider limit. The compact specialist handoff is 47,812 bytes; a complete context request with system text and tool schema measured 53,824 bytes and about 17,908 estimated tokens.
- Transition preview execution previously mutated the locked arrangement with runtime fields. Automatic sessions now keep the arrangement immutable and store actual timings, preview paths, and success/failure in authoritative execution records.
- The server now rejects execution reports that do not match the exact transition request and FFmpeg result. A forged preview path returned HTTP 400.
- Real local verification rendered a 57.84-second two-track candidate, recorded its SHA-256 digest, promoted it without FFmpeg, and confirmed the candidate and final MP3 were byte-for-byte identical.
- Repeating finalization returned the existing final output as an idempotent operation.
- Version-3 checkpoints are strict, atomic, sequence-aware, and ignored after the session is recorded as completed, preventing delayed browser writes from recreating a deleted checkpoint.
- Interrupted-session discard removed a registered transition preview and checkpoint while preserving library source audio.
- Browser verification found and fixed a phone-width clipping issue. At 390 x 844 the app now stacks the library, workspace, and metrics vertically with normal page scrolling.
- Browser console verification reported zero errors and zero warnings.
- The initial implementation check occurred before an OpenRouter key was configured; live remote specialist verification has since been completed.
- The first live OpenRouter run exposed a timeout-classification edge case: a timed-out fetch could surface as `AbortError`, which the UI treated as user cancellation. Provider sessions now rethrow the request signal's `TimeoutError` reason.
- The original arrangement handoff was still too large for reliable free-model latency. Keeping essential track facts, one best candidate per directed transition pair, the top eight transition candidates, and four strategies allowed the fallback model to complete.
- Live session `7s66ce77` verified the complete remote chain. Super produced the brief, Ultra timed out during arrangement, Super completed the fallback arrangement, Nex executed production, Ultra approved the full candidate, and Nex finalized it.
- The live candidate scored 85 overall, 88 for transition smoothness, 85 for emotional arc, and 80 for performer identity.
- The approved candidate and final output both contain 25,932,326 bytes with SHA-256 `d56b7b3b1c8b0cf4a8cc0f9c97eb73c11cf6552c22ab6027e2dade7523239d48`.
- Browser playback and HTTP byte-range streaming both work for the completed 648.09-second MP3.
- The existing provider guard measures the complete OpenRouter request object, but tests only cover a synthetic oversized string and do not prove each workflow stage.
- Production provider sessions accumulate assistant tool calls and tool results, so every continuation request must be measured.
- Quality review currently receives the analyzer's raw FFmpeg output and candidate file/debug paths, which are unnecessary payload growth.
- The completed live Context request was locally estimated below the old hard limit, while OpenRouter reported 24,437 prompt tokens. The 16,000 estimated-token regression ceiling is therefore required as safety headroom.
- Exact serialization reduced the four-track Context request to 10,391 bytes and 3,464 estimated tokens; OpenRouter reported 4,154 actual prompt tokens.
- The largest current-library regression request is Arrangement repair at 13,607 bytes and 4,528 estimated tokens.
- The largest live request is Arrangement at 13,553 bytes and 4,509 estimated tokens; the successful fallback reported 6,455 actual prompt tokens.
- The first live verification exposed that removing production preview paths prevented authoritative report validation. The compact production result now retains only the required server-issued preview path and excludes it from Quality Review.
- The full live automatic run completed as session `2oquenv9`; the forced correction run completed as `payload-correction-live`.
- Both live final files are byte-for-byte identical to their approved candidates.

## Local-Only Security Findings

## Phase 9 Clean-Install Finding

- The production package installed and started cleanly, but the first disposable full test run exposed a hidden test-data dependency: `providerPayloadAudit.test.ts` read the main repository's `library/db.json` and `library/wisdom.json`.
- Replacing those reads with deterministic synthetic track intelligence made the suite portable and ensured payload verification cannot depend on or inspect protected user library data.
- The disposable G:-only install then passed all tests, lint, build, and owned production startup without live provider calls.

## Phase 10 Runtime Accessibility Findings

- A disposable G:-only Playwright 1.61.1 + axe-core 4.12.1 harness ran against system Chrome with a disposable profile, mocked local API responses, and all non-local requests blocked.
- The first matrix passed 43/47 checks. Runtime failures were limited to: WCAG AA contrast in the workshop/configuration views, sub-44px core controls, upload progress disappearing while the POST is pending, and the corresponding missing progressbar announcement.
- Keyboard tab behavior, modal focus trap/restore/Escape, accessibility-tree names, form labels, history/reorder actions, narrow/zoom-equivalent layouts, reduced motion, refresh recovery, two-tab state isolation, alerts/status, and no-provider/no-unexpected-API checks passed.
- The app repeatedly attempts Google Fonts at runtime; the harness blocked every attempt. Removing this external request would improve offline determinism and eliminate avoidable console noise.
- The corrected Playwright/axe matrix passed 47/47 and no longer attempted Google Fonts after switching to local system font stacks.
- The first Lighthouse run generated a 0.98 accessibility report with one heading-order failure (`h1` followed by the upload `h3`). Its cleanup returned EPERM, and inspection showed audit renderer processes parented to the pre-existing personal Chrome singleton despite Lighthouse's temporary folder. No account or external site was accessed, no personal process was terminated, and this launch pattern must not be repeated; any rerun requires an explicit new G:-only `--user-data-dir`.
- Changing the upload heading to `h2` closed the final Lighthouse audit. The explicit G:-profile report scores 1.00 with zero failures. Lighthouse still reports `EPERM` while deleting its separate G: temp folder after writing the report; this is a harness cleanup defect, not an accessibility failure, and the disposable evidence is retained.

## Phase 11 Dependency and Documentation Findings

- `@google/generative-ai` is declared in package/lock but has no import, require, dynamic import, config reference, script reference, or runtime use anywhere outside its own declarations. Active Gemini code consistently imports `@google/genai`, so the old SDK is the one proven dead duplicate.
- Current README is partly updated but still recommends `npm install`; AGENTS/CLAUDE describe Gemini-only behavior, `dist/server.cjs`, unrestricted shell behavior, and a Gemini default that are no longer executable truth.
- `.env.example` contains obsolete AI Studio/`APP_URL` guidance, but environment files are explicitly protected for this task. Current environment variables must therefore be documented in a non-environment authoritative operations document without editing `.env.example`.
- Executable environment inputs are `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `PORT`, `AI_MEDLEY_DATA_ROOT`, and `NODE_ENV`; production output is bundled ESM `dist/server.js`, bound to `127.0.0.1`.

- The server previously listened on `0.0.0.0`, which exposed the app and its powerful local file and command endpoints to the local network.
- The server previously used unrestricted CORS, which allowed any website origin to call the API when it could reach the server.
- Binding to `127.0.0.1` removes local-network access while preserving normal use through `localhost`.
- Local-origin validation now accepts the app's HTTP port on `localhost`, `127.0.0.1`, and IPv6 loopback only.
- Mutating requests with a cross-site browser signal are rejected even when the request omits an Origin header.
## 2026-07-10 — Empty library diagnosis

- Active `library/db.json` contains an empty JSON array, which is why the UI
  has no source tracks.
- `library/db.json.bak` contains one record and `library/db.backup.json`
  contains four, but all referenced audio files are absent. They must be
  preserved as evidence, not restored as broken entries.
- `library/audio/` contains three intact orphaned MP3s. The recovery path is to
  reconstruct valid library metadata from those existing files without deleting
  or changing any source audio.
# 2026-07-11 — End-to-end medley workflow audit

- The starting worktree is intentionally dirty with prior in-scope workflow
  changes. Preserve and audit them in place; do not reset or overwrite them.
- Current uncommitted areas include library recovery/per-mix selection,
  OpenRouter preflight/config UI, model fallback, candidate transition
  sanitization, documentation, and planning records.
- The full offline test script already covers most workflow boundaries with
  direct TypeScript test executables; provider tests are mocked and must remain
  offline.
- Baseline `npm test` passes (78 provider-payload request shapes audited); no
  real provider call was made. Baseline `dist/` SHA-256 fingerprints were
  captured before any controlled build.
- Confirmed high-impact selection failure: `runAutomaticWorkflow` supplies a
  `sessionId` to `/api/medley-intelligence/design`, and that route selects the
  entire persisted library whenever `sessionId` is present. The selected UI
  subset is therefore discarded before automatic context/arrangement work.
- Confirmed false-failure path in Manual mode: after candidate promotion sets
  the UI to completed, the loop still makes one more provider request to report
  the tool result. If that unnecessary request fails, the outer catch changes
  the already-completed run to `error` even though the final MP3 exists.
- Confirmed retry-state failure in Manual mode: tool execution exceptions
  increment the failure streak, but the batch unconditionally resets that
  streak before the next model turn. Repeated invalid tool output therefore
  cannot reach the intended fallback threshold.
- Confirmed SSE recovery gap: the server emits a connected snapshot and keeps
  a replay journal, but the client ignores the snapshot and creates reconnect
  URLs without the last event ID. A reconnect can miss progress/completion and
  leave UI state behind server state.
- Confirmed candidate transaction gap: rendering renames the `.part` output to
  immutable `candidate-NNN.mp3` before strict manifest registration. A
  registration/write failure preserves an unregistered MP3 but reports that no
  medley was written; the next correction attempts a new render instead of
  recovering the completed candidate.
- Confirmed final overwrite risk: if `medley_final.mp3` exists but the manifest
  write was interrupted, promotion blindly replaces the path. It should recover
  an identical file and reject a different pre-existing file.
- Confirmed retention violation: successful finalization calls
  `cleanupRejectedCandidates`, silently deleting non-selected candidate audio
  and diagnostics. Candidate artifacts are protected and should be preserved.
- Confirmed wisdom attribution bug: both legacy and candidate finalization
  recorded only each transition's `fromTrackId`, omitting the final destination
  track. Completion wisdom now records the unique union of both endpoints.
- Final verification passed: full `npm test` (including 78 mocked/offline
  provider request shapes), `npm run lint`, `git diff --check`, controlled
  `npm run build`, and isolated `npm run test:production-start`.
- The controlled build was restored exactly: all four baseline `dist/` paths,
  sizes, and SHA-256 hashes match the pre-build snapshot.
- Isolated runtime smoke used three generated 24-second WAVs and a temporary
  `AI_MEDLEY_DATA_ROOT`: three uploads succeeded, only two selected tracks
  entered server-authoritative design, FFmpeg rendered and registered
  `candidate-001`, and final promotion produced an exact candidate/final hash
  match. The owned server and temporary root were removed afterward.
# 2026-07-11 — Release-plan reconciliation

- Git is active at `G:/ai-medley--main` on `payload-optimization`; the archived
  “not a git repository” statement was historical.
- `dist/`, `.env*`, `workdir/`, and `library/audio/` are ignored, but protected
  library JSON files and several old workdir artifacts are already tracked.
  Safe correction requires approval-gated index-only de-tracking plus local
  hash verification; ignore rules alone are insufficient.
- `npm test` invokes the provider payload audit and Phase 34 security suites.
  The active plan now names them explicitly and adds a canary secret-leak gate.
- Historical payload coverage was 117 requests; the current bounded two-model
  roster produces 78. The 16,000-token regression target and 24,000-token/
  100-KiB hard limits remain authoritative.
- `dist/` is ignored and untracked. Future release builds should run in a
  disposable copy rather than repeatedly mutating/restoring workspace `dist/`.

# 2026-07-11 — Release verification findings

- React Strict Mode can invoke functional state updaters more than once. The
  prior library refresh path mutated selection refs inside such an updater, so
  a normal initial refresh could show `0/3 selected`. Selection reconciliation
  now happens before the updater and commits state/ref authority together.
- Vite middleware mode still injects its client when HMR is disabled, and the
  client can fall back to port 24678. Express and Vite now share one Node HTTP
  server, keeping dev HMR on the owned loopback listener without a stray socket.
- Clean mocked browser acceptance completed Automatic Specialist Team mode with
  exactly two selected tracks, truthful completed state, history, and download,
  with zero console errors. Manual completion/no-post-final-provider behavior,
  fallback, correction, resume, and SSE branches are covered by focused mocked
  contract tests rather than paid/live calls.
- The current payload matrix contains 78 requests because the bounded roster is
  two models rather than the historical three-model/117-request matrix. The
  largest current request is 12,964 bytes / 4,314 estimated tokens, below the
  16,000-token regression target and hard pre-network limits.
- Disposable install/build/start and the real-FFmpeg synthetic end-to-end test
  passed. No real provider request was made. Protected data remained unchanged:
  489 stable hashes match, with the same complete 491-path inventory.

# 2026-07-12 — Protected source-audio integrity blocker

- A post-gate comparison detected two library source MP3s whose SHA-256 and
  length no longer match the release baseline. Both are valid MP3s and are 521
  bytes longer; the appended bytes do not begin with standard ID3/TAG metadata.
  The UUID files are untracked and have no Git history, so Git cannot recover
  their earlier bytes. A bounded read-only exact-name `G:` search found no
  duplicate before it was stopped to avoid an unbounded scan. The source of the
  mutation remains undetermined, and release handoff must remain blocked until
  the current bytes are explicitly accepted or a verified backup is supplied.

# 2026-07-13 — Candidate registration diagnosis

- The visible Automatic Specialist Team error belonged to preserved session
  `bknfa639`. Its candidate MP3 and validation sidecar exist, but its manifest
  does not. The server error sidecar records a `ZodError` rejecting exactly
  `_resolvedFromExitSec` and `_resolvedToEntrySec` inside two
  `resolvedTransitions` objects during recovery.
- The initial registration path already removed those internal render-only
  fields, but `recoverUnregisteredRenderedCandidate` parsed the sidecar directly
  with the strict schema. Applying the existing narrow sanitizer before that
  parse restores recoverability without allowing arbitrary extra keys.
- The real preserved session was not retried, rerendered, or mutated during
  diagnosis. The regression uses a temporary candidate artifact and reproduces
  the exact scratch keys.

- A server restart loaded that first fix. The next error was different: the
  persisted candidate was execution version 4 while the resumed checkpoint had
  version 6, so the existing exact-version guard refused recovery. The candidate
  and resumed report have identical audio-affecting transition facts, proving
  the MP3 represents the same planned medley. Recovery now accepts that narrow,
  verified older-attempt case only; it still rejects different transitions.

# 2026-07-13 — Correction-limit root cause

- The candidate was not rejected because recovery failed. Its deterministic
  timeline is 493.6 seconds (about 8 minutes), while the saved project target is
  240 seconds (4 minutes). The candidate quality gate correctly refused approval.
- The prior workflow sent this arrangement-level failure back to the production
  specialist three times. Production can alter execution details but cannot
  shorten the locked section boundaries, so the same failure repeated until the
  correction limit. Arrangement validation now estimates the exact render
  timeline from the selected sections and final tail, then rejects a plan outside
  the requested duration tolerance before rendering.
- The Vite WebSocket console line is only the browser's development auto-refresh
  connection retry during server restart; it is separate from candidate rendering
  and finalization.
