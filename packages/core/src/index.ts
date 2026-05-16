export type {
  AttachOptions,
  AxNode,
  BackendNodeId,
  BoundingBox,
  BrowserDriver,
  DriverErrorCode,
  PageMeta,
  ScrollDirection,
  TextBlock,
  WaitForReadyOptions,
} from "./driver.js";
export { DriverError } from "./driver.js";
export type { PerceptionFrame } from "./perception/types.js";
export {
  resolveIndex,
  serializeFrame,
  snapshot,
  type SnapshotOptions,
  type SerializeOptions,
} from "./perception/snapshot.js";
export type {
  Action,
  ActionType,
  ActionResult,
  ActionResultOk,
  ActionResultErr,
  ActionErrorCode,
  ClickAction,
  TypeAction,
  ScrollAction,
  GotoAction,
  WaitForAction,
  DoneAction,
} from "./actions/vocabulary.js";
export { execute } from "./actions/executor.js";

export type { Provider, AskJsonOpts, AskJsonResult, Usage } from "./llm/types.js";
export { LlmError } from "./llm/types.js";
export { safeParseJson } from "./llm/safe-parse.js";
export { GeminiProvider, type GeminiProviderOpts } from "./llm/providers/gemini.js";
export { OpenRouterProvider, type OpenRouterProviderOpts } from "./llm/providers/openrouter.js";
export { ACTION_SCHEMA, SYSTEM_PROMPT, buildUserPrompt, actionToJson } from "./llm/prompts.js";

export { run, type RunInput } from "./loop/agent.js";
export { History } from "./loop/history.js";
export type { AgentConfig, RunResult, TrajectoryStep } from "./loop/types.js";
