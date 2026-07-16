# Claude Fable 5 Final Stabilization Review Package

> **Historical review package — not current instructions.** This package was
> prepared from the repository state on 2026-07-05. Current behavior is defined
> by `docs/current-operations.md`, `AGENTS.md`, and `task_plan.md`.

Prepared: 2026-07-05  
Repository: `G:\ai-medley--main`  
Branch: `payload-optimization`  
Purpose: read-only commit-scope review and selective-staging guidance. This package does not authorize staging, committing, cleanup, provider calls, or protected-data mutation.

## Review conclusion

- Implementation Phases 0 through 11 are complete.
- No implementation phase remains.
- The final project verification passed: `npm test`, `npm run lint`, controlled `npm run build`, and `git diff --check`.
- Phase 9 clean-install verification, production startup smoke, Phase 10 browser/accessibility verification, and Phase 11 offline dependency audit passed.
- No application code was changed while preparing this package.
- At collection time, zero files were staged and zero tracked files were deleted.
- The worktree was already heavily dirty before the stabilization audit. Path classification below is advisory; mixed tracked-file history still requires diff/hunk review.

> **Critical staging warning:** Do not run `git add -A`, `git add .`, or any equivalent broad staging command. Use path-specific and/or interactive staging, then inspect `git diff --cached` before committing.

## Phase status

| Phase | Status | Verified outcome |
|---:|---|---|
| 0 | Complete | Default tests made non-mutating; provider payload audit moved to guarded OS temporary storage |
| 1 | Complete | Fail-closed atomic stores and transactional source lifecycle |
| 2 | Complete | Recoverable finalization journal and candidate/legacy integrity |
| 3 | Complete | Canonical transition compilation, valid previews, objective quality gate |
| 4 | Complete | Versioned, source-bound, cancellable analysis |
| 5 | Complete | Session authority, bound resume decisions, replayable SSE |
| 6 | Complete | Provider/config/semantic/payload/manual-contract unification with mocked responses |
| 7 | Complete | Local capability, path, upload, and secret containment |
| 8 | Complete | Preserve-only inventory and declared resource envelopes |
| 9 | Complete | Reproducible packaging, disposable clean install, and production smoke |
| 10 | Complete | Accessible/recoverable browser workflows; matrix 47/47 and Lighthouse 1.00 |
| 11 | Complete | Proven dead-dependency removal and checked documentation closure |

Authoritative evidence: [implementation progress](2026-07-04-implementation-progress.md) and [current operations](../current-operations.md).

## Final verification evidence

| Verification | Result |
|---|---|
| `npm test` | Passed; all focused suites passed, the provider payload audit covered 117 mocked requests, its report was verified outside the repository, and the release documentation contract passed |
| `npm run lint` | Passed (`tsc --noEmit`) |
| Controlled `npm run build` | Passed; pre-existing `dist` was restored byte-exact afterward |
| `git diff --check` | Passed |
| Phase 9 clean install | Passed in a disposable G:-only copy with isolated npm cache/temp; install, tests, lint, build, and production start passed |
| Production smoke | Passed using an owned child process, isolated data root, and owned local port |
| Browser matrix | Passed 47/47 using mocked local APIs; no provider or unexpected API call occurred |
| Accessibility | axe reported zero WCAG A/AA violations; isolated Lighthouse accessibility score was 1.00 with zero failed audits |
| Offline dependency audit | Passed with zero info, low, moderate, high, or critical vulnerabilities |

The final package-preparation task did not rerun the expensive verification suite; it read the completed verification records and gathered fresh Git/protected-state metadata. The immediately preceding final review reran all four required project commands successfully.

## Protected data status

No protected user-data class changed during stabilization verification or final review: source audio, library data, history, wisdom, checkpoints, candidates, manifests, completed outputs, environment files, and pre-existing workdir artifacts remained unchanged. Fresh pre-package and post-package fingerprints were identical and matched the completed Phase 11/final-review fingerprints:

