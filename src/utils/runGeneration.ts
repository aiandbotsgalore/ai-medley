export type GenerationCounter = { current: number };

export type RunGeneration = {
  id: number;
  controller: AbortController;
};

export function beginRunGeneration(counter: GenerationCounter): RunGeneration {
  return {
    id: ++counter.current,
    controller: new AbortController(),
  };
}

export function cancelRunGeneration(
  counter: GenerationCounter,
  controller: AbortController | null | undefined,
) {
  counter.current++;
  controller?.abort();
}

export function isRunGenerationActive(
  counter: GenerationCounter,
  generation: RunGeneration,
) {
  return (
    counter.current === generation.id && !generation.controller.signal.aborted
  );
}

export function supersededRunError() {
  return new DOMException("Superseded run", "AbortError");
}
