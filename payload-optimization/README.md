# AI Medley Payload Optimization

**Branch:** payload-optimization  
**Status:** Completed historical experiment

## Current result

- Provider payload measurement is enforced by
  `src/engine/providerPayloadAudit.test.ts` in the normal test suite.
- Automatic v4 no longer has context-brief or production-model provider calls.
- The current audit covers 12 constrained arrangement/review request shapes.
- The largest current measured request is 12,187 bytes / 4,056 estimated tokens.
- Audit output is written only under an isolated temporary test data root; the
  repository's protected `workdir/` audit artifact is not regenerated.

## Current authority

This directory preserves the experiment history. Use
`docs/current-operations.md` for the implemented provider workflow and
`NEXT_STEPS.md` for the current measurement summary. There is no active payload
phase waiting to begin.