| Protected item | SHA-256/state |
|---|---|
| `library/` aggregate | `9E02386EB674C60508AA6967650FFC286530F0925E270FE0B63E6483D65561C2` |
| `workdir/` aggregate | `6EA600F2FFFF48901C966FF514DA75DA42094F8733A61D8BCEA2E372EC1D52CE` |
| `dist/` aggregate | `CF4384AA2DE1A4510050ECE928FF4B41C354372591F817B78B8DA252438C64A9` |
| `.env` | `8E2C5426863C6C5951C80820C82E4D1B20D5D485EA0DC37E1AAAA41AC9767467` |
| `.env.example` | `B6D12C728DE0AAC8B0BC6239E53AA8088C1431BCB4F9A3D61E5E8A2DF1C7C400` |
| `.env.local` | Missing before and after |
| `workdir/provider-payload-audit.json` | `B3E6ED759B22BC67038CF25D075D763BD8FBA39A552C4EF817EDF8BE49828DDB` |

These hashes disclose no environment values or private content.

## Preserved safety incidents

### Provider payload audit overwrite

During the earlier audit, the baseline `npm test` run unexpectedly overwrote the pre-existing protected `workdir/provider-payload-audit.json`. Exact original bytes were unrecoverable. The current artifact was then frozen at SHA-256 `B3E6ED759B22BC67038CF25D075D763BD8FBA39A552C4EF817EDF8BE49828DDB`. The test was corrected to write a guarded OS-temporary report and to use deterministic synthetic inputs instead of protected library data. This incident remains explicitly recorded and must not be erased, minimized, or represented as full preservation of the original artifact.

### Chrome/Lighthouse singleton

The first Lighthouse run wrote a valid 0.98 report, but Chrome singleton behavior parented audit renderer processes to a pre-existing personal Chrome process despite a temporary folder. No account or external site was accessed, and no personal process was touched or terminated. The rerun used an explicit disposable G:-only user-data directory and produced a 1.00 accessibility report with zero failures. Both runs reported `EPERM` only while cleaning their separate G: temporary directories after the reports were written. Disposable evidence remains present.

## Dependency closure

The following declarations were removed only after repository-wide import, require, dynamic-import, configuration, and script inspection proved them unused:

- `@google/generative-ai`: dead duplicate SDK; active code imports `@google/genai`.
- `motion`: no runtime import or use.
- `autoprefixer`: no build/configuration use in the Tailwind/Vite setup.

The lockfile removes only those packages and their unique unreachable entries. Dynamic `essentia.js` and all other active runtime/toolchain packages were retained. A clean `npm ci` proved lockfile reproducibility, and the offline audit reported zero vulnerabilities.

## Git status summary

Collection before creating this package reported:

- Modified tracked files: 77.
- Tracked diff: 12,545 insertions and 5,720 deletions.
- Untracked files: 224 before this package; this package adds one additional likely-stabilization audit file.
- Staged files: 0.
- Deleted tracked files: 0.
- Staged diff: empty.
- Disposable Phase 9, Phase 10, and Phase 11 verification folders: present on G: and intentionally retained.

Line-ending notices state that Git may convert LF to CRLF when touching many files. They are warnings, not `git diff --check` failures, but Fable should avoid broad staging that may obscure meaningful hunks.

## Modified tracked files

Every currently modified tracked path is listed below. Several predate stabilization or may contain mixed old/new hunks; inclusion here is not a recommendation to stage the whole file.

