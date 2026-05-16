/**
 * Visible demo of the extension in action.
 *
 * Launches a real headed Chrome window with the unpacked extension
 * loaded, opens a target page in one tab + the side panel as another
 * tab side-by-side, then drives the agent via the SW's __fb_test hook
 * so events stream into the panel UI in real time. You watch.
 *
 * Run: pnpm exec tsx test/demos/visible-demo.ts
 *
 * Required env: ANTHROPIC_API_KEY (or pass --model gemini:... with
 * GEMINI_API_KEY).
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type BrowserContext } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const EXTENSION_DIST = join(here, '..', '..', 'dist');

const TARGET_URL = process.env['DEMO_URL']
  ?? 'https://news.ycombinator.com';
const TASK = process.env['DEMO_TASK']
  ?? "Look at the Hacker News front page. Find the story currently ranked #1 (the first story listed). Emit done with the result containing both the story's title and its score in points (format: '<title> — <N> points'). The titles are clickable links; the points appear under each story.";

const MODEL_SPEC = process.env['DEMO_MODEL'] ?? 'anthropic:claude-haiku-4-5';
const MAX_STEPS = Number(process.env['DEMO_MAX_STEPS'] ?? 12);

async function main(): Promise<void> {
  const apiKey = pickApiKey(MODEL_SPEC);
  const userDataDir = mkdtempSync(join(tmpdir(), 'fb-demo-'));

  console.log(`\n→ launching Chrome with extension at ${EXTENSION_DIST}`);
  console.log(`→ task: ${TASK}`);
  console.log(`→ url:  ${TARGET_URL}`);
  console.log(`→ model: ${MODEL_SPEC}\n`);

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: [
      `--disable-extensions-except=${EXTENSION_DIST}`,
      `--load-extension=${EXTENSION_DIST}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1280,860',
    ],
  });

  try {
    const sw = context.serviceWorkers()[0]
      ?? await context.waitForEvent('serviceworker');
    const extensionId = new URL(sw.url()).host;
    console.log(`→ extension id: ${extensionId}\n`);

    // tsx compiles our evaluate callback through esbuild, which preserves
    // function.name by inserting calls to a helper named __name. The SW
    // global doesn't have that helper, so the callback throws on first
    // line. Inject a no-op polyfill before any evaluate runs.
    await sw.evaluate(`globalThis.__name = (fn) => fn;`);

    // Open the target page first so it can become the focused window.
    const targetPage = await context.newPage();
    await targetPage.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });
    await targetPage.waitForTimeout(1500);

    // Open the side panel as a separate tab. The panel script will
    // connect to the SW via runtime.connect; we'll mirror trajectory
    // events into its DOM so it visibly updates as the agent works.
    const panelPage = await context.newPage();
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panelPage.waitForSelector('#task');
    await panelPage.fill('#task', TASK);

    // Resolve the target tab id from the SW's chrome.tabs view.
    const targetTabId = await sw.evaluate(async (url) => {
      const tabs = await new Promise<chrome.tabs.Tab[]>((resolve) =>
        chrome.tabs.query({}, resolve),
      );
      const t = tabs.find((x) => x.url === url || x.url?.startsWith(url));
      return t?.id ?? null;
    }, TARGET_URL);
    if (!targetTabId) {
      throw new Error(`could not resolve target tab for ${TARGET_URL}`);
    }
    console.log(`→ target tab id: ${targetTabId}\n`);
    console.log(`watch the right window — the agent will start in ~2s.\n`);
    console.log(`-------- trajectory --------`);

    // Focus the target tab so the agent's actions are visible.
    await targetPage.bringToFront();
    await targetPage.waitForTimeout(2000);

    // Drive the agent inside the SW context. We mirror each step into
    // the panel's DOM so the panel tab also visibly updates.
    const result = await sw.evaluate(
      async ({ tabId, task, model, apiKey, maxSteps, panelTabId }) => {
        const fb = (globalThis as unknown as {
          __fb_test?: {
            run: (...a: unknown[]) => Promise<Record<string, unknown>>;
            AnthropicProvider: new (opts: unknown) => unknown;
            GeminiProvider: new (opts: unknown) => unknown;
            OpenRouterProvider: new (opts: unknown) => unknown;
            ChromeDebuggerDriver: new (opts: { tabId: number }) => {
              attach: (opts: { tabId: number }) => Promise<void>;
              detach: () => Promise<void>;
            };
          };
        }).__fb_test;
        if (!fb) {
          return { error: '__fb_test not exposed' };
        }
        const [providerName, ...modelParts] = model.split(':');
        const modelName = modelParts.join(':');
        const Provider = providerName === 'gemini'
          ? fb.GeminiProvider
          : providerName === 'openrouter'
            ? fb.OpenRouterProvider
            : fb.AnthropicProvider;

        const driver = new fb.ChromeDebuggerDriver({ tabId });
        await driver.attach({ tabId });
        const actor = new Provider({ apiKey, model: modelName });

        // Acknowledge unused panelTabId (we use runtime.sendMessage which
        // broadcasts to all extension pages, not a specific tab).
        void panelTabId;

        try {
          const r = await fb.run(
            driver,
            {
              actor,
              maxSteps,
              onStep: (step: unknown) => {
                void chrome.runtime
                  .sendMessage({ type: 'demo-step', step })
                  .catch(() => undefined);
              },
            },
            { task },
          );
          void chrome.runtime
            .sendMessage({
              type: 'demo-done',
              payload: r as Record<string, unknown>,
            })
            .catch(() => undefined);
          return { ...r, trajectory: undefined };
        } finally {
          await driver.detach().catch(() => undefined);
        }
      },
      {
        tabId: targetTabId,
        task: TASK,
        model: MODEL_SPEC,
        apiKey,
        maxSteps: MAX_STEPS,
        panelTabId: await panelTabIdFrom(panelPage),
      },
    );

    console.log(`\n----- done -----`);
    console.log(JSON.stringify(result, null, 2));
    console.log(
      `\nThe Chrome window will stay open for 30 seconds so you can read the result.`,
    );
    await new Promise((r) => setTimeout(r, 30_000));
  } finally {
    await context.close();
  }
}

function pickApiKey(modelSpec: string): string {
  const provider = modelSpec.split(':')[0];
  const map: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    gemini: 'GEMINI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
  };
  const envName = map[provider!];
  if (!envName) {
    throw new Error(`unknown provider ${provider}`);
  }
  const key = process.env[envName];
  if (!key) {
    throw new Error(`${envName} not set`);
  }
  return key;
}

async function panelTabIdFrom(
  page: import('playwright').Page,
): Promise<number> {
  // Inject a small listener into the panel page that mirrors every
  // step/done message we'll send into its DOM. Then resolve its tab id.
  await page.evaluate(() => {
    const trace = document.getElementById('trace') as HTMLOListElement;
    const pill = document.getElementById('status-pill') as HTMLSpanElement;
    pill.textContent = 'running';
    pill.className = 'pill running';
    chrome.runtime.onMessage.addListener((msg: { type?: string; step?: { index: number; action: { type: string }; result: { ok: boolean; error?: string; summary: string }; llmLatencyMs: number; llmUsage?: { costUsd?: number } }; payload?: { success: boolean; finalResult: string; steps: number; wallMs: number; costUsdEstimate: number } }) => {
      if (msg.type === 'demo-step' && msg.step) {
        const s = msg.step;
        const li = document.createElement('li');
        li.className = s.result.ok ? 'step-ok' : 'step-fail';
        const tag = s.result.ok ? '✓' : `✗(${s.result.error ?? ''})`;
        const cost = s.llmUsage?.costUsd
          ? `$${s.llmUsage.costUsd.toFixed(6)}`
          : '';
        li.innerHTML =
          `<strong>${s.action.type}</strong> ${tag} ` +
          `<span class="step-meta">${s.llmLatencyMs}ms ${cost}</span><br>` +
          `<span>${(s.result.summary || '').replace(/</g, '&lt;')}</span>`;
        trace.appendChild(li);
        li.scrollIntoView({ block: 'end' });
      } else if (msg.type === 'demo-done' && msg.payload) {
        const r = msg.payload;
        pill.textContent = r.success ? 'done' : 'error';
        pill.className = `pill ${r.success ? 'done' : 'error'}`;
        const section = document.getElementById('result-section') as HTMLElement;
        const summary = document.getElementById('result-summary') as HTMLElement;
        const resultText = document.getElementById('result-text') as HTMLElement;
        section.hidden = false;
        summary.textContent =
          `${r.success ? 'success' : 'failure'} • ${r.steps} steps • ` +
          `${(r.wallMs / 1000).toFixed(1)}s • $${r.costUsdEstimate.toFixed(4)}`;
        resultText.textContent = r.finalResult;
      }
    });
  });
  // Tab id resolution via webContents — simplest path is to query
  // chrome.tabs for the active sidepanel.html tab.
  const sw = await waitForServiceWorker(page);
  return sw.evaluate(async () => {
    const tabs = await new Promise<chrome.tabs.Tab[]>((resolve) =>
      chrome.tabs.query({ url: '*://*/sidepanel.html' }, resolve),
    );
    const t = tabs.find((x) => x.url?.endsWith('/sidepanel.html'));
    if (t?.id) return t.id;
    // fallback: any extension tab
    const more = await new Promise<chrome.tabs.Tab[]>((resolve) =>
      chrome.tabs.query({}, resolve),
    );
    return more.find((x) => x.url?.endsWith('/sidepanel.html'))?.id ?? -1;
  });
}

async function waitForServiceWorker(
  page: import('playwright').Page,
): Promise<import('playwright').Worker> {
  const ctx = page.context();
  return ctx.serviceWorkers()[0]
    ?? await ctx.waitForEvent('serviceworker');
}

void main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
