export type MedleyFactName =
  | 'duration'
  | 'rms_energy'
  | 'peak_level'
  | 'silence_zone'
  | 'onset_density'
  | 'tempo_estimate'
  | 'beat_grid'
  | 'beat_aligned_section'
  | 'key_estimate'
  | 'spectral_centroid'
  | 'spectral_rolloff'
  | 'spectral_flux'
  | 'harmonic_compatibility'
  | 'brightness_proxy'
  | 'sonic_density_proxy'
  | 'dynamic_range_proxy'
  | 'energy_curve';

export type SectionLabel =
  | 'intro_candidate'
  | 'outro_candidate'
  | 'high_energy_section'
  | 'low_energy_reset_section'
  | 'stable_groove_section'
  | 'dynamic_lift_section'
  | 'breakdown_section'
  | 'likely_hook_candidate'
  | 'finale_candidate'
  | 'transition_safe_zone'
  | 'beat_aligned_candidate'
  | 'risky_section'
  | 'uncertain_section';

export interface LocalFact {
  kind: 'local_fact';
  name: MedleyFactName;
  trackId: string;
  startSec?: number;
  endSec?: number;
  value: number | string | boolean | null;
  confidence: number;
  source: 'local_audio_analysis';
  warnings: string[];
}

export interface SectionCandidate {
  sectionId: string;
  trackId: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  labels: SectionLabel[];
  confidence: number;
  factsUsed: MedleyFactName[];
  warnings: string[];
}

export interface HeuristicGuess {
  kind: 'heuristic_guess';
  name:
    | 'likely_hook_candidate'
    | 'strong_entry_candidate'
    | 'strong_exit_candidate'
    | 'high_energy_zone'
    | 'low_energy_reset_zone'
    | 'transition_friendly_zone'
    | 'finale_candidate'
    | 'emotional_arc_proxy_role'
    | 'density_role'
    | 'brightness_role'
    | 'contrast_value';
  trackId: string;
  sectionId?: string;
  score: number;
  confidence: number;
  reason: string;
  factsUsed: MedleyFactName[];
  warnings: string[];
}

export interface SectionScore {
  sectionId: string;
  trackId: string;
  scores: {
    hookStrength: number;
    entryQuality: number;
    exitQuality: number;
    transitionUsability: number;
    tempoCompatibilityPotential: number;
    energyRole: number;
    contrastValue: number;
    resetUsefulness: number;
    buildUsefulness: number;
    finalePotential: number;
    beatAlignment?: number;
    downbeatConfidence?: number;
    harmonicStability?: number;
    spectralContrast?: number;
    grooveContinuity?: number;
    transitionShockRisk?: number;
  };
  confidence: number;
  reason: string;
  factsUsed: MedleyFactName[];
  warnings: string[];
}

export interface TransitionScore {
  fromTrackId: string;
  toTrackId: string;
  fromSectionId: string;
  toSectionId: string;
  fromExitSec: number;
  toEntrySec: number;
  transitionType: 'smooth_blend' | 'hard_cut' | 'energy_lift' | 'energy_drop' | 'reset_moment' | 'build_transition' | 'finale_launch' | 'surprise_contrast';
  score: number;
  confidence: number;
  scores: {
    smoothBlend: number;
    hardCut: number;
    energyLift: number;
    energyDrop: number;
    resetMoment: number;
    buildTransition: number;
    finaleLaunch: number;
    surpriseContrast: number;
    riskLevel: number;
    energyContinuity: number;
    energyContrast: number;
    tempoCompatibility: number;
    brightnessCompatibility: number;
    sonicDensityCompatibility: number;
    sectionBoundaryQuality: number;
    exitStrength: number;
    entryStrength: number;
    harmonicCompatibility?: number;
    beatAlignment?: number;
    grooveContinuity?: number;
    spectralContrast?: number;
    transitionShockRisk?: number;
  };
  reason: string;
  warnings: string[];
}

export interface TrackProfile {
  trackId: string;
  filename: string;
  durationSec: number;
  tempoEstimate: number | null;
  tempoConfidence: number;
  averageEnergy: number;
  peakEnergy: number;
  brightnessProxy: number;
  sonicDensityProxy: number;
  dynamicRangeProxy: number;
  beatConfidence?: number;
  keyEstimate?: string | null;
  keyConfidence?: number;
  spectralCentroidHz?: number;
  spectralRolloffHz?: number;
  onsetDensityPerMinute?: number;
  advancedAnalysisAvailable?: boolean;
  warnings: string[];
  confidence: number;
}

export interface MedleyOrderStrategy {
  strategyId: 'smoothest_order' | 'best_emotional_arc_proxy' | 'highest_intensity' | 'surprise_contrast' | 'live_showcase' | 'shortest_strong_medley';
  title: string;
  score: number;
  confidence: number;
  estimatedDurationSec: number;
  orderedTracks: Array<{
    trackId: string;
    selectedSectionIds: string[];
    entrySec: number;
    exitSec: number;
    role: string;
  }>;
  transitions: TransitionScore[];
  tradeoffs: string[];
  warnings: string[];
}

export interface TrackIntelligence {
  profile: TrackProfile;
  localFacts: LocalFact[];
  sections: SectionCandidate[];
  heuristicGuesses: HeuristicGuess[];
  sectionScores: SectionScore[];
  rankedHookCandidates: SectionScore[];
  rankedEntryCandidates: SectionScore[];
  rankedExitCandidates: SectionScore[];
  rankedResetCandidates: SectionScore[];
  rankedFinaleCandidates: SectionScore[];
  warnings: string[];
}

export interface MedleyDesignPayload {
  schemaVersion: 'medley_design_v1';
  source: 'local_medley_intelligence';
  userConstraints: Record<string, unknown>;
  tracks: TrackProfile[];
  sections: SectionCandidate[];
  localFacts: LocalFact[];
  heuristicGuesses: HeuristicGuess[];
  sectionScores: SectionScore[];

  // Strong transition recommendations between specific sections
  transitionMatrixSummary: TransitionScore[];

  // Full recommended orderings with chosen snippets
  recommendedStrategies: MedleyOrderStrategy[];

  // === NEW: Explicit global recommendations for coherent medley structure ===
  // Best snippets across the *entire library* for starting the whole medley (strong natural openings)
  recommendedGlobalIntros: SectionScore[];
  // Best snippets across the *entire library* for ending the whole medley (satisfying conclusions)
  recommendedGlobalFinales: SectionScore[];

  warnings: string[];
  aiRules: {
    mustUseProvidedTimestamps: true;
    mustDistinguishFactsFromGuesses: true;
    mustNotInventLyrics: true;
    mustNotInventKey: true;
    mustNotInventSongMeaning: true;
  };
}

