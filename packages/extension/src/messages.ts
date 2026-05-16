/**
 * Typed message protocol between the sidepanel UI and the background
 * service worker. The protocol is intentionally tiny: the SW owns one
 * task at a time, the panel can start / cancel / observe.
 */

import type { TrajectoryStep } from '@fast-browser/core';

export type ProviderName = 'anthropic' | 'gemini' | 'openrouter';

export interface AgentSettings {
  provider: ProviderName;
  model: string;
  /**
   * API keys per provider. Persisted in chrome.storage.local. Only the
   * key for the selected provider is used per task.
   */
  apiKeys: Partial<Record<ProviderName, string>>;
  maxSteps: number;
}

export interface StartTaskMessage {
  type: 'start';
  task: string;
  /** Optional starting URL — defaults to the active tab as-is. */
  url?: string;
}

export interface CancelTaskMessage {
  type: 'cancel';
}

export type PanelToBackground = StartTaskMessage | CancelTaskMessage;

export interface StatusEvent {
  type: 'status';
  state: 'idle' | 'running' | 'done' | 'error';
  message?: string;
}

export interface StepEvent {
  type: 'step';
  step: TrajectoryStep;
}

export interface DoneEvent {
  type: 'done';
  success: boolean;
  finalResult: string;
  steps: number;
  wallMs: number;
  costUsdEstimate: number;
}

export type BackgroundToPanel = StatusEvent | StepEvent | DoneEvent;

export const PANEL_PORT_NAME = 'fast-browser-panel';
