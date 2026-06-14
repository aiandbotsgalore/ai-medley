import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildMedleyDesignPayload,
  type MedleyDesignPayload,
  type TrackIntelligence,
} from './medleyIntelligence';
import {
  buildOpenRouterRequest,
  largestRequestComponent,
  sanitizeProviderAssistantMessage,
  type CategorizedProviderMessage,
} from './providerRequest';
import {
  SPECIALIST_SYSTEM_PROMPTS,
  SPECIALIST_TOOLS,
  buildArrangementStageData,
  buildContextStageData,
  buildProductionStageData,
  buildQualityReviewStageData,
  compactTransitionToolResult,
} from './specialistPayloads';
import {
  MAX_PROVIDER_REQUEST_BYTES,
  PROVIDER_REGRESSION_TARGET_TOKENS,
  SPECIALIST_FALLBACKS,
  type ArrangementPlan,
  type ExecutionReport,
  type ProjectBrief,
  type QualityReview,
  type RenderCandidate,
} from '../types/specialistWorkflow';

type AuditRow = {
  project: 'normal-3-track' | 'maximum-4-track';
  stage: string;
  model: string;
  requestNumber: number;
  tools: string[];
  utf8Bytes: number;
  estimatedTokens: number;
  actualPromptTokens: null;
  largestComponent: string;
  largestComponentBytes: number;
  pass: boolean;
};

const root = process.cwd();
const library = JSON.parse(fs.readFileSync(path.join(root, 'library', 'db.json'), 'utf8')) as any[];
const wisdom = JSON.parse(fs.readFileSync(path.join(root, 'library', 'wisdom.json'), 'utf8')) as any[];
assert.ok(library.length >= 4, 'The current maximum-library audit requires at least four tracks');

function buildDesign(trackCount: number): MedleyDesignPayload {
  const tracks = library.slice(0, trackCount).map(entry => entry.medleyIntelligence) as TrackIntelligence[];
  assert.equal(tracks.filter(Boolean).length, trackCount, 'Every audit track must have medley intelligence');
  return buildMedleyDesignPayload({
    tracks,
    userConstraints: {
      style: 'smooth-transitions',
      targetDurationMinutes: 10,
      crossfadeDurationSeconds: 5,
    },
    maxTransitions: 32,
    wisdom,
  });
}

function fixtureBrief(design: MedleyDesignPayload, projectId: string): ProjectBrief {
  const context = buildContextStageData(design, projectId, 600);
  const order = context.strategies[0]?.orderedTrackIds ?? context.tracks.map(track => track.trackId);
  return {
    schemaVersion: 1,
    projectId,
    targetDurationSec: 600,
    trackSummaries: context.tracks.map(track => ({
      trackId: track.trackId,
      filename: track.filename,
      durationSec: track.durationSec,
      tempoEstimate: track.tempoEstimate,
      keyEstimate: track.keyEstimate ?? null,
      confidence: track.confidence,
      recommendedSectionIds: track.sections.map(section => section.sectionId),
      warnings: track.warnings,
    })),
    recommendedOrderIds: order,
    constraints: ['style:smooth-transitions', 'targetDurationMinutes:10', 'crossfadeDurationSeconds:5'],
    warnings: context.warnings,
    summary: `${context.tracks.length}-track payload audit brief`,
  };
}

