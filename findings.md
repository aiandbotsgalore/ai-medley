# Findings: Provider API Key Settings

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
