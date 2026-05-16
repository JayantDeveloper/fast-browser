import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface LaunchedChrome {
  port: number;
  process: ChildProcess;
  userDataDir: string;
  close: () => Promise<void>;
}

export interface LaunchOptions {
  /** Override the Chrome executable path. Defaults to common macOS / Linux locations. */
  chromePath?: string;
  /** Show the browser window. Default false (headless=new). */
  headless?: boolean;
  /** Extra flags appended to Chrome's command line. */
  extraArgs?: string[];
}

const DEFAULT_CHROME_PATHS = [
  process.env["CHROME_PATH"],
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter((p): p is string => typeof p === "string" && p.length > 0);

function findChrome(override?: string): string {
  const candidates = override ? [override] : DEFAULT_CHROME_PATHS;
  for (const p of candidates) {
    try {
      // accessSync via existsSync semantics — if the path resolves, use it
      // (we accept the cost of a launch failure later if perms are wrong)
      if (p && require("node:fs").existsSync(p)) return p;
    } catch {
      /* keep looking */
    }
  }
  throw new Error(
    `Chrome not found. Tried: ${candidates.join(", ")}. Set CHROME_PATH env var.`,
  );
}

const DEFAULT_FLAGS = [
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-default-apps",
  "--disable-popup-blocking",
  "--disable-prompt-on-repost",
  "--disable-sync",
  "--disable-translate",
  "--disable-features=Translate,AcceptCHFrame",
  "--metrics-recording-only",
  "--password-store=basic",
  "--use-mock-keychain",
  "--no-startup-window=false",
  "about:blank",
];

export async function launchChrome(opts: LaunchOptions = {}): Promise<LaunchedChrome> {
  const chromePath = findChrome(opts.chromePath);
  const userDataDir = mkdtempSync(join(tmpdir(), "fast-browser-"));

  const args: string[] = [
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    ...(opts.headless ?? true ? ["--headless=new"] : []),
    ...DEFAULT_FLAGS,
    ...(opts.extraArgs ?? []),
  ];

  const proc = spawn(chromePath, args, { stdio: ["ignore", "pipe", "pipe"] });

  // Chrome prints `DevTools listening on ws://127.0.0.1:<port>/devtools/...`
  // to stderr before the WebSocket is ready.
  const port = await new Promise<number>((resolve, reject) => {
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      const m = buf.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//);
      if (m) {
        proc.stderr?.off("data", onData);
        resolve(Number(m[1]));
      }
    };
    proc.stderr?.on("data", onData);
    proc.once("exit", (code) => {
      reject(new Error(`Chrome exited with code ${code} before reporting a debug port. stderr: ${buf}`));
    });
    setTimeout(() => {
      proc.stderr?.off("data", onData);
      reject(new Error(`Chrome did not report a debug port within 15s. stderr: ${buf}`));
    }, 15_000);
  });

  const close = async () => {
    try {
      proc.kill("SIGTERM");
    } catch {
      /* already dead */
    }
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* */
        }
        resolve();
      }, 2000);
      proc.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
    });
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      /* */
    }
  };

  return { port, process: proc, userDataDir, close };
}