function fixturePlan(design: MedleyDesignPayload, brief: ProjectBrief): ArrangementPlan {
  const arrangement = buildArrangementStageData(brief, design);
  const transitions = brief.recommendedOrderIds.slice(0, -1).map((fromTrackId, index) => {
    const toTrackId = brief.recommendedOrderIds[index + 1];
    const candidate = arrangement.transitionCandidates.find(
      item => item.fromTrackId === fromTrackId && item.toTrackId === toTrackId,
    ) ?? arrangement.transitionCandidates.find(
      item => item.fromTrackId === toTrackId && item.toTrackId === fromTrackId,
    );
    const fromSummary = brief.trackSummaries.find(item => item.trackId === fromTrackId)!;
    const toSummary = brief.trackSummaries.find(item => item.trackId === toTrackId)!;
    const forward = candidate?.fromTrackId === fromTrackId;
    return {
      transitionId: `transition-${index + 1}`,
      fromTrackId,
      fromSectionId: forward ? candidate!.fromSectionId : fromSummary.recommendedSectionIds[0],
      toTrackId,
      toSectionId: forward ? candidate!.toSectionId : toSummary.recommendedSectionIds[0],
      fromExitSec: forward ? candidate!.fromExitSec : Math.min(fromSummary.durationSec, 30),
      toEntrySec: forward ? candidate!.toEntrySec : 0,
      duration: 5,
      style: 'smooth_blend' as const,
      beatAlign: true,
      notes: candidate?.reason.slice(0, 300) ?? 'Fallback audit transition',
    };
  });
  return {
    schemaVersion: 1,
    arrangementVersion: 1,
    projectId: brief.projectId,
    strategy: 'payload_audit',
    orderedTrackIds: brief.recommendedOrderIds,
    transitions,
    confidence: 0.9,
    warnings: [],
  };
}

function fixtureExecutionReport(plan: ArrangementPlan, executionVersion = 1): ExecutionReport {
  return {
    schemaVersion: 1,
    executionVersion,
    arrangementVersion: plan.arrangementVersion,
    attemptedTransitions: plan.transitions.map(item => ({
      ...item,
      success: true,
      actualFromExitSec: item.fromExitSec,
      actualToEntrySec: item.toEntrySec,
      previewPath: `G:\\ai-medley--main\\workdir\\audit\\preview-${item.transitionId}.mp3`,
      error: null,
    })),
    technicalWarnings: [],
    unresolvedFailures: [],
    completedAt: '2026-06-14T00:00:00.000Z',
  };
}

function fixtureCandidate(report: ExecutionReport): RenderCandidate {
  return {
    candidateId: 'candidate-001',
    candidateVersion: 1,
    parentCandidateId: null,
    arrangementVersion: report.arrangementVersion,
    executionVersion: report.executionVersion,
    outputPath: 'G:\\ai-medley--main\\workdir\\audit\\candidate-001.mp3',
    debugPaths: [
      'G:\\ai-medley--main\\workdir\\audit\\candidate-001-stderr.log',
      'G:\\ai-medley--main\\workdir\\audit\\candidate-001-command.txt',
    ],
    previewPaths: report.attemptedTransitions.map(item => item.previewPath!).filter(Boolean),
    sizeBytes: 25_000_000,
    sha256: 'a'.repeat(64),
    durationSec: 600,
    technicallyValid: true,
    metrics: { emotionalArc: 85, transitionSmoothness: 88, performerIdentity: 80, overallScore: 85 },
    reviewStatus: 'pending',
    warnings: ['Loudness in a comfortable modern range.'],
    createdAt: '2026-06-14T00:00:00.000Z',
  };
}

function fixtureReview(candidate: RenderCandidate, plan: ArrangementPlan): QualityReview {
  return {
    schemaVersion: 1,
    candidateId: candidate.candidateId,
    candidateVersion: candidate.candidateVersion,
    arrangementVersion: plan.arrangementVersion,
    approved: false,
    emotionalArc: 82,
    transitionSmoothness: 78,
    performerIdentity: 85,
    overallScore: 81,
    blockingIssues: ['Transition two has a measurable loudness jump.'],
    corrections: [{
      transitionId: plan.transitions[Math.min(1, plan.transitions.length - 1)].transitionId,
      issue: 'Loudness jump',
      requestedChange: 'Reduce the transition gain difference while preserving timing.',
    }],
    warnings: ['One correction requested.'],
    reviewedAt: '2026-06-14T00:00:00.000Z',
  };
}

const rows: AuditRow[] = [];

