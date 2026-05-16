import { describe, expect, it, vi } from "vitest";
import type {
  Action,
  AskJsonOpts,
  AskJsonResult,
  AxNode,
  BrowserDriver,
  PageMeta,
  Provider,
  TextBlock,
} from "../../src/index.js";
import { run } from "../../src/loop/agent.js";

const META: PageMeta = {
  url: "https://example.com",
  title: "x",
  scrollY: 0,
  viewportHeight: 800,
  documentHeight: 800,
};

function makeDriver(snaps: AxNode[][], texts: TextBlock[][] = []): BrowserDriver {
  let i = 0;
  return {
    attach: vi.fn(async () => {}),
    navigate: vi.fn(async () => {}),
    getPageMeta: vi.fn(async () => META),
    getAxSnapshot: vi.fn(async () => snaps[Math.min(i, snaps.length - 1)] ?? []),
    getVisibleText: vi.fn(async () => texts[Math.min(i, texts.length - 1)] ?? []),
    screenshot: vi.fn(async () => new Uint8Array(0)),
    click: vi.fn(async () => { i++; }),
    type: vi.fn(async () => { i++; }),
    scroll: vi.fn(async () => {}),
    waitForReady: vi.fn(async () => {}),
    evaluate: vi.fn(async () => undefined),
    detach: vi.fn(async () => {}),
  };
}

function scriptedActor(actions: Action[]): Provider {
  let n = 0;
  return {
    name: "test",
    model: "test",
    async askJson<T>(_opts: AskJsonOpts): Promise<AskJsonResult<T>> {
      const action = actions[Math.min(n, actions.length - 1)]!;
      n++;
      return {
        data: action as unknown as T,
        usage: { inputTokens: 100, outputTokens: 10, costUsd: 0.0001 },
        latencyMs: 50,
      };
    },
  };
}

describe("run() agent loop", () => {
  it("immediate done terminates after 1 step", async () => {
    const driver = makeDriver([[]]);
    const actor = scriptedActor([{ type: "done", result: "trivially done" }]);
    const r = await run(driver, { actor, maxSteps: 5 }, { task: "do nothing" });
    expect(r.success).toBe(true);
    expect(r.steps).toBe(1);
    expect(r.exitReason).toBe("done");
    expect(r.finalResult).toBe("trivially done");
  });

  it("click → done completes in 2 steps", async () => {
    const button: AxNode = { backendNodeId: 7, role: "button", name: "Go", interactive: true };
    const driver = makeDriver([[button], [button]]);
    const actor = scriptedActor([
      { type: "click", targetNodeId: 7 },
      { type: "done", result: "clicked it" },
    ]);
    const r = await run(driver, { actor }, { task: "click go" });
    expect(r.success).toBe(true);
    expect(r.steps).toBe(2);
    expect(driver.click).toHaveBeenCalledWith(7);
  });

  it("max_steps without done returns success:false, exitReason:max_steps", async () => {
    const driver = makeDriver([[]]);
    const actor = scriptedActor([{ type: "scroll", direction: "down", amount: 100 }]);
    const r = await run(driver, { actor, maxSteps: 3 }, { task: "loop" });
    expect(r.success).toBe(false);
    expect(r.steps).toBe(3);
    expect(r.exitReason).toBe("max_steps");
  });

  it("invalid action shape is recorded as parse_error and loop continues", async () => {
    const driver = makeDriver([[]]);
    let n = 0;
    const actor: Provider = {
      name: "test",
      model: "test",
      async askJson<T>(): Promise<AskJsonResult<T>> {
        n++;
        if (n === 1) return { data: { foo: "bar" } as unknown as T, usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1 };
        return { data: { type: "done", result: "ok" } as unknown as T, usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1 };
      },
    };
    const r = await run(driver, { actor, maxSteps: 5 }, { task: "x" });
    expect(r.success).toBe(true);
    expect(r.steps).toBe(2);
    expect(r.trajectory[0]!.result.ok).toBe(false);
  });

  it("onStep callback fires per step with the trajectory entry", async () => {
    const driver = makeDriver([[]]);
    const actor = scriptedActor([{ type: "done", result: "ok" }]);
    const seen: number[] = [];
    await run(driver, { actor, onStep: (s) => seen.push(s.index) }, { task: "x" });
    expect(seen).toEqual([1]);
  });

  it("startUrl triggers navigate before the loop", async () => {
    const driver = makeDriver([[]]);
    const actor = scriptedActor([{ type: "done", result: "ok" }]);
    await run(driver, { actor }, { task: "x", startUrl: "https://here.test" });
    expect(driver.navigate).toHaveBeenCalledWith("https://here.test");
  });

  it("cost is summed across steps", async () => {
    const button: AxNode = { backendNodeId: 7, role: "button", name: "Go", interactive: true };
    const driver = makeDriver([[button], [button]]);
    const actor = scriptedActor([
      { type: "click", targetNodeId: 7 },
      { type: "done", result: "ok" },
    ]);
    const r = await run(driver, { actor }, { task: "x" });
    expect(r.costUsdEstimate).toBeCloseTo(0.0002, 6);
  });
});
