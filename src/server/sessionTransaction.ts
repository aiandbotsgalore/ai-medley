import { AsyncLocalStorage } from "node:async_hooks";

const locks = new Map<string, Promise<void>>();
const activeSessions = new AsyncLocalStorage<Set<string>>();

export async function withSessionTransaction<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
  const active = activeSessions.getStore();
  // A nested mutation for the same session is part of the caller's single
  // transaction, not a second lock acquisition. Different sessions still use
  // independent queues.
  if (active?.has(sessionId)) return operation();
  const prior = locks.get(sessionId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = prior.then(() => current);
  locks.set(sessionId, queued);
  await prior;
  try {
    const nextActive = new Set(active ?? []);
    nextActive.add(sessionId);
    return await activeSessions.run(nextActive, operation);
  }
  finally { release(); if (locks.get(sessionId) === queued) locks.delete(sessionId); }
}
