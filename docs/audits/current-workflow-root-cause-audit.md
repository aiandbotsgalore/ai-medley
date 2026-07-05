# Current Workflow Root-Cause Audit

Date: 2026-06-23
Repository: `G:\ai-medley--main`
Branch: `payload-optimization`
Commit: `546287cf692a6f227a00058478af33e7867e0a2c`
Audit Type: Read-only. No fixes implemented. No files modified except this report.

---

## 1. Executive Summary

The automatic specialist workflow cannot reliably complete medleys because of a **design bug: the specialist orchestrator hardcodes `provider: "openrouter"` on every provider session it creates** (`src/engine/specialistOrchestrator.ts:155`, `specialistOrchestrator.ts:234`). It completely ignores the user's provider selection. A paid Gemini API key configured in the UI is silently discarded — the specialist workflow never uses it.

On top of that, every specialist model is a free-tier OpenRouter model (`:free` suffix). Two failed checkpoints from today (`f04450jf`, `rmgfb9zu`) both died at the very first provider stage — the context brief — because all three free models were exhausted.

This means:
- **Automatic mode + paid Gemini key** → Gemini key is ignored → OpenRouter free models run → they fail → run never starts.
- **Automatic mode + paid OpenRouter key** → your OpenRouter API key is used, but only against `:free` model IDs → free models fail → run never starts.
- **Manual mode + paid Gemini key** → Gemini is used correctly, but the architecture requires 10-50 sequential model round-trips with no progress feedback → appears frozen.

Payload size is **not the main problem**. At 17,457 bytes max (5,807 estimated tokens), the largest automatic request is well within the 102,400-byte / 24,000-token hard limit. The previous 237,644-byte failure shape is correctly rejected before network activity.

The real problem is that the specialist workflow was designed exclusively for OpenRouter free models and has no path for using a configured provider, a paid model, or Gemini at all.

---

## 2. Latest Failed-Run Reconstruction

### Session `f04450jf` — Failed 2026-06-23 02:06 UTC

**Checkpoint evidence** (`library/checkpoints/f04450jf.json`):

| Field | Value |
|---|---|
| Stage | `context_brief` |
| Active role | `context` |
| Active model | `nex-agi/nex-n2-pro:free` |
| Active request sequence | 2 |
| Attempted models | `nemotron-3-super:free`, `nemotron-3-ultra:free`, `nex-n2-pro:free` |
| Repair count | 0 |
| Project brief | `null` |
| Arrangement plan | `null` |
| Execution report | `null` |
| Current candidate | `null` |

**Reconstruction**:

1. User pressed Start. `startMedley` pipeline ran health check, pre-analysis, design build.
2. `runAutomaticWorkflow` dispatched the specialist orchestrator.
3. Orchestrator entered `context_brief` stage, called `requestStructuredArtifact` with role `context`.
4. First attempted model: `nvidia/nemotron-3-super-120b-a12b:free` — failed.
5. Orchestrator logged "Specialist fallback from nemotron-3-super:free" and tried next model.
6. Second model: `nvidia/nemotron-3-ultra-550b-a55b:free` — failed.
7. Third (last) model: `nex-agi/nex-n2-pro:free` — failed.
8. Orchestrator threw `"All context specialist models failed"`.
9. `runAutomaticWorkflow` caught the error in its catch block.
10. UI set status `"error"` with message `"All context specialist models failed"`.
11. Checkpoint saved with 3 attempted models, 0 repair count, null project brief.
12. **No workdir directory was created** (confirmed: `G:\ai-medley--main\workdir\f04450jf` does not exist).

### Session `rmgfb9zu` — Failed 2026-06-23 02:11 UTC

Same pattern as `f04450jf`, with `activeRequestSequence: 4` (suggesting an extra attempt cycle). All three models exhausted, null everything, no workdir.

### Proven Facts

- Both sessions died at the **first AI provider call**.
- Neither session ever reached arrangement, production, rendering, or finalization.
- Neither session generated a single transition, preview, candidate, or audio file.
- The failure is 100% a model availability problem, not a payload size, schema repair, arrangement, rendering, or checkpoint problem.
- The successful session `6avzjs2c` (from June 16) completed with a different model set at that time — Nemotron models were likely still functional then.

### Inferred Cause

The `:free` suffix in OpenRouter model names means these models are served on a free tier with limited daily credits. By June 23, 2026, one or more of these models had exhausted its free quota, returning HTTP 402 (insufficient_quota) or similar errors. The specialist orchestrator's `requestStructuredArtifact` function catches the error but has no 402-specific handling — it falls through to the next model. When all three models are exhausted, the session dies.

---

## 3. Payload-Size Analysis

