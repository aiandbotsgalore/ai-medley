# AI Medley Payload Optimization Plan (GitHub Version)

> **Completed historical experiment — do not execute as an active plan.** The
> measurement gate now runs in `src/engine/providerPayloadAudit.test.ts`.
> Current workflow instructions are in `docs/current-operations.md` and current
> work is in `task_plan.md`.

**Goal:** Determine true causes of payload inefficiency in AI Medley and implement verified improvements.

**Status:** Completed and archived
**Branch:** payload-optimization
**Approach:** Measurement-first, quality-preserving, fully automated via this repo.

## Core Rules

- No optimization without measurement
- Quality > size reduction
- Everything tracked in this branch
- Use scripts/ folder for automation

## Outcome

Instrumentation, compact payload construction, and regression limits were
implemented. Automatic v4 now makes only constrained arrangement and musical
review provider requests; deterministic TypeScript and FFmpeg own production.

The original next action was to pull the branch and wait for an external
diagnostic script. That dated instruction is retained here only as experiment
history and is no longer actionable.
