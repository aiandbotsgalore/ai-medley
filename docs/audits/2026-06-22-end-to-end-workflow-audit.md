# End-to-End Automatic Workflow Audit

Date: 2026-06-22
Repository: `G:\ai-medley--main`
Scope: active automatic specialist workflow only, with legacy/manual boundaries inspected where shared code can affect automatic behavior.

## 1. Executive Summary

The automatic workflow is mostly coherent at the happy-path level: local analysis produces Medley Intelligence, specialists produce a project brief and arrangement, the production role calls server-authoritative transition execution, the server renders an immutable candidate, quality review updates the candidate manifest, and final promotion copies the reviewed candidate byte-for-byte into `medley_final.mp3`.

The architecture is still more complicated than necessary. The largest reliability risks come from duplicated ownership between browser state, server in-memory session state, persistent checkpoints, candidate manifests, history, and permanent wisdom. The strongest boundary is candidate promotion: `src/server/candidateStore.ts` verifies registered path, size, and SHA-256 before copying the selected candidate. The weakest boundaries are correction/finalization semantics, checkpoint durability, and session-scoped intelligence stored in a single global cache.

The highest-risk defect is that the workflow can finalize a technically valid candidate after the maximum correction count even when the latest quality review explicitly rejected it. This can surface a successful completion for an unapproved candidate. Other high-value corrections should consolidate execution style/timing ownership, make checkpoint writes durable before stage advancement, isolate `cachedTrackIntelligence` per session, and fix cancellation during pre-analysis.

## 2. Verification Baseline

- Branch: `payload-optimization`
- Commit: `546287cf692a6f227a00058478af33e7867e0a2c`
- Working tree at baseline: `## payload-optimization...origin/payload-optimization`; untracked `.agents/`, `.codex/`, `.serena/`, `AGENTS.md`
- Recent commits:
  - `546287c fix(server): restrict app to local access`
  - `f0e424c fix(provider): enforce compact request payloads`
  - `c70b521 feat(workflow): add specialist model pipeline`
  - `4f5008e Revert "fix: remove broken openrouter/owl-alpha model"`
  - `15a93d5 fix: remove broken openrouter/owl-alpha model`

Commands run:

- `npm test`: passed. It also regenerated `workdir/provider-payload-audit.json` with 117 passing request rows. Largest request: 16,944 bytes / 5,636 estimated tokens.
- `npm run lint`: passed (`tsc --noEmit`).
- `npm run build`: passed. Vite warned that one JS chunk is larger than 500 kB.

Runtime/artifact checks:

- Read current `library/db.json`: 4 library entries; sampled entries have `localAnalysis.localAnalysisV2` and `medleyIntelligence`.
- Read current `library/history.json`: 13 completed sessions.
- Found no active `library/checkpoints/*.json` at audit time.
- Read newest automatic candidate manifest: `workdir/6avzjs2c/candidate-manifest.json`.
- Verified `workdir/6avzjs2c/candidate-001.mp3` and `workdir/6avzjs2c/medley_final.mp3` have identical SHA-256 and identical size, proving exact candidate promotion for that artifact.

Verification limitations:

- No live paid/provider calls were made.
- No destructive session, library, or history mutations were performed.
- Provider model compliance, audio quality, and correction-loop behavior were not reproduced live; those findings are classified from code or existing artifacts as noted.
- Current plans and comments were read as context only, not accepted as proof.

## 3. Current Actual Workflow Diagram

```mermaid
flowchart TD
  A[User uploads audio] --> B[/api/library writes library/audio + db.json/]
  B --> C[App fetches library]
  C --> D[startMedley health check]
  D --> E[preAnalyzeLibrary]
  E --> F[/api/audio-analysis/local -> localAnalysis + medleyIntelligence persisted/]
  E --> G{manual mode and cloud allowed?}
  G -- yes --> H[Provider audio analysis -> /api/library/analysis]
  G -- no --> I[local only]
  F --> J[buildMedleyDesign]
  I --> J
  H --> J
  J --> K[/api/medley-intelligence/design builds design and global cache/]
  K --> L[runAutomaticSpecialistWorkflow]
  L --> M[context specialist -> project brief]
  M --> N[/api/session/project-brief in server memory/]
  N --> O[arrangement specialist -> locked plan]
  O --> P[/api/session/design-plan in server memory/]
  P --> Q[production specialist]
  Q --> R[/api/apply-transition preview + server execution records/]
  R --> S[/api/session/execution-report validates against server executions/]
  S --> T[/api/render-review-candidate]
  T --> U[candidate-NNN.mp3 + debug files + candidate-manifest.json]
  U --> V[quality review specialist]
  V --> W[/api/session/quality-review updates manifest reviewStatus and selectedCandidateId/]
  W --> X{approved or max corrections?}
  X -- correction needed --> Q
  X -- approved or maxed --> Y[/api/session/:id/candidates/]
  Y --> Z[/api/finalize-medley promote selected candidate/]
  Z --> AA[medley_final.mp3 + history.json + wisdom.json]
  AA --> AB[UI completed + /api/audio/:id exposed]
  L -. fire-and-forget .-> CP[/api/checkpoint -> library/checkpoints/]
  CP -. resume .-> L
  L -. abort .-> CX[AbortError -> UI idle]
  T -. cancel render .-> CR[/api/session/:id/cancel kills active FFmpeg only/]
  L -. failure .-> ERR[UI error + preserved artifacts]
```

