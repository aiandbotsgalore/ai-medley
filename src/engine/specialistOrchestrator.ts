import { z } from 'zod';
import type { MedleyConfig } from '../components/ConfigPanel';
import type { LibraryFile } from '../components/LibrarySidebar';
import type { MedleyDesignPayload } from './medleyIntelligence';
import { createProviderSession } from './providers';
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
  formatValidationIssues,
  specialistJsonSchemas,
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
  type SpecialistContext,
  type SpecialistRole,
  type SpecialistStage,
} from '../types/specialistWorkflow';

type ToolResponse = { name: string; id: string; response: unknown };

export type { AutomaticWorkflowCheckpoint } from '../types/specialistWorkflow';

type WorkflowOptions = {
  sessionId: string;
  config: MedleyConfig;
  library: LibraryFile[];
  design: MedleyDesignPayload;
  signal: AbortSignal;
  requestSequence: number;
  resume?: AutomaticWorkflowCheckpoint | null;
  onLog: (message: string) => void;
  onStage: (stage: SpecialistStage, role: SpecialistRole | null, model: string | null) => void;
  onCheckpoint: (checkpoint: AutomaticWorkflowCheckpoint) => void;
  onMetrics: (metrics: QualityReview) => void;
};

type StructuredRequestOptions<T> = {
  role: SpecialistRole;
  stage: SpecialistStage;
  config: MedleyConfig;
  sessionId: string;
  signal: AbortSignal;
  schema: z.ZodType<T>;
  toolName: string;
  toolSchema: unknown;
  prompt: string;
  contextualValidate?: (value: T) => string[];
  onLog: (message: string) => void;
  onModel: (model: string) => void;
  onRepair?: () => void;
};

const functionTool = (name: string, description: string, parameters: unknown) => ({
  type: 'function' as const,
  function: { name, description, parameters },
});

function assertActive(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}

async function readJsonResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) {
    const error = new Error(data?.error || `Request failed (${response.status})`);
    (error as any).status = response.status;
    throw error;
  }
  return data;
}

function buildContext(design: MedleyDesignPayload): SpecialistContext {
  return {
    trackIds: new Set(design.tracks.map(track => track.trackId)),
    durationsByTrackId: new Map(design.tracks.map(track => [track.trackId, track.durationSec])),
    sectionsById: new Map(design.sections.map(section => [
      section.sectionId,
      { trackId: section.trackId, startSec: section.startSec, endSec: section.endSec },
    ])),
  };
}

export function compactMedleyDesignForSpecialists(design: MedleyDesignPayload) {
  return {
    schemaVersion: design.schemaVersion,
    userConstraints: design.userConstraints,
    tracks: design.tracks.map(track => ({
      trackId: track.trackId,
      filename: track.filename,
      durationSec: track.durationSec,
      tempoEstimate: track.tempoEstimate,
      tempoConfidence: track.tempoConfidence,
      keyEstimate: track.keyEstimate,
      keyConfidence: track.keyConfidence,
      averageEnergy: track.averageEnergy,
      peakEnergy: track.peakEnergy,
      brightnessProxy: track.brightnessProxy,
      sonicDensityProxy: track.sonicDensityProxy,
      confidence: track.confidence,
      warnings: track.warnings,
    })),
    sections: design.sections.map(section => ({
      sectionId: section.sectionId,
      trackId: section.trackId,
      startSec: section.startSec,
      endSec: section.endSec,
      durationSec: section.durationSec,
      labels: section.labels,
      confidence: section.confidence,
      warnings: section.warnings,
    })),
    transitionMatrixSummary: design.transitionMatrixSummary.map(transition => ({
      fromTrackId: transition.fromTrackId,
      toTrackId: transition.toTrackId,
      fromSectionId: transition.fromSectionId,
      toSectionId: transition.toSectionId,
      fromExitSec: transition.fromExitSec,
      toEntrySec: transition.toEntrySec,
      transitionType: transition.transitionType,
      score: transition.score,
      confidence: transition.confidence,
      reason: transition.reason,
      warnings: transition.warnings,
    })),
    recommendedStrategies: design.recommendedStrategies,
    warnings: design.warnings,
  };
}

