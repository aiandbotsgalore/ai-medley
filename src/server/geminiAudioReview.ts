import { z } from "zod";
import {
  CorrectionPresetSchema,
  QualityReviewSchema,
  type QualityReview,
  type RenderCandidate,
} from "../types/specialistWorkflow";
import { CORRECTION_POLICY_VERSION } from "./correctionPolicy";

export const AUTOMATIC_GEMINI_MODELS = {
  arrangement: "gemini-3.1-pro-preview",
  wholeMixReview: "gemini-3.1-pro-preview",
  targetedReview: "gemini-3.5-flash",
} as const;

export const AUTOMATIC_OPENROUTER_MODELS = {
  arrangement: "google/gemini-3.1-pro-preview",
  wholeMixReview: "google/gemini-3.1-pro-preview",
  targetedReview: "google/gemini-3.5-flash",
} as const;

const ReviewIssue = z.string().trim().min(1).max(1_000);

export const GeminiAudioReviewDecisionSchema = z.strictObject({
  approved: z.boolean(),
  emotionalArc: z.number().min(0).max(100),
  transitionSmoothness: z.number().min(0).max(100),
  performerIdentity: z.number().min(0).max(100),
  overallScore: z.number().min(0).max(100),
  blockingIssues: z.array(ReviewIssue).max(20),
  warnings: z.array(ReviewIssue).max(20),
  corrections: z.array(z.strictObject({
    transitionId: z.string().trim().min(1).max(200),
    issue: ReviewIssue,
    correctionPreset: CorrectionPresetSchema,
  })).max(20),
});

export type GeminiAudioReviewDecision = z.infer<
  typeof GeminiAudioReviewDecisionSchema
>;

type UploadedFile = {
  name?: string | null;
  uri?: string | null;
  mimeType?: string | null;
  state?: string | null;
};

export type GeminiAudioClient = {
  files: {
    upload(input: { file: string; config: { mimeType: string; displayName: string } }): Promise<UploadedFile>;
    get(input: { name: string }): Promise<UploadedFile>;
    delete(input: { name: string }): Promise<unknown>;
  };
  models: {
    generateContent(input: unknown): Promise<{ text?: string | null }>;
  };
};

export type AudioReviewTransition = {
  transitionId: string;
  fromTrackId: string;
  toTrackId: string;
  style: string;
  allowedCorrectionPresets: Array<z.infer<typeof CorrectionPresetSchema>>;
};

export type GeminiAudioReviewInput = {
  client: GeminiAudioClient;
  model: string;
  candidate: Pick<RenderCandidate, "candidateId" | "candidateVersion" | "arrangementVersion" | "durationSec">;
  // Whole-mix review uploads the rendered candidate. Targeted review uploads
  // only pre-rendered transition clips, keeping correction calls small.
  candidateFilePath?: string;
  transitions: AudioReviewTransition[];
  mode: "whole_mix" | "targeted";
  transitionClips?: Array<{ transitionId: string; filePath: string }>;
  delay?: (milliseconds: number) => Promise<void>;
  maxProcessingPolls?: number;
};

export class GeminiAudioReviewError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GeminiAudioReviewError";
  }
}

export class OpenRouterAudioReviewError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OpenRouterAudioReviewError";
  }
}

function parseJsonResponse(value: string | null | undefined) {
  const text = String(value ?? "").trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  if (!text) throw new GeminiAudioReviewError("Gemini audio review returned no structured result.");
  try {
    return GeminiAudioReviewDecisionSchema.parse(JSON.parse(text));
  } catch (cause) {
    throw new GeminiAudioReviewError(
      "Gemini audio review returned an invalid structured result.",
      { cause },
    );
  }
}

export function validateAudioReviewDecision(
  decision: GeminiAudioReviewDecision,
  transitions: AudioReviewTransition[],
) {
  const allowedByTransition = new Map(
    transitions.map((transition) => [
      transition.transitionId,
      new Set(transition.allowedCorrectionPresets),
    ]),
  );
  const unknown = decision.corrections.find(
    (item) => !allowedByTransition.has(item.transitionId),
  );
  if (unknown) {
    throw new GeminiAudioReviewError(
      "Gemini audio review referenced a transition outside the locked candidate.",
    );
  }
  const forbidden = decision.corrections.find(
    (item) => !allowedByTransition.get(item.transitionId)?.has(item.correctionPreset),
  );
  if (forbidden) {
    throw new GeminiAudioReviewError(
      "Gemini audio review requested a correction that was not offered for the locked transition.",
    );
  }
  if (decision.approved && (decision.blockingIssues.length || decision.corrections.length)) {
    throw new GeminiAudioReviewError(
      "Gemini audio review approved a candidate while also requesting corrections.",
    );
  }
  if (!decision.approved && !decision.blockingIssues.length && !decision.corrections.length) {
    throw new GeminiAudioReviewError(
      "Gemini audio review rejected a candidate without an actionable reason.",
    );
  }
  return decision;
}

