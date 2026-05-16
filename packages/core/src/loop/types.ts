import type { Action, ActionResult } from "../actions/vocabulary.js";
import type { Provider, Usage } from "../llm/types.js";

export interface TrajectoryStep {
  index: number;
  urlBefore: string;
  fingerprintBefore: string;
  action: Action;
  result: ActionResult;
  urlAfter: string;
  llmLatencyMs: number;
  llmUsage: Usage;
}

export interface RunResult {
  success: boolean;
  steps: number;
  wallMs: number;
  costUsdEstimate: number;
  /** The final `done` action's result, or a terminal-failure description. */
  finalResult: string;
  /** Reason the loop ended. */
  exitReason: "done" | "max_steps" | "unrecoverable" | "fatal_error";
  trajectory: TrajectoryStep[];
}

export interface AgentConfig {
  /** The actor provider, called every step. */
  actor: Provider;
  /** Optional planner for stuck-state recovery. Wired in U8. */
  planner?: Provider;
  /** Hard cap. Default 60. */
  maxSteps?: number;
  /** Fired after every step. Useful for streaming UI. */
  onStep?: (step: TrajectoryStep) => void;
  /** Hook fired before the LLM call — useful for logging. */
  onTurnStart?: (info: { step: number; url: string }) => void;
  /** Cap history lines passed to the LLM. Default 8 most recent. */
  historyWindow?: number;
}
