import type { SemanticMemory } from '../types/semanticMemory';

export const CHECKPOINT_SCHEMA_VERSION = 2;

export function validateCheckpoint(raw: any): boolean {
  if (!raw || typeof raw !== 'object') return false;
  if (!raw.sessionId || typeof raw.sessionId !== 'string') return false;
  if (!raw.chatHistory || !Array.isArray(raw.chatHistory)) return false;
  if (typeof raw.iterations !== 'number') return false;
  return true;
}

// Spreads raw first so existing v2 fields are preserved,
// then overrides schemaVersion to guarantee it is always 2,
// then fills semanticMemory and metrics only if raw does not have them.
export function upgradeCheckpoint(raw: any): any {
  return {
    ...raw,
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    semanticMemory: raw.semanticMemory ?? {
      lockedDecisions: [],
      rejectedApproaches: [],
      stylisticConstraints: [],
      unresolvedProblems: [],
      successfulTransitions: [],
      failedTransitions: [],
      timingConstraints: [],
      recoveryNarrative: '',
    },
    metrics: raw.metrics ?? null,
  };
}

export function enrichCheckpointPayload(
  base: any,
  semanticMemory: SemanticMemory | undefined | null,
  metrics: any | null
): any {
  return {
    ...base,
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    ...(semanticMemory ? { semanticMemory } : {}),
    ...(metrics ? { metrics } : {}),
  };
}
