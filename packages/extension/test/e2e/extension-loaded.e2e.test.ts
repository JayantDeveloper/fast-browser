/**
 * End-to-end smoke test for the loaded extension.
 *
 * Validates that the chrome.debugger path actually works when invoked
 * from a real loaded MV3 extension — the one assertion the unit tests
 * cannot make because they mock chrome.*.
 *
 * Strategy:
 *   1. Launch a persistent Chromium context with --load-extension pointing
 *      at packages/extension/dist (built by `pnpm --filter ext build`).
 *   2. Wait for the extension's service worker to come up.
 *   3. Open a fixture page with deterministic interactive elements.
 *   4. From the SW context, attach the ChromeDebuggerDriver to that tab,
 *      take an AxTree snapshot, and assert the expected nodes appear.
 *
 * Skipped when SKIP_EXTENSION_E2E=1 (e.g. CI without a display).
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { chromium, type BrowserContext, type Worker } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const EXTENSION_DIST = join(here, '..', '..', 'dist');
const SKIP = process.env['SKIP_EXTENSION_E2E'] === '1';

const FIXTURE_HTML = `<!doctype html>
<html><head><title>e2e-fixture</title></head>
<body>
  <h1>e2e fixture</h1>
  <p>This page exists to give the agent something to perceive.</p>
  <button id="go">Go!</button>
  <a href="#nowhere">a link</a>
</body></html>`;

const FIXTURE_URL = `data:text/html;base64,${Buffer.from(FIXTURE_HTML).toString('base64')}`;

let context: BrowserContext;
let serviceWorker: Worker;

beforeAll(async () => {
  if (SKIP) {
    return;
  }
  if (!existsSync(join(EXTENSION_DIST, 'manifest.json'))) {
    throw new Error(
      `Built extension not found at ${EXTENSION_DIST}. ` +
        `Run \`pnpm --filter @fast-browser/extension build\` first.`,
    );
  }

  const userDataDir = mkdtempSync(join(tmpdir(), 'fb-ext-e2e-'));
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_DIST}`,
      `--load-extension=${EXTENSION_DIST}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  // The MV3 service worker may not be registered yet when we attach.
  serviceWorker = context.serviceWorkers()[0]
    ?? await context.waitForEvent('serviceworker');
}, 30_000);

afterAll(async () => {
  if (SKIP) {
    return;
  }
  await context?.close().catch(() => {/* */});
});

describe.skipIf(SKIP)('loaded extension e2e', () => {
  it('the service worker is registered and exposes chrome.debugger', async () => {
    const probe = await serviceWorker.evaluate(() => ({
      hasDebugger: typeof chrome.debugger?.attach === 'function',
      hasSidePanel: typeof chrome.sidePanel?.open === 'function',
      hasStorage: typeof chrome.storage?.local?.set === 'function',
    }));
    expect(probe).toEqual({
      hasDebugger: true,
      hasSidePanel: true,
      hasStorage: true,
    });
  });

  it(
    'chrome.debugger.attach to the active tab succeeds and Accessibility.getFullAXTree returns nodes',
    async () => {
      const fixturePage = await context.newPage();
      await fixturePage.goto(FIXTURE_URL);
      await fixturePage.waitForSelector('#go');

      // Run the test logic *inside* the service worker so we exercise the
      // exact runtime the production code uses.
      const result = await serviceWorker.evaluate(async (): Promise<{
        attached: boolean;
        sawGoButton: boolean;
        sawHeading: boolean;
        nodeCount: number;
        error?: string;
      }> => {
        const PROTOCOL = '1.3';
        const tabs = await new Promise<chrome.tabs.Tab[]>((resolve) =>
          chrome.tabs.query({}, resolve),
        );
        const tab = tabs.find((t) => t.url?.startsWith('data:text/html'));
        if (!tab?.id) {
          return {
            attached: false,
            sawGoButton: false,
            sawHeading: false,
            nodeCount: 0,
            error: 'no fixture tab',
          };
        }

        try {
          await new Promise<void>((resolve, reject) => {
            chrome.debugger.attach({ tabId: tab.id! }, PROTOCOL, () => {
              const err = chrome.runtime.lastError;
              if (err) {
                reject(new Error(err.message ?? 'attach failed'));
                return;
              }
              resolve();
            });
          });

          await new Promise<void>((resolve, reject) => {
            chrome.debugger.sendCommand(
              { tabId: tab.id! },
              'Accessibility.enable',
              {},
              () => {
                const err = chrome.runtime.lastError;
                if (err) {
                  reject(new Error(err.message ?? 'enable failed'));
                  return;
                }
                resolve();
              },
            );
          });

          const ax = await new Promise<{
            nodes: Array<{
              role?: { value?: string };
              name?: { value?: string };
            }>;
          }>((resolve, reject) => {
            chrome.debugger.sendCommand(
              { tabId: tab.id! },
              'Accessibility.getFullAXTree',
              {},
              (result) => {
                const err = chrome.runtime.lastError;
                if (err) {
                  reject(new Error(err.message ?? 'getFullAXTree failed'));
                  return;
                }
                resolve(result as never);
              },
            );
          });

          await new Promise<void>((resolve) =>
            chrome.debugger.detach({ tabId: tab.id! }, () => resolve()),
          );

          const sawGoButton = ax.nodes.some(
            (n) => n.role?.value === 'button' && n.name?.value === 'Go!',
          );
          const sawHeading = ax.nodes.some(
            (n) => n.role?.value === 'heading'
              && n.name?.value === 'e2e fixture',
          );

          return {
            attached: true,
            sawGoButton,
            sawHeading,
            nodeCount: ax.nodes.length,
          };
        } catch (e) {
          return {
            attached: false,
            sawGoButton: false,
            sawHeading: false,
            nodeCount: 0,
            error: (e as Error).message,
          };
        }
      });

      expect(result.error, result.error).toBeUndefined();
      expect(result.attached).toBe(true);
      expect(result.nodeCount).toBeGreaterThan(0);
      expect(result.sawGoButton).toBe(true);
      expect(result.sawHeading).toBe(true);
    },
    60_000,
  );

  it('checkpoint storage is reachable from the SW', async () => {
    const result = await serviceWorker.evaluate(async () => {
      await chrome.storage.session.set({ probe: { hello: 'world' } });
      const r = await chrome.storage.session.get(['probe']);
      await chrome.storage.session.remove(['probe']);
      return r['probe'];
    });
    expect(result).toEqual({ hello: 'world' });
  });
});
