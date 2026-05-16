/**
 * ChromeDebuggerClient is mostly a thin async wrapper around the
 * chrome.debugger callback API. We mock chrome.* and verify event fan-out,
 * tab-id filtering, send promise resolution/rejection, and detach
 * cleanup. The real driver is exercised end-to-end inside the extension
 * package's e2e test (deferred to U14).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChromeDebuggerClient } from '../src/debugger-client.js';

interface MockChromeShape {
  debugger: {
    attach: ReturnType<typeof vi.fn>;
    detach: ReturnType<typeof vi.fn>;
    sendCommand: ReturnType<typeof vi.fn>;
    onEvent: {
      addListener: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
      _emit: (
        source: { tabId: number },
        method: string,
        params?: object,
      ) => void;
    };
    onDetach: {
      addListener: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
    };
  };
  runtime: { lastError?: { message: string } };
}

declare global {
  // eslint-disable-next-line no-var
  var chrome: MockChromeShape;
}

function installMockChrome(): MockChromeShape {
  let onEventListener:
    | ((source: { tabId: number }, method: string, params?: object) => void)
    | null = null;

  const mock: MockChromeShape = {
    debugger: {
      attach: vi.fn((_target, _ver, cb: () => void) => cb()),
      detach: vi.fn((_target, cb: () => void) => cb()),
      sendCommand: vi.fn(
        (
          _target: { tabId: number },
          _method: string,
          _params: object,
          cb: (result: unknown) => void,
        ) => cb({ ok: true }),
      ),
      onEvent: {
        addListener: vi.fn((fn) => {
          onEventListener = fn;
        }),
        removeListener: vi.fn(() => {
          onEventListener = null;
        }),
        _emit: (source, method, params) => {
          onEventListener?.(source, method, params);
        },
      },
      onDetach: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    runtime: {},
  };
  globalThis.chrome = mock;
  return mock;
}

describe('ChromeDebuggerClient', () => {
  let mock: MockChromeShape;

  beforeEach(() => {
    mock = installMockChrome();
  });

  afterEach(() => {
    mock.runtime.lastError = undefined;
  });

  it('attach() registers global event listener and detach handler', async () => {
    const c = new ChromeDebuggerClient(42);
    await c.attach();
    expect(mock.debugger.attach).toHaveBeenCalledWith(
      { tabId: 42 },
      '1.3',
      expect.any(Function),
    );
    expect(mock.debugger.onEvent.addListener).toHaveBeenCalled();
    expect(mock.debugger.onDetach.addListener).toHaveBeenCalled();
  });

  it('attach() rejects with DriverError(disconnected) on chrome lastError', async () => {
    mock.debugger.attach = vi.fn((_t, _v, cb: () => void) => {
      mock.runtime.lastError = { message: 'cannot access tab' };
      cb();
      mock.runtime.lastError = undefined;
    });
    const c = new ChromeDebuggerClient(7);
    await expect(c.attach()).rejects.toMatchObject({
      name: 'DriverError',
      code: 'disconnected',
    });
  });

  it('send() resolves with the chrome.debugger callback result', async () => {
    const c = new ChromeDebuggerClient(1);
    await c.attach();
    const r = await c.send('Page.navigate', { url: 'https://x' });
    expect(r).toEqual({ ok: true });
    expect(mock.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 1 },
      'Page.navigate',
      { url: 'https://x' },
      expect.any(Function),
    );
  });

  it('send() rejects when not attached', async () => {
    const c = new ChromeDebuggerClient(1);
    await expect(c.send('Page.enable')).rejects.toMatchObject({
      name: 'DriverError',
      code: 'not_attached',
    });
  });

  it('send() rejects on chrome lastError', async () => {
    mock.debugger.sendCommand = vi.fn(
      (
        _target: { tabId: number },
        _method: string,
        _params: object,
        cb: (result: unknown) => void,
      ) => {
        mock.runtime.lastError = { message: 'protocol error' };
        cb(undefined);
        mock.runtime.lastError = undefined;
      },
    );
    const c = new ChromeDebuggerClient(1);
    await c.attach();
    await expect(c.send('X')).rejects.toThrow('protocol error');
  });

  it('on() handlers fire only for matching tab and method', async () => {
    const c = new ChromeDebuggerClient(7);
    await c.attach();
    const seen: unknown[] = [];
    c.on('Network.requestWillBeSent', (p) => seen.push(p));

    mock.debugger.onEvent._emit({ tabId: 7 }, 'Network.requestWillBeSent', { id: 1 });
    mock.debugger.onEvent._emit({ tabId: 7 }, 'Network.responseReceived', { id: 2 });
    mock.debugger.onEvent._emit({ tabId: 99 }, 'Network.requestWillBeSent', { id: 3 });

    expect(seen).toEqual([{ id: 1 }]);
  });

  it('off() removes the handler and prevents further dispatch', async () => {
    const c = new ChromeDebuggerClient(7);
    await c.attach();
    const fn = vi.fn();
    c.on('Page.loadEventFired', fn);
    c.off('Page.loadEventFired', fn);
    mock.debugger.onEvent._emit({ tabId: 7 }, 'Page.loadEventFired', {});
    expect(fn).not.toHaveBeenCalled();
  });

  it('close() detaches the chrome.debugger session and clears handlers', async () => {
    const c = new ChromeDebuggerClient(1);
    await c.attach();
    const fn = vi.fn();
    c.on('Page.loadEventFired', fn);
    await c.close();
    expect(mock.debugger.detach).toHaveBeenCalledWith({ tabId: 1 }, expect.any(Function));
    expect(mock.debugger.onEvent.removeListener).toHaveBeenCalled();
    // After close, send() rejects.
    await expect(c.send('X')).rejects.toMatchObject({ code: 'not_attached' });
  });
});
