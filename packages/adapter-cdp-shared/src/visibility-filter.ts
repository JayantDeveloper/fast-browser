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
 * Label derivation cascade for inputs (first match wins for the BASE
 * label):
 *   1. `this.labels[0].textContent` — <label for="id"> association
 *   2. `closest('label').textContent` — <label> ancestor
 *   3. `this.value` for non-checkbox/non-radio inputs that carry text
 *   4. `this.placeholder`
 *   5. Adjacent text-node siblings
 *   6. Trimmed parent.textContent as a last resort
 *
 * For radio/checkbox inputs, also derives a QUESTION CONTEXT prefix by
 * walking up the DOM and finding the nearest non-option text above this
 * input's <label>. This disambiguates same-named options across
 * sub-questions ("To a Great Degree" repeated 4 times in one Q1 group
 * becomes "[Improve my current knowledge] To a Great Degree" etc).
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

  const norm = (str) => (str || '').replace(/\\s+/g, ' ').trim();
  const cap = (str) => (str && str.length <= 200) ? str : '';

  // ---- BASE LABEL ----
  let base = '';
  let labelEl = null;
  if (this.labels && this.labels.length > 0) {
    base = cap(norm(this.labels[0].textContent));
    labelEl = this.labels[0];
  }
  if (!base) {
    const lbl = this.closest && this.closest('label');
    if (lbl) {
      base = cap(norm(lbl.textContent));
      labelEl = lbl;
    }
  }
  if (!base) {
    const isToggle = tag === 'INPUT' &&
      (this.type === 'radio' || this.type === 'checkbox');
    if (!isToggle) {
      const v = norm(this.value);
      if (v) base = cap(v);
    }
    if (!base) {
      const ph = norm(this.placeholder);
      if (ph) base = cap(ph);
    }
  }
  if (!base) {
    let sib = this.nextSibling;
    while (sib && sib.nodeType === 3 && !norm(sib.textContent)) {
      sib = sib.nextSibling;
    }
    if (sib && sib.nodeType === 3) {
      base = cap(norm(sib.textContent));
    }
  }
  if (!base && this.parentElement) {
    base = cap(norm(this.parentElement.textContent));
  }

  // ---- CONTEXT PREFIX (radios + checkboxes only) ----
  const isToggle = tag === 'INPUT' &&
    (this.type === 'radio' || this.type === 'checkbox');
  if (!isToggle) {
    return base ? { visible: true, derivedName: base } : { visible: true };
  }

  // Walk up from the input's label, looking at PREVIOUS siblings at
  // each level for text that isn't itself an option label. The first
  // such text is the question stem for this group.
  let context = '';
  let cursor = labelEl || this;
  for (let depth = 0; depth < 6 && cursor && cursor.parentElement; depth++) {
    let sib = cursor.previousElementSibling;
    while (sib) {
      if (sib.tagName !== 'LABEL' && sib.tagName !== 'INPUT' &&
          sib.tagName !== 'BR' && sib.tagName !== 'SCRIPT' &&
          sib.tagName !== 'STYLE') {
        const t = cap(norm(sib.textContent));
        if (t && t !== base) {
          context = t;
          break;
        }
      }
      sib = sib.previousElementSibling;
    }
    if (context) break;
    // Also check if the parent has direct text-node children before
    // the cursor — e.g. "Improve my performance" as a text node
    // followed by labels.
    const parent = cursor.parentElement;
    if (parent) {
      let stem = '';
      for (const child of parent.childNodes) {
        if (child === cursor) break;
        if (child.nodeType === 3) {
          const t = norm(child.textContent);
          if (t) stem = t;
        } else if (child.nodeType === 1 && child.tagName !== 'LABEL' &&
                   child.tagName !== 'INPUT' && child.tagName !== 'BR') {
          const t = norm(child.textContent);
          if (t) stem = t;
        }
      }
      if (stem && stem !== base && stem.length <= 200) {
        context = stem;
        break;
      }
    }
    cursor = cursor.parentElement;
  }

  if (context) {
    return {
      visible: true,
      derivedName: '[' + context + '] ' + (base || '?'),
    };
  }
  return base ? { visible: true, derivedName: base } : { visible: true };
}`;
