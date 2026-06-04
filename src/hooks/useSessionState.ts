import { useState, useCallback } from 'react';
import type {
  AutonomousSessionState,
  CanonicalMetrics,
  SessionPhase,
  SessionStatus
} from '../types/autonomousSession';
import { createInitialSessionState } from '../types/autonomousSession';
import type { MedleyDesignPayload } from '../engine/medleyIntelligence';
import type { SemanticMemory } from '../types/semanticMemory';

export function useSessionState() {
  const [sessionState, setSessionState] = useState<AutonomousSessionState | null>(null);

  // Standalone fields that must stay writable before initSession is called.
  // Phase updates happen during pre-analysis, before the AI loop creates a session ID.
  const [currentPhase, setCurrentPhaseState] = useState<string>('');
  const [design, setDesign] = useState<MedleyDesignPayload | null>(null);

  const initSession = useCallback((sessionId: string, activeModel: string) => {
    setSessionState(createInitialSessionState(sessionId, activeModel));
  }, []);

  const updateStatus = useCallback((status: SessionStatus) => {
    setSessionState(prev => prev ? { ...prev, status, updatedAt: Date.now() } : prev);
  }, []);

  const updatePhase = useCallback((phase: SessionPhase) => {
    setCurrentPhaseState(phase);
    setSessionState(prev => prev ? { ...prev, currentPhase: phase, updatedAt: Date.now() } : prev);
  }, []);

  const updateMetrics = useCallback((metrics: CanonicalMetrics) => {
    setSessionState(prev => prev ? { ...prev, metrics, updatedAt: Date.now() } : prev);
  }, []);

  const updateDesign = useCallback((d: MedleyDesignPayload | null) => {
    setDesign(d);
    setSessionState(prev => prev ? { ...prev, design: d, updatedAt: Date.now() } : prev);
  }, []);

  const updateSemanticMemory = useCallback((memory: SemanticMemory) => {
    setSessionState(prev => prev ? { ...prev, semanticMemory: memory, updatedAt: Date.now() } : prev);
  }, []);

  const incrementIteration = useCallback(() => {
    setSessionState(prev =>
      prev ? { ...prev, iteration: prev.iteration + 1, updatedAt: Date.now() } : prev
    );
  }, []);

  const markLastTool = useCallback((toolName: string) => {
    setSessionState(prev => prev ? { ...prev, lastTool: toolName, updatedAt: Date.now() } : prev);
  }, []);

  const resetSession = useCallback(() => {
    setSessionState(null);
    setCurrentPhaseState('');
    setDesign(null);
  }, []);

  return {
    sessionState,
    currentPhase,
    design,
    initSession,
    updateStatus,
    updatePhase,
    updateMetrics,
    updateDesign,
    updateSemanticMemory,
    incrementIteration,
    markLastTool,
    resetSession,
  };
}
