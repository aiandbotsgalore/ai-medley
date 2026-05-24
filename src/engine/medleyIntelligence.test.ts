import assert from 'node:assert/strict';
import {
  buildMedleyDesignPayload,
  buildTrackIntelligence,
  buildTransitionMatrix,
  validateAiMedleyPlan
} from './medleyIntelligence';

const trackA = buildTrackIntelligence({
  trackId: 'track_01',
  filename: 'soft-open.wav',
  analysis: {
    source: 'local-ffmpeg',
    duration: 180,
    meanVolumeDb: -22,
    maxVolumeDb: -3,
    estimatedBpm: 92,
    silence: [{ start: 0, end: 1.5, duration: 1.5 }, { start: 170, end: 180, duration: 10 }],
    energyCurve: [12, 14, 18, 25, 35, 42, 48, 52, 45, 40, 30, 20],
    candidateSections: [{ start: 65, end: 95, energy: 76 }]
  }
});

const trackB = buildTrackIntelligence({
  trackId: 'track_02',
  filename: 'big-hook.wav',
  analysis: {
    source: 'local-ffmpeg',
    duration: 210,
    meanVolumeDb: -18,
    maxVolumeDb: -1,
    estimatedBpm: 104,
    silence: [{ start: 100, end: 103, duration: 3 }],
    energyCurve: [20, 28, 44, 65, 84, 92, 88, 76, 64, 50, 42, 35],
    candidateSections: [{ start: 70, end: 112, energy: 92 }, { start: 150, end: 188, energy: 86 }]
  }
});

const trackC = buildTrackIntelligence({
  trackId: 'track_03',
  filename: 'reset-finale.wav',
  analysis: {
    source: 'local-ffmpeg',
    duration: 160,
    meanVolumeDb: -20,
    maxVolumeDb: -2,
    estimatedBpm: null,
    silence: [{ start: 42, end: 48, duration: 6 }],
    energyCurve: [8, 12, 18, 24, 30, 26, 22, 45, 68, 86, 94, 88],
    candidateSections: [{ start: 110, end: 155, energy: 94 }]
  }
});

assert.equal(trackA.profile.trackId, 'track_01');
assert.equal(trackA.localFacts.every(fact => fact.kind === 'local_fact'), true);
assert.equal(trackA.heuristicGuesses.every(guess => guess.kind === 'heuristic_guess'), true);
assert.ok(trackB.rankedHookCandidates[0].scores.hookStrength > trackA.rankedHookCandidates[0].scores.hookStrength);
assert.ok(trackC.warnings.includes('tempo_estimate_missing_or_uncertain'));

for (const score of trackB.sectionScores) {
  assert.equal(typeof score.reason, 'string');
  assert.ok(score.confidence >= 0 && score.confidence <= 1);
  assert.ok(Array.isArray(score.factsUsed));
  assert.ok(Array.isArray(score.warnings));
}

const matrix = buildTransitionMatrix([trackA, trackB, trackC]);
assert.ok(matrix.length >= 6);
assert.ok(matrix[0].score >= matrix[matrix.length - 1].score);
assert.ok(matrix.every(item => item.fromTrackId !== item.toTrackId));
assert.ok(matrix.every(item => item.confidence >= 0 && item.confidence <= 1));

const design = buildMedleyDesignPayload({
  tracks: [trackA, trackB, trackC],
  userConstraints: { targetDurationMinutes: 6 }
});

assert.equal(design.schemaVersion, 'medley_design_v1');
assert.equal(design.source, 'local_medley_intelligence');
assert.equal(design.aiRules.mustDistinguishFactsFromGuesses, true);
assert.equal(design.aiRules.mustNotInventLyrics, true);
assert.ok(design.recommendedStrategies.length >= 6);
assert.ok(design.transitionMatrixSummary.length > 0);
assert.ok(design.localFacts.length > 0);
assert.ok(design.heuristicGuesses.length > 0);

const badPlan = validateAiMedleyPlan({
  finalMedleyPlan: [
    {
      sectionId: 'track_99_section_01',
      claim: 'The lyrics mean this song is about betrayal.'
    }
  ]
}, design);
assert.equal(badPlan.ok, false);
assert.ok(badPlan.errors.some(error => error.includes('unsupported section id')));
assert.ok(badPlan.errors.some(error => error.includes('lyrics')));

const goodPlan = validateAiMedleyPlan({
  finalMedleyPlan: [
    {
      sectionId: design.sections[0].sectionId,
      claim: 'Emotional arc proxy based on local energy only; lyrics unavailable.'
    }
  ]
}, design);
assert.equal(goodPlan.ok, true);

console.log('medleyIntelligence tests passed');
