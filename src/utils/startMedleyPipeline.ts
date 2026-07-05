import {
  beginRunGeneration,
  cancelRunGeneration,
  isRunGenerationActive,
  type GenerationCounter,
} from "./runGeneration";

export type StartMedleyPipelineResult =
  | "automatic-dispatched"
  | "manual-dispatched"
  | "idle"
  | "error";

export type StartMedleyPipelineOptions<TLibrary, TDesign> = {
  library: TLibrary[];
  modelMode: "automatic" | "manual";
  runGenerationCounter: GenerationCounter;
  getCurrentController: () => AbortController | null;
  setCurrentController: (controller: AbortController | null) => void;
  invalidateCallbacks: () => void;
  setStatus: (status: "idle" | "running" | "error") => void;
  setRunStartedAt: (value: number | null) => void;
  setErrorMessage: (message: string | null) => void;
  setCurrentPhase: (phase: string) => void;
  clearPreAnalysisProgress: () => void;
  addLog: (message: string) => void;
  checkHealth: (signal: AbortSignal) => Promise<boolean>;
  healthAttempts?: number;
  healthRetryDelayMs?: number;
  delay?: (ms: number) => Promise<void>;
  preAnalyzeLibrary: (
    library: TLibrary[],
    signal: AbortSignal,
    isActiveRun: () => boolean,
    generationId: number,
  ) => Promise<void>;
  fetchFreshLibrary: (signal: AbortSignal) => Promise<TLibrary[]>;
  buildDesign: (
    library: TLibrary[],
    signal: AbortSignal,
  ) => Promise<TDesign | null>;
  runAutomaticWorkflow: (
    library: TLibrary[],
    signal: AbortSignal,
    design: TDesign,
  ) => Promise<void>;
  runManualWorkflow: (
    library: TLibrary[],
    signal: AbortSignal,
    design: TDesign | null,
  ) => void | Promise<void>;
  onBeforePreAnalysis?: () => void | Promise<void>;
  onBeforeDesign?: () => void | Promise<void>;
  onBeforeDispatch?: () => void | Promise<void>;
};

function defaultDelay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function runStartMedleyPipeline<TLibrary, TDesign>(
  options: StartMedleyPipelineOptions<TLibrary, TDesign>,
): Promise<StartMedleyPipelineResult> {
  cancelRunGeneration(
    options.runGenerationCounter,
    options.getCurrentController(),
  );
  options.invalidateCallbacks();
  const generation = beginRunGeneration(options.runGenerationCounter);
  const signal = generation.controller.signal;
  const isActiveRun = () =>
    options.getCurrentController() === generation.controller &&
    isRunGenerationActive(options.runGenerationCounter, generation);
  const stopIdle = (): StartMedleyPipelineResult => {
    if (options.getCurrentController() === generation.controller) {
      options.setStatus("idle");
      options.setRunStartedAt(null);
    }
    return "idle";
  };

  options.setCurrentController(generation.controller);
  options.setStatus("running");
  options.setRunStartedAt(Date.now());
  options.addLog("Checking system integrity...");

  let healthy = false;
  let attempts = 0;
  const maxAttempts = options.healthAttempts ?? 5;
  const retryDelay = options.healthRetryDelayMs ?? 2000;
  const delay = options.delay ?? defaultDelay;
  while (!healthy && attempts < maxAttempts) {
    if (!isActiveRun()) return stopIdle();
    try {
      healthy = await options.checkHealth(signal);
      if (!isActiveRun()) return stopIdle();
      if (!healthy) throw new Error("Not ready");
    } catch (error: any) {
      if (error?.name === "AbortError" || !isActiveRun()) return stopIdle();
      attempts++;
      options.addLog(
        `Backend warming up (Attempt ${attempts}/${maxAttempts})...`,
      );
      await delay(retryDelay);
      if (!isActiveRun()) return stopIdle();
    }
  }

  if (!healthy) {
    if (!isActiveRun()) return stopIdle();
    options.setErrorMessage(
      "Backend failed to respond. Please refresh the page.",
    );
    options.setStatus("error");
    return "error";
  }
  if (!isActiveRun()) return stopIdle();

  options.addLog("System online. Initializing Architect...");
  options.setCurrentPhase("ANALYZE - Library Analysis");
  await options.onBeforePreAnalysis?.();
  if (!isActiveRun()) {
    options.clearPreAnalysisProgress();
    return stopIdle();
  }
  await options.preAnalyzeLibrary(
    options.library,
    signal,
    isActiveRun,
    generation.id,
  );
  if (!isActiveRun()) {
    options.clearPreAnalysisProgress();
    return stopIdle();
  }

  let freshLibrary = options.library;
  try {
    freshLibrary = await options.fetchFreshLibrary(signal);
  } catch (error: any) {
    if (error?.name === "AbortError" || !isActiveRun()) return stopIdle();
  }
  if (!isActiveRun()) return stopIdle();

  let design: TDesign | null = null;
  try {
    await options.onBeforeDesign?.();
    if (!isActiveRun()) return stopIdle();
    options.setCurrentPhase("DESIGN - Building Structure");
    options.addLog("Building Medley Intelligence match scores...");
    design = await options.buildDesign(freshLibrary, signal);
    if (!isActiveRun()) return stopIdle();
  } catch (error: any) {
    if (error?.name === "AbortError" || !isActiveRun()) return stopIdle();
    options.addLog(`Medley Intelligence unavailable: ${error.message}`);
  }

  await options.onBeforeDispatch?.();
  if (!isActiveRun()) return stopIdle();
  if (options.modelMode === "automatic") {
    if (!design) {
      options.setStatus("error");
      options.setErrorMessage(
        "Automatic mode requires local Medley Intelligence. Re-run local analysis and try again.",
      );
      return "error";
    }
    await options.runAutomaticWorkflow(freshLibrary, signal, design);
    return "automatic-dispatched";
  }

  options.setCurrentPhase("BUILD - Constructing Medley");
  await options.runManualWorkflow(freshLibrary, signal, design);
  return "manual-dispatched";
}
