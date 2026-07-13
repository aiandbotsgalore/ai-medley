# Current API Route Inventory

This list is generated from the Express registrations in `server.ts` and checked by `scripts/release-contract.mjs`. Routes remain local-only and are subject to Host/origin/fetch-site policy.

For Automatic workflow v4, `/api/medley-intelligence/design`,
`/api/session/design-plan`, `/api/apply-transition`,
`/api/render-review-candidate`, `/api/session/quality-review`, and
`/api/finalize-medley` form the durable workflow path. The v4 path uses a
deterministic local brief and execution compiler; it does not call a context
specialist or a production/tool-execution provider. `/api/exec`,
`/api/file-read`, and `/api/file-write` remain Manual Model routes. Their
`expert` capability is intentionally powerful and is not a containment claim.

- `DELETE /api/checkpoint/:sessionId`
- `DELETE /api/history/:id`
- `DELETE /api/library/:id`
- `DELETE /api/session/:sessionId/discard`
- `GET *`
- `GET /api/audio-file`
- `GET /api/audio-probe/:id`
- `GET /api/audio-raw/:id`
- `GET /api/audio/:id`
- `GET /api/audio/:id/download`
- `GET /api/checkpoint/:sessionId`
- `GET /api/checkpoint/:sessionId/compatibility`
- `GET /api/checkpoints`
- `GET /api/config`
- `GET /api/file-read`
- `GET /api/health`
- `GET /api/history`
- `GET /api/library`
- `GET /api/session/:id`
- `GET /api/session/:id/stream`
- `GET /api/session/:sessionId/candidates`
- `GET /api/session/:sessionId/state`
- `GET /api/storage/inventory`
- `GET /api/waveform/:id`
- `POST /api/apply-transition`
- `POST /api/audio-analysis/local`
- `POST /api/checkpoint`
- `POST /api/exec`
- `POST /api/file-write`
- `POST /api/finalize-medley`
- `POST /api/library`
- `POST /api/library/recover`
- `POST /api/library/analysis`
- `POST /api/library/cache`
- `POST /api/medley-intelligence/design`
- `POST /api/medley-quality`
- `POST /api/provider/gemini`
- `POST /api/provider/openrouter`
- `POST /api/provider/openrouter/preflight`
- `POST /api/render-review-candidate`
- `POST /api/section-pair-evaluate`
- `POST /api/session/:id/cancel`
- `POST /api/session/design-plan`
- `POST /api/session/execution-report`
- `POST /api/session/finish`
- `POST /api/session/human-review`
- `POST /api/session/manual-review-required`
- `POST /api/session/metrics`
- `POST /api/session/project-brief`
- `POST /api/session/quality-review`
- `PUT /api/config/openrouter-key`
- `PUT /api/library/reorder`
