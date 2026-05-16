import type { TrajectoryStep } from "./types.js";

/**
 * Structured trajectory storage. Replaces the predecessor's flat 5-string
 * truncation. Serializes to a cache-friendly summary for the LLM prompt.
 */
export class History {
  private readonly steps: TrajectoryStep[] = [];

  push(step: TrajectoryStep): void {
    this.steps.push(step);
  }

  size(): number {
    return this.steps.length;
  }

  all(): readonly TrajectoryStep[] {
    return this.steps;
  }

  last(n = 1): TrajectoryStep[] {
    return this.steps.slice(-n);
  }

  /**
   * Render the recent trajectory for the LLM prompt. Each line is concise
   * enough to fit several in the prompt without bloating the input.
   */
  serialize(window = 8): string {
    if (this.steps.length === 0) return "";
    const recent = this.steps.slice(-window);
    return recent
      .map((s) => {
        const verb = s.action.type;
        const tag = s.result.ok ? "✓" : `✗ (${s.result.error})`;
        return `  ${s.index}. ${verb} → ${tag} ${s.result.summary}`;
      })
      .join("\n");
  }
}
