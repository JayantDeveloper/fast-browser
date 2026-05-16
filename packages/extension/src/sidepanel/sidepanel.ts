/**
 * Sidepanel UI controller. No framework — direct DOM updates over a
 * long-lived port to the service worker.
 */

import type {
  BackgroundToPanel,
  DoneEvent,
  StatusEvent,
  StepEvent,
} from '../messages.js';
import { PANEL_PORT_NAME } from '../messages.js';

const STATUS_LABELS: Record<StatusEvent['state'], string> = {
  idle: 'idle',
  running: 'running',
  done: 'done',
  error: 'error',
};

const els = {
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

const port = chrome.runtime.connect({ name: PANEL_PORT_NAME });

port.onMessage.addListener((msg: BackgroundToPanel) => {
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
});

els.run.addEventListener('click', () => {
  const task = els.task.value.trim();
  if (!task) {
    return;
  }
  resetTrace();
  port.postMessage({ type: 'start', task });
});

els.cancel.addEventListener('click', () => {
  port.postMessage({ type: 'cancel' });
});

els.options.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

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