export interface BasicLocalAnalysis {
  source?: string;
  duration?: number;
  meanVolumeDb?: number | null;
  maxVolumeDb?: number | null;
  estimatedBpm?: number | null;
  energyCurve?: number[];
  candidateSections?: Array<{ start: number; end: number; energy: number }>;
  silence?: Array<{ start?: number; end?: number; duration?: number }>;
  localAnalysisV2?: {
    advancedAnalysisAvailable?: boolean;
    beatGrid?: {
      bpm?: number | null;
      confidence?: number;
      beats?: number[];
      downbeats?: number[];
      warnings?: string[];
    };
    onsets?: {
      times?: number[];
      strongTimes?: number[];
      densityPerMinute?: number;
      confidence?: number;
      warnings?: string[];
    };
    spectral?: {
      centroidHz?: { average?: number; confidence?: number };
      rolloffHz?: { average?: number; confidence?: number };
      flux?: { average?: number; peak?: number; confidence?: number };
      brightness?: { average?: number; confidence?: number };
      density?: { average?: number; confidence?: number };
    };
    tonal?: {
      keyEstimate?: string | null;
      scale?: 'major' | 'minor' | null;
      confidence?: number;
      warnings?: string[];
    };
    segments?: Array<{
      startSec: number;
      endSec: number;
      labels: string[];
      confidence: number;
      reason: string;
      beatAligned: boolean;
      nearestBeatSec: number | null;
      energy: number;
      spectralBrightness: number;
      onsetDensity: number;
      warnings: string[];
    }>;
    quality?: {
      clippingRisk?: number;
      lowSignalRisk?: number;
      warnings?: string[];
    };
  };
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round(value: number, places = 3) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const avg = average(values);
  return Math.sqrt(average(values.map(value => (value - avg) ** 2)));
}

function scoreTempoCompatibility(a: number | null, b: number | null) {
  if (!a || !b) return { score: 0.45, confidence: 0.25, warning: 'tempo_missing_or_low_confidence' };
  const diff = Math.abs(a - b);
  const halfDoubleDiff = Math.min(Math.abs(a * 2 - b), Math.abs(a / 2 - b), Math.abs(b * 2 - a), Math.abs(b / 2 - a));
  const bestDiff = Math.min(diff, halfDoubleDiff);
  return {
    score: clamp01(1 - bestDiff / 35),
    confidence: bestDiff <= 8 ? 0.8 : bestDiff <= 18 ? 0.55 : 0.35,
    warning: bestDiff > 18 ? 'tempo_gap_may_need_manual_transition' : ''
  };
}

