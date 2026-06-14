import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../components/ConfigPanel';
import {
  getStartConfigurationError,
  migrateMedleyConfig,
} from './configMigration';

const migrated = migrateMedleyConfig({
  provider: 'gemini',
  model: 'gemini-2.5-flash',
  geminiApiKey: 'gemini-key',
  openrouterApiKey: '',
  audioAnalysisMode: 'local',
  style: 'smooth-transitions',
  temperature: 0.1,
  targetDuration: 10,
  crossfadeDuration: 5,
  customInstructions: '',
} as any);
assert.equal(migrated.modelMode, 'automatic');
assert.equal(migrated.provider, 'gemini');
assert.equal(migrated.model, 'gemini-2.5-flash');
assert.equal(migrated.geminiApiKey, 'gemini-key');
assert.match(getStartConfigurationError(migrated) || '', /OpenRouter API key/);

const ready = { ...DEFAULT_CONFIG, openrouterApiKey: 'openrouter-key' };
assert.equal(getStartConfigurationError(ready), null);

console.log('configMigration tests passed');
