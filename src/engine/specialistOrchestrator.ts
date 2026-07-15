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
  bindLegacyArrangementAuthority,
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
  canonicalize?: (value: T) => T;
  onLog: (message: string) => void;
  onModel: (model: string) => void;
  onRepair?: () => void;
  onRequestAudit?: (audit: ProviderRequestAudit) => void;
};

type AutomaticProviderAttempt = {
  provider: "openrouter";
  model: string;
};

/**
 * Automatic v4 routes its musical decisions through OpenRouter only. Local
 * audio analysis remains local; no Automatic request reaches Gemini Direct.
 */
export function getAutomaticProviderAttempts(
  role: SpecialistRole,
  config: MedleyConfig,
): AutomaticProviderAttempt[] {
  void role;
  return [{
    provider: "openrouter",
    model:
      config.automaticOpenRouterFallbackModel ?? "google/gemini-3.1-pro-preview",
  }];
}

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
 * Apply only an explicitly permitted, review-requested transition change.
 * Natural-language criticism without a safe executable mutation is deliberately
 * not retried: rerendering an identical plan cannot correct it.
 */
export function buildTargetedCorrectionPlan(
  plan: ArrangementPlan,
  review: QualityReview,
): ArrangementPlan | null {
  const corrections = new Map(
    review.corrections.map((item) => [item.transitionId, item]),
  );
  if (!corrections.size || corrections.size !== 1 || review.corrections.length !== 1)
    return null;
  let changed = false;
  const transitions = plan.transitions.map((transition) => {
    const correction = corrections.get(transition.transitionId);
    if (!correction) return transition;
    const permissions = transition.executionPermissions;
    let next = transition;
    const requestedPreset = correction.correctionPreset;
    if (requestedPreset === "shorter_crossfade" || requestedPreset === "longer_crossfade") {
      // The reviewer names a preset only. This deterministic half-second step
      // is resolved locally and must remain inside the plan's locked bounds.
      const delta = requestedPreset === "shorter_crossfade" ? -0.5 : 0.5;
      const requestedDuration = Number((transition.duration + delta).toFixed(3));
      const minDuration = permissions?.minDuration ?? transition.duration;
      const maxDuration = permissions?.maxDuration ?? transition.duration;
      if (
        permissions?.durationMutable === true &&
        requestedDuration >= minDuration &&
        requestedDuration <= maxDuration &&
        requestedDuration !== transition.duration
      ) {
        next = { ...next, duration: requestedDuration };
        changed = true;
      }
      return next;
    }
    const requestedStyle = requestedPreset;
    if (
      requestedStyle &&
      permissions?.styleMutable === true &&
      permissions.allowedStyles?.includes(requestedStyle) &&
      requestedStyle !== transition.style
    ) {
      next = { ...next, style: requestedStyle };
      changed = true;
    }
    return next;
  });
  return changed
    ? ArrangementPlanSchema.parse({
        ...plan,
        arrangementVersion: plan.arrangementVersion + 1,
        transitions,
        warnings: [
          ...plan.warnings,
          `Targeted correction applied from musical review ${review.reviewedAt}.`,
        ],
      })
    : null;
}

function comparisonPlanIdentity(plan: ArrangementPlan) {
  return JSON.stringify({
    orderedTrackIds: plan.orderedTrackIds,
    transitions: plan.transitions.map((transition) => ({
      transitionCandidateId: transition.transitionCandidateId,
      style: transition.style,
      duration: transition.duration,
      beatAlign: transition.beatAlign,
    })),
  });
}

function comparisonOptionStageData(
  projectBrief: ProjectBrief,
  design: MedleyDesignPayload,
  baseline: ArrangementPlan,
) {
  return {
    task:
      "Create one contrasting, safe arrangement option for a person to compare with the baseline. " +
      "Use only the supplied transition candidates. Keep every selected track. Change at least one transition candidate, ordering choice, or permitted execution choice. " +
      "Do not invent timestamps, section IDs, track IDs, or FFmpeg instructions.",
    stageData: buildArrangementStageData(projectBrief, design),
    baseline: {
      orderedTrackIds: baseline.orderedTrackIds,
      transitions: baseline.transitions.map((transition) => ({
        transitionId: transition.transitionId,
        transitionCandidateId: transition.transitionCandidateId,
        style: transition.style,
        duration: transition.duration,
        beatAlign: transition.beatAlign,
      })),
    },
  };
}

