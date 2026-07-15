import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  AutomaticSessionStateV1Schema,
  IdempotencyOperationV1Schema,
  type AutomaticSessionStateV1,
} from "../types/automaticWorkflowV4";
import { getSessionDirectory } from "./candidateStore";
import { withSessionTransaction } from "./sessionTransaction";
import { stableHash } from "./sessionIdempotency";

const allowed = new Map<string, Set<string>>([
  ["created", new Set(["analyzing"])],
  ["analyzing", new Set(["planning", "cancelled", "failed", "recoverable_error"])],
  ["planning", new Set(["validating_arrangement", "cancelled", "failed"])],
  ["validating_arrangement", new Set(["executing_transitions", "manual_review_required", "failed"])],
  ["executing_transitions", new Set(["rendering_candidate", "correcting", "cancelled", "failed"])],
  ["rendering_candidate", new Set(["technical_review", "recoverable_error", "failed"])],
  ["technical_review", new Set(["musical_review", "correcting", "manual_review_required", "failed"])],
  ["musical_review", new Set(["generating_options", "correcting", "manual_review_required", "failed"])],
  ["generating_options", new Set(["validating_arrangement", "manual_review_required", "failed"])],
  ["correcting", new Set(["executing_transitions", "planning", "manual_review_required", "cancelled"])],
  ["manual_review_required", new Set(["correcting", "finalizing", "cancelled"])],
  ["finalizing", new Set(["completed", "recoverable_error", "failed"])],
]);

function statePath(workDir: string, sessionId: string) {
  return path.join(getSessionDirectory(workDir, sessionId), "session-state.json");
}

export type AutomaticStateWrite = (file: string, value: unknown) => void;

export const writeAutomaticStateAtomic: AutomaticStateWrite = (file, value) => {
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(temporary, "wx");
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporary, file);
  } catch (error) {
    if (descriptor !== null) fs.closeSync(descriptor);
    try {
      if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    } catch {
      // Preserve the original failed-write cause.
    }
    throw error;
  }
};

export function readAutomaticSessionState(workDir: string, sessionId: string) {
  const file = statePath(workDir, sessionId);
  if (!fs.existsSync(file)) return null;
  return AutomaticSessionStateV1Schema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
}

export function writeAutomaticSessionState(
  workDir: string,
  state: AutomaticSessionStateV1,
  expectedRevision: number,
  write: AutomaticStateWrite = writeAutomaticStateAtomic,
) {
  const current = readAutomaticSessionState(workDir, state.sessionId);
  const actualRevision = current?.stateRevision ?? -1;
  if (actualRevision !== expectedRevision)
    throw new Error(`State revision conflict: expected ${expectedRevision}, found ${actualRevision}`);
  const next = AutomaticSessionStateV1Schema.parse({
    ...state,
    stateRevision: expectedRevision + 1,
    updatedAt: new Date().toISOString(),
  });
  write(statePath(workDir, state.sessionId), next);
  return next;
}

export function assertLegalSessionTransition(from: string, to: string) {
  if (!allowed.get(from)?.has(to)) throw new Error(`Illegal session transition: ${from} -> ${to}`);
}

/** Advance only one legal durable workflow boundary at a time. */
export function transitionAutomaticSessionState(input: {
  workDir: string;
  sessionId: string;
  to: AutomaticSessionStateV1["state"];
  recoverableError?: string | null;
}) {
  const current = readAutomaticSessionState(input.workDir, input.sessionId);
  if (!current) throw new Error("Automatic v4 session state is missing");
  if (current.state === input.to) return current;
  assertLegalSessionTransition(current.state, input.to);
  return writeAutomaticSessionState(
    input.workDir,
    {
      ...current,
      state: input.to,
      recoverableError: input.recoverableError ?? current.recoverableError,
    },
    current.stateRevision,
  );
}

