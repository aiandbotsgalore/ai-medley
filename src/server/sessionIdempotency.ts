import crypto from "node:crypto";

export type IdempotencyReplay<T> =
  | { replayed: true; result: T }
  | { replayed: false; result: T };

type Entry = { requestHash: string; result: unknown };
const entries = new Map<string, Entry>();

export function stableHash(value: unknown) {
  const canonicalize = (input: any): any => {
    if (Array.isArray(input)) return input.map(canonicalize);
    if (input && typeof input === "object")
      return Object.fromEntries(Object.keys(input).sort().map((key) => [key, canonicalize(input[key])]));
    return input;
  };
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

export async function replayIdempotent<T>(input: {
  sessionId: string;
  operation: string;
  key: string;
  request: unknown;
  execute: () => Promise<T>;
}): Promise<IdempotencyReplay<T>> {
  const mapKey = `${input.sessionId}:${input.operation}:${input.key}`;
  const requestHash = stableHash(input.request);
  const existing = entries.get(mapKey);
  if (existing) {
    if (existing.requestHash !== requestHash) throw new Error("Idempotency key was reused with a different request");
    return { replayed: true, result: structuredClone(existing.result) as T };
  }
  const result = await input.execute();
  entries.set(mapKey, { requestHash, result: structuredClone(result) });
  return { replayed: false, result };
}
