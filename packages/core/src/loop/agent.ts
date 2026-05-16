import { execute } from '../actions/executor.js';
import type { Action } from '../actions/vocabulary.js';
import type { BrowserDriver } from '../driver.js';
import { ACTION_SCHEMA, SYSTEM_PROMPT, buildUserPrompt } from '../llm/prompts.js';
import { LlmError } from '../llm/types.js';
import type { AskJsonResult } from '../llm/types.js';
import type { PerceptionFrame } from '../perception/types.js';
import { serializeFrame, snapshot } from '../perception/snapshot.js';
import { maybeDismissConsent } from '../robustness/consent.js';
import { LoopDetector } from '../robustness/loop-detect.js';

import { History } from './history.js';
import type { AgentConfig, RunResult, TrajectoryStep } from './types.js';

const DEFAULT_MAX_STEPS = 60;
const DEFAULT_HISTORY_WINDOW = 8;
const ACTOR_MAX_TOKENS = 256;
const ERR_MESSAGE_CAP = 200;
const READY_TIMEOUT_MS = 3000;
const READY_STABLE_MS = 200;

const NOOP_ACTION: Action = { type: 'wait_for', ms: 0 };
const EMPTY_USAGE = { inputTokens: 0, outputTokens: 0 };

export interface RunInput {
  task: string;
  /** If provided, navigate here before the loop starts. */
  startUrl?: string;
}

/**
 * Per-step agent loop. Drives the BrowserDriver via
 * perception → LLM → action and records each step into a structured
 * trajectory.
 *
 * Resolves with a {@link RunResult} when the model emits `done`, when
 * `maxSteps` is exhausted, or when two consecutive LLM calls fail.
 */
export async function run(
  driver: BrowserDriver,
  config: AgentConfig,
  input: RunInput,
): Promise<RunResult> {
  const maxSteps = config.maxSteps ?? DEFAULT_MAX_STEPS;
  const historyWindow = config.historyWindow ?? DEFAULT_HISTORY_WINDOW;
  const history = new History();
  const detector = new LoopDetector();
  const dismissedOrigins = new Set<string>();
  const startedAt = Date.now();

  let costUsd = 0;
  let stuckNotice: string | undefined;

  if (input.startUrl) {
    await driver.navigate(input.startUrl);
  }

  for (let stepIndex = 1; stepIndex <= maxSteps; stepIndex += 1) {
    const meta = await driver.getPageMeta();
    config.onTurnStart?.({ step: stepIndex, url: meta.url });

    const frame = await prepareFrame(driver, dismissedOrigins);
    const userPrompt = renderPrompt({
      task: input.task,
      history,
      historyWindow,
      frame,
      stuckNotice,
    });
    stuckNotice = undefined;

    const askResult = await tryAskActor(config, userPrompt);
    if (!askResult.ok) {
      recordFailedStep(history, stepIndex, frame, askResult.summary, config);
      if (hasConsecutiveParseErrors(history, 2)) {
        return finish({
          success: false,
          exitReason: 'unrecoverable',
          finalResult: `consecutive LLM failures: ${askResult.rawMessage}`,
          history,
          startedAt,
          costUsd,
        });
      }
      continue;
    }

    const { action, llmLatencyMs, llmUsage } = askResult;
    if (llmUsage.costUsd) {
      costUsd += llmUsage.costUsd;
    }

    if (!isValidActionShape(action)) {
      const summary = `LLM returned malformed action: ${JSON.stringify(action).slice(0, ERR_MESSAGE_CAP)}`;
      recordFailedStep(
        history,
        stepIndex,
        frame,
        summary,
        config,
        { llmLatencyMs, llmUsage },
      );
      continue;
    }

    const executionResult = await execute(frame, action, driver);
    const urlAfter = await observeNavigation(
      driver,
      frame,
      action,
      executionResult.ok,
    );

    const step: TrajectoryStep = {
      index: stepIndex,
      urlBefore: frame.meta.url,
      fingerprintBefore: frame.fingerprint,
      action,
      result: executionResult,
      urlAfter,
      llmLatencyMs,
      llmUsage,
    };
    history.push(step);
    config.onStep?.(step);

    if (executionResult.ok && executionResult.terminal) {
      return finish({
        success: true,
        exitReason: 'done',
        finalResult: executionResult.summary,
        history,
        startedAt,
        costUsd,
      });
    }

    const stuck = detector.observe({
      url: frame.meta.url,
      action,
      fingerprint: frame.fingerprint,
    });
    if (stuck.stuck) {
      stuckNotice =
        `You appear stuck (${stuck.reason}). Try a DIFFERENT element or scroll. ` +
        `If the task is impossible from here, emit done with what you've found.`;
      detector.reset();
    }
  }

  return finish({
    success: false,
    exitReason: 'max_steps',
    finalResult: `max_steps (${maxSteps}) reached without done`,
    history,
    startedAt,
    costUsd,
  });
}

