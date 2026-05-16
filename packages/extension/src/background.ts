/**
 * MV3 service worker — owns the agent loop.
 *
 * Lifecycle: the panel opens a long-lived port, sends `start`, the SW
 * spins up a ChromeDebuggerDriver against the active tab, runs the
 * agent loop, and streams TrajectoryStep events back over the port. A
 * single chrome.alarms tick keeps the SW from being idle-killed during
 * long tasks.
 */

import {
  AnthropicProvider,
  GeminiProvider,
  OpenRouterProvider,
  run,
} from '@fast-browser/core';
import { ChromeDebuggerDriver } from '@fast-browser/adapter-cdp-extension';

import {
  appendStep,
  clearCheckpoint,
  reapStaleDebuggerSessions,
  saveCheckpoint,
} from './checkpoint.js';
import {
  PANEL_PORT_NAME,
  type BackgroundToPanel,
  type PanelToBackground,
} from './messages.js';
import { buildProvider, MissingApiKeyError } from './provider-factory.js';
import { loadSettings } from './settings-storage.js';

// Expose internals on globalThis for the Playwright e2e suite. Harmless
// at runtime — the symbols are just constructors and the run() function,
// no privileged behavior. Production code never reads __fb_test. The
// `if (__FB_TEST_HOOK__)` block is dead-code-eliminated in PRODUCTION
// builds via an esbuild `define` (build.ts).
declare const __FB_TEST_HOOK__: boolean;
if (__FB_TEST_HOOK__) {
  (globalThis as unknown as Record<string, unknown>).__fb_test = {
    run,
    AnthropicProvider,
    GeminiProvider,
    OpenRouterProvider,
    ChromeDebuggerDriver,
  };
}

const KEEPALIVE_ALARM = 'fast-browser-keepalive';
const KEEPALIVE_PERIOD_MIN = 0.4;

let activePort: chrome.runtime.Port | null = null;
let cancelRequested = false;
let runInFlight = false;

// Boot-time cleanup. The SW restarts on every wake; this runs once per
// wake and cleans up any chrome.debugger sessions left orphaned by a
// crash or eviction during a previous task.
void reapStaleDebuggerSessions();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PANEL_PORT_NAME) {
    return;
  }
  activePort = port;
  port.onMessage.addListener(handlePanelMessage);
  port.onDisconnect.addListener(() => {
    if (activePort === port) {
      activePort = null;
    }
  });
  emit({ type: 'status', state: runInFlight ? 'running' : 'idle' });
});

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.windowId !== undefined) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  // No-op — the alarm exists solely to wake the SW so it doesn't get
  // evicted mid-task. The wake itself is the side effect we want.
  void alarm;
});

function handlePanelMessage(msg: PanelToBackground): void {
  switch (msg.type) {
    case 'start':
      void handleStart(msg.task, msg.url);
      return;
    case 'cancel':
      cancelRequested = true;
      return;
    default:
      // exhaustive — unknown message types are dropped silently.
      return;
  }
}

async function handleStart(task: string, url?: string): Promise<void> {
  if (runInFlight) {
    emit({ type: 'status', state: 'error', message: 'A task is already running.' });
    return;
  }
  runInFlight = true;
  cancelRequested = false;
  emit({ type: 'status', state: 'running' });

  let tabId: number | null = null;
  try {
    await chrome.alarms.create(KEEPALIVE_ALARM, {
      periodInMinutes: KEEPALIVE_PERIOD_MIN,
    });
    const tab = await currentActiveTab();
    if (!tab.id) {
      throw new Error('No active tab to attach to.');
    }
    tabId = tab.id;
    const settings = await loadSettings();
    const actor = buildProvider(settings);
    const driver = new ChromeDebuggerDriver({ tabId });
    await driver.attach({ tabId, ...(url ? { url } : {}) });

    await clearCheckpoint();
    await saveCheckpoint({
      taskId: makeTaskId(),
      task,
      ...(url ? { startUrl: url } : {}),
      tabId,
      startedAt: Date.now(),
      status: 'running',
    });

    try {
      const result = await run(
        driver,
        {
          actor,
          maxSteps: settings.maxSteps,
          onStep: (step) => {
            emit({ type: 'step', step });
            // Fire-and-forget — we don't want a slow chrome.storage write to
            // delay the next perception/LLM cycle.
            void appendStep(step);
          },
        },
        { task, ...(url ? { startUrl: url } : {}) },
      );
      emit({
        type: 'done',
        success: result.success,
        finalResult: result.finalResult,
        steps: result.steps,
        wallMs: result.wallMs,
        costUsdEstimate: result.costUsdEstimate,
      });
      emit({ type: 'status', state: result.success ? 'done' : 'error' });
      // Successful tasks clear the checkpoint; failed ones keep it so the
      // panel can show the partial trajectory until the next task starts.
      if (result.success) {
        await clearCheckpoint();
      }
    } finally {
      await driver.detach().catch(() => {/* tolerate */});
    }
  } catch (e) {
    const message = e instanceof MissingApiKeyError ? e.message : (e as Error).message;
    emit({ type: 'status', state: 'error', message });
  } finally {
    runInFlight = false;
    await chrome.alarms.clear(KEEPALIVE_ALARM).catch(() => {/* */});
  }

  if (cancelRequested) {
    cancelRequested = false;
  }
}

function makeTaskId(): string {
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function currentActiveTab(): Promise<chrome.tabs.Tab> {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs[0];
  if (!tab) {
    throw new Error('Could not resolve the active tab.');
  }
  return tab;
}

function emit(msg: BackgroundToPanel): void {
  if (!activePort) {
    return;
  }
  try {
    activePort.postMessage(msg);
  } catch {
    activePort = null;
  }
}
