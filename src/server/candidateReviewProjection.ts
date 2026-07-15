import fs from "node:fs";
import path from "node:path";
import type { AutomaticSessionStateV1 } from "../types/automaticWorkflowV4";
import {
  MAX_COMPLETE_CANDIDATES,
  type CandidateManifest,
  type QualityReview,
  type RenderCandidate,
} from "../types/specialistWorkflow";
import { assertRegisteredSafeFile, sha256File } from "./candidateStore";
import type { FinalizationJournal } from "./finalizationTransaction";

export type CandidateReviewAction =
  | "play_candidate"
  | "copy_candidate_path"
  | "approve_candidate"
  | "resume_finalization"
  | "resume_audio_review"
  | "apply_safe_correction"
  | "retry_arrangement"
  | "change_model"
  | "cancel_session"
  | "play_final"
  | "download_final"
  | "copy_final_path";

export type CandidateReviewStatus =
  | "working"
  | "draft_ready"
  | "review_required"
  | "finalizing"
  | "recoverable_error"
  | "failed"
  | "cancelled"
  | "finalized";

export type CandidateTransitionConcern = {
  transitionId: string;
  issue: string;
  requestedChange: string;
  correctionPreset: string | null;
};

export type CandidatePlanChange = {
  transitionId: string;
  summary: string;
};

export type CandidateReviewItem = {
  candidateId: string;
  draftNumber: number;
  parentCandidateId: string | null;
  arrangementVersion: number;
  executionVersion: number;
  outputPath: string;
  audioUrl: string;
  sizeBytes: number;
  durationSec: number;
  audioIntegrityVerified: boolean;
  audioProblem: string | null;
  technicallyValid: boolean;
  technicalIssues: string[];
  reviewStatus: RenderCandidate["reviewStatus"];
  reviewSummary: string;
  reviewModel: string | null;
  transitionConcerns: CandidateTransitionConcern[];
  warnings: string[];
  planChanges: CandidatePlanChange[];
  createdAt: string;
  selected: boolean;
  recommended: boolean;
  finalized: boolean;
  actions: CandidateReviewAction[];
};

export type CandidateFinalProjection = {
  candidateId: string;
  outputPath: string;
  audioUrl: string;
  downloadUrl: string;
  sizeBytes: number;
  sha256: string;
  finalizedAt: string | null;
  integrityVerified: boolean;
};

export type CandidateReviewProjection = {
  schemaVersion: 1;
  sessionId: string;
  state: AutomaticSessionStateV1["state"];
  stateRevision: number;
  status: CandidateReviewStatus;
  title: string;
  message: string;
  candidateCount: number;
  maximumCandidates: number;
  candidates: CandidateReviewItem[];
  selectedCandidateId: string | null;
  finalizedCandidateId: string | null;
  final: CandidateFinalProjection | null;
  actions: CandidateReviewAction[];
  updatedAt: string;
};

function latestForCandidate<T extends { candidateId: string }>(
  items: T[],
  candidateId: string,
) {
  return [...items].reverse().find((item) => item.candidateId === candidateId) ?? null;
}

function describeReview(review: QualityReview | null) {
  if (!review) return "This draft has not received a musical review yet.";
  if (review.approved) return "OpenRouter approved this draft after listening to it.";
  if (review.blockingIssues.length) return review.blockingIssues.join(" ");
  if (review.corrections.length) return review.corrections.map((item) => item.issue).join(" ");
  return "OpenRouter did not approve this draft and did not provide a usable correction.";
}

function describePlanChanges(
  candidate: RenderCandidate,
  parent: RenderCandidate | null,
): CandidatePlanChange[] {
  if (!parent) {
    return [{ transitionId: "initial", summary: "Original rendered arrangement." }];
  }
  const previous = new Map(
    (parent.resolvedTransitions ?? []).map((transition) => [transition.transitionId, transition]),
  );
  const changes: CandidatePlanChange[] = [];
  for (const transition of candidate.resolvedTransitions ?? []) {
    const before = previous.get(transition.transitionId);
    if (!before) {
      changes.push({
        transitionId: transition.transitionId,
        summary: "Added in this draft.",
      });
      continue;
    }
    const details: string[] = [];
    if (before.style !== transition.style) {
      details.push(`${before.style.replaceAll("_", " ")} → ${transition.style.replaceAll("_", " ")}`);
    }
    if (before.durationUsed !== transition.durationUsed) {
      details.push(`${before.durationUsed.toFixed(1)}s → ${transition.durationUsed.toFixed(1)}s`);
    }
    if (before.beatAlign !== transition.beatAlign) {
      details.push(transition.beatAlign ? "beat alignment enabled" : "beat alignment disabled");
    }
    if (
      before.actualFromExitSec !== transition.actualFromExitSec ||
      before.actualToEntrySec !== transition.actualToEntrySec
    ) {
      details.push("bounded transition timing changed");
    }
    if (details.length) {
      changes.push({ transitionId: transition.transitionId, summary: details.join("; ") });
    }
  }
  return changes.length
    ? changes
    : [{ transitionId: "none", summary: "No audible transition change was detected." }];
}

