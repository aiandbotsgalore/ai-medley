const locks = new Map<string, Promise<void>>();

export async function withSessionTransaction<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
  const prior = locks.get(sessionId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = prior.then(() => current);
  locks.set(sessionId, queued);
  await prior;
  try { return await operation(); }
  finally { release(); if (locks.get(sessionId) === queued) locks.delete(sessionId); }
}