/**
 * Provider-free fallback used only when the arrangement specialist cannot
 * produce a valid target-length plan. It uses authoritative local candidates
 * verbatim and never invents section IDs or timestamps.
 */
function fallbackTransitionOptions(
  design: MedleyDesignPayload,
  fromTrackId: string,
  toTrackId: string,
) {
  const pairCandidates = design.transitionMatrixSummary.filter(
    (item) => item.fromTrackId === fromTrackId && item.toTrackId === toTrackId,
  );
  // Preserve both the best-sounding and earliest-exit choices. Retaining only
  // the highest-scoring candidates can make every local fallback too long or
  // give a single track most of the medley.
  return [
    ...pairCandidates.slice().sort((a, b) => b.score - a.score).slice(0, 12),
    ...pairCandidates.slice().sort((a, b) => a.fromExitSec - b.fromExitSec).slice(0, 12),
  ].filter(
    (candidate, candidateIndex, allCandidates) =>
      allCandidates.findIndex(
        (other) =>
          other.fromTrackId === candidate.fromTrackId &&
          other.fromSectionId === candidate.fromSectionId &&
          other.toTrackId === candidate.toTrackId &&
          other.toSectionId === candidate.toSectionId &&
          other.fromExitSec === candidate.fromExitSec &&
          other.toEntrySec === candidate.toEntrySec,
      ) === candidateIndex,
  );
}

function findConnectedFallbackOrders(
  design: MedleyDesignPayload,
  projectBrief: ProjectBrief,
): string[][] {
  const requiredTrackIds = [...new Set(projectBrief.recommendedOrderIds)];
  if (requiredTrackIds.length < 2) return [];
  const pairScore = new Map<string, number>();
  for (const candidate of design.transitionMatrixSummary) {
    const key = `${candidate.fromTrackId}\u0000${candidate.toTrackId}`;
    pairScore.set(key, Math.max(pairScore.get(key) ?? -Infinity, candidate.score));
  }
  const scoreFor = (fromTrackId: string, toTrackId: string) =>
    pairScore.get(`${fromTrackId}\u0000${toTrackId}`) ?? null;
  const connected = (order: string[]) =>
    order.length === requiredTrackIds.length &&
    new Set(order).size === requiredTrackIds.length &&
    order.every((trackId) => requiredTrackIds.includes(trackId)) &&
    order.slice(1).every((trackId, index) => scoreFor(order[index], trackId) !== null);

  // First retain the local intelligence's preferred order when it has a
  // complete route. Then use a bounded graph search to find another route that
  // still includes every selected track when the preferred order has a gap.
  const preferred = connected(projectBrief.recommendedOrderIds)
    ? [projectBrief.recommendedOrderIds]
    : [];
  let paths = requiredTrackIds.map((trackId) => ({ ids: [trackId], score: 0 }));
  while (paths.length && paths[0].ids.length < requiredTrackIds.length) {
    paths = paths
      .flatMap((path) =>
        requiredTrackIds
          .filter((trackId) => !path.ids.includes(trackId))
          .map((trackId) => ({ trackId, score: scoreFor(path.ids.at(-1)!, trackId) }))
          .filter((edge): edge is { trackId: string; score: number } => edge.score !== null)
          .map((edge) => ({
            ids: [...path.ids, edge.trackId],
            score: path.score + edge.score,
          })),
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, 512);
  }
  const alternatives = paths
    .filter((path) => connected(path.ids))
    .sort((a, b) => b.score - a.score)
    .map((path) => path.ids);
  return [...preferred, ...alternatives].filter(
    (order, index, allOrders) =>
      allOrders.findIndex((other) => other.join("\u0000") === order.join("\u0000")) === index,
  );
}

