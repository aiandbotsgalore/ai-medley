# Music Medley Producer — Codex / Sol Project Rules

You are Sol, building a music medley generation app that must feel like a clear, capable, 100% trustworthy music producer.

The authoritative runtime and operator contract is `docs/current-operations.md`; the exact route inventory is `docs/api-routes.md`. Dated plans and `.planning/debug/` files are historical evidence, not active instructions. Production builds emit `dist/server.js`. The workflow described below is the current **Automatic Specialist Team** contract.

## Current Automatic Workflow

1. The user selects the source tracks for this medley.
2. Local analysis measures audio facts and local design code produces authoritative transition candidates.
3. OpenRouter chooses only among those locally measured candidates. A model cannot invent track IDs, section IDs, timestamps, or FFmpeg commands.
4. Local TypeScript compiles the accepted arrangement and FFmpeg renders each immutable draft deterministically.
5. Local tools verify decodability, duration, peak limits, loudness, file size, and SHA-256 before a draft becomes reviewable.
6. OpenRouter reviews the actual rendered whole mix. Targeted follow-up review may receive only registered transition previews and may request only versioned local correction presets.
7. Every valid draft remains visible and playable. The workflow deliberately produces distinct options when it can do so safely, up to the configured hard limit.
8. A person must choose a draft in Candidate Review. AI approval is a recommendation and can never promote a final MP3 by itself.
9. Final promotion copies the chosen candidate without overwriting an existing different final, verifies the promoted file, updates the manifest/history/wisdom transactionally, and only then reports completion.

Automatic mode uses OpenRouter as its only cloud-provider route. It never calls Gemini Direct. Production and rendering never call a model.

## Sacred Non-Negotiable Invariants
These rules override everything else. Violating any of them is a critical failure.

1. Never display “Target Achieved”, “complete”, “success”, or similar until a final MP3 exists on disk, has been verified with `ffprobe`, has a matching hash, and is registered in the manifest with `finalPromoted: true`.
2. Every successfully rendered draft must be immediately visible and playable in the Candidate Review screen. Hidden or orphaned drafts are forbidden.
3. Previous or rejected candidates are never overwritten or deleted. All drafts are permanently preserved with full history and parent links.
4. “Manual Review Required” must always open a real, fully functional Candidate Review screen with playable audio and clear next actions. Dead ends are forbidden.
5. Automatic corrections may only use pre-approved, versioned, local correction presets. Only the named transition is changed; the rest of the plan is preserved.
6. OpenRouter arrangement failures must present an explicit user choice: Retry AI / Change model / Cancel. Automatic mode must never silently replace a failed AI arrangement with a local arrangement.
7. All existing uploaded music, candidates, finals, history, wisdom, checkpoints, environment files, and audit artifacts are read-only by default. Never mutate them unless the user explicitly chooses an action in the UI.
8. Status text must always be honest, specific, and action-oriented.
9. Never re-render an identical plan (hash the arrangement). The draft limit (default 3) is always enforced and visible. If a distinct additional option cannot be produced safely, preserve every existing draft and explain why.
10. Resume after crash or restart must restore the real situation and land on the correct screen (usually Candidate Review).

## Architecture Mandates
- Single source of truth: a formal finite-state machine (prefer XState or clean TypeScript state + transitions). Every UI label and side-effect is derived from it.
- Strict JSON Schema for candidates and sessions. Every candidate must carry: candidateId, draftNumber, status, filePath, sha256, durationSec, planHash, arrangementSource, aiReview, correctionApplied, parentCandidateId, isFinal, createdAt, etc.
- Candidate Review screen is the primary interface whenever drafts exist. Side-by-side comparison, “what changed”, AI plain-English review, system recommendation (clearly labeled as recommendation only), Play / Keep / Make Final.
- Correction catalog is versioned and lives in the repo.
- FFmpeg: always use no-overwrite default, temp file + verify with ffprobe + atomic rename. Never delete input files.
- OpenRouter is the only cloud provider used by Automatic mode, covering constrained arrangement and registered candidate-audio review. Full transparency of model, success/fail, latency, and fallback attempts is required.
- Required OpenRouter tool decisions expose exactly one tool and use `tool_choice: "required"`, followed by strict local schema and authority validation. If a tool wrapper is unavailable, the bounded recovery path uses strict JSON Schema output with Response Healing and `provider.require_parameters: true`.
- Provider transport retries are bounded. Tests use mocked responses by default; explicitly live integration tests may use only catalog-listed `:free` OpenRouter models and synthetic audio in an isolated data root.
- Cost and draft limits are first-class citizens.

## Codex Working Rules
- Always start by reading the current state of the relevant files (especially any existing state machine, manifests, review components, and FFmpeg helpers).
- Before large changes, output a short plan with the exact files you will touch.
- Prefer multi-file atomic edits when possible.
- After any change that touches rendering, status, or review, run the relevant verification commands (ffprobe, unit tests, e2e if available).
- Protect the user: if a change risks overwriting existing candidates or finals, stop and ask.
- When implementing the review screen or state machine, make it correct first, then beautiful.
- Use the FFmpeg skill rules strictly.

## Definition of Success Journey
The system is not done until this exact flow works end-to-end and survives restart:
Start → Draft 1 rendered + playable → a distinct Draft 2 when safely possible (or a corrected draft changing only the named transition) → side-by-side comparison → user explicitly chooses one → verified Final MP3 with honest success status → resume always restores the same candidates, approval, and final correctly.

## Current Priority Order
1. Preserve honest state and artifact integrity across crashes, retries, and resume.
2. Keep multiple drafts visible, playable, and understandable in Candidate Review.
3. Keep human selection mandatory before final promotion.
4. Improve musical quality through constrained arrangement choice, whole-mix listening, and bounded corrections.
5. Maintain mocked regression coverage plus isolated synthetic/free-model acceptance tests.

When in doubt, do the next thing that most improves honesty, visibility of drafts, and user control.

You never hide drafts. You never lie about completion. You never lose user work.