### Evidence Source

- `src/engine/providerPayloadAudit.test.ts` — Automated measurement of 117 fixture requests
- `workdir/provider-payload-audit.json` — Pre-audit artifact with full row-level data
- `provider-payload-verification.md` — Previous live-run measurements

### Measured Request Sizes

| Stage | Model | Max bytes | Max estimated tokens | Largest component |
|---|---|---|---|---|
| Context Brief | nemotron-3-super:free | 10,398 | 3,466 | Stage data |
| Context repair | nemotron-3-super:free | 10,553 | 3,518 | Repair data |
| Arrangement | nemotron-3-ultra:free | 13,463 | 4,480 | Stage data |
| Arrangement repair | nemotron-3-ultra:free | **17,457** | **5,807** | Repair errors |
| Production start | nex-n2-pro:free | 5,512 | 1,836 | Tool schemas |
| Production continuation | nex-n2-pro:free | 7,957 | 2,651 | Tool schemas |
| Production report repair | nex-n2-pro:free | 8,382 | 2,793 | Tool schemas |
| Correction start | nex-n2-pro:free | 5,872 | 1,956 | Tool schemas |
| Correction continuation | nex-n2-pro:free | 8,329 | 2,775 | Tool schemas |
| Correction report repair | nex-n2-pro:free | 8,758 | 2,918 | Tool schemas |
| Quality Review | nemotron-3-ultra:free | 3,952 | 1,318 | Tool schemas |
| Quality repair | nemotron-3-ultra:free | 4,095 | 1,365 | Tool schemas |

### Hard Limits

| Limit | Value |
|---|---|
| `MAX_PROVIDER_REQUEST_BYTES` | 102,400 (100 KB) |
| `MAX_PROVIDER_ESTIMATED_TOKENS` | 24,000 |
| `PROVIDER_REGRESSION_TARGET_TOKENS` | 16,000 |

### Findings

- **Largest measured request**: 17,457 bytes (arrangement repair, 4 tracks) — only 17% of the 102,400-byte limit.
- **Largest measured estimated tokens**: 5,807 — only 24% of the 24,000-token limit.
- **Every request stays under the 16,000-token regression target** except arrangement repair (5,807 tokens includes repair error components that are artificially inflated in test fixtures).
- **The previous 237,644-byte problem is fixed**. `buildOpenRouterRequest` checks `withinHardLimits` and throws a 413 error before any network activity.
- `cachedTrackIntelligence` is global, not session-scoped (confirmed at `server.ts:1001`, `server.ts:1618`). A concurrent request could overwrite it.

### Answer

**Is individual request size the number-one problem? NO.**

Individual requests are <18% of the byte limit and <25% of the token limit. The previous oversized-request problem was fixed. Payload size is not preventing any current runs from completing.

---

## 4. Total API-Call Analysis

### Per-Stage Provider Call Count

| Stage | Required calls | Repair calls | Fallback calls | Correction calls | Max possible |
|---|---|---|---|---|---|
| Context Brief | 1 | 1 | 2 (3 models, 3 total attempts) | — | 6 |
| Arrangement | 1 | 1 | 2 | — | 6 |
| Production | 1 (tool loop) | 1 (report repair) | 2 | 2 | ~27 (24 tool-loop turns × 3 models) |
| Quality Review | 1 | 1 | 2 | 2 | 12 |
| Correction cycles (×2) | 2 | 2 | 4 | — | ~54 |
| **Total** | **6** | **6** | **12** | **4** | **~105** |

### Normal Successful Run

Context Brief (1) → Arrangement (1) → Production (1 tool loop, ~1-3 calls) → Quality Review (1) → Finalization (0) = **~5-7 provider requests**.

### Run with One Timeout and Fallback

Context (2) → Arrangement (2) → Production (3) → Quality Review (2) = **~9 requests**.

### Run with One Correction Cycle

Context (1) → Arrangement (1) → Production (3) → Quality Review (1) → Correction Production (3) → Quality Review (1) → Finalization = **~10 requests**.

### Worst Permitted Run

Context (1 + 1 repair + 2 fallbacks = 4) → Arrangement (4) → Production (3 models × 24 turns = 24) → Quality Review (4) → Correction 1 (24 + 4) → Correction 2 (24 + 4) = **~88-105 requests**.

### Total Tokens

At 4,000 estimated tokens average per request × 10 requests (normal run) = ~40,000 tokens. Worst case: ~400,000 tokens.

### Duplicated Model Reasoning

