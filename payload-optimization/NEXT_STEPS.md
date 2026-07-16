# Next Steps - Payload Optimization

## Status: measurement goal complete

The original goal of this document — instrumenting and measuring provider
payload sizes — is done and now runs automatically:

- `src/engine/providerPayloadAudit.test.ts` audits all 12 current provider
  request shapes as part of `npm test`.
- The largest observed request is 12,187 bytes / 4,056 estimated tokens
  (maximum-4-track `arrangement_repair`), with 9,445 bytes from `repairErrors`.
- The audit writes its row-level report to an isolated operating-system
  temporary directory. It never refreshes the protected historical artifact in
  the repository's `workdir/`.
- Automatic v4 has no context-brief or production-specialist provider request;
  those responsibilities are local and deterministic.
- Compact request payloads are enforced by commit `f0e424c`
  ("fix(provider): enforce compact request payloads").

## Remaining optional follow-ups

1. **repairErrors budget**: `repairErrors` is the largest single component
   of the biggest payloads. If repair loops ever approach provider limits,
   cap or summarize accumulated repair feedback before resending.
2. **Frontend bundle size**: Vite warns that the main chunk is ~740 KB
   minified. If UI load time becomes noticeable, add `manualChunks` or
   dynamic imports. Purely a UX nicety for a local app.

See `EXPERIMENTS.md`, `EXPERIMENT_NOTES.md`, and the historical
`provider-payload-verification.md` report for provenance. Current runtime
behavior is documented in `docs/current-operations.md`.
