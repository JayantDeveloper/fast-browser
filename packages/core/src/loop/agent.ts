import type { BrowserDriver } from "../driver.js";
import { execute } from "../actions/executor.js";
import type { Action } from "../actions/vocabulary.js";
import { snapshot, serializeFrame } from "../perception/snapshot.js";
import { ACTION_SCHEMA, SYSTEM_PROMPT, buildUserPrompt } from "../llm/prompts.js";
import { LlmError } from "../llm/types.js";
import { History } from "./history.js";
import type { AgentConfig, RunResult, TrajectoryStep } from "./types.js";

export interface RunInput {
  task: string;
  /** If provided, navigate here before the loop starts. */
  startUrl?: string;
}

/**
 * The per-step loop. Drives the BrowserDriver via perception → LLM → action.
 *
 *   1. snapshot (parallel ax + text)
 *   2. ask actor for next action (JSON-constrained)
 *   3. execute action against driver
 *   4. record trajectory step
 *   5. settle network
 *   6. loop until `done` or maxSteps
 */
export async function run(
  driver: BrowserDriver,
  config: AgentConfig,
  input: RunInput,
): Promise<RunResult> {
  const maxSteps = config.maxSteps ?? 60;
  const historyWindow = config.historyWindow ?? 8;
  const history = new History();
  const t0 = Date.now();
  let costUsd = 0;

  if (input.startUrl) {
    await driver.navigate(input.startUrl);
  }

  for (let i = 1; i <= maxSteps; i++) {
    config.onTurnStart?.({ step: i, url: (await driver.getPageMeta()).url });
    const frame = await snapshot(driver);
    const frameSerialized = serializeFrame(frame);
    const userPrompt = buildUserPrompt({
      task: input.task,
      historySerialized: history.serialize(historyWindow),
      frameSerialized,
    });

    let action: Action;
    let llmLatencyMs = 0;
    let llmUsage = { inputTokens: 0, outputTokens: 0 };

    try {
      const r = await config.actor.askJson<Action>({
        system: SYSTEM_PROMPT,
        user: userPrompt,
        schema: ACTION_SCHEMA,
        cacheableSystem: true,
        maxTokens: 256,
      });
      action = r.data;
      llmLatencyMs = r.latencyMs;
      llmUsage = r.usage;
      if (r.usage.costUsd) costUsd += r.usage.costUsd;
    } catch (e) {
      if (e instanceof LlmError) {
        // Record as a parse_error step in trajectory and continue.
        const fakeStep: TrajectoryStep = {
          index: i,
          urlBefore: frame.meta.url,
          fingerprintBefore: frame.fingerprint,
          action: { type: "wait_for", ms: 0 },
          result: { ok: false, error: "parse_error", summary: `LLM ${e.code}: ${e.message.slice(0, 200)}` },
          urlAfter: frame.meta.url,
          llmLatencyMs: 0,
          llmUsage: { inputTokens: 0, outputTokens: 0 },
        };
        history.push(fakeStep);
        config.onStep?.(fakeStep);
        // Two consecutive LLM failures → bail.
        if (history.size() >= 2 && history.last(2).every((s) => !s.result.ok && s.result.error === "parse_error")) {
          return finish(false, "unrecoverable", `consecutive LLM failures: ${e.message}`, history, t0, costUsd);
        }
        continue;
      }
      throw e;
    }

    // Validate the model produced a sensible action shape (the schema
    // mostly enforces this, but free-tier OpenRouter doesn't).
    if (!action || typeof action !== "object" || typeof (action as Action).type !== "string") {
      const fakeStep: TrajectoryStep = {
        index: i,
        urlBefore: frame.meta.url,
        fingerprintBefore: frame.fingerprint,
        action: { type: "wait_for", ms: 0 },
        result: { ok: false, error: "parse_error", summary: `LLM returned malformed action: ${JSON.stringify(action).slice(0, 200)}` },
        urlAfter: frame.meta.url,
        llmLatencyMs,
        llmUsage,
      };
      history.push(fakeStep);
      config.onStep?.(fakeStep);
      continue;
    }

    const result = await execute(frame, action, driver);

    let urlAfter = frame.meta.url;
    if (result.ok && (action.type === "click" || action.type === "type" || action.type === "goto")) {
      try {
        await driver.waitForReady({ timeoutMs: 3000, stableMs: 200 });
      } catch {
        /* tolerate */
      }
      urlAfter = (await driver.getPageMeta()).url;
    }

    const step: TrajectoryStep = {
      index: i,
      urlBefore: frame.meta.url,
      fingerprintBefore: frame.fingerprint,
      action,
      result,
      urlAfter,
      llmLatencyMs,
      llmUsage,
    };
    history.push(step);
    config.onStep?.(step);

    if (result.ok && result.terminal) {
      return finish(true, "done", result.summary, history, t0, costUsd);
    }
  }

  return finish(false, "max_steps", `max_steps (${maxSteps}) reached without done`, history, t0, costUsd);
}

function finish(
  success: boolean,
  exitReason: RunResult["exitReason"],
  finalResult: string,
  history: History,
  t0: number,
  costUsd: number,
): RunResult {
  return {
    success,
    steps: history.size(),
    wallMs: Date.now() - t0,
    costUsdEstimate: costUsd,
    finalResult,
    exitReason,
    trajectory: [...history.all()],
  };
}
