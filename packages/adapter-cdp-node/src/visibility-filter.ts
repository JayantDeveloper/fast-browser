/**
 * Filter an AxNode list down to elements visible in (or near) the viewport.
 *
 * This is the highest-leverage perception change: typical sites surface
 * 100+ navigation chrome links in their accessibility tree. Without this
 * filter, the LLM prompt drowns in irrelevant elements and the model
 * hallucinates stale node IDs after page transitions.
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

interface CallFunctionResult {
  result: { value: boolean };
}

/**
 * Returns only the nodes whose bounding rect intersects the padded viewport
 * and which are not display:none / visibility:hidden.
 */
export async function filterToVisible(
  client: CdpClient,
  nodes: AxNode[],
): Promise<AxNode[]> {
  if (nodes.length === 0) {
    return nodes;
  }

  const resolved = await resolveNodes(client, nodes);
  const visibleIds = await selectVisible(client, resolved);
  return nodes.filter((n) => visibleIds.has(n.backendNodeId));
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

async function selectVisible(
  client: CdpClient,
  resolved: ResolvedNode[],
): Promise<Set<number>> {
  const visible = new Set<number>();
  await Promise.all(
    resolved.map(async (item) => {
      try {
        const r = (await client.send('Runtime.callFunctionOn', {
          objectId: item.objectId,
          functionDeclaration: VISIBILITY_FN,
          arguments: [{ value: VIEWPORT_PAD }],
          returnByValue: true,
        })) as CallFunctionResult;
        if (r.result.value === true) {
          visible.add(item.backendNodeId);
        }
      } catch {
        // Best-effort: if the node was detached between resolve and check,
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
  return visible;
}

/**
 * Page-context function that runs against each resolved DOM node.
 * Defined as a string because Runtime.callFunctionOn requires source text,
 * not a JS reference, and stringification would lose the closure anyway.
 */
const VISIBILITY_FN = `function (pad) {
  if (typeof this.getBoundingClientRect !== 'function') {
    return false;
  }
  const r = this.getBoundingClientRect();
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  if (r.bottom < -vh * pad) return false;
  if (r.top > vh * (pad + 1)) return false;
  if (r.right < 0 || r.left > vw) return false;
  if (r.width === 0 && r.height === 0) return false;
  const s = window.getComputedStyle(this);
  if (s.visibility === 'hidden' || s.display === 'none') return false;
  return true;
}`;