## 4. Stage-by-Stage Trace

| #   | Stage                               | Owner                                                                                     | Input                                                        | Output / persisted state                                                | Failure / resume / downstream                                                                                  |
| --- | ----------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | Startup/config migration            | `src/App.tsx:263`, `src/utils/configMigration.ts:6`                                       | `localStorage`, `/api/config`                                | React `config`, `configLoaded`; automatic mode defaults for old configs | Config errors surface before start via `getStartConfigurationError`; no checkpoint dependency                  |
| 2   | Library loading                     | `src/App.tsx:239`, `server.ts:856`                                                        | `library/db.json`                                            | React `library`                                                         | Fetch failures are console-only; start can use stale in-memory `library`                                       |
| 3   | Upload/source registration          | `src/App.tsx:305`, `server.ts:860`                                                        | dropped files                                                | `library/audio/<uuid>`, appended db entry                               | Upload errors set UI error; source audio deletion only via explicit remove                                     |
| 4   | Local audio analysis                | `src/App.tsx:1312`, `server.ts:1201`, `src/engine/localAudioAnalysis.ts:670`              | unanalyzed library entries                                   | `analysis`, `localAnalysis`, `medleyIntelligence`, optional clips       | Per-file failure is logged and non-fatal; cancellation can leave UI stuck during pre-analysis (F-004)          |
| 5   | Optional cloud analysis             | `src/App.tsx:1332`, `src/engine/providers.ts:353`                                         | manual mode plus user/config permission                      | appends cloud text through `/api/library/analysis`                      | Not used in automatic mode; provider failures are logged per track                                             |
| 6   | Cached-analysis reuse               | `src/App.tsx:1313`                                                                        | existing `analysis`, `localAnalysisV2`, `medleyIntelligence` | skips local analysis                                                    | No file-hash invalidation check despite `localAnalysisV2.fileHash`; low risk for immutable uploaded audio      |
| 7   | Medley Intelligence construction    | `src/App.tsx:381`, `server.ts:1245`                                                       | current library and constraints                              | `MedleyDesignPayload`; `cachedTrackIntelligence` global                 | Fails if no local intelligence; resume rebuilds design first                                                   |
| 8   | Section scoring/ranking             | `src/engine/medleyIntelligence.ts:425`                                                    | local analysis facts                                         | section candidates, scores, ranked candidates                           | Labels are heuristic; no lyrics/key fact claims                                                                |
| 9   | Transition matrix                   | `src/engine/medleyIntelligence.ts:769`                                                    | top exit/entry candidates                                    | sorted transition scores                                                | `maxTransitions` request parameter is not enforced in `buildMedleyDesignPayload` (F-010)                       |
| 10  | Strategy generation                 | `src/engine/medleyIntelligence.ts:928`                                                    | tracks, matrix, wisdom                                       | ordered strategies                                                      | Historical wisdom can bias scores; provenance is weak but local-only                                           |
| 11  | Provider payload construction       | `src/engine/specialistPayloads.ts:84`, `src/engine/providerRequest.ts:57`                 | compact stage data, tools, history                           | serialized OpenRouter request                                           | `npm test` verifies 117 fixture requests under limits                                                          |
| 12  | Exact payload measurement/rejection | `src/engine/providers.ts:90`, `src/engine/providerRequest.ts:88`                          | serialized request                                           | pre-network 413 error if over hard limits                               | TEST-VERIFIED by `providerPayloadAudit.test.ts`; live provider acceptance unverified                           |
| 13  | Specialist role selection           | `src/types/specialistWorkflow.ts:3`                                                       | stage role                                                   | fixed specialist model + fallback list                                  | Model availability not live-verified                                                                           |
| 14  | Provider execution                  | `src/engine/specialistOrchestrator.ts:104`, `src/engine/providers.ts:245`                 | stage prompt                                                 | function call args                                                      | 120s request timeout; one repair attempt; then fallback model                                                  |
| 15  | Timeout/abort/retry/fallback        | `src/engine/providers.ts:145`, `src/engine/specialistOrchestrator.ts:110`                 | AbortSignal, provider errors                                 | abort or next model                                                     | 429 retries once at provider layer; other failures fall back by role                                           |
| 16  | Project brief                       | `src/engine/specialistOrchestrator.ts:339`, `server.ts:1319`                              | context stage data                                           | server `sessions[sessionId].projectBrief`                               | Schema/context validated; checkpoint saved before and after                                                    |
| 17  | Arrangement                         | `src/engine/specialistOrchestrator.ts:390`, `server.ts:1445`                              | project brief + transition candidates                        | server `designPlan`                                                     | Context validation checks section ownership and timestamps, not that pair came from candidate list (F-006)     |
| 18  | Transition execution                | `src/engine/specialistOrchestrator.ts:167`, `server.ts:1543`                              | locked transition IDs plus style/duration                    | preview MP3, `session.executionResults`                                 | Server-authoritative execution exists only in memory until report/checkpoint artifacts                         |
| 19  | Server execution records            | `server.ts:1766`, `server.ts:1826`                                                        | apply-transition result                                      | `executionResults[executionVersion][transitionId]`                      | Success/failure both recorded for automatic sessions                                                           |
| 20  | Execution-report validation         | `server.ts:1340`                                                                          | model report                                                 | server `executionReport`                                                | Report must match server execution records for success, preview path, style, duration, and timings             |
| 21  | Candidate render                    | `server.ts:1937`                                                                          | design plan + execution report                               | `candidate-###.mp3.part` then immutable `candidate-###.mp3`             | Hard fail, no fallback; writes error artifact                                                                  |
| 22  | Candidate manifest                  | `src/server/candidateStore.ts:181`, `server.ts:2524`                                      | `RenderCandidate`                                            | `candidate-manifest.json`                                               | Atomic manifest write; max 3 candidates                                                                        |
| 23  | Candidate integrity                 | `src/server/candidateStore.ts:233`                                                        | candidate manifest and file                                  | size/hash verified before final copy                                    | CODE-VERIFIED and ARTIFACT-VERIFIED for `6avzjs2c`                                                             |
| 24  | Quality review                      | `src/engine/specialistOrchestrator.ts:500`, `server.ts:1400`                              | candidate facts + local quality                              | manifest review status and metrics                                      | Server rejects approved review with blocking issues; does not require approval before finalization (F-001)     |
| 25  | Correction cycle                    | `src/engine/specialistOrchestrator.ts:548`                                                | rejected review                                              | full production rerun and new candidate                                 | Stops after 2 corrections, then finalizes best valid candidate even if unapproved (F-001)                      |
| 26  | Candidate selection                 | `src/types/specialistWorkflow.ts:399`, `src/server/candidateStore.ts:202`                 | manifest candidates                                          | `selectedCandidateId`                                                   | Approved latest wins; otherwise highest valid score wins                                                       |
| 27  | Final promotion                     | `server.ts:2607`, `src/server/candidateStore.ts:233`                                      | candidateId                                                  | `medley_final.mp3`, manifest finalized fields                           | Hash/size checked; idempotent if already promoted                                                              |
| 28  | History persistence                 | `server.ts:2617`                                                                          | session memory + final path                                  | `library/history.json`, `wisdom.json`                                   | Automatic history can omit metrics because server `session.metrics` is not updated from quality review (F-005) |
| 29  | Checkpoint sequencing               | `src/engine/specialistOrchestrator.ts:334`, `src/App.tsx:1203`, `server.ts:912`           | checkpoint patches                                           | `library/checkpoints/<sessionId>.json`                                  | Client posts fire-and-forget; server stale-guards by sequence/savedAt                                          |
| 30  | Cancellation                        | `src/App.tsx:1141`, `server.ts:840`                                                       | AbortController, render process                              | aborts browser work; kills active FFmpeg render only                    | Pre-analysis cancel can leave status running (F-004)                                                           |
| 31  | Browser refresh/server restart      | `server.ts:740`, `server.ts:959`                                                          | history/checkpoints/manifests                                | completed sessions restored for audio; checkpoints listed               | Active server session memory not restored except by re-posting artifacts during resume                         |
| 32  | Automatic resume                    | `src/App.tsx:1256`, `src/engine/specialistOrchestrator.ts:315`                            | v3 checkpoint and rebuilt design                             | resumes or repeats stage work                                           | Rebuilds Medley Intelligence from current library, not persisted snapshot                                      |
| 33  | SSE events                          | `server.ts:787`, `src/hooks/useSSEStream.ts:33`                                           | session logs/progress                                        | UI logs/progress                                                        | Reconnect timeouts are not canceled on disconnect (F-007)                                                      |
| 34  | React state/status                  | `src/App.tsx:167`, `src/hooks/useMetricsManager.ts:10`, `src/hooks/useSessionState.ts:12` | workflow callbacks                                           | UI status, phase, role, metrics                                         | Several values also exist in server/session/manifest; see matrix                                               |
| 35  | Failure cleanup/discard             | `server.ts:2677`, `src/server/candidateStore.ts:301`                                      | session ID                                                   | removes unfinalized registered artifacts and checkpoint                 | Completed history protects final output                                                                        |

