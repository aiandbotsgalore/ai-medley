import { z } from "zod";
import type { MedleyConfig } from "../components/ConfigPanel";
import type { LibraryFile } from "../components/LibrarySidebar";
import type { MedleyDesignPayload } from "./medleyIntelligence";
import { createProviderSession } from "./providers";
import type { ProviderRequestAudit } from "./providerRequest";
import {
  SPECIALIST_SYSTEM_PROMPTS,
  SPECIALIST_TOOLS,
  buildArrangementStageData,
  buildContextStageData,
  buildProductionStageData,
  buildQualityReviewStageData,
  compactTransitionToolResult,
} from "./specialistPayloads";
import {
  ArrangementPlanSchema,
  ExecutionReportSchema,
  MAX_CORRECTION_RETRIES,
  ProjectBriefSchema,
  PROVIDER_REQUEST_TIMEOUT_MS,
  QualityReviewSchema,
  SPECIALIST_FALLBACKS,
  SPECIALIST_MODELS,
  TransitionExecutionRequestSchema,
  createTransitionCandidateAuthority,
  createTrackFactAuthority,
  estimateArrangementDurationSec,
  formatValidationIssues,
  validateArrangementContext,
  validateExecutionContext,
  validateProjectBriefContext,
  validateTransitionExecutionContext,
  type ArrangementPlan,
  type AutomaticWorkflowCheckpoint,
  type ExecutionReport,
  type ProjectBrief,
  type QualityReview,
  type RenderCandidate,
  type ResolvedTransition,
  type SpecialistContext,
  type SpecialistRole,
  type SpecialistStage,
} from "../types/specialistWorkflow";

type ToolResponse = { name: string; id: string; response: unknown };

export const PRODUCTION_MAX_TURNS = 48;

export type { AutomaticWorkflowCheckpoint } from "../types/specialistWorkflow";

type WorkflowOptions = {
  sessionId: string;
  config: MedleyConfig;
  library: LibraryFile[];
  design: MedleyDesignPayload;
  signal: AbortSignal;
  requestSequence: number;
  resume?: AutomaticWorkflowCheckpoint | null;
  onLog: (message: string) => void;
  onStage: (
    stage: SpecialistStage,
    role: SpecialistRole | null,
    model: string | null,
  ) => void;
  onCheckpoint: (
    checkpoint: AutomaticWorkflowCheckpoint,
  ) => void | Promise<void>;
  onMetrics: (metrics: QualityReview) => void;
  onProviderRequestAudit?: (audit: ProviderRequestAudit) => void;
};

type StructuredRequestOptions<T> = {
  role: SpecialistRole;
  stage: SpecialistStage;
  config: MedleyConfig;
  sessionId: string;
  signal: AbortSignal;
  schema: z.ZodType<T>;
  toolName: string;
  systemInstruction: string;
  tools: unknown[];
  prompt: string;
  contextualValidate?: (value: T) => string[];
  onLog: (message: string) => void;
  onModel: (model: string) => void;
  onRepair?: () => void;
  onRequestAudit?: (audit: ProviderRequestAudit) => void;
};

function assertActive(signal: AbortSignal) {
  if (signal.aborted)
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

function isAbortLike(error: unknown) {
  return (
    (error as any)?.name === "AbortError" ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}

function renderDiagnosticValue(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const text =
    typeof value === "string"
      ? value
      : (() => {
          try {
            return JSON.stringify(value);
          } catch {
            return String(value);
          }
        })();
  return text.slice(0, 1_000);
}

export function normalizeRenderFailureFeedback(
  payload: unknown,
  error?: unknown,
): string[] {
  const data =
    payload && typeof payload === "object"
      ? (payload as Record<string, any>)
      : {};
  const logFiles =
    data.logFiles && typeof data.logFiles === "object" ? data.logFiles : {};
  const fallbackError =
    error instanceof Error ? error.message : error ? String(error) : null;
  const diagnostics: Array<[string, unknown]> = [
    ["error", data.error ?? fallbackError],
    ["note", data.note],
    ["details", data.details],
    ["logFiles.error", logFiles.error],
    ["logFiles.graph", logFiles.graph],
    ["logFiles.command", logFiles.command],
    ["logFiles.stderr", logFiles.stderr],
    ["renderPath", data.renderPath],
  ];
  const feedback = diagnostics.flatMap(([label, value]) => {
    const normalized = renderDiagnosticValue(value);
    return normalized ? [`${label}: ${normalized}`] : [];
  });
  return feedback.length
    ? feedback
    : ["error: Render candidate failed without diagnostics"];
}

async function readJsonResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) {
    const error = new Error(
      data?.error || `Request failed (${response.status})`,
    );
    (error as any).status = response.status;
    throw error;
  }
  return data;
}