function verifyFinal(
  manifest: CandidateManifest,
  journal: FinalizationJournal | null,
) {
  if (!manifest.finalizedCandidateId || !manifest.finalOutputPath) return false;
  const candidate = manifest.candidates.find(
    (item) => item.candidateId === manifest.finalizedCandidateId,
  );
  if (!candidate || !journal || journal.status !== "completed") return false;
  if (
    journal.candidateId !== candidate.candidateId ||
    !journal.finalPath ||
    path.resolve(journal.finalPath) !== path.resolve(manifest.finalOutputPath) ||
    !Object.values(journal.steps).every(Boolean)
  ) return false;
  try {
    const stat = fs.lstatSync(manifest.finalOutputPath);
    return stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.size === candidate.sizeBytes &&
      sha256File(manifest.finalOutputPath) === candidate.sha256;
  } catch {
    return false;
  }
}

function topLevelStatus(
  state: AutomaticSessionStateV1,
  manifest: CandidateManifest,
  finalVerified: boolean,
): Pick<CandidateReviewProjection, "status" | "title" | "message"> {
  if (state.state === "completed" && finalVerified) {
    return {
      status: "finalized",
      title: "Final MP3 created successfully",
      message: "The selected draft was verified, promoted, and recorded as the final medley.",
    };
  }
  if (state.state === "completed") {
    return {
      status: "recoverable_error",
      title: "Final verification required",
      message: "Completion was recorded, but the final MP3 has not passed every integrity check.",
    };
  }
  if (state.state === "manual_review_required") {
    return {
      status: "review_required",
      title: "Choose the draft you want to make final",
      message:
        state.recoverableError ??
        "The AI may recommend a draft, but only your choice can create the final MP3.",
    };
  }
  if (state.state === "recoverable_error") {
    return {
      status: "recoverable_error",
      title: "Your work is safe and can be resumed",
      message: state.recoverableError ?? "The session was interrupted after preserving its completed work.",
    };
  }
  if (state.state === "failed") {
    return { status: "failed", title: "The session failed", message: state.recoverableError ?? "No final MP3 was created." };
  }
  if (state.state === "cancelled") {
    return { status: "cancelled", title: "Session cancelled", message: "No final MP3 was created." };
  }
  if (state.state === "finalizing") {
    return { status: "finalizing", title: "Finalizing the selected draft", message: "The final transaction is still in progress." };
  }
  if (manifest.candidates.length) {
    return { status: "draft_ready", title: "Draft ready for review", message: "A rendered draft exists and is available below." };
  }
  return { status: "working", title: "Building your medley", message: "No rendered draft exists yet." };
}

