import CDP from "chrome-remote-interface";
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
} from "@fast-browser/core";

const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "checkbox",
  "radio",
  "combobox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "switch",
  "searchbox",
  "spinbutton",
  "option",
  "slider",
]);

const LANDMARK_ROLES = new Set([
  "main",
  "article",
  "region",
  "form",
  "navigation",
  "heading",
  "complementary",
  "banner",
  "contentinfo",
  "search",
]);

interface CdpClient {
  Page: any;
  DOM: any;
  Runtime: any;
  Accessibility: any;
  Network: any;
  Input: any;
  send: (method: string, params?: unknown) => Promise<unknown>;
  on: (event: string, handler: (params: any) => void) => void;
  close: () => Promise<void>;
}

export interface CdpNodeDriverOptions {
  /** Port the Chrome instance is listening on. Required. */
  port: number;
  /** Optional explicit target id (tab). Otherwise picks first page. */
  targetId?: string;
}

export class CdpNodeDriver implements BrowserDriver {
  private client: CdpClient | null = null;
  private readonly port: number;
  private readonly targetId?: string;

  constructor(opts: CdpNodeDriverOptions) {
    this.port = opts.port;
    if (opts.targetId !== undefined) this.targetId = opts.targetId;
  }

  private get c(): CdpClient {
    if (!this.client) throw new DriverError("not_attached");
    return this.client;
  }

  async attach(opts: AttachOptions): Promise<void> {
    if (this.client) return; // idempotent
    const target = this.targetId ?? (await this.findOrCreateTarget(opts.url));
    this.client = (await CDP({ port: this.port, target })) as unknown as CdpClient;
    const c = this.client;
    await Promise.all([
      c.send("Page.enable"),
      c.send("DOM.enable"),
      c.send("Runtime.enable"),
      c.send("Accessibility.enable"),
      c.send("Network.enable"),
      c.send("Page.setLifecycleEventsEnabled", { enabled: true }),
    ]);
    if (opts.url) {
      await this.navigate(opts.url);
    }
  }

  private async findOrCreateTarget(url?: string): Promise<string> {
    const targets = (await CDP.List({ port: this.port })) as Array<{
      id: string;
      type: string;
      url: string;
    }>;
    const existing = targets.find((t) => t.type === "page" && t.url !== "");
    if (existing) return existing.id;
    const created = (await CDP.New({ port: this.port, url: url ?? "about:blank" })) as { id: string };
    return created.id;
  }

  async navigate(url: string): Promise<void> {
    const result = (await this.c.send("Page.navigate", { url })) as {
      frameId: string;
      errorText?: string;
    };
    if (result.errorText) {
      throw new DriverError("navigation_failed", `${url}: ${result.errorText}`);
    }
    await this.waitForReady();
  }

  async getPageMeta(): Promise<PageMeta> {
    const r = (await this.c.send("Runtime.evaluate", {
      expression: `({
        url: location.href,
        title: document.title,
        scrollY: window.scrollY,
        viewportHeight: window.innerHeight,
        documentHeight: document.documentElement.scrollHeight,
      })`,
      returnByValue: true,
    })) as { result: { value: PageMeta } };
    return r.result.value;
  }

  async getAxSnapshot(): Promise<AxNode[]> {
    const r = (await this.c.send("Accessibility.getFullAXTree")) as {
      nodes: Array<{
        nodeId: string;
        backendDOMNodeId?: number;
        ignored?: boolean;
        role?: { value?: string };
        name?: { value?: string };
        value?: { value?: string };
        description?: { value?: string };
        properties?: Array<{ name: string; value?: { value?: unknown } }>;
      }>;
    };

    const candidates: AxNode[] = [];
    for (const n of r.nodes) {
      if (n.ignored) continue;
      if (n.backendDOMNodeId === undefined) continue;
      const role = n.role?.value ?? "";
      if (!role) continue;
      const interactive = INTERACTIVE_ROLES.has(role);
      if (!interactive && !LANDMARK_ROLES.has(role)) continue;

      let disabled = false;
      let focusable = false;
      for (const p of n.properties ?? []) {
        if (p.name === "disabled" && p.value?.value === true) disabled = true;
        if (p.name === "focusable" && p.value?.value === true) focusable = true;
      }

      const node: AxNode = {
        backendNodeId: n.backendDOMNodeId,
        role,
        name: (n.name?.value ?? "").trim(),
        interactive,
      };
      if (n.value?.value !== undefined) node.value = String(n.value.value);
      if (n.description?.value) node.description = n.description.value;
      if (disabled) node.disabled = true;
      if (focusable) node.focusable = true;
      candidates.push(node);
    }

    // Viewport visibility filter — kills navigation chrome / footer / off-screen
    // links and dramatically shrinks the prompt. This is the highest-leverage
    // change for keeping per-step latency low and avoiding model hallucination.
    return await this.filterToVisible(candidates);
  }