function audit(input: {
  project: AuditRow['project'];
  stage: string;
  model: string;
  requestNumber: number;
  messages: CategorizedProviderMessage[];
  tools: readonly unknown[];
}) {
  const request = buildOpenRouterRequest({
    model: input.model,
    temperature: 0.1,
    messages: input.messages,
    tools: [...input.tools],
  });
  assert.equal(request.serializedBody, JSON.stringify(request.requestBody), 'Measured body must equal sent body');
  assert.ok(request.utf8Bytes <= MAX_PROVIDER_REQUEST_BYTES, `${input.stage} exceeded byte hard limit`);
  assert.ok(
    request.estimatedTokens <= PROVIDER_REGRESSION_TARGET_TOKENS,
    `${input.stage} exceeded ${PROVIDER_REGRESSION_TARGET_TOKENS} estimated tokens`,
  );
  const wireMessages = JSON.stringify(request.requestBody.messages);
  assert.doesNotMatch(wireMessages, /reasoning_details|prompt_tokens|completion_tokens/);
  if (input.stage.startsWith('arrangement')) {
    assert.doesNotMatch(wireMessages, /transitionMatrixSummary|localFacts|heuristicGuesses/);
  }
  if (
    input.stage.startsWith('production') ||
    input.stage.startsWith('correction')
  ) {
    assert.doesNotMatch(wireMessages, /projectBrief|transitionCandidates|rawOutput/);
  }
  if (input.stage.startsWith('quality_review')) {
    assert.doesNotMatch(wireMessages, /rawOutput|debugPaths|previewPaths|outputPath/);
  }
  const [largestComponent, metrics] = largestRequestComponent(request.breakdown);
  rows.push({
    project: input.project,
    stage: input.stage,
    model: input.model,
    requestNumber: input.requestNumber,
    tools: input.tools.map((tool: any) => tool.function.name),
    utf8Bytes: request.utf8Bytes,
    estimatedTokens: request.estimatedTokens,
    actualPromptTokens: null,
    largestComponent,
    largestComponentBytes: metrics.utf8Bytes,
    pass: true,
  });
  return request;
}

function baseMessages(systemPrompt: string, stageData: unknown): CategorizedProviderMessage[] {
  return [
    { category: 'systemPrompt', message: { role: 'system', content: systemPrompt } },
    { category: 'stageData', message: { role: 'user', content: JSON.stringify(stageData) } },
  ];
}