export function buildCandidateReviewProjection(input: {
  workDir: string;
  state: AutomaticSessionStateV1;
  manifest: CandidateManifest;
  journal: FinalizationJournal | null;
}): CandidateReviewProjection {
  const { workDir, state, manifest, journal } = input;
  const byId = new Map(manifest.candidates.map((candidate) => [candidate.candidateId, candidate]));
  const finalVerified = verifyFinal(manifest, journal);
  const status = topLevelStatus(state, manifest, finalVerified);
  const candidates = manifest.candidates.map((candidate, index): CandidateReviewItem => {
    const review = latestForCandidate(manifest.musicalReviews, candidate.candidateId);
    const technical = latestForCandidate(manifest.technicalEvaluations, candidate.candidateId);
    const human = latestForCandidate(manifest.humanReviews, candidate.candidateId);
    const selected = manifest.selectedCandidateId === candidate.candidateId;
    const finalized = manifest.finalizedCandidateId === candidate.candidateId && finalVerified;
    const aiApproved = review?.approved === true;
    const humanApproved = human?.decision === "approved";
    let audioProblem: string | null = null;
    try {
      const registered = manifest.candidates.flatMap((item) => [
        item.outputPath,
        ...item.debugPaths,
        ...item.previewPaths,
      ]);
      const audioPath = assertRegisteredSafeFile(
        workDir,
        state.sessionId,
        candidate.outputPath,
        registered,
      );
      const stat = fs.lstatSync(audioPath);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size !== candidate.sizeBytes ||
        sha256File(audioPath) !== candidate.sha256
      ) throw new Error("The registered file does not match its manifest record");
    } catch (error: any) {
      audioProblem = String(error?.message || "Candidate audio is unavailable");
    }
    const audioIntegrityVerified = audioProblem === null;
    const actions: CandidateReviewAction[] = ["copy_candidate_path"];
    if (audioIntegrityVerified) actions.unshift("play_candidate");
    if (
      state.state === "manual_review_required" &&
      candidate.technicallyValid &&
      audioIntegrityVerified &&
      !humanApproved
    ) {
      actions.push("approve_candidate");
    }
    if (
      state.state === "finalizing" &&
      selected &&
      humanApproved &&
      candidate.technicallyValid &&
      audioIntegrityVerified &&
      journal?.status === "in_progress"
    ) {
      actions.push("resume_finalization");
    }
    return {
      candidateId: candidate.candidateId,
      draftNumber: index + 1,
      parentCandidateId: candidate.parentCandidateId,
      arrangementVersion: candidate.arrangementVersion,
      executionVersion: candidate.executionVersion,
      outputPath: candidate.outputPath,
      audioUrl: `/api/session/${encodeURIComponent(state.sessionId)}/candidates/${encodeURIComponent(candidate.candidateId)}/audio`,
      sizeBytes: candidate.sizeBytes,
      durationSec: candidate.durationSec,
      audioIntegrityVerified,
      audioProblem,
      technicallyValid: candidate.technicallyValid,
      technicalIssues: technical?.blockingIssues ?? [],
      reviewStatus: candidate.reviewStatus,
      reviewSummary: describeReview(review),
      reviewModel: review?.reviewModel ?? null,
      transitionConcerns: (review?.corrections ?? []).map((correction) => ({
        transitionId: correction.transitionId,
        issue: correction.issue,
        requestedChange: correction.requestedChange,
        correctionPreset: correction.correctionPreset ?? null,
      })),
      warnings: [...new Set([...candidate.warnings, ...(technical?.warnings ?? []), ...(review?.warnings ?? [])])],
      planChanges: describePlanChanges(candidate, candidate.parentCandidateId ? byId.get(candidate.parentCandidateId) ?? null : null),
      createdAt: candidate.createdAt,
      selected,
      recommended: selected && candidate.technicallyValid && aiApproved,
      finalized,
      actions,
    };
  });
  const finalizedCandidate = manifest.finalizedCandidateId
    ? byId.get(manifest.finalizedCandidateId) ?? null
    : null;
  const final = finalizedCandidate && manifest.finalOutputPath
    ? {
        candidateId: finalizedCandidate.candidateId,
        outputPath: manifest.finalOutputPath,
        audioUrl: `/api/audio/${encodeURIComponent(state.sessionId)}`,
        downloadUrl: `/api/audio/${encodeURIComponent(state.sessionId)}/download`,
        sizeBytes: finalizedCandidate.sizeBytes,
        sha256: finalizedCandidate.sha256,
        finalizedAt: journal?.completedAt ?? null,
        integrityVerified: finalVerified,
      }
    : null;
  const actions = [...new Set(candidates.flatMap((candidate) => candidate.actions))];
  if (status.status === "recoverable_error" && manifest.candidates.length) actions.push("resume_audio_review");
  if (state.state === "planning" || (state.state === "failed" && !manifest.candidates.length)) {
    actions.push("retry_arrangement", "change_model", "cancel_session");
  }
  if (finalVerified) actions.push("play_final", "download_final", "copy_final_path");
  return {
    schemaVersion: 1,
    sessionId: state.sessionId,
    state: state.state,
    stateRevision: state.stateRevision,
    ...status,
    candidateCount: candidates.length,
    maximumCandidates: Math.min(3, MAX_COMPLETE_CANDIDATES),
    candidates,
    selectedCandidateId: manifest.selectedCandidateId,
    finalizedCandidateId: manifest.finalizedCandidateId,
    final,
    actions: [...new Set(actions)],
    updatedAt: [state.updatedAt, manifest.updatedAt, journal?.updatedAt]
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? state.updatedAt,
  };
}
