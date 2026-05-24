import React from 'react';
import { AlertTriangle, GitBranch, Layers, Music2, Target, Waves } from 'lucide-react';
import type { MedleyDesignPayload, SectionScore, TransitionScore } from '../engine/medleyIntelligence';

function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}

function scoreColor(value: number) {
  if (value >= 0.75) return 'text-emerald-300';
  if (value >= 0.5) return 'text-[#00F0FF]';
  if (value >= 0.3) return 'text-amber-300';
  return 'text-red-300';
}

function ScorePill({ label, value }: { label: string; value: number }) {
  return (
    <span className={`text-[9px] font-mono px-2 py-1 rounded border border-[#222] bg-[#0A0A0A] ${scoreColor(value)}`}>
      {label}: {pct(value)}
    </span>
  );
}

const TopSection: React.FC<{ score: SectionScore }> = ({ score }) => {
  return (
    <div className="border border-[#1E1E1E] bg-[#0D0D0D] rounded-md p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-mono text-[#AAA] truncate">{score.sectionId}</div>
        <span className="text-[9px] text-[#555]">conf {pct(score.confidence)}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <ScorePill label="Hook" value={score.scores.hookStrength} />
        <ScorePill label="Entry" value={score.scores.entryQuality} />
        <ScorePill label="Exit" value={score.scores.exitQuality} />
        <ScorePill label="Finale" value={score.scores.finalePotential} />
        <ScorePill label="Beat" value={score.scores.beatAlignment ?? 0} />
      </div>
      {score.warnings.length > 0 && (
        <div className="mt-2 text-[9px] text-amber-300/80 truncate" title={score.warnings.join(', ')}>
          {score.warnings.slice(0, 2).join(', ')}
        </div>
      )}
    </div>
  );
};

const TopTransition: React.FC<{ transition: TransitionScore }> = ({ transition }) => {
  return (
    <div className="border border-[#1E1E1E] bg-[#0D0D0D] rounded-md p-2">
      <div className="text-[10px] font-mono text-[#AAA]">
        {transition.fromTrackId} → {transition.toTrackId}
      </div>
      <div className="mt-1 text-[9px] text-[#666]">
        {transition.transitionType.replace(/_/g, ' ')} • {transition.fromExitSec.toFixed(1)}s → {transition.toEntrySec.toFixed(1)}s
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <ScorePill label="Score" value={transition.score} />
        <ScorePill label="Risk" value={transition.scores.riskLevel} />
        <ScorePill label="Beat" value={transition.scores.beatAlignment ?? 0} />
        <ScorePill label="Key" value={transition.scores.harmonicCompatibility ?? 0} />
      </div>
    </div>
  );
};

