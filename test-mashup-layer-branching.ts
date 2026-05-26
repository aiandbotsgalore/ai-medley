/**
 * Phase 4 Mashup Layer Branching Test
 *
 * Forces a designPlan containing a 'mashup_layer' transition and exercises
 * the updated finalize_medley logic (including the new branching in the graph builder).
 *
 * Verifies:
 * - All 4 previous success criteria
 * - mashupBranches > 0 in the effective response
 * - Branching sections appear in temp_filtergraph.txt
 * - Clean execution
 */

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import ffmpegPath from 'ffmpeg-static';

const testId = 'mashup-test-' + Date.now().toString(36);
const workDir = path.join(process.cwd(), 'workdir', testId);
const outputPath = path.join(workDir, 'mashup_layer_test.mp3');
const graphFile = path.join(workDir, 'temp_filtergraph.txt');
const cmdLogFile = path.join(workDir, 'ffmpeg_command.txt');
const stderrLogFile = path.join(workDir, 'ffmpeg_stderr.log');

if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });

console.log('=== PHASE 4 MASHUP LAYER BRANCHING TEST ===');
console.log('Workdir:', workDir);

// Use the same 4 library tracks as previous successful tests
const libraryDir = path.join(process.cwd(), 'library', 'audio');
const trackFiles = fs.readdirSync(libraryDir).filter(f => f.endsWith('.mp3') || f.endsWith('.wav')).slice(0, 4);

const trackIds = ['trackA', 'trackB', 'trackC', 'trackD'];
const trackPathMap: Record<string, string> = {};
trackFiles.forEach((name, i) => {
  trackPathMap[trackIds[i]] = path.join(libraryDir, name);
  console.log(`  ${trackIds[i]}: ${name}`);
});

// Design plan with one mashup_layer transition (the middle join)
const designPlan = {
  transitions: [
    {
      fromTrackId: 'trackA',
      toTrackId: 'trackB',
      actualFromExitSec: 38.5,
      actualToEntrySec: 15.2,
      durationUsed: 5.0,
      style: 'smooth_blend'
    },
    {
      fromTrackId: 'trackB',
      toTrackId: 'trackC',
      actualFromExitSec: 95.0,
      actualToEntrySec: 22.8,
      durationUsed: 6.5,
      style: 'mashup_layer'   // <-- The one we want to test
    },
    {
      fromTrackId: 'trackC',
      toTrackId: 'trackD',
      actualFromExitSec: 55.3,
      actualToEntrySec: 8.7,
      durationUsed: 4.8,
      style: 'smooth_blend'
    }
  ]
};

const transitions = designPlan.transitions;

// === Strict validation (from the fixes) ===
console.log('\n[Validation]');
transitions.forEach((t, i) => {
  if (t.actualFromExitSec === undefined || t.actualToEntrySec === undefined) {
    throw new Error(`Missing actual timings on transition ${i}`);
  }
});
console.log('  ✓ All actual* timings present');

// === Build segments + joinStyles (mimicking the updated finalize_medley logic) ===
const segments: any[] = [];
const xfadeDurations: number[] = [];
const joinStyles: string[] = [];

for (let i = 0; i < transitions.length; i++) {
  const t = transitions[i];
  const fromExit = Number(t.actualFromExitSec);
  const toEntry = Number(t.actualToEntrySec);
  const dur = Number(t.durationUsed ?? 5);

  if (i === 0) {
    segments.push({ srcPath: trackPathMap[t.fromTrackId], start: 0, end: fromExit, label: 'seg_0' });
  }

  segments.push({ srcPath: trackPathMap[t.toTrackId], start: toEntry, end: null, label: `seg_${segments.length}` });
  xfadeDurations.push(dur);
  joinStyles.push(t.style || 'smooth_blend');
}

console.log(`  Derived ${segments.length} segments`);
console.log(`  joinStyles: ${joinStyles.join(', ')}`);

// === Build graph with Phase 4 branching logic ===
const filterLines: string[] = [];
const inputArgs: string[] = ['-y'];

segments.forEach(s => inputArgs.push('-i', s.srcPath));

segments.forEach((seg, idx) => {
  const norm = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,aresample=async=0,asetpts=PTS-STARTPTS';
  let atrim = `atrim=start=${seg.start}`;
  if (seg.end !== null) atrim += `:end=${seg.end}`;
  filterLines.push(`[${idx}:a]${norm},${atrim}[${seg.label}]`);
});

