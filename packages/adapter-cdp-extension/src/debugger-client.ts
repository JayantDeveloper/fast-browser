/**
 * Wraps the callback-style {@link chrome.debugger} API in the
 * promise / event-emitter shape expected by {@link CdpClient}.
 *
 * One ChromeDebuggerClient instance owns one attached tab. The instance
 * fans out chrome.debugger.onEvent (which delivers EVERY event for ANY
 * attached tab through a single global listener) into per-event-name
 * handlers so callers can subscribe with `client.on('Domain.method', fn)`
 * just like chrome-remote-interface.
 */

import { DriverError } from '@fast-browser/core';
import type { CdpClient } from '@fast-browser/adapter-cdp-shared';

const REQUIRED_PROTOCOL_VERSION = '1.3';

type EventHandler = (params: unknown) => void;

interface DebuggerError {
  message?: string;
}

/**
 * Chrome runtime error type. We treat the absence of `chrome.runtime`
 * (e.g. the package being imported in a non-extension context like a unit
 * test) as a hard failure rather than silently no-op'ing.
 */
function lastError(): DebuggerError | undefined {
  return chrome.runtime.lastError;
}

export class ChromeDebuggerClient implements CdpClient {
  private readonly tabId: number;
  private readonly handlers = new Map<string, Set<EventHandler>>();
  private readonly globalEventListener: (
    source: chrome.debugger.Debuggee,
    method: string,
    params?: object,
  ) => void;
  private attached = false;

  constructor(tabId: number) {
    this.tabId = tabId;
    this.globalEventListener = (source, method, params) => {
      if (source.tabId !== this.tabId) {
        return;
      }
      const set = this.handlers.get(method);
      if (!set) {
        return;
      }
      for (const fn of set) {
        try {
          fn(params);
        } catch {
          // A misbehaving handler must not break event dispatch.
        }
      }
    };
  }

  /**
   * Attach the underlying chrome.debugger session and start receiving
   * events. Idempotent.
   */
  async attach(): Promise<void> {
    if (this.attached) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      chrome.debugger.attach(
        { tabId: this.tabId },
        REQUIRED_PROTOCOL_VERSION,
        () => {
          const err = lastError();
          if (err) {
            reject(new DriverError('disconnected', err.message ?? 'attach'));
            return;
          }
          resolve();
        },
      );
    });
    chrome.debugger.onEvent.addListener(this.globalEventListener);
    chrome.debugger.onDetach.addListener(this.handleDetach);
    this.attached = true;
  }

  send(method: string, params?: unknown): Promise<unknown> {
    if (!this.attached) {
      return Promise.reject(new DriverError('not_attached'));
    }
    return new Promise((resolve, reject) => {
      chrome.debugger.sendCommand(
        { tabId: this.tabId },
        method,
        // sendCommand requires `object | undefined`; reject other shapes.
        (params as object | undefined) ?? {},
        (result) => {
          const err = lastError();
          if (err) {
            reject(new Error(err.message ?? `${method} failed`));
            return;
          }
          resolve(result as unknown);
        },
      );
    });
  }

  on(event: string, handler: EventHandler): void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
  }

  off(event: string, handler: EventHandler): void {
    const set = this.handlers.get(event);
    if (!set) {
      return;
    }
    set.delete(handler);
    if (set.size === 0) {
      this.handlers.delete(event);
    }
  }

  async close(): Promise<void> {
    if (!this.attached) {
      return;
    }
    chrome.debugger.onEvent.removeListener(this.globalEventListener);
    chrome.debugger.onDetach.removeListener(this.handleDetach);
    this.attached = false;
    this.handlers.clear();
    await new Promise<void>((resolve) => {
      chrome.debugger.detach({ tabId: this.tabId }, () => {
        // We deliberately swallow lastError here — detach can race with
        // tab close, and the result either way is "not attached".
        void lastError();
        resolve();
      });
    });
  }

  /**
   * Bound so we can pass it directly to addListener / removeListener.
   * Fires when chrome detaches us unexpectedly (tab closed, devtools
   * opened, etc) — we mark ourselves detached so subsequent send() calls
   * reject cleanly.
   */
  private handleDetach = (
    source: chrome.debugger.Debuggee,
    _reason: string,
  ): void => {
    if (source.tabId !== this.tabId) {
      return;
    }
    this.attached = false;
    this.handlers.clear();
  };
}
