import { shortHash } from "../util/hash.js";

export interface CachedSelector {
  urlPattern: string;
  intentHash: string;
  /** Stored as backendNodeId at time of cache; only useful within the same DOM. */
  lastBackendNodeId: number;
  /** Role + name from the last successful action — used to re-find the node in a fresh AxTree. */
  role: string;
  name: string;
  hits: number;
}

/**
 * In-memory selector cache. Phase 1 only — persistence across sessions
 * is deferred. Keyed on (URL pattern, intent hash). On cache hit, the
 * loop tries to re-find an ax node with the same role+name in the
 * current frame and skips the actor call.
 */
export class SelectorCache {
  private store = new Map<string, CachedSelector>();

  private key(urlPattern: string, intentHash: string): string {
    return `${urlPattern}::${intentHash}`;
  }

  static urlPattern(url: string): string {
    try {
      const u = new URL(url);
      return `${u.origin}${u.pathname}`;
    } catch {
      return url;
    }
  }

  static intentHash(intent: string): string {
    return shortHash(intent);
  }

  get(urlPattern: string, intentHash: string): CachedSelector | undefined {
    return this.store.get(this.key(urlPattern, intentHash));
  }

  put(entry: Omit<CachedSelector, "hits">): void {
    const k = this.key(entry.urlPattern, entry.intentHash);
    const existing = this.store.get(k);
    this.store.set(k, { ...entry, hits: existing ? existing.hits + 1 : 0 });
  }

  evict(urlPattern: string, intentHash: string): void {
    this.store.delete(this.key(urlPattern, intentHash));
  }

  size(): number {
    return this.store.size;
  }
}
