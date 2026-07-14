import assert from "node:assert/strict";
import {
  GeminiAudioReviewError,
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

console.log("geminiAudioReview tests passed");