export function buildDeterministicArrangementFallback(
  design: MedleyDesignPayload,
  projectBrief: ProjectBrief,
  context: SpecialistContext,
): ArrangementPlan | null {
  const targetDurationSec = projectBrief.targetDurationSec;
  const candidates = findConnectedFallbackOrders(design, projectBrief).flatMap(
    (orderedTrackIds) => {
      let variants: Array<{
        transitions: MedleyDesignPayload["transitionMatrixSummary"];
        score: number;
      }> = [{ transitions: [], score: 0 }];
      for (let index = 0; index < orderedTrackIds.length - 1; index++) {
        const options = fallbackTransitionOptions(
          design,
          orderedTrackIds[index],
          orderedTrackIds[index + 1],
        );
        if (!options.length) return [];
        variants = variants.flatMap((variant) =>
          options.map((transition) => ({
            transitions: [...variant.transitions, transition],
            score: variant.score + transition.score,
          })),
        );
        if (variants.length > 512)
          variants = variants.sort((a, b) => b.score - a.score).slice(0, 512);
      }
      return variants.map((variant) => {
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
      });
    },
  )
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
  for (const attempt of getAutomaticProviderAttempts(role, config)) {
    const { provider, model } = attempt;
    assertActive(signal);
    onModel(model);
    onLog(`Specialist ${role}: ${provider}/${model}`);
    let repairAttempt = 0;
    let message = prompt;
    while (repairAttempt <= 1) {
      try {
        const session = createProviderSession(
          // The browser carries only server-managed sentinels when configured;
          // each provider route resolves its real credential locally.
          { ...config, provider, model },
          systemInstruction,
          tools,
          0.1,
          [],
          {
            stage: options.stage,
            role,
            requiredToolName: toolName,
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
        const canonical = parsed.success
          ? (options.canonicalize?.(parsed.data) ?? parsed.data)
          : null;
        const issues = parsed.success
          ? (contextualValidate?.(canonical as T) ?? [])
          : formatValidationIssues(parsed.error);
        if (parsed.success && issues.length === 0) return canonical as T;
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
        onLog(
          `Specialist fallback from ${provider}/${model}: ${error?.message || error}`,
        );
        // A provider rejection cannot be repaired by repeating the same
        // request. Move straight to the next configured provider.
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
  const { workflow, plan, correctionCount, executionVersion } = options;
  assertActive(workflow.signal);
  // v4 deliberately has no production specialist. The locked arrangement is
  // compiled directly into authoritative transition requests, which prevents a
  // model from mutating IDs, timestamps, or retrying an invalid tool payload.
  workflow.onStage(correctionCount ? "correction" : "production", null, null);
  workflow.onLog("Deterministic execution compiler: applying locked transitions.");
  const attemptedTransitions = [];
  for (const transition of plan.transitions) {
    assertActive(workflow.signal);
    const request = {
      transitionId: transition.transitionId,
      fromTrackId: transition.fromTrackId,
      fromSectionId: transition.fromSectionId,
      toTrackId: transition.toTrackId,
      toSectionId: transition.toSectionId,
      style: transition.style,
      duration: transition.duration,
      beatAlign: transition.beatAlign,
      notes: transition.notes,
    };
    const response = await fetch("/api/apply-transition", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `${workflow.sessionId}:transition:${executionVersion}:${transition.transitionId}`,
      },
      body: JSON.stringify({
        ...request,
        sessionId: workflow.sessionId,
        executionVersion,
      }),
      signal: workflow.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.success === false) {
      throw new Error(
        data?.error || `Transition ${transition.transitionId} failed (${response.status})`,
      );
    }
    attemptedTransitions.push({
      ...transition,
      success: true,
      actualFromExitSec: data.actualFromExitSec,
      actualToEntrySec: data.actualToEntrySec,
      previewPath: data.outputPath ?? null,
      error: null,
    });
  }
  const report = ExecutionReportSchema.parse({
    schemaVersion: 1,
    executionVersion,
    arrangementVersion: plan.arrangementVersion,
    attemptedTransitions,
    technicalWarnings: [],
    unresolvedFailures: [],
    completedAt: new Date().toISOString(),
  });
  await readJsonResponse(
    await fetch("/api/session/execution-report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `${workflow.sessionId}:execution-report:${executionVersion}`,
      },
      body: JSON.stringify({ sessionId: workflow.sessionId, report }),
      signal: workflow.signal,
    }),
  );
  return report;
}

async function requireAutomaticManualReview(
  workflow: WorkflowOptions,
  reason: string,
) {
  await readJsonResponse(
    await fetch("/api/session/manual-review-required", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `${workflow.sessionId}:manual-review:${workflow.requestSequence}`,
      },
      body: JSON.stringify({ sessionId: workflow.sessionId, reason }),
      signal: workflow.signal,
    }),
  );
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
    workflowVersion: base.workflowVersion ?? 4,
    workflowMode: "automatic",
    savedAt: new Date().toISOString(),
  };
}