function buildContext(design: MedleyDesignPayload): SpecialistContext {
  return {
    trackIds: new Set(design.tracks.map((track) => track.trackId)),
    durationsByTrackId: new Map(
      design.tracks.map((track) => [track.trackId, track.durationSec]),
    ),
    sectionsById: new Map(
      design.sections.map((section) => [
        section.sectionId,
        {
          trackId: section.trackId,
          startSec: section.startSec,
          endSec: section.endSec,
        },
      ]),
    ),
    targetDurationSec: Number(design.userConstraints.targetDurationMinutes) * 60,
    factsByTrackId: new Map(
      design.tracks.map((track) => [
        track.trackId,
        {
          trackId: track.trackId,
          filename: track.filename,
          durationSec: track.durationSec,
          tempoEstimate: track.tempoEstimate,
          keyEstimate: track.keyEstimate ?? null,
          confidence: track.confidence,
        },
      ]),
    ),
    transitionCandidatesById: new Map(
      design.transitionMatrixSummary.map((candidate) => [
        createTransitionCandidateAuthority(candidate),
        candidate,
      ]),
    ),
  };
}

function validateArrangementForWorkflow(
  plan: ArrangementPlan,
  context: SpecialistContext,
  projectBrief: ProjectBrief,
  sessionId: string,
) {
  const errors = validateArrangementContext(plan, context);
  if (plan.projectId !== sessionId)
    errors.push("projectId: Must match the session ID");
  const expected = new Set(projectBrief.recommendedOrderIds);
  const actual = new Set(plan.orderedTrackIds);
  if (
    expected.size !== actual.size ||
    [...expected].some((trackId) => !actual.has(trackId))
  ) {
    errors.push(
      "orderedTrackIds: Must include every track from the project brief",
    );
  }
  return errors;
}

/**
 * Provider-free context fallback. It keeps every locally analyzed track and
 * chooses the best locally ranked order without inventing audio facts.
 */
export function buildDeterministicProjectBrief(
  design: MedleyDesignPayload,
  projectId: string,
  targetDurationSec: number,
  context: SpecialistContext,
): ProjectBrief | null {
  if (design.tracks.length < 2 || !Number.isFinite(targetDurationSec)) return null;
  const trackIds = design.tracks.map((track) => track.trackId);
  const trackIdSet = new Set(trackIds);
  const recommendedOrderIds = [...design.recommendedStrategies]
    .sort((a, b) => b.score - a.score)
    .map((strategy) => strategy.orderedTracks.map((track) => track.trackId))
    .find(
      (order) =>
        order.length === trackIds.length &&
        new Set(order).size === trackIds.length &&
        order.every((trackId) => trackIdSet.has(trackId)),
    ) ?? trackIds;
  const brief = ProjectBriefSchema.parse({
    schemaVersion: 1,
    projectId,
    targetDurationSec,
    trackSummaries: design.tracks.map((track) => {
      const authority = context.factsByTrackId?.get(track.trackId);
      return {
        trackId: track.trackId,
        factId: authority ? createTrackFactAuthority(authority) : undefined,
        filename: track.filename,
        durationSec: track.durationSec,
        tempoEstimate: track.tempoEstimate,
        keyEstimate: track.keyEstimate ?? null,
        confidence: track.confidence,
        recommendedSectionIds: design.sections
          .filter((section) => section.trackId === track.trackId)
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, 12)
          .map((section) => section.sectionId),
        warnings: track.warnings.slice(0, 12),
      };
    }),
    recommendedOrderIds,
    constraints: ["Local fallback used because the AI context response was unavailable."],
    warnings: ["AI context brief was unavailable; local audio analysis was used."],
    summary: "Locally generated project brief from analyzed selected tracks.",
  });
  return validateProjectBriefContext(brief, context).length ? null : brief;
}