## 5. Sources of Truth Matrix

| Concept                   | Current authoritative owner                                                                                                           | Competing owners / risks                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Session status            | React `status` for UI; server `sessions[sessionId].status` for API                                                                    | Can diverge on cancellation and server errors                                         |
| Current stage             | Orchestrator checkpoint `stage`; React `sessionManager.currentPhase`; server `workflowStage`                                          | Three owners; only checkpoint survives refresh                                        |
| Arrangement               | Orchestrator `arrangementPlan`; server `sessions.designPlan`; history `designPlan`; checkpoint `arrangementPlan`                      | Server memory drives render; checkpoint drives resume                                 |
| Execution version         | Orchestrator `executionVersion`; server `executionResults`; checkpoint `executionReport`                                              | Resume can repeat production instead of rendering from saved report                   |
| Transition records        | Server `executionResults` is authoritative for execution report; design plan carries planned fields; preview files carry actual audio | Style/duration can differ between planned and executed data (F-002)                   |
| Candidate identity        | `candidate-manifest.json` via `candidateStore.ts`                                                                                     | Orchestrator `currentCandidate` mirrors manifest                                      |
| Candidate approval        | Manifest `reviewStatus` after `/api/session/quality-review`                                                                           | Orchestrator `qualityReview.approved`; finalization does not require approval (F-001) |
| Final output              | Candidate manifest `finalOutputPath` and `medley_final.mp3`; history `finalAudioPath`                                                 | `sessions.finalAudioPath` restored for completed sessions only                        |
| Metrics                   | Candidate manifest metrics; React metrics manager; history `metrics`; server `sessions.metrics`                                       | Automatic quality metrics often not persisted to history (F-005)                      |
| Checkpoint sequence       | `activeRequestSequence` + `savedAt` in checkpoint endpoint                                                                            | Browser does not await writes (F-003)                                                 |
| Provider request sequence | `ProviderSession` closure `requestNumber`; audit callback rows                                                                        | Browser stores audits only in memory/window                                           |
| Track intelligence        | Current design payload in browser; global server `cachedTrackIntelligence`; persisted `library.db[].medleyIntelligence`               | Global cache is not session-scoped (F-008)                                            |
| History/wisdom            | `library/history.json`; `library/wisdom.json`                                                                                         | Wisdom can influence future deterministic scoring but lacks strict provenance         |