function runProjectAudit(trackCount: 3 | 4) {
  const project = trackCount === 3 ? 'normal-3-track' : 'maximum-4-track';
  const projectId = `payload-audit-${trackCount}`;
  const design = buildDesign(trackCount);
  const brief = fixtureBrief(design, projectId);
  const plan = fixturePlan(design, brief);
  const report = fixtureExecutionReport(plan);
  const candidate = fixtureCandidate(report);
  const review = fixtureReview(candidate, plan);

  for (const model of SPECIALIST_FALLBACKS.context) {
    const contextData = buildContextStageData(design, projectId, 600);
    audit({
      project,
      stage: 'context_brief',
      model,
      requestNumber: 1,
      messages: baseMessages(SPECIALIST_SYSTEM_PROMPTS.context, contextData),
      tools: SPECIALIST_TOOLS.context,
    });
    audit({
      project,
      stage: 'context_brief_repair',
      model,
      requestNumber: 1,
      messages: [
        { category: 'systemPrompt', message: { role: 'system', content: SPECIALIST_SYSTEM_PROMPTS.context } },
        {
          category: 'repairErrors',
          message: {
            role: 'user',
            content: JSON.stringify({
              task: 'Repair the submit_project_brief artifact.',
              stageData: contextData,
              repairErrors: ['trackSummaries.0.confidence: Expected number between 0 and 1'],
            }),
          },
        },
      ],
      tools: SPECIALIST_TOOLS.context,
    });
  }

  for (const model of SPECIALIST_FALLBACKS.arrangement) {
    const arrangementData = buildArrangementStageData(brief, design);
    audit({
      project,
      stage: 'arrangement',
      model,
      requestNumber: 1,
      messages: baseMessages(SPECIALIST_SYSTEM_PROMPTS.arrangement, arrangementData),
      tools: SPECIALIST_TOOLS.arrangement,
    });
    audit({
      project,
      stage: 'arrangement_repair',
      model,
      requestNumber: 1,
      messages: [
        { category: 'systemPrompt', message: { role: 'system', content: SPECIALIST_SYSTEM_PROMPTS.arrangement } },
        {
          category: 'repairErrors',
          message: {
            role: 'user',
            content: JSON.stringify({
              task: 'Repair the set_design_plan artifact.',
              stageData: arrangementData,
              repairErrors: ['transitions.1.toEntrySec: Must fall inside toSectionId'],
            }),
          },
        },
      ],
      tools: SPECIALIST_TOOLS.arrangement,
    });
  }

  for (const correctionCount of [0, 1, 2]) {
    for (const model of SPECIALIST_FALLBACKS.production) {
      const stage = correctionCount ? `correction_${correctionCount}` : 'production';
      const stageData = buildProductionStageData({
        sessionId: projectId,
        plan,
        executionVersion: correctionCount + 1,
        correctionCount,
        review: correctionCount ? review : null,
      });
      const messages = baseMessages(SPECIALIST_SYSTEM_PROMPTS.production, stageData);
      let requestNumber = 1;
      audit({ project, stage, model, requestNumber, messages, tools: SPECIALIST_TOOLS.production });
      for (const [index, transition] of plan.transitions.entries()) {
        const callId = `${stage}-call-${index + 1}`;
        messages.push({
          category: 'messageHistory',
          message: sanitizeProviderAssistantMessage({
            role: 'assistant',
            reasoning: 'private reasoning must not survive',
            reasoning_details: [{ text: 'private' }],
            usage: { prompt_tokens: 999_999 },
            tool_calls: [{
              id: callId,
              type: 'function',
              function: {
                name: 'apply_musical_transition',
                arguments: JSON.stringify({
                  transitionId: transition.transitionId,
                  fromTrackId: transition.fromTrackId,
                  fromSectionId: transition.fromSectionId,
                  toTrackId: transition.toTrackId,
                  toSectionId: transition.toSectionId,
                  style: transition.style,
                  duration: transition.duration,
                  beatAlign: transition.beatAlign,
                }),
              },
            }],
          }),
        });
        messages.push({
          category: 'toolResults',
          message: {
            role: 'tool',
            tool_call_id: callId,
            content: JSON.stringify(compactTransitionToolResult({
              success: true,
              outputPath: `G:\\private\\preview-${index}.mp3`,
              rawOutput: 'x'.repeat(100_000),
              actualFromExitSec: transition.fromExitSec,
              actualToEntrySec: transition.toEntrySec,
              styleUsed: transition.style,
              durationUsed: transition.duration,
              beatSnapApplied: true,
              estimatedQuality: 88,
            })),
          },
        });
        requestNumber++;
        const continued = audit({
          project,
          stage: `${stage}_continuation`,
          model,
          requestNumber,
          messages,
          tools: SPECIALIST_TOOLS.production,
        });
        assert.doesNotMatch(continued.serializedBody, /rawOutput|reasoning_details|prompt_tokens/);
      }
      const reportCallId = `${stage}-report`;
      messages.push({
        category: 'messageHistory',
        message: sanitizeProviderAssistantMessage({
          role: 'assistant',
          reasoning: 'discard this',
          tool_calls: [{
            id: reportCallId,
            type: 'function',
            function: {
              name: 'submit_execution_report',
              arguments: JSON.stringify(report),
            },
          }],
        }),
      });
      messages.push({
        category: 'toolResults',
        message: {
          role: 'tool',
          tool_call_id: reportCallId,
          content: JSON.stringify({
            error: 'Validation failed',
            issues: ['attemptedTransitions: Missing transition transition-1'],
          }),
        },
      });
      requestNumber++;
      const repairRequest = audit({
        project,
        stage: `${stage}_report_repair`,
        model,
        requestNumber,
        messages,
        tools: SPECIALIST_TOOLS.production,
      });
      const retainedMessages = JSON.stringify(repairRequest.requestBody.messages);
      assert.doesNotMatch(retainedMessages, /rawOutput|reasoning/);
    }
  }

  const localQuality = {
    integratedLUFS: -14.86,
    loudnessRange: 18.1,
    truePeak: -3.25,
    overallQualityNote: 'Loudness in a comfortable modern range.',
    rawOutput: 'x'.repeat(237_644),
    debugPaths: ['G:\\private\\debug.log'],
  };
  for (const model of SPECIALIST_FALLBACKS.arrangement) {
    const reviewData = buildQualityReviewStageData({
      candidate,
      localQuality,
      executionReport: report,
      correctionCount: 0,
    });
    const request = audit({
      project,
      stage: 'quality_review',
      model,
      requestNumber: 1,
      messages: baseMessages(SPECIALIST_SYSTEM_PROMPTS.qualityReview, reviewData),
      tools: SPECIALIST_TOOLS.qualityReview,
    });
    assert.doesNotMatch(
      JSON.stringify(request.requestBody.messages),
      /rawOutput|debugPaths|previewPaths|outputPath/,
    );
    audit({
      project,
      stage: 'quality_review_repair',
      model,
      requestNumber: 1,
      messages: [
        { category: 'systemPrompt', message: { role: 'system', content: SPECIALIST_SYSTEM_PROMPTS.qualityReview } },
        {
          category: 'repairErrors',
          message: {
            role: 'user',
            content: JSON.stringify({
              task: 'Repair the submit_quality_review artifact.',
              stageData: reviewData,
              repairErrors: ['overallScore: Expected number between 0 and 100'],
            }),
          },
        },
      ],
      tools: SPECIALIST_TOOLS.qualityReview,
    });
  }
}

