import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_SETTINGS,
  knownProviders,
  loadSettings,
  saveSettings,
} from '../src/settings-storage.js';

interface MockChrome {
  storage: {
    local: {
      get: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
    };
  };
}

declare global {
  // eslint-disable-next-line no-var
  var chrome: MockChrome;
}

function makeStorage(): { mock: MockChrome; backing: Record<string, unknown> } {
  const backing: Record<string, unknown> = {};
  const mock: MockChrome = {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: backing[key] })),
        set: vi.fn(async (entry: Record<string, unknown>) => {
          Object.assign(backing, entry);
        }),
      },
    },
  };
  return { mock, backing };
}

describe('settings-storage', () => {
  beforeEach(() => {
    const { mock } = makeStorage();
    globalThis.chrome = mock;
  });

  it('loadSettings returns defaults when storage is empty', async () => {
    const s = await loadSettings();
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it('saveSettings + loadSettings round-trips', async () => {
    await saveSettings({
      ...DEFAULT_SETTINGS,
      provider: 'gemini',
      model: 'gemini-2.5-flash-lite',
      apiKeys: { gemini: 'g-key' },
    });
    const s = await loadSettings();
    expect(s.provider).toBe('gemini');
    expect(s.model).toBe('gemini-2.5-flash-lite');
    expect(s.apiKeys.gemini).toBe('g-key');
  });

  it('loadSettings merges stored over defaults so missing fields fill in', async () => {
    await saveSettings({
      ...DEFAULT_SETTINGS,
      apiKeys: { anthropic: 'a-key' },
    });
    const s = await loadSettings();
    expect(s.maxSteps).toBe(DEFAULT_SETTINGS.maxSteps);
    expect(s.apiKeys.anthropic).toBe('a-key');
  });

  it('knownProviders lists the three supported providers', () => {
    expect(knownProviders().sort()).toEqual(['anthropic', 'gemini', 'openrouter']);
  });
});