## 6. Prioritized Findings

### F-001: Unapproved candidates can be finalized after correction limit

- Priority: Critical
- Evidence: CODE-VERIFIED
- Files/symbols: `src/engine/specialistOrchestrator.ts:548`, `src/engine/specialistOrchestrator.ts:554`, `src/types/specialistWorkflow.ts:399`, `src/server/candidateStore.ts:202`, `server.ts:2607`
- Description: The correction loop exits when `qualityReview.approved` is true or `correctionCount >= MAX_CORRECTION_RETRIES`. After the max correction count, it selects `manifest.selectedCandidateId || currentCandidate.candidateId` and finalizes it. `chooseBestCandidate` will select a technically valid candidate even when all candidates are `changes_requested`.
- Root cause: Correction exhaustion is treated as a terminal success path instead of a failed or explicitly degraded path.
- Runtime consequence: A rejected candidate can be promoted and recorded in history as completed.
- Musical-quality consequence: Known blocking issues can be shipped as the final medley.
- Reproduction/reasoning: A quality review with `approved: false` and blocking issues sets manifest status to `changes_requested`; after two correction cycles, the loop breaks and finalizes best valid candidate.
- Safest minimal correction: Require an approved candidate for automatic finalization, or return a clear failure/manual-review state when corrections are exhausted.
- Tests required: Unit test `chooseBestCandidate`/orchestrator finalization with only rejected candidates; integration test for max-correction path.
- Preserve: Existing ability to keep technically valid rejected candidates as artifacts for review.