```text
.claude/agents/ffmpeg-reviewer.md
.claude/skills/clean-workdir/SKILL.md
CLAUDE.md
README.md
docs/plans/2026-05-19-cancel-history-preview.md
docs/plans/2026-05-19-iteration-counter-preanalysis.md
docs/plans/2026-05-23-four-feature-improvements.md
docs/plans/2026-05-24-transition-quality-improvements.md
docs/plans/2026-05-25-session-checkpoints.md
docs/plans/archive/apply-musical-transition-tool.md
docs/plans/master-refactor-goal-tracker.md
docs/plans/pure-clean-finalize-medley.md
docs/plans/pure-clean-timeline-render-engine.md
findings.md
music-tempo.d.ts
package-lock.json
package.json
payload-optimization/EXPERIMENTS.md
payload-optimization/EXPERIMENT_NOTES.md
payload-optimization/NEXT_STEPS.md
payload-optimization/PLAN.md
payload-optimization/README.md
progress.md
provider-payload-verification.md
server.ts
src/App.tsx
src/components/ConfigPanel.tsx
src/components/ExecutionContextPanel.tsx
src/components/Header.tsx
src/components/HistoryBrowser.tsx
src/components/LibrarySidebar.tsx
src/components/LogPanel.tsx
src/components/MedleyMatchPanel.tsx
src/components/MetricsSidebar.tsx
src/constants/thresholds.ts
src/engine/localAudioAnalysis.test.ts
src/engine/localAudioAnalysis.ts
src/engine/medleyIntelligence.test.ts
src/engine/medleyIntelligence.ts
src/engine/prompts.ts
src/engine/providerPayloadAudit.test.ts
src/engine/providerRequest.ts
src/engine/providers.ts
src/engine/specialistOrchestrator.ts
src/engine/specialistPayloads.ts
src/hooks/useMetricsManager.ts
src/hooks/useModelFallback.ts
src/hooks/useSSEStream.ts
src/hooks/useSessionState.ts
src/index.css
src/main.tsx
src/server/candidateStore.test.ts
src/server/candidateStore.ts
src/server/localAccess.test.ts
src/server/localAccess.ts
src/types/autonomousSession.ts
src/types/semanticMemory.ts
src/types/specialistWorkflow.test.ts
src/types/specialistWorkflow.ts
src/utils/checkpointManager.ts
src/utils/configMigration.test.ts
src/utils/configMigration.ts
src/utils/metrics.ts
src/utils/payloadDiagnostics.ts
src/utils/telemetry.ts
task_plan.md
test-mashup-layer-branching.ts
test-progress-reporting.ts
test.ts
test2.ts
test3.ts
test_pip.js
test_pip2.js
test_python.js
test_sdk.ts
tsconfig.json
verify-task5-improvements.ts
vite.config.ts
```

## Untracked-file classification

This classification is based on path purpose and the implementation ledger. It is deliberately conservative.

### Likely stabilization files

These paths correspond directly to implemented phases, regression tests, production verification, current documentation, or the stabilization audit trail. Fable must still inspect their content and relationships before staging.

```text
AGENTS.md
docs/api-routes.md
docs/audits/2026-07-03-complete-stabilization-audit-progress.md
docs/audits/2026-07-03-complete-stabilization-audit.md
docs/audits/2026-07-04-fable-final-review-package.md
docs/audits/2026-07-04-implementation-progress.md
docs/current-operations.md
docs/plans/README.md
scripts/clean-dist.mjs
scripts/production-smoke.mjs
scripts/release-contract.mjs
src/constants/provider.ts
src/engine/manualToolContracts.test.ts
src/engine/manualToolContracts.ts
src/engine/providerRequest.test.ts
src/engine/providers.test.ts
src/engine/specialistOrchestrator.checkpoint.test.ts
src/engine/specialistPayloads.test.ts
src/server/analysisContract.test.ts
src/server/analysisContract.ts
src/server/analysisJobRegistry.test.ts
src/server/analysisJobRegistry.ts
src/server/artifactInventory.test.ts
src/server/artifactInventory.ts
src/server/audioArtifactProbe.test.ts
src/server/audioArtifactProbe.ts
src/server/automaticSessionGuard.ts
src/server/candidateQualityGate.test.ts
src/server/candidateQualityGate.ts
src/server/checkpointBinding.test.ts
src/server/checkpointBinding.ts
src/server/finalizationTransaction.test.ts
src/server/finalizationTransaction.ts
src/server/jsonStore.test.ts
src/server/jsonStore.ts
src/server/libraryPersistence.test.ts
src/server/libraryPersistence.ts
src/server/pathPolicy.test.ts
src/server/pathPolicy.ts
src/server/redaction.test.ts
src/server/redaction.ts
src/server/renderTransitionSelection.test.ts
src/server/renderTransitionSelection.ts
src/server/resourcePolicy.test.ts
src/server/resourcePolicy.ts
src/server/sessionEventJournal.test.ts
src/server/sessionEventJournal.ts
src/server/sessionFinalizationGuard.test.ts
src/server/startupConfig.test.ts
src/server/startupConfig.ts
src/server/transitionGraph.test.ts
src/server/transitionGraph.ts
src/server/transitionResolution.test.ts
src/server/transitionResolution.ts
src/server/uploadPolicy.test.ts
src/server/uploadPolicy.ts
src/utils/accessibility.test.ts
src/utils/accessibility.ts
src/utils/automaticCheckpoint.test.ts
src/utils/automaticCheckpoint.ts
src/utils/preAnalysisPipeline.test.ts
src/utils/preAnalysisPipeline.ts
src/utils/runGeneration.test.ts
src/utils/runGeneration.ts
src/utils/sseStreamController.test.ts
src/utils/sseStreamController.ts
src/utils/startMedleyPipeline.test.ts
src/utils/startMedleyPipeline.ts
```

