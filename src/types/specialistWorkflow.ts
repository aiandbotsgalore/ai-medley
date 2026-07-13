import { z } from "zod";

export const SPECIALIST_MODELS = {
  context: "google/gemini-2.5-pro",
  arrangement: "google/gemini-2.5-pro",
  production: "google/gemini-2.5-flash",
} as const;

export type SpecialistRole = keyof typeof SPECIALIST_MODELS;

export const SPECIALIST_FALLBACKS: Record<SpecialistRole, string[]> = {
  context: [
    SPECIALIST_MODELS.context,
    SPECIALIST_MODELS.production,
  ],
  arrangement: [
    SPECIALIST_MODELS.arrangement,
    SPECIALIST_MODELS.production,
  ],
  production: [
    SPECIALIST_MODELS.production,
    SPECIALIST_MODELS.arrangement,
  ],
};

export const WORKFLOW_STAGES = [
  "local_analysis",
  "context_brief",
  "arrangement",
  "production",
  "review_candidate",
  "quality_review",
  "correction",
  "final_render",
  "completed",
] as const;

export type SpecialistStage = (typeof WORKFLOW_STAGES)[number];

export const MAX_CORRECTION_RETRIES = 3;
export const MAX_COMPLETE_CANDIDATES = 4;
export const PROVIDER_REQUEST_TIMEOUT_MS = 120_000;
export const MAX_PROVIDER_REQUEST_BYTES = 100 * 1024;
export const MAX_PROVIDER_ESTIMATED_TOKENS = 24_000;
export const PROVIDER_REGRESSION_TARGET_TOKENS = 16_000;

const Id = z.string().trim().min(1).max(200);
const ShortText = z.string().trim().max(2_000);
const WarningList = z.array(z.string().trim().min(1).max(1_000)).max(50);
const Score100 = z.number().min(0).max(100);
const Confidence = z.number().min(0).max(1);

export const TransitionStyleSchema = z.enum([
  "smooth_blend",
  "beat_aligned",
  "energy_ramp",
  "harmonic_blend",
  "dramatic_cut",
  "reset_moment",
  "mashup_layer",
]);

export const ArrangementTransitionSchema = z.strictObject({
  transitionId: Id,
  transitionCandidateId: Id.optional(),
  fromTrackId: Id,
  fromSectionId: Id,
  toTrackId: Id,
  toSectionId: Id,
  fromExitSec: z.number().nonnegative(),
  toEntrySec: z.number().nonnegative(),
  duration: z.number().positive().max(30),
  style: TransitionStyleSchema,
  beatAlign: z.boolean(),
  executionPermissions: z
    .strictObject({
      styleMutable: z.boolean().optional(),
      allowedStyles: z.array(TransitionStyleSchema).max(7).optional(),
      durationMutable: z.boolean().optional(),
      minDuration: z.number().positive().max(30).optional(),
      maxDuration: z.number().positive().max(30).optional(),
      beatAlignMutable: z.boolean().optional(),
    })
    .optional(),
  notes: ShortText.default(""),
});

export const TransitionExecutionRequestSchema = z.strictObject({
  transitionId: Id,
  fromTrackId: Id,
  fromSectionId: Id,
  toTrackId: Id,
  toSectionId: Id,
  style: TransitionStyleSchema,
  duration: z.number().positive().max(30),
  beatAlign: z.boolean(),
  notes: ShortText.optional(),
});

export const ProjectBriefSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projectId: Id,
  targetDurationSec: z.number().positive(),
  trackSummaries: z
    .array(
      z.strictObject({
        trackId: Id,
        factId: Id.optional(),
        filename: z.string().trim().min(1).max(500),
        durationSec: z.number().positive(),
        tempoEstimate: z.number().positive().nullable(),
        keyEstimate: z.string().trim().max(80).nullable(),
        confidence: Confidence,
        recommendedSectionIds: z.array(Id).max(12),
        warnings: WarningList,
      }),
    )
    .min(2)
    .max(100),
  recommendedOrderIds: z.array(Id).min(2).max(100),
  constraints: z.array(ShortText).max(30),
  warnings: WarningList,
  summary: ShortText,
});

export const ArrangementPlanSchema = z.strictObject({
  schemaVersion: z.literal(1),
  arrangementVersion: z.number().int().positive(),
  projectId: Id,
  strategy: ShortText,
  orderedTrackIds: z.array(Id).min(2).max(100),
  transitions: z.array(ArrangementTransitionSchema).min(1).max(99),
  confidence: Confidence,
  warnings: WarningList,
});

