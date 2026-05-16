import { describe, expect, it, vi } from "vitest";
import type { AxNode, BrowserDriver, PageMeta } from "../../src/index.js";
import { DriverError } from "../../src/index.js";
import { execute } from "../../src/actions/executor.js";
import type { PerceptionFrame } from "../../src/perception/types.js";

const META: PageMeta = {
  url: "https://example.com",
  title: "x",
  scrollY: 0,
  viewportHeight: 800,
  documentHeight: 800,
};

function frame(ax: AxNode[]): PerceptionFrame {
  const interactive = ax.filter((n) => n.interactive);
  const landmarks = ax.filter((n) => !n.interactive);
  return { meta: META, interactive, landmarks, text: [], fingerprint: "deadbeef00000000" };
}

function spyDriver(overrides: Partial<BrowserDriver> = {}): BrowserDriver {
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
    ...overrides,
  };
}

const SUBMIT: AxNode = { backendNodeId: 42, role: "button", name: "Submit", interactive: true };
const DISABLED: AxNode = { backendNodeId: 99, role: "button", name: "Disabled", interactive: true, disabled: true };
const TEXTBOX: AxNode = { backendNodeId: 7, role: "textbox", name: "Email", interactive: true };

describe("execute(click)", () => {
  it("happy: calls driver.click with the backendNodeId from the frame", async () => {
    const d = spyDriver();
    const r = await execute(frame([SUBMIT]), { type: "click", targetNodeId: 42 }, d);
    expect(r.ok).toBe(true);
    expect(r.summary).toContain("Submit");
    expect(d.click).toHaveBeenCalledWith(42);
  });

  it("regression: targetNodeId not in current frame returns unknown_target without touching driver", async () => {
    const d = spyDriver();
    const r = await execute(frame([SUBMIT]), { type: "click", targetNodeId: 999 }, d);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("unknown_target");
    expect(d.click).not.toHaveBeenCalled();
  });

  it("disabled element returns disabled error without touching driver", async () => {
    const d = spyDriver();
    const r = await execute(frame([DISABLED]), { type: "click", targetNodeId: 99 }, d);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("disabled");
    expect(d.click).not.toHaveBeenCalled();
  });

  it("driver throwing DriverError(disabled) maps to disabled", async () => {
    const d = spyDriver({ click: vi.fn(async () => { throw new DriverError("disabled"); }) });
    const r = await execute(frame([SUBMIT]), { type: "click", targetNodeId: 42 }, d);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("disabled");
  });

  it("driver throwing generic timeout maps to timeout", async () => {
    const d = spyDriver({ click: vi.fn(async () => { throw new Error("operation timeout 4000ms"); }) });
    const r = await execute(frame([SUBMIT]), { type: "click", targetNodeId: 42 }, d);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("timeout");
  });
});

describe("execute(type)", () => {
  it("happy: calls driver.type with the value", async () => {
    const d = spyDriver();
    const r = await execute(frame([TEXTBOX]), { type: "type", targetNodeId: 7, value: "hi" }, d);
    expect(r.ok).toBe(true);
    expect(d.type).toHaveBeenCalledWith(7, "hi");
  });

  it("with submit:true, also calls evaluate to requestSubmit the form", async () => {
    const d = spyDriver();
    await execute(frame([TEXTBOX]), { type: "type", targetNodeId: 7, value: "hi", submit: true }, d);
    expect(d.evaluate).toHaveBeenCalled();
  });
});

describe("execute(scroll)", () => {
  it("forwards direction and amount to driver", async () => {
    const d = spyDriver();
    const r = await execute(frame([]), { type: "scroll", direction: "down", amount: 600 }, d);
    expect(r.ok).toBe(true);
    expect(d.scroll).toHaveBeenCalledWith("down", 600);
  });
});

describe("execute(goto)", () => {
  it("forwards url to driver.navigate", async () => {
    const d = spyDriver();
    const r = await execute(frame([]), { type: "goto", url: "https://x" }, d);
    expect(r.ok).toBe(true);
    expect(d.navigate).toHaveBeenCalledWith("https://x");
  });

  it("DriverError(navigation_failed) → internal (we don't expose that code yet)", async () => {
    const d = spyDriver({ navigate: vi.fn(async () => { throw new DriverError("navigation_failed", "DNS"); }) });
    const r = await execute(frame([]), { type: "goto", url: "https://x" }, d);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("internal");
  });
});

describe("execute(done)", () => {
  it("returns terminal:true with the result string as summary", async () => {
    const d = spyDriver();
    const r = await execute(frame([]), { type: "done", result: "found it: 42" }, d);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.terminal).toBe(true);
      expect(r.summary).toBe("found it: 42");
    }
  });
});

describe("execute(wait_for)", () => {
  it("ms variant resolves after the delay", async () => {
    const d = spyDriver();
    const t = Date.now();
    const r = await execute(frame([]), { type: "wait_for", ms: 50 }, d);
    expect(Date.now() - t).toBeGreaterThanOrEqual(45);
    expect(r.ok).toBe(true);
  });

  it("textContains variant resolves once text appears", async () => {
    let n = 0;
    const d = spyDriver({
      getVisibleText: vi.fn(async () => {
        n++;
        return n >= 2 ? [{ kind: "paragraph" as const, text: "Score: 18/20" }] : [];
      }),
    });
    const r = await execute(frame([]), { type: "wait_for", textContains: "Score" }, d);
    expect(r.ok).toBe(true);
  });
});
