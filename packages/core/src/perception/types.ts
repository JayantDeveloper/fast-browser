import type { AxNode, PageMeta, TextBlock } from "../driver.js";

export interface PerceptionFrame {
  meta: PageMeta;
  /** Interactive ax nodes only — these are the addressable elements. */
  interactive: AxNode[];
  /** Landmark/heading ax nodes — for context only, not addressable in actions. */
  landmarks: AxNode[];
  /** Structural visible-text walk. */
  text: TextBlock[];
  /** Stable identifier for loop-detection. */
  fingerprint: string;
}
