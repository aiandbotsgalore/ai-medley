import assert from "node:assert/strict";
import { evaluateCandidateQuality } from "./candidateQualityGate";

const valid = evaluateCandidateQuality({
  actualDurationSec: 100,
  expectedDurationSec: 101,
  targetDurationSec: 100,
  quality: { integratedLUFS: -14, loudnessRange: 8, truePeak: -1.2 },
});
assert.equal(valid.technicallyValid, true);
assert.deepEqual(valid.blockingIssues, []);

const invalid = evaluateCandidateQuality({
  actualDurationSec: 80,
  expectedDurationSec: 100,
  targetDurationSec: 100,
  quality: { integratedLUFS: null, loudnessRange: null, truePeak: 0.5 },
});
assert.equal(invalid.technicallyValid, false);
assert.match(invalid.blockingIssues.join(" "), /duration/i);
assert.match(invalid.blockingIssues.join(" "), /loudness/i);
assert.match(invalid.blockingIssues.join(" "), /peak/i);

assert.equal(
  evaluateCandidateQuality({
    actualDurationSec: Number.NaN,
    expectedDurationSec: 10,
    targetDurationSec: null,
    quality: { integratedLUFS: -14, loudnessRange: 2, truePeak: -1 },
  }).technicallyValid,
  false,
);

console.log("candidateQualityGate tests passed");
