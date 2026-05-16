import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  appendStep,
  clearCheckpoint,
  loadCheckpoint,
  loadSteps,
  reapStaleDebuggerSessions,
  saveCheckpoint,
  type TaskCheckpoint,
} from '../src/checkpoint.js';
import type { TrajectoryStep } from '@fast-browser/core';

interface MockChrome {
  storage: {
    session: {
      get: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
      remove: ReturnType<typeof vi.fn>;
    };
  };
  debugger?: {
    detach: ReturnType<typeof vi.fn>;
  };
  runtime: { lastError?: { message: string } };
}

declare global {
  // eslint-disable-next-line no-var
  var chrome: MockChrome;
}

function installMockChrome(): { mock: MockChrome; backing: Record<string, unknown> } {
  const backing: Record<string, unknown> = {};
  const mock: MockChrome = {
    storage: {
      session: {
        get: vi.fn(async (keys: string[]) => {
          const r: Record<string, unknown> = {};
          for (const k of keys) {
            r[k] = backing[k];
          }
          return r;
        }),
        set: vi.fn(async (entry: Record<string, unknown>) => {
          Object.assign(backing, entry);
        }),
        remove: vi.fn(async (keys: string[]) => {
          for (const k of keys) {
            delete backing[k];
          }
        }),
      },
    },
    debugger: {
      detach: vi.fn(
        (_target: { tabId: number }, cb: () => void) => cb(),
      ),
    },
    runtime: {},
  };
  globalThis.chrome = mock;
  return { mock, backing };
}

function makeStep(index: number): TrajectoryStep {
  return {
    index,
    urlBefore: 'https://x',
    fingerprintBefore: 'fp',
    action: { type: 'wait_for', ms: 0 },
    result: { ok: true, summary: 'ok' },
    urlAfter: 'https://x',
    llmLatencyMs: 0,
    llmUsage: { inputTokens: 0, outputTokens: 0 },
  };
}

const FRESH: TaskCheckpoint = {
  taskId: 't-1',
  task: 'do thing',
  tabId: 7,
  startedAt: Date.now(),
  status: 'running',
};

describe('checkpoint', () => {
  beforeEach(() => {
    installMockChrome();
  });

  it('save and load a checkpoint round-trip', async () => {
    await saveCheckpoint(FRESH);
    const cp = await loadCheckpoint();
    expect(cp?.taskId).toBe('t-1');
    expect(cp?.tabId).toBe(7);
  });

  it('loadCheckpoint returns null when nothing saved', async () => {
    expect(await loadCheckpoint()).toBeNull();
  });

  it('checkpoints older than 10 minutes are considered stale and cleared', async () => {
    const stale = { ...FRESH, startedAt: Date.now() - 11 * 60 * 1000 };
    await saveCheckpoint(stale);
    expect(await loadCheckpoint()).toBeNull();
  });

  it('clearCheckpoint removes both the checkpoint and steps', async () => {
    await saveCheckpoint(FRESH);
    await appendStep(makeStep(1));
    await clearCheckpoint();
    expect(await loadCheckpoint()).toBeNull();
    expect(await loadSteps()).toEqual([]);
  });

  it('appendStep + loadSteps preserve order', async () => {
    await appendStep(makeStep(1));
    await appendStep(makeStep(2));
    await appendStep(makeStep(3));
    const steps = await loadSteps();
    expect(steps.map((s) => s.index)).toEqual([1, 2, 3]);
  });

  it('reapStaleDebuggerSessions detaches a running checkpoint and marks it errored', async () => {
    await saveCheckpoint(FRESH);
    await reapStaleDebuggerSessions();
    expect(globalThis.chrome.debugger?.detach).toHaveBeenCalledWith(
      { tabId: 7 },
      expect.any(Function),
    );
    const cp = await loadCheckpoint();
    expect(cp?.status).toBe('error');
  });

  it('reapStaleDebuggerSessions is a no-op when no checkpoint exists', async () => {
    await reapStaleDebuggerSessions();
    expect(globalThis.chrome.debugger?.detach).not.toHaveBeenCalled();
  });
});
