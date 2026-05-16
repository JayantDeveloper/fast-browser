import CDP from 'chrome-remote-interface';

import {
  type AttachOptions,
  type AxNode,
  type BackendNodeId,
  type BrowserDriver,
  DriverError,
  type PageMeta,
  type ScrollDirection,
  type TextBlock,
  type WaitForReadyOptions,
} from '@fast-browser/core';

import type { CdpClient } from './cdp-client.js';
import { filterToVisible } from './visibility-filter.js';
import { VISIBLE_TEXT_WALKER_SOURCE } from './visible-text.js';
import { waitForReady } from './wait-for-ready.js';

const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'checkbox',
  'radio',
  'combobox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'switch',
  'searchbox',
  'spinbutton',
  'option',
  'slider',
]);

const LANDMARK_ROLES = new Set([
  'main',
  'article',
  'region',
  'form',
  'navigation',
  'heading',
  'complementary',
  'banner',
  'contentinfo',
  'search',
]);

const SCROLL_PIVOT_X = 100;
const SCROLL_PIVOT_Y = 100;
const PAGE_META_EXPRESSION = `({
  url: location.href,
  title: document.title,
  scrollY: window.scrollY,
  viewportHeight: window.innerHeight,
  documentHeight: document.documentElement.scrollHeight,
})`;

/**
 * Lower-case attribute name we treat as the "is disabled" flag when
 * inspecting DOM.describeNode output.
 */
const DISABLED_ATTR = 'disabled';

interface RawAxProperty {
  name: string;
  value?: { value?: unknown };
}

interface RawAxNode {
  nodeId: string;
  backendDOMNodeId?: number;
  ignored?: boolean;
  role?: { value?: string };
  name?: { value?: string };
  value?: { value?: string };
  description?: { value?: string };
  properties?: RawAxProperty[];
}

interface RawAxTreeResponse {
  nodes: RawAxNode[];
}

interface RawDescribeNodeResponse {
  node: { attributes?: string[] };
}

interface RawBoxModelResponse {
  model: { content: number[] };
}

interface RawNavigateResponse {
  frameId: string;
  errorText?: string;
}

interface RawEvaluateResponse<T = unknown> {
  result: { value: T };
  exceptionDetails?: { text: string };
}

interface RawTargetEntry {
  id: string;
  type: string;
  url: string;
}

export interface CdpNodeDriverOptions {
  /** Port the launched Chrome instance is listening on. Required. */
  port: number;
  /** Optional explicit target id; otherwise picks the first existing page. */
  targetId?: string;
}

/**
 * BrowserDriver implementation backed by chrome-remote-interface against
 * a launched Chromium with `--remote-debugging-port`.
 */
export class CdpNodeDriver implements BrowserDriver {
  private client: CdpClient | null = null;
  private readonly port: number;
  private readonly targetId?: string;

  constructor(opts: CdpNodeDriverOptions) {
    this.port = opts.port;
    if (opts.targetId !== undefined) {
      this.targetId = opts.targetId;
    }
  }

  private get cdp(): CdpClient {
    if (!this.client) {
      throw new DriverError('not_attached');
    }
    return this.client;
  }

  async attach(opts: AttachOptions): Promise<void> {
    if (this.client) {
      return;
    }
    const target = this.targetId ?? (await this.findOrCreateTarget(opts.url));
    this.client = (await CDP({
      port: this.port,
      target,
    })) as unknown as CdpClient;

    await Promise.all([
      this.client.send('Page.enable'),
      this.client.send('DOM.enable'),
      this.client.send('Runtime.enable'),
      this.client.send('Accessibility.enable'),
      this.client.send('Network.enable'),
      this.client.send('Page.setLifecycleEventsEnabled', { enabled: true }),
    ]);

    if (opts.url) {
      await this.navigate(opts.url);
    }
  }

  private async findOrCreateTarget(url?: string): Promise<string> {
    const targets = (await CDP.List({ port: this.port })) as RawTargetEntry[];
    const existing = targets.find((t) => t.type === 'page' && t.url !== '');
    if (existing) {
      return existing.id;
    }
    const created = (await CDP.New({
      port: this.port,
      url: url ?? 'about:blank',
    })) as { id: string };
    return created.id;
  }

  async navigate(url: string): Promise<void> {
    const result = (await this.cdp.send('Page.navigate', {
      url,
    })) as RawNavigateResponse;
    if (result.errorText) {
      throw new DriverError(
        'navigation_failed',
        `${url}: ${result.errorText}`,
      );
    }
    await this.waitForReady();
  }

  async getPageMeta(): Promise<PageMeta> {
    const r = (await this.cdp.send('Runtime.evaluate', {
      expression: PAGE_META_EXPRESSION,
      returnByValue: true,
    })) as RawEvaluateResponse<PageMeta>;
    return r.result.value;
  }

  async getAxSnapshot(): Promise<AxNode[]> {
    const raw = (await this.cdp.send(
      'Accessibility.getFullAXTree',
    )) as RawAxTreeResponse;
    const candidates = raw.nodes
      .map((n) => mapAxNode(n))
      .filter((n): n is AxNode => n !== null);
    return filterToVisible(this.cdp, candidates);
  }

  async getVisibleText(opts?: { viewportPad?: number }): Promise<TextBlock[]> {
    const pad = opts?.viewportPad ?? 1;
    const r = (await this.cdp.send('Runtime.evaluate', {
      expression: `(${VISIBLE_TEXT_WALKER_SOURCE})(${pad})`,
      returnByValue: true,
    })) as RawEvaluateResponse<TextBlock[]>;
    return r.result.value ?? [];
  }