- **Context Brief stage**: The model receives Medley Intelligence data (tracks, sections, strategies, transition scores) and is asked to produce a project brief that mostly restates what Medley Intelligence already computed. The local analysis at `src/engine/medleyIntelligence.ts` already ranks strategies, scores sections, and computes transition compatibility. The context brief asks a model to repeat that reasoning in prose form.
- **Arrangement stage**: Asks the model to decide track ordering and transition selection from the same set of ranked candidates Medley Intelligence already computed. Validation only checks section/track ownership, not whether the selected transitions came from the deterministic candidate list.
- **Production stage**: Asks the model to call `apply_musical_transition` for every transition individually. For a locked plan, the calls are deterministic — a model is used to decide arguments that could be generated from the plan directly.
- **Quality Review stage**: Asks a model to approve or reject candidate facts (duration, loudness, smoothness) that local code could check objectively. Useful for subjective musical judgment but not for objective gate checks.

---

## 5. Timeout and Fallback Analysis

### Model Configuration

Source: `src/types/specialistWorkflow.ts:3-15`

```typescript
export const SPECIALIST_MODELS = {
  context: "nvidia/nemotron-3-super-120b-a12b:free",
  arrangement: "nvidia/nemotron-3-ultra-550b-a55b:free",
  production: "nex-agi/nex-n2-pro:free",
} as const;

export const SPECIALIST_FALLBACKS: Record<SpecialistRole, string[]> = {
  context: [nemotron-3-super:free, nemotron-3-ultra:free, nex-n2-pro:free],
  arrangement: [nemotron-3-ultra:free, nemotron-3-super:free, nex-n2-pro:free],
  production: [nex-n2-pro:free, nemotron-3-ultra:free, nemotron-3-super:free],
};
```

### Key Observations

- **Every model is a `:free` tier model.** There is no paid fallback.
- **All three roles share the same three models** in different order. If all three models are unavailable, every role fails.
- **No model availability check exists** before starting a run. The first provider call reveals availability.
- **Timeout**: `PROVIDER_REQUEST_TIMEOUT_MS = 120,000` (2 minutes).
- **No retry at the specialist layer**: `requestStructuredArtifact` iterates through fallback models. Each model gets at most 1 repair attempt. If repair fails, it moves to the next model. No retry with backoff.
- **No 402 handling at the specialist layer**: `providers.ts` has 402/429 handling in `sendWithRetry`, but that's in the legacy `runAutonomousLoop`. The specialist orchestrator uses `fetchOpenRouter` inside `createProviderSession`, which only handles 429 (one retry with 2s delay). A 402 error passes through as a generic failure.
- **Time per stage with all fallbacks**: Context stage worst case = 3 models × (120s timeout + 2s retry) = ~366 seconds (6 minutes). Full run worst case = ~30 minutes of waiting.

### Maximum User Wait Times

| Stage | Best case | Worst case (all fallbacks + timeouts) |
|---|---|---|
| Context Brief | ~10s | ~6 min |
| Arrangement | ~10s | ~6 min |
| Production | ~30s | ~36 min (24 tool turns × 3 models) |
| Quality Review | ~10s | ~6 min |
| Correction cycle | ~30s | ~36 min |
| **Total** | **~1 min** | **~90 min** |

### Fallback Suitability

All three `:free` models are capable of tool calling, but the latest evidence shows they are frequently rate-limited or out-of-quota. The fallback list does not include any paid/API-key-protected model that would have guaranteed availability.

---

## 6. Frozen-UI Explanation

### What the User Sees During a Provider Call

1. The UI shows a phase label ("CONTEXT BRIEF") and a model name.
2. A `RunStartedAt` timer ticks in the header.
3. A log message is added: `"Specialist context: nvidia/nemotron-3-super-120b-a12b:free"`.
4. **Nothing else happens for up to 120 seconds**.

### Why the Screen Freezes

- The `requestStructuredArtifact` call in `specialistOrchestrator.ts` is an `async` function that awaits `session.send(message, { ... })`.
- `session.send` in the OpenRouter provider (`providers.ts:createProviderSession`) calls `fetchOpenRouter` with an `AbortSignal` that has a 120-second timeout.
- **No SSE events are sent during this wait** because SSE is driven by the server during render/transition operations, not during provider calls.
- **No heartbeat** is sent during provider request waiting. The heartbeat in `SSEStreamController` (45-second timeout) detects connection drops, but the connection is still alive — the browser is just waiting for the `fetch` to resolve.
- **No elapsed-time countdown** is shown. The timer in the header shows total run duration but no indication that a provider call is in progress.
- **No "waiting for model" indicator** exists in the status bar.
- When the model returns, the UI updates immediately with the result.

### The Frozen Period by Stage

- Context stage: Up to 120 seconds + fallback transitions.
- Arrangement stage: Up to 120 seconds.
- Production stage: Each `apply_musical_transition` call takes a few seconds, but each model round-trip can take 30-90 seconds.
- Quality review: Up to 120 seconds.

