import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Clipboard,
  Download,
  Headphones,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Star,
} from "lucide-react";
import type {
  CandidateReviewItem,
  CandidateReviewProjection,
} from "../server/candidateReviewProjection";

const SIGNAL_BARS = [
  18, 34, 26, 48, 30, 58, 42, 72, 36, 62, 45, 82, 56, 68, 40, 74, 52, 88,
  60, 76, 44, 66, 38, 78, 54, 84, 48, 70, 34, 64, 42, 58, 30, 50, 24, 40,
];

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

function CandidateTab({
  candidate,
  active,
  onSelect,
  onKeyDown,
}: {
  key?: string;
  candidate: CandidateReviewItem;
  active: boolean;
  onSelect: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      id={`candidate-tab-${candidate.candidateId}`}
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls="candidate-listening-panel"
      tabIndex={active ? 0 : -1}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className={`group relative min-h-[72px] flex-1 overflow-hidden border px-4 py-3 text-left transition-all duration-200 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#52E7F2] focus-visible:ring-offset-2 focus-visible:ring-offset-[#06090B] sm:min-w-[190px] sm:px-5 ${
        active
          ? "border-[#52E7F2]/70 bg-[#0C2025] text-white"
          : "border-white/10 bg-[#0A0E11] text-[#9DA8AC] hover:border-white/25 hover:bg-[#10161A]"
      }`}
    >
      {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-[#52E7F2]" />}
      <span className="flex items-center justify-between gap-3">
        <span>
          <span className="block text-base font-semibold tracking-tight">
            Draft {candidate.draftNumber}
          </span>
          <span className="mt-1 block text-xs text-[#7F8A8E]">
            {formatDuration(candidate.durationSec)}
          </span>
        </span>
        {candidate.finalized ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/30 bg-emerald-300/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-200">
            <Check className="h-3 w-3" /> Final
          </span>
        ) : candidate.recommended ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-[#F7B955]/40 bg-[#F7B955]/10 px-2.5 py-1 text-[10px] font-semibold text-[#FFD182]">
            <Star className="h-3 w-3 fill-current" /> Recommended
          </span>
        ) : null}
      </span>
      {!candidate.audioIntegrityVerified && (
        <span className="mt-2 block text-xs text-red-300">Audio unavailable</span>
      )}
    </button>
  );
}

function CopyPathButton({ path, label = "Copy path" }: { path: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button
      type="button"
      onClick={copyPath}
      className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/15 px-3 text-xs font-medium text-[#B9C1C4] transition hover:border-white/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#52E7F2]"
    >
      {copied ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
      {copied ? "Copied" : label}
    </button>
  );
}

function TechnicalDetails({ candidate }: { candidate: CandidateReviewItem }) {
  const notices = [...candidate.technicalIssues, ...candidate.warnings];
  return (
    <details className="group border-t border-white/10">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-[#AAB3B6] transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#52E7F2] [&::-webkit-details-marker]:hidden">
        <span>Technical details</span>
        <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-4 pb-5 text-xs text-[#889397]">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <div className="text-[#616D72]">File size</div>
            <div className="mt-1 text-[#C8D0D2]">{formatBytes(candidate.sizeBytes)}</div>
          </div>
          <div>
            <div className="text-[#616D72]">Created</div>
            <div className="mt-1 text-[#C8D0D2]">{new Date(candidate.createdAt).toLocaleString()}</div>
          </div>
          <div>
            <div className="text-[#616D72]">Review service</div>
            <div className="mt-1 break-words text-[#C8D0D2]">
              {candidate.reviewModel ? `OpenRouter · ${candidate.reviewModel}` : "Not reviewed"}
            </div>
          </div>
        </div>
        {notices.length > 0 && (
          <div>
            <div className="text-[#616D72]">Notices</div>
            <ul className="mt-2 space-y-1 text-[#C8D0D2]">
              {notices.map((notice) => <li key={notice}>• {notice}</li>)}
            </ul>
          </div>
        )}
        <div className="rounded-lg border border-white/10 bg-black/25 p-3">
          <div className="break-all font-mono text-[11px] leading-relaxed text-[#727E82]">
            {candidate.outputPath}
          </div>
          <div className="mt-3">
            <CopyPathButton path={candidate.outputPath} />
          </div>
        </div>
      </div>
    </details>
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
  const finalizedCandidate = projection.candidates.find((candidate) => candidate.finalized);
  const recommendedCandidate = projection.candidates.find(
    (candidate) => candidate.recommended && candidate.audioIntegrityVerified,
  );
  const selectedCandidate = projection.candidates.find(
    (candidate) => candidate.candidateId === projection.selectedCandidateId,
  );
  const firstPlayableCandidate = projection.candidates.find(
    (candidate) => candidate.audioIntegrityVerified,
  );
  const preferredCandidateId = (
    finalizedCandidate ??
    recommendedCandidate ??
    (selectedCandidate?.audioIntegrityVerified ? selectedCandidate : null) ??
    firstPlayableCandidate ??
    projection.candidates[0]
  )?.candidateId ?? null;
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(
    preferredCandidateId,
  );

  useEffect(() => {
    if (!projection.candidates.some((candidate) => candidate.candidateId === activeCandidateId)) {
      setActiveCandidateId(preferredCandidateId);
    }
  }, [activeCandidateId, preferredCandidateId, projection.candidates]);

  const activeCandidate = useMemo(
    () => projection.candidates.find((candidate) => candidate.candidateId === activeCandidateId) ?? null,
    [activeCandidateId, projection.candidates],
  );
  const canApprove = Boolean(
    activeCandidate?.actions.includes("approve_candidate") ||
    activeCandidate?.actions.includes("resume_finalization"),
  );
  const isFinalized = Boolean(projection.final?.integrityVerified);
  const heading = isFinalized ? "Your final medley is ready" : "Choose your favorite medley";
  const subheading = isFinalized
    ? "Your chosen version passed every check and is ready to play or download."
    : projection.candidateCount > 1
      ? "Listen, compare, then make one final."
      : "Listen to your draft, then decide whether to keep it.";

  return (
    <section
      aria-labelledby="candidate-review-title"
      className="relative h-full overflow-y-auto bg-[#06090B] text-[#EEF3F4] custom-scrollbar"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] opacity-70"
        style={{
          background:
            "radial-gradient(circle at 50% -15%, rgba(30, 151, 166, 0.18), transparent 55%), linear-gradient(180deg, rgba(9, 19, 23, 0.75), transparent)",
        }}
      />

      <div className="relative mx-auto w-full max-w-7xl px-4 pb-16 pt-8 sm:px-6 md:pt-12 lg:px-10">
        <header className="mx-auto max-w-4xl text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#52E7F2]/20 bg-[#52E7F2]/[0.06] px-3 py-1.5 text-xs font-medium text-[#8DEBF1]">
            <Headphones className="h-3.5 w-3.5" />
            {projection.candidateCount} of {projection.maximumCandidates} draft{projection.candidateCount === 1 ? "" : "s"} ready
          </div>
          <h2
            id="candidate-review-title"
            className="text-balance text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl md:text-5xl"
          >
            {heading}
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-[#98A4A8] sm:text-lg">
            {subheading}
          </p>
          <button
            type="button"
            onClick={onRefresh}
            disabled={busy}
            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-xs font-medium text-[#7F8A8E] transition hover:bg-white/[0.04] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#52E7F2] disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
            Refresh status
          </button>
        </header>

        {error && (
          <div role="alert" className="mx-auto mt-6 flex max-w-4xl gap-3 rounded-xl border border-red-300/25 bg-red-300/[0.07] p-4 text-sm text-red-100">
            <AlertCircle className="h-5 w-5 shrink-0 text-red-300" />
            <span>{error}</span>
          </div>
        )}

        {isFinalized && projection.final && (
          <section aria-labelledby="verified-final-title" className="mx-auto mt-8 max-w-5xl overflow-hidden rounded-2xl border border-emerald-300/25 bg-[#0A1513] shadow-2xl shadow-black/30">
            <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-300 text-[#07120F]">
                <Check className="h-6 w-6" strokeWidth={2.5} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 id="verified-final-title" className="text-lg font-semibold text-white">Final MP3</h3>
                <p className="mt-1 text-sm text-[#90A19D]">
                  Finalized {projection.final.finalizedAt ? new Date(projection.final.finalizedAt).toLocaleString() : "successfully"}. The file matches your chosen draft exactly.
                </p>
                <audio controls preload="metadata" src={projection.final.audioUrl} className="mt-4 h-11 w-full [color-scheme:dark]" aria-label="Play verified final medley" />
              </div>
              <a
                href={projection.final.downloadUrl}
                className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-300 px-5 text-sm font-semibold text-[#07120F] transition hover:bg-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A1513]"
              >
                <Download className="h-4 w-4" /> Download final MP3
              </a>
            </div>
            <details className="group border-t border-white/10 px-5 sm:px-6">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between text-sm text-[#83908D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-300 [&::-webkit-details-marker]:hidden">
                <span>Final file details</span>
                <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
              </summary>
              <div className="pb-5">
                <div className="break-all rounded-lg border border-white/10 bg-black/20 p-3 font-mono text-[11px] leading-relaxed text-[#778481]">
                  {projection.final.outputPath}
                </div>
                <div className="mt-3"><CopyPathButton path={projection.final.outputPath} label="Copy final path" /></div>
              </div>
            </details>
          </section>
        )}

        {projection.candidates.length > 0 ? (
          <div className="mx-auto mt-8 max-w-6xl">
            <div role="tablist" aria-label="Medley drafts" className="flex overflow-x-auto rounded-t-2xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {projection.candidates.map((candidate, index) => (
                <CandidateTab
                  key={candidate.candidateId}
                  candidate={candidate}
                  active={candidate.candidateId === activeCandidateId}
                  onSelect={() => setActiveCandidateId(candidate.candidateId)}
                  onKeyDown={(event) => {
                    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                    event.preventDefault();
                    const lastIndex = projection.candidates.length - 1;
                    const nextIndex = event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? lastIndex
                        : event.key === "ArrowLeft"
                          ? (index - 1 + projection.candidates.length) % projection.candidates.length
                          : (index + 1) % projection.candidates.length;
                    const nextCandidate = projection.candidates[nextIndex];
                    setActiveCandidateId(nextCandidate.candidateId);
                    requestAnimationFrame(() => {
                      document.getElementById(`candidate-tab-${nextCandidate.candidateId}`)?.focus();
                    });
                  }}
                />
              ))}
            </div>

            {activeCandidate && (
              <article
                id="candidate-listening-panel"
                role="tabpanel"
                aria-labelledby={`candidate-tab-${activeCandidate.candidateId}`}
                className="overflow-hidden rounded-b-2xl border border-t-0 border-white/10 bg-[#0A0F12] shadow-[0_30px_80px_rgba(0,0,0,0.35)]"
              >
                <div className="relative overflow-hidden px-5 py-7 sm:px-8 sm:py-9">
                  <div aria-hidden="true" className="absolute inset-0 opacity-25" style={{ background: "linear-gradient(110deg, transparent 10%, rgba(82,231,242,0.13) 52%, rgba(247,185,85,0.08) 75%, transparent 100%)" }} />
                  <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-2xl font-semibold tracking-tight text-white">Draft {activeCandidate.draftNumber}</h3>
                        {activeCandidate.recommended && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-[#F7B955]/35 bg-[#F7B955]/10 px-2.5 py-1 text-xs font-medium text-[#FFD182]">
                            <Star className="h-3.5 w-3.5 fill-current" /> Recommended
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-sm text-[#7F8A8E]">
                        {formatDuration(activeCandidate.durationSec)} · {activeCandidate.technicallyValid ? "Ready to use" : "Needs attention"}
                      </p>
                    </div>
                    {projection.candidateCount > 1 && (
                      <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-[#7F8A8E]">
                        Switch drafts above to compare from the same player.
                      </div>
                    )}
                  </div>

                  <div aria-hidden="true" className="relative mt-7 flex h-20 items-center gap-1 overflow-hidden rounded-xl border border-white/[0.06] bg-black/20 px-4">
                    {SIGNAL_BARS.map((height, index) => (
                      <span
                        key={`${activeCandidate.candidateId}-${index}`}
                        className={`min-w-[2px] flex-1 rounded-full ${index > 23 ? "bg-[#F7B955]/55" : "bg-[#52E7F2]/65"}`}
                        style={{ height: `${height}%` }}
                      />
                    ))}
                  </div>

                  {activeCandidate.audioIntegrityVerified ? (
                    <audio
                      key={activeCandidate.audioUrl}
                      controls
                      preload="metadata"
                      src={activeCandidate.audioUrl}
                      className="relative mt-5 h-12 w-full [color-scheme:dark]"
                      aria-label={`Play Draft ${activeCandidate.draftNumber}`}
                    />
                  ) : (
                    <div role="alert" className="relative mt-5 flex gap-3 rounded-xl border border-red-300/25 bg-red-300/[0.07] p-4 text-sm text-red-100">
                      <AlertCircle className="h-5 w-5 shrink-0 text-red-300" />
                      <span>This draft is preserved, but it cannot be played: {activeCandidate.audioProblem}</span>
                    </div>
                  )}
                </div>

                <div className="grid border-t border-white/10 lg:grid-cols-[1.25fr_0.75fr]">
                  <section className="border-b border-white/10 p-5 sm:p-7 lg:border-b-0 lg:border-r">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#65DDE6]">
                      {activeCandidate.recommended ? <Sparkles className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                      {activeCandidate.recommended ? `Why Draft ${activeCandidate.draftNumber} is recommended` : "About this draft"}
                    </div>
                    <p className="mt-3 max-w-2xl text-base leading-7 text-[#D4DBDD]">{activeCandidate.reviewSummary}</p>
                    <div className="mt-5">
                      <div className="text-xs font-medium text-[#778287]">What changed</div>
                      <ul className="mt-2 space-y-2 text-sm leading-6 text-[#AAB4B7]">
                        {activeCandidate.planChanges.map((change) => (
                          <li key={`${change.transitionId}-${change.summary}`} className="flex gap-2">
                            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#52E7F2]" />
                            <span>{change.transitionId === "initial" || change.transitionId === "none" ? "" : `${change.transitionId}: `}{change.summary}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </section>

                  <aside className="p-5 sm:p-7">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#F7B955]">Listen for</div>
                    {activeCandidate.transitionConcerns.length > 0 ? (
                      <ul className="mt-3 space-y-3">
                        {activeCandidate.transitionConcerns.map((concern) => (
                          <li key={concern.transitionId} className="rounded-xl border border-[#F7B955]/15 bg-[#F7B955]/[0.05] p-3 text-sm leading-6 text-[#D9C7A6]">
                            {concern.issue}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="mt-3 space-y-3 text-sm text-[#9BA6A9]">
                        <div className="flex items-center gap-3"><Check className="h-4 w-4 text-emerald-300" /> Song balance</div>
                        <div className="flex items-center gap-3"><Check className="h-4 w-4 text-emerald-300" /> Smooth handoffs</div>
                        <div className="flex items-center gap-3"><Check className="h-4 w-4 text-emerald-300" /> Overall energy</div>
                      </div>
                    )}
                  </aside>
                </div>

                <div className="border-t border-white/10 px-5 sm:px-7">
                  <TechnicalDetails candidate={activeCandidate} />
                </div>
              </article>
            )}

            {activeCandidate && !isFinalized && (
              <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#0A0F12] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white">Draft {activeCandidate.draftNumber} selected</div>
                  <div className="mt-1 text-xs text-[#7F8A8E]">
                    {canApprove
                      ? "This creates the final MP3 from exactly this version."
                      : activeCandidate.technicallyValid
                        ? "This version is preserved, but it is not currently available to finalize."
                        : "This version cannot be finalized because it did not pass the audio checks."}
                  </div>
                </div>
                {canApprove && (
                  <button
                    type="button"
                    disabled={busy || !activeCandidate.technicallyValid || !activeCandidate.audioIntegrityVerified}
                    onClick={() => onApprove(activeCandidate.candidateId)}
                    className="inline-flex min-h-14 shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#29C8D5] to-[#63EAF2] px-6 text-sm font-bold text-[#031012] shadow-[0_12px_32px_rgba(41,200,213,0.18)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8DF3F8] focus-visible:ring-offset-2 focus-visible:ring-offset-[#06090B] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <Star className="h-4 w-4 fill-current" />
                    {activeCandidate.actions.includes("resume_finalization")
                      ? "Resume Final Creation"
                      : `Use Draft ${activeCandidate.draftNumber} as Final`}
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div role="status" className="mx-auto mt-8 max-w-3xl rounded-2xl border border-white/10 bg-[#0A0F12] p-8 text-center">
            <AlertCircle className="mx-auto h-7 w-7 text-[#F7B955]" />
            <h3 className="mt-4 text-lg font-semibold text-white">No draft is ready yet</h3>
            <p className="mt-2 text-sm leading-6 text-[#8D989C]">Nothing has been rendered, so there is currently nothing to play or finalize.</p>
          </div>
        )}
      </div>
    </section>
  );
}
