import { useState, useRef, useCallback, useEffect } from "react";
import {
  buildSystemPrompt,
  getOpenRouterTools,
  getToolDeclarations,
} from "../engine/prompts";
import { createProviderSession } from "../engine/providers";
import type { ProviderRequestAudit } from "../engine/providerRequest";
import type { MedleyConfig } from "../components/ConfigPanel";
import type { LibraryFile } from "../components/LibrarySidebar";
import type { MedleyDesignPayload } from "../engine/medleyIntelligence";
import type { SemanticMemory } from "../types/semanticMemory";
import { buildRecoveryNarrative } from "../types/semanticMemory";

export function useModelFallback(config: MedleyConfig) {
  const [activeModel, setActiveModel] = useState<string>("");
  const [toolFailureStreak, setToolFailureStreak] = useState(0);
  const currentModelIndexRef = useRef(0);
  const toolFailureStreakRef = useRef(0);

  const sessionRef = useRef<any>(null);
  const forceModelSwitchPendingRef = useRef(false);
  const providerAuditHandlerRef = useRef<
    ((audit: ProviderRequestAudit) => void) | undefined
  >(undefined);

  useEffect(() => {
    currentModelIndexRef.current = 0;
    toolFailureStreakRef.current = 0;
    setToolFailureStreak(0);
    setActiveModel(config.model);
    sessionRef.current = null;
  }, [config.provider, config.model]);

  const prepareForRun = useCallback((modelIndex = 0) => {
    currentModelIndexRef.current = Math.max(0, Math.floor(modelIndex));
    toolFailureStreakRef.current = 0;
    setToolFailureStreak(0);
    forceModelSwitchPendingRef.current = false;
  }, []);

  const getFallbackModels = useCallback(() => {
    return (
      config.provider === "gemini"
        ? [config.model, "gemini-2.5-flash", "gemini-2.5-pro"]
        : [
            config.model,
            "google/gemini-2.5-flash",
            "google/gemini-2.5-pro",
          ]
    ).filter((m, i, arr) => arr.indexOf(m) === i);
  }, [config.provider, config.model]);

  const getCurrentModel = useCallback(() => {
    const fallbacks = getFallbackModels();
    return fallbacks[
      Math.min(currentModelIndexRef.current, fallbacks.length - 1)
    ];
  }, [getFallbackModels]);

  const createSessionForModel = useCallback(
    (
      model: string,
      lib: LibraryFile[] = [],
      design?: MedleyDesignPayload | null,
      sid?: string,
      history?: unknown[],
    ) => {
      const tempConfig = { ...config, model };
      sessionRef.current = createProviderSession(
        tempConfig,
        buildSystemPrompt(lib, tempConfig, design ?? null, sid),
        tempConfig.provider === "gemini"
          ? getToolDeclarations()
          : getOpenRouterTools(),
        tempConfig.temperature,
        history,
        {
          stage: "manual",
          role: "manual",
          onRequestAudit: providerAuditHandlerRef.current,
        },
      );
      return sessionRef.current;
    },
    [config],
  );

  const requestForceModelSwitch = useCallback(() => {
    forceModelSwitchPendingRef.current = true;
  }, []);

  const isForceModelSwitchPending = useCallback(() => {
    const pending = forceModelSwitchPendingRef.current;
    forceModelSwitchPendingRef.current = false;
    return pending;
  }, []);

  const switchToNextModel = useCallback(
    async (
      reason: string,
      options?: {
        lib?: LibraryFile[];
        design?: MedleyDesignPayload | null;
        sid?: string;
        semanticMemory?: SemanticMemory;
        currentPhase?: string;
        checkpointFn?: () => void;
        addLog?: (msg: string) => void;
      },
    ) => {
      const {
        lib = [],
        design,
        sid,
        semanticMemory,
        currentPhase = "",
        checkpointFn,
        addLog: log,
      } = options ?? {};
      const fallbacks = getFallbackModels();
      if (currentModelIndexRef.current >= fallbacks.length - 1) {
        log?.(
          `⚠️ All fallback models exhausted. Last failure reason: ${reason}`,
        );
        return false;
      }

      const previousModel = getCurrentModel();

      // Retrieve chat history for transfer to the new session
      let history: unknown[] | undefined;
      let historyTransferred = false;
      try {
        const h = sessionRef.current?.getHistory?.();
        if (Array.isArray(h) && h.length > 0) {
          history = h;
          historyTransferred = true;
        }
      } catch (e) {
        log?.(`   ⚠️ Could not retrieve chat history for transfer: ${e}`);
      }

      currentModelIndexRef.current++;
      const nextModel = getCurrentModel();

      log?.(`🔄 Model switch: ${previousModel} → ${nextModel}`);
      log?.(
        `   Reason: ${reason} | History transfer: ${historyTransferred ? `${(history as any[]).length} turns` : "unavailable"}`,
      );

      setActiveModel(nextModel);
      createSessionForModel(nextModel, lib, design, sid, history);
      toolFailureStreakRef.current = 0;
      setToolFailureStreak(0);

      // Build and inject semantic memory recovery narrative
      let narrative = "";
      if (semanticMemory) {
        try {
          const builtNarrative = buildRecoveryNarrative(
            semanticMemory,
            0,
            currentPhase,
          );
          if (builtNarrative) {
            narrative = ` Context: ${builtNarrative}`;
            log?.(
              `   ✅ Semantic memory recovery narrative injected (${builtNarrative.length} chars)`,
            );
          }
        } catch (e) {
          log?.(`   ⚠️ Recovery narrative build failed: ${e}`);
        }
      }

      if (narrative) {
        log?.(
          "   Recovery context retained locally; no hidden provider request was made during fallback.",
        );
      }

      // Persist updated currentModelIndex to checkpoint
      checkpointFn?.();

      return true;
    },
    [getFallbackModels, getCurrentModel, createSessionForModel],
  );

  const switchToPreviousModel = useCallback(
    async (addLog?: (msg: string) => void) => {
      if (currentModelIndexRef.current <= 0) {
        addLog?.(
          "⚠️ Already on the primary model — cannot switch back further.",
        );
        return false;
      }
      const fromModel = getCurrentModel();
      currentModelIndexRef.current--;
      const toModel = getCurrentModel();
      addLog?.(`🔄 Switching back: ${fromModel} → ${toModel}`);
      setActiveModel(toModel);
      createSessionForModel(toModel);
      try {
        await sessionRef.current?.send(
          `Switched back to ${toModel}. Please continue the medley architect process from where we left off.`,
        );
      } catch (e: any) {
        addLog?.(`   Switch back recovery failed: ${e?.message || e}`);
      }
      toolFailureStreakRef.current = 0;
      setToolFailureStreak(0);
      return true;
    },
    [getCurrentModel, createSessionForModel],
  );

  const resetToPrimaryModel = useCallback(
    async (addLog?: (msg: string) => void) => {
      if (currentModelIndexRef.current === 0) {
        addLog?.("ℹ️ Already on the primary model.");
        return false;
      }
      const fromModel = getCurrentModel();
      currentModelIndexRef.current = 0;
      const toModel = getCurrentModel();
      addLog?.(`🔄 Resetting to primary model: ${fromModel} → ${toModel}`);
      setActiveModel(toModel);
      createSessionForModel(toModel);
      try {
        await sessionRef.current?.send(
          `Reset to primary model (${toModel}). Please continue the medley architect process from where we left off.`,
        );
      } catch (e: any) {
        addLog?.(`   Reset recovery failed: ${e?.message || e}`);
      }
      toolFailureStreakRef.current = 0;
      setToolFailureStreak(0);
      return true;
    },
    [getCurrentModel, createSessionForModel],
  );

  const incrementToolFailure = useCallback(() => {
    toolFailureStreakRef.current++;
    setToolFailureStreak(toolFailureStreakRef.current);
    return toolFailureStreakRef.current;
  }, []);

  const resetToolFailure = useCallback(() => {
    toolFailureStreakRef.current = 0;
    setToolFailureStreak(0);
  }, []);

  const getSession = useCallback(() => sessionRef.current, []);
  const setProviderAuditHandler = useCallback(
    (handler?: (audit: ProviderRequestAudit) => void) => {
      providerAuditHandlerRef.current = handler;
    },
    [],
  );

  return {
    activeModel,
    setActiveModel,
    toolFailureStreak,
    toolFailureStreakRef,
    currentModelIndexRef,
    getCurrentModel,
    getFallbackModels,
    createSessionForModel,
    getSession,
    requestForceModelSwitch,
    isForceModelSwitchPending,
    switchToNextModel,
    switchToPreviousModel,
    resetToPrimaryModel,
    incrementToolFailure,
    resetToolFailure,
    prepareForRun,
    setProviderAuditHandler,
  };
}
