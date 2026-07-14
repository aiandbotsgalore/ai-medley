import assert from "node:assert/strict";
import {
  GeminiAudioReviewError,
  reviewCandidateAudioWithOpenRouter,
  reviewCandidateAudioWithGemini,
  toQualityReviewFromAudioDecision,
  type GeminiAudioClient,
} from "./geminiAudioReview";

const uploaded: string[] = [];
const deleted: string[] = [];
let generatedRequest: any = null;

const client: GeminiAudioClient = {
  files: {
    async upload({ file }) {
      const name = `files/${file.split(/[\\/]/).at(-1)}`;
      uploaded.push(name);
      return { name, state: "PROCESSING", mimeType: "audio/mpeg" };
    },
    async get({ name }) {
      return { name, uri: `gemini://${name}`, state: "ACTIVE", mimeType: "audio/mpeg" };
    },
    async delete({ name }) {
      deleted.push(name);
      return {};
    },
  },
  models: {
    async generateContent(request) {
      generatedRequest = request;
      return {
        text: JSON.stringify({
          approved: false,
          emotionalArc: 66,
          transitionSmoothness: 42,
          performerIdentity: 81,
          overallScore: 58,
          blockingIssues: ["The vocal handoff is abrupt."],
          warnings: [],
          corrections: [{
            transitionId: "transition-1",
            issue: "Abrupt vocal handoff",
            correctionPreset: "longer_crossfade",
          }],
        }),
      };
    },
  },
};

const candidate = {
  candidateId: "candidate-001",
  candidateVersion: 1,
  arrangementVersion: 1,
  durationSec: 240,
};
const transitions = [{
  transitionId: "transition-1",
  fromTrackId: "track-a",
  toTrackId: "track-b",
  style: "smooth_blend",
  allowedCorrectionPresets: ["longer_crossfade" as const],
}];

const decision = await reviewCandidateAudioWithGemini({
  client,
  model: "gemini-test",
  candidate,
  candidateFilePath: "C:\\isolated\\candidate-001.mp3",
  transitions,
  mode: "whole_mix",
  delay: async () => {},
});
assert.equal(decision.approved, false);
assert.deepEqual(uploaded, ["files/candidate-001.mp3"]);
assert.deepEqual(deleted, ["files/candidate-001.mp3"]);
assert.equal(generatedRequest.model, "gemini-test");
assert.match(generatedRequest.contents[0].parts[0].text, /Never invent timestamps/);

const review = toQualityReviewFromAudioDecision({ candidate, decision, model: "gemini-test" });
assert.equal(review.reviewSource, "gemini_audio");
assert.equal(review.reviewModel, "gemini-test");
assert.equal(review.corrections[0].correctionPreset, "longer_crossfade");
assert.match(review.corrections[0].requestedChange, /bounded preset/);

uploaded.length = 0;
deleted.length = 0;
await reviewCandidateAudioWithGemini({
  client,
  model: "gemini-test",
  candidate,
  transitions,
  mode: "targeted",
  transitionClips: [{ transitionId: "transition-1", filePath: "C:\\isolated\\transition-1.mp3" }],
  delay: async () => {},
});
assert.deepEqual(uploaded, ["files/transition-1.mp3"]);
assert.deepEqual(deleted, ["files/transition-1.mp3"]);
assert.equal(
  generatedRequest.contents[0].parts.some((part: any) => part.fileData?.fileUri === "gemini://files/candidate-001.mp3"),
  false,
  "targeted review must not upload the full candidate a second time",
);

await assert.rejects(
  () => reviewCandidateAudioWithGemini({
    client,
    model: "gemini-test",
    candidate,
    transitions,
    mode: "whole_mix",
    delay: async () => {},
  }),
  GeminiAudioReviewError,
);

let openRouterRequest: any = null;
const openRouterDecision = await reviewCandidateAudioWithOpenRouter({
  model: "google/gemini-3.1-pro-preview",
  candidate,
  candidateFilePath: "C:\\isolated\\candidate-001.mp3",
  transitions,
  mode: "whole_mix",
  readAudio: async () => new Uint8Array([1, 2, 3]),
  request: async (body) => {
    openRouterRequest = body;
    return {
      choices: [{ message: { tool_calls: [{
        function: {
          name: "submit_audio_review",
          arguments: JSON.stringify({
            approved: true,
            emotionalArc: 80,
            transitionSmoothness: 82,
            performerIdentity: 78,
            overallScore: 81,
            blockingIssues: [],
            warnings: [],
            corrections: [],
          }),
        },
      }] } }],
    };
  },
});
assert.equal(openRouterDecision.approved, true);
assert.equal(openRouterRequest.model, "google/gemini-3.1-pro-preview");
assert.equal(openRouterRequest.messages[0].content[1].type, "input_audio");
assert.equal(openRouterRequest.messages[0].content[1].input_audio.format, "mp3");
assert.equal(openRouterRequest.tool_choice.function.name, "submit_audio_review");

await assert.rejects(
  () => reviewCandidateAudioWithOpenRouter({
    model: "openrouter/free-test:free",
    candidate,
    candidateFilePath: "C:\\isolated\\candidate-001.mp3",
    transitions,
    mode: "whole_mix",
    readAudio: async () => new Uint8Array([1, 2, 3]),
    request: async () => ({
      choices: [{ message: { tool_calls: [{ function: {
        name: "submit_audio_review",
        arguments: JSON.stringify({
          approved: false,
          emotionalArc: 60,
          transitionSmoothness: 40,
          performerIdentity: 70,
          overallScore: 50,
          blockingIssues: ["Abrupt handoff"],
          warnings: [],
          corrections: [{
            transitionId: "transition-1",
            issue: "Abrupt handoff",
            correctionPreset: "dramatic_cut",
          }],
        }),
      } }] } }],
    }),
  }),
  /invalid structured result/,
  "The reviewer must not choose a correction preset the server did not offer",
);

console.log("geminiAudioReview tests passed");
