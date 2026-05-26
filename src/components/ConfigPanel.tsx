import React, { useState } from 'react';
import { X } from 'lucide-react';

interface ConfigPanelProps {
  config: MedleyConfig;
  onUpdate: (c: MedleyConfig) => void;
  onClose: () => void;
}

export type ProviderId = 'gemini' | 'openrouter';
export type AudioAnalysisMode = 'local' | 'clips' | 'ask' | 'cloud';

export interface MedleyConfig {
  provider: ProviderId;
  model: string;
  geminiApiKey: string;
  openrouterApiKey: string;
  audioAnalysisMode: AudioAnalysisMode;
  style: 'dj-set' | 'smooth-transitions' | 'mashup' | 'acoustic' | 'custom';
  temperature: number;
  targetDuration: number; // minutes
  crossfadeDuration: number; // seconds
  customInstructions: string;
}

export const DEFAULT_CONFIG: MedleyConfig = {
  provider: 'gemini',
  model: 'gemini-2.5-pro',
  geminiApiKey: '',
  openrouterApiKey: '',
  audioAnalysisMode: 'local',
  style: 'smooth-transitions',
  temperature: 0.1,
  targetDuration: 10,
  crossfadeDuration: 5,
  customInstructions: ''
};

const STYLES = [
  { id: 'dj-set', label: 'DJ Set', desc: 'High-energy with beat matching and tempo sync' },
  { id: 'smooth-transitions', label: 'Smooth Transitions', desc: 'Gradual crossfades with key-matched blending' },
  { id: 'mashup', label: 'Mashup', desc: 'Layer multiple songs simultaneously' },
  { id: 'acoustic', label: 'Acoustic Mix', desc: 'Natural-sounding flow for acoustic/live tracks' },
  { id: 'custom', label: 'Custom', desc: 'Describe your own approach' },
] as const;

const GEMINI_MODELS = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', desc: 'Fast, cost-effective' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', desc: 'Best quality, slower' },
];

