import {
  ResolvedTransitionSchema,
  TransitionExecutionRequestSchema,
  validateTransitionExecutionContext,
  type ArrangementPlan,
  type ExecutionReport,
  type ResolvedTransition,
  type SpecialistContext,
  type TransitionExecutionRequest,
} from "../types/specialistWorkflow";

export type ServerTransitionExecutionRecord = {
  request: TransitionExecutionRequest | unknown;
  success: boolean;
  actualFromExitSec: number | null;
  actualToEntrySec: number | null;
  previewPath: string | null;
  error: string | null;
};

export type ServerTransitionExecutionRecords = Record<
  string,
  ServerTransitionExecutionRecord | undefined
>;

/** Keeps render-only scratch timings out of strict persisted manifests. */
export function sanitizeResolvedTransitionsForManifest(
  transitions: unknown[],
): ResolvedTransition[] {
  return transitions.map((transition) => {
    const record = transition as Record<string, unknown>;
    const {
      _resolvedFromExitSec: _ignoredFromExitSec,
      _resolvedToEntrySec: _ignoredToEntrySec,
      ...persistedTransition
    } = record;
    return ResolvedTransitionSchema.parse(persistedTransition);
  });
}

function assertFiniteSectionTime(
  errors: string[],
  label: string,
  value: unknown,
  section: { startSec: number; endSec: number } | undefined,
) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    errors.push(`${label}: Missing finite resolved timing`);
    return;
  }
  if (!section) {
    errors.push(`${label}: Selected section is unavailable for validation`);
    return;
  }
  if (value < section.startSec - 0.001 || value > section.endSec + 0.001) {
    errors.push(`${label}: Resolved timing is outside the selected section`);
  }
}

export function resolveAutomaticRenderTransitions(input: {
  plan: ArrangementPlan;
  executionVersion: number;
  executionReport?: ExecutionReport | null;
  executionRecords: ServerTransitionExecutionRecords;
  context: SpecialistContext;
}): { transitions: ResolvedTransition[]; errors: string[] } {
  const errors: string[] = [];
  if (
    input.executionReport &&
    input.executionReport.executionVersion !== input.executionVersion
  ) {
    errors.push(
      "executionReport.executionVersion: Does not match render request",
    );
  }
  if (
    input.executionReport &&
    input.executionReport.arrangementVersion !== input.plan.arrangementVersion
  ) {
    errors.push("executionReport.arrangementVersion: Does not match plan");
  }

  const transitions: ResolvedTransition[] = [];
  for (const planned of input.plan.transitions) {
    const record = input.executionRecords[planned.transitionId];
    if (!record) {
      errors.push(`${planned.transitionId}: Missing server execution record`);
      continue;
    }
    const parsedRequest = TransitionExecutionRequestSchema.safeParse(
      record.request,
    );
    if (!parsedRequest.success) {
      errors.push(`${planned.transitionId}: Invalid server execution request`);
      continue;
    }
    const requestErrors = validateTransitionExecutionContext(
      parsedRequest.data,
      input.plan,
    );
    errors.push(
      ...requestErrors.map((item) => `${planned.transitionId}.${item}`),
    );
    if (!record.success) {
      errors.push(`${planned.transitionId}: Server execution failed`);
    }
    if (!record.previewPath) {
      errors.push(`${planned.transitionId}: Missing server preview path`);
    }

    const fromSection = input.context.sectionsById.get(planned.fromSectionId);
    const toSection = input.context.sectionsById.get(planned.toSectionId);
    assertFiniteSectionTime(
      errors,
      `${planned.transitionId}.actualFromExitSec`,
      record.actualFromExitSec,
      fromSection,
    );
    assertFiniteSectionTime(
      errors,
      `${planned.transitionId}.actualToEntrySec`,
      record.actualToEntrySec,
      toSection,
    );
    if (
      requestErrors.length ||
      !record.success ||
      !record.previewPath ||
      typeof record.actualFromExitSec !== "number" ||
      typeof record.actualToEntrySec !== "number"
    ) {
      continue;
    }

    transitions.push({
      ...planned,
      style: parsedRequest.data.style,
      duration: parsedRequest.data.duration,
      beatAlign: parsedRequest.data.beatAlign,
      actualFromExitSec: record.actualFromExitSec,
      actualToEntrySec: record.actualToEntrySec,
      durationUsed: parsedRequest.data.duration,
      outputPath: record.previewPath,
      executionVersion: input.executionVersion,
    });
  }

  return { transitions, errors };
}