function buildArrangementHandoff(projectBrief: ProjectBrief, design: ReturnType<typeof compactMedleyDesignForSpecialists>) {
  const pairBest = new Map<string, (typeof design.transitionMatrixSummary)[number]>();
  for (const transition of design.transitionMatrixSummary) {
    const key = `${transition.fromTrackId}:${transition.toTrackId}`;
    const existing = pairBest.get(key);
    if (!existing || transition.score > existing.score) pairBest.set(key, transition);
  }
  const selected = new Map<string, (typeof design.transitionMatrixSummary)[number]>();
  for (const transition of pairBest.values()) {
    selected.set(
      `${transition.fromTrackId}:${transition.fromSectionId}:${transition.toTrackId}:${transition.toSectionId}`,
      transition,
    );
  }
  for (const transition of design.transitionMatrixSummary.slice(0, 8)) {
    selected.set(
      `${transition.fromTrackId}:${transition.fromSectionId}:${transition.toTrackId}:${transition.toSectionId}`,
      transition,
    );
  }
  return {
    projectBrief: {
      schemaVersion: projectBrief.schemaVersion,
      projectId: projectBrief.projectId,
      targetDurationSec: projectBrief.targetDurationSec,
      trackSummaries: projectBrief.trackSummaries.map(track => ({
        trackId: track.trackId,
        filename: track.filename,
        durationSec: track.durationSec,
        tempoEstimate: track.tempoEstimate,
        keyEstimate: track.keyEstimate,
        confidence: track.confidence,
        recommendedSectionIds: track.recommendedSectionIds,
      })),
      recommendedOrderIds: projectBrief.recommendedOrderIds,
      constraints: projectBrief.constraints,
      summary: projectBrief.summary,
    },
    transitionCandidates: [...selected.values()],
    strategies: design.recommendedStrategies.slice(0, 4),
  };
}

