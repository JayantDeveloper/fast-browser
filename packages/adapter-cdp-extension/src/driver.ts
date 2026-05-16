/**
 * BrowserDriver implementation that drives the user's open Chrome tab via
 * the {@link chrome.debugger} extension API. All CDP method translation is
 * inherited from {@link CdpDriverBase}; this class only wires up the
 * chrome.debugger transport.
 */

import { type AttachOptions, DriverError } from '@fast-browser/core';
import { CdpDriverBase } from '@fast-browser/adapter-cdp-shared';

import { ChromeDebuggerClient } from './debugger-client.js';

const DISALLOWED_URL_RE = /^(chrome|chrome-extension|edge|about):\/\//i;
const WEB_STORE_HOST = 'chromewebstore.google.com';

export interface ChromeDebuggerDriverOptions {
  /** The chrome tab id to attach to. Required. */
  tabId: number;
}

export class ChromeDebuggerDriver extends CdpDriverBase {
  private readonly tabId: number;

  constructor(opts: ChromeDebuggerDriverOptions) {
    super();
    this.tabId = opts.tabId;
  }

  override async attach(opts: AttachOptions): Promise<void> {
    if (this.client) {
      return;
    }
    const tabId = opts.tabId ?? this.tabId;
    await assertAttachable(tabId);

    const dbg = new ChromeDebuggerClient(tabId);
    await dbg.attach();
    this.client = dbg;
    await this.enableCommonDomains();

    if (opts.url) {
      await this.navigate(opts.url);
    }
  }
}

/**
 * The Chrome extension host refuses to attach the debugger to its own
 * pages, the Web Store, or the new-tab page. Surface this as a typed
 * DriverError so the loop can present a clean message instead of
 * propagating the raw chrome.runtime.lastError.
 */
async function assertAttachable(tabId: number): Promise<void> {
  const tab = await new Promise<chrome.tabs.Tab>((resolve, reject) => {
    chrome.tabs.get(tabId, (t) => {
      const err = chrome.runtime.lastError;
      if (err || !t) {
        reject(new DriverError('disconnected', err?.message ?? 'tab not found'));
        return;
      }
      resolve(t);
    });
  });
  const url = tab.url ?? '';
  if (DISALLOWED_URL_RE.test(url) || url.includes(WEB_STORE_HOST)) {
    throw new DriverError('disallowed_url', `cannot debug ${url}`);
  }
}
