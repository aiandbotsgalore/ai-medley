import type { MedleyDesignPayload } from '../engine/medleyIntelligence';
import type { SemanticMemory } from './semanticMemory';

// Matches the status values currently used in useAutonomousLoop.ts
// DO NOT add new status values not already tracked
export type SessionStatus =
  | 'idle'
  | 'running'
  | 'completed'
  | 'error';

// Free-form string — values include the detailed phase label used by the UI
// e.g. 'ANALYZE — Pre-analyzing Library', 'DESIGN — Building Structure', etc.
export type SessionPhase = string;

// ALL metric values are 0–100 integers. No decimals. No other scale.
export interface CanonicalMetrics {
  emotionalArc: number;          // 0–100
  transitionSmoothness: number;  // 0–100
  performerIdentity: number;     // 0–100
  overallScore: number;          // 0–100
  iteration: number;
  phase: string;
}

export interface AutonomousSessionState {
  sessionId: string;
  status: SessionStatus;
  activeModel: string;
  metrics: CanonicalMetrics | null;
  design: MedleyDesignPayload | null;
  iteration: number;
  llmCallCount: number;
  refinementPassCount: number;
  evaluateCallCount: number;
  expensiveLLMCalls: number;
  cheapLLMCalls: number;
  autoAcceptedCount: number;
  autoRejectedCount: number;
  currentPhase: SessionPhase;
  semanticMemory: SemanticMemory;
  lastTool: string | null;
  lastCheckpointAt: number | null;
  checkpointVersion: number;
  createdAt: number;
  updatedAt: number;
}

export function createInitialSessionState(
  sessionId: string,
  activeModel: string
): AutonomousSessionState {
  return {
    sessionId,
    status: 'idle',
    activeModel,
    metrics: null,
    design: null,
    iteration: 0,
    llmCallCount: 0,
    refinementPassCount: 0,
    evaluateCallCount: 0,
    expensiveLLMCalls: 0,
    cheapLLMCalls: 0,
    autoAcceptedCount: 0,
    autoRejectedCount: 0,
    currentPhase: 'Initializing',
    semanticMemory: {
      lockedDecisions: [],
      rejectedApproaches: [],
      stylisticConstraints: [],
      unresolvedProblems: [],
      successfulTransitions: [],
      failedTransitions: [],
      timingConstraints: [],
      recoveryNarrative: '',
    },
    lastTool: null,
    lastCheckpointAt: null,
    checkpointVersion: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
