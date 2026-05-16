/**
 * Base class shared by every CDP-backed BrowserDriver implementation.
 *
 * Subclasses are responsible for one thing: producing a connected
 * {@link CdpClient} in `attach()`. Everything else — navigation,
 * perception, action dispatch, readiness, screenshot — is identical
 * across transports because it is just CDP protocol calls.
 */

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

const SCROLL_PIVOT_X = 100;
const SCROLL_PIVOT_Y = 100;

const PAGE_META_EXPRESSION = `({
  url: location.href,
  title: document.title,
  scrollY: window.scrollY,
  viewportHeight: window.innerHeight,
  documentHeight: document.documentElement.scrollHeight,
})`;

const DISABLED_ATTR = 'disabled';

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

/**
 * Concrete subclasses must populate `this.client` in {@link attach} and
 * release it in {@link detach}. Everything else is provided.
 */
export abstract class CdpDriverBase implements BrowserDriver {
  protected client: CdpClient | null = null;

  abstract attach(opts: AttachOptions): Promise<void>;

  protected get cdp(): CdpClient {
    if (!this.client) {
      throw new DriverError('not_attached');
    }
    return this.client;
  }

  /**
   * Enable the CDP domains we use. Subclasses should call this from
   * `attach()` once the client is connected.
   */
  protected async enableCommonDomains(): Promise<void> {
    await Promise.all([
      this.cdp.send('Page.enable'),
      this.cdp.send('DOM.enable'),
      this.cdp.send('Runtime.enable'),
      this.cdp.send('Accessibility.enable'),
      this.cdp.send('Network.enable'),
      this.cdp.send('Page.setLifecycleEventsEnabled', { enabled: true }),
    ]);
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
      .map(mapAxNode)
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
    return base64ToBytes(r.data);
  }

  async click(backendNodeId: BackendNodeId): Promise<void> {
    await this.assertEnabled(backendNodeId);
    await this.scrollIntoView(backendNodeId);
    const center = await this.getElementCenter(backendNodeId);
    await this.dispatchClick(center.x, center.y);
  }

  async type(backendNodeId: BackendNodeId, text: string): Promise<void> {
    await this.assertEnabled(backendNodeId);
    await this.cdp.send('DOM.focus', { backendNodeId });
    await this.clearActiveElementValue();
    await this.cdp.send('Input.insertText', { text });
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

  // ---- private helpers ----

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

  /**
   * Clear the focused input/textarea value before insertText so callers do
   * not inherit stale text. Inputs without a `value` slot are left alone.
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
      // Attributes come back as a flat [name, value, name, value, ...] array.
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

function base64ToBytes(b64: string): Uint8Array {
  // Available in both Node (since 16) and browser/extension service-worker
  // contexts. Avoids depending on Node's Buffer in the shared package.
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}