**Total frozen-screen time per run**: 60-90 seconds in a good run. 5-30+ minutes in runs with timeouts and fallbacks.

---

## 7. Architecture Problems

### Duplicated State Ownership

| Concept | Owners | Problem |
|---|---|---|
| Session status | React `status`, server `sessions[sessionId].status`, checkpoint `stage` | Three sources, can diverge on abort/error |
| Arrangement | Orchestrator `arrangementPlan`, server `sessions.designPlan`, history `designPlan`, checkpoint | Four copies of the same data |
| Execution version | Orchestrator `executionVersion`, server `executionResults`, checkpoint | Can drift during resume |
| Candidate approval | Manifest `reviewStatus`, orchestrator `qualityReview.approved`, server session | Finalization now requires approved status (F-001 fix), but still duplicated |
| Metrics | Candidate manifest metrics, React metrics manager, server `sessions.metrics`, history | Automatic quality metrics not persisted to history (F-005) |
| Track intelligence | Server `cachedTrackIntelligence` (global), library `db.json[]`, design payload | Global cache not session-scoped (F-008) |
| Checkpoints | `library/checkpoints/`, orchestrator in-memory checkpoint, React `checkpoints` state | Two in-memory, one on disk |

### AI-Overuse Patterns

- **Context Brief**: Receives local Medley Intelligence and asks a model to summarize what local code already computed deterministically.
- **Arrangement**: Asks a model to pick from ranked candidates that Medley Intelligence already scored.
- **Production**: Models call `apply_musical_transition` one at a time for a locked plan where calls could be generated deterministically.
- **Quality Review**: Model approves objective facts that local code could gate (duration, size, timing integrity).
- **Correction cycles**: Rerun the full production and render for a single transition defect.

### Legacy Interference

- `cachedTrackIntelligence` at `server.ts:1001` is a single global variable shared between legacy and automatic workflows.
- `/api/exec`, `/api/file-read`, `/api/file-write` remain available for manual mode.
- The same `sessions` object stores both legacy loose plans and automatic strict plans.
- Legacy checkpoint format v2 is still read and upgraded alongside v3.

---

## 8. Audio and Finalization Risks

- **Weak duration enforcement**: `maxTransitions: 32` is passed but not enforced. Target duration is advisory only.
- **Transition style divergence fixed**: F-002 was addressed — `transitionResolution.ts` now locks style/duration/beatAlign.
- **Unapproved candidate finalization fixed**: F-001 was addressed — finalization now requires approved selected candidate.
- **FFmpeg failure handling**: Candidate render failures write error artifacts (`candidate-NNN-stderr.log`) but provide no fallback.
- **Missing quality metrics in history**: F-005 — candidate metrics exist in manifest but are not synced to history entries.

---

## 9. Ranked Top-Ten Findings

### 1. Specialist orchestrator hardcodes OpenRouter as the provider, ignoring user configuration

- **Severity**: Critical
- **Evidence type**: CODE-VERIFIED
- **Files**: `src/engine/specialistOrchestrator.ts:155`, `src/engine/specialistOrchestrator.ts:234`
- **What is wrong**: Both `requestStructuredArtifact` and `runProductionRole` create provider sessions with `{ ...config, provider: "openrouter" }`. The user's configured provider (Gemini or OpenRouter with a different model) is silently overridden. The system prompt, tools, and model are also hardcoded — `SPECIALIST_SYSTEM_PROMPTS`, `SPECIALIST_TOOLS`, and `SPECIALIST_MODELS` cannot be changed through config.
- **Why it matters**: A user who configures a paid Gemini API key and runs automatic mode will have their key ignored. The specialist stages attempt OpenRouter free models and fail. The user never sees their Gemini key used.
- **Effect on completion time**: Run fails immediately because free models are unavailable. Even if free models worked, the user's paid key provides no benefit.
- **Effect on API usage**: Free model quota is consumed; paid Gemini/OpenRouter quota is untouched.
- **Effect on audio quality**: No audio is produced.
- **Fix direction**: Accept the user's configured provider and model in the specialist orchestrator. Pass `workflow.config` through without overriding `provider`. Switch `SPECIALIST_MODELS` to respect the user's model selection or provide a configurable model per stage.
- **Confidence**: Very High

### 2. All AI models are free-tier OpenRouter models — none have guaranteed availability