### F-002: Executed transition style/duration can diverge from final render style

- Priority: High
- Evidence: CODE-VERIFIED
- Files/symbols: `src/types/specialistWorkflow.ts:371`, `server.ts:1571`, `server.ts:2043`, `server.ts:2050`, `server.ts:2400`
- Description: Transition execution validation locks IDs only. It does not require `style`, `duration`, or `beatAlign` to match the arrangement. The execution report validates those fields against server execution, but final render merges only `durationUsed` and timings from execution while keeping `style` from the planned transition.
- Root cause: Planned arrangement and execution report are both treated as partially authoritative.
- Runtime consequence: The preview and execution report can describe one style while the final graph renders another style.
- Musical-quality consequence: Quality review can approve a preview whose DSP/style is not what final render uses.
- Reproduction/reasoning: Production model can call `apply_musical_transition` with `style: beat_aligned` for a planned `smooth_blend`; final render uses `planned.style` in `joinStyles`.
- Safest minimal correction: Either lock style/duration/beatAlign to arrangement, or update the final render to use the server-authoritative executed fields consistently.
- Tests required: Execution request mismatch test; candidate render test asserting final graph style equals intended authoritative style.
- Preserve: The production specialist's ability to produce corrected timings when that is intentional.

### F-003: Automatic checkpoint durability is not awaited

- Priority: High
- Evidence: CODE-VERIFIED
- Files/symbols: `src/App.tsx:1203`, `src/engine/specialistOrchestrator.ts:334`, `server.ts:912`
- Description: The orchestrator emits checkpoints at important boundaries, but App posts them with `fetch(...).catch(() => {})` and does not await success before continuing to the next stage.
- Root cause: Checkpoint persistence is treated as telemetry instead of a durability boundary.
- Runtime consequence: A browser close, refresh, network hiccup, or server rejection can leave no durable resume point for a stage the UI has already passed.
- Musical-quality consequence: Resume may repeat expensive production work or lose a candidate-stage handoff.
- Reproduction/reasoning: The client ignores `/api/checkpoint` failures; server may reject invalid v3 checkpoints or mark stale writes without the workflow knowing.
- Safest minimal correction: Await checkpoint writes at stage-complete boundaries, with non-blocking writes only for minor progress telemetry.
- Tests required: Mock failed checkpoint POST and assert the workflow does not advance silently at required boundaries.
- Preserve: Stale checkpoint rejection by `activeRequestSequence` and completed-session ignore behavior.

### F-004: Cancel during pre-analysis can leave UI in running state

- Priority: High
- Evidence: CODE-VERIFIED
- Files/symbols: `src/App.tsx:1141`, `src/App.tsx:1312`, `src/App.tsx:1367`, `src/App.tsx:1420`
- Description: `handleCancel` aborts the controller and disconnects SSE, but it does not set status to idle. During pre-analysis, `preAnalyzeLibrary` returns on abort and `startMedley` returns at line 1421 without resetting `status`.
- Root cause: Cancellation completion is handled inside `runAutomaticWorkflow`/`runAutonomousLoop`, but pre-analysis occurs before those catch blocks.
- Runtime consequence: The status bar and running UI can remain active after canceling early.
- Musical-quality consequence: None directly, but it can block clean user recovery.
- Reproduction/reasoning: Start with unanalyzed tracks, cancel before `runAutomaticWorkflow`; no code path sets `setStatus('idle')`.
- Safest minimal correction: Set status/run timers consistently in `handleCancel` or in the pre-analysis abort branch.
- Tests required: Component or hook-level cancellation test for pre-analysis.
- Preserve: Do not delete source audio or completed outputs on cancel.

### F-005: Automatic quality metrics are not persisted to history

