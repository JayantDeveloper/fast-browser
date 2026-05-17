/**
 * Filter an AxNode list down to elements visible in (or near) the viewport,
 * and enrich empty-name interactive nodes with labels derived from their
 * DOM neighborhood.
 *
 * Visibility filtering is the highest-leverage perception change: sites
 * typically surface 100+ chrome links in their accessibility tree that
 * would otherwise drown the LLM prompt.
 *
 * Label enrichment handles inputs (radios, checkboxes, textboxes) whose
 * accessible name is empty because the page wraps them in <label> rather
 * than using `aria-label` or `<label for=...>`. Without enrichment the
 * model sees "radio ''" for every choice and cannot pick correctly. This
 * was the bug behind the ARRS CME form failing — every radio had an
 * empty AxNode name and the agent clicked them blind.
 */

import type { AxNode } from '@fast-browser/core';
import type { CdpClient } from './cdp-client.js';

/**
 * How many viewport heights above and below the current viewport to
 * include. 1 means "include the screen above and below the current view".
 */
const VIEWPORT_PAD = 1;

interface ResolvedNode {
  backendNodeId: number;
  objectId: string;
}

interface ResolveNodeResult {
  object: { objectId: string };
}

interface NodeProbeResult {
  visible: boolean;
  derivedName?: string;
}

interface CallFunctionResult {
  result: { value: NodeProbeResult };
}

/**
 * Returns only the nodes whose bounding rect intersects the padded
 * viewport. As a side effect, mutates each surviving node's `name`
 * field to a DOM-derived label when the original AxNode name was empty.
 */
export async function filterToVisible(
  client: CdpClient,
  nodes: AxNode[],
): Promise<AxNode[]> {
  if (nodes.length === 0) {
    return nodes;
  }

  const resolved = await resolveNodes(client, nodes);
  const probe = await probeNodes(client, resolved);

  const out: AxNode[] = [];
  for (const node of nodes) {
    const result = probe.get(node.backendNodeId);
    if (!result?.visible) {
      continue;
    }
    if (!node.name && result.derivedName) {
      node.name = result.derivedName;
    }
    out.push(node);
  }
  return out;
}

async function resolveNodes(
  client: CdpClient,
  nodes: AxNode[],
): Promise<ResolvedNode[]> {
  const tasks = nodes.map(async (n): Promise<ResolvedNode | null> => {
    try {
      const r = (await client.send('DOM.resolveNode', {
        backendNodeId: n.backendNodeId,
      })) as ResolveNodeResult;
      return { backendNodeId: n.backendNodeId, objectId: r.object.objectId };
    } catch {
      return null;
    }
  });
  const results = await Promise.all(tasks);
  return results.filter((r): r is ResolvedNode => r !== null);
}

async function probeNodes(
  client: CdpClient,
  resolved: ResolvedNode[],
): Promise<Map<number, NodeProbeResult>> {
  const probe = new Map<number, NodeProbeResult>();
  await Promise.all(
    resolved.map(async (item) => {
      try {
        const r = (await client.send('Runtime.callFunctionOn', {
          objectId: item.objectId,
          functionDeclaration: NODE_PROBE_FN,
          arguments: [{ value: VIEWPORT_PAD }],
          returnByValue: true,
        })) as CallFunctionResult;
        if (r.result.value) {
          probe.set(item.backendNodeId, r.result.value);
        }
      } catch {
        // Best-effort: if the node detached between resolve and probe,
        // it isn't visible. No need to surface.
      } finally {
        try {
          await client.send('Runtime.releaseObject', {
            objectId: item.objectId,
          });
        } catch {
          // Releasing is cleanup; ignore failures.
        }
      }
    }),
  );
  return probe;
}

/**
 * Page-context probe. Runs against each resolved DOM node and returns
 * both visibility and an optional derived label. Defined as a source
 * string because Runtime.callFunctionOn requires source text.
 *
 * Label derivation cascade (first non-empty wins):
 *   1. `this.labels[0].textContent` — <label for="id"> association
 *   2. `closest('label').textContent` — <label> ancestor
 *   3. `this.value` for inputs that carry user-visible text
 *   4. `this.placeholder`
 *   5. Adjacent text-node siblings (handles labels written as raw text
 *      next to the input, which the ARRS CME forms use)
 *   6. Trimmed parent.textContent as a last resort
 *
 * Strings longer than 200 chars are dropped — a "label" that long is
 * almost certainly a whole container's contents, not a real label.
 */
const NODE_PROBE_FN = `function (pad) {
  if (typeof this.getBoundingClientRect !== 'function') {
    return { visible: false };
  }
  const r = this.getBoundingClientRect();
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  if (r.bottom < -vh * pad) return { visible: false };
  if (r.top > vh * (pad + 1)) return { visible: false };
  if (r.right < 0 || r.left > vw) return { visible: false };
  if (r.width === 0 && r.height === 0) return { visible: false };
  const s = window.getComputedStyle(this);
  if (s.visibility === 'hidden' || s.display === 'none') {
    return { visible: false };
  }

  const tag = this.tagName;
  const isInput = tag === 'INPUT' || tag === 'SELECT' ||
                  tag === 'TEXTAREA' || tag === 'BUTTON';
  if (!isInput) {
    return { visible: true };
  }

  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const cap = (s) => (s && s.length <= 200) ? s : '';

  // 1. associated <label for=...>
  if (this.labels && this.labels.length > 0) {
    const t = cap(norm(this.labels[0].textContent));
    if (t) return { visible: true, derivedName: t };
  }
  // 2. <label> ancestor (the ARRS pattern: <label><input> Text</label>)
  const lbl = this.closest && this.closest('label');
  if (lbl) {
    const t = cap(norm(lbl.textContent));
    if (t) return { visible: true, derivedName: t };
  }
  // 3. value / placeholder
  const v = norm(this.value);
  if (v && tag !== 'INPUT' || (v && this.type !== 'radio' && this.type !== 'checkbox')) {
    return { visible: true, derivedName: cap(v) };
  }
  const ph = norm(this.placeholder);
  if (ph) return { visible: true, derivedName: cap(ph) };

  // 4. Adjacent text-node sibling (input followed by raw text)
  let sib = this.nextSibling;
  while (sib && sib.nodeType === 3 && !norm(sib.textContent)) {
    sib = sib.nextSibling;
  }
  if (sib && sib.nodeType === 3) {
    const t = cap(norm(sib.textContent));
    if (t) return { visible: true, derivedName: t };
  }

  // 5. Parent's text content as last resort
  if (this.parentElement) {
    const t = cap(norm(this.parentElement.textContent));
    if (t) return { visible: true, derivedName: t };
  }

  return { visible: true };
}`;
