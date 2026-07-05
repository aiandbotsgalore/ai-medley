export type PreAnalysisPipelineResult = "skipped" | "completed" | "stopped";

export type PreAnalysisPipelineOptions<TEntry> = {
  entries: TEntry[];
  signal: AbortSignal;
  isActiveRun: () => boolean;
  isAnalyzed: (entry: TEntry) => boolean;
  analyzeEntry: (entry: TEntry) => Promise<void>;
  refreshLibrary: () => Promise<void>;
  concurrency?: number;
  onStart?: (total: number) => void;
  onProgress?: (current: number, total: number) => void;
  onComplete?: () => void;
  onClearProgress?: () => void;
};

export async function runPreAnalysisPipeline<TEntry>(
  options: PreAnalysisPipelineOptions<TEntry>,
): Promise<PreAnalysisPipelineResult> {
  const concurrency = options.concurrency ?? 3;
  const isStopped = () => options.signal.aborted || !options.isActiveRun();
  const unanalyzed = options.entries.filter(
    (entry) => !options.isAnalyzed(entry),
  );
  if (unanalyzed.length === 0) return "skipped";
  if (isStopped()) return "stopped";

  options.onStart?.(unanalyzed.length);
  let completedCount = 0;

  const analyzeOne = async (entry: TEntry) => {
    if (isStopped()) return;
    try {
      await options.analyzeEntry(entry);
    } catch (error: any) {
      if (error?.name === "AbortError" || isStopped()) return;
      throw error;
    }
    if (isStopped()) return;
    completedCount++;
    options.onProgress?.(completedCount, unanalyzed.length);
  };

  for (let i = 0; i < unanalyzed.length; i += concurrency) {
    if (isStopped()) {
      options.onClearProgress?.();
      return "stopped";
    }
    const wave = unanalyzed.slice(i, i + concurrency);
    await Promise.all(wave.map(analyzeOne));
    if (isStopped()) {
      options.onClearProgress?.();
      return "stopped";
    }
  }

  await options.refreshLibrary();
  if (isStopped()) {
    options.onClearProgress?.();
    return "stopped";
  }
  options.onClearProgress?.();
  options.onComplete?.();
  return "completed";
}
