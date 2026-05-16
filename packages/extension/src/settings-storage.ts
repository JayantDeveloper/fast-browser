/**
 * Thin wrapper around chrome.storage.local for AgentSettings. Plain
 * promise API; no callback noise leaks into call sites.
 */

import type { AgentSettings, ProviderName } from './messages.js';

const STORAGE_KEY = 'fastBrowserSettings';

export const DEFAULT_SETTINGS: AgentSettings = {
  provider: 'anthropic',
  model: 'claude-haiku-4-5',
  apiKeys: {},
  maxSteps: 60,
};

export function knownProviders(): ProviderName[] {
  return ['anthropic', 'gemini', 'openrouter'];
}

export async function loadSettings(): Promise<AgentSettings> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const stored = result[STORAGE_KEY] as Partial<AgentSettings> | undefined;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    apiKeys: { ...DEFAULT_SETTINGS.apiKeys, ...stored?.apiKeys },
  };
}

export async function saveSettings(settings: AgentSettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
}
