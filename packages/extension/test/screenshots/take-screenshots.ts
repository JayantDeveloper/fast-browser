/**
 * Generates Chrome Web Store marketing screenshots at 1280x800.
 *
 * Strategy: load each entrypoint HTML directly as a regular page, then
 * inject the DOM state we want to showcase. We avoid relying on the
 * chrome.runtime port plumbing (which is finicky to mock across page
 * navigations) by writing the trajectory cards into the DOM directly.
 */

import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type BrowserContext } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const EXTENSION_DIST = join(here, '..', '..', 'dist');
const OUT_DIR = join(here, 'out');

const VIEWPORT = { width: 1280, height: 800 };

interface MockStep {
  index: number;
  type: string;
  ok: boolean;
  errorCode?: string;
  summary: string;
  latencyMs: number;
  costUsd: number;
}

const MOCK_STEPS: MockStep[] = [
  {
    index: 1,
    type: 'click',
    ok: true,
    summary: "clicked link 'Project Gutenberg – keeps getting better'",
    latencyMs: 712,
    costUsd: 0.001724,
  },
  {
    index: 2,
    type: 'scroll',
    ok: true,
    summary: 'scrolled down 600px',
    latencyMs: 643,
    costUsd: 0.001257,
  },
  {
    index: 3,
    type: 'done',
    ok: true,
    summary: 'Project Gutenberg – keeps getting better — 813 points',
    latencyMs: 824,
    costUsd: 0.002338,
  },
];

const TASK_TEXT =
  'Find the top story on Hacker News and tell me its title and points.';

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const userDataDir = mkdtempSync(join(tmpdir(), 'fb-screens-'));

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: VIEWPORT,
    args: [
      `--disable-extensions-except=${EXTENSION_DIST}`,
      `--load-extension=${EXTENSION_DIST}`,
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  try {
    const extensionId = await resolveExtensionId(context);
    console.log(`extension id: ${extensionId}`);

    await captureSidePanel(context, extensionId, 'idle');
    await captureSidePanel(context, extensionId, 'running');
    await captureSidePanel(context, extensionId, 'done');
    await captureOptions(context, extensionId);

    console.log(`✔ screenshots written to ${OUT_DIR}`);
  } finally {
    await context.close();
  }
}

async function resolveExtensionId(context: BrowserContext): Promise<string> {
  const sw = context.serviceWorkers()[0]
    ?? await context.waitForEvent('serviceworker');
  return new URL(sw.url()).host;
}

type PanelState = 'idle' | 'running' | 'done';

async function captureSidePanel(
  context: BrowserContext,
  extensionId: string,
  state: PanelState,
): Promise<void> {
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORT);

  // Stub chrome.runtime to a no-op so the panel script doesn't throw on
  // chrome.runtime.connect; we paint the visual state directly afterwards.
  await page.addInitScript(() => {
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        connect: () => ({
          onMessage: { addListener: () => {/* no-op */} },
          postMessage: () => {/* no-op */},
          disconnect: () => {/* no-op */},
        }),
        openOptionsPage: () => {/* no-op */},
      },
    };
  });

  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await page.waitForSelector('#task');

  await page.evaluate(
    ({ state, task, steps }) => {
      const taskEl = document.getElementById('task') as HTMLTextAreaElement;
      taskEl.value = task;

      const pill = document.getElementById('status-pill') as HTMLElement;
      const statusMsg = document.getElementById('status-message') as HTMLElement;
      const trace = document.getElementById('trace') as HTMLOListElement;
      const resultSection = document.getElementById('result-section') as HTMLElement;
      const resultSummary = document.getElementById('result-summary') as HTMLElement;
      const resultText = document.getElementById('result-text') as HTMLElement;

      const labels: Record<typeof state, string> = {
        idle: 'idle',
        running: 'running',
        done: 'done',
      };
      pill.textContent = labels[state];
      pill.className = `pill ${state}`;
      statusMsg.textContent =
        state === 'running' ? 'step 3 of ~3 · 2.3s elapsed' : '';

      if (state === 'idle') {
        return;
      }

      const stepsToRender = state === 'done'
        ? steps
        : steps.slice(0, steps.length - 1);

      for (const s of stepsToRender) {
        const li = document.createElement('li');
        li.className = s.ok ? 'step-ok' : 'step-fail';
        const tag = s.ok ? '✓' : `✗(${s.errorCode ?? 'err'})`;
        const cost = s.costUsd
          ? `$${s.costUsd.toFixed(6)}`
          : '';
        li.innerHTML =
          `<strong>${s.type}</strong> ${tag} ` +
          `<span class="step-meta">${s.latencyMs}ms ${cost}</span><br>` +
          `<span>${s.summary}</span>`;
        trace.appendChild(li);
      }

      if (state === 'done') {
        resultSection.hidden = false;
        resultSummary.textContent =
          'success • 3 steps • 6.1s • $0.0053';
        resultText.textContent =
          'Project Gutenberg – keeps getting better — 813 points';
      }
    },
    { state, task: TASK_TEXT, steps: MOCK_STEPS },
  );

  await page.waitForTimeout(250);
  const out = join(OUT_DIR, `sidepanel-${state}.png`);
  await page.screenshot({ path: out, type: 'png' });
  console.log(`  wrote ${out}`);
  await page.close();
}

async function captureOptions(
  context: BrowserContext,
  extensionId: string,
): Promise<void> {
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORT);

  await page.addInitScript(() => {
    const settings = {
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      maxSteps: 60,
      apiKeys: {
        anthropic: 'sk-ant-•••••••••••••••••••••••••••••••••••',
        gemini: '',
        openrouter: '',
      },
    };
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: {
        local: {
          get: () => Promise.resolve({ fastBrowserSettings: settings }),
          set: () => Promise.resolve(),
        },
      },
    };
  });

  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.waitForTimeout(500);
  const out = join(OUT_DIR, 'options.png');
  await page.screenshot({ path: out, type: 'png' });
  console.log(`  wrote ${out}`);
  await page.close();
}

void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
