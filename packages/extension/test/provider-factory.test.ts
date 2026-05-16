import { describe, expect, it } from 'vitest';

import {
  AnthropicProvider,
  GeminiProvider,
  OpenRouterProvider,
} from '@fast-browser/core';

import {
  buildProvider,
  MissingApiKeyError,
} from '../src/provider-factory.js';
import { DEFAULT_SETTINGS } from '../src/settings-storage.js';

describe('buildProvider', () => {
  it('returns an AnthropicProvider when provider=anthropic', () => {
    const p = buildProvider({
      ...DEFAULT_SETTINGS,
      provider: 'anthropic',
      apiKeys: { anthropic: 'sk-ant-test' },
    });
    expect(p).toBeInstanceOf(AnthropicProvider);
    expect(p.name).toBe('anthropic');
  });

  it('returns a GeminiProvider when provider=gemini', () => {
    const p = buildProvider({
      ...DEFAULT_SETTINGS,
      provider: 'gemini',
      model: 'gemini-2.5-flash-lite',
      apiKeys: { gemini: 'g-test' },
    });
    expect(p).toBeInstanceOf(GeminiProvider);
    expect(p.model).toBe('gemini-2.5-flash-lite');
  });

  it('returns an OpenRouterProvider when provider=openrouter', () => {
    const p = buildProvider({
      ...DEFAULT_SETTINGS,
      provider: 'openrouter',
      model: 'openai/gpt-oss-120b:free',
      apiKeys: { openrouter: 'or-test' },
    });
    expect(p).toBeInstanceOf(OpenRouterProvider);
  });

  it('throws MissingApiKeyError when the selected provider has no key', () => {
    expect(() =>
      buildProvider({
        ...DEFAULT_SETTINGS,
        provider: 'anthropic',
        apiKeys: { gemini: 'wrong-provider' },
      }),
    ).toThrow(MissingApiKeyError);
  });
});
