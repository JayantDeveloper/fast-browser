/**
 * Chrome Web Store marketing screenshots at 1280×800.
 *
 * Each shot composites a real target-page screenshot (left ~880px) with
 * the actual sidepanel HTML rendered at its real ~400px width (right),
 * inside a faux browser chrome so the panel feels docked rather than
 * floating on a blank canvas.
 *
 * Run: pnpm --filter @fast-browser/extension exec tsx test/screenshots/take-screenshots.ts
 * Output: packages/extension/test/screenshots/out/*.png
 */

import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type BrowserContext } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const EXT_DIST = join(here, '..', '..', 'dist');
const OUT_DIR = join(here, 'out');

const CANVAS = { width: 1280, height: 800 };
const TARGET_WIDTH = 868;
const PANEL_WIDTH = 412;
const CHROME_HEADER_H = 36;

const TARGET_URL = 'https://news.ycombinator.com';
const TASK_TEXT =
  'Find the top story on Hacker News and tell me its title and points.';

interface MockStep {
  index: number;
  type: string;
  ok: boolean;
  summary: string;
  latencyMs: number;
  costUsd: number;
}

const STEPS: MockStep[] = [
  {
    index: 1,
    type: 'click',
    ok: true,
    summary: "clicked link 'Project Gutenberg keeps getting better'",
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
    summary: 'Project Gutenberg — keeps getting better — 813 points',
    latencyMs: 824,
    costUsd: 0.002338,
  },
];

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const userDataDir = mkdtempSync(join(tmpdir(), 'fb-screens-'));

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    viewport: CANVAS,
    args: [
      `--disable-extensions-except=${EXT_DIST}`,
      `--load-extension=${EXT_DIST}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  try {
    const targetShot = await captureTarget(context);
    const panelHtml = readFileSync(join(EXT_DIST, 'sidepanel.html'), 'utf8');
    const panelCss = readFileSync(join(EXT_DIST, 'sidepanel.css'), 'utf8');

    for (const state of ['idle', 'running', 'done'] as const) {
      await renderComposite(context, targetShot, panelHtml, panelCss, state);
    }
    await renderOptions(context);

    console.log(`✔ marketing screenshots written to ${OUT_DIR}`);
  } finally {
    await context.close();
  }
}

async function captureTarget(context: BrowserContext): Promise<string> {
  const page = await context.newPage();
  await page.setViewportSize({
    width: TARGET_WIDTH,
    height: CANVAS.height - CHROME_HEADER_H,
  });
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const path = join(OUT_DIR, '_target.png');
  await page.screenshot({ path, type: 'png' });
  await page.close();
  return path;
}

type PanelState = 'idle' | 'running' | 'done';

async function renderComposite(
  context: BrowserContext,
  targetShotPath: string,
  panelHtml: string,
  panelCss: string,
  state: PanelState,
): Promise<void> {
  const panelBody = extractBody(panelHtml);
  const html = buildCompositeHtml({
    targetDataUri: pngToDataUri(targetShotPath),
    panelBody,
    panelCss,
    state,
  });

  const tmpFile = join(OUT_DIR, `_composite-${state}.html`);
  writeFileSync(tmpFile, html);

  const page = await context.newPage();
  await page.setViewportSize(CANVAS);
  await page.goto(`file://${tmpFile}`);
  await page.waitForSelector('#run');
  await page.evaluate(applyPanelState, { state, task: TASK_TEXT, steps: STEPS });
  await page.waitForTimeout(150);

  const out = join(OUT_DIR, `sidepanel-${state}.png`);
  await page.screenshot({ path: out, type: 'png' });
  console.log(`  wrote ${out}`);
  await page.close();
}

async function renderOptions(context: BrowserContext): Promise<void> {
  const optionsHtml = readFileSync(join(EXT_DIST, 'options.html'), 'utf8');
  const optionsCss = readFileSync(join(EXT_DIST, 'options.css'), 'utf8');
  const body = extractBody(optionsHtml);

  const html = buildOptionsHtml({ body, css: optionsCss });
  const tmpFile = join(OUT_DIR, '_options.html');
  writeFileSync(tmpFile, html);

  const page = await context.newPage();
  await page.setViewportSize(CANVAS);
  await page.goto(`file://${tmpFile}`);
  await page.waitForSelector('#model');
  await page.evaluate(applyOptionsState);
  await page.waitForTimeout(150);

  const out = join(OUT_DIR, 'options.png');
  await page.screenshot({ path: out, type: 'png' });
  console.log(`  wrote ${out}`);
  await page.close();
}

function extractBody(html: string): string {
  const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return m?.[1] ?? '';
}