async function requestStructuredArtifact<T>(options: StructuredRequestOptions<T>): Promise<T> {
  const {
    role, config, signal, schema, toolName, toolSchema, prompt,
    contextualValidate, onLog, onModel,
  } = options;
  let lastError: unknown = null;
  for (const model of SPECIALIST_FALLBACKS[role]) {
    assertActive(signal);
    onModel(model);
    onLog(`Specialist ${role}: ${model}`);
    const session = createProviderSession(
      { ...config, provider: 'openrouter', model },
      `You are the ${role} specialist in a staged music-medley workflow. Return results only by calling ${toolName}. Do not invent track IDs, section IDs, or timestamps.`,
      [functionTool(toolName, `Submit the validated ${toolName} artifact.`, toolSchema)],
      0.1,
    );
    let repairAttempt = 0;
    let message = prompt;
    while (repairAttempt <= 1) {
      try {
        const result = await session.send(message, {
          signal,
          requestId: `${options.sessionId}:${options.stage}:${model}:${repairAttempt}`,
          timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
        });
        assertActive(signal);
        const call = result.functionCalls?.find(item => item.name === toolName);
        if (!call) {
          throw new Error(`Expected tool call ${toolName}, but the model returned no matching call`);
        }
        const parsed = schema.safeParse(call.args);
        const issues = parsed.success ? (contextualValidate?.(parsed.data) ?? []) : formatValidationIssues(parsed.error);
        if (parsed.success && issues.length === 0) return parsed.data;
        if (repairAttempt === 0) {
          repairAttempt++;
          message =
            `Your ${toolName} arguments failed validation. Call ${toolName} again with corrected arguments.\n` +
            issues.map(issue => `- ${issue}`).join('\n');
          onLog(`Validation repair requested from ${model}: ${issues.join('; ')}`);
          options.onRepair?.();
          continue;
        }
        throw new Error(`Validation failed after repair: ${issues.join('; ')}`);
      } catch (error: any) {
        lastError = error;
        if (signal.aborted) throw error;
        onLog(`Specialist fallback from ${model}: ${error?.message || error}`);
        break;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`All ${role} specialist models failed`);
}

async function runProductionRole(options: {
  workflow: WorkflowOptions;
  plan: ArrangementPlan;
  correctionCount: number;
  review: QualityReview | null;
  executionVersion: number;
  onRepair: () => void;
  onModel: (model: string) => void;
}): Promise<ExecutionReport> {
  const { workflow, plan, correctionCount, review, executionVersion } = options;
  const reportTool = functionTool(
    'submit_execution_report',
    'Submit the complete production execution report after every transition has been attempted.',
    specialistJsonSchemas.executionReport,
  );
  const transitionTool = functionTool(
    'apply_musical_transition',
    'Apply one transition from the locked arrangement plan.',
    {
      type: 'object',
      additionalProperties: false,
      required: [
        'transitionId', 'fromTrackId', 'fromSectionId', 'toTrackId',
        'toSectionId', 'style', 'duration', 'beatAlign',
      ],
      properties: {
        transitionId: { type: 'string' },
        fromTrackId: { type: 'string' },
        fromSectionId: { type: 'string' },
        toTrackId: { type: 'string' },
        toSectionId: { type: 'string' },
        style: { type: 'string' },
        duration: { type: 'number' },
        beatAlign: { type: 'boolean' },
        notes: { type: 'string' },
      },
    },
  );
  let lastError: unknown = null;
  for (const model of SPECIALIST_FALLBACKS.production) {
    assertActive(workflow.signal);
    options.onModel(model);
    workflow.onStage(correctionCount ? 'correction' : 'production', 'production', model);
    workflow.onLog(`Production specialist: ${model}`);
    const session = createProviderSession(
      { ...workflow.config, provider: 'openrouter', model },
      'You are the production specialist. Execute every locked transition with apply_musical_transition. After receiving every result, call submit_execution_report exactly once. Do not change track order or invent IDs.',
      [transitionTool, reportTool],
      0.1,
    );
    const prompt = JSON.stringify({
      task: correctionCount ? 'Apply the requested corrections and execute the full locked plan.' : 'Execute the locked arrangement.',
      sessionId: workflow.sessionId,
      executionVersion,
      correctionCount,
      plan,
      review,
    });
    let result: any;
    let repairUsed = false;
    try {
      result = await session.send(prompt, {
        signal: workflow.signal,
        requestId: `${workflow.sessionId}:production:${model}:start`,
        timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
      });
      for (let turn = 0; turn < 24; turn++) {
        assertActive(workflow.signal);
        const calls = result.functionCalls ?? [];
        if (!calls.length) throw new Error('Production specialist returned no tool calls');
        const responses: ToolResponse[] = [];
        for (const call of calls) {
          if (call.name === 'apply_musical_transition') {
            const parsedRequest = TransitionExecutionRequestSchema.safeParse(call.args);
            const issues = parsedRequest.success
              ? validateTransitionExecutionContext(parsedRequest.data, plan)
              : formatValidationIssues(parsedRequest.error);
            if (!parsedRequest.success || issues.length) {
              responses.push({
                name: call.name,
                id: call.id,
                response: { success: false, error: 'Validation failed', issues },
              });
              continue;
            }
            const response = await fetch('/api/apply-transition', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...parsedRequest.data,
                sessionId: workflow.sessionId,
                executionVersion,
              }),
              signal: workflow.signal,
            });
            const data = await response.json().catch(() => ({}));
            responses.push({ name: call.name, id: call.id, response: data });
            continue;
          }
          if (call.name === 'submit_execution_report') {
            const parsed = ExecutionReportSchema.safeParse(call.args);
            const issues = parsed.success ? validateExecutionContext(parsed.data, plan) : formatValidationIssues(parsed.error);
            if (!parsed.success || issues.length) {
              if (repairUsed) throw new Error(`Execution report validation failed: ${issues.join('; ')}`);
              repairUsed = true;
              options.onRepair();
              responses.push({
                name: call.name,
                id: call.id,
                response: { error: 'Validation failed', issues },
              });
              continue;
            }
            const response = await fetch('/api/session/execution-report', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionId: workflow.sessionId, report: parsed.data }),
              signal: workflow.signal,
            });
            if (!response.ok) {
              const data = await response.json().catch(() => ({}));
              if (repairUsed) {
                throw new Error(data?.error || `Execution report rejected (${response.status})`);
              }
              repairUsed = true;
              options.onRepair();
              responses.push({
                name: call.name,
                id: call.id,
                response: {
                  error: 'Server validation failed',
                  issues: String(data?.error || `Request failed (${response.status})`).split('; '),
                },
              });
              continue;
            }
            return parsed.data;
          }
          responses.push({ name: call.name, id: call.id, response: { error: 'Tool is not available in the production role' } });
        }
        result = await session.send(responses, {
          signal: workflow.signal,
          requestId: `${workflow.sessionId}:production:${model}:${turn}`,
          timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
        });
      }
      throw new Error('Production specialist exceeded the turn limit');
    } catch (error: any) {
      lastError = error;
      if (workflow.signal.aborted) throw error;
      workflow.onLog(`Production fallback from ${model}: ${error?.message || error}`);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('All production specialists failed');
}

