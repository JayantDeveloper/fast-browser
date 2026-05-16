/**
 * BrowserDriver: the adapter contract.
 *
 * Implementations live in transport-specific packages:
 *   - adapter-cdp-node     -> chrome-remote-interface against a launched Chromium
 *   - adapter-cdp-extension -> chrome.debugger inside a Chrome extension
 *
 * core/ never imports a transport. Adding a new driver MUST not require
 * any change to core/.
 */

export type BackendNodeId = number;

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AxNode {
  backendNodeId: BackendNodeId;
  role: string;
  name: string;
  value?: string;
  description?: string;
  bounds?: BoundingBox;
  disabled?: boolean;
  focusable?: boolean;
  // Whether the role is interactive (button, link, textbox...) vs a landmark
  // (main, article, region...). Used by the prompt-serializer to separate
  // addressable elements from context-only landmarks.
  interactive: boolean;
}

export interface TextBlock {
  // Where in the document this text comes from (heading, paragraph, list,
  // label, table-cell). The prompt-serializer prefixes lines accordingly.
  kind: "heading" | "paragraph" | "list-item" | "label" | "table-cell" | "other";
  level?: number; // for headings
  text: string;
}

export interface PageMeta {
  url: string;
  title: string;
  scrollY: number;
  viewportHeight: number;
  documentHeight: number;
}

export type ScrollDirection = "up" | "down" | "left" | "right";

export interface AttachOptions {
  // Use exactly one of these. tabId targets an existing tab (extension);
  // url launches a fresh navigation (cdp-node typically).
  tabId?: number;
  url?: string;
}

export interface WaitForReadyOptions {
  // Hard cap. Default 3000ms.
  timeoutMs?: number;
  // Minimum stable window. Default 200ms with no DOM mutations or network
  // activity before resolving.
  stableMs?: number;
}

export type DriverErrorCode =
  | "unknown_target"
  | "disabled"
  | "timeout"
  | "navigation_failed"
  | "disconnected"
  | "disallowed_url"
  | "not_attached"
  | "internal";

export class DriverError extends Error {
  override readonly name = "DriverError";
  constructor(public readonly code: DriverErrorCode, message?: string) {
    super(message ?? code);
  }
}

export interface BrowserDriver {
  /** Attach to a tab or launch one. Idempotent if already attached to the same target. */
  attach(opts: AttachOptions): Promise<void>;

  /** Navigate the attached tab. Resolves once the navigation commits. */
  navigate(url: string): Promise<void>;

  /** Page metadata for the current frame. */
  getPageMeta(): Promise<PageMeta>;

  /** Full-page accessibility snapshot, mapped into AxNode shape. */
  getAxSnapshot(): Promise<AxNode[]>;

  /**
   * Structural visible-text walk. Captures readable content (headings,
   * paragraphs, list items, labels, table cells) intersecting the viewport,
   * optionally extended N viewports above/below.
   */
  getVisibleText(opts?: { viewportPad?: number }): Promise<TextBlock[]>;

  /** Raw PNG bytes. */
  screenshot(): Promise<Uint8Array>;

  /**
   * Click an element by backendNodeId. The driver MUST scroll the element
   * into view if needed, MUST NOT re-resolve the node by selector, and MUST
   * reject with DriverError("disabled") if the element is disabled.
   */
  click(backendNodeId: BackendNodeId): Promise<void>;

  /**
   * Focus the node and insert text. The driver MUST clear existing value
   * before inserting (so callers don't have to manage selection state).
   */
  type(backendNodeId: BackendNodeId, text: string): Promise<void>;

  /** Wheel scroll in CSS pixels. */
  scroll(direction: ScrollDirection, amount: number): Promise<void>;

  /** Wait for the page to settle (network-idle + DOM-stable). */
  waitForReady(opts?: WaitForReadyOptions): Promise<void>;

  /** Evaluate a JS expression in page context, return JSON-serializable result. */
  evaluate<T = unknown>(expression: string): Promise<T>;

  /** Detach. Idempotent. After detach, all methods reject with not_attached. */
  detach(): Promise<void>;
}