function styleForTransitionType(
  type: MedleyDesignPayload["transitionMatrixSummary"][number]["transitionType"],
): ArrangementPlan["transitions"][number]["style"] {
  switch (type) {
    case "hard_cut":
    case "surprise_contrast":
    case "finale_launch":
      return "dramatic_cut";
    case "energy_lift":
    case "build_transition":
      return "energy_ramp";
    case "energy_drop":
    case "reset_moment":
      return "reset_moment";
    default:
      return "smooth_blend";
  }
}

/**
 * Provider-free fallback used only when the arrangement specialist cannot
 * produce a valid target-length plan. It uses authoritative local candidates
 * verbatim and never invents section IDs or timestamps.
 */
export function buildDeterministicArrangementFallback(
  design: MedleyDesignPayload,
  projectBrief: ProjectBrief,
  context: SpecialistContext,
): ArrangementPlan | null {
  const orderedTrackIds = projectBrief.recommendedOrderIds;
  if (orderedTrackIds.length < 2) return null;
  let variants: Array<{
    transitions: MedleyDesignPayload["transitionMatrixSummary"];
    score: number;
  }> = [{ transitions: [], score: 0 }];
  for (let index = 0; index < orderedTrackIds.length - 1; index++) {
    const fromTrackId = orderedTrackIds[index];
    const toTrackId = orderedTrackIds[index + 1];
    const options = design.transitionMatrixSummary
      .filter(
        (item) =>
          item.fromTrackId === fromTrackId && item.toTrackId === toTrackId,
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    if (!options.length) return null;
    variants = variants.flatMap((variant) =>
      options.map((transition) => ({
        transitions: [...variant.transitions, transition],
        score: variant.score + transition.score,
      })),
    );
    // Bound the fallback for large libraries while retaining the best local paths.
    if (variants.length > 512)
      variants = variants.sort((a, b) => b.score - a.score).slice(0, 512);
  }
  const targetDurationSec = projectBrief.targetDurationSec;
  const candidates = variants
    .map((variant) => {
      const plan = ArrangementPlanSchema.parse({
        schemaVersion: 1,
        arrangementVersion: 1,
        projectId: projectBrief.projectId,
        strategy: "Local target-matched fallback",
        orderedTrackIds,
        transitions: variant.transitions.map((transition, index) => ({
          transitionId: `local-transition-${index + 1}`,
          transitionCandidateId: createTransitionCandidateAuthority(transition),
          fromTrackId: transition.fromTrackId,
          fromSectionId: transition.fromSectionId,
          toTrackId: transition.toTrackId,
          toSectionId: transition.toSectionId,
          fromExitSec: transition.fromExitSec,
          toEntrySec: transition.toEntrySec,
          duration: 4,
          style: styleForTransitionType(transition.transitionType),
          beatAlign: transition.transitionType !== "hard_cut",
          notes: "Local deterministic arrangement fallback",
        })),
        confidence: Math.min(1, variant.score / Math.max(1, variants.length)),
        warnings: ["AI arrangement was unavailable; local transition candidates were used."],
      });
      return {
        plan,
        score: variant.score,
        durationSec: estimateArrangementDurationSec(plan, context),
        errors: validateArrangementContext(plan, context),
      };
    })
    .filter((candidate) => candidate.errors.length === 0)
    .sort((a, b) => {
      const aDistance = Math.abs((a.durationSec ?? Infinity) - targetDurationSec);
      const bDistance = Math.abs((b.durationSec ?? Infinity) - targetDurationSec);
      return aDistance - bDistance || b.score - a.score;
    });
  return candidates[0]?.plan ?? null;
}

async function requestStructuredArtifact<T>(
  options: StructuredRequestOptions<T>,
): Promise<T> {
  const {
    role,
    config,
    signal,
    schema,
    toolName,
    systemInstruction,
    tools,
    prompt,
    contextualValidate,
    onLog,
    onModel,
  } = options;
  let lastError: unknown = null;
  for (const model of SPECIALIST_FALLBACKS[role]) {
    assertActive(signal);
    onModel(model);
    onLog(`Specialist ${role}: ${model}`);
    let repairAttempt = 0;
    let message = prompt;
    while (repairAttempt <= 1) {
      try {
        const session = createProviderSession(
          { ...config, provider: "openrouter", model },
          systemInstruction,
          tools,
          0.1,
          [],
          {
            stage: options.stage,
            role,
            onRequestAudit: options.onRequestAudit,
          },
        );
        const result = await session.send(message, {
          signal,
          requestId: `${options.sessionId}:${options.stage}:${model}:${repairAttempt}`,
          timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
          messageCategory: repairAttempt ? "repairErrors" : "stageData",
        });
        assertActive(signal);
        const call = result.functionCalls?.find(
          (item) => item.name === toolName,
        );
        if (!call) {
          throw new Error(
            `Expected tool call ${toolName}, but the model returned no matching call`,
          );
        }
        const parsed = schema.safeParse(call.args);
        const issues = parsed.success
          ? (contextualValidate?.(parsed.data) ?? [])
          : formatValidationIssues(parsed.error);
        if (parsed.success && issues.length === 0) return parsed.data;
        if (repairAttempt === 0) {
          repairAttempt++;
          message = JSON.stringify({
            task: `Repair the ${toolName} artifact and call ${toolName} again.`,
            stageData: JSON.parse(prompt),
            repairErrors: issues,
          });
          onLog(
            `Validation repair requested from ${model}: ${issues.join("; ")}`,
          );
          options.onRepair?.();
          continue;
        }
        throw new Error(`Validation failed after repair: ${issues.join("; ")}`);
      } catch (error: any) {
        lastError = error;
        if (signal.aborted) throw error;
        onLog(`Specialist fallback from ${model}: ${error?.message || error}`);
        break;
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`All ${role} specialist models failed`);
}

async function runProductionRole(options: {
  workflow: WorkflowOptions;
  plan: ArrangementPlan;
  correctionCount: number;
  review: QualityReview | null;
  repairErrors?: string[];
  executionVersion: number;
  onRepair: () => void;
  onModel: (model: string) => void;
}): Promise<ExecutionReport> {
  const { workflow, plan, correctionCount, review, executionVersion } = options;
  let lastError: unknown = null;
  for (const model of SPECIALIST_FALLBACKS.production) {
    assertActive(workflow.signal);
    options.onModel(model);
    workflow.onStage(
      correctionCount ? "correction" : "production",
      "production",
      model,
    );
    workflow.onLog(`Production specialist: ${model}`);
    const session = createProviderSession(
      { ...workflow.config, provider: "openrouter", model },
      SPECIALIST_SYSTEM_PROMPTS.production,
      [...SPECIALIST_TOOLS.production],
      0.1,
      [],
      {
        stage: correctionCount ? "correction" : "production",
        role: "production",
        onRequestAudit: workflow.onProviderRequestAudit,
      },
    );
    const prompt = JSON.stringify(
      buildProductionStageData({
        sessionId: workflow.sessionId,
        executionVersion,
        correctionCount,
        plan,
        review,
        repairErrors: options.repairErrors,
      }),
    );
    let result: any;
    let repairUsed = false;
    try {
      result = await session.send(prompt, {
        signal: workflow.signal,
        requestId: `${workflow.sessionId}:production:${model}:start`,
        timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
      });
      for (let turn = 0; turn < PRODUCTION_MAX_TURNS; turn++) {
        assertActive(workflow.signal);
        const calls = result.functionCalls ?? [];
        if (!calls.length)
          throw new Error("Production specialist returned no tool calls");
        const responses: ToolResponse[] = [];
        for (const call of calls) {
          if (call.name === "apply_musical_transition") {
            const parsedRequest = TransitionExecutionRequestSchema.safeParse(
              call.args,
            );
            const issues = parsedRequest.success
              ? validateTransitionExecutionContext(parsedRequest.data, plan)
              : formatValidationIssues(parsedRequest.error);
            if (!parsedRequest.success || issues.length) {
              responses.push({
                name: call.name,
                id: call.id,
                response: {
                  success: false,
                  error: "Validation failed",
                  issues,
                },
              });
              continue;
            }
            const response = await fetch("/api/apply-transition", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ...parsedRequest.data,
                sessionId: workflow.sessionId,
                executionVersion,
              }),
              signal: workflow.signal,
            });
            const data = await response.json().catch(() => ({}));
            responses.push({
              name: call.name,
              id: call.id,
              response: compactTransitionToolResult(data),
            });
            continue;
          }
          if (call.name === "submit_execution_report") {
            const parsed = ExecutionReportSchema.safeParse(call.args);
            const issues = parsed.success
              ? validateExecutionContext(parsed.data, plan)
              : formatValidationIssues(parsed.error);
            if (!parsed.success || issues.length) {
              if (repairUsed)
                throw new Error(
                  `Execution report validation failed: ${issues.join("; ")}`,
                );
              repairUsed = true;
              options.onRepair();
              responses.push({
                name: call.name,
                id: call.id,
                response: { error: "Validation failed", issues },
              });
              continue;
            }
            const response = await fetch("/api/session/execution-report", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sessionId: workflow.sessionId,
                report: parsed.data,
              }),
              signal: workflow.signal,
            });
            if (!response.ok) {
              const data = await response.json().catch(() => ({}));
              if (repairUsed) {
                throw new Error(
                  data?.error ||
                    `Execution report rejected (${response.status})`,
                );
              }
              repairUsed = true;
              options.onRepair();
              responses.push({
                name: call.name,
                id: call.id,
                response: {
                  error: "Server validation failed",
                  issues: String(
                    data?.error || `Request failed (${response.status})`,
                  ).split("; "),
                },
              });
              continue;
            }
            return parsed.data;
          }
          responses.push({
            name: call.name,
            id: call.id,
            response: { error: "Tool is not available in the production role" },
          });
        }
        result = await session.send(responses, {
          signal: workflow.signal,
          requestId: `${workflow.sessionId}:production:${model}:${turn}`,
          timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
        });
      }
      throw new Error("Production specialist exceeded the turn limit");
    } catch (error: any) {
      lastError = error;
      if (workflow.signal.aborted) throw error;
      workflow.onLog(
        `Production fallback from ${model}: ${error?.message || error}`,
      );
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("All production specialists failed");
}

