import { describe, expect, it, vi } from "vitest";
import type { AxNode, BrowserDriver, PageMeta, TextBlock } from "../../src/index.js";
import { maybeDismissConsent } from "../../src/robustness/consent.js";
import type { PerceptionFrame } from "../../src/perception/types.js";

const META: PageMeta = { url: "https://site.example/path", title: "x", scrollY: 0, viewportHeight: 800, documentHeight: 800 };

function frame(ax: AxNode[], text: TextBlock[] = []): PerceptionFrame {
  return {
    meta: META,
    interactive: ax.filter((n) => n.interactive),
    landmarks: ax.filter((n) => !n.interactive),
    text,
    fingerprint: "abc",
  };
}

function spyDriver(): BrowserDriver {
  return {
    attach: vi.fn(async () => {}),
    navigate: vi.fn(async () => {}),
    getPageMeta: vi.fn(async () => META),
    getAxSnapshot: vi.fn(async () => []),
    getVisibleText: vi.fn(async () => []),
    screenshot: vi.fn(async () => new Uint8Array(0)),
    click: vi.fn(async () => {}),
    type: vi.fn(async () => {}),
    scroll: vi.fn(async () => {}),
    waitForReady: vi.fn(async () => {}),
    evaluate: vi.fn(async () => undefined),
    detach: vi.fn(async () => {}),
  };
}

describe("maybeDismissConsent", () => {
  it("clicks an 'Accept all' button when cookie text is present", async () => {
    const d = spyDriver();
    const dismissed = new Set<string>();
    const ax: AxNode[] = [
      { backendNodeId: 10, role: "button", name: "Accept all", interactive: true },
      { backendNodeId: 11, role: "button", name: "Reject all", interactive: true },
    ];
    const text: TextBlock[] = [{ kind: "paragraph", text: "We use cookies to improve your experience." }];
    const r = await maybeDismissConsent(d, frame(ax, text), dismissed);
    expect(r.dismissed).toBe(true);
    expect(d.click).toHaveBeenCalledWith(10);
    expect(dismissed.has("https://site.example")).toBe(true);
  });

  it("returns no-consent-detected and marks origin handled when nothing matches", async () => {
    const d = spyDriver();
    const dismissed = new Set<string>();
    const r = await maybeDismissConsent(d, frame([]), dismissed);
    expect(r.dismissed).toBe(false);
    expect(r.reason).toBe("no-consent-detected");
    expect(dismissed.has("https://site.example")).toBe(true);
  });

  it("does not re-check an origin that was already handled", async () => {
    const d = spyDriver();
    const dismissed = new Set(["https://site.example"]);
    const r = await maybeDismissConsent(d, frame([]), dismissed);
    expect(r.reason).toBe("already-handled");
    expect(d.click).not.toHaveBeenCalled();
  });

  it("does NOT dismiss a 'Continue' button on a regular form (no consent context)", async () => {
    const d = spyDriver();
    const dismissed = new Set<string>();
    const ax: AxNode[] = [
      { backendNodeId: 50, role: "button", name: "Continue", interactive: true },
    ];
    const text: TextBlock[] = [{ kind: "paragraph", text: "Please fill out the form below." }];
    const r = await maybeDismissConsent(d, frame(ax, text), dismissed);
    expect(r.dismissed).toBe(false);
    expect(d.click).not.toHaveBeenCalled();
  });
});
