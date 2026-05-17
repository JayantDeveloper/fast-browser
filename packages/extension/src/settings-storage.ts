/**
 * Thin wrapper around chrome.storage.local for AgentSettings. Plain
 * promise API; no callback noise leaks into call sites.
 *
 * Dev builds inline API keys from the project's .env via build.ts so
 * the Options form pre-populates on first launch. Production builds
 * always inline an empty object — verified by build.ts.
 */

import type { AgentSettings, ProviderName } from './messages.js';
import { DEFAULT_PRESETS } from './preset-defaults.js';

declare const __FB_DEV_KEYS__: Record<string, string>;

const STORAGE_KEY = 'fastBrowserSettings';

function devKeys(): Partial<AgentSettings['apiKeys']> {
  return typeof __FB_DEV_KEYS__ === 'undefined' ? {} : __FB_DEV_KEYS__;
}

export const DEFAULT_SETTINGS: AgentSettings = {
  provider: 'anthropic',
  model: 'claude-haiku-4-5',
  apiKeys: {},
  maxSteps: 60,
  presets: DEFAULT_PRESETS,
  lastPresetId: DEFAULT_PRESETS[0]?.id ?? '',
};

export function knownProviders(): ProviderName[] {
  return ['anthropic', 'gemini', 'openrouter'];
}

export async function loadSettings(): Promise<AgentSettings> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const stored = result[STORAGE_KEY] as Partial<AgentSettings> | undefined;
  // Precedence: user-saved > dev-env > defaults. Dev keys fill in the
  // blanks but never override a key the user explicitly typed (or
  // explicitly cleared and saved).
  // Presets: if the user has saved any, use those; otherwise show the
  // shipped defaults. Bumping DEFAULT_PRESETS in a release does NOT
  // overwrite a user's custom list — that's intentional.
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    apiKeys: {
      ...DEFAULT_SETTINGS.apiKeys,
      ...devKeys(),
      ...stored?.apiKeys,
    },
    presets: stored?.presets ?? DEFAULT_SETTINGS.presets,
    lastPresetId: stored?.lastPresetId ?? DEFAULT_SETTINGS.lastPresetId,
  };
}

export async function saveSettings(settings: AgentSettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
}

/**
 * Update only the lastPresetId without rewriting the whole settings
 * blob. Used by the sidepanel when the user picks a preset.
 */
export async function rememberLastPreset(presetId: string): Promise<void> {
  const current = await loadSettings();
  await saveSettings({ ...current, lastPresetId: presetId });
}
