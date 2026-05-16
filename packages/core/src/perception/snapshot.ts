import { createHash } from "node:crypto";
import type { BrowserDriver, AxNode } from "../driver.js";
import type { PerceptionFrame } from "./types.js";

export interface SnapshotOptions {
  /** Number of viewports above/below to include in the visible-text walk. Default 1. */
  viewportPad?: number;
}

export async function snapshot(
  driver: BrowserDriver,
  opts: SnapshotOptions = {},
): Promise<PerceptionFrame> {
  // Parallel — perception is the dominant cost per step, and these two are
  // independent CDP calls.
  const [meta, ax, text] = await Promise.all([
    driver.getPageMeta(),
    driver.getAxSnapshot(),
    driver.getVisibleText({ viewportPad: opts.viewportPad ?? 1 }),
  ]);

  const interactive = ax.filter((n) => n.interactive);
  const landmarks = ax.filter((n) => !n.interactive);

  const h = createHash("sha256");
  h.update(meta.url);
  h.update("|");
  h.update(
    interactive
      .map((n) => n.backendNodeId)
      .sort((a, b) => a - b)
      .join(","),
  );
  h.update("|");
  // First N chars of concatenated text — captures meaningful page change
  // without making every keystroke flip the fingerprint.
  const textBlob = text.map((b) => b.text).join(" ").slice(0, 256);
  h.update(textBlob);
  const fingerprint = h.digest("hex").slice(0, 16);

  return { meta, interactive, landmarks, text, fingerprint };
}

export interface SerializeOptions {
  /** Cap interactive elements rendered. Default 200. */
  maxInteractive?: number;
  /** Cap text blocks rendered. Default 80. */
  maxText?: number;
  /** Cap chars per element name. Default unlimited (0). */
  maxNameChars?: number;
}

/**
 * Serialize a PerceptionFrame for inclusion in an LLM prompt. The format is:
 *
 *   ## URL
 *   <url>
 *
 *   ## Interactive elements (addressable by [N])
 *   [42] button 'Submit' (disabled)
 *   [43] textbox 'Email' = "current@value"
 *   [44] link 'Home'
 *
 *   ## Visible text (read-only)
 *   heading 1: The Quiz
 *   paragraph: What is the answer?
 *   list-item: Choice A
 *
 * Index `[N]` is the array position in `frame.interactive` — but the *action*
 * the model emits must reference `backendNodeId`, not the index. The index is
 * a presentation aid; the action layer rejects index-only references.
 */
export function serializeFrame(frame: PerceptionFrame, opts: SerializeOptions = {}): string {
  const maxInteractive = opts.maxInteractive ?? 200;
  const maxText = opts.maxText ?? 80;
  const maxName = opts.maxNameChars ?? 0;

  const lines: string[] = [];
  lines.push(`## URL`);
  lines.push(frame.meta.url);
  lines.push(`title: ${frame.meta.title}`);
  lines.push("");
  lines.push(`## Interactive elements (${frame.interactive.length} addressable; use node=N as targetNodeId)`);
  const interactive = frame.interactive.slice(0, maxInteractive);
  for (const n of interactive) {
    let name = n.name;
    if (maxName > 0 && name.length > maxName) name = name.slice(0, maxName) + "…";
    let line = `node=${n.backendNodeId}  ${n.role} '${name}'`;
    if (n.value !== undefined) line += ` = ${JSON.stringify(n.value)}`;
    if (n.disabled) line += ` (disabled)`;
    lines.push(line);
  }
  if (frame.interactive.length > maxInteractive) {
    lines.push(`… and ${frame.interactive.length - maxInteractive} more (consider scrolling or being more specific)`);
  }

  if (frame.text.length > 0) {
    lines.push("");
    lines.push(`## Visible text (read-only context, NOT addressable)`);
    const text = frame.text.slice(0, maxText);
    for (const b of text) {
      const prefix = b.kind === "heading" ? `heading ${b.level ?? "?"}` : b.kind;
      lines.push(`${prefix}: ${b.text}`);
    }
    if (frame.text.length > maxText) {
      lines.push(`… and ${frame.text.length - maxText} more text blocks`);
    }
  }

  if (frame.landmarks.length > 0) {
    const titles = frame.landmarks
      .filter((l) => l.role === "heading" && l.name)
      .slice(0, 6)
      .map((l) => `- ${l.name}`);
    if (titles.length > 0) {
      lines.push("");
      lines.push(`## Page headings`);
      lines.push(...titles);
    }
  }

  return lines.join("\n");
}

/**
 * Index → backendNodeId lookup. Use this when consuming an action whose
 * targetNodeId came in as an `[N]`-style index from the model. The action
 * executor itself accepts only backendNodeIds; this helper bridges
 * model-emitted indices to the stable identifier.
 */
export function resolveIndex(frame: PerceptionFrame, index: number): number | undefined {
  return frame.interactive[index]?.backendNodeId;
}