function makeCheckpoint(
  base: Omit<
    AutomaticWorkflowCheckpoint,
    "schemaVersion" | "workflowMode" | "savedAt"
  >,
): AutomaticWorkflowCheckpoint {
  return {
    ...base,
    schemaVersion: 3,
    workflowMode: "automatic",
    savedAt: new Date().toISOString(),
  };
}

export async function runAutomaticSpecialistWorkflow(options: WorkflowOptions) {
  const context = buildContext(options.design);
  let checkpoint = options.resume
    ? makeCheckpoint({
        ...options.resume,
        activeRequestSequence: options.requestSequence,
        selectedTrackIds: options.library.length
          ? options.library.map((track) => track.id)
          : options.resume.selectedTrackIds,
      })
    : makeCheckpoint({
        sessionId: options.sessionId,
        stage: "context_brief",
        activeRole: null,
        activeModel: null,
        activeRequestSequence: options.requestSequence,
        attemptedModels: [],
        repairCount: 0,
        correctionCount: 0,
        selectedTrackIds: options.library.map((track) => track.id),
        projectBrief: null,
        arrangementPlan: null,
        executionReport: null,
        currentCandidate: null,
        qualityReview: null,
      });
  const saveProgress = (patch: Partial<AutomaticWorkflowCheckpoint>) => {
    checkpoint = makeCheckpoint({ ...checkpoint, ...patch });
    Promise.resolve(options.onCheckpoint(checkpoint)).catch((error) => {
      options.onLog(
        `Non-critical checkpoint update failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  };
  const saveRequired = async (patch: Partial<AutomaticWorkflowCheckpoint>) => {
    checkpoint = makeCheckpoint({ ...checkpoint, ...patch });
    try {
      await options.onCheckpoint(checkpoint);
    } catch (error: any) {
      if (isAbortLike(error) || options.signal.aborted) throw error;
      throw new Error(
        `Checkpoint persistence failure: ${error?.message || String(error)}`,
      );
    }
  };

  let projectBrief = checkpoint.projectBrief;
  if (!projectBrief) {
    options.onStage("context_brief", "context", SPECIALIST_MODELS.context);
    saveProgress({
      stage: "context_brief",
      activeRole: "context",
      activeModel: SPECIALIST_MODELS.context,
    });
    try {
      projectBrief = await requestStructuredArtifact({
      role: "context",
      stage: "context_brief",
      config: options.config,
      sessionId: options.sessionId,
      signal: options.signal,
      schema: ProjectBriefSchema,
      toolName: "submit_project_brief",
      systemInstruction: SPECIALIST_SYSTEM_PROMPTS.context,
      tools: [...SPECIALIST_TOOLS.context],
      prompt: JSON.stringify(
        buildContextStageData(
          options.design,
          options.sessionId,
          options.config.targetDuration * 60,
        ),
      ),
      contextualValidate: (brief) => [
        ...(brief.projectId !== options.sessionId
          ? ["projectId: Must match the session ID"]
          : []),
        ...validateProjectBriefContext(brief, context),
      ],
      onLog: options.onLog,
      onModel: (model) => {
        options.onStage("context_brief", "context", model);
        saveProgress({
          activeRole: "context",
          activeModel: model,
          attemptedModels: [...new Set([...checkpoint.attemptedModels, model])],
        });
      },
      onRepair: () => saveProgress({ repairCount: checkpoint.repairCount + 1 }),
      onRequestAudit: options.onProviderRequestAudit,
      });
    } catch (error) {
      if (options.signal.aborted || isAbortLike(error)) throw error;
      const targetDurationSec = Number.isFinite(context.targetDurationSec)
        ? context.targetDurationSec
        : options.config.targetDuration * 60;
      const fallback = buildDeterministicProjectBrief(
        options.design,
        options.sessionId,
        targetDurationSec,
        context,
      );
      if (!fallback) throw error;
      options.onLog(
        "AI context response was unavailable or invalid; using a locally generated project brief.",
      );
      projectBrief = fallback;
    }
    await readJsonResponse(
      await fetch("/api/session/project-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: options.sessionId,
          brief: projectBrief,
        }),
        signal: options.signal,
      }),
    );
    await saveRequired({ stage: "arrangement", projectBrief });
  } else {
    await readJsonResponse(
      await fetch("/api/session/project-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: options.sessionId,
          brief: projectBrief,
        }),
        signal: options.signal,
      }),
    );
  }

  const arrangementContext: SpecialistContext = {
    ...context,
    targetDurationSec: projectBrief.targetDurationSec,
  };
  let arrangementPlan = checkpoint.arrangementPlan;
  let replacedInvalidResumedArrangement = false;
  if (arrangementPlan) {
    const resumeErrors = validateArrangementForWorkflow(
      arrangementPlan,
      arrangementContext,
      projectBrief,
      options.sessionId,
    );
    if (resumeErrors.length) {
      const fallback = buildDeterministicArrangementFallback(
        options.design,
        projectBrief,
        arrangementContext,
      );
      if (!fallback) {
        throw new Error(
          `Saved arrangement is no longer valid: ${resumeErrors.join("; ")}`,
        );
      }
      options.onLog(
        "Saved arrangement is no longer valid; using a locally validated target-length arrangement.",
      );
      arrangementPlan = fallback;
      replacedInvalidResumedArrangement = true;
    }
  }
  if (!arrangementPlan) {
    options.onStage(
      "arrangement",
      "arrangement",
      SPECIALIST_MODELS.arrangement,
    );
    saveProgress({
      stage: "arrangement",
      activeRole: "arrangement",
      activeModel: SPECIALIST_MODELS.arrangement,
    });
    try {
      arrangementPlan = await requestStructuredArtifact({
      role: "arrangement",
      stage: "arrangement",
      config: options.config,
      sessionId: options.sessionId,
      signal: options.signal,
      schema: ArrangementPlanSchema,
      toolName: "set_design_plan",
      systemInstruction: SPECIALIST_SYSTEM_PROMPTS.arrangement,
      tools: [...SPECIALIST_TOOLS.arrangement],
      prompt: JSON.stringify(
        buildArrangementStageData(projectBrief, options.design),
      ),
      contextualValidate: (plan) =>
        validateArrangementForWorkflow(
          plan,
          arrangementContext,
          projectBrief,
          options.sessionId,
        ),
      onLog: options.onLog,
      onModel: (model) => {
        options.onStage("arrangement", "arrangement", model);
        saveProgress({
          activeRole: "arrangement",
          activeModel: model,
          attemptedModels: [...new Set([...checkpoint.attemptedModels, model])],
        });
      },
      onRepair: () => saveProgress({ repairCount: checkpoint.repairCount + 1 }),
      onRequestAudit: options.onProviderRequestAudit,
      });
    } catch (error) {
      if (options.signal.aborted || isAbortLike(error)) throw error;
      const fallback = buildDeterministicArrangementFallback(
        options.design,
        projectBrief,
        arrangementContext,
      );
      if (!fallback) throw error;
      options.onLog(
        "AI arrangement was unavailable or invalid; using a locally validated target-length arrangement.",
      );
      arrangementPlan = fallback;
    }
    await readJsonResponse(
      await fetch("/api/session/design-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: options.sessionId,
          plan: arrangementPlan,
        }),
        signal: options.signal,
      }),
    );
    await saveRequired({ stage: "production", arrangementPlan });
  } else {
    await readJsonResponse(
      await fetch("/api/session/design-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: options.sessionId,
          plan: arrangementPlan,
        }),
        signal: options.signal,
      }),
    );
    if (replacedInvalidResumedArrangement)
      await saveRequired({ stage: "production", arrangementPlan });
  }

  let correctionCount = checkpoint.correctionCount;
  let currentCandidate = checkpoint.currentCandidate;
  let qualityReview = checkpoint.qualityReview;
  let productionRepairErrors: string[] = [];
  while (true) {
    let executionReport = checkpoint.executionReport;
    let candidateData: {
      candidate: RenderCandidate;
      quality: unknown;
      resolvedTransitions?: ResolvedTransition[];
    };
    const canReuseCandidate =
      currentCandidate &&
      (checkpoint.stage === "quality_review" ||
        checkpoint.stage === "final_render");

    if (!canReuseCandidate) {
      const executionVersion =
        (checkpoint.executionReport?.executionVersion ?? 0) + 1;
      await saveRequired({
        stage: correctionCount ? "correction" : "production",
        activeRole: "production",
        activeModel: SPECIALIST_MODELS.production,
      });
      executionReport = await runProductionRole({
        workflow: options,
        plan: arrangementPlan,
        correctionCount,
        review: qualityReview,
        repairErrors: productionRepairErrors,
        executionVersion,
        onRepair: () =>
          saveProgress({ repairCount: checkpoint.repairCount + 1 }),
        onModel: (model) =>
          saveProgress({
            activeRole: "production",
            activeModel: model,
            attemptedModels: [
              ...new Set([...checkpoint.attemptedModels, model]),
            ],
          }),
      });
      await saveRequired({ stage: "review_candidate", executionReport });
      options.onStage("review_candidate", null, null);
      let renderPayload: unknown = null;
      try {
        for (let registrationAttempt = 0; registrationAttempt < 2; registrationAttempt++) {
          const response = await fetch("/api/render-review-candidate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: options.sessionId,
              arrangementVersion: arrangementPlan.arrangementVersion,
              executionVersion,
              parentCandidateId: currentCandidate?.candidateId ?? null,
            }),
            signal: options.signal,
          });
          renderPayload = await response.json().catch(() => ({}));
          if (
            response.ok &&
            (renderPayload as any)?.success !== false &&
            (renderPayload as any)?.candidate
          ) {
            break;
          }
          if (
            registrationAttempt === 0 &&
            (renderPayload as any)?.registrationPending === true
          ) {
            options.onLog(
              "Candidate audio rendered successfully; retrying manifest registration without rerendering.",
            );
            continue;
          }
          const renderError = new Error(
            (renderPayload as any)?.error ||
              `Render candidate request failed (${response.status})`,
          );
          (renderError as any).status = response.status;
          throw renderError;
        }
        candidateData = renderPayload as typeof candidateData;
      } catch (error) {
        if (options.signal.aborted || isAbortLike(error)) throw error;
        if ((renderPayload as any)?.registrationPending === true) {
          throw new Error(
            "Candidate audio rendered successfully but manifest registration could not be recovered. The rendered MP3 was preserved; do not rerender until the manifest write failure is resolved.",
          );
        }
        const repairErrors = normalizeRenderFailureFeedback(
          renderPayload,
          error,
        );
        if (correctionCount >= MAX_CORRECTION_RETRIES) {
          throw new Error(
            `Render candidate failed after ${MAX_CORRECTION_RETRIES} correction cycle(s): ${repairErrors.join("; ")}`,
          );
        }
        correctionCount++;
        productionRepairErrors = repairErrors;
        options.onLog(
          `Render candidate failed; starting correction cycle ${correctionCount}/${MAX_CORRECTION_RETRIES}.`,
        );
        await saveRequired({ stage: "correction", correctionCount });
        continue;
      }
      productionRepairErrors = [];
      currentCandidate = candidateData.candidate;
      if (!currentCandidate.resolvedTransitions?.length) {
        throw new Error(
          "Automatic candidate is missing canonical resolved transitions from render",
        );
      }
      qualityReview = null;
      await saveRequired({
        stage: "quality_review",
        currentCandidate,
        qualityReview,
      });
    } else {
      candidateData = {
        candidate: currentCandidate,
        quality: {
          note: "Reused validated immutable candidate from checkpoint.",
          metrics: currentCandidate.metrics,
          warnings: currentCandidate.warnings,
        },
        resolvedTransitions: currentCandidate.resolvedTransitions,
      };
      if (!candidateData.resolvedTransitions?.length) {
        throw new Error(
          "Automatic resume requires candidate.resolvedTransitions from the original render",
        );
      }
    }

    if (!executionReport)
      throw new Error("No execution report is available for quality review");
    if (
      !qualityReview ||
      qualityReview.candidateId !== currentCandidate.candidateId
    ) {
      options.onStage(
        "quality_review",
        "arrangement",
        SPECIALIST_MODELS.arrangement,
      );
      saveProgress({
        stage: "quality_review",
        activeRole: "arrangement",
        activeModel: SPECIALIST_MODELS.arrangement,
      });
      qualityReview = await requestStructuredArtifact({
        role: "arrangement",
        stage: "quality_review",
        config: options.config,
        sessionId: options.sessionId,
        signal: options.signal,
        schema: QualityReviewSchema,
        toolName: "submit_quality_review",
        systemInstruction: SPECIALIST_SYSTEM_PROMPTS.qualityReview,
        tools: [...SPECIALIST_TOOLS.qualityReview],
        prompt: JSON.stringify(
          buildQualityReviewStageData({
            candidate: currentCandidate,
            localQuality: candidateData.quality,
            executionReport,
            resolvedTransitions: candidateData.resolvedTransitions,
            correctionCount,
          }),
        ),
        contextualValidate: (review) => {
          const errors: string[] = [];
          if (review.candidateId !== currentCandidate!.candidateId)
            errors.push("candidateId: Must match the active candidate");
          if (review.arrangementVersion !== arrangementPlan!.arrangementVersion)
            errors.push("arrangementVersion: Must match the locked plan");
          return errors;
        },
        onLog: options.onLog,
        onModel: (model) => {
          options.onStage("quality_review", "arrangement", model);
          saveProgress({
            activeRole: "arrangement",
            activeModel: model,
            attemptedModels: [
              ...new Set([...checkpoint.attemptedModels, model]),
            ],
          });
        },
        onRepair: () =>
          saveProgress({ repairCount: checkpoint.repairCount + 1 }),
        onRequestAudit: options.onProviderRequestAudit,
      });
      options.onMetrics(qualityReview);
      await readJsonResponse(
        await fetch("/api/session/quality-review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: options.sessionId,
            review: qualityReview,
          }),
          signal: options.signal,
        }),
      );
      await saveRequired({ qualityReview, currentCandidate });
    }

    if (qualityReview.approved) break;
    if (correctionCount >= MAX_CORRECTION_RETRIES) {
      throw new Error(
        `Automatic correction limit reached without an approved candidate (${MAX_CORRECTION_RETRIES} correction cycle(s)).`,
      );
    }
    correctionCount++;
    options.onLog(
      `Correction cycle ${correctionCount}/${MAX_CORRECTION_RETRIES}`,
    );
    await saveRequired({ stage: "correction", correctionCount });
  }

  const manifestData = await readJsonResponse(
    await fetch(
      `/api/session/${encodeURIComponent(options.sessionId)}/candidates`,
      {
        signal: options.signal,
      },
    ),
  );
  const selectedCandidate = manifestData.manifest.candidates?.find(
    (candidate: RenderCandidate) =>
      candidate.candidateId === manifestData.manifest.selectedCandidateId,
  );
  const candidateId =
    selectedCandidate?.reviewStatus === "approved" &&
    selectedCandidate.technicallyValid
      ? selectedCandidate.candidateId
      : null;
  if (!candidateId)
    throw new Error(
      "No approved selected candidate is available for automatic finalization",
    );
  options.onStage("final_render", "production", SPECIALIST_MODELS.production);
  await saveRequired({
    stage: "final_render",
    activeRole: "production",
    activeModel: SPECIALIST_MODELS.production,
  });
  const summary = `Specialist medley completed with ${arrangementPlan.transitions.length} transitions and ${correctionCount} correction cycle(s).`;
  const finalData = await readJsonResponse(
    await fetch("/api/finalize-medley", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: options.sessionId,
        candidateId,
        summary,
      }),
      signal: options.signal,
    }),
  );
  options.onStage("completed", null, null);
  return {
    summary,
    candidateId,
    outputPath: finalData.outputPath,
    qualityReview,
  };
}
