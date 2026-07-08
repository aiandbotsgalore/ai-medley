# Next Steps - Payload Optimization

## Status: measurement goal complete

The original goal of this document — instrumenting and measuring provider
payload sizes — is done and now runs automatically:

- `src/engine/providerPayloadAudit.test.ts` audits every provider request
  shape (117 requests as of 2026-07-07) as part of `npm test`.
- The largest observed request is ~13 KB / ~4.3k estimated tokens
  (maximum-4-track `arrangement_repair`), dominated by `repairErrors`.
- Compact request payloads are enforced by commit `f0e424c`
  ("fix(provider): enforce compact request payloads").

## Remaining optional follow-ups

1. **repairErrors budget**: `repairErrors` is the largest single component
   of the biggest payloads. If repair loops ever approach provider limits,
   cap or summarize accumulated repair feedback before resending.
2. **Frontend bundle size**: Vite warns that the main chunk is ~740 KB
   minified. If UI load time becomes noticeable, add `manualChunks` or
   dynamic imports. Purely a UX nicety for a local app.

See `EXPERIMENTS.md` and `EXPERIMENT_NOTES.md` for the measurement history.