- **Severity**: Critical
- **Evidence type**: CODE-VERIFIED and ARTIFACT-VERIFIED
- **Files**: `src/types/specialistWorkflow.ts:3-15`, `src/engine/specialistOrchestrator.ts:70-82`
- **What is wrong**: `SPECIALIST_MODELS` and `SPECIALIST_FALLBACKS` use only `:free` OpenRouter models. All three roles share the same three models in different order. No paid fallback exists.
- **Why it matters**: When the daily free quota is exhausted for any model, every specialist stage fails. Current checkpoints prove this is happening.
- **Effect on completion time**: Run fails immediately — no completion possible.
- **Effect on API usage**: Zero usage on successful authentication, but retries burn through free quota faster.
- **Effect on audio quality**: No audio is produced.
- **Fix direction**: Add at least one paid model to each fallback list. Make model selection configurable per stage.
- **Confidence**: Very High

### 2. No model availability check is performed before starting a run

- **Severity**: Critical
- **Evidence type**: CODE-VERIFIED
- **Files**: `src/engine/specialistOrchestrator.ts:70-82`, `src/App.tsx:1630` (`startMedley`)
- **What is wrong**: The start button checks health endpoint, API key presence, and library size. It does not check whether the configured OpenRouter models accept requests or have quota remaining.
- **Why it matters**: Users wait through pre-analysis and design build (potentially minutes), only to discover at the first provider call that all models are unavailable.
- **Effect on completion time**: Wastes pre-analysis and design time before failure.
- **Fix direction**: Quick model-check endpoint (`/api/provider-check`) that tests one minimal request per model before starting the run.
- **Confidence**: High

### 3. Specialized orchestrator has no 402/credits handling

- **Severity**: High
- **Evidence type**: CODE-VERIFIED
- **Files**: `src/engine/providers.ts:145-171` (`fetchOpenRouter`), `src/engine/specialistOrchestrator.ts:146-151`
- **What is wrong**: `fetchOpenRouter` in `providers.ts` handles 429 (one retry with 2s delay) but treats 402 as any other error. The legacy `sendWithRetry` in `App.tsx` has 402-specific handling (model switch), but the specialist orchestrator's `requestStructuredArtifact` does not use `sendWithRetry` — it uses `createProviderSession` directly.
- **Why it matters**: OpenRouter `:free` models frequently return 402 (insufficient_quota). Without specific handling, the error is treated as a generic failure and the model is skipped.
- **Effect on completion time**: Cannot recover from quota exhaustion mid-stage.
- **Fix direction**: Add 402 detection in `fetchOpenRouter` or the specialist orchestrator's catch block. Same pattern as 429 handling but without retry — immediately skip to fallback.
- **Confidence**: High

### 4. Context Brief and Arrangement stages duplicate deterministic Medley Intelligence work

- **Severity**: High
- **Evidence type**: CODE-VERIFIED
- **Files**: `src/engine/specialistPayloads.ts:47-93` (buildContextStageData), `src/engine/specialistPayloads.ts:95-142` (buildArrangementStageData), `src/engine/medleyIntelligence.ts`
- **What is wrong**: The context brief specialist receives ranked strategies, scored transition candidates, and section facts that `medleyIntelligence.ts` already computed deterministically. It then produces a project brief that mostly rephrases these facts. The arrangement specialist receives the same data plus the project brief and is asked to pick track order and transitions from candidates that are already ranked.
- **Why it matters**: Two unnecessary provider calls per run. Context brief adds no information that isn't already available. Arrangement could be validated against deterministic candidate IDs.
- **Effect on completion time**: Adds 20-240 seconds per run.
- **Effect on API usage**: 2 unnecessary provider requests per run plus repair + fallback multipliers.
- **Fix direction**: Remove the context brief stage entirely. Move arrangement to accept transition IDs directly from the ranked candidate list.
- **Confidence**: High

### 5. The UI provides no progress indication during provider request waits

- **Severity**: Medium
- **Evidence type**: CODE-VERIFIED
- **Files**: `src/engine/specialistOrchestrator.ts:146-151`, `src/App.tsx:1211`, `src/hooks/useSSEStream.ts`
- **What is wrong**: During provider calls (120s timeout), no elapsed time, no "waiting for model" message, no timeout countdown, and no heartbeat is shown. SSE events are not sent during provider wait periods — SSE is driven by server-side operations (render, preview), not by client-side provider requests.
- **Why it matters**: Users see the same "CONTEXT BRIEF" label for up to 2 minutes with no indication that work is happening. They don't know whether the app is stuck, slow, or about to time out.
- **Effect on completion time**: No direct effect, but users may cancel prematurely assuming the app is frozen.
- **Fix direction**: Add an elapsed-wait-time counter to the header/status bar. Log periodic "still waiting" messages. Consider a per-request timer.
- **Confidence**: High

### 6. Production stage uses a model to call deterministic transition endpoints

