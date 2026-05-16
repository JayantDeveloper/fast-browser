import type { Action } from "../actions/vocabulary.js";

/**
 * Detects oscillation: the same action repeating at the same place, or
 * the page state failing to advance across multiple actions. When tripped,
 * the loop should escalate to the planner (U8) or bail.
 */
export class LoopDetector {
  private window: { url: string; type: string; targetNodeId?: number; fingerprint: string }[] = [];
  private readonly windowSize: number;

  constructor(windowSize = 5) {
    this.windowSize = windowSize;
  }

  observe(opts: { url: string; action: Action; fingerprint: string }): { stuck: boolean; reason?: string } {
    const entry = {
      url: opts.url,
      type: opts.action.type,
      targetNodeId: "targetNodeId" in opts.action ? opts.action.targetNodeId : undefined,
      fingerprint: opts.fingerprint,
    };
    this.window.push(entry);
    if (this.window.length > this.windowSize) this.window.shift();

    // (a) same (url, type, targetNodeId) appears twice in a row.
    if (this.window.length >= 2) {
      const a = this.window.at(-1)!;
      const b = this.window.at(-2)!;
      if (
        a.url === b.url &&
        a.type === b.type &&
        a.targetNodeId === b.targetNodeId &&
        a.type !== "wait_for" &&
        a.type !== "scroll"
      ) {
        return { stuck: true, reason: `repeated ${a.type}@${a.targetNodeId ?? "-"} on ${a.url}` };
      }
    }

    // (b) snapshot fingerprint unchanged across the last 3 non-noop actions.
    if (this.window.length >= 3) {
      const last3 = this.window.slice(-3);
      const allSameFp = last3.every((e) => e.fingerprint === last3[0]!.fingerprint);
      const meaningful = last3.every((e) => e.type === "click" || e.type === "type" || e.type === "goto");
      if (allSameFp && meaningful) {
        return { stuck: true, reason: `page state unchanged across ${last3.length} actions` };
      }
    }

    return { stuck: false };
  }

  reset(): void {
    this.window = [];
  }
}
