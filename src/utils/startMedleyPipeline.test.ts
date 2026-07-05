import assert from "node:assert/strict";
import { cancelRunGeneration, type GenerationCounter } from "./runGeneration";
import {
  runStartMedleyPipeline,
  type StartMedleyPipelineOptions,
} from "./startMedleyPipeline";

type LibraryEntry = { id: string };
type Design = { id: string };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeHarness(modelMode: "automatic" | "manual" = "automatic") {
  const counter: GenerationCounter = { current: 0 };
  let currentController: AbortController | null = null;
  const statuses: string[] = [];
  const phases: string[] = [];
  const errors: Array<string | null> = [];
  const logs: string[] = [];
  let preAnalyzeCalls = 0;
  let fetchCalls = 0;
  let designCalls = 0;
  const automaticDispatches: string[] = [];
  const manualDispatches: string[] = [];
  const options: StartMedleyPipelineOptions<LibraryEntry, Design> = {
    library: [{ id: "a" }, { id: "b" }],
    modelMode,
    runGenerationCounter: counter,
    getCurrentController: () => currentController,
    setCurrentController: (controller) => {
      currentController = controller;
    },
    invalidateCallbacks: () => {},
    setStatus: (status) => statuses.push(status),
    setRunStartedAt: () => {},
    setErrorMessage: (message) => errors.push(message),
    setCurrentPhase: (phase) => phases.push(phase),
    clearPreAnalysisProgress: () => {},
    addLog: (message) => logs.push(message),
    checkHealth: async () => true,
    healthRetryDelayMs: 0,
    delay: async () => {},
    preAnalyzeLibrary: async () => {
      preAnalyzeCalls++;
    },
    fetchFreshLibrary: async () => {
      fetchCalls++;
      return [{ id: "fresh" }];
    },
    buildDesign: async () => {
      designCalls++;
      return { id: "design" };
    },
    runAutomaticWorkflow: async (_library, _signal, design) => {
      automaticDispatches.push(design.id);
    },
    runManualWorkflow: async (_library, _signal, design) => {
      manualDispatches.push(design?.id ?? "none");
    },
  };
  return {
    counter,
    get currentController() {
      return currentController;
    },
    statuses,
    phases,
    errors,
    logs,
    automaticDispatches,
    manualDispatches,
    counts: () => ({ preAnalyzeCalls, fetchCalls, designCalls }),
    options,
  };
}

{
  const h = makeHarness();
  const health = deferred<boolean>();
  h.options.checkHealth = async (signal) => {
    signal.addEventListener("abort", () =>
      health.reject(new DOMException("Canceled", "AbortError")),
    );
    return health.promise;
  };
  const running = runStartMedleyPipeline(h.options);
  await Promise.resolve();
  cancelRunGeneration(h.counter, h.currentController);
  assert.equal(await running, "idle");
  assert.equal(h.statuses.at(-1), "idle");
  assert.deepEqual(h.errors, []);
  assert.equal(h.counts().preAnalyzeCalls, 0);
  assert.equal(h.automaticDispatches.length, 0);
}

{
  const h = makeHarness();
  h.options.onBeforePreAnalysis = () => {
    cancelRunGeneration(h.counter, h.currentController);
  };
  assert.equal(await runStartMedleyPipeline(h.options), "idle");
  assert.equal(h.counts().preAnalyzeCalls, 0);
  assert.equal(h.counts().designCalls, 0);
}

{
  const h = makeHarness();
  h.options.preAnalyzeLibrary = async () => {
    cancelRunGeneration(h.counter, h.currentController);
  };
  assert.equal(await runStartMedleyPipeline(h.options), "idle");
  assert.equal(h.counts().fetchCalls, 0);
  assert.equal(h.counts().designCalls, 0);
}

{
  const h = makeHarness();
  const design = deferred<Design>();
  let designStarted = false;
  h.options.buildDesign = async () => {
    designStarted = true;
    return design.promise;
  };
  const running = runStartMedleyPipeline(h.options);
  while (!designStarted) await Promise.resolve();
  cancelRunGeneration(h.counter, h.currentController);
  design.resolve({ id: "late" });
  assert.equal(await running, "idle");
  assert.equal(h.automaticDispatches.length, 0);
}

{
  const h = makeHarness("automatic");
  h.options.onBeforeDispatch = () => {
    cancelRunGeneration(h.counter, h.currentController);
  };
  assert.equal(await runStartMedleyPipeline(h.options), "idle");
  assert.equal(h.automaticDispatches.length, 0);
}

{
  const h = makeHarness("manual");
  h.options.onBeforeDispatch = () => {
    cancelRunGeneration(h.counter, h.currentController);
  };
  assert.equal(await runStartMedleyPipeline(h.options), "idle");
  assert.equal(h.manualDispatches.length, 0);
}

{
  const h = makeHarness("manual");
  assert.equal(await runStartMedleyPipeline(h.options), "manual-dispatched");
  assert.deepEqual(h.manualDispatches, ["design"]);
}

{
  const h = makeHarness("automatic");
  const firstDesign = deferred<Design>();
  let firstStarted = false;
  h.options.buildDesign = async () => {
    firstStarted = true;
    return firstDesign.promise;
  };
  const first = runStartMedleyPipeline(h.options);
  while (!firstStarted) await Promise.resolve();

  const second = makeHarness("automatic");
  second.options.runGenerationCounter = h.counter;
  second.options.getCurrentController = h.options.getCurrentController;
  second.options.setCurrentController = h.options.setCurrentController;
  assert.equal(
    await runStartMedleyPipeline(second.options),
    "automatic-dispatched",
  );
  firstDesign.resolve({ id: "old-run" });
  assert.equal(await first, "idle");
  assert.deepEqual(second.automaticDispatches, ["design"]);
  assert.equal(h.automaticDispatches.length, 0);
  assert.notEqual(h.currentController?.signal.aborted, true);
}

{
  const h = makeHarness("automatic");
  h.options.onBeforePreAnalysis = () => {
    cancelRunGeneration(h.counter, h.currentController);
  };
  assert.equal(await runStartMedleyPipeline(h.options), "idle");
  delete h.options.onBeforePreAnalysis;
  assert.equal(await runStartMedleyPipeline(h.options), "automatic-dispatched");
  assert.deepEqual(h.automaticDispatches, ["design"]);
}

console.log("startMedleyPipeline tests passed");