export const AttemptedTransitionSchema = ArrangementTransitionSchema.extend({
  success: z.boolean(),
  actualFromExitSec: z.number().nonnegative().nullable(),
  actualToEntrySec: z.number().nonnegative().nullable(),
  previewPath: z.string().trim().max(1_000).nullable(),
  error: z.string().trim().max(2_000).nullable(),
});

export const ResolvedTransitionSchema = ArrangementTransitionSchema.extend({
  actualFromExitSec: z.number().nonnegative(),
  actualToEntrySec: z.number().nonnegative(),
  durationUsed: z.number().positive().max(30),
  outputPath: z.string().trim().max(1_000).nullable(),
  executionVersion: z.number().int().positive(),
});

export const ExecutionReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  executionVersion: z.number().int().positive(),
  arrangementVersion: z.number().int().positive(),
  attemptedTransitions: z.array(AttemptedTransitionSchema).min(1).max(99),
  technicalWarnings: WarningList,
  unresolvedFailures: WarningList,
  completedAt: z.string().datetime(),
});

export const QualityReviewSchema = z.strictObject({
  schemaVersion: z.literal(1),
  candidateId: Id,
  candidateVersion: z.number().int().positive(),
  arrangementVersion: z.number().int().positive(),
  approved: z.boolean(),
  emotionalArc: Score100,
  transitionSmoothness: Score100,
  performerIdentity: Score100,
  overallScore: Score100,
  blockingIssues: WarningList,
  corrections: z
    .array(
      z.strictObject({
        transitionId: Id,
        issue: ShortText,
        requestedChange: ShortText,
      }),
    )
    .max(20),
  warnings: WarningList,
  reviewedAt: z.string().datetime(),
});

export const RenderCandidateSchema = z.strictObject({
  candidateId: Id,
  candidateVersion: z.number().int().positive(),
  parentCandidateId: Id.nullable(),
  arrangementVersion: z.number().int().positive(),
  executionVersion: z.number().int().positive(),
  resolvedTransitions: z.array(ResolvedTransitionSchema).max(99).optional(),
  outputPath: z.string().trim().min(1).max(1_000),
  debugPaths: z.array(z.string().trim().min(1).max(1_000)).max(10),
  previewPaths: z.array(z.string().trim().min(1).max(1_000)).max(100),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  durationSec: z.number().positive(),
  technicallyValid: z.boolean(),
  metrics: z.strictObject({
    emotionalArc: Score100.optional(),
    transitionSmoothness: Score100.optional(),
    performerIdentity: Score100.optional(),
    overallScore: Score100.optional(),
  }),
  reviewStatus: z.enum(["pending", "approved", "changes_requested"]),
  warnings: WarningList,
  createdAt: z.string().datetime(),
});

export const CandidateManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sessionId: Id,
  workflowMode: z.enum(["automatic", "legacy"]).optional(),
  selectedCandidateId: Id.nullable(),
  finalizedCandidateId: Id.nullable(),
  finalOutputPath: z.string().trim().max(1_000).nullable(),
  candidates: z.array(RenderCandidateSchema).max(MAX_COMPLETE_CANDIDATES),
  updatedAt: z.string().datetime(),
});

export const SpecialistHandoffSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sessionId: Id,
  stage: z.enum(WORKFLOW_STAGES),
  sourceRole: z.enum(["context", "arrangement", "production"]).nullable(),
  targetRole: z.enum(["context", "arrangement", "production"]),
  payloadType: z.enum([
    "project_brief",
    "arrangement_plan",
    "execution_report",
    "render_candidate",
    "quality_review",
  ]),
  repairAttempt: z.number().int().min(0).max(1),
  correctionCount: z.number().int().min(0).max(MAX_CORRECTION_RETRIES),
  warnings: WarningList,
});