runProjectAudit(3);
runProjectAudit(4);

const expectedTools: Record<string, string[]> = {
  context_brief: ['submit_project_brief'],
  arrangement: ['set_design_plan'],
  production: ['apply_musical_transition', 'submit_execution_report'],
  quality_review: ['submit_quality_review'],
};
for (const row of rows) {
  const baseStage = row.stage.startsWith('context_brief')
    ? 'context_brief'
    : row.stage.startsWith('arrangement')
      ? 'arrangement'
      : row.stage.startsWith('quality_review')
        ? 'quality_review'
        : 'production';
  assert.deepEqual(row.tools, expectedTools[baseStage], `${row.stage} received unrelated tools`);
}

const legacyOversized = buildOpenRouterRequest({
  model: SPECIALIST_FALLBACKS.context[0],
  temperature: 0.1,
  messages: baseMessages(SPECIALIST_SYSTEM_PROMPTS.context, {
    legacyFullPayload: 'x'.repeat(237_644),
  }),
  tools: [...SPECIALIST_TOOLS.context],
});
assert.ok(legacyOversized.utf8Bytes > MAX_PROVIDER_REQUEST_BYTES);
assert.ok(legacyOversized.estimatedTokens > 24_000);
assert.equal(legacyOversized.withinHardLimits, false);
assert.equal(rows.some(row => row.stage === 'final_render'), false, 'Finalization must make zero provider requests');

const reportPath = path.join(root, 'workdir', 'provider-payload-audit.json');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  limits: {
    maxUtf8Bytes: MAX_PROVIDER_REQUEST_BYTES,
    maxEstimatedTokens: 24_000,
    regressionEstimatedTokens: PROVIDER_REGRESSION_TARGET_TOKENS,
  },
  rows,
}, null, 2));

const largest = [...rows].sort((a, b) => b.estimatedTokens - a.estimatedTokens)[0];
console.log(`provider payload audit passed (${rows.length} requests)`);
console.log(
  `largest request: ${largest.project} ${largest.stage} ${largest.model} ` +
  `${largest.utf8Bytes} bytes / ${largest.estimatedTokens} estimated tokens; ` +
  `largest component=${largest.largestComponent} (${largest.largestComponentBytes} bytes)`,
);
console.log(`audit report: ${reportPath}`);
