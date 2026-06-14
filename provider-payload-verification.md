# Provider Payload Verification

Date: 2026-06-14

## Limits

- Hard UTF-8 limit: 102,400 bytes
- Hard estimated-token limit: 24,000
- Current-library regression limit: 16,000 estimated tokens
- Estimate formula: `ceil(serializedBody.length / 3)`

The shared request builder measures the exact serialized string passed to OpenRouter.

## Automated Current-Library Audit

The regression suite measured 117 requests across:

- Three-track normal project.
- Full four-track current library.
- Initial requests, repairs, and every fallback model.
- Production continuations and report repair.
- Correction cycles one and two.
- Quality review and repair.
- The previous 237,644-byte failure shape.

Full row-level output is generated at:

`workdir/provider-payload-audit.json`

Maximum measurements by stage:

| Project | Stage | Max bytes | Max estimated tokens | Largest component |
|---|---:|---:|---:|---|
| 3 tracks | Context Brief | 8,896 | 2,966 | Stage data |
| 3 tracks | Context repair | 9,051 | 3,017 | Repair data |
| 3 tracks | Arrangement | 11,578 | 3,853 | Stage data |
| 3 tracks | Arrangement repair | 11,722 | 3,901 | Repair data |
| 3 tracks | Production start | 5,048 | 1,682 | Tool schemas |
| 3 tracks | Production continuation | 6,680 | 2,226 | Tool schemas |
| 3 tracks | Production report repair | 7,105 | 2,367 | Tool schemas |
| 3 tracks | Correction start | 5,408 | 1,802 | Tool schemas |
| 3 tracks | Correction continuation | 7,048 | 2,348 | Tool schemas |
| 3 tracks | Correction report repair | 7,477 | 2,491 | Tool schemas |
| 3 tracks | Quality Review | 3,682 | 1,228 | Tool schemas |
| 3 tracks | Quality repair | 3,825 | 1,275 | Tool schemas |
| 4 tracks | Context Brief | 10,398 | 3,466 | Stage data |
| 4 tracks | Context repair | 10,553 | 3,518 | Repair data |
| 4 tracks | Arrangement | 13,463 | 4,480 | Stage data |
| 4 tracks | Arrangement repair | 13,607 | 4,528 | Repair data |
| 4 tracks | Production start | 5,512 | 1,836 | Tool schemas |
| 4 tracks | Production continuation | 7,957 | 2,651 | Tool schemas |
| 4 tracks | Production report repair | 8,382 | 2,793 | Tool schemas |
| 4 tracks | Correction start | 5,872 | 1,956 | Tool schemas |
| 4 tracks | Correction continuation | 8,329 | 2,775 | Tool schemas |
| 4 tracks | Correction report repair | 8,758 | 2,918 | Tool schemas |
| 4 tracks | Quality Review | 3,952 | 1,318 | Tool schemas |
| 4 tracks | Quality repair | 4,095 | 1,365 | Tool schemas |
| Both | Finalization | 0 | 0 | No provider request |

Largest automated request:

`maximum-4-track / arrangement repair / 13,607 bytes / 4,528 estimated tokens`

## Live Four-Track Automatic Run

Session: `2oquenv9`

| Stage | Model | Request | Tools | Bytes | Estimated tokens | Actual prompt tokens | Largest component |
|---|---|---:|---|---:|---:|---:|---|
| Context Brief | Nemotron Super | 1 | `submit_project_brief` | 10,391 | 3,464 | 4,154 | Stage data |
| Arrangement | Nemotron Ultra | 1 | `set_design_plan` | 13,553 | 4,509 | Timeout | Stage data |
| Arrangement fallback | Nemotron Super | 1 | `set_design_plan` | 13,553 | 4,509 | 6,455 | Stage data |
| Production | Nex-N2-Pro | 1 | transition + report | 6,108 | 2,034 | 2,539 | Tool schemas |
| Production | Nex-N2-Pro | 2 | transition + report | 9,246 | 3,078 | 3,962 | Tool schemas |
| Quality Review | Nemotron Ultra | 1 | `submit_quality_review` | 4,228 | 1,410 | Timeout | Stage data |
| Quality fallback | Nemotron Super | 1 | `submit_quality_review` | 4,228 | 1,410 | 1,880 | Stage data |
| Finalization | None | 0 | None | 0 | 0 | 0 | No provider request |

The run completed with three transitions and no correction cycle.

## Live Forced Correction Run

Session: `payload-correction-live`

| Stage | Model | Request | Tools | Bytes | Estimated tokens | Actual prompt tokens | Largest component |
|---|---|---:|---|---:|---:|---:|---|
| Correction | Nex-N2-Pro | 1 | transition + report | 6,545 | 2,180 | 2,606 | Tool schemas |
| Correction | Nex-N2-Pro | 2 | transition + report | 7,639 | 2,544 | 3,088 | Tool schemas |
| Correction | Nex-N2-Pro | 3 | transition + report | 8,737 | 2,909 | 3,568 | Tool schemas |
| Correction | Nex-N2-Pro | 4 | transition + report | 9,830 | 3,273 | 4,042 | Tool schemas |
| Quality Review | Nemotron Ultra | 1 | `submit_quality_review` | 4,260 | 1,420 | 1,888 | Stage data |
| Finalization | None | 0 | None | 0 | 0 | 0 | No provider request |

The run completed with one forced correction cycle.

## Result

- Every automated and live request stayed below 16,000 estimated tokens.
- Every request stayed below both hard limits.
- Each role received only its allowlisted tools.
- No complete prior-stage model history was transferred.
- Raw FFmpeg output, provider reasoning, usage objects, and debug paths were excluded.
- The previous oversized request shape is rejected before network activity.
- Finalization sends no provider request.
