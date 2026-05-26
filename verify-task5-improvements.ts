/**
 * End-to-end verification for Task 5: Matrix-driven section pair selection.
 * Loads the current library's analyzed medleyIntelligence and generates
 * the design payload to inspect what section pairs/transitions the system now recommends.
 */

import fs from 'fs';
import path from 'path';
import { buildMedleyDesignPayload } from './src/engine/medleyIntelligence';
import type { TrackIntelligence } from './src/engine/medleyIntelligence';

const dbPath = path.join(process.cwd(), 'library', 'db.json');

if (!fs.existsSync(dbPath)) {
  console.error('No library/db.json found. Cannot run verification.');
  process.exit(1);
}

const library = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

// Extract tracks that have medleyIntelligence
const tracks: TrackIntelligence[] = library
  .map((entry: any) => entry.medleyIntelligence)
  .filter(Boolean);

if (tracks.length < 2) {
  console.error(`Only ${tracks.length} analyzed tracks found. Need at least 2 for meaningful verification.`);
  process.exit(1);
}

console.log(`=== Task 5 End-to-End Verification ===`);
console.log(`Loaded ${tracks.length} tracks with medley intelligence.\n`);

// Generate the design payload (what the agent would see after DESIGN phase)
const payload = buildMedleyDesignPayload({
  tracks,
  userConstraints: {},
  maxTransitions: 32,
  wisdom: []
});

console.log('Payload keys:', Object.keys(payload));

console.log('\n--- transitionMatrixSummary (top pairs the agent sees) ---');
const summary = payload.transitionMatrixSummary || [];
summary.slice(0, 8).forEach((t: any, i: number) => {
  console.log(`${(i+1).toString().padStart(2)}. ${t.fromTrackId?.slice(0,8)} → ${t.toTrackId?.slice(0,8)} | score=${t.score?.toFixed(3)} | harm=${t.scores?.harmonicCompatibility} beat=${t.scores?.beatAlignment} | type=${t.transitionType}`);
});

console.log('\n--- recommendedStrategies (first 2) with chosen sections ---');
(payload.recommendedStrategies || []).slice(0, 2).forEach((s: any, i: number) => {
  console.log(`\n${i+1}. ${s.title} (score=${s.score})`);
  (s.orderedTracks || []).forEach((ot: any) => {
    console.log(`   ${ot.trackId?.slice(0,8)}: sections=${(ot.selectedSectionIds||[]).join(', ')} | entry=${ot.entrySec?.toFixed(1)}s → exit=${ot.exitSec?.toFixed(1)}s`);
  });
});

console.log('\n=== Verification Notes ===');
console.log('- The transitionMatrixSummary reflects the wider 5x5 search + rebalanced weights from Task 1.');
console.log('- recommendedStrategies show sections chosen after Task 5 matrix-driven logic.');
console.log('- Look for coherent musical flow (high harmonic/beat scores, logical entry/exit points).');

process.exit(0);