- Priority: Medium
- Evidence: CODE-VERIFIED and ARTIFACT-VERIFIED
- Files/symbols: `src/App.tsx:1211`, `server.ts:1400`, `server.ts:2617`, `workdir/6avzjs2c/candidate-manifest.json`, `library/history.json`
- Description: App stores automatic quality review metrics in React state. The server updates candidate manifest metrics through `applyCandidateReview`, but `/api/finalize-medley` persists `metrics: session.metrics`, and `/api/session/quality-review` does not set `session.metrics`.
- Root cause: Candidate metrics and session/history metrics are separate stores with no automatic sync.
- Runtime consequence: History entries can lack scores even when the approved candidate has them.
- Musical-quality consequence: Past quality scores can be unavailable for UI review and future wisdom scoring.
- Reproduction/reasoning: The sampled `6avzjs2c` manifest contains candidate metrics; the sampled history entry contains no `metrics` field.
- Safest minimal correction: On quality review, set `sessions[sessionId].metrics` from the review or have finalization read candidate metrics from manifest.
- Tests required: Finalize-medley test verifying history metrics match reviewed candidate metrics.
- Preserve: Existing manifest metrics and history loading behavior.

### F-006: Arrangement validation does not require selected transitions to come from supplied transition candidates

- Priority: Medium
- Evidence: CODE-VERIFIED
- Files/symbols: `src/engine/specialistPayloads.ts:132`, `src/types/specialistWorkflow.ts:288`, `server.ts:1495`
- Description: The arrangement prompt supplies a compact set of transition candidates, but validation only checks track/section ownership, order, and timestamp bounds. It does not require the chosen pair/timestamp to match a deterministic transition candidate.
- Root cause: Contextual correctness is checked broadly, but candidate provenance is not enforced.
- Runtime consequence: The model can invent valid-looking timestamps inside known sections that were not scored as strong transitions.
- Musical-quality consequence: Low-quality or unscored transitions can enter production.
- Reproduction/reasoning: A plan using any known section ID and timestamp inside that section passes `validateArrangementContext`.
- Safest minimal correction: Include transition candidate IDs or a deterministic accepted-pair map and validate arrangement transitions against it.
- Tests required: Arrangement validation test rejecting a section pair not present in allowed candidates.
- Preserve: Ability to use deterministic fallbacks when a strategy has no direct candidate pair.

### F-007: SSE reconnect timers can survive disconnect

- Priority: Medium
- Evidence: CODE-VERIFIED
- Files/symbols: `src/hooks/useSSEStream.ts:55`, `src/hooks/useSSEStream.ts:101`, `src/hooks/useSSEStream.ts:121`
- Description: `connect` schedules reconnect attempts with `setTimeout(attempt, backoff)`, but `disconnect` does not track or clear those timeout IDs.
- Root cause: The hook tracks heartbeat timers but not reconnect timers/generation.
- Runtime consequence: A stale reconnect can attach after completion/cancel and update logs/progress for an old session.
- Musical-quality consequence: None directly; UI truth can disagree with workflow state.
- Reproduction/reasoning: If an error schedules reconnect, then `disconnect` runs before timeout fires, the pending callback still calls `attempt`.
- Safest minimal correction: Track reconnect timeout IDs or a connection generation token and ignore stale attempts.
- Tests required: Hook test for disconnect before delayed reconnect.
- Preserve: Current heartbeat reconnect behavior during active sessions.

### F-008: `cachedTrackIntelligence` is global, not session-scoped

- Priority: Medium
- Evidence: CODE-VERIFIED
- Files/symbols: `server.ts:737`, `server.ts:759`, `server.ts:1245`, `server.ts:1527`, `server.ts:1638`
- Description: The server stores only the last computed track intelligence in a module-global variable. It is used for section-pair evaluation, specialist context validation, design-plan warnings, and beat snapping.
- Root cause: The original route cache was designed for a single active request, not a resumable staged workflow.
- Runtime consequence: A second browser tab, stale request, or library/design rebuild can replace the cache while another session is validating or rendering.
- Musical-quality consequence: Beat snapping and validation can use the wrong track intelligence or reject valid sections.
- Reproduction/reasoning: `/api/medley-intelligence/design` overwrites the single cache key for all sessions.
- Safest minimal correction: Store track intelligence by `sessionId` or by stable design hash and pass the key through automatic endpoints.
- Tests required: Two-session design-plan validation test with distinct section IDs.
- Preserve: Existing single-user happy path and `/api/section-pair-evaluate` behavior.

### F-009: Correction cycles rerun full production and render for localized defects

