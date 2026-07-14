import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { SERVER_MANAGED_API_KEY } from "../constants/provider";

interface ConfigPanelProps {
  config: MedleyConfig;
  onUpdate: (c: MedleyConfig) => void;
  onClose: () => void;
}

export type ProviderId = "gemini" | "openrouter";
export type AudioAnalysisMode = "local" | "clips" | "ask" | "cloud";
export type ModelMode = "automatic" | "manual";

export interface MedleyConfig {
  configVersion: 4;
  modelMode: ModelMode;
  provider: ProviderId;
  model: string;
  geminiApiKey: string;
  openrouterApiKey: string;
  // Automatic v4 always starts with direct Gemini. This is the model used for
  // the first OpenRouter attempt if Gemini cannot accept the request.
  automaticOpenRouterFallbackModel?: string;
  audioAnalysisMode: AudioAnalysisMode;
  style: "dj-set" | "smooth-transitions" | "mashup" | "acoustic" | "custom";
  temperature: number;
  targetDuration: number; // minutes
  crossfadeDuration: number; // seconds
  customInstructions: string;
  manualCapabilityMode: "contained" | "expert";
}

export const DEFAULT_CONFIG: MedleyConfig = {
  configVersion: 4,
  modelMode: "automatic",
  provider: "gemini",
  model: "gemini-3.1-pro-preview",
  geminiApiKey: "",
  openrouterApiKey: "",
  automaticOpenRouterFallbackModel: "google/gemini-2.5-pro",
  audioAnalysisMode: "local",
  style: "smooth-transitions",
  temperature: 0.1,
  targetDuration: 10,
  crossfadeDuration: 5,
  customInstructions: "",
  manualCapabilityMode: "contained",
};

const STYLES = [
  {
    id: "dj-set",
    label: "DJ Set",
    desc: "High-energy with beat matching and tempo sync",
  },
  {
    id: "smooth-transitions",
    label: "Smooth Transitions",
    desc: "Gradual crossfades with key-matched blending",
  },
  {
    id: "mashup",
    label: "Mashup",
    desc: "Layer multiple songs simultaneously",
  },
  {
    id: "acoustic",
    label: "Acoustic Mix",
    desc: "Natural-sounding flow for acoustic/live tracks",
  },
  { id: "custom", label: "Custom", desc: "Describe your own approach" },
] as const;

const PRIMARY_STYLES = STYLES.filter(
  (style) => style.id !== "acoustic" && style.id !== "custom",
);

export const GEMINI_MODELS = [
  {
    id: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro (Preview)",
    desc: "Best automatic arrangement and whole-mix audio review",
  },
  {
    id: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    desc: "Fast targeted audio-review follow-ups",
  },
  {
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    desc: "Fast, cost-effective",
  },
  {
    id: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    desc: "Best quality, slower",
  },
];

export const OPENROUTER_MODELS = [
  // Recommended paid defaults
  {
    id: "google/gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    desc: "Recommended for arrangement planning and quality review",
  },
  {
    id: "google/gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    desc: "Recommended for fast routine work and retries",
  },
  // Automatic specialist team legacy options
  {
    id: "nvidia/nemotron-3-ultra-550b-a55b:free",
    label: "Nemotron 3 Ultra 550B (free)",
    desc: "Arrangement, music theory, and quality review specialist",
  },
  {
    id: "nex-agi/nex-n2-pro:free",
    label: "Nex-N2-Pro (free)",
    desc: "Tool execution, correction, and production specialist",
  },
  // Free high-capability models (recommended for testing)
  {
    id: "nousresearch/hermes-3-llama-3.1-405b:free",
    label: "Hermes 3 405B (free)",
    desc: "Massive 405B — strong reasoning & instruction following",
  },
  {
    id: "qwen/qwen3-coder:free",
    label: "Qwen3 Coder 480B (free)",
    desc: "Very large Qwen — excellent structured output & logic",
  },
  {
    id: "deepseek/deepseek-v4-flash:free",
    label: "DeepSeek V4 Flash (free)",
    desc: "High benchmark performance, 1M context",
  },
  {
    id: "nvidia/nemotron-3-super-120b-a12b:free",
    label: "Nemotron 3 Super 120B (free)",
    desc: "NVIDIA model with massive 1M context",
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct:free",
    label: "Llama 3.3 70B (free)",
    desc: "Efficient 70B that often outperforms larger models",
  },

  // Agentic / Experimental models
  {
    id: "openrouter/owl-alpha",
    label: "Owl Alpha",
    desc: "High-performance model built for agentic workloads & tool use. Strong at complex workflows. (Prompts & completions may be logged by provider to improve the model)",
  },

  // Other paid / higher quality options
  {
    id: "openai/gpt-4o-mini",
    label: "GPT-4o Mini",
    desc: "Low-cost OpenRouter option",
  },
  {
    id: "openai/gpt-4o",
    label: "GPT-4o",
    desc: "General-purpose multimodal model",
  },
] as const;

