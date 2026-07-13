import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  AutomaticSessionStateV1Schema,
  type AutomaticSessionStateV1,
} from "../types/automaticWorkflowV4";
import { getSessionDirectory } from "./candidateStore";
import { withSessionTransaction } from "./sessionTransaction";

const allowed = new Map<string, Set<string>>([
  ["created", new Set(["analyzing"])],
  ["analyzing", new Set(["planning", "cancelled", "failed", "recoverable_error"])],
  ["planning", new Set(["validating_arrangement", "cancelled", "failed"])],
  ["validating_arrangement", new Set(["executing_transitions", "manual_review_required", "failed"])],
  ["executing_transitions", new Set(["rendering_candidate", "correcting", "cancelled", "failed"])],
  ["rendering_candidate", new Set(["technical_review", "recoverable_error", "failed"])],
  ["technical_review", new Set(["musical_review", "correcting", "manual_review_required", "failed"])],
  ["musical_review", new Set(["finalizing", "correcting", "manual_review_required", "failed"])],
  ["correcting", new Set(["executing_transitions", "planning", "manual_review_required", "cancelled"])],
  ["manual_review_required", new Set(["correcting", "finalizing", "cancelled"])],
  ["finalizing", new Set(["completed", "recoverable_error", "failed"])],
]);

function statePath(workDir: string, sessionId: string) {
  return path.join(getSessionDirectory(workDir, sessionId), "session-state.json");
}

function writeAtomic(file: string, value: unknown) {
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}

export function readAutomaticSessionState(workDir: string, sessionId: string) {
  const file = statePath(workDir, sessionId);
  if (!fs.existsSync(file)) return null;
  return AutomaticSessionStateV1Schema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
}

export function writeAutomaticSessionState(
  workDir: string,
  state: AutomaticSessionStateV1,
  expectedRevision: number,
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
  writeAtomic(statePath(workDir, state.sessionId), next);
  return next;
}

export function assertLegalSessionTransition(from: string, to: string) {
  if (!allowed.get(from)?.has(to)) throw new Error(`Illegal session transition: ${from} -> ${to}`);
}

export async function withAutomaticSessionTransaction<T>(
  sessionId: string,
  operation: () => Promise<T>,
) { return withSessionTransaction(sessionId, operation); }