function pngToDataUri(path: string): string {
  const bytes = readFileSync(path);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

function buildCompositeHtml(args: {
  targetDataUri: string;
  panelBody: string;
  panelCss: string;
  state: PanelState;
}): string {
  return `<!doctype html>
<html><head>
  <meta charset="utf-8">
  <style>
    html, body { margin: 0; padding: 0; background: #1f2937; font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif; }
    .canvas { width: 1280px; height: 800px; display: flex; flex-direction: column; background: #1f2937; }
    .header { height: ${CHROME_HEADER_H}px; background: #e5e7eb; display: flex; align-items: center; padding: 0 14px; gap: 8px; border-bottom: 1px solid #cbd5e1; }
    .dot { width: 12px; height: 12px; border-radius: 50%; }
    .dot.r { background: #ef4444; }
    .dot.y { background: #f59e0b; }
    .dot.g { background: #10b981; }
    .urlbar { flex: 1; height: 22px; margin-left: 14px; background: #fff; border-radius: 11px; display: flex; align-items: center; padding: 0 12px; font-size: 12px; color: #475569; font-family: ui-monospace, 'SF Mono', monospace; }
    .stage { flex: 1; display: flex; }
    .target { width: ${TARGET_WIDTH}px; height: 100%; background-image: url('${args.targetDataUri}'); background-size: cover; background-position: top left; background-repeat: no-repeat; }
    .panel { width: ${PANEL_WIDTH}px; height: 100%; border-left: 1px solid #cbd5e1; overflow: hidden; background: #f7f8fb; }
    /* embedded sidepanel css */
    ${args.panelCss}
    /* override: kill height: 100vh so the panel doesn't try to extend past the stage */
    body { min-height: auto !important; padding: 14px !important; height: ${CANVAS.height - CHROME_HEADER_H}px !important; box-sizing: border-box !important; overflow: hidden; }
    /* the panel CSS uses body styles; we re-scope them under .panel-wrap */
  </style>
</head>
<body>
  <div class="canvas">
    <div class="header">
      <div class="dot r"></div><div class="dot y"></div><div class="dot g"></div>
      <div class="urlbar">${
        args.state === 'idle' ? 'news.ycombinator.com' : 'news.ycombinator.com'
      }</div>
    </div>
    <div class="stage">
      <div class="target"></div>
      <div class="panel">${args.panelBody}</div>
    </div>
  </div>
  <script>
    // Stub chrome.runtime so the panel's connect() doesn't throw
    window.chrome = {
      runtime: {
        connect: () => ({
          onMessage: { addListener: () => {} },
          onDisconnect: { addListener: () => {} },
          postMessage: () => {},
          disconnect: () => {},
        }),
        openOptionsPage: () => {},
      },
      storage: { local: { get: async () => ({}), set: async () => undefined } },
    };
  </script>
  <script type="module" src="file://${join(EXT_DIST, 'sidepanel.js')}"></script>
</body></html>`;
}

function buildOptionsHtml(args: { body: string; css: string }): string {
  return `<!doctype html>
<html><head>
  <meta charset="utf-8">
  <style>${args.css}</style>
</head>
<body>
  ${args.body}
  <script>
    window.chrome = {
      runtime: { openOptionsPage: () => {} },
      storage: {
        local: {
          get: async () => ({
            fastBrowserSettings: {
              provider: 'anthropic',
              model: 'claude-haiku-4-5',
              maxSteps: 60,
              apiKeys: {
                anthropic: 'sk-ant-•••••••••••••••••••••••••••••••••••',
                gemini: '',
                openrouter: '',
              },
            },
          }),
          set: async () => undefined,
        },
      },
    };
  </script>
  <script type="module" src="file://${join(EXT_DIST, 'options.js')}"></script>
</body></html>`;
}

// Runs in page context — paints the panel into the requested state by
// directly setting DOM (since chrome.runtime is stubbed and no real port
// is connected).
function applyPanelState(args: {
  state: PanelState;
  task: string;
  steps: MockStep[];
}): void {
  const task = document.getElementById('task') as HTMLTextAreaElement;
  const pill = document.getElementById('status-pill') as HTMLElement;
  const trace = document.getElementById('trace') as HTMLOListElement;
  const resultSection = document.getElementById('result-section') as HTMLElement;
  const resultSummary = document.getElementById('result-summary') as HTMLElement;
  const resultText = document.getElementById('result-text') as HTMLElement;

  task.value = args.task;
  const labels = { idle: 'idle', running: 'running', done: 'done' };
  pill.textContent = labels[args.state];
  pill.className = `pill ${args.state}`;

  if (args.state === 'idle') return;

  const stepsToShow = args.state === 'done'
    ? args.steps
    : args.steps.slice(0, args.steps.length - 1);

  for (const s of stepsToShow) {
    const li = document.createElement('li');
    li.className = s.ok ? 'step-ok' : 'step-fail';
    const tag = s.ok ? '✓' : '✗';
    const cost = s.costUsd
      ? `$${s.costUsd.toFixed(6)}`
      : '';
    li.innerHTML =
      `<strong>${s.type}</strong> ${tag} ` +
      `<span class="step-meta">${s.latencyMs}ms ${cost}</span><br>` +
      `<span>${s.summary}</span>`;
    trace.appendChild(li);
  }

  if (args.state === 'done') {
    resultSection.hidden = false;
    resultSummary.textContent =
      'success • 3 steps • 6.1s • $0.0053';
    resultText.textContent =
      'Project Gutenberg — keeps getting better — 813 points';
  }
}

function applyOptionsState(): void {
  // The options.js hydrate() reads from chrome.storage.local which we stubbed;
  // give it a beat to populate.
  // No additional action needed — fields populate themselves.
  void 0;
}

void main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
