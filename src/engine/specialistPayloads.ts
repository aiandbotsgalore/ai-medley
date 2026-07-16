import type { MedleyDesignPayload } from "./medleyIntelligence";
import {
  specialistJsonSchemas,
  createTrackFactAuthority,
  createTransitionCandidateAuthority,
  type ArrangementPlan,
  type ExecutionReport,
  type ProjectBrief,
  type QualityReview,
  type RenderCandidate,
  type ResolvedTransition,
} from "../types/specialistWorkflow";

export const functionTool = (
  name: string,
  description: string,
  parameters: unknown,
) => ({
  type: "function" as const,
  function: { name, description, parameters },
});

export const SPECIALIST_SYSTEM_PROMPTS = {
  context:
    "You are the context specialist in a staged music-medley workflow. Return results only by calling submit_project_brief. Use only supplied IDs and facts.",
  arrangement:
    "You are the arrangement specialist in a staged music-medley workflow. Return results only by calling set_design_plan. Use only supplied IDs and timestamps.",
  qualityReview:
    "You are the quality-review specialist in a staged music-medley workflow. Return results only by calling submit_quality_review. Review only the supplied candidate facts.",
  production:
    "You are the production specialist. Execute every locked transition with apply_musical_transition. After receiving every result, call submit_execution_report exactly once. Do not change track order or invent IDs.",
} as const;

export const SPECIALIST_TOOLS = {
  context: [
    functionTool(
      "submit_project_brief",
      "Submit the validated project brief.",
      specialistJsonSchemas.projectBrief,
    ),
  ],
  arrangement: [
    functionTool(
      "set_design_plan",
      "Submit the validated arrangement plan.",
      specialistJsonSchemas.arrangementPlan,
    ),
  ],
  qualityReview: [
    functionTool(
      "submit_quality_review",
      "Submit the validated quality review.",
      specialistJsonSchemas.qualityReview,
    ),
  ],
  production: [
    functionTool(
      "apply_musical_transition",
      "Apply one transition from the locked arrangement plan.",
      {
        type: "object",
        additionalProperties: false,
        required: [
          "transitionId",
          "fromTrackId",
          "fromSectionId",
          "toTrackId",
          "toSectionId",
          "style",
          "duration",
          "beatAlign",
        ],
        properties: {
          transitionId: { type: "string" },
          fromTrackId: { type: "string" },
          fromSectionId: { type: "string" },
          toTrackId: { type: "string" },
          toSectionId: { type: "string" },
          style: { type: "string" },
          duration: { type: "number" },
          beatAlign: { type: "boolean" },
          notes: { type: "string" },
        },
      },
    ),
    functionTool(
      "submit_execution_report",
      "Submit the complete production report after every transition has been attempted.",
      specialistJsonSchemas.executionReport,
    ),
  ],
} as const;

const uniqueLimited = (values: string[], limit: number) =>
  [...new Set(values.filter(Boolean))].slice(0, limit);