export async function runAutomaticSpecialistWorkflow(options: WorkflowOptions) {
  if (options.resume && options.resume.workflowVersion !== 4) {
    throw new Error(
      "This is an Automatic workflow v3 checkpoint. It is preserved and cannot resume through workflow v4.",
    );
  }
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
  if (checkpoint.stage === "manual_review_required") {
    options.onStage("manual_review_required", null, null);
    return {
      summary:
        "Manual review is still required. No provider request or rerender was made while restoring this session.",
      candidateId: null,
      outputPath: null,
      qualityReview: checkpoint.qualityReview,
      manualReviewRequired: true,
    };
  }
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
    options.onStage("context_brief", null, null);
    saveProgress({
      stage: "context_brief",
      activeRole: null,
      activeModel: null,
    });
    const targetDurationSec = Number.isFinite(context.targetDurationSec)
      ? context.targetDurationSec
      : options.config.targetDuration * 60;
    projectBrief = buildDeterministicProjectBrief(
      options.design,
      options.sessionId,
      targetDurationSec,
      context,
    );
    if (!projectBrief) throw new Error("Could not build a deterministic project brief");
    options.onLog("Deterministic project brief generated locally.");
    await readJsonResponse(
      await fetch("/api/session/project-brief", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `${options.sessionId}:project-brief`,
        },
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
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `${options.sessionId}:project-brief`,
        },
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
  if (arrangementPlan) {
    const resumeErrors = validateArrangementForWorkflow(
      arrangementPlan,
      arrangementContext,
      projectBrief,
      options.sessionId,
    );
    if (resumeErrors.length) {
      throw new Error(
        `The saved arrangement is no longer valid: ${resumeErrors.join("; ")}. ` +
        "No draft was rendered. Retry the AI arrangement or change the OpenRouter model.",
      );
    }
  }
  if (!arrangementPlan) {
    options.onStage(
      "arrangement",
      "arrangement",
      options.config.automaticOpenRouterFallbackModel ?? "google/gemini-3.1-pro-preview",
    );
    saveProgress({
      stage: "arrangement",
      activeRole: "arrangement",
      activeModel: options.config.automaticOpenRouterFallbackModel ?? "google/gemini-3.1-pro-preview",
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
      canonicalize: (plan) =>
        bindLegacyArrangementAuthority(plan, arrangementContext),
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
    } catch (error: any) {
      if (options.signal.aborted || isAbortLike(error)) throw error;
      throw new Error(
        "OpenRouter could not produce a valid arrangement. No draft was rendered and no local fallback was used. " +
        `Retry the arrangement or change the OpenRouter model. ${error?.message || ""}`.trim(),
        { cause: error },
      );
    }
    await readJsonResponse(
      await fetch("/api/session/design-plan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `${options.sessionId}:arrangement:${arrangementPlan.arrangementVersion}`,
        },
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
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `${options.sessionId}:arrangement:${arrangementPlan.arrangementVersion}`,
        },
        body: JSON.stringify({
          sessionId: options.sessionId,
          plan: arrangementPlan,
        }),
        signal: options.signal,
      }),
    );
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
        activeRole: null,
        activeModel: null,
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
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": `${options.sessionId}:candidate:${arrangementPlan.arrangementVersion}:${executionVersion}:${currentCandidate?.candidateId ?? "root"}`,
            },
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
        // Rendering the unchanged authoritative arrangement again cannot repair
        // an FFmpeg/manifest failure. Preserve diagnostics and require a real
        // correction or recovery instead of burning the correction budget on
        // identical rerenders.
        throw new Error(
          `Candidate render failed without an automatic rerender: ${repairErrors.join("; ")}`,
        );
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
      qualityReview.candidateId !== currentCandidate.candidateId ||
      qualityReview.reviewSource !== "openrouter_audio"
    ) {
      options.onStage(
        "quality_review",
        "arrangement",
        options.config.automaticOpenRouterFallbackModel ?? "google/gemini-3.1-pro-preview",
      );
      saveProgress({
        stage: "quality_review",
        activeRole: "arrangement",
        activeModel: options.config.automaticOpenRouterFallbackModel ?? "google/gemini-3.1-pro-preview",
      });
      try {
        const wholeMixResponse = await readJsonResponse(
          await fetch("/api/session/audio-review", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: options.sessionId,
              candidateId: currentCandidate.candidateId,
              mode: "whole_mix",
            }),
            signal: options.signal,
          }),
        );
        qualityReview = QualityReviewSchema.parse(wholeMixResponse.review);
        options.onLog(
          `OpenRouter listened to the complete candidate using ${wholeMixResponse.model}.`,
        );
        // A rejected full-mix review gets one small, targeted follow-up. It
        // uploads only the affected registered transition previews, never the
        // source tracks or the full candidate a second time.
        if (!qualityReview.approved && qualityReview.corrections.length) {
          const transitionIds = qualityReview.corrections
            .map((item) => item.transitionId)
            .slice(0, 3);
          const targetedResponse = await readJsonResponse(
            await fetch("/api/session/audio-review", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sessionId: options.sessionId,
                candidateId: currentCandidate.candidateId,
                mode: "targeted",
                transitionIds,
              }),
              signal: options.signal,
            }),
          );
          const targetedReview = QualityReviewSchema.parse(targetedResponse.review);
          qualityReview = QualityReviewSchema.parse({
            ...qualityReview,
            // A clip-only response cannot overrule the whole-mix rejection.
            approved: false,
            corrections: targetedReview.corrections.length
              ? targetedReview.corrections
              : qualityReview.corrections,
            warnings: [...new Set([...qualityReview.warnings, ...targetedReview.warnings])],
            blockingIssues: [
              ...new Set([
                ...qualityReview.blockingIssues,
                ...targetedReview.blockingIssues,
              ]),
            ],
          });
          options.onLog(
            `Gemini checked ${transitionIds.length} transition clip(s) using ${targetedResponse.model}.`,
          );
        }
      } catch (error: any) {
        if (isAbortLike(error) || options.signal.aborted) throw error;
        const summary =
          "OpenRouter could not complete the audio review. The technically valid candidate was preserved for manual review; it was not approved automatically.";
        options.onLog(`${summary} ${error?.message || ""}`.trim());
        await requireAutomaticManualReview(options, summary);
        options.onStage("manual_review_required", null, null);
        await saveRequired({
          stage: "manual_review_required",
          currentCandidate,
          qualityReview: null,
        });
        return {
          summary,
          candidateId: null,
          outputPath: null,
          qualityReview: null,
          manualReviewRequired: true,
        };
      }
      options.onMetrics(qualityReview);
      await readJsonResponse(
        await fetch("/api/session/quality-review", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": `${options.sessionId}:musical-review:${currentCandidate.candidateId}`,
          },
          body: JSON.stringify({
            sessionId: options.sessionId,
            review: qualityReview,
          }),
          signal: options.signal,
        }),
      );
      await saveRequired({ qualityReview, currentCandidate });
    }

    if (qualityReview.approved) {
      if (
        currentCandidate.candidateVersion === 1 &&
        correctionCount === 0
      ) {
        let alternativePlan: ArrangementPlan;
        try {
          options.onLog(
            "Draft 1 passed review. Building one distinct, safe option for comparison.",
          );
          alternativePlan = await requestStructuredArtifact({
            role: "arrangement",
            stage: "candidate_options",
            config: options.config,
            sessionId: options.sessionId,
            signal: options.signal,
            schema: ArrangementPlanSchema,
            toolName: "set_design_plan",
            systemInstruction: SPECIALIST_SYSTEM_PROMPTS.arrangement,
            tools: [...SPECIALIST_TOOLS.arrangement],
            prompt: JSON.stringify(
              comparisonOptionStageData(
                projectBrief,
                options.design,
                arrangementPlan,
              ),
            ),
            contextualValidate: (plan) => {
              const errors = validateArrangementForWorkflow(
                plan,
                arrangementContext,
                projectBrief,
                options.sessionId,
              );
              if (comparisonPlanIdentity(plan) === comparisonPlanIdentity(arrangementPlan)) {
                errors.push(
                  "The comparison option must differ from the baseline arrangement.",
                );
              }
              return errors;
            },
            canonicalize: (plan) =>
              ArrangementPlanSchema.parse({
                ...bindLegacyArrangementAuthority(plan, arrangementContext),
                arrangementVersion: arrangementPlan.arrangementVersion + 1,
                warnings: [
                  ...plan.warnings,
                  "Distinct comparison option generated for human review.",
                ],
              }),
            onLog: options.onLog,
            onModel: (model) => {
              options.onStage("candidate_options", "arrangement", model);
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
        } catch (error: any) {
          const summary =
            "Draft 1 passed the technical and AI music reviews. A distinct second option could not be produced safely, so Draft 1 is preserved for your choice; no final MP3 was created automatically.";
          options.onLog(`${summary} ${error?.message || ""}`.trim());
          await requireAutomaticManualReview(options, summary);
          options.onStage("manual_review_required", null, null);
          await saveRequired({
            stage: "manual_review_required",
            currentCandidate,
            qualityReview,
          });
          return {
            summary,
            candidateId: null,
            outputPath: null,
            qualityReview,
            manualReviewRequired: true,
          };
        }

        await readJsonResponse(
          await fetch("/api/session/prepare-comparison-option", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": `${options.sessionId}:comparison-option:${alternativePlan.arrangementVersion}`,
            },
            body: JSON.stringify({ sessionId: options.sessionId }),
            signal: options.signal,
          }),
        );
        arrangementPlan = alternativePlan;
        await readJsonResponse(
          await fetch("/api/session/design-plan", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": `${options.sessionId}:arrangement:${arrangementPlan.arrangementVersion}`,
            },
            body: JSON.stringify({
              sessionId: options.sessionId,
              plan: arrangementPlan,
            }),
            signal: options.signal,
          }),
        );
        options.onLog("Comparison option locked locally. Rendering Draft 2.");
        qualityReview = null;
        productionRepairErrors = [];
        await saveRequired({
          stage: "production",
          arrangementPlan,
          currentCandidate,
          qualityReview,
          activeRole: null,
          activeModel: null,
        });
        continue;
      }
      const summary =
        "This draft passed the technical and AI music reviews. It is preserved for you to listen to and choose; no final MP3 was created automatically.";
      // Quality review is a recommendation, never a substitute for the
      // person's explicit choice in Candidate Review.
      await requireAutomaticManualReview(options, summary);
      options.onStage("manual_review_required", null, null);
      await saveRequired({
        stage: "manual_review_required",
        currentCandidate,
        qualityReview,
      });
      return {
        summary,
        candidateId: null,
        outputPath: null,
        qualityReview,
        manualReviewRequired: true,
      };
    }
    if (correctionCount >= MAX_CORRECTION_RETRIES) {
      const summary =
        `Automatic correction limit reached after ${MAX_CORRECTION_RETRIES} correction cycle(s). ` +
        "The latest technically valid candidate was preserved for manual review; nothing was finalized.";
      await requireAutomaticManualReview(options, summary);
      options.onStage("manual_review_required", null, null);
      await saveRequired({
        stage: "manual_review_required",
        currentCandidate,
        qualityReview,
      });
      return {
        summary,
        candidateId: null,
        outputPath: null,
        qualityReview,
        manualReviewRequired: true,
      };
    }
    const correctedPlan = buildTargetedCorrectionPlan(
      arrangementPlan,
      qualityReview,
    );
    if (!correctedPlan) {
      const summary =
        "The musical review did not contain an explicitly permitted transition change. " +
        "The candidate was preserved for manual review instead of rerendering the same plan.";
      await requireAutomaticManualReview(options, summary);
      options.onStage("manual_review_required", null, null);
      await saveRequired({
        stage: "manual_review_required",
        currentCandidate,
        qualityReview,
      });
      return {
        summary,
        candidateId: null,
        outputPath: null,
        qualityReview,
        manualReviewRequired: true,
      };
    }
    arrangementPlan = correctedPlan;
    await readJsonResponse(
      await fetch("/api/session/design-plan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `${options.sessionId}:arrangement:${arrangementPlan.arrangementVersion}`,
        },
        body: JSON.stringify({
          sessionId: options.sessionId,
          plan: arrangementPlan,
        }),
        signal: options.signal,
      }),
    );
    correctionCount++;
    options.onLog(
      `Correction cycle ${correctionCount}/${MAX_CORRECTION_RETRIES}`,
    );
    await saveRequired({
      stage: "correction",
      correctionCount,
      arrangementPlan,
      currentCandidate: null,
    });
    currentCandidate = null;
  }

  throw new Error(
    "Automatic workflow reached an invalid state before Candidate Review. No final MP3 was created.",
  );
}