export default function MedleyMatchPanel({ design }: { design: MedleyDesignPayload }) {
  const topSections = [...design.sectionScores]
    .sort((a, b) => b.scores.hookStrength - a.scores.hookStrength)
    .slice(0, 4);
  const topTransitions = design.transitionMatrixSummary.slice(0, 4);
  const topStrategies = design.recommendedStrategies.slice(0, 3);
  const advancedTracks = design.tracks.filter(track => track.advancedAnalysisAvailable);

  return (
    <aside className="w-96 border-l border-[#1A1A1A] bg-[#090909] flex flex-col shrink-0">
      <div className="p-5 border-b border-[#1A1A1A]">
        <div className="text-[10px] uppercase tracking-widest text-[#555] mb-3 font-semibold flex items-center gap-2">
          <Layers className="w-3.5 h-3.5" /> Medley Match
        </div>
        <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
          <div className="border border-[#222] bg-[#0A0A0A] rounded-md p-2">
            <div className="text-[#555]">Tracks</div>
            <div className="text-[#00F0FF] text-lg">{design.tracks.length}</div>
          </div>
          <div className="border border-[#222] bg-[#0A0A0A] rounded-md p-2">
            <div className="text-[#555]">Transitions</div>
            <div className="text-[#00F0FF] text-lg">{design.transitionMatrixSummary.length}</div>
          </div>
          <div className="border border-[#222] bg-[#0A0A0A] rounded-md p-2">
            <div className="text-[#555]">Advanced</div>
            <div className="text-[#00F0FF] text-lg">{advancedTracks.length}</div>
          </div>
          <div className="border border-[#222] bg-[#0A0A0A] rounded-md p-2">
            <div className="text-[#555]">Key Est.</div>
            <div className="text-[#00F0FF] text-lg">{design.tracks.filter(track => track.keyEstimate).length}</div>
          </div>
        </div>
        <div className="mt-3 text-[10px] leading-relaxed text-[#777]">
          Facts, heuristic guesses, scoring, and AI reasoning are separated. Hook and emotion labels are proxies unless user notes or allowed clip listening confirm them.
        </div>
      </div>

      <div className="flex-1 p-5 overflow-y-auto custom-scrollbar space-y-5">
        <section>
          <div className="text-[10px] uppercase tracking-widest text-[#555] mb-2 font-semibold flex items-center gap-2">
            <Music2 className="w-3.5 h-3.5" /> Local Music Facts
          </div>
          <div className="space-y-2">
            {design.tracks.slice(0, 5).map(track => (
              <div key={track.trackId} className="border border-[#1E1E1E] bg-[#0D0D0D] rounded-md p-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[10px] font-mono text-[#AAA] truncate">{track.filename}</div>
                  <span className="text-[9px] text-[#555]">conf {pct(track.confidence)}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <ScorePill label="Beat" value={track.beatConfidence ?? track.tempoConfidence} />
                  <ScorePill label="Key" value={track.keyConfidence ?? 0} />
                  <ScorePill label="Bright" value={track.brightnessProxy} />
                  <ScorePill label="Density" value={track.sonicDensityProxy} />
                </div>
                <div className="mt-2 text-[9px] text-[#666]">
                  BPM {track.tempoEstimate ?? 'unknown'} • Key {track.keyEstimate ?? 'unknown'} • Onsets {track.onsetDensityPerMinute ? `${track.onsetDensityPerMinute.toFixed(1)}/min` : 'unknown'}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="text-[10px] uppercase tracking-widest text-[#555] mb-2 font-semibold flex items-center gap-2">
            <Target className="w-3.5 h-3.5" /> Beat-Safe Sections
          </div>
          <div className="space-y-2">
            {topSections.map(score => <TopSection key={score.sectionId} score={score} />)}
          </div>
        </section>

        <section>
          <div className="text-[10px] uppercase tracking-widest text-[#555] mb-2 font-semibold flex items-center gap-2">
            <Waves className="w-3.5 h-3.5" /> Top Transitions
          </div>
          <div className="space-y-2">
            {topTransitions.map(transition => (
              <TopTransition
                key={`${transition.fromTrackId}-${transition.toTrackId}-${transition.transitionType}`}
                transition={transition}
              />
            ))}
          </div>
        </section>

        <section>
          <div className="text-[10px] uppercase tracking-widest text-[#555] mb-2 font-semibold flex items-center gap-2">
            <GitBranch className="w-3.5 h-3.5" /> Ranked Strategies
          </div>
          <div className="space-y-2">
            {topStrategies.map(strategy => (
              <div key={strategy.strategyId} className="border border-[#1E1E1E] bg-[#0D0D0D] rounded-md p-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[10px] font-bold text-[#CCC]">{strategy.title}</div>
                  <span className={`text-[9px] font-mono ${scoreColor(strategy.score)}`}>{pct(strategy.score)}</span>
                </div>
                <div className="mt-1 text-[9px] text-[#666]">
                  {strategy.orderedTracks.map(track => track.trackId).join(' → ')}
                </div>
                {strategy.tradeoffs.length > 0 && (
                  <div className="mt-2 text-[9px] text-[#888]">{strategy.tradeoffs[0]}</div>
                )}
              </div>
            ))}
          </div>
        </section>

        {design.warnings.length > 0 && (
          <section className="border border-amber-500/20 bg-amber-500/5 rounded-md p-3">
            <div className="text-[10px] uppercase tracking-widest text-amber-300 mb-2 font-semibold flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5" /> Warnings
            </div>
            <ul className="space-y-1 text-[9px] text-amber-100/70">
              {design.warnings.slice(0, 5).map(warning => <li key={warning}>{warning.replace(/_/g, ' ')}</li>)}
            </ul>
          </section>
        )}
      </div>
    </aside>
  );
}