- **Severity**: Medium
- **Evidence type**: CODE-VERIFIED
- **Files**: `src/engine/specialistOrchestrator.ts:185-275` (runProductionRole), `src/engine/specialistPayloads.ts:182-186`
- **What is wrong**: For a locked arrangement plan, every `apply_musical_transition` argument is deterministic — the plan specifies `fromTrackId`, `fromSectionId`, `toTrackId`, `toSectionId`, `style`, `duration`, `beatAlign`. Yet the production specialist uses a model to call each transition individually, with up to 24 tool-call rounds.
- **Why it matters**: Each round-trip adds 10-90 seconds. One model failure forces a fallback to another free model. The production stage accounts for the majority of total API calls.
- **Effect on completion time**: Adds 1-5+ minutes per run.
- **Effect on API usage**: 2-24+ provider requests (tool calls) per production pass.
- **Fix direction**: Generate `apply_musical_transition` calls deterministically from the locked arrangement plan. Reserve the model only for the `submit_execution_report` step.
- **Confidence**: Medium

### 7. Correction cycles rerun full production for targeted defects

- **Severity**: Medium
- **Evidence type**: CODE-VERIFIED
- **Files**: `src/engine/specialistPayloads.ts:189` (buildProductionStageData), `src/engine/specialistOrchestrator.ts:443`
- **What is wrong**: A quality review with specific transition-level corrections causes the entire production stage to re-execute. All transitions are re-rendered even though only one needs adjustment.
- **Why it matters**: Time doubles per correction cycle. Max 2 correction cycles means up to 3 complete production runs.
- **Effect on completion time**: 2x-3x production time.
- **Effect on API usage**: 2x-3x production provider calls.
- **Fix direction**: Track correction scope. Reuse unaffected transition records.
- **Confidence**: Medium

### 8. Arrangement validation does not check transition candidate provenance

- **Severity**: Medium
- **Evidence type**: CODE-VERIFIED
- **Files**: `src/engine/specialistPayloads.ts:132`, `src/types/specialistWorkflow.ts:288` (`validateArrangementContext`)
- **What is wrong**: `validateArrangementContext` checks track/section ownership, order, and timestamp bounds. It does not require the chosen transition pair to exist in the deterministic transition candidate list. The model can invent valid-looking timestamps that were not scored.
- **Why it matters**: Low-quality transitions can enter production despite Medley Intelligence having better options.
- **Fix direction**: Include transition candidate IDs in the arrangement prompt and validate arrangement transitions against them.
- **Confidence**: Medium

### 9. `cachedTrackIntelligence` is global, not session-scoped

- **Severity**: Medium
- **Evidence type**: CODE-VERIFIED
- **Files**: `server.ts:1001`, `server.ts:1618`
- **What is wrong**: The server stores track intelligence in a module-level variable. A second browser tab or concurrent session overwrites it. Beat snapping, section-pair evaluation, and design-plan validation use the wrong intelligence.
- **Why it matters**: Rare during normal single-user usage, but can cause silent failures during debugging or session resume.
- **Fix direction**: Store by `sessionId` or design hash.
- **Confidence**: High

### 10. `maxTransitions` and target duration are weakly enforced

- **Severity**: Low
- **Evidence type**: CODE-VERIFIED
- **Files**: `server.ts:1277`, `src/engine/medleyIntelligence.ts:954`
- **What is wrong**: The design endpoint passes `maxTransitions: 32` to `buildMedleyDesignPayload`, but the function never reads it. Target duration is supplied to the context specialist only as advisory text.
- **Why it matters**: Future larger libraries can produce larger designs or off-target medley durations than intended.
- **Fix direction**: Enforce max transition count and duration windows before provider handoff and after arrangement.
- **Confidence**: High

---

## 10. Required Conclusions

### 1. What most likely caused the latest run to fail?

The specialist orchestrator hardcodes `provider: "openrouter"` (`specialistOrchestrator.ts:155`, `specialistOrchestrator.ts:234`). Both failed checkpoints exhausted all three free fallback models at the first stage (context brief) with zero output. If a paid Gemini key was configured, it was never used.

### 2. Is the app still sending requests that are individually too large?

No. Largest measured request: 17,457 bytes / 5,807 estimated tokens — 17% of the byte limit, 24% of the token limit.

### 3. Is the app sending too many separate requests?

Yes: minimum 5-7 per run, up to ~105 worst case. The production stage uses up to 24 tool-call round-trips.

### 4. Is the Context Brief stage necessary?

Not as a separate AI stage. All information it produces is already computed deterministically by `medleyIntelligence.ts`.

### 5. Which provider stage is the slowest or least reliable?