  private async filterToVisible(nodes: AxNode[]): Promise<AxNode[]> {
    if (nodes.length === 0) return nodes;
    const ids = nodes.map((n) => n.backendNodeId);
    // Resolve backendNodeIds to objectIds in one batch via Runtime.evaluate.
    // We use document.querySelectorAll-free path: pushNodesByBackendIdsToFrontend
    // gives us nodeIds, then DOM.resolveNode → objectId, then getBoundingClientRect.
    // Simpler: use DOM.getNodeForLocation? No — we already have backendNodeIds.
    // Cleanest: build a single Runtime.evaluate that resolves each backendNodeId
    // to a DOM node via internal mapping isn't directly possible. Instead, use
    // DOM.resolveNode for each (cheap, parallel-able).

    const visibleSet = new Set<number>();
    const resolved = await Promise.all(
      ids.map(async (backendNodeId) => {
        try {
          const r = (await this.c.send("DOM.resolveNode", { backendNodeId })) as {
            object: { objectId: string };
          };
          return { backendNodeId, objectId: r.object.objectId };
        } catch {
          return null;
        }
      }),
    );

    // Now check viewport-intersection for each in one Runtime call group.
    await Promise.all(
      resolved.map(async (item) => {
        if (!item) return;
        try {
          const r = (await this.c.send("Runtime.callFunctionOn", {
            objectId: item.objectId,
            functionDeclaration: `function () {
              const r = this.getBoundingClientRect ? this.getBoundingClientRect() : null;
              if (!r) return false;
              const vh = window.innerHeight, vw = window.innerWidth;
              // Pad: include elements within 1 viewport above/below.
              if (r.bottom < -vh || r.top > vh * 2) return false;
              if (r.right < 0 || r.left > vw) return false;
              if (r.width === 0 && r.height === 0) return false;
              const s = window.getComputedStyle(this);
              if (s.visibility === 'hidden' || s.display === 'none') return false;
              return true;
            }`,
            returnByValue: true,
          })) as { result: { value: boolean } };
          if (r.result.value === true) visibleSet.add(item.backendNodeId);
        } catch {
          /* */
        } finally {
          // Release the remote object handle to avoid leaks.
          try {
            await this.c.send("Runtime.releaseObject", { objectId: item.objectId });
          } catch {/* */}
        }
      }),
    );

    return nodes.filter((n) => visibleSet.has(n.backendNodeId));
  }

  async getVisibleText(opts?: { viewportPad?: number }): Promise<TextBlock[]> {
    const pad = opts?.viewportPad ?? 1;
    const r = (await this.c.send("Runtime.evaluate", {
      expression: `(${visibleTextWalker.toString()})(${pad})`,
      returnByValue: true,
    })) as { result: { value: TextBlock[] } };
    return r.result.value ?? [];
  }

  async screenshot(): Promise<Uint8Array> {
    const r = (await this.c.send("Page.captureScreenshot", { format: "png" })) as {
      data: string;
    };
    return Uint8Array.from(Buffer.from(r.data, "base64"));
  }

  async click(backendNodeId: BackendNodeId): Promise<void> {
    await this.assertEnabled(backendNodeId);
    await this.c.send("DOM.scrollIntoViewIfNeeded", { backendNodeId }).catch((e: Error) => {
      // Not all node types support scrollIntoViewIfNeeded; ignore.
      if (!/Cannot find context/.test(e.message)) throw e;
    });
    const box = await this.boxOrThrow(backendNodeId);
    if (box.length < 8) throw new DriverError("internal", "box model returned <8 coords");
    const [x1, y1, , , x2, y2] = box as [number, number, number, number, number, number, number, number];
    const x = (x1 + x2) / 2;
    const y = (y1 + y2) / 2;
    await this.c.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
    await this.c.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
  }

  async type(backendNodeId: BackendNodeId, text: string): Promise<void> {
    await this.assertEnabled(backendNodeId);
    await this.c.send("DOM.focus", { backendNodeId });
    // Clear existing value if the focused element is a text input/textarea.
    await this.c.send("Runtime.evaluate", {
      expression: `(() => { const el = document.activeElement; if (!el) return; if ('value' in el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); } })()`,
    });
    await this.c.send("Input.insertText", { text });
  }