  async screenshot(): Promise<Uint8Array> {
    const r = (await this.cdp.send('Page.captureScreenshot', {
      format: 'png',
    })) as { data: string };
    return Uint8Array.from(Buffer.from(r.data, 'base64'));
  }

  async click(backendNodeId: BackendNodeId): Promise<void> {
    await this.assertEnabled(backendNodeId);
    await this.scrollIntoView(backendNodeId);
    const center = await this.getElementCenter(backendNodeId);
    await this.dispatchClick(center.x, center.y);
  }

  private async scrollIntoView(backendNodeId: BackendNodeId): Promise<void> {
    try {
      await this.cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId });
    } catch (e) {
      // Some node types do not support scrollIntoViewIfNeeded; tolerate.
      if (!/Cannot find context/i.test((e as Error).message)) {
        throw e;
      }
    }
  }

  private async getElementCenter(
    backendNodeId: BackendNodeId,
  ): Promise<{ x: number; y: number }> {
    const box = await this.boxOrThrow(backendNodeId);
    if (box.length < 8) {
      throw new DriverError('internal', 'box model returned <8 coords');
    }
    const [x1, y1, , , x2, y2] = box as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
  }

  private async dispatchClick(x: number, y: number): Promise<void> {
    await this.cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    await this.cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
  }

  async type(backendNodeId: BackendNodeId, text: string): Promise<void> {
    await this.assertEnabled(backendNodeId);
    await this.cdp.send('DOM.focus', { backendNodeId });
    await this.clearActiveElementValue();
    await this.cdp.send('Input.insertText', { text });
  }

  /**
   * Clear the focused input/textarea value before insertText so callers do
   * not inherit stale text. Scoped to inputs that have a `value` slot;
   * other elements (e.g. contenteditable divs) are left untouched.
   */
  private async clearActiveElementValue(): Promise<void> {
    await this.cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const el = document.activeElement;
        if (!el || !('value' in el)) return;
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      })()`,
    });
  }

  async scroll(direction: ScrollDirection, amount: number): Promise<void> {
    const { dx, dy } = scrollDelta(direction, amount);
    await this.cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: SCROLL_PIVOT_X,
      y: SCROLL_PIVOT_Y,
      deltaX: dx,
      deltaY: dy,
    });
  }

  async waitForReady(opts?: WaitForReadyOptions): Promise<void> {
    return waitForReady(this.cdp, opts);
  }

  async evaluate<T = unknown>(expression: string): Promise<T> {
    const r = (await this.cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })) as RawEvaluateResponse<T>;
    if (r.exceptionDetails) {
      throw new DriverError('internal', r.exceptionDetails.text);
    }
    return r.result.value;
  }

  async detach(): Promise<void> {
    if (!this.client) {
      return;
    }
    try {
      await this.client.close();
    } catch {
      // already closed
    }
    this.client = null;
  }

  private async boxOrThrow(backendNodeId: number): Promise<number[]> {
    try {
      const r = (await this.cdp.send('DOM.getBoxModel', {
        backendNodeId,
      })) as RawBoxModelResponse;
      return r.model.content;
    } catch (e) {
      const msg = (e as Error).message ?? '';
      if (
        /could not compute box model|Could not find node|No node with given id/i
          .test(msg)
      ) {
        throw new DriverError('unknown_target', msg);
      }
      throw new DriverError('internal', msg);
    }
  }

  private async assertEnabled(backendNodeId: number): Promise<void> {
    try {
      const r = (await this.cdp.send('DOM.describeNode', {
        backendNodeId,
      })) as RawDescribeNodeResponse;
      const attrs = r.node.attributes ?? [];
      // Attributes come back as flat [name, value, name, value, ...].
      for (let i = 0; i < attrs.length; i += 2) {
        if (attrs[i] === DISABLED_ATTR) {
          throw new DriverError('disabled');
        }
      }
    } catch (e) {
      if (e instanceof DriverError) {
        throw e;
      }
      const msg = (e as Error).message ?? '';
      if (/Could not find node/i.test(msg)) {
        throw new DriverError('unknown_target', msg);
      }
      // describeNode failure is non-fatal — the action will surface its own
      // error if there really is one.
    }
  }
}

/**
 * Convert a raw AXNode into our AxNode shape, dropping rows we never use
 * (ignored nodes, nodes without backendNodeId, nodes whose role is not
 * interactive AND not a recognised landmark).
 */
function mapAxNode(n: RawAxNode): AxNode | null {
  if (n.ignored) {
    return null;
  }
  if (n.backendDOMNodeId === undefined) {
    return null;
  }
  const role = n.role?.value ?? '';
  if (!role) {
    return null;
  }

  const interactive = INTERACTIVE_ROLES.has(role);
  if (!interactive && !LANDMARK_ROLES.has(role)) {
    return null;
  }

  const node: AxNode = {
    backendNodeId: n.backendDOMNodeId,
    role,
    name: (n.name?.value ?? '').trim(),
    interactive,
  };
  if (n.value?.value !== undefined) {
    node.value = String(n.value.value);
  }
  if (n.description?.value) {
    node.description = n.description.value;
  }

  for (const p of n.properties ?? []) {
    if (p.name === 'disabled' && p.value?.value === true) {
      node.disabled = true;
    }
    if (p.name === 'focusable' && p.value?.value === true) {
      node.focusable = true;
    }
  }

  return node;
}

function scrollDelta(
  direction: ScrollDirection,
  amount: number,
): { dx: number; dy: number } {
  switch (direction) {
    case 'up':
      return { dx: 0, dy: -amount };
    case 'down':
      return { dx: 0, dy: amount };
    case 'left':
      return { dx: -amount, dy: 0 };
    case 'right':
      return { dx: amount, dy: 0 };
    default:
      return { dx: 0, dy: 0 };
  }
}