### Likely local/tool/private files — do not stage

These 154 files are local agent/editor/tool configuration or generated MCP tool definitions. Keep them outside the stabilization commit unless the owner separately and explicitly requests otherwise.

```text
.agents/**                    (1 file)
.codex/**                     (2 files)
.serena/**                    (2 files)
mcps/**                       (149 files)
```

Also do not stage any external disposable install/browser folder, npm cache, Chrome profile, protected `library/` or `workdir/` content, audio, or environment file. The disposable G: folders are outside this repository and therefore absent from Git status.

### Unclear files needing explicit review

These untracked audits predate the 2026-07-03/04 stabilization ledger. They may be valuable provenance, but the current evidence does not establish that they belong in the same commit:

```text
docs/audits/2026-06-22-end-to-end-workflow-audit.md
docs/audits/2026-06-22-foundational-correctness-fixes.md
docs/audits/current-workflow-root-cause-audit.md
```

## Tracked paths requiring special commit-scope review

Fable should treat these as unclear or mixed-scope even though they are tracked:

- `.claude/**`: personal/local agent configuration; explicitly excluded from staging.
- Existing `docs/plans/**` files: historical plan edits predate Phase 11's new `docs/plans/README.md`; review separately.
- `payload-optimization/**` and `provider-payload-verification.md`: experiment/branch records that may belong to earlier work.
- `task_plan.md`, `findings.md`, and `progress.md`: accumulated multi-session ledgers, not a compact product diff.
- Root scratch/diagnostic files: `test*.ts`, `test*.js`, `test_python.js`, `verify-task5-improvements.ts`, and `test-mashup-layer-branching.ts`.
- `music-tempo.d.ts` and `tsconfig.json`: likely runtime/type-support changes, but review their full diffs and necessity.
- Core files such as `server.ts`, `src/App.tsx`, and provider/analysis files contain large mixed diffs. Review by phase or hunk; do not assume every line was introduced by stabilization.

## Diff-stat summary

Tracked changes only; Git's normal diff stat omits untracked files:

```text
77 files changed, 12545 insertions(+), 5720 deletions(-)
```

The largest tracked diffs are `server.ts`, `src/App.tsx`, `src/engine/medleyIntelligence.ts`, and `src/engine/localAudioAnalysis.ts`. Review those against their focused tests and the phase ledger rather than treating size alone as evidence of correctness.

## Staged diff summary

`git diff --cached --stat` and `git diff --cached --name-only` returned no output. Staged file count was zero. Nothing should be committed until Fable and the repository owner deliberately build and review a staged set.

## Recommended commit message

```text
fix(core): complete stabilization hardening

- make persistence, finalization, provider, upload, and path handling fail closed
- add bounded recovery, payload, resource, and accessibility contracts
- make production packaging reproducible
- align dependencies and operational documentation
```

## Remaining uncertainty

- The repository was already heavily modified and contained untracked implementation files before the stabilization audit. There is no authoritative automatic hunk-level boundary between earlier user work and stabilization work.
- Untracked classification is path-based. The three older audit documents require a human provenance decision.
- Several large tracked files combine prior feature work and stabilization fixes; selective staging may require `git add -p` or a carefully reviewed explicit path list.
- Verification exercised the current Windows/Node 26 host, not every supported Node/Windows combination.
- The build retains the existing greater-than-500-KiB browser chunk warning, and Node emits a transitive loader deprecation warning.
- Provider behavior was verified with mocks only; no live or paid-provider call was made.
- Automated accessibility coverage cannot substitute for every assistive-technology/user combination.
- `.env.example` remains historically stale because environment files were protected; current behavior is documented and contract-tested in `docs/current-operations.md`.
- Deleting disposable browser/install folders later is safe only after the owner decides the retained evidence is no longer needed; deletion is outside this review.