  async scroll(direction: ScrollDirection, amount: number): Promise<void> {
    let dx = 0;
    let dy = 0;
    if (direction === "up") dy = -amount;
    else if (direction === "down") dy = amount;
    else if (direction === "left") dx = -amount;
    else if (direction === "right") dx = amount;
    await this.c.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: 100,
      y: 100,
      deltaX: dx,
      deltaY: dy,
    });
  }

  async waitForReady(opts?: WaitForReadyOptions): Promise<void> {
    const timeoutMs = opts?.timeoutMs ?? 3000;
    const stableMs = opts?.stableMs ?? 200;
    const deadline = Date.now() + timeoutMs;

    return new Promise<void>((resolve) => {
      let stableTimer: NodeJS.Timeout | null = null;
      let inFlight = 0;
      let done = false;

      const finish = () => {
        if (done) return;
        done = true;
        if (stableTimer) clearTimeout(stableTimer);
        try {
          this.c.Network?.requestWillBeSent?.removeAllListeners?.();
          this.c.Network?.loadingFinished?.removeAllListeners?.();
          this.c.Network?.loadingFailed?.removeAllListeners?.();
        } catch {
          /* */
        }
        resolve();
      };

      const armStable = () => {
        if (stableTimer) clearTimeout(stableTimer);
        stableTimer = setTimeout(() => {
          if (inFlight === 0) finish();
        }, stableMs);
      };

      // Track in-flight network. If quiet for `stableMs`, resolve.
      const onStart = () => {
        inFlight++;
        if (stableTimer) {
          clearTimeout(stableTimer);
          stableTimer = null;
        }
      };
      const onEnd = () => {
        inFlight = Math.max(0, inFlight - 1);
        if (inFlight === 0) armStable();
      };

      this.c.on("Network.requestWillBeSent", onStart);
      this.c.on("Network.loadingFinished", onEnd);
      this.c.on("Network.loadingFailed", onEnd);

      armStable();
      const hardCap = setTimeout(() => finish(), Math.max(0, deadline - Date.now()));
      hardCap.unref?.();
    });
  }

  async evaluate<T = unknown>(expression: string): Promise<T> {
    const r = (await this.c.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })) as { result: { value: T }; exceptionDetails?: { text: string } };
    if (r.exceptionDetails) {
      throw new DriverError("internal", r.exceptionDetails.text);
    }
    return r.result.value;
  }

  async detach(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.close();
    } catch {
      /* */
    }
    this.client = null;
  }

  // ---- helpers ----

  private async boxOrThrow(backendNodeId: number): Promise<number[]> {
    try {
      const r = (await this.c.send("DOM.getBoxModel", { backendNodeId })) as {
        model: { content: number[] };
      };
      return r.model.content;
    } catch (e) {
      const msg = (e as Error).message ?? "";
      if (/could not compute box model|Could not find node|No node with given id/i.test(msg)) {
        throw new DriverError("unknown_target", msg);
      }
      throw new DriverError("internal", msg);
    }
  }

  private async assertEnabled(backendNodeId: number): Promise<void> {
    // Quick read of the disabled state via DOM.describeNode + properties.
    // We don't gate every action on this — failed clicks will surface anyway —
    // but we do trip a clean error for the common "already-clicked quiz answer"
    // case.
    try {
      const r = (await this.c.send("DOM.describeNode", { backendNodeId })) as {
        node: { attributes?: string[] };
      };
      const attrs = r.node.attributes ?? [];
      for (let i = 0; i < attrs.length; i += 2) {
        if (attrs[i] === "disabled") {
          throw new DriverError("disabled");
        }
      }
    } catch (e) {
      if (e instanceof DriverError) throw e;
      const msg = (e as Error).message ?? "";
      if (/Could not find node/i.test(msg)) {
        throw new DriverError("unknown_target", msg);
      }
      // Fall through; a missing describeNode is not fatal for click/type.
    }
  }
}

// Runs in page context. Walks the DOM, returns visible text blocks within
// `pad` viewports above/below the current viewport.
function visibleTextWalker(pad: number): unknown[] {
  const blocks: { kind: string; level?: number; text: string }[] = [];
  const vh = window.innerHeight;
  const top = window.scrollY - pad * vh;
  const bottom = window.scrollY + (pad + 1) * vh;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  const pushed = new WeakSet<Element>();
  const tagToKind: Record<string, string> = {
    H1: "heading", H2: "heading", H3: "heading", H4: "heading", H5: "heading", H6: "heading",
    P: "paragraph",
    LI: "list-item",
    LABEL: "label",
    TD: "table-cell", TH: "table-cell",
    DT: "label", DD: "paragraph",
  };
  while (walker.nextNode()) {
    const el = walker.currentNode as Element;
    const kind = tagToKind[el.tagName];
    if (!kind) continue;
    if (pushed.has(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.bottom < top - window.scrollY) continue;
    if (rect.top > bottom - window.scrollY) continue;
    if (rect.width === 0 && rect.height === 0) continue;
    const style = window.getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") continue;
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (text.length > 800) continue; // skip giant containers
    pushed.add(el);
    const block: { kind: string; level?: number; text: string } = { kind, text };
    if (kind === "heading") block.level = parseInt(el.tagName.slice(1), 10);
    blocks.push(block);
  }
  return blocks;
}
