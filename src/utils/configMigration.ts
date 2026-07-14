import {
  DEFAULT_CONFIG,
  getDefaultModelForProvider as getProviderDefault,
  type MedleyConfig,
  type ProviderId,
} from "../components/ConfigPanel";
export { SERVER_MANAGED_API_KEY } from "../constants/provider";
import { SERVER_MANAGED_API_KEY } from "../constants/provider";

export function getDefaultModelForProvider(provider: ProviderId) {
  return getProviderDefault(provider);
}

export function normalizeProviderModel(provider: ProviderId, model: unknown) {
  const candidate = typeof model === "string" ? model.trim() : "";
  const compatible =
    provider === "gemini"
      ? /^gemini-[a-z0-9._-]+$/i.test(candidate)
      : /^[^\s/]+\/[^\s/]+$/.test(candidate);
  if (compatible) return { model: candidate, notice: null as string | null };
  const fallback = getDefaultModelForProvider(provider);
  return {
    model: fallback,
    notice: candidate
      ? `Saved model "${candidate}" was incompatible with ${provider} and was migrated to "${fallback}".`
      : `Saved ${provider} model was missing and was migrated to "${fallback}".`,
  };
}

export function migrateMedleyConfigWithNotices(
  stored: Partial<MedleyConfig> | null | undefined,
  serverConfig: {
    geminiApiKey?: string;
    openrouterApiKey?: string;
    hasGeminiApiKey?: boolean;
    hasOpenrouterApiKey?: boolean;
  } = {},
): { config: MedleyConfig; notices: string[] } {
  const source = stored ?? {};
  const hasStoredConfig = Object.keys(source).length > 0;
  const storedProvider: ProviderId =
    source.provider === "gemini" || source.provider === "openrouter"
      ? source.provider
      : DEFAULT_CONFIG.provider;
  const modelMode =
    source.modelMode === "automatic" || source.modelMode === "manual"
      ? source.modelMode
      : hasStoredConfig
        ? "manual"
        : DEFAULT_CONFIG.modelMode;
  // Automatic v4 starts with direct Gemini, but may immediately retry the
  // arrangement through the separately configured OpenRouter fallback.
  const provider: ProviderId = modelMode === "automatic" ? "gemini" : storedProvider;
  const automaticMigration = modelMode === "automatic" &&
    (storedProvider !== "gemini" || source.model !== "gemini-3.1-pro-preview");
  const normalized = modelMode === "automatic"
    ? { model: "gemini-3.1-pro-preview", notice: automaticMigration
      ? "Automatic workflow was upgraded to direct Gemini 3.1 Pro; Manual provider settings were preserved."
      : null }
    : normalizeProviderModel(provider, source.model);
  return {
    config: {
      ...DEFAULT_CONFIG,
      ...source,
      configVersion: 4,
      modelMode,
      provider,
      model: normalized.model,
      geminiApiKey:
        source.geminiApiKey ||
        serverConfig.geminiApiKey ||
        (serverConfig.hasGeminiApiKey ? SERVER_MANAGED_API_KEY : ""),
      openrouterApiKey:
        source.openrouterApiKey ||
        serverConfig.openrouterApiKey ||
        (serverConfig.hasOpenrouterApiKey ? SERVER_MANAGED_API_KEY : ""),
      automaticOpenRouterFallbackModel: normalizeProviderModel(
        "openrouter",
        source.automaticOpenRouterFallbackModel,
      ).model,
    },
    notices: normalized.notice ? [normalized.notice] : [],
  };
}

export function migrateMedleyConfig(
  stored: Partial<MedleyConfig> | null | undefined,
  serverConfig: {
    geminiApiKey?: string;
    openrouterApiKey?: string;
    hasGeminiApiKey?: boolean;
    hasOpenrouterApiKey?: boolean;
  } = {},
): MedleyConfig {
  return migrateMedleyConfigWithNotices(stored, serverConfig).config;
}

export function getProviderKey(config: MedleyConfig) {
  if (config.modelMode === "automatic")
    return config.geminiApiKey.trim() || config.openrouterApiKey.trim();
  return (
    config.provider === "gemini" ? config.geminiApiKey : config.openrouterApiKey
  ).trim();
}

export function getStartConfigurationError(
  config: MedleyConfig,
): string | null {
  if (getProviderKey(config)) return null;
  if (config.modelMode === "automatic") {
    return "Automatic Medley requires a Gemini or OpenRouter API key. Add GEMINI_API_KEY or OPENROUTER_API_KEY to the server configuration.";
  }
  return config.provider === "gemini"
    ? "Add a Gemini API key in Configuration before starting."
    : "Add an OpenRouter API key in Configuration before starting.";
}

export type ManualConfigBinding = {
  version: 1;
  provider: ProviderId;
  configuredModel: string;
};

export function createManualConfigBinding(
  config: MedleyConfig,
): ManualConfigBinding {
  return {
    version: 1,
    provider: config.provider,
    configuredModel: config.model,
  };
}

export function classifyManualCheckpointConfiguration(
  binding: ManualConfigBinding | null | undefined,
  config: MedleyConfig,
): { compatible: boolean; reason: "compatible" | "changed" | "legacy-unbound" } {
  if (!binding || binding.version !== 1)
    return { compatible: false, reason: "legacy-unbound" };
  return binding.provider === config.provider &&
    binding.configuredModel === config.model
    ? { compatible: true, reason: "compatible" }
    : { compatible: false, reason: "changed" };
}
