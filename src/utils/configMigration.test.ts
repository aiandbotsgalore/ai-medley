import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../components/ConfigPanel";
import {
  getDefaultModelForProvider,
  getStartConfigurationError,
  migrateMedleyConfigWithNotices,
  migrateMedleyConfig,
  normalizeProviderModel,
  classifyManualCheckpointConfiguration,
  createManualConfigBinding,
  SERVER_MANAGED_API_KEY,
} from "./configMigration";

const migrated = migrateMedleyConfig({
  provider: "gemini",
  model: "gemini-2.5-flash",
  geminiApiKey: "gemini-key",
  openrouterApiKey: "",
  audioAnalysisMode: "local",
  style: "smooth-transitions",
  temperature: 0.1,
  targetDuration: 10,
  crossfadeDuration: 5,
  customInstructions: "",
} as any);
assert.equal(migrated.modelMode, "manual");
assert.equal(migrated.provider, "gemini");
assert.equal(migrated.model, "gemini-2.5-flash");
assert.equal(migrated.geminiApiKey, "gemini-key");
assert.equal(getStartConfigurationError(migrated), null);

const ready = { ...DEFAULT_CONFIG, openrouterApiKey: "openrouter-key" };
assert.equal(getStartConfigurationError(ready), null);

const automaticUpgrade = migrateMedleyConfigWithNotices({
  ...DEFAULT_CONFIG,
  configVersion: 3,
  modelMode: "automatic",
  provider: "openrouter",
  model: "google/gemini-2.5-pro",
  openrouterApiKey: "openrouter-key",
  geminiApiKey: "gemini-key",
} as any);
assert.equal(automaticUpgrade.config.provider, "openrouter");
assert.equal(automaticUpgrade.config.model, "google/gemini-3.1-pro-preview");
assert.equal(
  automaticUpgrade.config.automaticOpenRouterFallbackModel,
  "google/gemini-3.1-pro-preview",
);
assert.match(automaticUpgrade.notices.join(" "), /OpenRouter/i);

const openRouterOnlyAutomatic = migrateMedleyConfig({
  ...DEFAULT_CONFIG,
  modelMode: "automatic",
  geminiApiKey: "",
  openrouterApiKey: "openrouter-key",
});
assert.equal(getStartConfigurationError(openRouterOnlyAutomatic), null);

const incompatible = migrateMedleyConfigWithNotices({
  ...DEFAULT_CONFIG,
  configVersion: 2,
  modelMode: "manual",
  provider: "gemini",
  model: "openrouter/owl-alpha",
} as any);
assert.equal(incompatible.config.model, getDefaultModelForProvider("gemini"));
assert.match(incompatible.notices.join(" "), /incompatible|migrated/i);
assert.equal(
  normalizeProviderModel("openrouter", "custom/vendor-model").model,
  "custom/vendor-model",
);
const serverManaged = migrateMedleyConfig(null, {
  hasGeminiApiKey: true,
  hasOpenrouterApiKey: true,
});
assert.equal(serverManaged.geminiApiKey, SERVER_MANAGED_API_KEY);
assert.equal(serverManaged.openrouterApiKey, SERVER_MANAGED_API_KEY);
assert.deepEqual(
  classifyManualCheckpointConfiguration(createManualConfigBinding(ready), ready),
  { compatible: true, reason: "compatible" },
);
assert.equal(
  classifyManualCheckpointConfiguration(null, ready).reason,
  "legacy-unbound",
);
assert.equal(
  classifyManualCheckpointConfiguration(
    createManualConfigBinding(ready),
    { ...ready, model: "different/model" },
  ).reason,
  "changed",
);
assert.equal(
  normalizeProviderModel("gemini", "custom/vendor-model").model,
  getDefaultModelForProvider("gemini"),
);

console.log("configMigration tests passed");
