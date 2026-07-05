import {
  ArrangementPlanSchema,
  type CandidateManifest,
  type SpecialistContext,
} from "../types/specialistWorkflow";
import { requiresAutomaticCandidateApproval } from "./automaticSessionGuard";
import { resolveAutomaticRenderTransitions } from "./transitionResolution";

type RenderSelectionSession = {
  projectBrief?: unknown;
  workflowMode?: unknown;
  designPlan?: unknown;
  executionReport?: any;
  executionResults?: Record<number, Record<string, unknown>>;
};

export function selectRenderTransitions(input: {
  sessionId: string;
  session: RenderSelectionSession;
  legacy: boolean;
  arrangementVersion: number;
  executionVersion: number;
  manifest: CandidateManifest;
  checkpointDir: string;
  context: SpecialistContext;
}): { automaticSession: boolean; transitions: any[] } {
  const automaticSession =
    !input.legacy &&
    requiresAutomaticCandidateApproval({
      sessionId: input.sessionId,
      session: input.session,
      manifest: input.manifest,
      checkpointDir: input.checkpointDir,
    });

  if (!automaticSession) {
    const executionByTransitionId = new Map(
      (input.session.executionReport?.attemptedTransitions ?? []).map(
        (item: any) => [item.transitionId, item],
      ),
    );
    return {
      automaticSession: false,
      transitions: Array.isArray((input.session.designPlan as any)?.transitions)
        ? (input.session.designPlan as any).transitions.map((planned: any) => {
            const executed: any = executionByTransitionId.get(
              planned.transitionId,
            );
            return {
              ...planned,
              actualFromExitSec:
                executed?.actualFromExitSec ?? planned.actualFromExitSec,
              actualToEntrySec:
                executed?.actualToEntrySec ?? planned.actualToEntrySec,
              durationUsed: executed?.duration ?? planned.durationUsed,
              outputPath: executed?.previewPath ?? planned.outputPath,
            };
          })
        : [],
    };
  }

  const plan = ArrangementPlanSchema.safeParse(input.session.designPlan);
  if (!plan.success) {
    throw new Error(
      "Automatic render requires a valid locked arrangement plan",
    );
  }
  const resolved = resolveAutomaticRenderTransitions({
    plan: plan.data,
    executionVersion: input.executionVersion,
    executionReport: input.session.executionReport,
    executionRecords:
      (input.session.executionResults?.[input.executionVersion] as any) ?? {},
    context: input.context,
  });
  if (resolved.errors.length) {
    throw new Error(
      `Authoritative transition resolution failed: ${resolved.errors.join("; ")}`,
    );
  }
  return {
    automaticSession: true,
    transitions: resolved.transitions,
  };
}