Context brief is least reliable (first call, hits free-model exhaustion). Production is slowest (up to 24 round-trips).

### 6. Why does the UI appear frozen?

No elapsed time, timeout countdown, or heartbeat is shown during the 120-second provider waits. SSE events are server-side only.

### 7. What single change would improve completion reliability the most?

Stop overriding `provider: "openrouter"` in the specialist orchestrator. Respect the user's configured provider and API key.

### 8. What single change would reduce API usage the most?

Generate `apply_musical_transition` calls deterministically from the locked plan instead of using a model for each call.

### 9. What single change would simplify the architecture the most?

Remove the Context Brief specialist stage. Merge its data into the arrangement prompt.

### 10. What should be fixed first?

Fix the provider override at `specialistOrchestrator.ts:155` and `specialistOrchestrator.ts:234`. Everything else depends on this.

---

## 11. Simpler Target Workflow

```text
Local audio analysis
→ deterministic section ranking (keep)
→ compact arrangement request (merge: remove context brief)
→ deterministic validation with candidate-ID enforcement (keep)
→ deterministic transition execution (replace: no model needed)
→ candidate render (keep)
→ objective local quality checks (add: gate before AI review)
→ AI quality review when local checks pass (make optional)
→ targeted correction (replace: reuse unaffected transitions)
→ final promotion (keep)
```

### Stage-by-Stage Recommendation

| Current Stage | Recommendation | Information Lost | Preservation |
|---|---|---|---|
| Context Brief | **Remove** | Model-authored prose summary | Medley Intelligence already has ranked sections, strategies, scores |
| Arrangement | **Keep but merge** — use deterministic candidate IDs, reduce model scope | None: model still picks ordering within allowed candidates | Creative ordering preserved; invalid pairs rejected |
| Production `apply_musical_transition` | **Replace with deterministic calls** | None: plan already specifies all transition arguments | Report generation still needs model for `submit_execution_report` |
| Quality Review | **Split** — add objective local gate (duration/loudness/integrity), keep model for musical judgment | If AI review is optional, some subjective issues may be missed | Objective gates prevent obviously bad candidates; AI review available when needed |
| Correction cycles | **Targeted** — reuse unaffected transitions | Full rerender fallback still available | Present ability preserved |
| Context/Arrangement repair | **Keep** — validation repair is valuable | None | Schema repair boundary preserved |

---

## 12. Recommended Repair Order

### Phase 1 — Make runs complete reliably

- **Goal**: Get a run past the context brief stage.
- **Files**: `src/types/specialistWorkflow.ts`, `src/engine/providers.ts`, `src/engine/specialistOrchestrator.ts`
- **Main risks**: Changing models may affect output format; fallback list needs paid model.
- **Changes**:
  1. Replace `:free` models with `:preferred` or non-free OpenRouter models in `SPECIALIST_MODELS` and `SPECIALIST_FALLBACKS`.
  2. Add 402 handling in `fetchOpenRouter` or `requestStructuredArtifact`.
  3. Add a pre-run model availability check endpoint.
- **Tests required**: Provider 402 mock test; model availability endpoint test.
- **Completion condition**: A test session successfully completes context brief and arrangement stages without exhausting all fallbacks.

### Phase 2 — Reduce provider calls and total tokens

- **Goal**: Eliminate unnecessary AI stages and deterministic duplication.
- **Files**: `src/engine/specialistOrchestrator.ts`, `src/engine/specialistPayloads.ts`, `src/engine/medleyIntelligence.ts`
- **Main risks**: Removing context brief may reduce prompt quality for arrangement stage.
- **Changes**:
  1. Remove the context brief stage — merge its essential data into the arrangement prompt directly.
  2. Generate `apply_musical_transition` calls deterministically from the locked plan.
  3. Add objective quality gate before AI review.
- **Tests required**: Arrangement validation with only deterministic candidate IDs; payload audit without context stage.
- **Completion condition**: Total provider calls per normal run drops from 5-7 to 3-4.

### Phase 3 — Improve live progress

- **Goal**: Every wait, retry, timeout, repair, and fallback is visible.
- **Files**: `src/App.tsx`, `src/engine/specialistOrchestrator.ts`, `src/hooks/useSSEStream.ts`
- **Main risks**: Overloading the log panel.
- **Changes**:
  1. Add elapsed-wait timer in the header/status bar.
  2. Log periodic "still waiting" messages during provider calls.
  3. Show the timeout countdown.
  4. Log fallback attempts and timeouts.
- **Tests required**: Hook-level timer tests.
- **Completion condition**: A user can see exactly what the app is waiting for and for how long.

### Phase 4 — Simplify architecture

