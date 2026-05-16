import type { BackendNodeId, ScrollDirection } from "../driver.js";

export interface ClickAction {
  type: "click";
  /** Stable node identifier from the current PerceptionFrame. */
  targetNodeId: BackendNodeId;
}

export interface TypeAction {
  type: "type";
  targetNodeId: BackendNodeId;
  value: string;
  /** If true, dispatch Enter after the text. Used for search boxes / form submission. */
  submit?: boolean;
}

export interface ScrollAction {
  type: "scroll";
  direction: ScrollDirection;
  amount: number;
}

export interface GotoAction {
  type: "goto";
  url: string;
}

export interface WaitForAction {
  type: "wait_for";
  /** One of: number of ms, or a substring of visible text to wait for. */
  ms?: number;
  textContains?: string;
}

export interface DoneAction {
  type: "done";
  /** Free-text result the agent reports. */
  result: string;
}

export type Action = ClickAction | TypeAction | ScrollAction | GotoAction | WaitForAction | DoneAction;

export type ActionType = Action["type"];

export type ActionErrorCode =
  | "unknown_target"
  | "disabled"
  | "timeout"
  | "navigation_failed"
  | "parse_error"
  | "internal";

export interface ActionResultOk {
  ok: true;
  /** Short prose summary suitable for a history line. */
  summary: string;
  /** True if this action terminates the loop. */
  terminal?: boolean;
}

export interface ActionResultErr {
  ok: false;
  error: ActionErrorCode;
  summary: string;
}

export type ActionResult = ActionResultOk | ActionResultErr;