export function getDefaultModelForProvider(provider: ProviderId) {
  return provider === "gemini"
    ? GEMINI_MODELS[0].id
    : "google/gemini-2.5-pro";
}

const ANALYSIS_MODES = [
  { id: "local", label: "Local Only", desc: "Never upload audio for analysis" },
  {
    id: "clips",
    label: "Smart Clips",
    desc: "Upload only short local excerpts",
  },
  { id: "ask", label: "Ask First", desc: "Confirm before full audio upload" },
  { id: "cloud", label: "Full Audio", desc: "Allow full provider analysis" },
] as const;

export default function ConfigPanel({
  config,
  onUpdate,
  onClose,
}: ConfigPanelProps) {
  const [local, setLocal] = useState(config);
  const [keySaveState, setKeySaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [keySaveError, setKeySaveError] = useState("");
  const [preflightState, setPreflightState] = useState<
    "idle" | "checking" | "available" | "error"
  >("idle");
  const [preflightMessage, setPreflightMessage] = useState("");
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const siblings = overlayRef.current?.parentElement
      ? Array.from(overlayRef.current.parentElement.children).filter(
          (element): element is HTMLElement =>
            element instanceof HTMLElement && element !== overlayRef.current,
        )
      : [];
    const siblingStates = siblings.map((element) => ({
      element,
      inert: element.hasAttribute("inert"),
      ariaHidden: element.getAttribute("aria-hidden"),
    }));
    for (const element of siblings) {
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    }
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "Tab" && dialogRef.current) {
        const candidates = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        );
        const focusable: HTMLElement[] = [];
        candidates.forEach((element) => {
          if (element.offsetParent !== null) focusable.push(element);
        });
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      for (const { element, inert, ariaHidden } of siblingStates) {
        if (!inert) element.removeAttribute("inert");
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
      previouslyFocused?.focus();
    };
  }, [onClose]);

  const update = (partial: Partial<MedleyConfig>) => {
    const next = { ...local, ...partial };
    setLocal(next);
    onUpdate(next);
  };

  const saveOpenRouterKey = async () => {
    const apiKey = local.openrouterApiKey.trim();
    if (!apiKey || apiKey === SERVER_MANAGED_API_KEY) return;
    setKeySaveState("saving");
    setKeySaveError("");
    try {
      const response = await fetch("/api/config/openrouter-key", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not save API key");
      update({ openrouterApiKey: SERVER_MANAGED_API_KEY });
      setKeySaveState("saved");
    } catch (error: any) {
      setKeySaveError(error.message || "Could not save API key");
      setKeySaveState("error");
    }
  };

  const testOpenRouterConnection = async () => {
    setPreflightState("checking");
    setPreflightMessage("");
    try {
      const response = await fetch("/api/provider/openrouter/preflight", {
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Connection check failed");
      setPreflightState("available");
      setPreflightMessage(`Connected to ${data.model} in ${data.latencyMs} ms.`);
    } catch (error: any) {
      setPreflightState("error");
      setPreflightMessage(error.message || "Connection check failed");
    }
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="configuration-title"
        className="bg-[#111] border border-[#333] rounded-2xl w-full max-w-2xl mx-3 shadow-2xl max-h-[calc(100dvh-1rem)] flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-white/10 shrink-0 bg-[#131313]">
          <h2 id="configuration-title" className="text-[15px] font-bold text-white uppercase tracking-wider">
            Configuration
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close configuration"
            className="w-11 h-11 flex items-center justify-center rounded text-[#AAA] hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-4 sm:px-6 py-5">

        {local.modelMode === "manual" ? (
          <div className="mb-5 border border-amber-400/25 bg-amber-400/5 rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-widest text-amber-200 font-semibold">
              Manual configuration is active
            </div>
            <p className="mt-1 text-[10px] text-[#BBB]">
              Switch to the streamlined automatic mix to use the server-managed Gemini models.
            </p>
            <button
              type="button"
              onClick={() =>
                update({
                  modelMode: "automatic",
                  provider: "gemini",
                  model: "gemini-3.1-pro-preview",
                  audioAnalysisMode: "local",
                  manualCapabilityMode: "contained",
                })
              }
              className="mt-3 min-h-11 px-3 rounded-lg border border-[#00F0FF]/35 bg-[#00F0FF]/5 text-[10px] font-mono font-bold uppercase tracking-wider text-[#8BEAF2] hover:text-white hover:border-[#00F0FF]/70 transition-colors"
            >
              Use recommended automatic mix
            </button>
          </div>
        ) : (
          <div className="mb-5 border border-[#222] bg-[#0A0A0A] rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-widest text-[#8BEAF2] font-semibold">
              Automatic mix
            </div>
            <p className="mt-1 text-[10px] text-[#AAA]">
              Direct Gemini Pro plans and reviews the whole mix; Gemini Flash handles targeted follow-up reviews. Rendering stays local.
            </p>
            <p className="mt-2 text-[10px] text-amber-100/80">
              Automatic review sends the rendered candidate to Gemini. If it finds a problem, only the affected transition previews are sent for follow-up; original library tracks stay local.
            </p>
          </div>
        )}

        {local.modelMode === "manual" && (
          <div className="mb-5 border border-[#222] bg-[#0A0A0A] rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-widest text-[#777] font-semibold mb-2">
              Model provider
            </div>
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Model provider">
              {(["gemini", "openrouter"] as const).map((provider) => (
                <button
                  key={provider}
                  type="button"
                  aria-pressed={local.provider === provider}
                  onClick={() => update({ provider, model: getDefaultModelForProvider(provider) })}
                  className={`min-h-11 rounded-lg border px-3 text-left text-[11px] font-semibold transition-colors ${local.provider === provider ? "border-[#00F0FF] bg-[#00F0FF]/5 text-[#8BEAF2]" : "border-[#333] text-[#AAA] hover:border-[#555]"}`}
                >
                  {provider === "gemini" ? "Google Gemini" : "OpenRouter"}
                </button>
              ))}
            </div>
            <label htmlFor="config-model" className="block mt-3 text-[10px] text-[#AAA] mb-1">
              Model
            </label>
            <select
              id="config-model"
              value={local.model}
              onChange={(event) => update({ model: event.target.value })}
              className="w-full min-h-11 bg-[#0A0A0A] border border-[#444] rounded-lg px-3 text-[11px] text-[#CCC] focus:border-[#00F0FF]/50 focus:outline-none"
            >
              {(local.provider === "gemini" ? GEMINI_MODELS : OPENROUTER_MODELS).map((model) => (
                <option key={model.id} value={model.id}>{model.label}</option>
              ))}
            </select>
          </div>
        )}

        <div className="mb-5">
          <label htmlFor="config-api-key" className="block text-[11px] uppercase tracking-widest text-[#999] mb-2 font-semibold">
            {local.modelMode === "automatic" || local.provider === "gemini"
              ? "Gemini API Key"
              : "OpenRouter API Key"}
          </label>
          <input
            id="config-api-key"
            type="password"
            value={
              local.modelMode === "automatic" || local.provider === "gemini"
                ? local.geminiApiKey === SERVER_MANAGED_API_KEY
                  ? ""
                  : local.geminiApiKey
                : local.openrouterApiKey === SERVER_MANAGED_API_KEY
                  ? ""
                  : local.openrouterApiKey
            }
            onChange={(e) =>
              update(
                local.modelMode === "automatic" ||
                  local.provider === "gemini"
                  ? { geminiApiKey: e.target.value }
                  : { openrouterApiKey: e.target.value },
              )
            }
            placeholder={
              local.modelMode === "automatic" || local.provider === "gemini"
                ? "AIza..."
                : "sk-or-v1-..."
            }
            className="w-full min-h-11 bg-[#0A0A0A] border border-[#444] rounded-lg px-3 py-2.5 text-[11px] text-[#CCC] placeholder:text-[#888] focus:border-[#00F0FF]/50 focus:outline-none"
          />
          <div className="mt-1 text-[9px] text-[#555]">
            API keys are kept in memory for this run and are not saved to browser storage.
            {(local.modelMode === "automatic" || local.provider === "gemini"
              ? local.geminiApiKey
              : local.openrouterApiKey) === SERVER_MANAGED_API_KEY
              ? " A server-managed credential is available."
              : ""}
          </div>
          {local.modelMode === "manual" && local.provider === "openrouter" && (
            <>
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={saveOpenRouterKey}
                disabled={
                  keySaveState === "saving" ||
                  !local.openrouterApiKey ||
                  local.openrouterApiKey === SERVER_MANAGED_API_KEY
                }
                className="min-h-11 px-3 rounded-lg border border-[#00F0FF]/35 bg-[#00F0FF]/5 text-[10px] font-mono font-bold uppercase tracking-wider text-[#8BEAF2] hover:text-white hover:border-[#00F0FF]/70 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {keySaveState === "saving" ? "Saving…" : "Save on this computer"}
              </button>
              <button
                type="button"
                onClick={testOpenRouterConnection}
                disabled={
                  preflightState === "checking" ||
                  local.openrouterApiKey !== SERVER_MANAGED_API_KEY
                }
                className="min-h-11 px-3 rounded-lg border border-[#8BEAF2]/35 bg-[#8BEAF2]/5 text-[10px] font-mono font-bold uppercase tracking-wider text-[#8BEAF2] hover:text-white hover:border-[#8BEAF2]/70 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {preflightState === "checking" ? "Checking…" : "Test connection"}
              </button>
              <span
                role="status"
                aria-live="polite"
                className={`text-[10px] ${keySaveState === "error" || preflightState === "error" ? "text-red-300" : "text-emerald-300"}`}
              >
                {keySaveState === "saved"
                  ? "Saved server-side for future sessions."
                  : keySaveError || preflightMessage}
              </span>
            </div>
            {local.openrouterApiKey !== SERVER_MANAGED_API_KEY && (
              <p className="mt-1 text-[9px] text-[#777]">
                Save the key on this computer before running the server-managed connection check.
              </p>
            )}
            </>
          )}
        </div>

        {local.modelMode === "automatic" && (
          <div className="mb-5 border border-[#222] bg-[#0A0A0A] rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-widest text-[#8BEAF2] font-semibold">
              Automatic fallback: OpenRouter
            </div>
            <p className="mt-1 text-[10px] text-[#AAA]">
              Primary decisions use Gemini 3.1 Pro; Gemini 3.5 Flash handles targeted review. If Gemini rejects the arrangement request, this model is tried immediately.
            </p>
            <label htmlFor="automatic-openrouter-fallback-model" className="block mt-3 text-[10px] text-[#AAA] mb-1">
              Fallback model
            </label>
            <select
              id="automatic-openrouter-fallback-model"
              value={local.automaticOpenRouterFallbackModel ?? getDefaultModelForProvider("openrouter")}
              onChange={(event) => update({ automaticOpenRouterFallbackModel: event.target.value })}
              className="w-full min-h-11 bg-[#0A0A0A] border border-[#444] rounded-lg px-3 text-[11px] text-[#CCC] focus:border-[#00F0FF]/50 focus:outline-none"
            >
              {OPENROUTER_MODELS.map((model) => (
                <option key={model.id} value={model.id}>{model.label}</option>
              ))}
            </select>
            <label htmlFor="automatic-openrouter-api-key" className="block mt-3 text-[10px] text-[#AAA] mb-1">
              OpenRouter API Key
            </label>
            <input
              id="automatic-openrouter-api-key"
              type="password"
              value={local.openrouterApiKey === SERVER_MANAGED_API_KEY ? "" : local.openrouterApiKey}
              onChange={(event) => update({ openrouterApiKey: event.target.value })}
              placeholder="sk-or-v1-..."
              className="w-full min-h-11 bg-[#0A0A0A] border border-[#444] rounded-lg px-3 py-2.5 text-[11px] text-[#CCC] placeholder:text-[#888] focus:border-[#00F0FF]/50 focus:outline-none"
            />
            <p className="mt-1 text-[9px] text-[#555]">
              {local.openrouterApiKey === SERVER_MANAGED_API_KEY
                ? "A server-managed OpenRouter credential is available for the fallback."
                : "Add or save an OpenRouter key to enable the automatic fallback."}
            </p>
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={saveOpenRouterKey}
                disabled={
                  keySaveState === "saving" ||
                  !local.openrouterApiKey ||
                  local.openrouterApiKey === SERVER_MANAGED_API_KEY
                }
                className="min-h-11 px-3 rounded-lg border border-[#00F0FF]/35 bg-[#00F0FF]/5 text-[10px] font-mono font-bold uppercase tracking-wider text-[#8BEAF2] hover:text-white hover:border-[#00F0FF]/70 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {keySaveState === "saving" ? "Saving…" : "Save on this computer"}
              </button>
              <button
                type="button"
                onClick={testOpenRouterConnection}
                disabled={
                  preflightState === "checking" ||
                  local.openrouterApiKey !== SERVER_MANAGED_API_KEY
                }
                className="min-h-11 px-3 rounded-lg border border-[#8BEAF2]/35 bg-[#8BEAF2]/5 text-[10px] font-mono font-bold uppercase tracking-wider text-[#8BEAF2] hover:text-white hover:border-[#8BEAF2]/70 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {preflightState === "checking" ? "Checking…" : "Test connection"}
              </button>
              <span
                role="status"
                aria-live="polite"
                className={`text-[10px] ${keySaveState === "error" || preflightState === "error" ? "text-red-300" : "text-emerald-300"}`}
              >
                {keySaveState === "saved"
                  ? "Saved server-side for future sessions."
                  : keySaveError || preflightMessage}
              </span>
            </div>
          </div>
        )}

        <div className="mb-5 border border-[#222] bg-[#0A0A0A] rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-widest text-[#777] font-semibold">
            Audio analysis
          </div>
          <p className="mt-1 text-[10px] text-[#AAA]">
            {local.audioAnalysisMode === "local"
              ? "Local-only analysis is on. Your music stays on this computer."
              : "Your advanced audio-analysis preference is active."}
          </p>
        </div>

        {/* Style Presets */}
        <div className="mb-5">
          <div className="block text-[11px] uppercase tracking-widest text-[#999] mb-2 font-semibold">
            Medley Style
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="group" aria-label="Medley style">
            {PRIMARY_STYLES.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={local.style === s.id}
                onClick={() => update({ style: s.id as any })}
                className={`w-full min-h-0 p-3 rounded-lg border text-left transition-all flex items-start gap-2 ${local.style === s.id ? "border-[#00F0FF] bg-[#00F0FF]/5" : "border-[#222] bg-[#0A0A0A] hover:border-[#444]"}`}
              >
                <div
                  aria-hidden="true"
                  className={`w-2 h-2 rounded-full ${local.style === s.id ? "bg-[#00F0FF]" : "bg-[#333]"}`}
                />
                <div>
                  <div
                    className={`text-[11px] font-bold ${local.style === s.id ? "text-[#00F0FF]" : "text-[#AAA]"}`}
                  >
                    {s.label}
                  </div>
                  <div className="text-[9px] text-[#555]">{s.desc}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Sliders */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
          <div>
            <label htmlFor="config-target-duration" className="block text-[11px] uppercase tracking-widest text-[#999] mb-2 font-semibold">
              Target Duration
            </label>
            <div className="flex items-center gap-2">
              <input
                id="config-target-duration"
                aria-valuetext={`${local.targetDuration} minutes`}
                type="range"
                min="3"
                max="30"
                value={local.targetDuration}
                onChange={(e) =>
                  update({ targetDuration: parseInt(e.target.value) })
                }
                className="flex-1 accent-[#00F0FF]"
              />
              <span className="text-[11px] font-mono text-[#00F0FF] w-8 text-right">
                {local.targetDuration}m
              </span>
            </div>
          </div>
          <div>
            <label htmlFor="config-crossfade-duration" className="block text-[11px] uppercase tracking-widest text-[#999] mb-2 font-semibold">
              Crossfade
            </label>
            <div className="flex items-center gap-2">
              <input
                id="config-crossfade-duration"
                aria-valuetext={`${local.crossfadeDuration} seconds`}
                type="range"
                min="1"
                max="15"
                value={local.crossfadeDuration}
                onChange={(e) =>
                  update({ crossfadeDuration: parseInt(e.target.value) })
                }
                className="flex-1 accent-[#00F0FF]"
              />
              <span className="text-[11px] font-mono text-[#00F0FF] w-8 text-right">
                {local.crossfadeDuration}s
              </span>
            </div>
          </div>
        </div>

        <details
          className="mb-5 border border-[#222] bg-[#0A0A0A] rounded-lg p-3"
          open={
            local.audioAnalysisMode !== "local" ||
            local.style === "acoustic" ||
            local.style === "custom"
          }
        >
          <summary className="cursor-pointer text-[10px] uppercase tracking-widest text-[#777] font-semibold">
            Advanced controls
          </summary>
          <div className="mt-3 space-y-5">
            <div>
              <div className="text-[10px] text-[#AAA] mb-2">Audio analysis</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="group" aria-label="Audio analysis mode">
                {ANALYSIS_MODES.map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    aria-pressed={local.audioAnalysisMode === mode.id}
                    onClick={() => update({ audioAnalysisMode: mode.id })}
                    className={`p-3 rounded-lg border text-left transition-all ${local.audioAnalysisMode === mode.id ? "border-[#00F0FF] bg-[#00F0FF]/5" : "border-[#333] hover:border-[#555]"}`}
                  >
                    <div className="text-[10px] font-bold text-[#CCC]">{mode.label}</div>
                    <div className="text-[9px] text-[#666] mt-0.5 leading-snug">{mode.desc}</div>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-[#AAA] mb-2">Other styles</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="group" aria-label="Other medley styles">
                {STYLES.filter(
                  (style) => !PRIMARY_STYLES.some((primary) => primary.id === style.id),
                ).map((style) => (
                  <button
                    key={style.id}
                    type="button"
                    aria-pressed={local.style === style.id}
                    onClick={() => update({ style: style.id })}
                    className={`p-3 rounded-lg border text-left transition-all ${local.style === style.id ? "border-[#00F0FF] bg-[#00F0FF]/5" : "border-[#333] hover:border-[#555]"}`}
                  >
                    <div className="text-[10px] font-bold text-[#CCC]">{style.label}</div>
                    <div className="text-[9px] text-[#666] mt-0.5">{style.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </details>

        {/* Custom Instructions */}
        {local.style === "custom" && (
          <div className="mb-5">
            <label htmlFor="config-custom-instructions" className="block text-[11px] uppercase tracking-widest text-[#999] mb-2 font-semibold">
              Custom Instructions
            </label>
            <textarea
              id="config-custom-instructions"
              value={local.customInstructions}
              onChange={(e) => update({ customInstructions: e.target.value })}
              rows={3}
              placeholder="e.g., Start with an upbeat track, build energy toward the middle, end mellow..."
              className="w-full bg-[#0A0A0A] border border-[#222] rounded-lg p-3 text-[11px] text-[#CCC] placeholder:text-[#333] focus:border-[#00F0FF]/50 focus:outline-none resize-none"
            />
          </div>
        )}

        </div>
        <div className="shrink-0 border-t border-white/10 bg-[#131313] px-4 sm:px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-11 py-2.5 bg-[#00F0FF] text-black text-[11px] font-bold uppercase rounded-lg hover:bg-white transition-colors"
          >
            Apply Configuration
          </button>
        </div>
      </div>
    </div>
  );
}