export const AutomaticWorkflowCheckpointSchema = z.strictObject({
  schemaVersion: z.literal(3),
  sessionId: Id,
  workflowMode: z.literal("automatic"),
  stage: z.enum(WORKFLOW_STAGES),
  activeRole: z.enum(["context", "arrangement", "production"]).nullable(),
  activeModel: z.string().trim().min(1).max(300).nullable(),
  activeRequestSequence: z.number().int().nonnegative(),
  attemptedModels: z.array(z.string().trim().min(1).max(300)).max(20),
  repairCount: z.number().int().nonnegative(),
  correctionCount: z.number().int().min(0).max(MAX_CORRECTION_RETRIES),
  selectedTrackIds: z.array(Id).min(2).max(25).optional(),
  projectBrief: ProjectBriefSchema.nullable(),
  arrangementPlan: ArrangementPlanSchema.nullable(),
  executionReport: ExecutionReportSchema.nullable(),
  currentCandidate: RenderCandidateSchema.nullable(),
  qualityReview: QualityReviewSchema.nullable(),
  resumeBinding: z
    .strictObject({
      version: z.literal(1),
      sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      designFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .optional(),
  savedAt: z.string().datetime(),
});

export type ProjectBrief = z.infer<typeof ProjectBriefSchema>;
export type ArrangementPlan = z.infer<typeof ArrangementPlanSchema>;
export type ExecutionReport = z.infer<typeof ExecutionReportSchema>;
export type QualityReview = z.infer<typeof QualityReviewSchema>;
export type RenderCandidate = z.infer<typeof RenderCandidateSchema>;
export type ResolvedTransition = z.infer<typeof ResolvedTransitionSchema>;
export type TransitionExecutionRequest = z.infer<
  typeof TransitionExecutionRequestSchema
>;
export type CandidateManifest = z.infer<typeof CandidateManifestSchema>;
export type SpecialistHandoff = z.infer<typeof SpecialistHandoffSchema>;
export type AutomaticWorkflowCheckpoint = z.infer<
  typeof AutomaticWorkflowCheckpointSchema
>;

export type SpecialistContext = {
  trackIds: Set<string>;
  sectionsById: Map<
    string,
    { trackId: string; startSec: number; endSec: number }
  >;
  durationsByTrackId: Map<string, number>;
  targetDurationSec?: number;
  factsByTrackId?: Map<
    string,
    {
      trackId: string;
      filename: string;
      durationSec: number;
      tempoEstimate: number | null;
      keyEstimate: string | null;
      confidence: number;
    }
  >;
  transitionCandidatesById?: Map<
    string,
    {
      fromTrackId: string;
      fromSectionId: string;
      toTrackId: string;
      toSectionId: string;
      fromExitSec: number;
      toEntrySec: number;
    }
  >;
};

function authorityHash(parts: Array<string | number | null>) {
  const input = JSON.stringify(parts);
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(input)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

export function createTrackFactAuthority(input: {
  trackId: string;
  filename: string;
  durationSec: number;
  tempoEstimate: number | null;
  keyEstimate: string | null;
  confidence: number;
}) {
  return `track-fact-v1-${authorityHash([
    input.trackId,
    input.filename,
    input.durationSec,
    input.tempoEstimate,
    input.keyEstimate,
    input.confidence,
  ])}`;
}

export function createTransitionCandidateAuthority(input: {
  fromTrackId: string;
  fromSectionId: string;
  toTrackId: string;
  toSectionId: string;
  fromExitSec: number;
  toEntrySec: number;
}) {
  return `transition-candidate-v1-${authorityHash([
    input.fromTrackId,
    input.fromSectionId,
    input.toTrackId,
    input.toSectionId,
    input.fromExitSec,
    input.toEntrySec,
  ])}`;
}

export function bindLegacyProjectBriefAuthority(
  brief: ProjectBrief,
  context: SpecialistContext,
): ProjectBrief {
  return {
    ...brief,
    trackSummaries: brief.trackSummaries.map((track) => {
      if (track.factId) return track;
      const authority = context.factsByTrackId?.get(track.trackId);
      return authority
        ? { ...track, factId: createTrackFactAuthority(authority) }
        : track;
    }),
  };
}

export function bindLegacyArrangementAuthority(
  plan: ArrangementPlan,
  context: SpecialistContext,
): ArrangementPlan {
  if (!context.transitionCandidatesById) return plan;
  return {
    ...plan,
    transitions: plan.transitions.map((transition) => {
      if (transition.transitionCandidateId) return transition;
      const matches = [...context.transitionCandidatesById.entries()].filter(
        ([, candidate]) =>
          candidate.fromTrackId === transition.fromTrackId &&
          candidate.fromSectionId === transition.fromSectionId &&
          candidate.toTrackId === transition.toTrackId &&
          candidate.toSectionId === transition.toSectionId &&
          Math.abs(candidate.fromExitSec - transition.fromExitSec) <= 0.001 &&
          Math.abs(candidate.toEntrySec - transition.toEntrySec) <= 0.001,
      );
      return matches.length === 1
        ? { ...transition, transitionCandidateId: matches[0][0] }
        : transition;
    }),
  };
}

export function validateProjectBriefContext(
  brief: ProjectBrief,
  context: SpecialistContext,
): string[] {
  const errors: string[] = [];
  const summaryIds = new Set(
    brief.trackSummaries.map((track) => track.trackId),
  );
  if (summaryIds.size !== brief.trackSummaries.length) {
    errors.push("trackSummaries: Duplicate tracks are not allowed");
  }
  if (
    context.targetDurationSec !== undefined &&
    Math.abs(brief.targetDurationSec - context.targetDurationSec) > 0.001
  ) {
    errors.push("targetDurationSec: Does not match authoritative session facts");
  }
  for (const [index, track] of brief.trackSummaries.entries()) {
    if (!context.trackIds.has(track.trackId)) {
      errors.push(`trackSummaries[${index}].trackId: Unknown track`);
    }
    const authority = context.factsByTrackId?.get(track.trackId);
    if (authority) {
      const expectedFactId = createTrackFactAuthority(authority);
      if (track.factId !== expectedFactId) {
        errors.push(
          `trackSummaries[${index}].factId: Does not match authoritative facts`,
        );
      }
      for (const field of [
        "filename",
        "durationSec",
        "tempoEstimate",
        "keyEstimate",
        "confidence",
      ] as const) {
        const reported = track[field];
        const expected = authority[field];
        const equal =
          typeof reported === "number" && typeof expected === "number"
            ? Math.abs(reported - expected) <= 0.001
            : reported === expected;
        if (!equal) {
          errors.push(
            `trackSummaries[${index}].${field}: Does not match authoritative facts`,
          );
        }
      }
    }
    for (const sectionId of track.recommendedSectionIds) {
      const section = context.sectionsById.get(sectionId);
      if (!section || section.trackId !== track.trackId) {
        errors.push(
          `trackSummaries[${index}].recommendedSectionIds: Unknown section ${sectionId}`,
        );
      }
    }
  }
  for (const [index, trackId] of brief.recommendedOrderIds.entries()) {
    if (!summaryIds.has(trackId)) {
      errors.push(
        `recommendedOrderIds[${index}]: Track is missing from trackSummaries`,
      );
    }
  }
  const orderedIds = new Set(brief.recommendedOrderIds);
  if (orderedIds.size !== brief.recommendedOrderIds.length) {
    errors.push("recommendedOrderIds: Duplicate tracks are not allowed");
  }
  for (const trackId of summaryIds) {
    if (!orderedIds.has(trackId)) {
      errors.push(`recommendedOrderIds: Missing summarized track ${trackId}`);
    }
  }
  for (const trackId of context.trackIds) {
    if (!summaryIds.has(trackId)) {
      errors.push(`trackSummaries: Missing authoritative track ${trackId}`);
    }
  }
  return errors;
}

export function formatValidationIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.join(".") : "root";
    return `${path}: ${issue.message}`;
  });
}