function defaultDelay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForActiveFile(
  client: GeminiAudioClient,
  uploaded: UploadedFile,
  delay: (milliseconds: number) => Promise<void>,
  maxPolls: number,
) {
  if (!uploaded.name) throw new GeminiAudioReviewError("Gemini did not return an uploaded review-file ID.");
  let current = uploaded;
  for (let poll = 0; current.state === "PROCESSING" && poll < maxPolls; poll++) {
    await delay(2_000);
    current = await client.files.get({ name: uploaded.name });
  }
  if (current.state && current.state !== "ACTIVE") {
    throw new GeminiAudioReviewError("Gemini could not prepare the temporary audio review file.");
  }
  if (!current.uri) throw new GeminiAudioReviewError("Gemini review file has no usable URI.");
  return current;
}

export function buildAudioReviewPrompt(input: Pick<GeminiAudioReviewInput, "mode" | "candidate" | "transitions">) {
  const allowed = input.transitions.map((transition) => ({
    transitionId: transition.transitionId,
    fromTrackId: transition.fromTrackId,
    toTrackId: transition.toTrackId,
    style: transition.style,
    allowedCorrectionPresets: transition.allowedCorrectionPresets,
  }));
  return JSON.stringify({
    correctionPolicyVersion: CORRECTION_POLICY_VERSION,
    task: input.mode === "whole_mix"
      ? "Listen to the complete rendered medley. Judge overall pacing, fair time sharing, emotional flow, and transition quality."
      : "Listen to the supplied transition clips and refine only the identified transition corrections.",
    rules: [
      "Judge the actual supplied audio, not hypothetical source-track timing.",
      "Approve only if the complete medley is musically coherent and no correction is needed.",
      "If rejecting, return at least one blocking issue or correction.",
      "A correction must name a listed transitionId and one listed correctionPreset.",
      "Never invent timestamps, source sections, FFmpeg commands, tempo values, or a numeric adjustment.",
      "Return JSON only, exactly matching the requested fields.",
    ],
    candidate: {
      candidateId: input.candidate.candidateId,
      candidateVersion: input.candidate.candidateVersion,
      arrangementVersion: input.candidate.arrangementVersion,
      durationSec: input.candidate.durationSec,
    },
    transitions: allowed,
    response: {
      approved: "boolean",
      emotionalArc: "number 0-100",
      transitionSmoothness: "number 0-100",
      performerIdentity: "number 0-100",
      overallScore: "number 0-100",
      blockingIssues: "string[]",
      warnings: "string[]",
      corrections: "{ transitionId, issue, correctionPreset }[]",
    },
  });
}

/**
 * Uploads only server-registered candidate artifacts, asks Gemini to listen,
 * and then deletes every temporary Gemini file it created. Source tracks are
 * never uploaded by this path and no local artifact is changed or removed.
 */
export async function reviewCandidateAudioWithGemini(
  input: GeminiAudioReviewInput,
): Promise<GeminiAudioReviewDecision> {
  const delay = input.delay ?? defaultDelay;
  const uploadedNames: string[] = [];
  try {
    if (input.mode === "whole_mix" && !input.candidateFilePath) {
      throw new GeminiAudioReviewError("Whole-mix review requires the registered candidate audio.");
    }
    const activeCandidate = input.candidateFilePath
      ? await (async () => {
          const candidateFile = await input.client.files.upload({
            file: input.candidateFilePath!,
            config: { mimeType: "audio/mpeg", displayName: `${input.candidate.candidateId}.mp3` },
          });
          if (candidateFile.name) uploadedNames.push(candidateFile.name);
          return waitForActiveFile(
            input.client,
            candidateFile,
            delay,
            input.maxProcessingPolls ?? 15,
          );
        })()
      : null;

    const clipFiles: Array<{ transitionId: string; file: UploadedFile }> = [];
    for (const clip of input.transitionClips ?? []) {
      const uploaded = await input.client.files.upload({
        file: clip.filePath,
        config: { mimeType: "audio/mpeg", displayName: `${clip.transitionId}.mp3` },
      });
      if (uploaded.name) uploadedNames.push(uploaded.name);
      clipFiles.push({
        transitionId: clip.transitionId,
        file: await waitForActiveFile(
          input.client,
          uploaded,
          delay,
          input.maxProcessingPolls ?? 15,
        ),
      });
    }

    const result = await input.client.models.generateContent({
      model: input.model,
      contents: [{
        role: "user",
        parts: [
          { text: buildAudioReviewPrompt(input) },
          ...(activeCandidate
            ? [{ fileData: { fileUri: activeCandidate.uri, mimeType: activeCandidate.mimeType ?? "audio/mpeg" } }]
            : []),
          ...clipFiles.flatMap(({ transitionId, file }) => [
            { text: `Transition clip for ${transitionId}:` },
            { fileData: { fileUri: file.uri, mimeType: file.mimeType ?? "audio/mpeg" } },
          ]),
        ],
      }],
      config: { responseMimeType: "application/json", temperature: 0.1 },
    });
    return validateAudioReviewDecision(
      parseJsonResponse(result.text),
      input.transitions,
    );
  } catch (error) {
    if (error instanceof GeminiAudioReviewError) throw error;
    throw new GeminiAudioReviewError("Gemini audio review could not be completed.", { cause: error });
  } finally {
    const cleanup = await Promise.allSettled(
      uploadedNames.map((name) => input.client.files.delete({ name })),
    );
    if (cleanup.some((result) => result.status === "rejected")) {
      throw new GeminiAudioReviewError(
        "Gemini audio review file cleanup could not be confirmed; no candidate was approved.",
      );
    }
  }
}

