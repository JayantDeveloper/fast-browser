import { describe, expect, it } from "vitest";
import { LoopDetector } from "../../src/robustness/loop-detect.js";

describe("LoopDetector", () => {
  it("trips on the same (url, type, targetNodeId) twice in a row", () => {
    const d = new LoopDetector();
    expect(d.observe({ url: "x", action: { type: "click", targetNodeId: 5 }, fingerprint: "fp1" }).stuck).toBe(false);
    const r = d.observe({ url: "x", action: { type: "click", targetNodeId: 5 }, fingerprint: "fp2" });
    expect(r.stuck).toBe(true);
    expect(r.reason).toContain("repeated click@5");
  });

  it("does NOT trip on alternation", () => {
    const d = new LoopDetector();
    expect(d.observe({ url: "x", action: { type: "click", targetNodeId: 5 }, fingerprint: "f" }).stuck).toBe(false);
    expect(d.observe({ url: "x", action: { type: "click", targetNodeId: 7 }, fingerprint: "g" }).stuck).toBe(false);
    expect(d.observe({ url: "x", action: { type: "click", targetNodeId: 5 }, fingerprint: "h" }).stuck).toBe(false);
  });

  it("does NOT trip on repeated scroll or wait_for", () => {
    const d = new LoopDetector();
    d.observe({ url: "x", action: { type: "scroll", direction: "down", amount: 600 }, fingerprint: "f" });
    const r = d.observe({ url: "x", action: { type: "scroll", direction: "down", amount: 600 }, fingerprint: "g" });
    expect(r.stuck).toBe(false);
  });

  it("trips when fingerprint is unchanged across 3 meaningful actions", () => {
    const d = new LoopDetector();
    d.observe({ url: "x", action: { type: "click", targetNodeId: 1 }, fingerprint: "same" });
    d.observe({ url: "x", action: { type: "click", targetNodeId: 2 }, fingerprint: "same" });
    const r = d.observe({ url: "x", action: { type: "click", targetNodeId: 3 }, fingerprint: "same" });
    expect(r.stuck).toBe(true);
    expect(r.reason).toContain("page state unchanged");
  });

  it("reset clears the window", () => {
    const d = new LoopDetector();
    d.observe({ url: "x", action: { type: "click", targetNodeId: 5 }, fingerprint: "f" });
    d.reset();
    const r = d.observe({ url: "x", action: { type: "click", targetNodeId: 5 }, fingerprint: "g" });
    expect(r.stuck).toBe(false);
  });
});
