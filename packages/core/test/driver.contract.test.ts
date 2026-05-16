import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  type AxNode,
  type BrowserDriver,
  DriverError,
  type PageMeta,
} from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const coreSrcDir = join(here, "..", "src");

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkFiles(full));
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

function stripComments(src: string): string {
  // Strip /* ... */ then // to end of line. Good enough for TS source.
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("BrowserDriver contract", () => {
  it("a stub implementation satisfies the interface (compile-time check)", () => {
    // If this compiles, the interface shape is satisfied. Type errors here
    // are the actual signal; the runtime expect just keeps vitest happy.
    const stub: BrowserDriver = {
      async attach() {},
      async navigate() {},
      async getPageMeta(): Promise<PageMeta> {
        return {
          url: "about:blank",
          title: "",
          scrollY: 0,
          viewportHeight: 600,
          documentHeight: 600,
        };
      },
      async getAxSnapshot(): Promise<AxNode[]> {
        return [];
      },
      async getVisibleText() {
        return [];
      },
      async screenshot() {
        return new Uint8Array(0);
      },
      async click() {},
      async type() {},
      async scroll() {},
      async waitForReady() {},
      async evaluate<T>() {
        return undefined as T;
      },
      async detach() {},
    };
    expect(typeof stub.attach).toBe("function");
  });

  it("DriverError carries a typed code and is an Error", () => {
    const err = new DriverError("disabled", "the button is disabled");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("disabled");
    expect(err.name).toBe("DriverError");
  });
});

describe("core has no transport imports", () => {
  // Load-bearing invariant: the agent loop, perception, actions, robustness,
  // LLM client must NOT depend on any specific browser transport. If this
  // test fails, the adapter boundary has been violated.
  const forbidden = [
    "playwright",
    "puppeteer",
    "chrome-remote-interface",
    "@types/chrome",
  ];

  it.each(forbidden)("no source file imports '%s'", (pkg) => {
    const offenders: string[] = [];
    for (const file of walkFiles(coreSrcDir)) {
      const text = stripComments(readFileSync(file, "utf8"));
      const re = new RegExp(`from\\s+["']${pkg.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}(/.*)?["']`);
      if (re.test(text)) offenders.push(file);
    }
    expect(offenders, `core/ must not import ${pkg}: ${offenders.join(", ")}`).toEqual([]);
  });

  it("no source file calls chrome.* extension APIs", () => {
    const offenders: string[] = [];
    for (const file of walkFiles(coreSrcDir)) {
      const text = stripComments(readFileSync(file, "utf8"));
      if (/\bchrome\.(debugger|tabs|scripting|runtime|storage|alarms|sidePanel|offscreen)\s*\.\w/.test(text)) {
        offenders.push(file);
      }
    }
    expect(offenders, `core/ must not call chrome.* APIs: ${offenders.join(", ")}`).toEqual([]);
  });
});
