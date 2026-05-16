/**
 * Build a Provider instance from saved settings. Centralises the switch
 * so background.ts stays focused on agent orchestration.
 */

import {
  AnthropicProvider,
  GeminiProvider,
  OpenRouterProvider,
  type Provider,
} from '@fast-browser/core';

import type { AgentSettings } from './messages.js';

export class MissingApiKeyError extends Error {
  constructor(public readonly provider: string) {
    super(`No API key configured for ${provider}. Open the options page.`);
  }
}

export function buildProvider(settings: AgentSettings): Provider {
  const apiKey = settings.apiKeys[settings.provider];
  if (!apiKey) {
    throw new MissingApiKeyError(settings.provider);
  }
  switch (settings.provider) {
    case 'anthropic':
      return new AnthropicProvider({ apiKey, model: settings.model });
    case 'gemini':
      return new GeminiProvider({ apiKey, model: settings.model });
    case 'openrouter':
      return new OpenRouterProvider({ apiKey, model: settings.model });
    default:
      throw new Error(`Unknown provider ${settings.provider}`);
  }
}
