import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DriverError } from "@fast-browser/core";
import { CdpNodeDriver, launchChrome, type LaunchedChrome } from "../src/index.js";

let chrome: LaunchedChrome;
let driver: CdpNodeDriver;

const FIXTURE_HTML = `<!doctype html>
<html><head><title>fixture</title></head>
<body>
  <h1>The Quiz</h1>
  <p>What is the answer?</p>
  <form>
    <label><input type="radio" name="q" value="a"> Choice A is here</label>
    <label><input type="radio" name="q" value="b"> Choice B is here</label>
    <button type="submit" id="submit">Submit Answer</button>
    <button type="button" id="dis" disabled>Disabled</button>
  </form>
</body></html>`;

const FIXTURE_URL = `data:text/html;base64,${Buffer.from(FIXTURE_HTML).toString("base64")}`;

beforeAll(async () => {
  chrome = await launchChrome({ headless: true });
  driver = new CdpNodeDriver({ port: chrome.port });
  await driver.attach({ url: FIXTURE_URL });
}, 20_000);

afterAll(async () => {
  await driver?.detach();
  await chrome?.close();
});

describe("CdpNodeDriver integration", () => {
  it("getPageMeta returns the fixture URL and title", async () => {
    const meta = await driver.getPageMeta();
    expect(meta.title).toBe("fixture");
    expect(meta.url).toContain("text/html");
  });

  it("getAxSnapshot returns interactive nodes with backendNodeIds", async () => {
    const snap = await driver.getAxSnapshot();
    expect(snap.length).toBeGreaterThan(0);
    const submit = snap.find((n) => n.role === "button" && n.name === "Submit Answer");
    expect(submit).toBeDefined();
    expect(submit!.backendNodeId).toBeGreaterThan(0);
    expect(submit!.interactive).toBe(true);
    const disabled = snap.find((n) => n.role === "button" && n.name === "Disabled");
    expect(disabled?.disabled).toBe(true);
    // The two radios must NOT collapse into one
    const radios = snap.filter((n) => n.role === "radio");
    expect(radios.length).toBe(2);
  });

  it("getVisibleText returns headings and paragraphs", async () => {
    const text = await driver.getVisibleText();
    const heading = text.find((b) => b.kind === "heading" && b.text === "The Quiz");
    const para = text.find((b) => b.kind === "paragraph" && b.text === "What is the answer?");
    expect(heading).toBeDefined();
    expect(heading?.level).toBe(1);
    expect(para).toBeDefined();
  });

  it("click() actuates a button by backendNodeId", async () => {
    // Add a click handler that flips a flag we can read back.
    await driver.evaluate(`
      window.__clicked = false;
      document.getElementById('submit').addEventListener('click', (e) => {
        e.preventDefault();
        window.__clicked = true;
      });
    `);
    const snap = await driver.getAxSnapshot();
    const submit = snap.find((n) => n.role === "button" && n.name === "Submit Answer")!;
    await driver.click(submit.backendNodeId);
    const flag = await driver.evaluate<boolean>("window.__clicked");
    expect(flag).toBe(true);
  });

  it("click() on a disabled button rejects with DriverError(disabled)", async () => {
    const snap = await driver.getAxSnapshot();
    const disabled = snap.find((n) => n.role === "button" && n.name === "Disabled")!;
    await expect(driver.click(disabled.backendNodeId)).rejects.toMatchObject({
      name: "DriverError",
      code: "disabled",
    });
  });

  it("after detach(), all methods reject with not_attached", async () => {
    const local = new CdpNodeDriver({ port: chrome.port });
    await local.attach({});
    await local.detach();
    await expect(local.getPageMeta()).rejects.toBeInstanceOf(DriverError);
  });
});