export function buildContextStageData(
  design: MedleyDesignPayload,
  projectId: string,
  targetDurationSec: number,
) {
  const sectionsByTrack = new Map<string, typeof design.sections>();
  for (const section of design.sections) {
    const existing = sectionsByTrack.get(section.trackId) ?? [];
    existing.push(section);
    sectionsByTrack.set(section.trackId, existing);
  }
  return {
    task: "Create a compact factual project brief from this local medley intelligence.",
    projectId,
    targetDurationSec,
    constraints: design.userConstraints,
    tracks: design.tracks.map((track) => ({
      trackId: track.trackId,
      factId: createTrackFactAuthority({
        trackId: track.trackId,
        filename: track.filename,
        durationSec: track.durationSec,
        tempoEstimate: track.tempoEstimate,
        keyEstimate: track.keyEstimate ?? null,
        confidence: track.confidence,
      }),
      filename: track.filename,
      durationSec: track.durationSec,
      tempoEstimate: track.tempoEstimate,
      tempoConfidence: track.tempoConfidence,
      keyEstimate: track.keyEstimate,
      keyConfidence: track.keyConfidence,
      averageEnergy: track.averageEnergy,
      peakEnergy: track.peakEnergy,
      confidence: track.confidence,
      warnings: uniqueLimited(track.warnings, 8),
      sections: (sectionsByTrack.get(track.trackId) ?? [])
        .slice(0, 8)
        .map((section) => ({
          sectionId: section.sectionId,
          startSec: section.startSec,
          endSec: section.endSec,
          labels: section.labels.slice(0, 4),
          confidence: section.confidence,
        })),
    })),
    strategies: design.recommendedStrategies.slice(0, 4).map((strategy) => ({
      strategyId: strategy.strategyId,
      name: strategy.title,
      orderedTrackIds: strategy.orderedTracks.map((track) => track.trackId),
      score: strategy.score,
      tradeoffs: strategy.tradeoffs.slice(0, 3),
      warnings: strategy.warnings.slice(0, 3),
    })),
    warnings: uniqueLimited(design.warnings, 12),
  };
}

export function buildArrangementStageData(
  projectBrief: ProjectBrief,
  design: MedleyDesignPayload,
) {
  const pairBest = new Map<
    string,
    (typeof design.transitionMatrixSummary)[number]
  >();
  for (const transition of design.transitionMatrixSummary) {
    const key = `${transition.fromTrackId}:${transition.toTrackId}`;
    const existing = pairBest.get(key);
    if (!existing || transition.score > existing.score)
      pairBest.set(key, transition);
  }
  const selected = new Map<
    string,
    (typeof design.transitionMatrixSummary)[number]
  >();
  for (const transition of pairBest.values()) {
    selected.set(
      `${transition.fromTrackId}:${transition.fromSectionId}:${transition.toTrackId}:${transition.toSectionId}`,
      transition,
    );
  }
  const candidatesByPair = new Map<
    string,
    (typeof design.transitionMatrixSummary)[number][]
  >();
  for (const transition of design.transitionMatrixSummary) {
    const key = `${transition.fromTrackId}:${transition.toTrackId}`;
    candidatesByPair.set(key, [...(candidatesByPair.get(key) ?? []), transition]);
  }
  for (const candidates of candidatesByPair.values()) {
    const byScore = [...candidates].sort((a, b) => b.score - a.score);
    const byEarlyExit = [...candidates].sort(
      (a, b) => a.fromExitSec - b.fromExitSec,
    );
    for (const transition of [byScore[0], byEarlyExit[0]]) {
      if (!transition) continue;
      selected.set(
        `${transition.fromTrackId}:${transition.fromSectionId}:${transition.toTrackId}:${transition.toSectionId}`,
        transition,
      );
    }
  }
  return {
    task: "Create one exact, musically coherent arrangement using only supplied transition candidates. Copy every selected candidate ID, track, section, and timestamp exactly. Meet the requested target duration within 10 percent before rendering.",
    projectBrief: {
      ...projectBrief,
      trackSummaries: projectBrief.trackSummaries.map((track) => ({
        ...track,
        warnings: uniqueLimited(track.warnings, 4),
      })),
      warnings: uniqueLimited(projectBrief.warnings, 8),
    },
    transitionCandidates: [...selected.values()].map((transition) => ({
      transitionCandidateId: createTransitionCandidateAuthority(transition),
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
      warnings: uniqueLimited(transition.warnings, 3),
    })),
    strategies: design.recommendedStrategies.slice(0, 4).map((strategy) => ({
      strategyId: strategy.strategyId,
      name: strategy.title,
      orderedTrackIds: strategy.orderedTracks.map((track) => track.trackId),
      score: strategy.score,
      estimatedDurationSec: strategy.estimatedDurationSec,
      tradeoffs: strategy.tradeoffs.slice(0, 3),
      warnings: strategy.warnings.slice(0, 3),
    })),
  };
}

