/**
 * Typed message protocol between the sidepanel UI and the background
 * service worker. The protocol is intentionally tiny: the SW owns one
 * task at a time, the panel can start / cancel / observe.
 */

import type { TrajectoryStep } from '@fast-browser/core';

export type ProviderName = 'anthropic' | 'gemini' | 'openrouter';

export interface TaskPreset {
  /** Stable identifier — used to remember "last selected". */
  id: string;
  /** Display name in the dropdown. */
  name: string;
  /** Optional starting URL — agent navigates here before the loop. */
  url?: string;
  /** The task description sent to the model. */
  task: string;
  /** Optional per-preset max-steps override (defaults to settings.maxSteps). */
  maxStepsOverride?: number;
}

export interface AgentSettings {
  provider: ProviderName;
  model: string;
  /**
   * API keys per provider. Persisted in chrome.storage.local. Only the
   * key for the selected provider is used per task.
   */
  apiKeys: Partial<Record<ProviderName, string>>;
  maxSteps: number;
  /** Saved task presets that show up in the sidepanel dropdown. */
  presets: TaskPreset[];
  /** ID of the last-selected preset; auto-applied on panel open. */
  lastPresetId?: string;
}

export interface StartTaskMessage {
  type: 'start';
  task: string;
  /** Optional starting URL — defaults to the active tab as-is. */
  url?: string;
  /** Optional per-run max-steps override (from preset). */
  maxStepsOverride?: number;
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
