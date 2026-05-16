import { describe, expect, it } from "vitest";
import type { AxNode, BrowserDriver, PageMeta, TextBlock } from "../../src/index.js";
import { resolveIndex, serializeFrame, snapshot } from "../../src/perception/snapshot.js";

function fakeDriver(parts: {
  meta: PageMeta;
  ax: AxNode[];
  text: TextBlock[];
}): BrowserDriver {
  return {
    async attach() {},
    async navigate() {},
    async getPageMeta() { return parts.meta; },
    async getAxSnapshot() { return parts.ax; },
    async getVisibleText() { return parts.text; },
    async screenshot() { return new Uint8Array(0); },
    async click() {},
    async type() {},
    async scroll() {},
    async waitForReady() {},
    async evaluate<T>() { return undefined as T; },
    async detach() {},
  };
}

const META: PageMeta = {
  url: "https://example.com/quiz",
  title: "Quiz",
  scrollY: 0,
  viewportHeight: 800,
  documentHeight: 1200,
};

const QUIZ_AX: AxNode[] = [
  { backendNodeId: 10, role: "heading", name: "The Quiz", interactive: false },
  { backendNodeId: 11, role: "radio", name: "Choice A", interactive: true },
  { backendNodeId: 12, role: "radio", name: "Choice B", interactive: true },
  { backendNodeId: 13, role: "radio", name: "Choice C", interactive: true },
  { backendNodeId: 14, role: "button", name: "Submit", interactive: true },
  { backendNodeId: 15, role: "button", name: "Disabled", interactive: true, disabled: true },
];

const QUIZ_TEXT: TextBlock[] = [
  { kind: "heading", level: 1, text: "The Quiz" },
  { kind: "paragraph", text: "What is the answer to the question?" },
];

describe("snapshot", () => {
  it("combines ax + text + meta into a PerceptionFrame with stable fingerprint", async () => {
    const d = fakeDriver({ meta: META, ax: QUIZ_AX, text: QUIZ_TEXT });
    const frame = await snapshot(d);
    expect(frame.meta.url).toBe(META.url);
    expect(frame.interactive.length).toBe(5); // 3 radios + submit + disabled-button
    expect(frame.landmarks.length).toBe(1); // heading
    expect(frame.text.length).toBe(2);
    expect(frame.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it("fingerprint changes when interactive set changes", async () => {
    const a = await snapshot(fakeDriver({ meta: META, ax: QUIZ_AX, text: QUIZ_TEXT }));
    const b = await snapshot(
      fakeDriver({ meta: META, ax: QUIZ_AX.slice(0, 5), text: QUIZ_TEXT }),
    );
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  it("fingerprint is identical for identical input", async () => {
    const a = await snapshot(fakeDriver({ meta: META, ax: QUIZ_AX, text: QUIZ_TEXT }));
    const b = await snapshot(fakeDriver({ meta: META, ax: QUIZ_AX, text: QUIZ_TEXT }));
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it("includes the question stem in visible text (regression for the AxTree-only failure)", async () => {
    const frame = await snapshot(fakeDriver({ meta: META, ax: QUIZ_AX, text: QUIZ_TEXT }));
    const stem = frame.text.find((t) => t.text.includes("What is the answer"));
    expect(stem).toBeDefined();
  });

  it("two visually identical buttons remain distinct (no role+name dedup)", async () => {
    const ax: AxNode[] = [
      { backendNodeId: 1, role: "button", name: "OK", interactive: true },
      { backendNodeId: 2, role: "button", name: "OK", interactive: true },
    ];
    const frame = await snapshot(fakeDriver({ meta: META, ax, text: [] }));
    expect(frame.interactive.length).toBe(2);
    expect(frame.interactive[0]!.backendNodeId).toBe(1);
    expect(frame.interactive[1]!.backendNodeId).toBe(2);
  });
});

describe("serializeFrame", () => {
  it("renders interactive lines with index → backendNodeId mapping", async () => {
    const frame = await snapshot(fakeDriver({ meta: META, ax: QUIZ_AX, text: QUIZ_TEXT }));
    const out = serializeFrame(frame);
    expect(out).toContain("[0] node=11 radio 'Choice A'");
    expect(out).toContain("[3] node=14 button 'Submit'");
    expect(out).toContain("(disabled)"); // disabled flag on submit-disabled button is absent here (Submit is enabled), but disabled button still present in interactive section if disabled=true — let's at least confirm marker syntax appears in some line
  });

  it("includes the visible-text section with question stem", async () => {
    const frame = await snapshot(fakeDriver({ meta: META, ax: QUIZ_AX, text: QUIZ_TEXT }));
    const out = serializeFrame(frame);
    expect(out).toContain("## Visible text");
    expect(out).toContain("What is the answer to the question?");
  });

  it("respects maxInteractive cap", async () => {
    const big: AxNode[] = Array.from({ length: 250 }, (_, i) => ({
      backendNodeId: 100 + i,
      role: "button",
      name: `Btn ${i}`,
      interactive: true,
    }));
    const frame = await snapshot(fakeDriver({ meta: META, ax: big, text: [] }));
    const out = serializeFrame(frame, { maxInteractive: 10 });
    expect(out).toContain("[9] node=109 button 'Btn 9'");
    expect(out).not.toContain("[10] node=110");
    expect(out).toContain("and 240 more");
  });

  it("does NOT truncate names by default (regression for predecessor's 200-char cap)", async () => {
    const longName = "a".repeat(500);
    const ax: AxNode[] = [
      { backendNodeId: 1, role: "button", name: longName, interactive: true },
    ];
    const frame = await snapshot(fakeDriver({ meta: META, ax, text: [] }));
    const out = serializeFrame(frame);
    expect(out).toContain(longName);
  });
});

describe("resolveIndex", () => {
  it("maps a presentation index to a backendNodeId", async () => {
    const frame = await snapshot(fakeDriver({ meta: META, ax: QUIZ_AX, text: QUIZ_TEXT }));
    expect(resolveIndex(frame, 0)).toBe(11); // first radio
    expect(resolveIndex(frame, 3)).toBe(14); // submit
    expect(resolveIndex(frame, 999)).toBeUndefined();
  });
});
