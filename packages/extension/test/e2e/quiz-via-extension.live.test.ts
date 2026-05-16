/**
 * Live end-to-end test: drive the W3Schools HTML quiz THROUGH the loaded
 * extension's chrome.debugger transport with a real Anthropic LLM.
 *
 * Validates the full production path:
 *   service worker  →  ChromeDebuggerDriver (chrome.debugger.attach)
 *                  →  core.run()
 *                  →  AnthropicProvider (real network call)
 *                  →  per-step actions on a real public website
 *                  →  done with score
 *
 * Cost: ~$0.31 with Haiku 4.5. Wall: ~5 min. Gated behind RUN_LIVE_QUIZ=1
 * because of the cost; never runs in normal `pnpm test`.
 */

import { dirname, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { chromium, type BrowserContext, type Worker } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const EXTENSION_DIST = join(here, '..', '..', 'dist');
const RUN_LIVE = process.env['RUN_LIVE_QUIZ'] === '1';
const QUIZ_URL = 'https://www.w3schools.com/quiztest/quiztest.asp?qtest=HTML';
const TASK = [
  'Take this 40-question HTML quiz. The quiz is already on screen — Question 1 of 40.',
  'For each question: read the question stem in the visible text, click the radio',
  "button for the answer you believe is correct, then click the button labeled 'Next ❯'",
  "to advance. After Question 40 the page shows a final score like 'You answered X out of",
  "40 questions correctly'. When you see that score, emit done with the score string.",
  'Important: after clicking a radio, ALWAYS click \'Next ❯\' before reading the next question.',
].join(' ');

let context: BrowserContext;
let serviceWorker: Worker;

beforeAll(async () => {
  if (!RUN_LIVE) {
    return;
  }
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY required for live quiz test');
  }

  const userDataDir = mkdtempSync(join(tmpdir(), 'fb-quiz-e2e-'));
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_DIST}`,
      `--load-extension=${EXTENSION_DIST}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
  serviceWorker = context.serviceWorkers()[0]
    ?? await context.waitForEvent('serviceworker');
}, 30_000);

afterAll(async () => {
  if (!RUN_LIVE) {
    return;
  }
  await context?.close().catch(() => {/* */});
});

describe.skipIf(!RUN_LIVE)('quiz via loaded extension', () => {
  it(
    'drives the W3Schools HTML quiz to completion via chrome.debugger',
    async () => {
      const apiKey = process.env['ANTHROPIC_API_KEY']!;

      // Open the quiz page; this is the tab the agent will attach to.
      const quizPage = await context.newPage();
      await quizPage.goto(QUIZ_URL, { waitUntil: 'domcontentloaded' });
      await quizPage.waitForTimeout(1500);
      const tabId = await quizPage.evaluate(
        () => (window as unknown as { __pwTabId?: number }).__pwTabId,
      ) ?? null;
      // Playwright doesn't expose tabId; resolve via chrome.tabs.query.
      const resolvedTabId = await serviceWorker.evaluate(async () => {
        const tabs = await new Promise<chrome.tabs.Tab[]>((resolve) =>
          chrome.tabs.query(
            { url: '*://www.w3schools.com/quiztest/*' },
            resolve,
          ),
        );
        return tabs[0]?.id ?? null;
      });
      expect(resolvedTabId, 'quiz tab not found').toBeTypeOf('number');
      void tabId;

      // Run the agent loop inside the SW context against the quiz tab.
      const result = await serviceWorker.evaluate(
        async ({ tabId, task, apiKey }) => {
          const fb = (globalThis as unknown as {
            __fb_test: {
              run: (...a: unknown[]) => Promise<unknown>;
              AnthropicProvider: new (opts: unknown) => unknown;
              ChromeDebuggerDriver: new (opts: { tabId: number }) => {
                attach: (opts: { tabId: number }) => Promise<void>;
                detach: () => Promise<void>;
              };
            };
          }).__fb_test;
          if (!fb) {
            return { error: '__fb_test not exposed' } as Record<string, unknown>;
          }

          const driver = new fb.ChromeDebuggerDriver({ tabId });
          await driver.attach({ tabId });
          const actor = new fb.AnthropicProvider({
            apiKey,
            model: 'claude-haiku-4-5',
          });

          try {
            const stepCounts: number[] = [];
            const r = (await fb.run(
              driver,
              {
                actor,
                maxSteps: 130,
                onStep: (step: { index: number }) => {
                  stepCounts.push(step.index);
                },
              },
              { task },
            )) as Record<string, unknown>;
            return {
              ...r,
              recordedSteps: stepCounts.length,
              trajectory: undefined,
            };
          } finally {
            await driver.detach().catch(() => {/* */});
          }
        },
        { tabId: resolvedTabId!, task: TASK, apiKey },
      );

      // eslint-disable-next-line no-console
      console.log('quiz e2e result:', JSON.stringify(result, null, 2));
      expect(
        (result as Record<string, unknown>)['error'],
        (result as Record<string, unknown>)['error'] as string,
      ).toBeUndefined();
      expect((result as { success: boolean }).success).toBe(true);
      const finalResult = (result as { finalResult: string }).finalResult;
      expect(finalResult).toMatch(/\d+\s*(of|\/|out of)\s*40/i);
    },
    10 * 60 * 1000,
  );
});