/** Mirrors the deterministic render timeline: selected sections plus a short final tail. */
export function estimateArrangementDurationSec(
  plan: ArrangementPlan,
  context: SpecialistContext,
  finalTailSec = 30,
): number | null {
  if (!plan.transitions.length) return null;
  let duration = 0;
  for (const [index, transition] of plan.transitions.entries()) {
    if (index === 0) duration += transition.fromExitSec;
    const nextTransition = plan.transitions[index + 1];
    if (nextTransition) {
      duration += nextTransition.fromExitSec - transition.toEntrySec;
    } else {
      const trackDuration = context.durationsByTrackId.get(transition.toTrackId);
      const finalEnd =
        trackDuration === undefined
          ? transition.toEntrySec + finalTailSec
          : Math.min(trackDuration, transition.toEntrySec + finalTailSec);
      duration += finalEnd - transition.toEntrySec;
    }
    duration -= transition.duration;
  }
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

export function validateArrangementContext(
  plan: ArrangementPlan,
  context: SpecialistContext,
): string[] {
  const errors: string[] = [];
  const ordered = new Set(plan.orderedTrackIds);
  const transitionIds = new Set(
    plan.transitions.map((transition) => transition.transitionId),
  );
  if (transitionIds.size !== plan.transitions.length) {
    errors.push("transitions: Duplicate transition IDs are not allowed");
  }
  for (const [index, trackId] of plan.orderedTrackIds.entries()) {
    if (!context.trackIds.has(trackId))
      errors.push(`orderedTrackIds[${index}]: Unknown track`);
  }
  if (ordered.size !== plan.orderedTrackIds.length) {
    errors.push("orderedTrackIds: Duplicate tracks are not allowed");
  }
  if (plan.transitions.length !== plan.orderedTrackIds.length - 1) {
    errors.push(
      "transitions: Must contain exactly one transition between each ordered track",
    );
  }
  for (const [index, transition] of plan.transitions.entries()) {
    const prefix = `transitions[${index}]`;
    if (context.transitionCandidatesById) {
      const candidate = transition.transitionCandidateId
        ? context.transitionCandidatesById.get(transition.transitionCandidateId)
        : undefined;
      if (!candidate) {
        errors.push(
          `${prefix}.transitionCandidateId: Candidate is not current authoritative data`,
        );
      } else {
        for (const field of [
          "fromTrackId",
          "fromSectionId",
          "toTrackId",
          "toSectionId",
          "fromExitSec",
          "toEntrySec",
        ] as const) {
          const reported = transition[field];
          const expected = candidate[field];
          const equal =
            typeof reported === "number" && typeof expected === "number"
              ? Math.abs(reported - expected) <= 0.001
              : reported === expected;
          if (!equal) {
            errors.push(
              `${prefix}.${field}: Does not match authoritative transition candidate`,
            );
          }
        }
      }
    }
    if (!context.trackIds.has(transition.fromTrackId)) {
      errors.push(`${prefix}.fromTrackId: Unknown track`);
    }
    if (!context.trackIds.has(transition.toTrackId)) {
      errors.push(`${prefix}.toTrackId: Unknown track`);
    }
    const fromSection = context.sectionsById.get(transition.fromSectionId);
    const toSection = context.sectionsById.get(transition.toSectionId);
    if (!fromSection || fromSection.trackId !== transition.fromTrackId) {
      errors.push(
        `${prefix}.fromSectionId: Section does not belong to fromTrackId`,
      );
    } else if (
      transition.fromExitSec < fromSection.startSec ||
      transition.fromExitSec > fromSection.endSec
    ) {
      errors.push(`${prefix}.fromExitSec: Must fall inside fromSectionId`);
    }
    if (!toSection || toSection.trackId !== transition.toTrackId) {
      errors.push(
        `${prefix}.toSectionId: Section does not belong to toTrackId`,
      );
    } else if (
      transition.toEntrySec < toSection.startSec ||
      transition.toEntrySec > toSection.endSec
    ) {
      errors.push(`${prefix}.toEntrySec: Must fall inside toSectionId`);
    }
    if (
      plan.orderedTrackIds[index] !== transition.fromTrackId ||
      plan.orderedTrackIds[index + 1] !== transition.toTrackId
    ) {
      errors.push(`${prefix}: Does not match orderedTrackIds`);
    }
    const fromDuration = context.durationsByTrackId.get(transition.fromTrackId);
    const toDuration = context.durationsByTrackId.get(transition.toTrackId);
    if (fromDuration !== undefined && transition.fromExitSec > fromDuration) {
      errors.push(`${prefix}.fromExitSec: Exceeds source duration`);
    }
    if (toDuration !== undefined && transition.toEntrySec > toDuration) {
      errors.push(`${prefix}.toEntrySec: Exceeds source duration`);
    }
  }
  if (context.targetDurationSec && context.targetDurationSec > 0) {
    const estimatedDurationSec = estimateArrangementDurationSec(plan, context);
    const toleranceSec = Math.max(5, context.targetDurationSec * 0.1);
    if (
      estimatedDurationSec !== null &&
      Math.abs(estimatedDurationSec - context.targetDurationSec) > toleranceSec
    ) {
      errors.push(
        `estimatedDurationSec: Planned timeline is ${estimatedDurationSec.toFixed(1)}s but the target is ${context.targetDurationSec.toFixed(1)}s; choose shorter or longer sections before rendering`,
      );
    }
  }
  return errors;
}

export function validateExecutionContext(
  report: ExecutionReport,
  plan: ArrangementPlan,
): string[] {
  const errors: string[] = [];
  if (report.arrangementVersion !== plan.arrangementVersion) {
    errors.push("arrangementVersion: Does not match the locked arrangement");
  }
  const expected = new Set(plan.transitions.map((item) => item.transitionId));
  const attempted = new Set(
    report.attemptedTransitions.map((item) => item.transitionId),
  );
  if (attempted.size !== report.attemptedTransitions.length) {
    errors.push(
      "attemptedTransitions: Duplicate transition IDs are not allowed",
    );
  }
  for (const id of expected) {
    if (!attempted.has(id))
      errors.push(`attemptedTransitions: Missing transition ${id}`);
  }
  for (const item of report.attemptedTransitions) {
    if (!expected.has(item.transitionId)) {
      errors.push(
        `attemptedTransitions.${item.transitionId}: Not present in locked arrangement`,
      );
    }
  }
  return errors;
}

export function validateTransitionExecutionContext(
  request: z.infer<typeof TransitionExecutionRequestSchema>,
  plan: ArrangementPlan,
): string[] {
  const locked = plan.transitions.find(
    (item) => item.transitionId === request.transitionId,
  );
  if (!locked) return [`transitionId: Not present in locked arrangement`];
  const errors: string[] = [];
  for (const field of [
    "fromTrackId",
    "fromSectionId",
    "toTrackId",
    "toSectionId",
  ] as const) {
    if (request[field] !== locked[field]) {
      errors.push(
        `${field}: Does not match locked transition ${request.transitionId}`,
      );
    }
  }
  const permissions = locked.executionPermissions;
  if (!permissions?.styleMutable && request.style !== locked.style) {
    errors.push(
      `style: Does not match locked transition ${request.transitionId}`,
    );
  }
  if (
    permissions?.styleMutable &&
    permissions.allowedStyles?.length &&
    !permissions.allowedStyles.includes(request.style)
  ) {
    errors.push(
      `style: Not allowed for locked transition ${request.transitionId}`,
    );
  }
  if (
    !permissions?.beatAlignMutable &&
    request.beatAlign !== locked.beatAlign
  ) {
    errors.push(
      `beatAlign: Does not match locked transition ${request.transitionId}`,
    );
  }
  if (permissions?.durationMutable) {
    const minDuration = permissions.minDuration ?? locked.duration;
    const maxDuration = permissions.maxDuration ?? locked.duration;
    if (minDuration > maxDuration) {
      errors.push(
        `duration: Invalid mutable duration bounds for ${request.transitionId}`,
      );
    } else if (
      request.duration < minDuration - 0.001 ||
      request.duration > maxDuration + 0.001
    ) {
      errors.push(
        `duration: Outside allowed bounds for locked transition ${request.transitionId}`,
      );
    }
  } else if (Math.abs(request.duration - locked.duration) > 0.001) {
    errors.push(
      `duration: Does not match locked transition ${request.transitionId}`,
    );
  }
  return errors;
}

export function measureProviderRequest(payload: unknown) {
  const serialized = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(serialized).byteLength;
  const estimatedTokens = Math.ceil(serialized.length / 3);
  return {
    bytes,
    estimatedTokens,
    withinLimits:
      bytes <= MAX_PROVIDER_REQUEST_BYTES &&
      estimatedTokens <= MAX_PROVIDER_ESTIMATED_TOKENS,
  };
}

export function chooseBestCandidate(
  candidates: RenderCandidate[],
): RenderCandidate | null {
  const valid = candidates.filter((candidate) => candidate.technicallyValid);
  if (!valid.length) return null;
  const approved = valid
    .filter((candidate) => candidate.reviewStatus === "approved")
    .sort((a, b) => b.candidateVersion - a.candidateVersion);
  if (approved.length) return approved[0];
  return valid.sort((a, b) => {
    const aScore = a.metrics.overallScore;
    const bScore = b.metrics.overallScore;
    if (aScore === undefined && bScore !== undefined) return 1;
    if (aScore !== undefined && bScore === undefined) return -1;
    if (aScore !== bScore) return (bScore ?? -1) - (aScore ?? -1);
    return b.candidateVersion - a.candidateVersion;
  })[0];
}

const currentProjectBriefJsonSchema: any = z.toJSONSchema(ProjectBriefSchema);
const briefItem = currentProjectBriefJsonSchema.properties?.trackSummaries?.items;
if (briefItem) briefItem.required = [...new Set([...(briefItem.required ?? []), "factId"])];
const currentArrangementJsonSchema: any = z.toJSONSchema(ArrangementPlanSchema);
const transitionItem = currentArrangementJsonSchema.properties?.transitions?.items;
if (transitionItem)
  transitionItem.required = [
    ...new Set([...(transitionItem.required ?? []), "transitionCandidateId"]),
  ];

export const specialistJsonSchemas = {
  projectBrief: currentProjectBriefJsonSchema,
  arrangementPlan: currentArrangementJsonSchema,
  executionReport: z.toJSONSchema(ExecutionReportSchema),
  qualityReview: z.toJSONSchema(QualityReviewSchema),
};
