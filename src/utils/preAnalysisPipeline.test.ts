import assert from "node:assert/strict";
import { cancelRunGeneration, beginRunGeneration } from "./runGeneration";
import { runPreAnalysisPipeline } from "./preAnalysisPipeline";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const entries = [{ id: "a" }, { id: "b" }, { id: "c" }];

{
  const counter = { current: 0 };
  const generation = beginRunGeneration(counter);
  cancelRunGeneration(counter, generation.controller);
  let analyzed = 0;
  const result = await runPreAnalysisPipeline({
    entries,
    signal: generation.controller.signal,
    isActiveRun: () => false,
    isAnalyzed: () => false,
    analyzeEntry: async () => {
      analyzed++;
    },
    refreshLibrary: async () => {},
  });
  assert.equal(result, "stopped");
  assert.equal(analyzed, 0);
}

{
  const counter = { current: 0 };
  const generation = beginRunGeneration(counter);
  const gate = deferred<void>();
  let refreshed = 0;
  let completed = 0;
  let cleared = 0;
  const running = runPreAnalysisPipeline({
    entries: entries.slice(0, 1),
    signal: generation.controller.signal,
    isActiveRun: () =>
      counter.current === generation.id &&
      !generation.controller.signal.aborted,
    isAnalyzed: () => false,
    analyzeEntry: async () => {
      await gate.promise;
    },
    refreshLibrary: async () => {
      refreshed++;
    },
    onClearProgress: () => {
      cleared++;
    },
    onComplete: () => {
      completed++;
    },
  });
  await Promise.resolve();
  cancelRunGeneration(counter, generation.controller);
  gate.resolve();
  assert.equal(await running, "stopped");
  assert.equal(refreshed, 0);
  assert.equal(completed, 0);
  assert.equal(cleared, 1);
}

{
  const counter = { current: 0 };
  const generation = beginRunGeneration(counter);
  let analyzed = 0;
  let refreshed = 0;
  let completed = 0;
  const result = await runPreAnalysisPipeline({
    entries,
    signal: generation.controller.signal,
    isActiveRun: () =>
      counter.current === generation.id &&
      !generation.controller.signal.aborted,
    isAnalyzed: () => false,
    concurrency: 3,
    analyzeEntry: async () => {
      analyzed++;
      if (analyzed === entries.length) {
        cancelRunGeneration(counter, generation.controller);
      }
    },
    refreshLibrary: async () => {
      refreshed++;
    },
    onComplete: () => {
      completed++;
    },
  });
  assert.equal(result, "stopped");
  assert.equal(refreshed, 0);
  assert.equal(completed, 0);
}

console.log("preAnalysisPipeline tests passed");
