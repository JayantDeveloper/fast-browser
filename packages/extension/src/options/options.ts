/**
 * Options page. Reads / writes AgentSettings via chrome.storage.local.
 */

import type { ProviderName } from '../messages.js';
import {
  DEFAULT_SETTINGS,
  knownProviders,
  loadSettings,
  saveSettings,
} from '../settings-storage.js';

const els = {
  form: document.getElementById('settings-form') as HTMLFormElement,
  model: document.getElementById('model') as HTMLInputElement,
  maxSteps: document.getElementById('max-steps') as HTMLInputElement,
  keyAnthropic: document.getElementById('key-anthropic') as HTMLInputElement,
  keyGemini: document.getElementById('key-gemini') as HTMLInputElement,
  keyOpenRouter: document.getElementById('key-openrouter') as HTMLInputElement,
  confirmation: document.getElementById('save-confirmation') as HTMLElement,
};

void hydrate();

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  await save();
});

async function hydrate(): Promise<void> {
  const settings = await loadSettings();
  for (const radio of els.form.querySelectorAll<HTMLInputElement>(
    'input[name="provider"]',
  )) {
    radio.checked = radio.value === settings.provider;
  }
  els.model.value = settings.model;
  els.maxSteps.value = String(settings.maxSteps);
  els.keyAnthropic.value = settings.apiKeys.anthropic ?? '';
  els.keyGemini.value = settings.apiKeys.gemini ?? '';
  els.keyOpenRouter.value = settings.apiKeys.openrouter ?? '';
}

async function save(): Promise<void> {
  const formData = new FormData(els.form);
  const provider = (formData.get('provider') ?? DEFAULT_SETTINGS.provider) as ProviderName;
  if (!knownProviders().includes(provider)) {
    return;
  }
  await saveSettings({
    provider,
    model: els.model.value.trim() || DEFAULT_SETTINGS.model,
    maxSteps: clampMaxSteps(Number(els.maxSteps.value)),
    apiKeys: {
      anthropic: els.keyAnthropic.value.trim() || undefined,
      gemini: els.keyGemini.value.trim() || undefined,
      openrouter: els.keyOpenRouter.value.trim() || undefined,
    },
  });
  els.confirmation.hidden = false;
  setTimeout(() => {
    els.confirmation.hidden = true;
  }, 1500);
}

function clampMaxSteps(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SETTINGS.maxSteps;
  }
  return Math.max(1, Math.min(200, Math.trunc(value)));
}