export type OpenRouterAudioReviewInput = Omit<
  GeminiAudioReviewInput,
  "client" | "delay" | "maxProcessingPolls"
> & {
  readAudio: (filePath: string) => Promise<Uint8Array>;
  request: (body: Record<string, unknown>) => Promise<unknown>;
};

function toOpenRouterAudioPart(bytes: Uint8Array) {
  return {
    type: "input_audio",
    input_audio: { data: Buffer.from(bytes).toString("base64"), format: "mp3" },
  };
}

/**
 * Sends only registered rendered artifacts through OpenRouter's audio-input
 * contract. There is no temporary remote file to clean up and no source track
 * is read by this path.
 */
export async function reviewCandidateAudioWithOpenRouter(
  input: OpenRouterAudioReviewInput,
): Promise<GeminiAudioReviewDecision> {
  try {
    if (input.mode === "whole_mix" && !input.candidateFilePath) {
      throw new OpenRouterAudioReviewError("Whole-mix review requires the registered candidate audio.");
    }
    const content: Array<Record<string, unknown>> = [
      { type: "text", text: buildAudioReviewPrompt(input) },
    ];
    if (input.candidateFilePath) {
      content.push(toOpenRouterAudioPart(await input.readAudio(input.candidateFilePath)));
    }
    for (const clip of input.transitionClips ?? []) {
      content.push({ type: "text", text: `Transition clip for ${clip.transitionId}:` });
      content.push(toOpenRouterAudioPart(await input.readAudio(clip.filePath)));
    }
    const response: any = await input.request({
      model: input.model,
      temperature: 0.1,
      messages: [{ role: "user", content }],
      tools: [{
        type: "function",
        function: {
          name: "submit_audio_review",
          description: "Submit the bounded structured evaluation of the supplied medley audio.",
          parameters: z.toJSONSchema(GeminiAudioReviewDecisionSchema),
        },
      }],
      tool_choice: { type: "function", function: { name: "submit_audio_review" } },
      parallel_tool_calls: false,
      max_tokens: 2_000,
    });
    const call = response?.choices?.[0]?.message?.tool_calls?.find(
      (item: any) => item?.function?.name === "submit_audio_review",
    );
    if (!call) throw new OpenRouterAudioReviewError("OpenRouter audio review returned no matching tool call.");
    const raw = call.function?.arguments;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return validateAudioReviewDecision(
      GeminiAudioReviewDecisionSchema.parse(parsed),
      input.transitions,
    );
  } catch (error) {
    if (error instanceof OpenRouterAudioReviewError) throw error;
    throw new OpenRouterAudioReviewError("OpenRouter audio review returned an invalid structured result.", { cause: error });
  }
}

export function toQualityReviewFromAudioDecision(input: {
  candidate: Pick<RenderCandidate, "candidateId" | "candidateVersion" | "arrangementVersion">;
  decision: GeminiAudioReviewDecision;
  model: string;
  reviewSource?: "gemini_audio" | "openrouter_audio";
}): QualityReview {
  return QualityReviewSchema.parse({
    schemaVersion: 1,
    reviewSource: input.reviewSource ?? "gemini_audio",
    reviewModel: input.model,
    candidateId: input.candidate.candidateId,
    candidateVersion: input.candidate.candidateVersion,
    arrangementVersion: input.candidate.arrangementVersion,
    approved: input.decision.approved,
    emotionalArc: input.decision.emotionalArc,
    transitionSmoothness: input.decision.transitionSmoothness,
    performerIdentity: input.decision.performerIdentity,
    overallScore: input.decision.overallScore,
    blockingIssues: input.decision.blockingIssues,
    warnings: input.decision.warnings,
    corrections: input.decision.corrections.map((correction) => ({
      transitionId: correction.transitionId,
      issue: correction.issue,
      correctionPreset: correction.correctionPreset,
      requestedChange: `Apply bounded preset ${correction.correctionPreset}.`,
    })),
    reviewedAt: new Date().toISOString(),
  });
}
