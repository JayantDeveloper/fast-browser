/**
 * MV3 service worker — owns the agent loop.
 *
 * Lifecycle: the panel opens a long-lived port, sends `start`, the SW
 * spins up a ChromeDebuggerDriver against the active tab, runs the
 * agent loop, and streams TrajectoryStep events back over the port. A
 * single chrome.alarms tick keeps the SW from being idle-killed during
 * long tasks.
 */

import { run } from '@fast-browser/core';
import { ChromeDebuggerDriver } from '@fast-browser/adapter-cdp-extension';

import {
  PANEL_PORT_NAME,
  type BackgroundToPanel,
  type PanelToBackground,
} from './messages.js';
import { buildProvider, MissingApiKeyError } from './provider-factory.js';
import { loadSettings } from './settings-storage.js';

const KEEPALIVE_ALARM = 'fast-browser-keepalive';
const KEEPALIVE_PERIOD_MIN = 0.4;

let activePort: chrome.runtime.Port | null = null;
let cancelRequested = false;
let runInFlight = false;

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

  try {
    await chrome.alarms.create(KEEPALIVE_ALARM, {
      periodInMinutes: KEEPALIVE_PERIOD_MIN,
    });
    const tab = await currentActiveTab();
    if (!tab.id) {
      throw new Error('No active tab to attach to.');
    }
    const settings = await loadSettings();
    const actor = buildProvider(settings);
    const driver = new ChromeDebuggerDriver({ tabId: tab.id });
    await driver.attach({ tabId: tab.id, ...(url ? { url } : {}) });

    try {
      const result = await run(
        driver,
        {
          actor,
          maxSteps: settings.maxSteps,
          onStep: (step) => emit({ type: 'step', step }),
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
    } finally {
      await driver.detach().catch(() => {/* */});
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