export function buildProductionStageData(input: {
  sessionId: string;
  plan: ArrangementPlan;
  executionVersion: number;
  correctionCount: number;
  review: QualityReview | null;
  completedTransitions?: unknown[];
  repairErrors?: string[];
}) {
  const correction = input.review
    ? {
        candidateId: input.review.candidateId,
        blockingIssues: input.review.blockingIssues,
        corrections: input.review.corrections,
        warnings: uniqueLimited(input.review.warnings, 8),
      }
    : null;
  return {
    task: input.correctionCount
      ? "Apply only the active requested corrections, then execute the complete locked plan."
      : "Execute the complete locked arrangement.",
    sessionId: input.sessionId,
    executionVersion: input.executionVersion,
    correctionCount: input.correctionCount,
    plan: input.plan,
    correction,
    completedTransitions: input.completedTransitions ?? [],
    repairErrors: input.repairErrors ?? [],
  };
}

export function compactTransitionToolResult(data: any) {
  return {
    success: data?.success === true,
    previewPath: data?.previewPath ?? data?.outputPath ?? null,
    actualFromExitSec: data?.actualFromExitSec ?? null,
    actualToEntrySec: data?.actualToEntrySec ?? null,
    styleUsed: data?.styleUsed ?? null,
    durationUsed: data?.durationUsed ?? null,
    beatSnapApplied: data?.beatSnapApplied ?? false,
    estimatedQuality: data?.estimatedQuality ?? null,
    error: data?.error ? String(data.error).slice(0, 1_000) : null,
    issues: Array.isArray(data?.issues) ? data.issues.slice(0, 20) : [],
  };
}

export function buildQualityReviewStageData(input: {
  candidate: RenderCandidate;
  localQuality: any;
  executionReport: ExecutionReport;
  resolvedTransitions?: ResolvedTransition[];
  correctionCount: number;
}) {
  const quality = input.localQuality ?? {};
  return {
    task: "Review the assembled candidate using objective local measurements and execution results. Approve unless specific correctable issues remain.",
    candidate: {
      candidateId: input.candidate.candidateId,
      candidateVersion: input.candidate.candidateVersion,
      arrangementVersion: input.candidate.arrangementVersion,
      executionVersion: input.candidate.executionVersion,
      durationSec: input.candidate.durationSec,
      technicallyValid: input.candidate.technicallyValid,
      metrics: input.candidate.metrics,
      reviewStatus: input.candidate.reviewStatus,
      warnings: uniqueLimited(input.candidate.warnings, 12),
    },
    localQuality: {
      integratedLUFS: quality.integratedLUFS ?? null,
      loudnessRange: quality.loudnessRange ?? null,
      truePeak: quality.truePeak ?? null,
      overallQualityNote: quality.overallQualityNote ?? quality.note ?? null,
      metrics: quality.metrics ?? null,
      warnings: uniqueLimited(
        Array.isArray(quality.warnings) ? quality.warnings : [],
        12,
      ),
    },
    executionReport: {
      schemaVersion: input.executionReport.schemaVersion,
      executionVersion: input.executionReport.executionVersion,
      arrangementVersion: input.executionReport.arrangementVersion,
      attemptedTransitions: (
        input.resolvedTransitions ?? input.executionReport.attemptedTransitions
      ).map((item) => ({
        transitionId: item.transitionId,
        fromTrackId: item.fromTrackId,
        toTrackId: item.toTrackId,
        style: item.style,
        duration: item.duration,
        success: "success" in item ? item.success : true,
        actualFromExitSec: item.actualFromExitSec,
        actualToEntrySec: item.actualToEntrySec,
        error: "error" in item ? item.error : null,
      })),
      technicalWarnings: uniqueLimited(
        input.executionReport.technicalWarnings,
        12,
      ),
      unresolvedFailures: uniqueLimited(
        input.executionReport.unresolvedFailures,
        12,
      ),
    },
    correctionCount: input.correctionCount,
  };
}