- Priority: Medium
- Evidence: CODE-VERIFIED
- Files/symbols: `src/engine/specialistPayloads.ts:189`, `src/engine/specialistOrchestrator.ts:443`
- Description: A rejected review sends corrections back to the production specialist, but the next cycle executes the complete locked plan and renders a full new candidate.
- Root cause: No deterministic targeted correction boundary exists for a single transition defect.
- Runtime consequence: More provider calls, more FFmpeg work, and more opportunities for unrelated transitions to change.
- Musical-quality consequence: Fixing one issue can alter previously acceptable joins.
- Reproduction/reasoning: `buildProductionStageData` includes corrections but still instructs execution of the complete locked arrangement.
- Safest minimal correction: Track correction scope and allow deterministic reuse of unaffected executions/candidates where safe.
- Tests required: Correction test proving unrelated transitions are reused or unchanged.
- Preserve: Current ability to generate complete new candidates when global arrangement quality is poor.

### F-010: `maxTransitions` and target duration are weakly enforced

- Priority: Low
- Evidence: CODE-VERIFIED
- Files/symbols: `server.ts:1277`, `src/engine/medleyIntelligence.ts:954`, `src/engine/specialistOrchestrator.ts:353`
- Description: The design endpoint passes `maxTransitions: 32`, but `buildMedleyDesignPayload` does not apply it. Target duration is supplied to the context specialist but not deterministically validated against arrangement or final render length.
- Root cause: Constraints are advisory model context rather than enforced workflow invariants.
- Runtime consequence: Future larger libraries can produce larger design payloads or off-target medley durations.
- Musical-quality consequence: Medleys can be longer/shorter than requested unless the model follows the prompt.
- Reproduction/reasoning: No code references `input.maxTransitions` inside `buildMedleyDesignPayload` after receiving it.
- Safest minimal correction: Enforce maximum transition count and duration windows before provider handoff and after arrangement.
- Tests required: Design payload test for max transition cap; arrangement duration validation test.
- Preserve: Current strategy ordering and compact provider payload guarantees.

## 7. Duplicated Reasoning and Unnecessary Loops

- Project brief and arrangement both ask models to repeat ordering/section reasoning even though Medley Intelligence already ranks strategies and transition candidates deterministically.
- Arrangement validation checks structure and section ownership, but not the deterministic candidate provenance that would remove model ambiguity.
- Production specialist uses model reasoning to call a deterministic transition endpoint for every transition. For locked plans, most arguments could be generated deterministically.
- Quality review asks a model to approve objective candidate facts; objective local checks could first gate hard failures and reserve model review for musical judgment.
- Correction reruns full production and render even when review corrections name specific transition IDs.
- Browser, server, manifest, checkpoint, and history each store overlapping summaries of candidate/session state.
- Legacy manual mode still retains free-form shell/file tools and loose design-plan behavior, while automatic mode has stronger structured safeguards.

## 8. Legacy Interaction Boundary

Active legacy/manual systems:

- `runAutonomousLoop` in `src/App.tsx:403` remains active when `config.modelMode !== 'automatic'`.
- Manual mode uses `useModelFallback`, `buildSystemPrompt`, `getToolDeclarations`/`getOpenRouterTools`, `/api/exec`, `/api/file-read`, `/api/file-write`, `/api/session/finish`, `/api/session/design-plan`, `/api/apply-transition`, and legacy checkpoint schema v2.
- `/api/render-review-candidate` has a `legacy` path that converts loose `session.designPlan.transitions` into v1 arrangement/execution structures.
- `/api/session/design-plan` accepts loose plans only when `sessions[sessionId].projectBrief` is absent.

Interference/bypass risks:

- The same server `sessions` object stores both loose legacy plans and strict automatic plans.
- `/api/exec`, `/api/file-read`, and `/api/file-write` remain available API routes for manual workflow and can create files outside the automatic candidate manifest path; automatic specialist tools do not call them.
- `cachedTrackIntelligence` is shared by both workflows.
- History and audio endpoints do not distinguish manual from automatic sessions.

Compatibility to preserve:

- Manual mode must continue to use Gemini/OpenRouter selected by config.
- Legacy checkpoints must still upgrade through `checkpointManager.ts`.
- `/api/session/finish` must remain for older manual finalization behavior unless a deliberate migration removes it.
- Existing history entries and final audio paths must continue to load.

## 9. Required Preservation Guarantees

Future corrections must preserve:

- Successful automatic medley generation through the specialist pipeline.
- Local audio analysis and persisted `library/db.json` intelligence.
- Optional manual-mode cloud analysis.
- Existing library contents and source audio files.
- History loading and `/api/audio/:id` playback after restart.
- Preview behavior for transition executions and candidate debug artifacts.
- Progress and metrics display during active runs.
- Cancellation without deleting source audio.
- Automatic checkpoint resume for v3 checkpoints.
- Legacy checkpoint resume for v2 checkpoints.
- Candidate manifest integrity checks.
- Exact reviewed-candidate promotion by copy with size/hash verification.
- Final MP3 export/download.
- Session discard cleanup without deleting completed final outputs.