/**
 * Cancellation is an operator interrupt, not an ordinary workflow step. It is
 * allowed from every non-terminal automatic state so an in-flight render,
 * review, or recovery cannot remain deceptively resumable after its process
 * has been stopped. Completed sessions are intentionally left immutable.
 */
export function cancelAutomaticSessionState(input: {
  workDir: string;
  sessionId: string;
}) {
  const current = readAutomaticSessionState(input.workDir, input.sessionId);
  if (!current) return null;
  if (["completed", "cancelled", "failed"].includes(current.state)) return current;
  return writeAutomaticSessionState(
    input.workDir,
    { ...current, state: "cancelled", recoverableError: null },
    current.stateRevision,
  );
}

export async function withAutomaticSessionTransaction<T>(
  sessionId: string,
  operation: () => Promise<T>,
) { return withSessionTransaction(sessionId, operation); }

function cloneJson<T>(value: T): T {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("Idempotent responses must be JSON serializable");
  }
  return JSON.parse(serialized) as T;
}

/**
 * Persisted v4 idempotency is deliberately part of the authoritative session
 * state, rather than an in-memory cache. This lets a request retry after a
 * restart return the original response without repeating an expensive action.
 * Callers must put their entire state-changing operation in `execute`; this
 * function owns the session coordinator and therefore avoids nested locks.
 */
export async function replayAutomaticSessionIdempotent<T>(input: {
  workDir: string;
  sessionId: string;
  operation: unknown;
  key: string;
  request: unknown;
  execute: () => Promise<T>;
}): Promise<{ replayed: boolean; result: T }> {
  const operation = IdempotencyOperationV1Schema.parse(input.operation);
  if (!input.key.trim()) throw new Error("Idempotency key is required");
  const requestHash = stableHash(input.request);
  return withAutomaticSessionTransaction(input.sessionId, async () => {
    const state = readAutomaticSessionState(input.workDir, input.sessionId);
    if (!state) throw new Error("Automatic v4 session state is missing");
    const existing = state.idempotencyRecords.find(
      (record) => record.operation === operation && record.key === input.key,
    );
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new Error("Idempotency key was reused with a different request");
      }
      if (existing.responseHash !== stableHash(existing.response)) {
        throw new Error("Persisted idempotency response integrity check failed");
      }
      return { replayed: true, result: cloneJson(existing.response) as T };
    }
    const result = await input.execute();
    const response = cloneJson(result);
    // The operation may legally cross one or more durable state boundaries
    // (for example rendering -> technical_review). Re-read before recording
    // the replay result so we never write a stale pre-operation revision over
    // that work.
    const stateAfterOperation = readAutomaticSessionState(input.workDir, input.sessionId);
    if (!stateAfterOperation) throw new Error("Automatic v4 session state is missing after operation");
    writeAutomaticSessionState(
      input.workDir,
      {
        ...stateAfterOperation,
        idempotencyRecords: [
          ...stateAfterOperation.idempotencyRecords,
          {
            operation,
            key: input.key,
            requestHash,
            responseHash: stableHash(response),
            response,
            completedAt: new Date().toISOString(),
          },
        ],
      },
      stateAfterOperation.stateRevision,
    );
    return { replayed: false, result };
  });
}

/** Read an already-completed durable replay record without executing work. */
export function readAutomaticIdempotencyResult<T>(input: {
  workDir: string;
  sessionId: string;
  operation: unknown;
  key: string;
  request: unknown;
}): T | null {
  const operation = IdempotencyOperationV1Schema.parse(input.operation);
  const state = readAutomaticSessionState(input.workDir, input.sessionId);
  if (!state) return null;
  const record = state.idempotencyRecords.find(
    (item) => item.operation === operation && item.key === input.key,
  );
  if (!record) return null;
  if (record.requestHash !== stableHash(input.request)) {
    throw new Error("Idempotency key was reused with a different request");
  }
  if (record.responseHash !== stableHash(record.response)) {
    throw new Error("Persisted idempotency response integrity check failed");
  }
  return cloneJson(record.response) as T;
}
