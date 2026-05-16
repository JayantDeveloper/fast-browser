/**
 * Persists in-flight task state to chrome.storage.session so the agent
 * can recover cleanly across MV3 service-worker evictions.
 *
 * Recovery policy: on SW boot we DO NOT auto-resume — by the time the SW
 * comes back, the page has likely moved on and the chrome.debugger session
 * is gone. Instead the side panel sees the stale checkpoint and can
 * either show the partial trajectory ("here's what happened") or clear
 * it and start fresh.
 */

import type { TrajectoryStep } from '@fast-browser/core';

const CHECKPOINT_KEY = 'fastBrowserCheckpoint';
const STEPS_KEY = 'fastBrowserCheckpointSteps';

/** Checkpoints older than this are considered stale and dropped. */
const MAX_CHECKPOINT_AGE_MS = 10 * 60 * 1000;

export interface TaskCheckpoint {
  taskId: string;
  task: string;
  startUrl?: string;
  tabId: number;
  startedAt: number;
  status: 'running' | 'done' | 'error';
}

interface CheckpointStorage {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(entry: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

/**
 * chrome.storage.session is the right surface here: scoped to the
 * browser session, not persistent across browser restarts (we don't want
 * stale checkpoints to outlive the session that started them).
 */
function storage(): CheckpointStorage {
  // chrome.storage.session is available in MV3 (Chrome 102+).
  return chrome.storage.session;
}

export async function saveCheckpoint(cp: TaskCheckpoint): Promise<void> {
  await storage().set({ [CHECKPOINT_KEY]: cp });
}

export async function loadCheckpoint(): Promise<TaskCheckpoint | null> {
  const r = await storage().get([CHECKPOINT_KEY]);
  const cp = r[CHECKPOINT_KEY] as TaskCheckpoint | undefined;
  if (!cp) {
    return null;
  }
  if (Date.now() - cp.startedAt > MAX_CHECKPOINT_AGE_MS) {
    await clearCheckpoint();
    return null;
  }
  return cp;
}

export async function clearCheckpoint(): Promise<void> {
  await storage().remove([CHECKPOINT_KEY, STEPS_KEY]);
}

export async function appendStep(step: TrajectoryStep): Promise<void> {
  const r = await storage().get([STEPS_KEY]);
  const existing = (r[STEPS_KEY] as TrajectoryStep[] | undefined) ?? [];
  existing.push(step);
  await storage().set({ [STEPS_KEY]: existing });
}

export async function loadSteps(): Promise<TrajectoryStep[]> {
  const r = await storage().get([STEPS_KEY]);
  return (r[STEPS_KEY] as TrajectoryStep[] | undefined) ?? [];
}

/**
 * On SW boot, defensively clean up: if a checkpoint says we were attached
 * to a tab but never finished, the chrome.debugger session is now orphaned
 * (the SW that owned it died). Tell chrome to detach so the yellow infobar
 * goes away on the user's tab.
 */
export async function reapStaleDebuggerSessions(): Promise<void> {
  const cp = await loadCheckpoint();
  if (!cp || cp.status !== 'running') {
    return;
  }
  await detachQuietly(cp.tabId);
  // Mark the checkpoint as errored so the panel shows it as a failed run
  // rather than a still-running one.
  await saveCheckpoint({ ...cp, status: 'error' });
}

async function detachQuietly(tabId: number): Promise<void> {
  await new Promise<void>((resolve) => {
    try {
      chrome.debugger.detach({ tabId }, () => {
        // Swallow lastError — detach can race with tab close, and either
        // outcome (success or "not attached") is fine.
        void chrome.runtime.lastError;
        resolve();
      });
    } catch {
      resolve();
    }
  });
}