## 10. Proposed Simpler Target Workflow

Recommended target:

```text
Local analysis
-> deterministic candidate filtering
-> compact arrangement planning
-> deterministic contextual validation
-> deterministic production execution
-> immutable candidate render
-> objective verification
-> optional targeted correction
-> exact candidate promotion
```

Simplifications:

- Replace the model-authored project brief with deterministic compact context plus optional model summary. Justified because local intelligence already supplies track facts and ranked sections. Preserve prompt readability. Migration risk: specialist prompt changes can affect model output. Tests: payload audit and arrangement fixture tests. Timing: staged.
- Require arrangement transitions to reference deterministic candidate IDs. Replaces broad section/timestamp validation with exact provenance. Preserve creative ordering among allowed candidates. Migration risk: current models may need prompt/schema updates. Tests: validation reject/accept cases. Timing: immediate after F-001/F-002.
- Generate production transition calls deterministically from the locked plan. Replaces model deciding `apply_musical_transition` calls. Preserve correction ability to change allowed style/duration only through a validated patch. Migration risk: fewer creative model adjustments. Tests: execution report and render graph parity. Timing: staged.
- Split objective verification from model quality review. Deterministic checks should gate duration, loudness, true peak, missing files, hash, and transition timing before model review. Preserve subjective musical review. Tests: candidate render failure/success fixtures. Timing: immediate/staged.
- Make correction targeted. Reuse unaffected transition records and candidate graph parts where safe. Preserve full rerender fallback. Tests: correction scope regression. Timing: conditional after state ownership is fixed.
- Consolidate final output truth in candidate manifest plus history projection. Server session memory should be a cache. Preserve existing `/api/audio/:id`. Tests: restart and history playback. Timing: staged.
- Isolate legacy/manual mode behind explicit compatibility adapters. Preserve manual generation until removed by a separate migration. Tests: legacy checkpoint and `/api/session/finish` smoke tests. Timing: staged/conditional.

## 11. Recommended Implementation Order

1. Correctness defects
   - Fix F-001 and F-002 first.
   - Rollback boundary: changes limited to orchestrator/candidate selection and transition validation/render merge.
   - Required tests: rejected-candidate finalization, style/duration authority, existing candidate promotion.

2. State-ownership consolidation
   - Make checkpoint stage-complete writes awaited; synchronize server metrics from quality review; session-scope track intelligence.
   - Rollback boundary: keep old checkpoint schema readable.
   - Required tests: checkpoint stale guard, restart/resume, metrics in history.

3. Arrangement safeguards
   - Add candidate IDs/provenance and duration checks.
   - Rollback boundary: schema version or compatibility parser for existing checkpoints.
   - Required tests: arrangement validation and payload audit.

4. Candidate and finalization safeguards
   - Require approved candidate for automatic success; expose exhausted-corrections state.
   - Rollback boundary: preserve candidate artifacts and manual review access.
   - Required tests: correction exhaustion, approved finalization, history persistence.

5. Payload/model-loop simplification
   - Remove unnecessary repeated model decisions after deterministic context and production are stable.
   - Rollback boundary: feature flag or config path to current specialist loop.
   - Required tests: provider payload regression and end-to-end fixture.

6. Legacy isolation or removal
   - Separate legacy routes/adapters from automatic strict routes.
   - Rollback boundary: keep `/api/session/finish` and legacy checkpoint loader until migration completes.
   - Required tests: legacy checkpoint resume and history playback.

7. Documentation cleanup
   - Update AGENTS/CLAUDE docs to describe automatic specialist workflow as current default and legacy loop as manual mode.
   - Rollback boundary: docs-only.
   - Required tests: none beyond link/reference verification.

## 12. Open Questions and Verification Gaps

- Live OpenRouter specialist behavior was not verified because the audit avoided external paid/provider actions.
- No current active v3 checkpoint existed to artifact-verify resume at every stage.
- Audio quality was not subjectively listened to during this audit.
- Provider model names and availability can change externally; current code fallback behavior was inspected but not live-verified.
- Whether correction exhaustion should fail hard or surface a manual-approval state is a product decision, but silent success is not safe.
- The current repository has no automated browser end-to-end test that starts a real automatic session, cancels during pre-analysis, resumes from checkpoint, and finalizes.