const OPENROUTER_MODELS = [
  // Free high-capability models (recommended for testing)
  { id: 'nousresearch/hermes-3-llama-3.1-405b:free', label: 'Hermes 3 405B (free)', desc: 'Massive 405B — strong reasoning & instruction following' },
  { id: 'qwen/qwen3-coder:free', label: 'Qwen3 Coder 480B (free)', desc: 'Very large Qwen — excellent structured output & logic' },
  { id: 'deepseek/deepseek-v4-flash:free', label: 'DeepSeek V4 Flash (free)', desc: 'High benchmark performance, 1M context' },
  { id: 'nvidia/nemotron-3-super-120b-a12b:free', label: 'Nemotron 3 Super 120B (free)', desc: 'NVIDIA model with massive 1M context' },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B (free)', desc: 'Efficient 70B that often outperforms larger models' },

  // Agentic / Experimental models
  { id: 'openrouter/owl-alpha', label: 'Owl Alpha', desc: 'High-performance model built for agentic workloads & tool use. Strong at complex workflows. (Prompts & completions may be logged by provider to improve the model)' },

  // Paid / higher quality options
  { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', desc: 'Gemini routed through OpenRouter' },
  { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', desc: 'Higher quality Gemini via OpenRouter' },
  { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini', desc: 'Low-cost OpenRouter option' },
  { id: 'openai/gpt-4o', label: 'GPT-4o', desc: 'General-purpose multimodal model' },
] as const;

const ANALYSIS_MODES = [
  { id: 'local', label: 'Local Only', desc: 'Never upload audio for analysis' },
  { id: 'clips', label: 'Smart Clips', desc: 'Upload only short local excerpts' },
  { id: 'ask', label: 'Ask First', desc: 'Confirm before full audio upload' },
  { id: 'cloud', label: 'Full Audio', desc: 'Allow full provider analysis' },
] as const;

export default function ConfigPanel({ config, onUpdate, onClose }: ConfigPanelProps) {
  const [local, setLocal] = useState(config);

  const update = (partial: Partial<MedleyConfig>) => {
    const next = { ...local, ...partial };
    setLocal(next);
    onUpdate(next);
  };

  const setProvider = (provider: ProviderId) => {
    const fallbackModel = provider === 'gemini' ? 'gemini-2.5-pro' : 'openrouter/owl-alpha';
    update({ provider, model: fallbackModel });
  };

  const models = local.provider === 'gemini' ? GEMINI_MODELS : OPENROUTER_MODELS;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#111] border border-[#222] rounded-xl w-full max-w-xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto custom-scrollbar" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-[15px] font-bold text-white uppercase tracking-wider">Configuration</h2>
          <button onClick={onClose} className="text-[#666] hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="mb-5">
          <label className="block text-[10px] uppercase tracking-widest text-[#666] mb-2 font-semibold">Provider</label>
          <div className="grid grid-cols-2 gap-2">
            {(['gemini', 'openrouter'] as const).map(provider => (
              <button
                key={provider}
                onClick={() => setProvider(provider)}
                className={`p-3 rounded-lg border text-left transition-all ${local.provider === provider ? 'border-[#00F0FF] bg-[#00F0FF]/5' : 'border-[#222] bg-[#0A0A0A] hover:border-[#444]'}`}
              >
                <div className={`text-[11px] font-bold ${local.provider === provider ? 'text-[#00F0FF]' : 'text-[#AAA]'}`}>
                  {provider === 'gemini' ? 'Gemini Direct' : 'OpenRouter'}
                </div>
                <div className="text-[9px] text-[#555] mt-0.5">
                  {provider === 'gemini' ? 'Use Google Gemini API directly' : 'Use a model through OpenRouter'}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Model Selection */}
        <div className="mb-5">
          <label className="block text-[10px] uppercase tracking-widest text-[#666] mb-2 font-semibold">AI Model</label>
          <div className="grid grid-cols-2 gap-2">
            {models.map(m => (
              <button
                key={m.id}
                onClick={() => update({ model: m.id })}
                className={`p-3 rounded-lg border text-left transition-all ${local.model === m.id ? 'border-[#00F0FF] bg-[#00F0FF]/5' : 'border-[#222] bg-[#0A0A0A] hover:border-[#444]'}`}
              >
                <div className={`text-[11px] font-bold ${local.model === m.id ? 'text-[#00F0FF]' : 'text-[#AAA]'}`}>{m.label}</div>
                <div className="text-[9px] text-[#555] mt-0.5">{m.desc}</div>
              </button>
            ))}
          </div>
          {local.provider === 'openrouter' && (
            <div className="mt-2">
              <label className="block text-[10px] uppercase tracking-widest text-[#666] mb-2 font-semibold">Custom OpenRouter Model</label>
              <input
                value={local.model}
                onChange={e => update({ model: e.target.value })}
                placeholder="e.g. google/gemini-2.5-pro"
                className="w-full bg-[#0A0A0A] border border-[#222] rounded-lg px-3 py-2.5 text-[11px] text-[#CCC] placeholder:text-[#333] focus:border-[#00F0FF]/50 focus:outline-none"
              />
            </div>
          )}
        </div>

        <div className="mb-5">
          <label className="block text-[10px] uppercase tracking-widest text-[#666] mb-2 font-semibold">
            {local.provider === 'gemini' ? 'Gemini API Key' : 'OpenRouter API Key'}
          </label>
          <input
            type="password"
            value={local.provider === 'gemini' ? local.geminiApiKey : local.openrouterApiKey}
            onChange={e => update(local.provider === 'gemini' ? { geminiApiKey: e.target.value } : { openrouterApiKey: e.target.value })}
            placeholder={local.provider === 'gemini' ? 'AIza...' : 'sk-or-v1-...'}
            className="w-full bg-[#0A0A0A] border border-[#222] rounded-lg px-3 py-2.5 text-[11px] text-[#CCC] placeholder:text-[#333] focus:border-[#00F0FF]/50 focus:outline-none"
          />
          <div className="mt-1 text-[9px] text-[#555]">
            Stored locally in this browser on this machine.
          </div>
        </div>

        <div className="mb-5">
          <label className="block text-[10px] uppercase tracking-widest text-[#666] mb-2 font-semibold">Audio Analysis</label>
          <div className="grid grid-cols-2 gap-2">
            {ANALYSIS_MODES.map(mode => (
              <button
                key={mode.id}
                onClick={() => update({ audioAnalysisMode: mode.id })}
                className={`p-3 rounded-lg border text-left transition-all ${local.audioAnalysisMode === mode.id ? 'border-[#00F0FF] bg-[#00F0FF]/5' : 'border-[#222] bg-[#0A0A0A] hover:border-[#444]'}`}
              >
                <div className={`text-[10px] font-bold ${local.audioAnalysisMode === mode.id ? 'text-[#00F0FF]' : 'text-[#AAA]'}`}>{mode.label}</div>
                <div className="text-[9px] text-[#555] mt-0.5 leading-snug">{mode.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Style Presets */}
        <div className="mb-5">
          <label className="block text-[10px] uppercase tracking-widest text-[#666] mb-2 font-semibold">Medley Style</label>
          <div className="space-y-1.5">
            {STYLES.map(s => (
              <button
                key={s.id}
                onClick={() => update({ style: s.id as any })}
                className={`w-full p-2.5 rounded-lg border text-left transition-all flex items-center gap-3 ${local.style === s.id ? 'border-[#00F0FF] bg-[#00F0FF]/5' : 'border-[#222] bg-[#0A0A0A] hover:border-[#444]'}`}
              >
                <div className={`w-2 h-2 rounded-full ${local.style === s.id ? 'bg-[#00F0FF]' : 'bg-[#333]'}`} />
                <div>
                  <div className={`text-[11px] font-bold ${local.style === s.id ? 'text-[#00F0FF]' : 'text-[#AAA]'}`}>{s.label}</div>
                  <div className="text-[9px] text-[#555]">{s.desc}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Sliders */}
        <div className="grid grid-cols-2 gap-4 mb-5">
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-[#666] mb-2 font-semibold">Target Duration</label>
            <div className="flex items-center gap-2">
              <input type="range" min="3" max="30" value={local.targetDuration} onChange={e => update({ targetDuration: parseInt(e.target.value) })} className="flex-1 accent-[#00F0FF]" />
              <span className="text-[11px] font-mono text-[#00F0FF] w-8 text-right">{local.targetDuration}m</span>
            </div>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-[#666] mb-2 font-semibold">Crossfade</label>
            <div className="flex items-center gap-2">
              <input type="range" min="1" max="15" value={local.crossfadeDuration} onChange={e => update({ crossfadeDuration: parseInt(e.target.value) })} className="flex-1 accent-[#00F0FF]" />
              <span className="text-[11px] font-mono text-[#00F0FF] w-8 text-right">{local.crossfadeDuration}s</span>
            </div>
          </div>
        </div>

        {/* Custom Instructions */}
        {local.style === 'custom' && (
          <div className="mb-5">
            <label className="block text-[10px] uppercase tracking-widest text-[#666] mb-2 font-semibold">Custom Instructions</label>
            <textarea
              value={local.customInstructions}
              onChange={e => update({ customInstructions: e.target.value })}
              rows={3}
              placeholder="e.g., Start with an upbeat track, build energy toward the middle, end mellow..."
              className="w-full bg-[#0A0A0A] border border-[#222] rounded-lg p-3 text-[11px] text-[#CCC] placeholder:text-[#333] focus:border-[#00F0FF]/50 focus:outline-none resize-none"
            />
          </div>
        )}

        <button onClick={onClose} className="w-full py-2.5 bg-[#00F0FF] text-black text-[11px] font-bold uppercase rounded-lg hover:bg-white transition-colors">
          Apply Configuration
        </button>
      </div>
    </div>
  );
}
