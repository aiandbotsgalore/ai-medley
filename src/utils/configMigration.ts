import {
  DEFAULT_CONFIG,
  type MedleyConfig,
} from '../components/ConfigPanel';

export function migrateMedleyConfig(
  stored: Partial<MedleyConfig> | null | undefined,
  serverConfig: { geminiApiKey?: string; openrouterApiKey?: string } = {},
): MedleyConfig {
  const source = stored ?? {};
  return {
    ...DEFAULT_CONFIG,
    ...source,
    configVersion: 2,
    modelMode: source.configVersion === 2 ? (source.modelMode || 'automatic') : 'automatic',
    geminiApiKey: source.geminiApiKey || serverConfig.geminiApiKey || '',
    openrouterApiKey: source.openrouterApiKey || serverConfig.openrouterApiKey || '',
  };
}

export function getProviderKey(config: MedleyConfig) {
  if (config.modelMode === 'automatic') return config.openrouterApiKey.trim();
  return (config.provider === 'gemini' ? config.geminiApiKey : config.openrouterApiKey).trim();
}

export function getStartConfigurationError(config: MedleyConfig): string | null {
  if (getProviderKey(config)) return null;
  if (config.modelMode === 'automatic') {
    return 'Automatic Specialist Team requires an OpenRouter API key. Add one in Configuration or switch to Manual Model mode.';
  }
  return config.provider === 'gemini'
    ? 'Add a Gemini API key in Configuration before starting.'
    : 'Add an OpenRouter API key in Configuration before starting.';
}