interface AskOk {
  ok: true;
  action: Action;
  llmLatencyMs: number;
  llmUsage: AskJsonResult<Action>['usage'];
}

interface AskFail {
  ok: false;
  summary: string;
  rawMessage: string;
}

/**
 * Wraps `actor.askJson` so its outcome is a discriminated union the loop
 * can consume without try/catch in the hot path.
 */
async function tryAskActor(
  config: AgentConfig,
  userPrompt: string,
): Promise<AskOk | AskFail> {
  try {
    const r = await config.actor.askJson<Action>({
      system: SYSTEM_PROMPT,
      user: userPrompt,
      schema: ACTION_SCHEMA,
      cacheableSystem: true,
      maxTokens: ACTOR_MAX_TOKENS,
    });
    return {
      ok: true,
      action: r.data,
      llmLatencyMs: r.latencyMs,
      llmUsage: r.usage,
    };
  } catch (e) {
    if (e instanceof LlmError) {
      return {
        ok: false,
        summary: `LLM ${e.code}: ${e.message.slice(0, ERR_MESSAGE_CAP)}`,
        rawMessage: e.message,
      };
    }
    throw e;
  }
}

async function prepareFrame(
  driver: BrowserDriver,
  dismissedOrigins: Set<string>,
): Promise<PerceptionFrame> {
  const initial = await snapshot(driver);
  const consent = await maybeDismissConsent(driver, initial, dismissedOrigins);
  if (consent.dismissed) {
    return snapshot(driver);
  }
  return initial;
}

function renderPrompt(args: {
  task: string;
  history: History;
  historyWindow: number;
  frame: PerceptionFrame;
  stuckNotice?: string;
}): string {
  return buildUserPrompt({
    task: args.task,
    historySerialized: args.history.serialize(args.historyWindow),
    frameSerialized: serializeFrame(args.frame),
    ...(args.stuckNotice ? { notice: args.stuckNotice } : {}),
  });
}

function recordFailedStep(
  history: History,
  index: number,
  frame: PerceptionFrame,
  summary: string,
  config: AgentConfig,
  llmTelemetry?: {
    llmLatencyMs: number;
    llmUsage: AskJsonResult<Action>['usage'];
  },
): void {
  const step: TrajectoryStep = {
    index,
    urlBefore: frame.meta.url,
    fingerprintBefore: frame.fingerprint,
    action: NOOP_ACTION,
    result: { ok: false, error: 'parse_error', summary },
    urlAfter: frame.meta.url,
    llmLatencyMs: llmTelemetry?.llmLatencyMs ?? 0,
    llmUsage: llmTelemetry?.llmUsage ?? EMPTY_USAGE,
  };
  history.push(step);
  config.onStep?.(step);
}

function hasConsecutiveParseErrors(history: History, count: number): boolean {
  if (history.size() < count) {
    return false;
  }
  return history
    .last(count)
    .every((s) => !s.result.ok && s.result.error === 'parse_error');
}

function isValidActionShape(value: unknown): value is Action {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  return typeof type === 'string';
}

const MUTATING_ACTION_TYPES = new Set<Action['type']>([
  'click',
  'type',
  'goto',
]);

function isMutating(action: Action): boolean {
  return MUTATING_ACTION_TYPES.has(action.type);
}

async function observeNavigation(
  driver: BrowserDriver,
  frame: PerceptionFrame,
  action: Action,
  succeeded: boolean,
): Promise<string> {
  if (!succeeded || !isMutating(action)) {
    return frame.meta.url;
  }
  try {
    await driver.waitForReady({
      timeoutMs: READY_TIMEOUT_MS,
      stableMs: READY_STABLE_MS,
    });
  } catch {
    // Tolerate readiness failures — page may have already loaded.
  }
  const meta = await driver.getPageMeta();
  return meta.url;
}

interface FinishArgs {
  success: boolean;
  exitReason: RunResult['exitReason'];
  finalResult: string;
  history: History;
  startedAt: number;
  costUsd: number;
}

function finish(args: FinishArgs): RunResult {
  return {
    success: args.success,
    steps: args.history.size(),
    wallMs: Date.now() - args.startedAt,
    costUsdEstimate: args.costUsd,
    finalResult: args.finalResult,
    exitReason: args.exitReason,
    trajectory: [...args.history.all()],
  };
}