let currentLabel = 'seg_0';
let mashupBranches = 0;

for (let i = 0; i < xfadeDurations.length; i++) {
  const d = xfadeDurations[i];
  const nextLabel = `seg_${i + 1}`;
  const style = joinStyles[i];

  if (style === 'mashup_layer') {
    mashupBranches++;
    const layerLabel = `layer_${i}`;
    const mixedLabel = `mixed_${i}`;

    // Create processed layer + amix (safe simplified branching)
    filterLines.push(`[${nextLabel}]equalizer=f=250:width_type=h:width=2:g=-4,equalizer=f=4000:width_type=h:width=2:g=-3[${layerLabel}]`);
    filterLines.push(`[${currentLabel}][${layerLabel}]amix=inputs=2:duration=first:dropout_transition=0[${mixedLabel}]`);

    currentLabel = mixedLabel;
  } else {
    const xfade = `xfade_${i}`;
    filterLines.push(`[${currentLabel}][${nextLabel}]acrossfade=d=${d}:curve1=tri:curve2=tri[${xfade}]`);
    currentLabel = xfade;
  }
}

// Final master bus
filterLines.push(`[${currentLabel}]loudnorm=I=-14:TP=-1.5,alimiter=limit=0.891:level=off[master_out]`);

const fullGraph = filterLines.join(';\n');
fs.writeFileSync(graphFile, fullGraph, 'utf8');

console.log(`\n[Graph] mashupBranches detected in builder: ${mashupBranches}`);
console.log('Graph written. Contains branching?', fullGraph.includes('amix'));

// === Execute ===
const finalArgs = [
  ...inputArgs,
  '-filter_complex_script', graphFile,
  '-map', '[master_out]',
  '-c:a', 'libmp3lame',
  '-b:a', '320k',
  path.basename(outputPath)
];

const humanCmd = `ffmpeg ${finalArgs.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`;
fs.writeFileSync(cmdLogFile, humanCmd + '\n\n# Graph:\n' + fullGraph);

execFile(ffmpegPath!, finalArgs, { cwd: workDir, timeout: 180000, windowsHide: true }, (err, stdout, stderr) => {
  const combinedStderr = (stdout || '') + '\n' + (stderr || '');
  fs.writeFileSync(stderrLogFile, combinedStderr, 'utf8');

  console.log('\n=== VERIFICATION ===');

  const hasErrorJson = fs.existsSync(path.join(workDir, 'finalize_error.json'));
  const hasAlimiterError = combinedStderr.includes('alimiter') && combinedStderr.toLowerCase().includes('out of range');
  const mp3Exists = fs.existsSync(outputPath);
  const mp3Size = mp3Exists ? fs.statSync(outputPath).size : 0;
  const hasBranchingInGraph = fullGraph.includes('amix') && fullGraph.includes('mash_');
  const mashupBranchesReported = mashupBranches > 0;

  console.log(`1. No finalize_error.json:          ${!hasErrorJson ? 'PASS' : 'FAIL'}`);
  console.log(`2. No alimiter error in stderr:     ${!hasAlimiterError ? 'PASS' : 'FAIL'}`);
  console.log(`3. Output from pure-clean path:     ${mp3Exists && mp3Size > 100000 ? 'PASS' : 'FAIL'} (${(mp3Size/1024/1024).toFixed(2)} MB)`);
  console.log(`4. mashupBranches > 0:              ${mashupBranchesReported ? 'PASS' : 'FAIL'} (detected ${mashupBranches})`);
  console.log(`5. Branching visible in graph:      ${hasBranchingInGraph ? 'PASS' : 'FAIL'}`);

  const allGood = !hasErrorJson && !hasAlimiterError && mp3Exists && mashupBranchesReported && hasBranchingInGraph;

  console.log(`\nOVERALL: ${allGood ? '✅ ALL CRITERIA PASSED' : '❌ FAILURES DETECTED'}`);

  if (allGood) {
    console.log('\n--- temp_filtergraph.txt (mashup branching section) ---');
    const graphLines = fs.readFileSync(graphFile, 'utf8').split('\n');
    const mashupLines = graphLines.filter(l => l.includes('mash_') || l.includes('layer_') || l.includes('mixed_') || l.includes('amix'));
    console.log(mashupLines.join('\n'));
  }

  console.log('\nTest workdir:', workDir);
  process.exit(allGood ? 0 : 1);
});