function makeCheckpoint(
  base: Omit<AutomaticWorkflowCheckpoint, 'schemaVersion' | 'workflowMode' | 'savedAt'>,
): AutomaticWorkflowCheckpoint {
  return {
    ...base,
    schemaVersion: 3,
    workflowMode: 'automatic',
    savedAt: new Date().toISOString(),
  };
}

export async function runAutomaticSpecialistWorkflow(options: WorkflowOptions) {
  const context = buildContext(options.design);
  const compactDesign = compactMedleyDesignForSpecialists(options.design);
  let checkpoint = options.resume
    ? makeCheckpoint({ ...options.resume, activeRequestSequence: options.requestSequence })
    : makeCheckpoint({
    sessionId: options.sessionId,
    stage: 'context_brief',
    activeRole: null,
    activeModel: null,
    activeRequestSequence: options.requestSequence,
    attemptedModels: [],
    repairCount: 0,
    correctionCount: 0,
    projectBrief: null,
    arrangementPlan: null,
    executionReport: null,
    currentCandidate: null,
    qualityReview: null,
  });
  const save = (patch: Partial<AutomaticWorkflowCheckpoint>) => {
    checkpoint = makeCheckpoint({ ...checkpoint, ...patch });
    options.onCheckpoint(checkpoint);
  };

  let projectBrief = checkpoint.projectBrief;
  if (!projectBrief) {
    options.onStage('context_brief', 'context', SPECIALIST_MODELS.context);
    save({ stage: 'context_brief', activeRole: 'context', activeModel: SPECIALIST_MODELS.context });
    projectBrief = await requestStructuredArtifact({
      role: 'context',
      stage: 'context_brief',
      config: options.config,
      sessionId: options.sessionId,
      signal: options.signal,
      schema: ProjectBriefSchema,
      toolName: 'submit_project_brief',
      toolSchema: specialistJsonSchemas.projectBrief,
      prompt: JSON.stringify({
        task: 'Create a compact factual project brief from this local medley intelligence.',
        projectId: options.sessionId,
        targetDurationSec: options.config.targetDuration * 60,
        design: compactDesign,
      }),
      contextualValidate: brief => [
        ...(brief.projectId !== options.sessionId ? ['projectId: Must match the session ID'] : []),
        ...validateProjectBriefContext(brief, context),
      ],
      onLog: options.onLog,
      onModel: model => {
        options.onStage('context_brief', 'context', model);
        save({
          activeRole: 'context',
          activeModel: model,
          attemptedModels: [...new Set([...checkpoint.attemptedModels, model])],
        });
      },
      onRepair: () => save({ repairCount: checkpoint.repairCount + 1 }),
    });
    await readJsonResponse(await fetch('/api/session/project-brief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: options.sessionId, brief: projectBrief }),
      signal: options.signal,
    }));
    save({ stage: 'arrangement', projectBrief });
  } else {
    await readJsonResponse(await fetch('/api/session/project-brief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: options.sessionId, brief: projectBrief }),
      signal: options.signal,
    }));
  }

  let arrangementPlan = checkpoint.arrangementPlan;
  if (!arrangementPlan) {
    const arrangementHandoff = buildArrangementHandoff(projectBrief, compactDesign);
    options.onStage('arrangement', 'arrangement', SPECIALIST_MODELS.arrangement);
    save({ stage: 'arrangement', activeRole: 'arrangement', activeModel: SPECIALIST_MODELS.arrangement });
    arrangementPlan = await requestStructuredArtifact({
      role: 'arrangement',
      stage: 'arrangement',
      config: options.config,
      sessionId: options.sessionId,
      signal: options.signal,
      schema: ArrangementPlanSchema,
      toolName: 'set_design_plan',
      toolSchema: specialistJsonSchemas.arrangementPlan,
      prompt: JSON.stringify({
        task: 'Create one exact, musically coherent arrangement using only supplied IDs and timestamps.',
        ...arrangementHandoff,
      }),
      contextualValidate: plan => {
        const errors = validateArrangementContext(plan, context);
        if (plan.projectId !== options.sessionId) errors.push('projectId: Must match the session ID');
        const expected = new Set(projectBrief!.recommendedOrderIds);
        const actual = new Set(plan.orderedTrackIds);
        if (expected.size !== actual.size || [...expected].some(trackId => !actual.has(trackId))) {
          errors.push('orderedTrackIds: Must include every track from the project brief');
        }
        return errors;
      },
      onLog: options.onLog,
      onModel: model => {
        options.onStage('arrangement', 'arrangement', model);
        save({
          activeRole: 'arrangement',
          activeModel: model,
          attemptedModels: [...new Set([...checkpoint.attemptedModels, model])],
        });
      },
      onRepair: () => save({ repairCount: checkpoint.repairCount + 1 }),
    });
    await readJsonResponse(await fetch('/api/session/design-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: options.sessionId, plan: arrangementPlan }),
      signal: options.signal,
    }));
    save({ stage: 'production', arrangementPlan });
  } else {
    await readJsonResponse(await fetch('/api/session/design-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: options.sessionId, plan: arrangementPlan }),
      signal: options.signal,
    }));
  }

  let correctionCount = checkpoint.correctionCount;
  let currentCandidate = checkpoint.currentCandidate;
  let qualityReview = checkpoint.qualityReview;
  while (true) {
    let executionReport = checkpoint.executionReport;
    let candidateData: { candidate: RenderCandidate; quality: unknown };
    const canReuseCandidate =
      currentCandidate &&
      (checkpoint.stage === 'quality_review' || checkpoint.stage === 'final_render');

    if (!canReuseCandidate) {
      const executionVersion = (checkpoint.executionReport?.executionVersion ?? 0) + 1;
      save({
        stage: correctionCount ? 'correction' : 'production',
        activeRole: 'production',
        activeModel: SPECIALIST_MODELS.production,
      });
      executionReport = await runProductionRole({
        workflow: options,
        plan: arrangementPlan,
        correctionCount,
        review: qualityReview,
        executionVersion,
        onRepair: () => save({ repairCount: checkpoint.repairCount + 1 }),
        onModel: model => save({
          activeRole: 'production',
          activeModel: model,
          attemptedModels: [...new Set([...checkpoint.attemptedModels, model])],
        }),
      });
      save({ stage: 'review_candidate', executionReport });
      options.onStage('review_candidate', null, null);
      candidateData = await readJsonResponse(await fetch('/api/render-review-candidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: options.sessionId,
          arrangementVersion: arrangementPlan.arrangementVersion,
          executionVersion,
          parentCandidateId: currentCandidate?.candidateId ?? null,
        }),
        signal: options.signal,
      }));
      currentCandidate = candidateData.candidate;
      qualityReview = null;
      save({ stage: 'quality_review', currentCandidate, qualityReview });
    } else {
      candidateData = {
        candidate: currentCandidate,
        quality: {
          note: 'Reused validated immutable candidate from checkpoint.',
          metrics: currentCandidate.metrics,
          warnings: currentCandidate.warnings,
        },
      };
    }

    if (!executionReport) throw new Error('No execution report is available for quality review');
    if (!qualityReview || qualityReview.candidateId !== currentCandidate.candidateId) {
      options.onStage('quality_review', 'arrangement', SPECIALIST_MODELS.arrangement);
      save({ stage: 'quality_review', activeRole: 'arrangement', activeModel: SPECIALIST_MODELS.arrangement });
      qualityReview = await requestStructuredArtifact({
        role: 'arrangement',
        stage: 'quality_review',
        config: options.config,
        sessionId: options.sessionId,
        signal: options.signal,
        schema: QualityReviewSchema,
        toolName: 'submit_quality_review',
        toolSchema: specialistJsonSchemas.qualityReview,
        prompt: JSON.stringify({
          task: 'Review the assembled candidate using the execution report and objective local quality measurements. Approve it unless specific correctable issues remain.',
          candidate: currentCandidate,
          localQuality: candidateData.quality,
          executionReport,
          correctionCount,
        }),
        contextualValidate: review => {
          const errors: string[] = [];
          if (review.candidateId !== currentCandidate!.candidateId) errors.push('candidateId: Must match the active candidate');
          if (review.arrangementVersion !== arrangementPlan!.arrangementVersion) errors.push('arrangementVersion: Must match the locked plan');
          return errors;
        },
        onLog: options.onLog,
        onModel: model => {
          options.onStage('quality_review', 'arrangement', model);
          save({
            activeRole: 'arrangement',
            activeModel: model,
            attemptedModels: [...new Set([...checkpoint.attemptedModels, model])],
          });
        },
        onRepair: () => save({ repairCount: checkpoint.repairCount + 1 }),
      });
      options.onMetrics(qualityReview);
      await readJsonResponse(await fetch('/api/session/quality-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: options.sessionId, review: qualityReview }),
        signal: options.signal,
      }));
      save({ qualityReview, currentCandidate });
    }

    if (qualityReview.approved || correctionCount >= MAX_CORRECTION_RETRIES) break;
    correctionCount++;
    options.onLog(`Correction cycle ${correctionCount}/${MAX_CORRECTION_RETRIES}`);
    save({ stage: 'correction', correctionCount });
  }

  const manifestData = await readJsonResponse(await fetch(`/api/session/${encodeURIComponent(options.sessionId)}/candidates`, {
    signal: options.signal,
  }));
  const candidateId = manifestData.manifest.selectedCandidateId || currentCandidate?.candidateId;
  if (!candidateId) throw new Error('No technically valid candidate is available for finalization');
  options.onStage('final_render', 'production', SPECIALIST_MODELS.production);
  save({ stage: 'final_render', activeRole: 'production', activeModel: SPECIALIST_MODELS.production });
  const summary = `Specialist medley completed with ${arrangementPlan.transitions.length} transitions and ${correctionCount} correction cycle(s).`;
  const finalData = await readJsonResponse(await fetch('/api/finalize-medley', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: options.sessionId, candidateId, summary }),
    signal: options.signal,
  }));
  options.onStage('completed', null, null);
  return { summary, candidateId, outputPath: finalData.outputPath, qualityReview };
}
