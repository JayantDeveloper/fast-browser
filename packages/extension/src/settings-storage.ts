/**
 * Thin wrapper around chrome.storage.local for AgentSettings. Plain
 * promise API; no callback noise leaks into call sites.
 *
 * Dev builds inline API keys from the project's .env via build.ts so
 * the Options form pre-populates on first launch. Production builds
 * always inline an empty object — verified by build.ts.
 */

import type { AgentSettings, ProviderName } from './messages.js';

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
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    apiKeys: {
      ...DEFAULT_SETTINGS.apiKeys,
      ...devKeys(),
      ...stored?.apiKeys,
    },
  };
}

export async function saveSettings(settings: AgentSettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
}
