/**
 * Sidepanel UI controller. No framework — direct DOM updates over a
 * long-lived port to the service worker.
 *
 * The port is lazy + self-healing: if the SW gets evicted (MV3 30s
 * idle kill) the panel transparently reconnects on the next send. This
 * removes the "Attempting to use a disconnected port object" failure
 * mode that bites every panel that's been idle for ~half a minute.
 *
 * Presets are loaded from chrome.storage.local; the last-selected
 * preset auto-fills the task textarea on panel open so the user can
 * click Run immediately.
 */

import type {
  BackgroundToPanel,
  DoneEvent,
  PanelToBackground,
  StatusEvent,
  StepEvent,
  TaskPreset,
} from '../messages.js';
import { PANEL_PORT_NAME } from '../messages.js';
import { loadSettings, rememberLastPreset } from '../settings-storage.js';

const STATUS_LABELS: Record<StatusEvent['state'], string> = {
  idle: 'idle',
  running: 'running',
  done: 'done',
  error: 'error',
};

const els = {
  preset: document.getElementById('preset') as HTMLSelectElement,
  task: document.getElementById('task') as HTMLTextAreaElement,
  run: document.getElementById('run') as HTMLButtonElement,
  cancel: document.getElementById('cancel') as HTMLButtonElement,
  options: document.getElementById('open-options') as HTMLAnchorElement,
  statusPill: document.getElementById('status-pill') as HTMLSpanElement,
  statusMessage: document.getElementById('status-message') as HTMLSpanElement,
  trace: document.getElementById('trace') as HTMLOListElement,
  resultSection: document.getElementById('result-section') as HTMLElement,
  resultSummary: document.getElementById('result-summary') as HTMLDivElement,
  resultText: document.getElementById('result-text') as HTMLPreElement,
};

let port: chrome.runtime.Port | null = null;
let presets: TaskPreset[] = [];

function connect(): chrome.runtime.Port {
  const p = chrome.runtime.connect({ name: PANEL_PORT_NAME });
  p.onMessage.addListener(handleMessage);
  p.onDisconnect.addListener(() => {
    port = null;
  });
  return p;
}

function ensurePort(): chrome.runtime.Port {
  if (!port) {
    port = connect();
  }
  return port;
}

function safeSend(msg: PanelToBackground): void {
  try {
    ensurePort().postMessage(msg);
    return;
  } catch {
    port = connect();
    try {
      port.postMessage(msg);
    } catch (e) {
      applyStatus({
        type: 'status',
        state: 'error',
        message: `Could not reach the service worker: ${(e as Error).message}`,
      });
    }
  }
}

function handleMessage(msg: BackgroundToPanel): void {
  switch (msg.type) {
    case 'status':
      applyStatus(msg);
      return;
    case 'step':
      appendStep(msg);
      return;
    case 'done':
      showResult(msg);
      return;
    default:
      return;
  }
}

ensurePort();
void hydratePresets();

els.preset.addEventListener('change', () => {
  applyPreset(els.preset.value);
  void rememberLastPreset(els.preset.value);
});

els.run.addEventListener('click', () => {
  const task = els.task.value.trim();
  if (!task) {
    return;
  }
  resetTrace();
  const preset = currentPreset();
  const msg: PanelToBackground = { type: 'start', task };
  if (preset?.url) {
    msg.url = preset.url;
  }
  if (preset?.maxStepsOverride) {
    msg.maxStepsOverride = preset.maxStepsOverride;
  }
  safeSend(msg);
});

els.cancel.addEventListener('click', () => {
  safeSend({ type: 'cancel' });
});

els.options.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

async function hydratePresets(): Promise<void> {
  const settings = await loadSettings();
  presets = settings.presets;

  // Wipe everything past the "Custom task" placeholder option, then
  // rebuild from current presets.
  while (els.preset.options.length > 1) {
    els.preset.remove(1);
  }
  for (const p of presets) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    els.preset.appendChild(opt);
  }

  const initial = settings.lastPresetId ?? presets[0]?.id ?? '';
  els.preset.value = initial;
  applyPreset(initial);
}

function applyPreset(id: string): void {
  if (!id) {
    return;
  }
  const preset = presets.find((p) => p.id === id);
  if (preset) {
    els.task.value = preset.task;
  }
}

function currentPreset(): TaskPreset | undefined {
  return presets.find((p) => p.id === els.preset.value);
}

function applyStatus(msg: StatusEvent): void {
  els.statusPill.textContent = STATUS_LABELS[msg.state];
  els.statusPill.className = `pill ${msg.state}`;
  els.statusMessage.textContent = msg.message ?? '';
  const running = msg.state === 'running';
  els.run.disabled = running;
  els.cancel.disabled = !running;
}

function appendStep(msg: StepEvent): void {
  const li = document.createElement('li');
  const { step } = msg;
  const ok = step.result.ok;
  li.className = ok ? 'step-ok' : 'step-fail';
  const cost = step.llmUsage.costUsd
    ? `$${step.llmUsage.costUsd.toFixed(6)}`
    : '';
  const tag = ok ? '✓' : `✗(${step.result.error})`;
  li.innerHTML =
    `<strong>${step.action.type}</strong> ${tag} ` +
    `<span class="step-meta">${step.llmLatencyMs}ms ${cost}</span><br>` +
    `<span>${escapeHtml(step.result.summary)}</span>`;
  els.trace.appendChild(li);
  li.scrollIntoView({ block: 'end' });
}

function showResult(msg: DoneEvent): void {
  els.resultSection.hidden = false;
  els.resultSummary.textContent =
    `${msg.success ? 'success' : 'failure'} • ${msg.steps} steps • ` +
    `${(msg.wallMs / 1000).toFixed(1)}s • $${msg.costUsdEstimate.toFixed(4)}`;
  els.resultText.textContent = msg.finalResult;
}

function resetTrace(): void {
  els.trace.replaceChildren();
  els.resultSection.hidden = true;
  els.resultText.textContent = '';
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}
