import assert from "node:assert/strict";
import { buildResumeBinding, compareResumeBinding } from "./checkpointBinding";

const checkpoint = {
  projectBrief: { recommendedOrderIds: ["b", "a"] },
  arrangementPlan: { arrangementVersion: 1 },
};
const library = [
  { id: "a", localAnalysis: { localAnalysisV2: { fileHash: "ha", cacheKey: "ca" } } },
  { id: "b", localAnalysis: { localAnalysisV2: { fileHash: "hb", cacheKey: "cb" } } },
];
const binding = buildResumeBinding(checkpoint, library);
assert.deepEqual(compareResumeBinding(binding, buildResumeBinding(checkpoint, library)), {
  compatible: true,
  reason: "match",
});
assert.equal(compareResumeBinding(null, binding).reason, "legacy-unbound");
const changed = structuredClone(library);
changed[0].localAnalysis.localAnalysisV2.fileHash = "changed";
assert.equal(
  compareResumeBinding(binding, buildResumeBinding(checkpoint, changed)).reason,
  "source-changed",
);
const selectedBinding = buildResumeBinding(
  { ...checkpoint, selectedTrackIds: ["a"] },
  library,
);
assert.notEqual(
  selectedBinding.sourceFingerprint,
  binding.sourceFingerprint,
  "Explicit selected track IDs must be the authoritative resume source set",
);

console.log("checkpointBinding tests passed");
