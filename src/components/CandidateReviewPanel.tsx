import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Clipboard, RefreshCw, ShieldCheck, Volume2 } from "lucide-react";
import type {
  CandidateReviewItem,
  CandidateReviewProjection,
} from "../server/candidateReviewProjection";

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

function CandidateCard({
  candidate,
  active,
  busy,
  onListen,
  onApprove,
}: {
  key?: string;
  candidate: CandidateReviewItem;
  active: boolean;
  busy: boolean;
  onListen: () => void;
  onApprove: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(candidate.outputPath);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <article
      aria-label={`Draft ${candidate.draftNumber}`}
      className={`rounded-xl border p-4 min-w-0 ${active ? "border-[#00F0FF]/70 bg-[#00F0FF]/[0.05]" : "border-white/10 bg-black/20"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-white">Draft {candidate.draftNumber}</h3>
          <div className="mt-1 text-[10px] font-mono text-[#777]">
            {formatDuration(candidate.durationSec)} · {formatBytes(candidate.sizeBytes)} · {new Date(candidate.createdAt).toLocaleString()}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          {candidate.recommended && (
            <span className="rounded-full border border-[#00F0FF]/40 px-2 py-1 text-[9px] font-bold uppercase text-[#00F0FF]">Recommended</span>
          )}
          {candidate.finalized && (
            <span className="rounded-full border border-emerald-400/40 px-2 py-1 text-[9px] font-bold uppercase text-emerald-300">Final MP3</span>
          )}
          <span className={`rounded-full border px-2 py-1 text-[9px] font-bold uppercase ${candidate.technicallyValid ? "border-emerald-400/40 text-emerald-300" : "border-red-400/40 text-red-300"}`}>
            {candidate.technicallyValid ? "Technically valid" : "Cannot finalize"}
          </span>
          {!candidate.audioIntegrityVerified && (
            <span className="rounded-full border border-red-400/40 px-2 py-1 text-[9px] font-bold uppercase text-red-300">Audio unavailable</span>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-white/10 bg-black/30 p-3">
        <div className="text-[10px] font-bold uppercase tracking-wider text-[#AAA]">Audio review</div>
        <p className="mt-1 text-xs leading-relaxed text-[#DDD]">{candidate.reviewSummary}</p>
        {candidate.reviewModel && <div className="mt-2 text-[9px] font-mono text-[#666]">Reviewed through OpenRouter · {candidate.reviewModel}</div>}
      </div>

      <div className="mt-3">
        <div className="text-[10px] font-bold uppercase tracking-wider text-[#AAA]">What changed</div>
        <ul className="mt-1 space-y-1 text-[11px] text-[#BBB]">
          {candidate.planChanges.map((change) => (
            <li key={`${change.transitionId}-${change.summary}`}>• {change.transitionId === "initial" ? "" : `${change.transitionId}: `}{change.summary}</li>
          ))}
        </ul>
      </div>

      {candidate.transitionConcerns.length > 0 && (
        <div className="mt-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-300">Transition concerns</div>
          <ul className="mt-1 space-y-2 text-[11px] text-amber-100/80">
            {candidate.transitionConcerns.map((concern) => (
              <li key={concern.transitionId}>
                <strong>{concern.transitionId}:</strong> {concern.issue} {concern.requestedChange && `— ${concern.requestedChange}`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(candidate.technicalIssues.length > 0 || candidate.warnings.length > 0) && (
        <details className="mt-3 text-[10px] text-[#999]">
          <summary className="cursor-pointer min-h-11 flex items-center">Technical details and warnings</summary>
          <ul className="space-y-1 pb-2">
            {[...candidate.technicalIssues, ...candidate.warnings].map((warning) => <li key={warning}>• {warning}</li>)}
          </ul>
        </details>
      )}

      {candidate.audioProblem && (
        <div role="alert" className="mt-3 rounded border border-red-400/30 bg-red-400/10 p-3 text-[11px] text-red-200">
          This draft is still recorded, but it cannot be played: {candidate.audioProblem}
        </div>
      )}

      <div className="mt-3 rounded border border-white/10 bg-black/30 p-2">
        <div className="truncate text-[9px] font-mono text-[#777]" title={candidate.outputPath}>{candidate.outputPath}</div>
        <button type="button" onClick={copyPath} className="mt-2 min-h-11 inline-flex items-center gap-2 rounded border border-white/15 px-3 text-[10px] font-bold uppercase text-[#BBB] hover:border-white/30 hover:text-white">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}{copied ? "Copied" : "Copy path"}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={!candidate.audioIntegrityVerified} onClick={onListen} className="min-h-11 inline-flex items-center gap-2 rounded-lg border border-[#00F0FF]/40 px-4 text-[10px] font-bold uppercase text-[#00F0FF] hover:bg-[#00F0FF]/10 disabled:cursor-not-allowed disabled:opacity-40">
          <Volume2 className="h-4 w-4" /> {active ? "Playing below" : "Listen to this draft"}
        </button>
        {(candidate.actions.includes("approve_candidate") || candidate.actions.includes("resume_finalization")) && (
          <button type="button" disabled={busy || !candidate.technicallyValid} onClick={onApprove} className="min-h-11 inline-flex items-center gap-2 rounded-lg bg-emerald-400 px-4 text-[10px] font-bold uppercase text-black disabled:cursor-not-allowed disabled:opacity-50">
            <ShieldCheck className="h-4 w-4" /> {candidate.actions.includes("resume_finalization") ? "Resume final creation" : "Make this the final MP3"}
          </button>
        )}
      </div>
    </article>
  );
}

export default function CandidateReviewPanel({
  projection,
  busy,
  error,
  onRefresh,
  onApprove,
}: {
  projection: CandidateReviewProjection;
  busy: boolean;
  error: string | null;
  onRefresh: () => void;
  onApprove: (candidateId: string) => void;
}) {
  const [finalPathCopied, setFinalPathCopied] = useState(false);
  const firstPlayableCandidateId = projection.candidates.find(
    (candidate) => candidate.audioIntegrityVerified,
  )?.candidateId ?? null;
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(
    projection.candidates.find(
      (candidate) => candidate.candidateId === projection.selectedCandidateId && candidate.audioIntegrityVerified,
    )?.candidateId ?? firstPlayableCandidateId,
  );
  useEffect(() => {
    if (!projection.candidates.some(
      (item) => item.candidateId === activeCandidateId && item.audioIntegrityVerified,
    )) {
      setActiveCandidateId(
        projection.candidates.find(
          (candidate) => candidate.candidateId === projection.selectedCandidateId && candidate.audioIntegrityVerified,
        )?.candidateId ?? firstPlayableCandidateId,
      );
    }
  }, [activeCandidateId, firstPlayableCandidateId, projection.candidates, projection.selectedCandidateId]);
  const activeCandidate = useMemo(
    () => projection.candidates.find((candidate) => candidate.candidateId === activeCandidateId) ?? null,
    [activeCandidateId, projection.candidates],
  );
  return (
    <section aria-labelledby="candidate-review-title" className="h-full overflow-y-auto p-4 md:p-6 custom-scrollbar">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-3 rounded-xl border border-amber-300/25 bg-amber-300/[0.04] p-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">Candidate Review</div>
            <h2 id="candidate-review-title" className="mt-1 text-xl font-bold text-white">{projection.title}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[#BBB]">{projection.message}</p>
            <div className="mt-2 text-[10px] font-mono text-[#777]">{projection.candidateCount}/{projection.maximumCandidates} drafts created · Session {projection.sessionId}</div>
          </div>
          <button type="button" onClick={onRefresh} disabled={busy} className="min-h-11 shrink-0 inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 px-4 text-[10px] font-bold uppercase text-[#CCC] hover:border-white/30 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /> Refresh status
          </button>
        </div>

        {error && <div role="alert" className="mt-4 flex gap-2 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200"><AlertCircle className="h-5 w-5 shrink-0" />{error}</div>}

        {projection.final?.integrityVerified && (
          <section aria-labelledby="verified-final-title" className="mt-4 rounded-xl border border-emerald-400/35 bg-emerald-400/[0.06] p-4">
            <div className="flex items-center gap-2 text-emerald-300">
              <ShieldCheck className="h-5 w-5" />
              <h3 id="verified-final-title" className="text-sm font-bold">Verified final MP3</h3>
            </div>
            <p className="mt-2 text-xs text-[#BBB]">
              Finalized {projection.final.finalizedAt ? new Date(projection.final.finalizedAt).toLocaleString() : "successfully"}. The promoted file matches the chosen draft byte for byte.
            </p>
            <audio controls preload="metadata" src={projection.final.audioUrl} className="mt-3 h-11 w-full" aria-label="Play verified final medley" />
            <div className="mt-3 rounded border border-white/10 bg-black/30 p-2">
              <div className="truncate text-[9px] font-mono text-[#777]" title={projection.final.outputPath}>{projection.final.outputPath}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <a href={projection.final.downloadUrl} className="min-h-11 inline-flex items-center rounded bg-emerald-400 px-4 text-[10px] font-bold uppercase text-black">Download final MP3</a>
                <button type="button" onClick={() => {
                  void navigator.clipboard.writeText(projection.final!.outputPath)
                    .then(() => {
                      setFinalPathCopied(true);
                      window.setTimeout(() => setFinalPathCopied(false), 1_500);
                    })
                    .catch(() => setFinalPathCopied(false));
                }} className="min-h-11 inline-flex items-center gap-2 rounded border border-white/15 px-3 text-[10px] font-bold uppercase text-[#BBB]">
                  {finalPathCopied ? <Check className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}{finalPathCopied ? "Copied" : "Copy final path"}
                </button>
              </div>
            </div>
          </section>
        )}

        {activeCandidate?.audioIntegrityVerified && (
          <div className="sticky top-0 z-10 mt-4 rounded-xl border border-[#00F0FF]/30 bg-[#080B0D]/95 p-3 shadow-xl backdrop-blur">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#00F0FF]">Listening to Draft {activeCandidate.draftNumber}</div>
            <audio key={activeCandidate.audioUrl} controls preload="metadata" src={activeCandidate.audioUrl} className="h-11 w-full" aria-label={`Play Draft ${activeCandidate.draftNumber}`} />
          </div>
        )}

        {projection.candidates.length ? (
          <div className={`mt-4 grid gap-4 ${projection.candidates.length > 1 ? "lg:grid-cols-2" : "grid-cols-1"}`}>
            {projection.candidates.map((candidate) => (
              <CandidateCard
                key={candidate.candidateId}
                candidate={candidate}
                active={candidate.candidateId === activeCandidateId}
                busy={busy}
                onListen={() => setActiveCandidateId(candidate.candidateId)}
                onApprove={() => onApprove(candidate.candidateId)}
              />
            ))}
          </div>
        ) : (
          <div role="status" className="mt-4 rounded-xl border border-white/10 bg-black/20 p-6 text-sm text-[#BBB]">
            No rendered draft was found. Nothing can be approved or finalized from this session.
          </div>
        )}
      </div>
    </section>
  );
}
