import { describe, expect, it } from "vitest";
import { safeParseJson } from "../../src/llm/safe-parse.js";

describe("safeParseJson", () => {
  it("parses clean JSON", () => {
    const r = safeParseJson('{"type":"click","targetNodeId":42}');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toEqual({ type: "click", targetNodeId: 42 });
      expect(r.repaired).toBe(false);
    }
  });

  it("strips ```json fences", () => {
    const r = safeParseJson('```json\n{"type":"done","result":"ok"}\n```');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.repaired).toBe(true);
  });

  it("strips bare ``` fences", () => {
    const r = safeParseJson('```\n{"a":1}\n```');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual({ a: 1 });
  });

  it("recovers from trailing prose", () => {
    const r = safeParseJson('{"type":"click","targetNodeId":7} — that should do it');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual({ type: "click", targetNodeId: 7 });
  });

  it("recovers from leading prose", () => {
    const r = safeParseJson('Here is my action: {"type":"done","result":"done"}');
    expect(r.ok).toBe(true);
  });

  it("returns ok:false for un-recoverable garbage", () => {
    const r = safeParseJson("not json at all, no braces here");
    expect(r.ok).toBe(false);
  });

  it("handles arrays", () => {
    const r = safeParseJson("[1, 2, 3]");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual([1, 2, 3]);
  });
});