## Recommended Fable review order

1. This package and `2026-07-04-implementation-progress.md`.
2. `docs/current-operations.md`, `docs/api-routes.md`, and `scripts/release-contract.mjs`.
3. `package.json` and `package-lock.json` dependency/build changes.
4. `server.ts` plus new `src/server/**` modules and focused tests, phase by phase.
5. Provider/manual contracts and tests under `src/engine/**`.
6. `src/App.tsx`, accessibility-related components/CSS, and `src/utils/accessibility.test.ts`.
7. Every unclear/mixed-scope path listed above before constructing the staged set.

## Exact information-gathering commands

Run from `G:\ai-medley--main`. No install, cleanup, provider, staging, commit, or deletion command was used.

```powershell
python "$env:USERPROFILE\.codex\skills\planning-with-files\scripts\session-catchup.py" (Get-Location)

git status --short
git diff --stat
git diff --name-only

Get-Content -LiteralPath 'docs\audits\2026-07-04-implementation-progress.md'
Get-Content -LiteralPath 'docs\current-operations.md'

git ls-files --others --exclude-standard
git diff --cached --stat
git diff --cached --name-only

Test-Path -LiteralPath 'G:\ai-medley-clean-install-test'
Test-Path -LiteralPath 'G:\ai-medley-phase10-browser-harness'
Test-Path -LiteralPath 'G:\ai-medley-phase11-clean-install-test'
```

Protected aggregate fingerprints were gathered with this read-only helper:

```powershell
function Get-TreeHash([string]$Path) {
  $resolved = (Resolve-Path -LiteralPath $Path).Path
  $lines = Get-ChildItem -LiteralPath $resolved -Recurse -File -Force |
    ForEach-Object {
      $relative = $_.FullName.Substring($resolved.Length).TrimStart('\')
      $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
      "$relative|$hash"
    } | Sort-Object
  $payload = [Text.Encoding]::UTF8.GetBytes(($lines -join "`n"))
  $sha = [Security.Cryptography.SHA256]::Create()
  try { ([BitConverter]::ToString($sha.ComputeHash($payload))).Replace('-', '') }
  finally { $sha.Dispose() }
}

Get-TreeHash 'library'
Get-TreeHash 'workdir'
Get-TreeHash 'dist'
Get-FileHash -LiteralPath '.env' -Algorithm SHA256
Get-FileHash -LiteralPath '.env.example' -Algorithm SHA256
Get-FileHash -LiteralPath 'workdir\provider-payload-audit.json' -Algorithm SHA256
```

The helper was run before and after writing this package. Package integrity and secret-shape checks used:

```powershell
$p = 'docs\audits\2026-07-04-fable-final-review-package.md'
Get-Item -LiteralPath $p
(Get-Content -LiteralPath $p).Count
@(git ls-files --others --exclude-standard).Count
@(git diff --cached --name-only).Count
git status --short --untracked-files=all -- $p
rg -n '^## ' $p

$raw = Get-Content -LiteralPath $p -Raw
[regex]::Matches($raw, 'AIza[0-9A-Za-z_-]{20,}').Count
[regex]::Matches($raw, 'sk-[0-9A-Za-z_-]{20,}').Count
[regex]::Matches($raw, 'Bearer\s+[0-9A-Za-z._-]{20,}').Count
[regex]::Matches($raw, '(?:GEMINI|OPENROUTER)_API_KEY\s*=\s*\S+').Count
```

Required post-write inspection commands:

```powershell
git diff -- docs/audits/2026-07-04-fable-final-review-package.md
git status --short
```

Because this package is initially untracked, ordinary `git diff -- <path>` may produce no content until the file is staged or tracked. That behavior must not be used as a reason to stage it broadly; inspect the file directly.