function parseKeyEstimate(value?: string | null) {
  if (!value) return null;
  const match = value.match(/^([A-G](?:#|b)?)\s+(major|minor)$/i);
  if (!match) return null;
  const chroma: Record<string, number> = {
    C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6,
    G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11
  };
  return { root: chroma[match[1]], scale: match[2].toLowerCase() as 'major' | 'minor' };
}

function scoreHarmonicCompatibility(a?: TrackProfile, b?: TrackProfile) {
  const first = parseKeyEstimate(a?.keyEstimate);
  const second = parseKeyEstimate(b?.keyEstimate);
  const confidence = Math.min(a?.keyConfidence ?? 0, b?.keyConfidence ?? 0);
  if (!first || !second || confidence < 0.22) {
    return { score: 0.5, confidence, warning: 'key_estimate_missing_or_low_confidence' };
  }
  const semitone = Math.min(Math.abs(first.root - second.root), 12 - Math.abs(first.root - second.root));
  const sameRoot = semitone === 0;
  const fifth = semitone === 5 || semitone === 7;
  const relative = first.scale !== second.scale && semitone === 3;
  const near = semitone <= 2;
  const score = sameRoot ? 0.92 : relative ? 0.82 : fifth ? 0.76 : near ? 0.64 : semitone <= 4 ? 0.48 : 0.32;
  return {
    score,
    confidence,
    warning: score < 0.5 ? 'estimated_keys_may_clash' : ''
  };
}

function normalizeEnergy(value: number) {
  return clamp01(value / 100);
}

function sectionEnergy(curve: number[], section: Pick<SectionCandidate, 'startSec' | 'endSec'>, duration: number) {
  if (!curve.length || duration <= 0) return 0;
  const startIndex = Math.max(0, Math.floor((section.startSec / duration) * curve.length));
  const endIndex = Math.max(startIndex + 1, Math.ceil((section.endSec / duration) * curve.length));
  return normalizeEnergy(average(curve.slice(startIndex, endIndex)));
}

function sectionPeak(curve: number[], section: Pick<SectionCandidate, 'startSec' | 'endSec'>, duration: number) {
  if (!curve.length || duration <= 0) return 0;
  const startIndex = Math.max(0, Math.floor((section.startSec / duration) * curve.length));
  const endIndex = Math.max(startIndex + 1, Math.ceil((section.endSec / duration) * curve.length));
  return normalizeEnergy(Math.max(...curve.slice(startIndex, endIndex), 0));
}

function makeSection(
  trackId: string,
  index: number,
  startSec: number,
  endSec: number,
  labels: SectionLabel[],
  confidence: number,
  factsUsed: MedleyFactName[],
  warnings: string[] = []
): SectionCandidate {
  const safeStart = Math.max(0, startSec);
  const safeEnd = Math.max(safeStart + 0.1, endSec);
  return {
    sectionId: `${trackId}_section_${String(index).padStart(2, '0')}`,
    trackId,
    startSec: round(safeStart, 1),
    endSec: round(safeEnd, 1),
    durationSec: round(safeEnd - safeStart, 1),
    labels,
    confidence: round(clamp01(confidence)),
    factsUsed,
    warnings
  };
}

function dedupeAndMergeSections(sections: SectionCandidate[], minUsefulSec: number) {
  const sorted = [...sections].sort((a, b) => a.startSec - b.startSec || b.durationSec - a.durationSec);
  const merged: SectionCandidate[] = [];

  for (const section of sorted) {
    const previous = merged[merged.length - 1];
    const overlaps = previous && section.startSec <= previous.endSec + 2;
    const tiny = section.durationSec < minUsefulSec && !section.labels.includes('transition_safe_zone');

    if (previous && (overlaps || tiny)) {
      previous.endSec = Math.max(previous.endSec, section.endSec);
      previous.durationSec = round(previous.endSec - previous.startSec, 1);
      previous.labels = Array.from(new Set([...previous.labels, ...section.labels]));
      previous.confidence = round(Math.max(previous.confidence, section.confidence));
      previous.factsUsed = Array.from(new Set([...previous.factsUsed, ...section.factsUsed]));
      previous.warnings = Array.from(new Set([...previous.warnings, ...section.warnings]));
    } else {
      merged.push({ ...section });
    }
  }

  return merged.map((section, index) => ({
    ...section,
    sectionId: `${section.trackId}_section_${String(index + 1).padStart(2, '0')}`
  }));
}

export function buildTrackIntelligence(input: {
  trackId: string;
  filename: string;
  analysis: BasicLocalAnalysis;
}): TrackIntelligence {
  const { trackId, filename, analysis } = input;
  const v2 = analysis.localAnalysisV2;
  const duration = Math.max(0, analysis.duration || 0);
  const curve = (analysis.energyCurve || []).filter(value => Number.isFinite(value));
  const avgEnergy = normalizeEnergy(average(curve));
  const peakEnergy = normalizeEnergy(Math.max(...curve, 0));
  const energySpread = clamp01(standardDeviation(curve) / 35);
  const dynamicRangeProxy = clamp01((analysis.maxVolumeDb ?? -6) - (analysis.meanVolumeDb ?? -24) > 0 ? ((analysis.maxVolumeDb ?? -6) - (analysis.meanVolumeDb ?? -24)) / 30 : energySpread);
  const sonicDensityProxy = v2?.spectral?.density?.average ?? clamp01(avgEnergy * 0.6 + energySpread * 0.4);
  const brightnessProxy = v2?.spectral?.brightness?.average ?? clamp01(0.25 + peakEnergy * 0.35 + energySpread * 0.25);
  const energyDeltaEvents = curve.reduce((count, value, index) => {
    if (index === 0) return count;
    return Math.abs(value - curve[index - 1]) > 0.14 ? count + 1 : count;
  }, 0);
  const onsetDensityProxy = v2?.onsets?.densityPerMinute
    ? clamp01(v2.onsets.densityPerMinute / 240)
    : clamp01(
    ((analysis.candidateSections?.length || 0) * 0.12) +
    (duration ? (energyDeltaEvents / Math.max(1, duration / 60)) * 0.08 : 0)
  );
  const warnings: string[] = [];

  if (!duration) warnings.push('duration_unknown');
  if (!analysis.estimatedBpm) warnings.push('tempo_estimate_missing_or_uncertain');
  if (v2?.tonal?.keyEstimate) warnings.push('key_is_estimated_locally_not_confirmed');
  else warnings.push('key_not_detected_locally');
  warnings.push('lyrics_not_available_unless_user_provides_them');
  warnings.push('emotional_roles_are_proxies_from_energy_density_and_dynamics');
  for (const warning of [
    ...(v2?.beatGrid?.warnings || []),
    ...(v2?.tonal?.warnings || []),
    ...(v2?.quality?.warnings || [])
  ]) warnings.push(warning);

  const tempoConfidence = v2?.beatGrid?.confidence ?? (analysis.estimatedBpm ? 0.62 : 0.15);
  const profile: TrackProfile = {
    trackId,
    filename,
    durationSec: round(duration, 1),
    tempoEstimate: v2?.beatGrid?.bpm || analysis.estimatedBpm || null,
    tempoConfidence,
    averageEnergy: round(avgEnergy),
    peakEnergy: round(peakEnergy),
    brightnessProxy: round(brightnessProxy),
    sonicDensityProxy: round(sonicDensityProxy),
    dynamicRangeProxy: round(dynamicRangeProxy),
    beatConfidence: round(tempoConfidence),
    keyEstimate: v2?.tonal?.keyEstimate ?? null,
    keyConfidence: round(v2?.tonal?.confidence ?? 0),
    spectralCentroidHz: v2?.spectral?.centroidHz?.average ? round(v2.spectral.centroidHz.average, 1) : undefined,
    spectralRolloffHz: v2?.spectral?.rolloffHz?.average ? round(v2.spectral.rolloffHz.average, 1) : undefined,
    onsetDensityPerMinute: v2?.onsets?.densityPerMinute ? round(v2.onsets.densityPerMinute, 1) : undefined,
    advancedAnalysisAvailable: Boolean(v2?.advancedAnalysisAvailable),
    warnings: Array.from(new Set(warnings)),
    confidence: round(clamp01((duration ? 0.2 : 0) + (curve.length ? 0.22 : 0) + (tempoConfidence * 0.2) + ((analysis.silence?.length || 0) ? 0.1 : 0) + (v2?.advancedAnalysisAvailable ? 0.2 : 0) + (v2?.tonal?.confidence ? v2.tonal.confidence * 0.08 : 0)))
  };

  const localFacts: LocalFact[] = [
    { kind: 'local_fact', name: 'duration', trackId, value: duration || null, confidence: duration ? 0.95 : 0, source: 'local_audio_analysis', warnings: duration ? [] : ['duration_unknown'] },
    { kind: 'local_fact', name: 'rms_energy', trackId, value: round(avgEnergy), confidence: curve.length ? 0.75 : 0, source: 'local_audio_analysis', warnings: [] },
    { kind: 'local_fact', name: 'peak_level', trackId, value: analysis.maxVolumeDb ?? null, confidence: analysis.maxVolumeDb === null || analysis.maxVolumeDb === undefined ? 0 : 0.8, source: 'local_audio_analysis', warnings: [] },
    { kind: 'local_fact', name: 'tempo_estimate', trackId, value: analysis.estimatedBpm || null, confidence: tempoConfidence, source: 'local_audio_analysis', warnings: analysis.estimatedBpm ? [] : ['tempo_estimate_missing_or_uncertain'] },
    { kind: 'local_fact', name: 'beat_grid', trackId, value: v2?.beatGrid?.beats?.length ?? null, confidence: tempoConfidence, source: 'local_audio_analysis', warnings: v2?.beatGrid?.warnings || [] },
    { kind: 'local_fact', name: 'onset_density', trackId, value: v2?.onsets?.densityPerMinute ? round(v2.onsets.densityPerMinute, 1) : round(onsetDensityProxy), confidence: v2?.onsets?.confidence ?? (curve.length ? 0.42 : 0), source: 'local_audio_analysis', warnings: v2?.onsets?.warnings || ['onset_density_is_proxy_from_energy_changes_not_true_onset_detection'] },
    { kind: 'local_fact', name: 'spectral_centroid', trackId, value: v2?.spectral?.centroidHz?.average ? round(v2.spectral.centroidHz.average, 1) : null, confidence: v2?.spectral?.centroidHz?.confidence ?? 0, source: 'local_audio_analysis', warnings: v2 ? [] : ['spectral_centroid_unavailable'] },
    { kind: 'local_fact', name: 'spectral_rolloff', trackId, value: v2?.spectral?.rolloffHz?.average ? round(v2.spectral.rolloffHz.average, 1) : null, confidence: v2?.spectral?.rolloffHz?.confidence ?? 0, source: 'local_audio_analysis', warnings: v2 ? [] : ['spectral_rolloff_unavailable'] },
    { kind: 'local_fact', name: 'spectral_flux', trackId, value: v2?.spectral?.flux?.average ? round(v2.spectral.flux.average) : null, confidence: v2?.spectral?.flux?.confidence ?? 0, source: 'local_audio_analysis', warnings: v2 ? [] : ['spectral_flux_unavailable'] },
    { kind: 'local_fact', name: 'key_estimate', trackId, value: v2?.tonal?.keyEstimate ?? null, confidence: v2?.tonal?.confidence ?? 0, source: 'local_audio_analysis', warnings: v2?.tonal?.warnings || ['key_not_detected_locally'] },
    { kind: 'local_fact', name: 'brightness_proxy', trackId, value: round(brightnessProxy), confidence: v2?.spectral?.brightness?.confidence ?? (curve.length ? 0.45 : 0), source: 'local_audio_analysis', warnings: v2 ? ['brightness_from_local_spectral_descriptors'] : ['brightness_is_proxy_not_true_spectral_centroid'] },
    { kind: 'local_fact', name: 'sonic_density_proxy', trackId, value: round(sonicDensityProxy), confidence: v2?.spectral?.density?.confidence ?? (curve.length ? 0.5 : 0), source: 'local_audio_analysis', warnings: v2 ? ['density_from_onset_flux_rms_descriptors'] : ['density_is_proxy_from_energy_distribution'] },
    { kind: 'local_fact', name: 'dynamic_range_proxy', trackId, value: round(dynamicRangeProxy), confidence: curve.length ? 0.55 : 0, source: 'local_audio_analysis', warnings: ['dynamic_range_is_proxy'] },
  ];

  for (const silence of analysis.silence || []) {
    if (silence.start !== undefined && silence.end !== undefined) {
      localFacts.push({
        kind: 'local_fact',
        name: 'silence_zone',
        trackId,
        startSec: round(silence.start, 1),
        endSec: round(silence.end, 1),
        value: round(silence.duration || Math.max(0, silence.end - silence.start), 1),
        confidence: 0.8,
        source: 'local_audio_analysis',
        warnings: []
      });
    }
  }

  let sectionIndex = 1;
  const rawSections: SectionCandidate[] = [];
  const minUsefulSec = Math.max(8, Math.min(18, duration / 12 || 8));

  if (duration) {
    rawSections.push(makeSection(trackId, sectionIndex++, 0, Math.min(duration, Math.max(12, duration * 0.12)), ['intro_candidate', avgEnergy < 0.45 ? 'transition_safe_zone' : 'stable_groove_section'], 0.65, ['duration', 'energy_curve']));
    rawSections.push(makeSection(trackId, sectionIndex++, Math.max(0, duration - Math.max(12, duration * 0.12)), duration, ['outro_candidate', 'transition_safe_zone'], 0.65, ['duration', 'energy_curve']));
  }

  for (const segment of v2?.segments || []) {
    const labels: SectionLabel[] = [];
    if (segment.labels.includes('intro_candidate')) labels.push('intro_candidate', 'transition_safe_zone');
    if (segment.labels.includes('clean_exit_candidate')) labels.push('outro_candidate', 'transition_safe_zone');
    if (segment.labels.includes('chorus_like_candidate')) labels.push('likely_hook_candidate', 'high_energy_section');
    if (segment.labels.includes('first_strong_entrance')) labels.push('dynamic_lift_section');
    if (segment.labels.includes('breakdown_or_reset_candidate')) labels.push('low_energy_reset_section', 'breakdown_section', 'transition_safe_zone');
    if (segment.labels.includes('pre_finale_build_candidate')) labels.push('dynamic_lift_section');
    if (segment.labels.includes('finale_candidate')) labels.push('finale_candidate', 'high_energy_section');
    if (segment.beatAligned) labels.push('beat_aligned_candidate');
    rawSections.push(makeSection(
      trackId,
      sectionIndex++,
      segment.startSec,
      segment.endSec,
      Array.from(new Set(labels.length ? labels : ['uncertain_section'])),
      segment.confidence,
      ['duration', 'energy_curve', 'beat_grid', 'onset_density', 'spectral_centroid', 'spectral_flux'],
      ['section_label_is_heuristic', ...segment.warnings]
    ));
  }

  for (const candidate of analysis.candidateSections || []) {
    const start = Math.max(0, candidate.start);
    const end = Math.min(duration || candidate.end, Math.max(candidate.end, start + minUsefulSec));
    const energy = normalizeEnergy(candidate.energy);
    const labels: SectionLabel[] = ['high_energy_section'];
    if (energy >= 0.78) labels.push('likely_hook_candidate');
    if (energy >= 0.86 || start > duration * 0.6) labels.push('finale_candidate');
    if (energy > avgEnergy + 0.18) labels.push('dynamic_lift_section');
    rawSections.push(makeSection(trackId, sectionIndex++, start, end, labels, 0.6 + energy * 0.25, ['rms_energy', 'energy_curve', 'onset_density'], ['hook_is_heuristic', 'no_lyrics_available']));
  }

  for (const silence of analysis.silence || []) {
    if (silence.start === undefined || silence.end === undefined || (silence.duration || 0) < 0.4) continue;
    const start = Math.max(0, silence.start - 4);
    const end = Math.min(duration || silence.end + 4, silence.end + 4);
    rawSections.push(makeSection(trackId, sectionIndex++, start, end, ['low_energy_reset_section', 'transition_safe_zone', 'breakdown_section'], 0.72, ['silence_zone', 'energy_curve']));
  }

  if (!rawSections.length && duration) {
    rawSections.push(makeSection(trackId, sectionIndex++, 0, duration, ['uncertain_section'], 0.25, ['duration'], ['insufficient_local_features']));
  }

  const sections = dedupeAndMergeSections(rawSections, minUsefulSec);

  const sectionScores = sections.map(section => {
    const e = sectionEnergy(curve, section, duration);
    const p = sectionPeak(curve, section, duration);
    const boundaryBonus = section.labels.includes('transition_safe_zone') ? 0.2 : 0;
    const beatBonus = section.labels.includes('beat_aligned_candidate') ? 0.14 : 0;
    const introBonus = section.labels.includes('intro_candidate') ? 0.18 : 0;
    const outroBonus = section.labels.includes('outro_candidate') ? 0.18 : 0;
    const hookStrength = clamp01(p * 0.42 + e * 0.28 + (section.labels.includes('likely_hook_candidate') ? 0.14 : 0) + sonicDensityProxy * 0.08 + beatBonus * 0.08);
    const entryQuality = clamp01((1 - Math.abs(e - 0.58)) * 0.38 + introBonus + hookStrength * 0.22 + boundaryBonus + beatBonus);
    const exitQuality = clamp01((1 - e) * 0.22 + outroBonus + boundaryBonus + beatBonus + (section.labels.includes('low_energy_reset_section') ? 0.22 : 0) + section.confidence * 0.15);
    const resetUsefulness = clamp01((section.labels.includes('low_energy_reset_section') ? 0.65 : 0) + (1 - e) * 0.25 + boundaryBonus);
    const finalePotential = clamp01(hookStrength * 0.5 + p * 0.25 + (section.labels.includes('finale_candidate') ? 0.2 : 0) + (section.startSec > duration * 0.55 ? 0.1 : 0));
    const beatAlignment = clamp01((section.labels.includes('beat_aligned_candidate') ? 0.82 : 0.38) + tempoConfidence * 0.18);
    const downbeatConfidence = clamp01((section.labels.includes('beat_aligned_candidate') ? 0.55 : 0.22) + tempoConfidence * 0.35);
    const harmonicStability = clamp01((v2?.tonal?.confidence ?? 0) * 0.8 + (v2?.tonal?.keyEstimate ? 0.15 : 0));
    const spectralContrast = clamp01(Math.abs((v2?.spectral?.brightness?.average ?? brightnessProxy) - avgEnergy) * 0.55 + (v2?.spectral?.flux?.average ?? 0) * 1.8);
    const grooveContinuity = clamp01(tempoConfidence * 0.42 + beatAlignment * 0.36 + (1 - Math.abs(e - avgEnergy)) * 0.22);
    const transitionShockRisk = clamp01((1 - beatAlignment) * 0.3 + Math.abs(e - avgEnergy) * 0.3 + (1 - section.confidence) * 0.25 + (v2?.quality?.clippingRisk ?? 0) * 0.15);
    const scores = {
      hookStrength: round(hookStrength),
      entryQuality: round(entryQuality),
      exitQuality: round(exitQuality),
      transitionUsability: round(clamp01((entryQuality + exitQuality + resetUsefulness) / 3)),
      tempoCompatibilityPotential: analysis.estimatedBpm ? 0.65 : 0.4,
      energyRole: round(e),
      contrastValue: round(Math.abs(e - avgEnergy)),
      resetUsefulness: round(resetUsefulness),
      buildUsefulness: round(clamp01(Math.max(0, e - avgEnergy) + dynamicRangeProxy * 0.25)),
      finalePotential: round(finalePotential),
      beatAlignment: round(beatAlignment),
      downbeatConfidence: round(downbeatConfidence),
      harmonicStability: round(harmonicStability),
      spectralContrast: round(spectralContrast),
      grooveContinuity: round(grooveContinuity),
      transitionShockRisk: round(transitionShockRisk)
    };
    const scoreWarnings = Array.from(new Set([
      ...section.warnings,
      !analysis.estimatedBpm ? 'tempo_confidence_low' : '',
      'scores_are_heuristic_not_musical_facts'
    ].filter(Boolean)));
    return {
      sectionId: section.sectionId,
      trackId,
      scores,
      confidence: round(clamp01((section.confidence + profile.confidence) / 2)),
      reason: `Heuristic score from energy ${round(e)}, peak ${round(p)}, section labels ${section.labels.join(', ')}.`,
      factsUsed: section.factsUsed,
      warnings: scoreWarnings
    };
  });

  const heuristicGuesses: HeuristicGuess[] = sectionScores.flatMap(score => {
    const guesses: HeuristicGuess[] = [];
    const section = sections.find(item => item.sectionId === score.sectionId);
    if (!section) return guesses;
    if (score.scores.hookStrength >= 0.58) guesses.push({ kind: 'heuristic_guess', name: 'likely_hook_candidate', trackId, sectionId: score.sectionId, score: score.scores.hookStrength, confidence: score.confidence, reason: 'High energy/peak section; not confirmed as chorus or true hook.', factsUsed: score.factsUsed, warnings: ['hook_is_heuristic', 'no_lyrics_available'] });
    if (score.scores.entryQuality >= 0.58) guesses.push({ kind: 'heuristic_guess', name: 'strong_entry_candidate', trackId, sectionId: score.sectionId, score: score.scores.entryQuality, confidence: score.confidence, reason: 'Good entry proxy from boundary quality and usable energy.', factsUsed: score.factsUsed, warnings: ['entry_quality_is_heuristic'] });
    if (score.scores.exitQuality >= 0.58) guesses.push({ kind: 'heuristic_guess', name: 'strong_exit_candidate', trackId, sectionId: score.sectionId, score: score.scores.exitQuality, confidence: score.confidence, reason: 'Good exit proxy from outro/reset/low energy boundary.', factsUsed: score.factsUsed, warnings: ['exit_quality_is_heuristic'] });
    if (score.scores.resetUsefulness >= 0.55) guesses.push({ kind: 'heuristic_guess', name: 'low_energy_reset_zone', trackId, sectionId: score.sectionId, score: score.scores.resetUsefulness, confidence: score.confidence, reason: 'Low energy or silence-adjacent section can reset the medley.', factsUsed: score.factsUsed, warnings: [] });
    if (score.scores.finalePotential >= 0.62) guesses.push({ kind: 'heuristic_guess', name: 'finale_candidate', trackId, sectionId: score.sectionId, score: score.scores.finalePotential, confidence: score.confidence, reason: 'High energy or late-track section may work as a finale.', factsUsed: score.factsUsed, warnings: ['finale_role_is_heuristic'] });
    return guesses;
  });

  const sortBy = (key: keyof SectionScore['scores']) => [...sectionScores].sort((a, b) => b.scores[key] - a.scores[key]).slice(0, 5);

  return {
    profile,
    localFacts,
    sections,
    heuristicGuesses,
    sectionScores,
    rankedHookCandidates: sortBy('hookStrength'),
    rankedEntryCandidates: sortBy('entryQuality'),
    rankedExitCandidates: sortBy('exitQuality'),
    rankedResetCandidates: sortBy('resetUsefulness'),
    rankedFinaleCandidates: sortBy('finalePotential'),
    warnings
  };
}

function bestSection(track: TrackIntelligence, key: keyof SectionScore['scores']) {
  return [...track.sectionScores].sort((a, b) => b.scores[key] - a.scores[key])[0] || track.sectionScores[0];
}

function transitionTypeFromScores(scores: TransitionScore['scores']): TransitionScore['transitionType'] {
  const candidates: Array<[TransitionScore['transitionType'], number]> = [
    ['smooth_blend', scores.smoothBlend],
    ['hard_cut', scores.hardCut],
    ['energy_lift', scores.energyLift],
    ['energy_drop', scores.energyDrop],
    ['reset_moment', scores.resetMoment],
    ['build_transition', scores.buildTransition],
    ['finale_launch', scores.finaleLaunch],
    ['surprise_contrast', scores.surpriseContrast]
  ];
  return candidates.sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Computes a full compatibility score between one specific exit section and one specific entry section.
 * This is the key function for rich section-pair evaluation.
 */
function computeSectionPairTransition(
  fromTrack: TrackIntelligence,
  toTrack: TrackIntelligence,
  fromScore: SectionScore,
  toScore: SectionScore
): Omit<TransitionScore, 'fromTrackId' | 'toTrackId'> | null {
  const fromSection = fromTrack.sections.find(s => s.sectionId === fromScore.sectionId);
  const toSection = toTrack.sections.find(s => s.sectionId === toScore.sectionId);
  if (!fromSection || !toSection) return null;

  const energyDiff = toScore.scores.energyRole - fromScore.scores.energyRole;
  const energyContinuity = clamp01(1 - Math.abs(energyDiff));
  const energyContrast = clamp01(Math.abs(energyDiff));
  const tempo = scoreTempoCompatibility(fromTrack.profile.tempoEstimate, toTrack.profile.tempoEstimate);
  const harmonic = scoreHarmonicCompatibility(fromTrack.profile, toTrack.profile);
  const brightnessCompatibility = clamp01(1 - Math.abs(fromTrack.profile.brightnessProxy - toTrack.profile.brightnessProxy));
  const densityCompatibility = clamp01(1 - Math.abs(fromTrack.profile.sonicDensityProxy - toTrack.profile.sonicDensityProxy));
  const beatAlignment = clamp01(((fromScore.scores.beatAlignment ?? 0.35) + (toScore.scores.beatAlignment ?? 0.35) + fromTrack.profile.tempoConfidence + toTrack.profile.tempoConfidence) / 4);
  const grooveContinuity = clamp01(tempo.score * 0.32 + beatAlignment * 0.28 + energyContinuity * 0.2 + densityCompatibility * 0.2);
  const spectralContrast = clamp01(Math.abs(fromTrack.profile.brightnessProxy - toTrack.profile.brightnessProxy) * 0.55 + Math.abs(fromTrack.profile.sonicDensityProxy - toTrack.profile.sonicDensityProxy) * 0.45);
  const sectionBoundaryQuality = clamp01((fromScore.scores.exitQuality + toScore.scores.entryQuality) / 2);

  const smoothBlend = clamp01(energyContinuity * 0.16 + tempo.score * 0.2 + harmonic.score * 0.20 + beatAlignment * 0.18 + brightnessCompatibility * 0.12 + densityCompatibility * 0.06 + sectionBoundaryQuality * 0.08);
  const hardCut = clamp01(sectionBoundaryQuality * 0.36 + energyContrast * 0.22 + beatAlignment * 0.14 + toScore.scores.entryQuality * 0.18 + (fromScore.scores.exitQuality > 0.65 ? 0.1 : 0));
  const energyLift = clamp01(Math.max(0, energyDiff) * 0.55 + toScore.scores.buildUsefulness * 0.25 + toScore.scores.entryQuality * 0.2);
  const energyDrop = clamp01(Math.max(0, -energyDiff) * 0.55 + toScore.scores.resetUsefulness * 0.3 + sectionBoundaryQuality * 0.15);
  const resetMoment = clamp01(fromScore.scores.resetUsefulness * 0.45 + toScore.scores.entryQuality * 0.3 + energyContrast * 0.15 + sectionBoundaryQuality * 0.1);
  const buildTransition = clamp01(energyLift * 0.55 + toScore.scores.hookStrength * 0.25 + tempo.score * 0.2);
  const finaleLaunch = clamp01(toScore.scores.finalePotential * 0.55 + energyLift * 0.25 + hardCut * 0.2);
  const surpriseContrast = clamp01(energyContrast * 0.28 + spectralContrast * 0.24 + hardCut * 0.24 + toScore.scores.hookStrength * 0.18 + (1 - harmonic.score) * 0.06);
  const transitionShockRisk = clamp01((1 - beatAlignment) * 0.24 + (1 - harmonic.score) * 0.18 + energyContrast * 0.24 + (fromScore.scores.transitionShockRisk ?? 0.3) * 0.14 + (toScore.scores.transitionShockRisk ?? 0.3) * 0.14 + (tempo.warning || harmonic.warning ? 0.06 : 0));
  const riskLevel = clamp01((1 - tempo.score) * 0.18 + (1 - harmonic.score) * 0.16 + (1 - sectionBoundaryQuality) * 0.27 + energyContrast * 0.18 + transitionShockRisk * 0.18 + (tempo.warning ? 0.03 : 0));

  const scores = {
    smoothBlend: round(smoothBlend),
    hardCut: round(hardCut),
    energyLift: round(energyLift),
    energyDrop: round(energyDrop),
    resetMoment: round(resetMoment),
    buildTransition: round(buildTransition),
    finaleLaunch: round(finaleLaunch),
    surpriseContrast: round(surpriseContrast),
    riskLevel: round(riskLevel),
    energyContinuity: round(energyContinuity),
    energyContrast: round(energyContrast),
    tempoCompatibility: round(tempo.score),
    brightnessCompatibility: round(brightnessCompatibility),
    sonicDensityCompatibility: round(densityCompatibility),
    sectionBoundaryQuality: round(sectionBoundaryQuality),
    exitStrength: fromScore.scores.exitQuality,
    entryStrength: toScore.scores.entryQuality,
    harmonicCompatibility: round(harmonic.score),
    beatAlignment: round(beatAlignment),
    grooveContinuity: round(grooveContinuity),
    spectralContrast: round(spectralContrast),
    transitionShockRisk: round(transitionShockRisk)
  };

  const transitionType = transitionTypeFromScores(scores);
  const overallScore = round(Math.max(smoothBlend, hardCut, energyLift, energyDrop, resetMoment, buildTransition, finaleLaunch, surpriseContrast) * (1 - riskLevel * 0.35));

  return {
    fromSectionId: fromSection.sectionId,
    toSectionId: toSection.sectionId,
    fromExitSec: fromSection.endSec,
    toEntrySec: toSection.startSec,
    transitionType,
    score: overallScore,
    confidence: round(clamp01((fromScore.confidence + toScore.confidence + tempo.confidence + harmonic.confidence + beatAlignment) / 5)),
    scores,
    reason: `${transitionType.replace(/_/g, ' ')} (exit ${fromScore.scores.exitQuality} → entry ${toScore.scores.entryQuality}) | tempo ${scores.tempoCompatibility}, beat ${scores.beatAlignment ?? 0}, harm ${scores.harmonicCompatibility ?? 0}`,
    warnings: [tempo.warning, harmonic.warning, riskLevel > 0.6 ? 'transition_risk_high' : '', 'section_pair_heuristic'].filter(Boolean)
  };
}

export function buildTransitionMatrix(tracks: TrackIntelligence[]): TransitionScore[] {
  const matrix: TransitionScore[] = [];
  const MAX_PAIRS_PER_TRACK_COMBO = 8;

  for (const from of tracks) {
    for (const to of tracks) {
      if (from.profile.trackId === to.profile.trackId) continue;

      // Get the top exit candidates from the "from" track and top entry candidates from the "to" track
      const exitCands = from.rankedExitCandidates.slice(0, 5);
      const entryCands = to.rankedEntryCandidates.slice(0, 5);

      const pairResults: Array<{ ts: TransitionScore; rawScore: number }> = [];

      for (const fromScore of exitCands) {
        for (const toScore of entryCands) {
          const pairData = computeSectionPairTransition(from, to, fromScore, toScore);
          if (pairData) {
            const ts: TransitionScore = {
              fromTrackId: from.profile.trackId,
              toTrackId: to.profile.trackId,
              ...pairData
            };
            pairResults.push({ ts, rawScore: pairData.score });
          }
        }
      }

      // Keep the best combinations for this specific track pair
      const bestForThisPair = pairResults
        .sort((a, b) => b.rawScore - a.rawScore)
        .slice(0, MAX_PAIRS_PER_TRACK_COMBO)
        .map(p => p.ts);

      matrix.push(...bestForThisPair);
    }
  }

  // Return the globally strongest section-pair transitions first
  return matrix.sort((a, b) => b.score - a.score);
}

function greedyOrder(tracks: TrackIntelligence[], matrix: TransitionScore[], seed: TrackIntelligence, strategy: 'smooth' | 'lift' | 'contrast') {
  const remaining = new Set(tracks.map(track => track.profile.trackId));
  const order = [seed.profile.trackId];
  remaining.delete(seed.profile.trackId);

  while (remaining.size) {
    const current = order[order.length - 1];
    const candidates = matrix.filter(item => item.fromTrackId === current && remaining.has(item.toTrackId));
    const sorted = candidates.sort((a, b) => {
      const aScore = strategy === 'smooth' ? a.scores.smoothBlend : strategy === 'lift' ? a.scores.energyLift + a.scores.buildTransition : a.scores.surpriseContrast;
      const bScore = strategy === 'smooth' ? b.scores.smoothBlend : strategy === 'lift' ? b.scores.energyLift + b.scores.buildTransition : b.scores.surpriseContrast;
      return bScore - aScore;
    });
    const next = sorted[0]?.toTrackId || Array.from(remaining)[0];
    order.push(next);
    remaining.delete(next);
  }

  return order;
}

function buildStrategy(
  strategyId: MedleyOrderStrategy['strategyId'],
  title: string,
  orderedIds: string[],
  tracks: TrackIntelligence[],
  matrix: TransitionScore[],
  sectionKey: keyof SectionScore['scores'],
  tradeoffs: string[],
  warnings: string[]
): MedleyOrderStrategy {
  const byId = new Map(tracks.map(track => [track.profile.trackId, track]));

  // Use specific section pairs from the transition matrix when available
  const orderedTracks = orderedIds.map((trackId, index) => {
    const track = byId.get(trackId)!;
    const role = index === 0 ? 'opening' : index === orderedIds.length - 1 ? 'finale' : 'build';

    const prevId = orderedIds[index - 1];
    const nextId = orderedIds[index + 1];

    const bestInbound = prevId
      ? matrix.filter(m => m.fromTrackId === prevId && m.toTrackId === trackId)
              .sort((a, b) => b.score - a.score)[0]
      : undefined;

    const bestOutbound = nextId
      ? matrix.filter(m => m.fromTrackId === trackId && m.toTrackId === nextId)
              .sort((a, b) => b.score - a.score)[0]
      : undefined;

    const entrySec = bestInbound?.toEntrySec
      ?? track.sections.find(s => s.sectionId === (bestSection(track, 'entryQuality') || bestSection(track, sectionKey))?.sectionId)?.startSec
      ?? 0;

    const exitSec = bestOutbound?.fromExitSec
      ?? track.sections.find(s => s.sectionId === (bestSection(track, 'exitQuality') || bestSection(track, sectionKey))?.sectionId)?.endSec
      ?? Math.min(track.profile.durationSec, 45);

    const selectedSectionIds = Array.from(new Set([
      bestInbound?.toSectionId,
      bestOutbound?.fromSectionId
    ].filter(Boolean))) as string[];

    if (!selectedSectionIds.length) {
      const fallback = bestSection(track, sectionKey) || bestSection(track, 'hookStrength');
      if (fallback) selectedSectionIds.push(fallback.sectionId);
    }

    return { trackId, selectedSectionIds, entrySec, exitSec, role };
  });

  const transitions = orderedIds.slice(0, -1).map((trackId, index) => {
    const nextId = orderedIds[index + 1];
    return matrix
      .filter(item => item.fromTrackId === trackId && item.toTrackId === nextId)
      .sort((a, b) => b.score - a.score)[0];
  }).filter(Boolean) as TransitionScore[];
  const strategyScore = average([
    ...transitions.map(item => item.score),
    ...orderedTracks.map(track => {
      const source = byId.get(track.trackId);
      const section = source?.sectionScores.find(item => item.sectionId === track.selectedSectionIds[0]);
      return section?.scores[sectionKey] ?? source?.profile.confidence ?? 0.4;
    })
  ]);

  return {
    strategyId,
    title,
    score: round(strategyScore),
    confidence: round(average([...transitions.map(item => item.confidence), ...tracks.map(track => track.profile.confidence)])),
    estimatedDurationSec: round(orderedTracks.reduce((sum, item) => sum + Math.max(0, item.exitSec - item.entrySec), 0)),
    orderedTracks,
    transitions,
    tradeoffs,
    warnings
  };
}

export function buildOrderStrategies(tracks: TrackIntelligence[], matrix: TransitionScore[]): MedleyOrderStrategy[] {
  if (!tracks.length) return [];
  const byEnergy = [...tracks].sort((a, b) => a.profile.averageEnergy - b.profile.averageEnergy);
  const byHook = [...tracks].sort((a, b) => (bestSection(b, 'hookStrength')?.scores.hookStrength ?? 0) - (bestSection(a, 'hookStrength')?.scores.hookStrength ?? 0));
  const lowSeed = byEnergy[0];
  const highSeed = byHook[0] || tracks[0];

  const smoothOrder = greedyOrder(tracks, matrix, lowSeed, 'smooth');
  const liftOrder = greedyOrder(tracks, matrix, lowSeed, 'lift');
  const contrastOrder = greedyOrder(tracks, matrix, highSeed, 'contrast');
  const intensityOrder = [...byHook].map(track => track.profile.trackId);
  const shortestOrder = [...tracks]
    .sort((a, b) => (bestSection(b, 'hookStrength')?.scores.hookStrength ?? 0) - (bestSection(a, 'hookStrength')?.scores.hookStrength ?? 0))
    .slice(0, Math.max(2, Math.min(4, tracks.length)))
    .map(track => track.profile.trackId);

  return [
    buildStrategy('smoothest_order', 'Smoothest Order', smoothOrder, tracks, matrix, 'transitionUsability', ['May sacrifice peak drama for blend quality.'], ['Key is not locally confirmed.']),
    buildStrategy('best_emotional_arc_proxy', 'Best Emotional Arc Proxy', liftOrder, tracks, matrix, 'buildUsefulness', ['Emotional role is inferred from energy, brightness, density, and dynamics only.'], ['Not a lyric or meaning analysis.']),
    buildStrategy('highest_intensity', 'Highest Intensity', intensityOrder, tracks, matrix, 'hookStrength', ['Can feel relentless if every section is loud.'], ['Intensity is based on local energy proxies.']),
    buildStrategy('surprise_contrast', 'Most Surprising Creative Contrast', contrastOrder, tracks, matrix, 'contrastValue', ['More creative risk and less guaranteed smoothness.'], ['Surprise is heuristic.']),
    buildStrategy('live_showcase', 'Best Live Performance Showcase', liftOrder, tracks, matrix, 'finalePotential', ['Optimizes performance arc over technical smoothness.'], ['Vocal intensity is not confirmed unless cloud listening or user notes are provided.']),
    buildStrategy('shortest_strong_medley', 'Shortest Strong Medley', shortestOrder, tracks, matrix, 'hookStrength', ['Leaves out lower-ranked material.'], ['Short strategy prioritizes hook proxies.'])
  ].sort((a, b) => b.score - a.score);
}

export function buildMedleyDesignPayload(input: {
  tracks: TrackIntelligence[];
  userConstraints?: Record<string, unknown>;
  maxTransitions?: number;
}): MedleyDesignPayload {
  const transitionMatrix = buildTransitionMatrix(input.tracks);
  const strategies = buildOrderStrategies(input.tracks, transitionMatrix);
  const warnings = Array.from(new Set([
    ...input.tracks.flatMap(track => track.warnings),
    'local_facts_and_heuristic_guesses_are_separate_layers',
    'do_not_invent_key_lyrics_or_song_meaning'
  ]));

  // === Global Intro & Finale recommendations ===
  // These help the agent deliberately choose strong, natural openings and closings
  // for the *entire medley experience*, not just good sections for their own tracks.

  const allSectionsWithScores = input.tracks.flatMap(track => track.sectionScores);

  // Good medley intro characteristics:
  // - Strong entryQuality or first_strong_entrance / intro_candidate labels
  // - Not too high energy right at the start (unless the style is aggressive)
  // - Good beat alignment / clean beginning
  const introCandidates = allSectionsWithScores
    .map(score => {
      const track = input.tracks.find(t => t.profile.trackId === score.trackId)!;
      const section = track.sections.find(s => s.sectionId === score.sectionId);
      const isExplicitIntro = section?.labels.some(l => ['intro_candidate', 'first_strong_entrance', 'clean_exit_candidate'].includes(l as string)) ?? false;
      const entryBonus = score.scores.entryQuality * 0.45;
      const lowToMidEnergy = (1 - Math.min(score.scores.energyRole, 0.85)) * 0.25; // prefer not starting at 100% intensity
      const beatBonus = (score.scores.beatAlignment ?? 0.5) * 0.2;
      const boundaryBonus = score.scores.exitQuality * 0.1; // clean boundaries help
      const total = clamp01(entryBonus + lowToMidEnergy + beatBonus + boundaryBonus + (isExplicitIntro ? 0.15 : 0));
      return { score, total, isExplicitIntro };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 6)
    .map(item => item.score);

  // Good medley finale characteristics:
  // - High finalePotential or hookStrength in late parts of tracks
  // - Strong energy or satisfying resolution
  const finaleCandidates = allSectionsWithScores
    .map(score => {
      const track = input.tracks.find(t => t.profile.trackId === score.trackId)!;
      const section = track.sections.find(s => s.sectionId === score.sectionId);
      const isExplicitFinale = section?.labels.some(l => ['finale_candidate', 'pre_finale_build_candidate'].includes(l as string)) ?? false;
      const finaleBonus = score.scores.finalePotential * 0.5;
      const hookBonus = score.scores.hookStrength * 0.25;
      const highEnergy = Math.min(score.scores.energyRole, 1.0) * 0.15;
      const buildBonus = score.scores.buildUsefulness * 0.1;
      const total = clamp01(finaleBonus + hookBonus + highEnergy + buildBonus + (isExplicitFinale ? 0.12 : 0));
      return { score, total, isExplicitFinale };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 6)
    .map(item => item.score);

  return {
    schemaVersion: 'medley_design_v1',
    source: 'local_medley_intelligence',
    userConstraints: input.userConstraints || {},
    tracks: input.tracks.map(track => track.profile),
    sections: input.tracks.flatMap(track => track.sections),
    localFacts: input.tracks.flatMap(track => track.localFacts),
    heuristicGuesses: input.tracks.flatMap(track => track.heuristicGuesses),
    sectionScores: input.tracks.flatMap(track => track.sectionScores),
    transitionMatrixSummary: transitionMatrix.slice(0, input.maxTransitions ?? 24),
    recommendedStrategies: strategies,
    recommendedGlobalIntros: introCandidates,
    recommendedGlobalFinales: finaleCandidates,
    warnings,
    aiRules: {
      mustUseProvidedTimestamps: true,
      mustDistinguishFactsFromGuesses: true,
      mustNotInventLyrics: true,
      mustNotInventKey: true,
      mustNotInventSongMeaning: true
    }
  };
}

export function validateAiMedleyPlan(plan: any, payload: MedleyDesignPayload) {
  const sectionIds = new Set(payload.sections.map(section => section.sectionId));
  const warnings: string[] = [];
  const errors: string[] = [];
  const serialized = JSON.stringify(plan || {}).toLowerCase();

  if (/\blyrics?\b/.test(serialized) && !serialized.includes('user-provided') && !serialized.includes('unavailable')) {
    errors.push('AI response appears to claim lyrics without a provided lyric source.');
  }
  if (/\bkey\b/.test(serialized) && !serialized.includes('unknown') && !serialized.includes('not confirmed')) {
    warnings.push('AI response mentions key; verify it is not presented as a local fact.');
  }

  const referencedSectionIds = serialized.match(/[a-z0-9_-]+_section_\d+/gi) || [];
  for (const id of referencedSectionIds) {
    if (!sectionIds.has(id)) errors.push(`AI response referenced unsupported section id: ${id}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Public entry point for evaluating a specific exit section from one track
 * against a specific entry section from another. Returns null if either
 * sectionId is not found in the respective TrackIntelligence.
 */
export function evaluateSectionPair(
  fromTrack: TrackIntelligence,
  toTrack: TrackIntelligence,
  fromSectionId: string,
  toSectionId: string
): TransitionScore | null {
  const fromScore = fromTrack.sectionScores.find(s => s.sectionId === fromSectionId);
  const toScore = toTrack.sectionScores.find(s => s.sectionId === toSectionId);
  if (!fromScore || !toScore) return null;
  const pairData = computeSectionPairTransition(fromTrack, toTrack, fromScore, toScore);
  if (!pairData) return null;
  return {
    fromTrackId: fromTrack.profile.trackId,
    toTrackId: toTrack.profile.trackId,
    ...pairData
  };
}