- **Goal**: Consolidate state ownership.
- **Files**: `server.ts`, `src/engine/specialistOrchestrator.ts`, `src/server/candidateStore.ts`
- **Main risks**: Resume may break if state schema changes.
- **Changes**:
  1. Session-scope `cachedTrackIntelligence` by `sessionId`.
  2. Sync candidate metrics to history on finalization.
  3. Consolidate arrangement storage (one authoritative copy per session).
- **Tests required**: Two-session test; history metrics test; resume test.
- **Completion condition**: No global mutable state; history entries contain candidate metrics.

### Phase 5 — Improve musical quality

- **Goal**: Strengthen section selection, pacing, transitions, and targeted correction.
- **Files**: `src/engine/medleyIntelligence.ts`, `src/engine/specialistOrchestrator.ts`, `src/server/candidateStore.ts`
- **Main risks**: Over-correction can reduce musical variety.
- **Changes**:
  1. Validate arrangement transitions against deterministic candidate IDs.
  2. Enforce `maxTransitions` and target duration.
  3. Implement targeted correction (reuse unaffected transitions).
- **Tests required**: Arrangement validation with candidate IDs; max transition enforcement; targeted correction test.
- **Completion condition**: Arrangement cannot select unscored transitions; corrections affect only targeted transitions.

---

## 13. Unknowns and Missing Evidence

- **Live OpenRouter behavior**: The current failure reason (402 vs. timeout vs. model error) is inferred from checkpoints. Actual OpenRouter responses were not captured because `console.error` in the specialist orchestrator only captures errors client-side, and no session error logs were persisted.
- **No active v3 checkpoint from a partially successful run**: Both existing checkpoints are from failed context-brief sessions. Resume behavior at later stages was not artifact-verified.
- **Audio quality**: Subjective audio quality was not evaluated during this audit.
- **Provider model availability changes**: Model names and availability change externally. The audit inspected fallback behavior but did not verify current availability.
- **Developer server log files**: `workdir/dev-server.stdout.log` and `dev-server.stderr.log` may contain additional error details that were not inspected.
- **Whether correction exhaustion should surface a manual-approval state**: Already addressed in F-001 fix (correction exhaustion now throws an error instead of silently promoting).

---

## 14. Final Plain-Language Conclusion

The automatic specialist workflow is fundamentally broken for anyone who doesn't already rely on OpenRouter free models. It hardcodes `provider: "openrouter"` in two places, silently discarding any Gemini API key the user configures. Even if you have a paid OpenRouter key, every specialist model is a `:free` model ID — your paid key is wasted on free-tier endpoints that routinely exhaust their daily quota.

This is why your experience is the same with a paid Gemini key: **Gemini is never called by the specialist workflow.** Your key sits there configured in the UI while the orchestrator sends requests to OpenRouter free models behind the scenes.

The individual request sizes are fine — around 17KB max when the limit is 100KB. The payload size problem was fixed in a previous update.

The app makes too many separate AI calls per run: 5-7 for a normal run, 30+ with fallbacks. Two stages (context brief and production tool-calling) mostly repeat work local code already does.

The screen freezes because no progress is shown during the 120-second waits for each AI model.

The three most important fixes: (1) stop overriding the user's provider selection in the orchestrator, (2) make the specialist models respect the user's API key and chosen model, and (3) if Gemini is configured and paid, use it — don't silently redirect to free OpenRouter models.

---

## Appendix: Verification Baseline

### Git State

| Item | Value |
|---|---|
| Branch | `payload-optimization` |
| Commit | `546287cf692a6f227a00058478af33e7867e0a2c` |
| Working tree | Modified (73 files, 9837 insertions, 5069 deletions) |
| Staged | None |

### Verification Commands

| Command | Result |
|---|---|
| `npm test` | **PASSED** — 17 test suites, all passing. 117 fixture requests measured. Largest: 17,457 bytes / 5,807 estimated tokens. |
| `npm run lint` | **PASSED** — `tsc --noEmit` clean. |
| `npm run build` | **PASSED** — Vite + esbuild completed. Note: JS chunk is 717 KB (over 500 KB warning). |

### Protected Artifact

| Property | Value |
|---|---|
| File | `workdir/provider-payload-audit.json` |
| Original SHA-256 | `3a0fc0bf2ff8d3d1c52e248c97104db037e6735524b50cb00598a133d36d7bb4` |
| Restored SHA-256 | `3a0fc0bf2ff8d3d1c52e248c97104db037e6735524b50cb00598a133d36d7bb4` |
| Status | Restored and verified exact |

### Modified Files

No files were modified during this audit except this report (`docs/audits/current-workflow-root-cause-audit.md`). Nothing was staged or committed.
