import type { BrowserDriver, ScrollDirection } from "../driver.js";
import { snapshot } from "../perception/snapshot.js";
import type { PerceptionFrame } from "../perception/types.js";

/**
 * When the actor names an element that isn't in the current frame, scroll
 * and re-snapshot up to `maxScrolls` times looking for it. Returns the
 * frame that contains the element, or null if not found.
 */
export async function scrollUntilFound(
  driver: BrowserDriver,
  match: (frame: PerceptionFrame) => boolean,
  opts: { maxScrolls?: number; direction?: ScrollDirection; amount?: number } = {},
): Promise<PerceptionFrame | null> {
  const maxScrolls = opts.maxScrolls ?? 3;
  const direction = opts.direction ?? "down";
  const amount = opts.amount ?? 600;
  for (let i = 0; i < maxScrolls; i++) {
    await driver.scroll(direction, amount);
    await driver.waitForReady({ timeoutMs: 1000, stableMs: 100 }).catch(() => {});
    const frame = await snapshot(driver);
    if (match(frame)) return frame;
  }
  return null;
}
